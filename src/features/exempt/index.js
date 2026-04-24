// 큐록 · Exempt 1-tap
//
// 회식/여행/아픔 등 하루 전체 판정 건너뛰기. 주 2회 상한. streak 은 유지 (끊지도 늘리지도 않음).
// cheat_quota (식단 한정) 와 완전 독립 — UI 도 분리.
//
// SERVICE_EVALUATION §6 B5, DEV_REBRAND_SCOPE §5 Exempt.

const MAX_PER_WEEK = 2;

/** ISO-8601 week key, Monday-based. Asia/Seoul 타임존 고정. */
export function weekKey(date = new Date()) {
  // Simple ISO week calc (good enough for weekly quota).
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/** today's local YYYY-MM-DD */
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Count exempt uses in the current week (by weekKey).
 * @param {Array} exemptLog — from profiles.exempt_log
 * @returns {number}
 */
export function usedThisWeek(exemptLog, wk = weekKey()) {
  if (!Array.isArray(exemptLog)) return 0;
  return exemptLog.filter(e => e && e.week_key === wk).length;
}

/** Remaining quota this week (0, 1, or 2). */
export function remainingThisWeek(exemptLog, wk = weekKey()) {
  return Math.max(0, MAX_PER_WEEK - usedThisWeek(exemptLog, wk));
}

/** Is today exempted? */
export function isTodayExempted(exemptLog, today = todayKey()) {
  if (!Array.isArray(exemptLog)) return false;
  return exemptLog.some(e => e && e.date === today);
}

/**
 * Request exempt for today. Returns { ok, error?, log?, wk? }.
 * Caller persists via persistExemptLog.
 */
export function requestExempt(exemptLog, reason = 'other', today = todayKey(), wk = weekKey()) {
  const list = Array.isArray(exemptLog) ? exemptLog : [];
  if (isTodayExempted(list, today)) {
    return { ok: false, error: 'already_exempted_today' };
  }
  if (usedThisWeek(list, wk) >= MAX_PER_WEEK) {
    return { ok: false, error: 'weekly_limit' };
  }
  const next = [...list, { date: today, week_key: wk, reason, at: new Date().toISOString() }];
  return { ok: true, log: next, wk };
}

/** Cancel today's exempt (undo). */
export function cancelTodayExempt(exemptLog, today = todayKey()) {
  if (!Array.isArray(exemptLog)) return { ok: false, log: [] };
  const next = exemptLog.filter(e => !(e && e.date === today));
  return { ok: true, log: next };
}

/** Persist to profiles.exempt_log. */
export async function persistExemptLog(sb, userId, exemptLog) {
  if (!sb || !userId) return { ok: false };
  try {
    const { error } = await sb.from('profiles').update({ exempt_log: exemptLog }).eq('id', userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export const EXEMPT_REASONS = [
  { id: 'dinner',  label: '회식' },
  { id: 'travel',  label: '여행' },
  { id: 'illness', label: '아픔' },
  { id: 'other',   label: '기타' },
];

/**
 * Apply exempt to cubes judgment — if today is exempted, force all cubes to gray.
 * Pure. Caller merges with actual cube compute.
 */
export function applyExemptToCubes(cubes, exemptLog, today = todayKey()) {
  if (!cubes) return cubes;
  if (!isTodayExempted(exemptLog, today)) return cubes;
  return {
    diet: 'gray',
    exercise: 'gray',
    routine: 'gray',
    tasks: 'gray',
    exercise_bonus: null,
    bonus: [],
  };
}
