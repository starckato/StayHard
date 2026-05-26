// 큐록 · src/features/metrics/tests.js
// EVT 상수 정합성 — key 중복·오타·forbidden char 검증.

import { EVT } from './events.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

// ───── EVT 데이터 정합성 ─────────────────────────────
t('EVT · 객체 (typeof object)',
  () => typeof EVT === 'object' && EVT !== null);
t('EVT · 최소 10 key 이상',
  () => Object.keys(EVT).length >= 10);
t('EVT · 모든 value 는 문자열',
  () => Object.values(EVT).every(v => typeof v === 'string' && v.length > 0));
t('EVT · 모든 value 는 snake_case (소문자 + underscore)',
  () => Object.values(EVT).every(v => /^[a-z][a-z0-9_]*$/.test(v)));
t('EVT · value 중복 없음 (각 이벤트 key 는 unique 해야 함)',
  () => new Set(Object.values(EVT)).size === Object.keys(EVT).length);
t('EVT · 핵심 acquisition 이벤트 존재',
  () => EVT.ONBOARDING_STARTED && EVT.ONBOARDING_COMPLETED && EVT.FIRST_CUBE_EARNED);
t('EVT · 알림 opt-in 이벤트',
  () => EVT.OPT_IN_REQUESTED_D3 && EVT.OPT_IN_RESULT);
t('EVT · Retention 이벤트 (Returner / Exempt)',
  () => EVT.RETURNER_GRACE_ACTIVATED && EVT.EXEMPT_USED);
t('EVT · Engagement 이벤트',
  () => EVT.STATUS_BAND_DWELL && EVT.TAB_VISIT);
t('EVT · FIRST_CUBE_EARNED = "first_cube_earned"',
  () => EVT.FIRST_CUBE_EARNED === 'first_cube_earned');

// ───── Runner ────────────────────────────────────────
export function runMetricsTests() {
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
  console.log('[metrics-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runMetricsTests = runMetricsTests;
}
