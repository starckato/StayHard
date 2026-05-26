// 큐록 · features/exempt/tests.js
// Pure unit tests for Exempt 1-tap (회식·여행·아픔 면제).
// 브라우저 콘솔: window.runExemptTests()

import {
  weekKey,
  todayKey,
  usedThisWeek,
  remainingThisWeek,
  isTodayExempted,
  requestExempt,
  cancelTodayExempt,
  applyExemptToCubes,
  EXEMPT_REASONS,
} from './index.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

// ───── weekKey ───────────────────────────────────────
t('weekKey · format YYYY-WNN',
  () => /^\d{4}-W\d{2}$/.test(weekKey(new Date('2026-05-26'))));
t('weekKey · 같은 주 = 같은 키 (월~일)',
  () => weekKey(new Date('2026-05-25')) === weekKey(new Date('2026-05-31'))); // 2026 May 25 = Mon, 31 = Sun
t('weekKey · 다음 주 = 다른 키',
  () => weekKey(new Date('2026-05-25')) !== weekKey(new Date('2026-06-01')));
t('weekKey · 일요일 vs 다음 월요일 경계',
  () => weekKey(new Date('2026-05-31')) !== weekKey(new Date('2026-06-01')));

// ───── todayKey ──────────────────────────────────────
t('todayKey · format YYYY-MM-DD',
  () => /^\d{4}-\d{2}-\d{2}$/.test(todayKey(new Date('2026-05-26'))));
t('todayKey · padding 적용 (한 자리 월/일)',
  () => todayKey(new Date('2026-01-05T10:00:00')) === '2026-01-05');

// ───── usedThisWeek ──────────────────────────────────
t('usedThisWeek · 빈 로그 → 0',
  () => usedThisWeek([]) === 0);
t('usedThisWeek · null 로그 → 0',
  () => usedThisWeek(null) === 0);
t('usedThisWeek · undefined → 0',
  () => usedThisWeek(undefined) === 0);
t('usedThisWeek · 이번주 1건 → 1',
  () => {
    const wk = weekKey();
    return usedThisWeek([{ week_key: wk, date: todayKey() }]) === 1;
  });
t('usedThisWeek · 다른 주 1건 → 0',
  () => usedThisWeek([{ week_key: '2024-W01', date: '2024-01-01' }]) === 0);
t('usedThisWeek · 같은 주 2건 → 2',
  () => {
    const wk = weekKey();
    return usedThisWeek([
      { week_key: wk, date: '2026-05-26' },
      { week_key: wk, date: '2026-05-28' },
    ]) === 2;
  });

// ───── remainingThisWeek ─────────────────────────────
t('remainingThisWeek · 0 사용 → 2 남음',
  () => remainingThisWeek([]) === 2);
t('remainingThisWeek · 1 사용 → 1 남음',
  () => {
    const wk = weekKey();
    return remainingThisWeek([{ week_key: wk, date: todayKey() }]) === 1;
  });
t('remainingThisWeek · 2 사용 → 0 남음',
  () => {
    const wk = weekKey();
    return remainingThisWeek([
      { week_key: wk, date: '2026-05-26' },
      { week_key: wk, date: '2026-05-28' },
    ]) === 0;
  });
t('remainingThisWeek · 3 사용 (overflow) → 0 남음 (음수 X)',
  () => {
    const wk = weekKey();
    return remainingThisWeek([
      { week_key: wk, date: '2026-05-25' },
      { week_key: wk, date: '2026-05-26' },
      { week_key: wk, date: '2026-05-28' },
    ]) === 0;
  });

// ───── isTodayExempted ───────────────────────────────
t('isTodayExempted · 빈 로그 → false',
  () => isTodayExempted([]) === false);
t('isTodayExempted · null 로그 → false',
  () => isTodayExempted(null) === false);
t('isTodayExempted · 오늘 entry 있음 → true',
  () => isTodayExempted([{ date: todayKey(), week_key: weekKey() }]) === true);
t('isTodayExempted · 어제 entry → false',
  () => isTodayExempted([{ date: '2024-01-01', week_key: '2024-W01' }]) === false);
t('isTodayExempted · 명시적 today 인자 사용',
  () => isTodayExempted([{ date: '2026-05-26', week_key: '2026-W22' }], '2026-05-26') === true);

// ───── requestExempt ─────────────────────────────────
t('requestExempt · 빈 로그 → ok, log 1개 추가',
  () => {
    const r = requestExempt([], 'dinner', '2026-05-26', '2026-W22');
    return r.ok === true && r.log.length === 1
      && r.log[0].date === '2026-05-26'
      && r.log[0].reason === 'dinner';
  });
t('requestExempt · 기본 reason = "other"',
  () => {
    const r = requestExempt([], undefined, '2026-05-26', '2026-W22');
    return r.log[0].reason === 'other';
  });
t('requestExempt · 이미 오늘 면제 사용 → error already_exempted_today',
  () => {
    const r = requestExempt(
      [{ date: '2026-05-26', week_key: '2026-W22', reason: 'dinner' }],
      'travel',
      '2026-05-26',
      '2026-W22'
    );
    return r.ok === false && r.error === 'already_exempted_today';
  });
t('requestExempt · 주 2회 사용 후 다른 날 → error weekly_limit',
  () => {
    const log = [
      { date: '2026-05-25', week_key: '2026-W22', reason: 'illness' },
      { date: '2026-05-26', week_key: '2026-W22', reason: 'dinner' },
    ];
    const r = requestExempt(log, 'travel', '2026-05-28', '2026-W22');
    return r.ok === false && r.error === 'weekly_limit';
  });
t('requestExempt · 지난 주 2회 + 이번 주 0 → 이번 주 가능',
  () => {
    const log = [
      { date: '2026-05-18', week_key: '2026-W21', reason: 'travel' },
      { date: '2026-05-20', week_key: '2026-W21', reason: 'dinner' },
    ];
    const r = requestExempt(log, 'illness', '2026-05-25', '2026-W22');
    return r.ok === true && r.log.length === 3;
  });
t('requestExempt · ISO timestamp 포함',
  () => {
    const r = requestExempt([], 'dinner', '2026-05-26', '2026-W22');
    return typeof r.log[0].at === 'string' && r.log[0].at.includes('T');
  });

// ───── cancelTodayExempt ─────────────────────────────
t('cancelTodayExempt · 오늘 entry 제거',
  () => {
    const log = [
      { date: '2026-05-25', week_key: '2026-W22', reason: 'travel' },
      { date: '2026-05-26', week_key: '2026-W22', reason: 'dinner' },
    ];
    const r = cancelTodayExempt(log, '2026-05-26');
    return r.ok === true && r.log.length === 1
      && r.log[0].date === '2026-05-25';
  });
t('cancelTodayExempt · null 로그 → 빈 배열 반환',
  () => {
    const r = cancelTodayExempt(null);
    return r.ok === false && r.log.length === 0;
  });
t('cancelTodayExempt · 오늘 entry 없음 → 변화 없음',
  () => {
    const log = [{ date: '2026-05-25', week_key: '2026-W22', reason: 'travel' }];
    const r = cancelTodayExempt(log, '2026-05-26');
    return r.ok === true && r.log.length === 1;
  });

// ───── applyExemptToCubes ────────────────────────────
t('applyExemptToCubes · null cubes → null',
  () => applyExemptToCubes(null, [{ date: '2026-05-26', week_key: '2026-W22' }], '2026-05-26') === null);
t('applyExemptToCubes · 면제 안 됨 → 그대로',
  () => {
    const c = { diet: 'crimson', exercise: 'gold' };
    const r = applyExemptToCubes(c, [], '2026-05-26');
    return r === c;
  });
t('applyExemptToCubes · 오늘 면제 → 전 축 gray',
  () => {
    const c = { diet: 'crimson', exercise: 'gold', routine: 'silver', tasks: 'crimson' };
    const log = [{ date: '2026-05-26', week_key: '2026-W22' }];
    const r = applyExemptToCubes(c, log, '2026-05-26');
    return r.diet === 'gray' && r.exercise === 'gray'
      && r.routine === 'gray' && r.tasks === 'gray';
  });
t('applyExemptToCubes · 면제 후 bonus 비움',
  () => {
    const c = { diet: 'gold', bonus: [{ type: 'pr' }] };
    const log = [{ date: '2026-05-26', week_key: '2026-W22' }];
    const r = applyExemptToCubes(c, log, '2026-05-26');
    return Array.isArray(r.bonus) && r.bonus.length === 0;
  });
t('applyExemptToCubes · 면제 후 exercise_bonus null',
  () => {
    const c = { exercise: 'gold', exercise_bonus: 'gold' };
    const log = [{ date: '2026-05-26', week_key: '2026-W22' }];
    const r = applyExemptToCubes(c, log, '2026-05-26');
    return r.exercise_bonus === null;
  });

// ───── EXEMPT_REASONS 데이터 정합성 ───────────────────
t('EXEMPT_REASONS · 4종 (dinner/travel/illness/other)',
  () => EXEMPT_REASONS.length === 4);
t('EXEMPT_REASONS · 각 항목에 id + label',
  () => EXEMPT_REASONS.every(r => r.id && r.label));
t('EXEMPT_REASONS · id 모두 unique',
  () => new Set(EXEMPT_REASONS.map(r => r.id)).size === EXEMPT_REASONS.length);

// ───── Runner ────────────────────────────────────────
export function runExemptTests() {
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
  console.log('[exempt-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runExemptTests = runExemptTests;
}
