// 큐록 · Returner Grace 72h
//
// 복귀자 보호구간: 3일+ 비접속 후 복귀 시 72시간 동안 crimson → gray 다운그레이드.
// 저장된 `daily_logs.cubes` 원본은 변경하지 않고, 표시 레이어에서 postprocess.
// 기존 streak 은 끊긴 상태 유지, return_streak 별도 카운터.
//
// 순수 함수 — DOM/sb 의존성 없음 (applyGraceToCubes, isWithinGrace, computeReturnStreak).
// 서버 상태 변경은 activate() 함수에서만.
//
// SERVICE_EVALUATION §6 B4, DEV_REBRAND_SCOPE §5.

const GRACE_HOURS = 72;
const INACTIVE_THRESHOLD_DAYS = 3;

/**
 * @typedef {Object} ReturnState
 * @property {string|null} last_seen_at      ISO
 * @property {string|null} grace_until       ISO
 * @property {number}      return_streak_count
 * @property {string|null} return_streak_start_date  YYYY-MM-DD
 */

/** Whether `now` is within the grace window. */
export function isWithinGrace(returnState, now = Date.now()) {
  if (!returnState || !returnState.grace_until) return false;
  const t = new Date(returnState.grace_until).getTime();
  return !isNaN(t) && t > now;
}

/**
 * Compute new return_state when user opens the app.
 * Triggered if last_seen_at gap >= 3 days.
 * Returns null if no change (inactive gap too short OR already in grace).
 */
export function computeActivation(returnState, nowIso = new Date().toISOString()) {
  const now = new Date(nowIso).getTime();
  const last = returnState && returnState.last_seen_at ? new Date(returnState.last_seen_at).getTime() : 0;
  // Always touch last_seen_at
  const baseUpdate = { ...(returnState || {}), last_seen_at: nowIso };
  if (!last) {
    // First ever login — no grace.
    return { ...baseUpdate, return_streak_count: 0, return_streak_start_date: null };
  }
  const gapMs = now - last;
  const gapDays = gapMs / (1000 * 60 * 60 * 24);
  if (gapDays < INACTIVE_THRESHOLD_DAYS) {
    return baseUpdate; // Normal update
  }
  // Activate grace.
  const graceUntil = new Date(now + GRACE_HOURS * 60 * 60 * 1000).toISOString();
  const today = nowIso.slice(0, 10);
  return {
    ...baseUpdate,
    grace_until: graceUntil,
    return_streak_count: 0,
    return_streak_start_date: today,
  };
}

/**
 * Postprocess cubes for display: within grace, crimson → gray.
 * Does NOT modify original. Returns shallow-cloned object.
 */
export function applyGraceToCubes(cubes, returnState, now = Date.now()) {
  if (!cubes) return cubes;
  if (!isWithinGrace(returnState, now)) return cubes;
  const out = { ...cubes };
  ['diet', 'exercise', 'routine', 'tasks'].forEach(k => {
    if (out[k] === 'crimson') out[k] = 'gray';
  });
  return out;
}

/**
 * Bump return_streak if today has at least one gold/silver across cubes.
 * Pure. Caller persists.
 */
export function bumpReturnStreak(returnState, cubes, todayDate) {
  if (!returnState || !isWithinGrace(returnState)) return returnState;
  if (!cubes) return returnState;
  const hasWin = ['diet', 'exercise', 'routine', 'tasks'].some(k =>
    cubes[k] === 'gold' || cubes[k] === 'silver'
  );
  if (!hasWin) return returnState;
  const last = returnState.return_streak_last_date;
  if (last === todayDate) return returnState; // already counted
  return {
    ...returnState,
    return_streak_count: (returnState.return_streak_count || 0) + 1,
    return_streak_last_date: todayDate,
  };
}

/** Persist updated return_state to profiles. */
export async function persist(sb, userId, returnState) {
  if (!sb || !userId) return { ok: false };
  try {
    const { error } = await sb.from('profiles').update({ return_state: returnState }).eq('id', userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
