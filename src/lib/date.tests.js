// 큐록 · src/lib/date.tests.js
// dkey / normKey 테스트.

import { dkey, normKey } from './date.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

// ───── dkey ──────────────────────────────────────────
t('dkey · format YYYY-MM-DD',
  () => /^\d{4}-\d{2}-\d{2}$/.test(dkey(new Date('2026-05-26'))));
t('dkey · padding 한 자리 월',
  () => dkey(new Date(2026, 0, 5)) === '2026-01-05');
t('dkey · padding 한 자리 일',
  () => dkey(new Date(2026, 11, 1)) === '2026-12-01');
t('dkey · 윤년 2월 29일',
  () => dkey(new Date(2024, 1, 29)) === '2024-02-29');
t('dkey · 같은 날짜 시간 다르면 같은 키',
  () => dkey(new Date('2026-05-26T00:00:00')) === dkey(new Date('2026-05-26T23:59:59')));

// ───── normKey ───────────────────────────────────────
t('normKey · 정상 ISO date',
  () => normKey('2026-05-26T10:30:00Z') === '2026-05-26');
t('normKey · 이미 YYYY-MM-DD',
  () => normKey('2026-05-26') === '2026-05-26');
t('normKey · 더 짧은 문자열',
  () => normKey('2026-05') === '2026-05');
t('normKey · null → null',
  () => normKey(null) === null);
t('normKey · undefined → null',
  () => normKey(undefined) === null);
t('normKey · 빈 문자열 → null',
  () => normKey('') === null);

// ───── Runner ────────────────────────────────────────
export function runDateTests() {
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
  console.log('[date-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runDateTests = runDateTests;
}
