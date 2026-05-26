// 큐록 · features/returner/tests.js
// Pure unit tests for Returner Grace 72h.
// 브라우저 콘솔: window.runReturnerTests()
// HTML runner: prototypes/_tests/run-all.html

import {
  isWithinGrace,
  computeActivation,
  applyGraceToCubes,
  bumpReturnStreak,
} from './grace.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// ───── isWithinGrace ─────────────────────────────────
t('isWithinGrace · null returnState → false',
  () => isWithinGrace(null) === false);
t('isWithinGrace · 빈 객체 → false',
  () => isWithinGrace({}) === false);
t('isWithinGrace · grace_until 없음 → false',
  () => isWithinGrace({ last_seen_at: '2026-05-26T00:00:00Z' }) === false);
t('isWithinGrace · grace_until 과거 → false',
  () => isWithinGrace({ grace_until: '2026-01-01T00:00:00Z' }, Date.now()) === false);
t('isWithinGrace · grace_until 미래 → true',
  () => isWithinGrace({ grace_until: '2030-01-01T00:00:00Z' }, Date.now()) === true);
t('isWithinGrace · grace_until 정확히 now → false (시간 t > now)',
  () => {
    const now = 1234567890000;
    return isWithinGrace({ grace_until: new Date(now).toISOString() }, now) === false;
  });
t('isWithinGrace · grace_until 이상한 문자열 → false',
  () => isWithinGrace({ grace_until: 'not-a-date' }) === false);

// ───── computeActivation ─────────────────────────────
t('computeActivation · 처음 로그인 (last_seen_at 없음) → grace 없음 + last_seen_at 세팅',
  () => {
    const now = '2026-05-26T10:00:00Z';
    const r = computeActivation(null, now);
    return r.last_seen_at === now
      && !r.grace_until
      && r.return_streak_count === 0
      && r.return_streak_start_date === null;
  });
t('computeActivation · 12시간 전 last_seen → grace 없음 (3일 미만)',
  () => {
    const now = Date.now();
    const last = new Date(now - 12 * HOUR).toISOString();
    const r = computeActivation({ last_seen_at: last }, new Date(now).toISOString());
    return !r.grace_until;
  });
t('computeActivation · 2.5일 전 → grace 없음 (임계값 미달)',
  () => {
    const now = Date.now();
    const last = new Date(now - 2.5 * DAY).toISOString();
    const r = computeActivation({ last_seen_at: last }, new Date(now).toISOString());
    return !r.grace_until;
  });
t('computeActivation · 정확히 3일 전 → grace 활성',
  () => {
    const now = Date.now();
    const last = new Date(now - 3 * DAY).toISOString();
    const r = computeActivation({ last_seen_at: last }, new Date(now).toISOString());
    return !!r.grace_until && r.return_streak_count === 0;
  });
t('computeActivation · 7일 전 → grace 활성 + grace_until 은 +72h',
  () => {
    const now = Date.now();
    const last = new Date(now - 7 * DAY).toISOString();
    const r = computeActivation({ last_seen_at: last }, new Date(now).toISOString());
    const until = new Date(r.grace_until).getTime();
    const expected = now + 72 * HOUR;
    return Math.abs(until - expected) < 1000; // 1초 오차 허용
  });
t('computeActivation · 30일 전 → grace 활성',
  () => {
    const now = Date.now();
    const last = new Date(now - 30 * DAY).toISOString();
    const r = computeActivation({ last_seen_at: last }, new Date(now).toISOString());
    return !!r.grace_until;
  });
t('computeActivation · return_streak_start_date 는 오늘 날짜',
  () => {
    const now = '2026-05-26T10:00:00Z';
    const last = '2026-05-22T10:00:00Z';
    const r = computeActivation({ last_seen_at: last }, now);
    return r.return_streak_start_date === '2026-05-26';
  });
t('computeActivation · 기존 grace 보존 (이전 state 의 다른 필드)',
  () => {
    const now = '2026-05-26T10:00:00Z';
    const last = '2026-05-22T10:00:00Z';
    const r = computeActivation({
      last_seen_at: last,
      grace_until: '2026-05-25T10:00:00Z', // 이미 만료된 이전 grace
      return_streak_count: 5,
    }, now);
    // 새 grace 활성 + last_seen_at 갱신
    return r.last_seen_at === now && !!r.grace_until;
  });

// ───── applyGraceToCubes ─────────────────────────────
t('applyGraceToCubes · null cubes → null',
  () => applyGraceToCubes(null, { grace_until: '2030-01-01T00:00:00Z' }) === null);
t('applyGraceToCubes · grace 비활성 → cubes 그대로',
  () => {
    const c = { diet: 'crimson', exercise: 'gold' };
    const r = applyGraceToCubes(c, null);
    return r === c;
  });
t('applyGraceToCubes · grace 활성 + crimson → gray 로 변환',
  () => {
    const c = { diet: 'crimson', exercise: 'gold', routine: 'crimson', tasks: 'silver' };
    const r = applyGraceToCubes(c, { grace_until: '2030-01-01T00:00:00Z' });
    return r.diet === 'gray' && r.routine === 'gray'
      && r.exercise === 'gold' && r.tasks === 'silver';
  });
t('applyGraceToCubes · 원본 cubes 는 mutate X (shallow clone)',
  () => {
    const c = { diet: 'crimson', exercise: 'gold' };
    applyGraceToCubes(c, { grace_until: '2030-01-01T00:00:00Z' });
    return c.diet === 'crimson'; // 원본 보존
  });
t('applyGraceToCubes · gold/silver 만 있으면 그대로',
  () => {
    const c = { diet: 'gold', exercise: 'silver', routine: 'gold', tasks: 'silver' };
    const r = applyGraceToCubes(c, { grace_until: '2030-01-01T00:00:00Z' });
    return JSON.stringify(r) === JSON.stringify(c);
  });

// ───── bumpReturnStreak ──────────────────────────────
t('bumpReturnStreak · null returnState → null',
  () => bumpReturnStreak(null, { diet: 'gold' }, '2026-05-26') === null);
t('bumpReturnStreak · grace 비활성 → 변화 없음',
  () => {
    const rs = { return_streak_count: 0 };
    const r = bumpReturnStreak(rs, { diet: 'gold' }, '2026-05-26');
    return r === rs;
  });
t('bumpReturnStreak · grace 활성 + cubes 없음 → 변화 없음',
  () => {
    const rs = { grace_until: '2030-01-01T00:00:00Z', return_streak_count: 0 };
    const r = bumpReturnStreak(rs, null, '2026-05-26');
    return r === rs;
  });
t('bumpReturnStreak · grace 활성 + gold 1개 있음 → +1',
  () => {
    const rs = { grace_until: '2030-01-01T00:00:00Z', return_streak_count: 0 };
    const r = bumpReturnStreak(rs, { diet: 'gold', exercise: 'gray' }, '2026-05-26');
    return r.return_streak_count === 1 && r.return_streak_last_date === '2026-05-26';
  });
t('bumpReturnStreak · grace 활성 + silver 1개 → +1',
  () => {
    const rs = { grace_until: '2030-01-01T00:00:00Z', return_streak_count: 2 };
    const r = bumpReturnStreak(rs, { routine: 'silver' }, '2026-05-26');
    return r.return_streak_count === 3;
  });
t('bumpReturnStreak · grace 활성 + crimson/gray 만 → 변화 없음',
  () => {
    const rs = { grace_until: '2030-01-01T00:00:00Z', return_streak_count: 0 };
    const r = bumpReturnStreak(rs, { diet: 'crimson', exercise: 'gray' }, '2026-05-26');
    return r === rs;
  });
t('bumpReturnStreak · 같은 날 이미 counted → 변화 없음 (중복 방지)',
  () => {
    const rs = {
      grace_until: '2030-01-01T00:00:00Z',
      return_streak_count: 5,
      return_streak_last_date: '2026-05-26'
    };
    const r = bumpReturnStreak(rs, { diet: 'gold' }, '2026-05-26');
    return r === rs;
  });
t('bumpReturnStreak · 다른 날 → +1',
  () => {
    const rs = {
      grace_until: '2030-01-01T00:00:00Z',
      return_streak_count: 5,
      return_streak_last_date: '2026-05-25'
    };
    const r = bumpReturnStreak(rs, { diet: 'gold' }, '2026-05-26');
    return r.return_streak_count === 6;
  });

// ───── Runner ────────────────────────────────────────
export function runReturnerTests() {
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
  console.log('[returner-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runReturnerTests = runReturnerTests;
}
