// QROK · strava-sync Edge Function
//
// 스트라바 OAuth 연결 + 앱 실행 시 자동 활동 임포트.
// 가민런은 가민→스트라바 공식 자동 동기화를 통해 이 커넥터 하나로 함께 유입된다.
//
// 라우트
//   GET  /config      — 연동 가능 여부 (client_id 설정됐는지). 인증 불필요.
//   POST /start       — (유저 JWT) 스트라바 authorize URL 반환. state = HMAC(user_id).
//   GET  /callback    — 스트라바 redirect. code 교환 → external_connections upsert → 앱으로 302.
//   POST /sync        — (유저 JWT) last_sync 이후 활동 fetch → append_external_activities.
//   POST /disconnect  — (유저 JWT) 스트라바 deauthorize + 연결 행 삭제.
//
// 원칙
//   * 토큰은 external_connections 에만 저장, 응답·로그에 남기지 않는다.
//   * 임포트는 append-only (053 RPC) — 기존 유저 데이터 수정·삭제 절대 없음.
//   * 배포: --no-verify-jwt (callback 은 스트라바가 호출 — JWT 없음. /start·/sync 는
//     코드에서 유저 JWT 를 직접 검증한다.)
//
// Secrets (supabase secrets set):
//   STRAVA_CLIENT_ID · STRAVA_CLIENT_SECRET
//   (SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 는 자동 주입)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLIENT_ID = Deno.env.get('STRAVA_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('STRAVA_CLIENT_SECRET') ?? '';

const APP_URL = 'https://qrok.app';
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/strava-sync/callback`;
const MAX_PAGES = 3;          // 1회 동기화 최대 3×50 활동
const FIRST_SYNC_DAYS = 30;   // 최초 연결 시 최근 30일만

const CORS = {
  'Access-Control-Allow-Origin': APP_URL,
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

const svc = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── state HMAC (callback 은 JWT 가 없으므로 user_id 를 서명해 왕복) ──
async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SERVICE_KEY.slice(0, 64)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function makeState(userId: string): Promise<string> {
  const ts = Date.now().toString(36);
  return `${userId}.${ts}.${await hmac(userId + '.' + ts)}`;
}
async function verifyState(state: string): Promise<string | null> {
  const [uid, ts, sig] = state.split('.');
  if (!uid || !ts || !sig) return null;
  if ((await hmac(uid + '.' + ts)) !== sig) return null;
  if (Date.now() - parseInt(ts, 36) > 15 * 60_000) return null; // 15분 유효
  return uid;
}

async function requireUser(req: Request): Promise<string | Response> {
  const header = req.headers.get('Authorization') ?? '';
  const jwt = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!jwt) return fail(401, 'unauthorized', 'User session required.');
  const { data, error } = await svc().auth.getUser(jwt);
  if (error || !data?.user) return fail(401, 'unauthorized', 'Invalid session.');
  return data.user.id;
}

// ── Strava API ────────────────────────────────────────────────

async function tokenExchange(params: Record<string, string>) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  if (!res.ok) throw new Error(`strava_token_${res.status}`);
  return await res.json();
}

// deno-lint-ignore no-explicit-any
async function freshAccessToken(conn: any): Promise<string> {
  if (new Date(conn.expires_at).getTime() - Date.now() > 5 * 60_000) return conn.access_token;
  const tok = await tokenExchange({ grant_type: 'refresh_token', refresh_token: conn.refresh_token });
  await svc().from('external_connections').update({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: new Date(tok.expires_at * 1000).toISOString(),
  }).eq('user_id', conn.user_id).eq('provider', 'strava');
  return tok.access_token;
}

// Strava sport_type → 큐록 sport + 표시 이름/카테고리
const SPORT_MAP: Record<string, { sport: string; name: string }> = {
  Run: { sport: 'run', name: '달리기' }, TrailRun: { sport: 'run', name: '달리기' },
  VirtualRun: { sport: 'run', name: '달리기' },
  Ride: { sport: 'ride', name: '사이클' }, VirtualRide: { sport: 'ride', name: '사이클' },
  MountainBikeRide: { sport: 'ride', name: '사이클' }, GravelRide: { sport: 'ride', name: '사이클' },
  Swim: { sport: 'swim', name: '수영' },
  Walk: { sport: 'walk', name: '걷기' }, Hike: { sport: 'hike', name: '걷기' },
  WeightTraining: { sport: 'workout', name: '웨이트' }, Workout: { sport: 'workout', name: '운동' },
};

// deno-lint-ignore no-explicit-any
function mapActivity(a: any) {
  const m = SPORT_MAP[a.sport_type ?? a.type] ?? { sport: 'other', name: a.sport_type ?? a.type ?? '활동' };
  const localDate = String(a.start_date_local ?? a.start_date ?? '').slice(0, 10);
  if (!localDate) return null;
  const distKm = a.distance > 0 ? Math.round((a.distance / 1000) * 100) / 100 : null;
  const timeMin = a.moving_time > 0 ? Math.round(a.moving_time / 60) : null;
  // 표시 meta — 앱 saveActivity() 와 동일 포맷
  let meta = distKm ? `${distKm} km` : '';
  if (timeMin) meta += (meta ? ' · ' : '') + `${timeMin} 분`;
  let pace: string | null = null;
  if (distKm && timeMin && m.sport === 'run') {
    const p = timeMin / distKm;
    const pm = Math.floor(p), ps = Math.round((p - pm) * 60);
    pace = `${pm}'${ps < 10 ? '0' : ''}${ps}"`;
    meta += ` · ${pace}/km`;
  }
  if (!meta) meta = '기록됨';
  return {
    source: 'strava',
    source_id: String(a.id),
    sport: m.sport,
    name: a.name ?? m.name,
    started_at: a.start_date,
    local_date: localDate,
    timezone: a.timezone ?? null,
    distance_m: a.distance ?? null,
    duration_s: a.elapsed_time ?? null,
    moving_s: a.moving_time ?? null,
    elev_gain_m: a.total_elevation_gain ?? null,
    avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    // Strava 러닝 케이던스는 편측(rpm) — 보편 표기(spm)로 ×2
    avg_cadence: a.average_cadence ? (m.sport === 'run' ? a.average_cadence * 2 : a.average_cadence) : null,
    calories: a.calories ?? a.kilojoules ?? null,
    raw: {
      id: a.id, sport_type: a.sport_type ?? a.type, name: a.name,
      average_speed: a.average_speed, max_speed: a.max_speed,
      suffer_score: a.suffer_score ?? null,
    },
    display: {
      type: 'activity', icon: '', name: m.name, cat: 'cardio', meta,
      status: 'done', distance: distKm, time: timeMin, pace,
      _source: 'strava', _srcId: String(a.id),
    },
  };
}

// ── 라우트 ─────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.split('/strava-sync')[1]?.replace(/^\//, '') ?? '';

  try {
    // GET /config — 앱이 연결 버튼 노출 여부 판단
    if (req.method === 'GET' && path === 'config') {
      return json({ configured: !!(CLIENT_ID && CLIENT_SECRET) });
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return fail(503, 'not_configured', 'Strava app credentials are not set yet.');
    }

    // POST /start
    if (req.method === 'POST' && path === 'start') {
      const uid = await requireUser(req); if (uid instanceof Response) return uid;
      const state = await makeState(uid);
      const authorize = 'https://www.strava.com/oauth/authorize?' + new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: CALLBACK_URL,
        response_type: 'code',
        approval_prompt: 'auto',
        scope: 'read,activity:read_all',
        state,
      }).toString();
      return json({ url: authorize });
    }

    // GET /callback — 스트라바가 호출 (JWT 없음, state 로 유저 확정)
    if (req.method === 'GET' && path === 'callback') {
      const err = url.searchParams.get('error');
      if (err) return Response.redirect(`${APP_URL}/?strava=denied`, 302);
      const code = url.searchParams.get('code') ?? '';
      const uid = await verifyState(url.searchParams.get('state') ?? '');
      if (!code || !uid) return Response.redirect(`${APP_URL}/?strava=error`, 302);

      const tok = await tokenExchange({ grant_type: 'authorization_code', code });
      await svc().from('external_connections').upsert({
        user_id: uid,
        provider: 'strava',
        athlete_id: tok.athlete?.id ? String(tok.athlete.id) : null,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: new Date(tok.expires_at * 1000).toISOString(),
        scope: 'read,activity:read_all',
      }, { onConflict: 'user_id,provider' });
      return Response.redirect(`${APP_URL}/?strava=connected`, 302);
    }

    // POST /sync — 앱 실행 시 호출
    if (req.method === 'POST' && path === 'sync') {
      const uid = await requireUser(req); if (uid instanceof Response) return uid;
      const s = svc();
      const { data: conn } = await s.from('external_connections')
        .select('*').eq('user_id', uid).eq('provider', 'strava').maybeSingle();
      if (!conn) return json({ connected: false, imported: 0 });

      const access = await freshAccessToken(conn);
      const after = Math.floor(
        (conn.last_sync_at
          ? new Date(conn.last_sync_at).getTime() - 6 * 3600_000   // 6h 겹침 (업로드 지연 대비)
          : Date.now() - FIRST_SYNC_DAYS * 86400_000) / 1000,
      );

      // deno-lint-ignore no-explicit-any
      const all: any[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await fetch(
          `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=50&page=${page}`,
          { headers: { Authorization: `Bearer ${access}` } },
        );
        if (res.status === 401) return fail(401, 'strava_unauthorized', 'Reconnect Strava.');
        if (res.status === 429) break; // rate limit — 다음 실행에서 이어감
        if (!res.ok) return fail(502, 'strava_error', `Strava API ${res.status}`);
        const batch = await res.json();
        all.push(...batch);
        if (!Array.isArray(batch) || batch.length < 50) break;
      }

      const entries = all.map(mapActivity).filter(Boolean);
      let inserted = 0, skipped = 0;
      if (entries.length) {
        const { data: r, error } = await s.rpc('append_external_activities', {
          p_user_id: uid, p_entries: entries,
        });
        if (error) return fail(500, 'import_failed', error.message);
        inserted = r?.inserted ?? 0; skipped = r?.skipped ?? 0;
      }
      await s.from('external_connections')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('user_id', uid).eq('provider', 'strava');
      return json({ connected: true, fetched: all.length, imported: inserted, skipped });
    }

    // POST /disconnect
    if (req.method === 'POST' && path === 'disconnect') {
      const uid = await requireUser(req); if (uid instanceof Response) return uid;
      const s = svc();
      const { data: conn } = await s.from('external_connections')
        .select('access_token').eq('user_id', uid).eq('provider', 'strava').maybeSingle();
      if (conn) {
        await fetch('https://www.strava.com/oauth/deauthorize', {
          method: 'POST',
          headers: { Authorization: `Bearer ${conn.access_token}` },
        }).catch(() => {});
        await s.from('external_connections').delete().eq('user_id', uid).eq('provider', 'strava');
      }
      return json({ disconnected: true });
    }

    return fail(404, 'not_found', `No route for ${req.method} /${path}`);
  } catch (e) {
    console.error('[strava-sync]', String(e));
    return fail(500, 'internal', 'Sync failed.');
  }
});
