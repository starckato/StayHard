// 큐록 · Notification opt-in 2차/3차 요청 스케줄러 (D3 + D7 soft denial recovery)
//
// 첫 스트릭 3일 달성 모먼트에 알림 opt-in 을 묻는다 (D3 trigger, 1회).
// D3 에서 거절(denied/dismissed) 한 사용자는 D7+ 에 한 번 더 묻는다 (D7 trigger, 1회).
// granted 한 번이라도 받으면 재요청 종료.
//
// SERVICE_EVALUATION §6 B7. + 2026-04-26 UX P1 — soft denial recovery vector.

import { logEvent, EVT } from '../metrics/index.js';

const D7_RECOVERY_HOURS = 7 * 24; // 168h

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

/**
 * Determine whether to request D7 soft-denial recovery opt-in.
 *
 * 조건:
 *   - 이전에 'd3_streak' 요청에서 denied/dismissed 결과 있음
 *   - 그 이후 7 일 (168 시간) 경과
 *   - granted 한 번도 없음
 *   - D7 trigger 아직 시도 안 함
 *
 * @param {Object} profile
 * @returns {boolean}
 */
export function shouldRequestD7Recovery(profile) {
  if (!profile) return false;
  const history = Array.isArray(profile.notif_opt_in_history) ? profile.notif_opt_in_history : [];
  if (history.some(h => h && h.result === 'granted')) return false;
  if (history.some(h => h && h.trigger === 'd7_recovery')) return false;
  // 마지막 거절 시점 찾기
  const denials = history.filter(h => h && (h.result === 'denied' || h.result === 'dismissed'));
  if (denials.length === 0) return false;
  const lastAt = denials[denials.length - 1].at;
  if (!lastAt) return false;
  const elapsedH = (Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60);
  return elapsedH >= D7_RECOVERY_HOURS;
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
