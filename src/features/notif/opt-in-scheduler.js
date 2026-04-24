// 큐록 · Notification opt-in 2차 요청 스케줄러 (D3)
//
// 첫 스트릭 3일 달성 모먼트에 알림 opt-in 을 다시 한번 묻는다. 1회만.
// profiles.notif_opt_in_history 에 기록하여 중복 요청 방지.
//
// SERVICE_EVALUATION §6 B7.

import { logEvent, EVT } from '../metrics/index.js';

/**
 * Determine whether to request D3 opt-in.
 *
 * @param {Object} profile — profiles row (needs notif_opt_in_history)
 * @param {number} currentStreak
 * @returns {boolean}
 */
export function shouldRequestD3(profile, currentStreak) {
  if (!profile) return false;
  if (!currentStreak || currentStreak < 3) return false;
  const history = Array.isArray(profile.notif_opt_in_history) ? profile.notif_opt_in_history : [];
  // D3 를 이전에 요청한 적 있는지
  if (history.some(h => h && h.trigger === 'd3_streak')) return false;
  // 현재 'granted' 상태면 재요청 불필요
  if (history.some(h => h && h.result === 'granted')) return false;
  return true;
}

/** Record an opt-in request attempt + result. */
export async function recordOptIn(sb, userId, profile, trigger /* 'onboarding'|'d3_streak'|'returner' */, result /* 'granted'|'denied'|'dismissed' */) {
  if (!sb || !userId) return { ok: false };
  try {
    const existing = Array.isArray(profile?.notif_opt_in_history) ? profile.notif_opt_in_history : [];
    const next = [...existing, { trigger, result, at: new Date().toISOString() }];
    const { error } = await sb.from('profiles').update({ notif_opt_in_history: next }).eq('id', userId);
    if (error) return { ok: false, error: error.message };
    if (profile) profile.notif_opt_in_history = next;
    try {
      const evKey = trigger === 'd3_streak' ? EVT.OPT_IN_REQUESTED_D3 : EVT.OPT_IN_REQUESTED_ONBOARDING;
      logEvent(evKey, { result });
      logEvent(EVT.OPT_IN_RESULT, { trigger, result });
    } catch {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
