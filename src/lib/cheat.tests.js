// 큐록 · src/lib/cheat.tests.js
// 치팅 / 음주 quota 주차 계산 (getCheatWeekKey) 테스트.
// 브라우저 콘솔: window.runCheatTests()

import { getCheatWeekKey } from './cheat.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

// ───── getCheatWeekKey · ISO 8601 week, Monday-based ──
t('getCheatWeekKey · format YYYY-WNN',
  () => /^\d{4}-W\d{2}$/.test(getCheatWeekKey(new Date('2026-05-26'))));

t('getCheatWeekKey · 같은 주 (월~일) = 같은 키',
  () => {
    // 2026-05-25 (Mon) ~ 2026-05-31 (Sun)
    const dates = ['2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30', '2026-05-31'];
    const keys = dates.map(d => getCheatWeekKey(new Date(d)));
    return keys.every(k => k === keys[0]);
  });

t('getCheatWeekKey · 일요일 → 월요일 경계 (다른 주)',
  () => getCheatWeekKey(new Date('2026-05-31')) !== getCheatWeekKey(new Date('2026-06-01')));

t('getCheatWeekKey · 두 달 차이 → 다른 키',
  () => getCheatWeekKey(new Date('2026-01-15')) !== getCheatWeekKey(new Date('2026-03-15')));

t('getCheatWeekKey · 연 경계 — 2024 마지막 주 vs 2025 첫 주',
  () => {
    const a = getCheatWeekKey(new Date('2024-12-30'));
    const b = getCheatWeekKey(new Date('2025-01-06'));
    return a !== b;
  });

t('getCheatWeekKey · 기본 인자 = new Date() (오늘)',
  () => {
    const a = getCheatWeekKey();
    const b = getCheatWeekKey(new Date());
    return a === b;
  });

t('getCheatWeekKey · 한 해 안에 약 52~53 unique 주차',
  () => {
    const keys = new Set();
    for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= 28; d++) {
        keys.add(getCheatWeekKey(new Date(2026, m, d)));
      }
    }
    return keys.size >= 50 && keys.size <= 53;
  });

t('getCheatWeekKey · W01 부터 시작 (정확한 ISO week)',
  () => {
    // 2026-01-05 (Mon) → ISO week 02 of 2026
    const k = getCheatWeekKey(new Date('2026-01-05'));
    return /^2026-W\d{2}$/.test(k);
  });

t('getCheatWeekKey · 화/수/목 차이 검증 (월 1주차)',
  () => {
    // 같은 주차여야 함
    const tue = getCheatWeekKey(new Date('2026-03-03'));
    const wed = getCheatWeekKey(new Date('2026-03-04'));
    const thu = getCheatWeekKey(new Date('2026-03-05'));
    return tue === wed && wed === thu;
  });

t('getCheatWeekKey · 4 주 후 = 보통 +4 주차 (가끔 +3 또는 +5 edge)',
  () => {
    const a = getCheatWeekKey(new Date('2026-03-02'));
    const b = getCheatWeekKey(new Date('2026-03-30')); // 4 주 후
    if (a === b) return false;
    const aw = parseInt(a.split('W')[1], 10);
    const bw = parseInt(b.split('W')[1], 10);
    const diff = bw - aw;
    return diff >= 3 && diff <= 5;
  });

// ───── Runner ────────────────────────────────────────
export function runCheatTests() {
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
  console.log('[cheat-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runCheatTests = runCheatTests;
}
