// QROK · activity-import Edge Function
//
// 범용 활동 파일 임포트 — .fit / .tcx / .gpx / .zip(fit)
// 스트라바를 쓰지 않는 가민·코로스·순토·폴라 등 모든 워치 유저를 커버하는 경로.
// (가민 커넥트: 활동 → ⚙ → "원본/TCX/GPX 내보내기" 파일을 그대로 올리면 된다.)
//
// POST /  (Authorization: 유저 세션 JWT)
//   body: { filename: string, data_b64: string }   (≤15MB)
//   → 파싱 → 세션 요약 추출 → append_external_activities (append-only, dedupe)
//
// 원칙
//   * 파일 원문은 저장하지 않는다 — 요약만 activities 로. (raw 에 세션 요약 원값 보존)
//   * dedupe 1: source_id = 시작시각+거리 합성키 (같은 파일 재업로드 무해)
//   * dedupe 2: 타 소스 교차 중복 — 시작 ±3분 & 거리 ±200m 기존 활동 있으면 skip
//     (스트라바 연동 유저가 같은 러닝 파일을 또 올려도 이중 기록 없음)
//
// 배포: --no-verify-jwt (유저 JWT 를 코드에서 직접 검증)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { Decoder, Stream } from 'https://esm.sh/@garmin/fitsdk@21.171.0';
// zip(가민 "원본" 내보내기 = .zip 안의 .fit) 해제용
import { unzipSync } from 'https://esm.sh/fflate@0.8.2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL = 'https://qrok.app';
const MAX_BYTES = 15 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': APP_URL,
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (s: number, code: string, message: string) => json({ error: { code, message } }, s);
const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── 공통 요약 형태 ─────────────────────────────────────────────
interface Summary {
  sport: string;          // run · ride · swim · walk · hike · workout · other
  name: string | null;
  startISO: string;       // UTC ISO
  localDate: string;      // YYYY-MM-DD (기기 로컬 기준 최선 추정)
  distanceM: number | null;
  elapsedS: number | null;
  movingS: number | null;
  elevGainM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;  // 러닝 spm
  calories: number | null;
}

const SPORT_NAME: Record<string, string> = {
  run: '달리기', ride: '사이클', swim: '수영', walk: '걷기', hike: '걷기', workout: '운동', other: '활동',
};

function normSport(s: string): string {
  const v = (s || '').toLowerCase();
  if (v.includes('run')) return 'run';
  if (v.includes('cycl') || v.includes('bik') || v === 'ride') return 'ride';
  if (v.includes('swim')) return 'swim';
  if (v.includes('walk')) return 'walk';
  if (v.includes('hik')) return 'hike';
  if (v.includes('training') || v.includes('workout') || v.includes('strength')) return 'workout';
  return 'other';
}

// ── FIT ────────────────────────────────────────────────────────
function parseFit(bytes: Uint8Array): Summary[] {
  const stream = Stream.fromByteArray(Array.from(bytes));
  const decoder = new Decoder(stream);
  if (!decoder.isFIT() || !decoder.checkIntegrity()) throw new Error('not_fit');
  // deno-lint-ignore no-explicit-any
  const { messages } = decoder.read({ convertDateTimesToDates: true }) as { messages: any };
  // deno-lint-ignore no-explicit-any
  const sessions: any[] = messages.sessionMesgs ?? [];
  return sessions.map((s) => {
    const start: Date = s.startTime instanceof Date ? s.startTime : new Date(s.startTime);
    const sport = normSport(String(s.sport ?? ''));
    // FIT 러닝 케이던스 = 편측 rpm (+fractional) → spm 으로 ×2
    let cad: number | null = null;
    if (s.avgCadence != null) {
      let c: number = s.avgCadence + (s.avgFractionalCadence ?? 0);
      if (sport === 'run' || sport === 'walk' || sport === 'hike') c *= 2;
      cad = Math.round(c);
    }
    return {
      sport,
      name: null,
      startISO: start.toISOString(),
      // FIT startTime 은 UTC. localDate 는 timeCreated/localTimestamp 부재 시 UTC+9 근사가 아니라
      // 클라이언트 보정 없이 UTC 날짜 사용 시 오차 → sub_sport 대신 start 로컬 추정:
      // 대부분 파일에 activityMesgs.localTimestamp 가 있다.
      localDate: (() => {
        // deno-lint-ignore no-explicit-any
        const act: any = (messages.activityMesgs ?? [])[0];
        if (act?.localTimestamp && act?.timestamp) {
          const offMs = new Date(act.localTimestamp).getTime() - new Date(act.timestamp).getTime();
          return new Date(start.getTime() + offMs).toISOString().slice(0, 10);
        }
        return start.toISOString().slice(0, 10);
      })(),
      distanceM: s.totalDistance ?? null,
      elapsedS: s.totalElapsedTime != null ? Math.round(s.totalElapsedTime) : null,
      movingS: s.totalTimerTime != null ? Math.round(s.totalTimerTime) : null,
      elevGainM: s.totalAscent ?? null,
      avgHr: s.avgHeartRate ?? null,
      maxHr: s.maxHeartRate ?? null,
      avgCadence: cad,
      calories: s.totalCalories ?? null,
    };
  });
}

// ── TCX (XML — 정규식 요약 추출) ───────────────────────────────
function num(re: RegExp, s: string): number[] {
  const out: number[] = [];
  let m;
  while ((m = re.exec(s))) out.push(parseFloat(m[1]));
  return out;
}
function parseTcx(text: string): Summary[] {
  const acts = text.split(/<Activity\b/).slice(1);
  return acts.map((a) => {
    const sport = normSport(/Sport="([^"]+)"/.exec(a)?.[1] ?? '');
    const startStr = /<Id>([^<]+)<\/Id>/.exec(a)?.[1] ?? /<Lap StartTime="([^"]+)"/.exec(a)?.[1];
    if (!startStr) throw new Error('tcx_no_start');
    const times = num(/<TotalTimeSeconds>([\d.]+)</g, a);
    const dists = num(/<DistanceMeters>([\d.]+)<\/DistanceMeters>\s*(?=<Calories|<Average|<Maximum|<Intensity|<TriggerMethod|<Track|<Cadence|<Extensions|<\/Lap)/g, a);
    // Lap 단위 DistanceMeters 만 합산 (Trackpoint 의 누적값 제외) — 위 lookahead 로 근사,
    // 실패 시 Trackpoint 마지막 누적값 fallback
    let distanceM: number | null = dists.length ? dists.reduce((x, y) => x + y, 0) : null;
    if (distanceM == null) {
      const all = num(/<DistanceMeters>([\d.]+)</g, a);
      distanceM = all.length ? Math.max(...all) : null;
    }
    const cals = num(/<Calories>(\d+)</g, a);
    const hrsAvg = num(/<AverageHeartRateBpm>\s*<Value>(\d+)</g, a);
    const hrsMax = num(/<MaximumHeartRateBpm>\s*<Value>(\d+)</g, a);
    const cad = num(/<AvgRunCadence[^>]*>(\d+)</g, a);
    const start = new Date(startStr);
    return {
      sport,
      name: null,
      startISO: start.toISOString(),
      localDate: startStr.length > 19 && !startStr.endsWith('Z')
        ? startStr.slice(0, 10)                       // 오프셋 포함 로컬 표기
        : start.toISOString().slice(0, 10),
      distanceM,
      elapsedS: times.length ? Math.round(times.reduce((x, y) => x + y, 0)) : null,
      movingS: times.length ? Math.round(times.reduce((x, y) => x + y, 0)) : null,
      elevGainM: null,
      avgHr: hrsAvg.length ? Math.round(hrsAvg.reduce((x, y) => x + y, 0) / hrsAvg.length) : null,
      maxHr: hrsMax.length ? Math.max(...hrsMax) : null,
      avgCadence: cad.length ? Math.round((cad.reduce((x, y) => x + y, 0) / cad.length) * 2) : null,
      calories: cals.length ? cals.reduce((x, y) => x + y, 0) : null,
    };
  });
}

// ── GPX (트랙포인트에서 거리·시간·HR 계산) ─────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function parseGpx(text: string): Summary[] {
  const name = /<name>([^<]{1,80})<\/name>/.exec(text)?.[1] ?? null;
  const sport = normSport(/<type>([^<]+)<\/type>/.exec(text)?.[1] ?? name ?? '');
  const ptRe = /<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
  let m, prev: { lat: number; lon: number; t: number; ele: number | null } | null = null;
  let dist = 0, elevGain = 0, hrSum = 0, hrN = 0, hrMax = 0, movingS = 0;
  let first: number | null = null, last: number | null = null, firstStr: string | null = null;
  while ((m = ptRe.exec(text))) {
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]), body = m[3];
    const tStr = /<time>([^<]+)<\/time>/.exec(body)?.[1];
    if (!tStr) continue;
    const t = new Date(tStr).getTime();
    const ele = /<ele>([-\d.]+)<\/ele>/.exec(body) ? parseFloat(/<ele>([-\d.]+)<\/ele>/.exec(body)![1]) : null;
    const hr = /:?hr>(\d+)</.exec(body) ? parseInt(/:?hr>(\d+)</.exec(body)![1]) : null;
    if (hr) { hrSum += hr; hrN++; if (hr > hrMax) hrMax = hr; }
    if (first === null) { first = t; firstStr = tStr; }
    last = t;
    if (prev) {
      const d = haversine(prev.lat, prev.lon, lat, lon);
      const dt = (t - prev.t) / 1000;
      dist += d;
      if (dt > 0 && dt < 60 && d / dt > 0.5) movingS += dt;  // 정지 구간 제외 근사
      if (ele != null && prev.ele != null && ele > prev.ele) elevGain += ele - prev.ele;
    }
    prev = { lat, lon, t, ele };
  }
  if (first === null || last === null) throw new Error('gpx_no_points');
  return [{
    sport: sport === 'other' ? 'run' : sport,   // GPX 단독 업로드는 대개 러닝
    name,
    startISO: new Date(first).toISOString(),
    localDate: firstStr && firstStr.length > 19 && !firstStr.endsWith('Z')
      ? firstStr.slice(0, 10)
      : new Date(first).toISOString().slice(0, 10),
    distanceM: dist > 0 ? Math.round(dist) : null,
    elapsedS: Math.round((last - first) / 1000),
    movingS: movingS > 0 ? Math.round(movingS) : Math.round((last - first) / 1000),
    elevGainM: elevGain > 0 ? Math.round(elevGain) : null,
    avgHr: hrN ? Math.round(hrSum / hrN) : null,
    maxHr: hrMax || null,
    avgCadence: null,
    calories: null,
  }];
}

// ── 요약 → 임포트 엔트리 ───────────────────────────────────────
function toEntry(s: Summary) {
  const distKm = s.distanceM && s.distanceM > 0 ? Math.round((s.distanceM / 1000) * 100) / 100 : null;
  const timeMin = s.movingS && s.movingS > 0 ? Math.round(s.movingS / 60) : null;
  let meta = distKm ? `${distKm} km` : '';
  if (timeMin) meta += (meta ? ' · ' : '') + `${timeMin} 분`;
  let pace: string | null = null;
  if (distKm && timeMin && s.sport === 'run') {
    const p = timeMin / distKm;
    const pm = Math.floor(p), ps = Math.round((p - pm) * 60);
    pace = `${pm}'${ps < 10 ? '0' : ''}${ps}"`;
    meta += ` · ${pace}/km`;
  }
  if (!meta) meta = '기록됨';
  const displayName = SPORT_NAME[s.sport] ?? '활동';
  return {
    source: 'file',
    source_id: `${s.startISO}_${Math.round(s.distanceM ?? 0)}`,
    sport: s.sport,
    name: s.name ?? displayName,
    started_at: s.startISO,
    local_date: s.localDate,
    timezone: null,
    distance_m: s.distanceM,
    duration_s: s.elapsedS,
    moving_s: s.movingS,
    elev_gain_m: s.elevGainM,
    avg_hr: s.avgHr,
    max_hr: s.maxHr,
    avg_cadence: s.avgCadence,
    calories: s.calories,
    raw: { imported_from: 'file' },
    display: {
      type: 'activity', icon: '', name: displayName, cat: 'cardio', meta,
      status: 'done', distance: distKm, time: timeMin, pace,
      _source: 'file', _srcId: `${s.startISO}_${Math.round(s.distanceM ?? 0)}`,
    },
  };
}

// ── 핸들러 ─────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'POST only.');

  // 유저 인증
  const header = req.headers.get('Authorization') ?? '';
  const jwt = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!jwt) return fail(401, 'unauthorized', 'User session required.');
  const s = svc();
  const { data: u, error: uerr } = await s.auth.getUser(jwt);
  if (uerr || !u?.user) return fail(401, 'unauthorized', 'Invalid session.');
  const uid = u.user.id;

  let body: { filename?: string; data_b64?: string };
  try { body = await req.json(); } catch { return fail(400, 'bad_json', 'Invalid JSON.'); }
  const filename = (body.filename ?? '').toLowerCase();
  if (!body.data_b64) return fail(400, 'bad_request', 'data_b64 required.');

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(body.data_b64), (c) => c.charCodeAt(0));
  } catch { return fail(400, 'bad_request', 'data_b64 is not valid base64.'); }
  if (bytes.length > MAX_BYTES) return fail(413, 'too_large', 'File exceeds 15MB.');

  // zip 이면 내부 fit/tcx/gpx 추출
  let files: { name: string; bytes: Uint8Array }[] = [{ name: filename, bytes }];
  if (filename.endsWith('.zip') || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    try {
      const un = unzipSync(bytes);
      files = Object.entries(un)
        .filter(([n]) => /\.(fit|tcx|gpx)$/i.test(n))
        .slice(0, 10)
        .map(([n, b]) => ({ name: n.toLowerCase(), bytes: b as Uint8Array }));
      if (!files.length) return fail(400, 'unsupported', 'Zip contains no .fit/.tcx/.gpx.');
    } catch { return fail(400, 'bad_zip', 'Could not read zip file.'); }
  }

  const summaries: Summary[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      if (f.name.endsWith('.fit') || (f.bytes.length > 12 && String.fromCharCode(...f.bytes.slice(8, 12)) === '.FIT')) {
        summaries.push(...parseFit(f.bytes));
      } else if (f.name.endsWith('.tcx')) {
        summaries.push(...parseTcx(new TextDecoder().decode(f.bytes)));
      } else if (f.name.endsWith('.gpx')) {
        summaries.push(...parseGpx(new TextDecoder().decode(f.bytes)));
      } else {
        errors.push(`${f.name}: unsupported format`);
      }
    } catch (e) {
      errors.push(`${f.name}: ${String(e).slice(0, 80)}`);
    }
  }
  if (!summaries.length) {
    return fail(422, 'parse_failed', errors.join(' / ') || 'No activity found in file.');
  }

  // 교차 소스 중복 제거 — 시작 ±3분 & 거리 ±200m 기존 활동이 있으면 skip
  const entries = [];
  let crossDupes = 0;
  for (const sum of summaries) {
    const t = new Date(sum.startISO);
    const { data: near } = await s.from('activities')
      .select('id, distance_m')
      .eq('user_id', uid)
      .gte('started_at', new Date(t.getTime() - 3 * 60_000).toISOString())
      .lte('started_at', new Date(t.getTime() + 3 * 60_000).toISOString());
    const dup = (near ?? []).some((n) =>
      Math.abs((n.distance_m ?? 0) - (sum.distanceM ?? 0)) < 200);
    if (dup) { crossDupes++; continue; }
    entries.push(toEntry(sum));
  }

  let inserted = 0, skipped = 0;
  if (entries.length) {
    const { data: r, error } = await s.rpc('append_external_activities', {
      p_user_id: uid, p_entries: entries,
    });
    if (error) return fail(500, 'import_failed', error.message);
    inserted = r?.inserted ?? 0;
    skipped = r?.skipped ?? 0;
  }
  return json({
    parsed: summaries.length,
    imported: inserted,
    skipped: skipped + crossDupes,
    ...(errors.length ? { warnings: errors } : {}),
  });
});
