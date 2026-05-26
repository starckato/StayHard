// 큐록 · src/features/notif/opt-in-scheduler.tests.js
// shouldRequestD3 / shouldRequestD7Recovery pure 로직 테스트.

import {
  shouldRequestD3,
  shouldRequestD7Recovery,
} from './opt-in-scheduler.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ───── shouldRequestD3 ───────────────────────────────
t('shouldRequestD3 · null profile → false',
  () => shouldRequestD3(null, 5) === false);
t('shouldRequestD3 · streak 0 → false',
  () => shouldRequestD3({}, 0) === false);
t('shouldRequestD3 · streak 2 (<3) → false',
  () => shouldRequestD3({}, 2) === false);
t('shouldRequestD3 · streak 3 + history 없음 → true',
  () => shouldRequestD3({}, 3) === true);
t('shouldRequestD3 · streak 3 + history null → true',
  () => shouldRequestD3({ notif_opt_in_history: null }, 3) === true);
t('shouldRequestD3 · streak 7 + 이전 d3 요청 있음 → false (중복 방지)',
  () => shouldRequestD3({
    notif_opt_in_history: [{ trigger: 'd3_streak', result: 'denied', at: '2026-05-20T00:00:00Z' }]
  }, 7) === false);
t('shouldRequestD3 · 이전 granted 있음 → false',
  () => shouldRequestD3({
    notif_opt_in_history: [{ trigger: 'onboarding', result: 'granted', at: '2026-05-20T00:00:00Z' }]
  }, 5) === false);
t('shouldRequestD3 · streak 큰 값 (100) + 깨끗한 history → true',
  () => shouldRequestD3({ notif_opt_in_history: [] }, 100) === true);
t('shouldRequestD3 · onboarding 시도 only (d3 아직 X) → true',
  () => shouldRequestD3({
    notif_opt_in_history: [{ trigger: 'onboarding', result: 'denied', at: '2026-05-20T00:00:00Z' }]
  }, 5) === true);

// ───── shouldRequestD7Recovery ───────────────────────
t('shouldRequestD7Recovery · null profile → false',
  () => shouldRequestD7Recovery(null) === false);
t('shouldRequestD7Recovery · 빈 history → false',
  () => shouldRequestD7Recovery({ notif_opt_in_history: [] }) === false);
t('shouldRequestD7Recovery · history null → false',
  () => shouldRequestD7Recovery({}) === false);
t('shouldRequestD7Recovery · granted 한 적 있음 → false',
  () => {
    const oldAt = new Date(Date.now() - 30 * DAY).toISOString();
    return shouldRequestD7Recovery({
      notif_opt_in_history: [
        { trigger: 'd3_streak', result: 'denied', at: oldAt },
        { trigger: 'returner', result: 'granted', at: oldAt },
      ]
    }) === false;
  });
t('shouldRequestD7Recovery · d7 이미 시도 → false',
  () => {
    const oldAt = new Date(Date.now() - 30 * DAY).toISOString();
    return shouldRequestD7Recovery({
      notif_opt_in_history: [
        { trigger: 'd3_streak', result: 'denied', at: oldAt },
        { trigger: 'd7_recovery', result: 'denied', at: oldAt },
      ]
    }) === false;
  });
t('shouldRequestD7Recovery · 거절 후 168h 미만 → false',
  () => {
    const recent = new Date(Date.now() - 3 * DAY).toISOString(); // 72h 전
    return shouldRequestD7Recovery({
      notif_opt_in_history: [
        { trigger: 'd3_streak', result: 'denied', at: recent },
      ]
    }) === false;
  });
t('shouldRequestD7Recovery · 거절 후 168h 경과 → true',
  () => {
    const old = new Date(Date.now() - 8 * DAY).toISOString();
    return shouldRequestD7Recovery({
      notif_opt_in_history: [
        { trigger: 'd3_streak', result: 'denied', at: old },
      ]
    }) === true;
  });
t('shouldRequestD7Recovery · dismissed 도 거절로 인정',
  () => {
    const old = new Date(Date.now() - 10 * DAY).toISOString();
    return shouldRequestD7Recovery({
      notif_opt_in_history: [
        { trigger: 'd3_streak', result: 'dismissed', at: old },
      ]
    }) === true;
  });
t('shouldRequestD7Recovery · 마지막 거절 기준 (여러 거절 중 최신만)',
  () => {
    const long = new Date(Date.now() - 30 * DAY).toISOString();
    const recent = new Date(Date.now() - 3 * DAY).toISOString();
    // 두 번째 거절이 3일 전 → 168h 미달
    return shouldRequestD7Recovery({
      notif_opt_in_history: [
        { trigger: 'onboarding', result: 'denied', at: long },
        { trigger: 'd3_streak', result: 'denied', at: recent },
      ]
    }) === false;
  });
t('shouldRequestD7Recovery · at 없음 → false (안전 fallback)',
  () => shouldRequestD7Recovery({
    notif_opt_in_history: [{ trigger: 'd3_streak', result: 'denied' }]
  }) === false);

// ───── Runner ────────────────────────────────────────
export function runOptInTests() {
  let pass = 0, fail = 0;
  const fails = [];
  for (const c of _cases) {
    try {
      const ok = c.fn();
      if (ok) pass++;
      else { fail++; fails.push(c.name); }
    } catch (e) {
      fail++;
      fails.push(c.name + ' [THROW: ' + (e && e.message) + ']');
    }
  }
  console.log('[opt-in-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runOptInTests = runOptInTests;
}
