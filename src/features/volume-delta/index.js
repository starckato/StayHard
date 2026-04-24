// 큐록 · Volume Delta — 이번 주 vs 지난 주 부위별 볼륨 비교
//
// 운동 카드 하단 mini-chart: FF `volume_delta_card` 뒤. P3 헬스덕 전용.
// 데이터: `daily_logs.workouts[].exercises[].sets[]` ({kg, reps, done})
//
// SERVICE_EVALUATION §6 B8 + §9 P-P3.

/** ISO week (Mon-based). */
function weekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/** Muscle group bucket — rough heuristic from exercise name. */
function muscleBucket(exName) {
  if (!exName) return 'other';
  const s = exName.toLowerCase();
  if (/(chest|가슴|벤치|push[- ]?up|딥스|플라이|dips)/i.test(s)) return 'chest';
  if (/(back|등|풀[- ]?up|풀업|랫|로우|데드리프트|deadlift|pull)/i.test(s)) return 'back';
  if (/(shoulder|숄더|어깨|오버헤드|프레스|레터럴|overhead)/i.test(s)) return 'shoulder';
  if (/(leg|스쿼트|squat|런지|lunge|하체|레그|calf|종아리|브릿지|힙)/i.test(s)) return 'leg';
  if (/(arm|팔|컬|curl|트라이|트라이셉스|tricep|biceps)/i.test(s)) return 'arm';
  return 'other';
}

/** Compute volume per muscle group for a single daily log. */
export function computeDayVolume(log) {
  const out = { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, other: 0, total: 0 };
  if (!log) return out;
  const workouts = Array.isArray(log.workouts) ? log.workouts : [];
  for (const w of workouts) {
    if (!w || w.status !== 'done') continue;
    const exs = Array.isArray(w.exercises) ? w.exercises : (w.name ? [{ name: w.name, sets: w.sets || [] }] : []);
    for (const ex of exs) {
      const bucket = muscleBucket(ex.name);
      const sets = Array.isArray(ex.sets) ? ex.sets : [];
      for (const s of sets) {
        if (!s || !s.done) continue;
        const vol = (parseFloat(s.kg) || 0) * (parseInt(s.reps) || 0);
        out[bucket] += vol;
        out.total += vol;
      }
    }
  }
  return out;
}

/**
 * Sum volume across the week of `date` using logCache.
 * @param {Object} logCache — { 'YYYY-MM-DD': log }
 * @param {Date} date — reference day; week is Mon-Sun containing this date
 */
export function computeWeekVolume(logCache, date = new Date()) {
  const out = { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, other: 0, total: 0, week: weekKey(date) };
  if (!logCache) return out;
  // Find Monday of the week
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - (day - 1));
  for (let i = 0; i < 7; i++) {
    const k = d.toISOString().slice(0, 10);
    const log = logCache[k];
    if (log) {
      const v = computeDayVolume(log);
      for (const key of Object.keys(out)) {
        if (typeof out[key] === 'number') out[key] += v[key] || 0;
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Delta this week vs last week.
 * Returns { bucket: { curr, prev, delta, deltaPct, dir }, ... }
 */
export function computeDelta(logCache, date = new Date()) {
  const thisWeek = computeWeekVolume(logCache, date);
  const lastWk = new Date(date);
  lastWk.setDate(lastWk.getDate() - 7);
  const prevWeek = computeWeekVolume(logCache, lastWk);
  const buckets = ['chest', 'back', 'shoulder', 'leg', 'arm', 'total'];
  const result = {};
  for (const b of buckets) {
    const curr = thisWeek[b] || 0;
    const prev = prevWeek[b] || 0;
    const delta = curr - prev;
    const deltaPct = prev > 0 ? (delta / prev) * 100 : (curr > 0 ? 100 : 0);
    result[b] = {
      curr,
      prev,
      delta,
      deltaPct: Math.round(deltaPct),
      dir: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    };
  }
  return result;
}

export const BUCKET_LABELS = {
  chest: '가슴', back: '등', shoulder: '어깨', leg: '하체', arm: '팔',
};
