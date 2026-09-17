// 큐록 · 분석 탭 대시보드 — 헬스 / 러닝
//
// 스펙: document-private/DASHBOARD_SPEC_v1.md (창업자 확정 2026-09-17)
// 범위 원칙: 지정된 13개 지표만. 추가 분석 금지.
//
// 확정 결정:
//   지난주 = 지난 캘린더 주 월~일 (직전 완결 주)
//   러닝 소스 = activities + daily_logs 수동 러닝 병합 (같은 날 ±200m dedupe,
//               수동 기록은 심박 없음 → Zone2 집계 제외)
//   PB = 총거리 D~D×1.1 러닝의 실기록만. 없으면 "기록 없음"
//   3대 = 추정 1RM (Epley kg×(1+reps/30)). reps 없으면 실중량 + "실중량" 태그
//
// 데이터: daily_logs(log_date, workouts, weight) 전체 + activities 전체.
// SWR — localStorage 캐시 먼저 그리고 백그라운드 재조회.

const CACHE_KEY = 'qrok_dash_cache_v2';
const RIEGEL_EXP = 1.06;
const TARGETS = [
  { key: '5K', label: '5K', km: 5 },
  { key: '10K', label: '10K', km: 10 },
  { key: 'HALF', label: '하프', km: 21.0975 },
  { key: 'FULL', label: '풀', km: 42.195 },
];
const BIG3 = ['스쿼트', '벤치프레스', '데드리프트'];
const MUSCLE_GROUPS = ['가슴', '등', '하체', '어깨', '팔', '코어'];
const MUSCLE_MAP = { 복근: '코어' };

let _mode = 'health';
let _data = null;          // { logs:[{d,workouts,weight}], acts:[...] }
let _fetching = false;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const $ = (id) => document.getElementById(id);

// ── 유틸 ──────────────────────────────────────────────────────

function fmtT(sec) {
  if (!sec || !isFinite(sec)) return '—';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtPace(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm)) return '—';
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
}
function fmtVol(kg) {
  if (!kg) return '0';
  return kg >= 1000 ? (kg / 1000).toFixed(1) + 't' : Math.round(kg).toLocaleString() + 'kg';
}
function ymd(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'),
    dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
// 지난 캘린더 주 (직전 완결 월~일)
function lastWeekRange(now = new Date()) {
  const dow = (now.getDay() + 6) % 7;               // 월=0
  const thisMon = new Date(now); thisMon.setDate(now.getDate() - dow);
  const start = new Date(thisMon); start.setDate(thisMon.getDate() - 7);
  const end = new Date(thisMon); end.setDate(thisMon.getDate() - 1);
  return { start: ymd(start), end: ymd(end) };
}

// ── 데이터 로드 ────────────────────────────────────────────────

async function fetchData() {
  const sb = window.sb, CU = window.CU;
  if (!sb || !CU) return null;
  const [logsRes, actsRes] = await Promise.all([
    sb.from('daily_logs')
      .select('log_date, workouts, weight')
      .eq('user_id', CU.id)
      .order('log_date', { ascending: false })
      .limit(730),
    sb.from('activities')
      .select('source, sport, name, started_at, local_date, distance_m, moving_s, duration_s, avg_hr, avg_pace_s_km')
      .eq('user_id', CU.id)
      .order('started_at', { ascending: false })
      .limit(1000),
  ]);
  if (logsRes.error) throw logsRes.error;
  return {
    logs: (logsRes.data || []).map((r) => ({ d: r.log_date, workouts: r.workouts || [], weight: r.weight })),
    acts: actsRes.error ? [] : (actsRes.data || []),
    ts: Date.now(),
  };
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && c.uid === (window.CU && window.CU.id) ? c.data : null;
  } catch (_) { return null; }
}
function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: window.CU && window.CU.id, data }));
  } catch (_) { /* quota — 캐시 없이 동작 */ }
}

// ── 러닝 데이터 병합 ───────────────────────────────────────────
// activities(run) + daily_logs 수동 달리기. 반환: [{date, km, movSec, hr|null, src}]

function collectRuns(data) {
  const runs = [];
  for (const a of data.acts) {
    if (a.sport !== 'run') continue;
    const km = (a.distance_m || 0) / 1000;
    const movSec = a.moving_s || a.duration_s || 0;
    if (km <= 0 || movSec <= 0) continue;
    runs.push({ date: a.local_date, km, movSec, hr: a.avg_hr || null, src: a.source });
  }
  for (const l of data.logs) {
    for (const w of l.workouts) {
      if (w.type !== 'activity' || w.name !== '달리기' || w.status === 'planned') continue;
      const km = parseFloat(w.distance) || 0;
      const movSec = (parseFloat(w.time) || 0) * 60;
      if (km <= 0 || movSec <= 0) continue;
      // 같은 날 ±200m 활동이 이미 있으면 수동 기록은 중복으로 간주
      if (runs.some((r) => r.src !== 'manual-log' && r.date === l.d && Math.abs(r.km - km) < 0.2)) continue;
      runs.push({ date: l.d, km, movSec, hr: null, src: 'manual-log' });
    }
  }
  runs.forEach((r) => { r.pace = r.movSec / r.km; });
  return runs.sort((a, b) => b.date.localeCompare(a.date));
}

// ── 러닝 지표 계산 ─────────────────────────────────────────────

function computeRunning(data) {
  const runs = collectRuns(data);
  const now = new Date();
  const today = ymd(now);
  const dow = (now.getDay() + 6) % 7;
  const weekStart = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow));
  const monthStart = today.slice(0, 8) + '01';
  const yearStart = today.slice(0, 4) + '-01-01';
  const d30 = ymd(new Date(Date.now() - 30 * 86400e3));
  const d90 = ymd(new Date(Date.now() - 90 * 86400e3));

  const sumKm = (from) => runs.filter((r) => r.date >= from && r.date <= today)
    .reduce((a, r) => a + r.km, 0);

  // 평균 페이스 — 최근 30일, 1km 이상
  const r30 = runs.filter((r) => r.date >= d30 && r.km >= 1);
  const avgPace = r30.length ? r30.reduce((a, r) => a + r.movSec, 0) / r30.reduce((a, r) => a + r.km, 0) : null;

  // 최고 페이스 — 전체, 3km 이상
  const eligible = runs.filter((r) => r.km >= 3);
  const best = eligible.length ? eligible.reduce((a, r) => (r.pace < a.pace ? r : a)) : null;

  // Zone2 — 최근 30일, avg_hr ∈ [60%,70%]×max_hr
  const maxHr = window.CP && window.CP.max_hr;
  let z2 = null;
  if (maxHr) {
    const lo = Math.round(maxHr * 0.6), hi = Math.round(maxHr * 0.7);
    const hrRuns = runs.filter((r) => r.date >= d30 && r.hr);
    const z2Runs = hrRuns.filter((r) => r.hr >= lo && r.hr <= hi);
    z2 = {
      lo, hi, maxHr,
      count: z2Runs.length,
      min: Math.round(z2Runs.reduce((a, r) => a + r.movSec, 0) / 60),
      pct: hrRuns.length ? Math.round((z2Runs.length / hrRuns.length) * 100) : 0,
    };
  }

  // PB — 총거리 D~D×1.1 실기록의 최소 시간
  // 예상 — 최근 90일 3km+ 러닝 중 Riegel 정규화 최고 퍼포먼스 기반
  const base90 = runs.filter((r) => r.date >= d90 && r.km >= 3);
  let baseRun = null;
  for (const r of base90) {
    const norm = r.movSec * Math.pow(5 / r.km, RIEGEL_EXP);   // 5km 환산으로 비교
    if (!baseRun || norm < baseRun.norm) baseRun = { ...r, norm };
  }
  const table = TARGETS.map((t) => {
    const cands = runs.filter((r) => r.km >= t.km && r.km <= t.km * 1.1);
    const pb = cands.length ? cands.reduce((a, r) => (r.movSec < a.movSec ? r : a)) : null;
    const est = baseRun ? baseRun.movSec * Math.pow(t.km / baseRun.km, RIEGEL_EXP) : null;
    return { ...t, pb, est };
  });

  return {
    week: sumKm(weekStart), month: sumKm(monthStart), year: sumKm(yearStart),
    avgPace, best, z2, maxHr, table, hasRuns: runs.length > 0,
  };
}

// ── 헬스 지표 계산 ─────────────────────────────────────────────

function gymSessions(log) {
  return (log.workouts || []).filter((w) => w.type === 'gym' && Array.isArray(w.exercises));
}
function dayVolume(log) {
  let v = 0;
  for (const s of gymSessions(log)) {
    for (const ex of s.exercises) {
      for (const st of (ex.sets || [])) {
        if (st.done) v += (parseFloat(st.kg) || 0) * (parseInt(st.reps) || 0);
      }
    }
  }
  return v;
}
function dayMuscles(log) {
  const cnt = {};
  for (const s of gymSessions(log)) {
    for (const ex of s.exercises) {
      if (!(ex.sets || []).some((st) => st.done)) continue;
      const m = MUSCLE_MAP[ex.muscle] || ex.muscle;
      if (m) cnt[m] = (cnt[m] || 0) + 1;
    }
  }
  const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 2).map(([m]) => m);   // 최빈 상위 2개
}

function computeHealth(data) {
  const { start, end } = lastWeekRange();
  const byDate = Object.fromEntries(data.logs.map((l) => [l.d, l]));

  // 지난주 7일 — 볼륨 + 타겟 부위
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start + 'T12:00:00'); d.setDate(d.getDate() + i);
    const key = ymd(d);
    const log = byDate[key];
    days.push({
      key,
      dow: '월화수목금토일'[i],
      vol: log ? dayVolume(log) : 0,
      muscles: log ? dayMuscles(log) : [],
    });
  }
  const totalVol = days.reduce((a, d) => a + d.vol, 0);
  const bestDay = days.reduce((a, d) => (d.vol > (a ? a.vol : 0) ? d : a), null);

  // 3대 — 전체 기간, 정확명 매칭, Epley (reps 없으면 실중량)
  const big3 = {};
  for (const name of BIG3) big3[name] = null;
  for (const l of data.logs) {
    for (const s of gymSessions(l)) {
      for (const ex of s.exercises) {
        if (!BIG3.includes(ex.name)) continue;
        for (const st of (ex.sets || [])) {
          if (!st.done) continue;
          const kg = parseFloat(st.kg) || 0;
          if (kg <= 0) continue;
          const reps = parseInt(st.reps) || 0;
          const val = reps >= 1 ? kg * (1 + reps / 30) : kg;
          const cur = big3[ex.name];
          if (!cur || val > cur.val) big3[ex.name] = { val, raw: reps < 1, kg, reps };
        }
      }
    }
  }

  // 체중 — 최근 기록 + 목표
  const wLog = data.logs.find((l) => l.weight != null && l.weight > 0);
  const curW = wLog ? parseFloat(wLog.weight) : null;
  const goalW = window.CP && window.CP.weight_goal ? parseFloat(window.CP.weight_goal) : null;

  // 최근 gym 세션 — 종목별 볼륨
  let recent = null;
  for (const l of data.logs) {
    const sess = gymSessions(l).filter((s) => (s.exercises || []).some((ex) => (ex.sets || []).some((st) => st.done)));
    if (sess.length) {
      const s = sess[sess.length - 1];
      const exs = s.exercises.map((ex) => ({
        name: ex.name,
        vol: (ex.sets || []).filter((st) => st.done)
          .reduce((a, st) => a + (parseFloat(st.kg) || 0) * (parseInt(st.reps) || 0), 0),
      })).filter((e) => e.vol > 0).sort((a, b) => b.vol - a.vol);
      if (exs.length) { recent = { date: l.d, name: s.sessionName || '헬스 세션', exs }; break; }
    }
  }

  // 부위별 빈도 — 최근 4주
  const d28 = ymd(new Date(Date.now() - 28 * 86400e3));
  const freq = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0]));
  for (const l of data.logs) {
    if (l.d < d28) continue;
    for (const s of gymSessions(l)) {
      for (const ex of s.exercises) {
        if (!(ex.sets || []).some((st) => st.done)) continue;
        const m = MUSCLE_MAP[ex.muscle] || ex.muscle;
        if (m in freq) freq[m]++;
      }
    }
  }

  return { weekStart: start, weekEnd: end, days, totalVol, bestDay, big3, curW, goalW, recent, freq };
}

// ── 렌더 — 헬스 ────────────────────────────────────────────────

const IC = {
  scale: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18 12h3M18.4 5.6l-2.1 2.1"/><circle cx="12" cy="14" r="7"/></svg>',
  bar: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12"/><rect x="2" y="9" width="4" height="6" rx="1"/><rect x="18" y="9" width="4" height="6" rx="1"/></svg>',
  lift: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21l4-9 4 9M12 3v9M7 6.5C8.5 5 10 4.2 12 4.2s3.5.8 5 2.3"/></svg>',
  clock: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  chart: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20h16M7 20v-9M12 20V5M17 20v-6"/></svg>',
  bolt: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L6 14h5l-1 8 7-12h-5l1-8z"/></svg>',
  heart: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 8.6a5.5 5.5 0 0 0-9.8-3.4A5.5 5.5 0 0 0 3.2 12c0 1.6.7 3 1.8 4l7 6 7-6c1.1-1 1.8-2.4 1.8-4"/></svg>',
  trophy: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M10.5 14h3v3h-3zM8 19h8"/></svg>',
};

function renderHealth(h) {
  const el = $('dash-health');
  if (!el) return;

  // ① 체중
  let wtHtml;
  if (h.curW && h.goalW) {
    const diff = Math.round((h.curW - h.goalW) * 10) / 10;
    const badge = diff > 0 ? `−${diff} kg 남음` : diff < 0 ? `+${Math.abs(diff)} kg 증량` : '목표 달성';
    wtHtml = `<div class="dsh-wt">
      <div class="dsh-wt-cur">${h.curW.toFixed(1)}<small> kg</small></div>
      <svg class="dsh-wt-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      <div class="dsh-wt-goal">${h.goalW.toFixed(1)}</div>
      <div class="dsh-wt-badge">${badge}</div>
    </div>`;
  } else {
    wtHtml = `<div class="dsh-sub">${h.curW ? '목표 체중을 설정하면 남은 감량이 표시됩니다' : '체중을 기록하면 표시됩니다'}</div>`;
  }

  // ② 지난주 바
  const maxVol = Math.max(...h.days.map((d) => d.vol), 1);
  const barsHtml = h.days.map((d) => {
    const hot = h.bestDay && d.vol > 0 && d.key === h.bestDay.key;
    const hPct = d.vol > 0 ? Math.max(8, Math.round((d.vol / maxVol) * 100)) : 3;
    return `<div class="dsh-bar ${hot ? 'hot' : ''}">
      <span class="dsh-bar-m">${d.vol > 0 ? fmtVol(d.vol) : ''}</span>
      <div class="dsh-bar-b" style="height:${hPct}%"></div>
      <span class="dsh-bar-t">${esc(d.muscles.join('·'))}</span>
      <span class="dsh-bar-d">${d.dow}</span>
    </div>`;
  }).join('');
  const rangeLabel = `${parseInt(h.weekStart.slice(5, 7))}/${parseInt(h.weekStart.slice(8, 10))} – ${parseInt(h.weekEnd.slice(5, 7))}/${parseInt(h.weekEnd.slice(8, 10))}`;

  // ③ 3대
  const big3Cells = BIG3.map((name) => {
    const b = h.big3[name];
    return `<div class="dsh-big3-c">
      <div class="dsh-big3-v">${b ? Math.round(b.val) : '—'}<small>${b ? ' kg' : ''}</small></div>
      <div class="dsh-big3-k">${name}</div>
      ${b && b.raw ? '<span class="dsh-big3-tag">실중량</span>' : ''}
    </div>`;
  }).join('');
  const big3Sum = BIG3.every((n) => h.big3[n])
    ? `<div class="dsh-big3-sum">합계 <b>${Math.round(BIG3.reduce((a, n) => a + h.big3[n].val, 0))} kg</b></div>` : '';

  // ④ 최근 세션
  let recentHtml = '<div class="dsh-sub">아직 운동 기록이 없어요</div>';
  if (h.recent) {
    const maxEx = h.recent.exs[0].vol;
    const d = new Date(h.recent.date + 'T12:00:00');
    const dowStr = '일월화수목금토'[d.getDay()];
    recentHtml = h.recent.exs.slice(0, 6).map((e) => `<div class="dsh-exrow">
      <span class="dsh-exrow-nm">${esc(e.name)}</span>
      <div class="dsh-exrow-vb" style="width:${Math.max(8, Math.round((e.vol / maxEx) * 96))}px"></div>
      <span class="dsh-exrow-vv">${fmtVol(e.vol)}</span>
    </div>`).join('');
    recentHtml = `<div class="dsh-lbl">${IC.clock}최근 운동 <span class="dsh-sub-inline">${d.getMonth() + 1}/${d.getDate()} ${dowStr} · ${esc(h.recent.name)}</span></div>` + recentHtml;
  } else {
    recentHtml = `<div class="dsh-lbl">${IC.clock}최근 운동</div>` + recentHtml;
  }

  // ⑤ 부위별 빈도
  const maxFreq = Math.max(...Object.values(h.freq), 1);
  const minFreq = Math.min(...Object.values(h.freq));
  const freqHtml = MUSCLE_GROUPS
    .map((m) => ({ m, n: h.freq[m] }))
    .sort((a, b) => b.n - a.n)
    .map(({ m, n }) => `<div class="dsh-mrow ${n === minFreq && n < maxFreq ? 'dim' : ''}">
      <span class="dsh-mrow-nm">${m}</span>
      <div class="dsh-mrow-track"><div class="dsh-mrow-fill" style="width:${n > 0 ? Math.max(6, Math.round((n / maxFreq) * 100)) : 0}%"></div></div>
      <span class="dsh-mrow-vv">${n}</span>
    </div>`).join('');

  el.innerHTML = `
    <div class="dsh-card"><div class="dsh-lbl">${IC.scale}체중</div>${wtHtml}</div>
    <div class="dsh-card">
      <div class="dsh-lbl">${IC.bar}지난주 <span class="dsh-sub-inline">${rangeLabel} (월–일)</span></div>
      <div class="dsh-wk-total"><div class="dsh-wk-v">${h.totalVol >= 1000 ? (h.totalVol / 1000).toFixed(1) : Math.round(h.totalVol)}<span class="dsh-wk-u"> ${h.totalVol >= 1000 ? 't' : 'kg'}</span></div><div class="dsh-wk-k">Total 볼륨</div></div>
      <div class="dsh-bars">${barsHtml}</div>
      ${h.bestDay && h.bestDay.vol > 0 ? `<div class="dsh-wk-best">일별 최고 <b>${h.bestDay.dow}요일 ${fmtVol(h.bestDay.vol)}</b></div>` : '<div class="dsh-wk-best dsh-sub">지난주 운동 기록 없음</div>'}
    </div>
    <div class="dsh-card">
      <div class="dsh-lbl">${IC.lift}3대 최고 기록 <span class="dsh-sub-inline">추정 1RM</span></div>
      <div class="dsh-big3">${big3Cells}</div>${big3Sum}
    </div>
    <div class="dsh-card">${recentHtml}</div>
    <div class="dsh-card">
      <div class="dsh-lbl">${IC.chart}부위별 빈도 <span class="dsh-sub-inline">최근 4주 · 종목 수행 횟수</span></div>
      ${freqHtml}
    </div>`;
}

// ── 렌더 — 러닝 ────────────────────────────────────────────────

function renderRunning(r) {
  const el = $('dash-running');
  if (!el) return;

  if (!r.hasRuns) {
    el.innerHTML = `<div class="dsh-card" style="text-align:center;padding:28px 16px;">
      <div style="font-size:var(--text-base);font-weight:700;margin-bottom:6px;">아직 러닝 기록이 없어요</div>
      <div class="dsh-sub">프로필 → 러닝 앱 연동에서 Strava 를 연결하거나<br>활동 파일(.fit/.tcx/.gpx)을 가져오면 여기에 쌓입니다</div>
    </div>`;
    return;
  }

  // Zone2 카드
  let z2Html;
  if (r.z2) {
    z2Html = `<div class="dsh-card">
      <div class="dsh-lbl">${IC.heart}Zone 2 러닝 <span class="dsh-sub-inline">최근 30일 · ${r.z2.lo}–${r.z2.hi} bpm</span></div>
      <div class="dsh-z2">
        <div class="dsh-z2-ring" style="background:conic-gradient(var(--green) 0 ${r.z2.pct}%,var(--surface3) ${r.z2.pct}% 100%)"><div>${r.z2.pct}%</div></div>
        <div class="dsh-z2-body">
          <div class="dsh-z2-nums">
            <div><div class="dsh-z2-v">${r.z2.count}<span class="dsh-z2-u"> 회</span></div><div class="dsh-z2-k">Z2 러닝</div></div>
            <div><div class="dsh-z2-v">${r.z2.min}<span class="dsh-z2-u"> 분</span></div><div class="dsh-z2-k">누적 시간</div></div>
          </div>
          <div class="dsh-sub" style="margin-top:6px;">심박 기록 러닝 중 ${r.z2.pct}%가 Zone 2 · 최대심박 ${r.z2.maxHr} <span class="dsh-link" onclick="dashSetMaxHr()">변경</span></div>
        </div>
      </div>
    </div>`;
  } else {
    z2Html = `<div class="dsh-card">
      <div class="dsh-lbl">${IC.heart}Zone 2 러닝</div>
      <div class="dsh-sub" style="margin-bottom:10px;">최대심박을 설정하면 Zone 2 (60–70%) 러닝이 집계됩니다</div>
      <button class="dsh-btn" onclick="dashSetMaxHr()">최대심박 설정</button>
    </div>`;
  }

  const rows = r.table.map((t) => `<tr>
    <td>${t.label}<span class="dsh-dist-sub">${t.km % 1 ? t.km.toFixed(1) : t.km.toFixed(0)} km</span></td>
    <td class="dsh-pb">${t.pb
      ? `${fmtT(t.pb.movSec)}<span class="dsh-pb-date">${parseInt(t.pb.date.slice(5, 7))}/${parseInt(t.pb.date.slice(8, 10))} · ${t.pb.km.toFixed(1)}km</span>`
      : '<span class="dsh-none">기록 없음</span>'}</td>
    <td class="dsh-est">${t.est ? fmtT(t.est) : '—'}</td>
  </tr>`).join('');

  el.innerHTML = `
    <div class="dsh-card">
      <div class="dsh-lbl">${IC.bolt}마일리지 · 이번 주</div>
      <div class="dsh-hero-num">${r.week.toFixed(1)}<small>km</small></div>
      <div class="dsh-hero-row">
        <div class="dsh-hero-cell"><div class="dsh-hero-v">${r.month.toFixed(1)} <span class="dsh-hero-u">km</span></div><div class="dsh-hero-k">이번 달</div></div>
        <div class="dsh-hero-cell"><div class="dsh-hero-v">${Math.round(r.year)} <span class="dsh-hero-u">km</span></div><div class="dsh-hero-k">올해</div></div>
      </div>
    </div>
    <div class="dsh-grid2">
      <div class="dsh-tile"><div class="dsh-tile-v">${fmtPace(r.avgPace)}<small>/km</small></div><div class="dsh-tile-k">평균 페이스 · 최근 30일</div></div>
      <div class="dsh-tile"><div class="dsh-tile-v" style="color:var(--accent);">${r.best ? fmtPace(r.best.pace) : '—'}<small>/km</small></div><div class="dsh-tile-k">최고 페이스 · 3km+ 러닝</div></div>
    </div>
    ${z2Html}
    <div class="dsh-card">
      <div class="dsh-lbl">${IC.trophy}거리별 기록</div>
      <table class="dsh-table">
        <tr><th>거리</th><th>PB</th><th>예상 기록</th></tr>
        ${rows}
      </table>
      <div class="dsh-sub" style="margin-top:10px;">PB = 해당 거리(~+10%)를 실제로 뛴 기록 · 예상 = 최근 90일 최고 퍼포먼스 기반 (Riegel)</div>
    </div>`;
}

// ── 최대심박 설정 ──────────────────────────────────────────────

export async function dashSetMaxHr() {
  const cur = window.CP && window.CP.max_hr;
  const v = window.qkPrompt
    ? await window.qkPrompt('최대심박 (bpm)', { value: cur ? String(cur) : '', placeholder: '예: 180 — 잘 모르면 220 − 나이', maxLength: 3 })
    : null;
  if (v === null || v === undefined) return;
  const n = parseInt(v);
  if (!n || n < 120 || n > 230) {
    if (window.showToast) window.showToast('120–230 사이 숫자로 입력해주세요');
    return;
  }
  try {
    const { error } = await window.sb.from('profiles').update({ max_hr: n }).eq('id', window.CU.id);
    if (error) throw error;
    if (window.CP) window.CP.max_hr = n;
    if (window.showToast) window.showToast('최대심박 ' + n + ' 저장됨');
    if (_data) renderRunning(computeRunning(_data));
  } catch (e) {
    if (window.showToast) window.showToast('저장 실패: ' + (e.message || e));
  }
}

// ── 진입점 ─────────────────────────────────────────────────────

export function dashMode(mode) {
  _mode = mode;
  const h = $('dash-health'), r = $('dash-running'), classic = $('stats-classic');
  const segH = $('dash-seg-h'), segR = $('dash-seg-r');
  const periodBtns = $('st-period-btns');
  if (h) h.style.display = mode === 'health' ? '' : 'none';
  if (classic) classic.style.display = mode === 'health' ? '' : 'none';
  if (r) r.style.display = mode === 'running' ? '' : 'none';
  if (periodBtns) periodBtns.style.display = mode === 'health' ? '' : 'none';
  if (segH) segH.classList.toggle('on', mode === 'health');
  if (segR) segR.classList.toggle('on', mode === 'running');
}

function renderAll() {
  if (!_data) return;
  try { renderHealth(computeHealth(_data)); } catch (e) { console.warn('[dash] health', e); }
  try { renderRunning(computeRunning(_data)); } catch (e) { console.warn('[dash] running', e); }
}

export async function renderDashboards() {
  if (!window.CU) return;
  // SWR: 캐시 즉시 → 백그라운드 갱신
  if (!_data) {
    const cached = loadCache();
    if (cached) { _data = cached; renderAll(); }
  } else {
    renderAll();
  }
  if (_fetching) return;
  _fetching = true;
  try {
    const fresh = await fetchData();
    if (fresh) { _data = fresh; saveCache(fresh); renderAll(); }
  } catch (e) {
    console.warn('[dash] fetch', e);
  } finally {
    _fetching = false;
  }
}
