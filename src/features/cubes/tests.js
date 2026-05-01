// Will Cube Phase 1 — 콘솔 테스트 케이스.
// 브라우저 콘솔에서 수동 실행:
//   import('/dist/app.js').then(()=>window.runCubeTests())
// 혹은 node 로 직접: node --experimental-vm-modules src/features/cubes/tests.js
//
// 각 케이스는 입력 log + 기대값 → 판정 함수 결과 비교.

import {
  judgeDiet,
  judgeExercise,
  judgeRoutine,
  judgeTasks,
  judgeCubes,
  judgeAccumulator,
  scoreFromCubes,
  detectPRs,
  detectStreakMilestones,
} from './index.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

// ── 식단 ─────────────────────────────────────────────
t('diet · 기록 0건 → gray', () => judgeDiet([]) === 'gray');
t('diet · 주류 1건 → crimson', () => judgeDiet([{ type: 'normal', category: 'alcohol' }]) === 'crimson');
t('diet · red 1건 → crimson', () => judgeDiet([{ type: 'red', category: 'snack' }, { type: 'green', category: 'lunch' }]) === 'crimson');
t('diet · 1끼 클린(green) → gold (2026-04-26 룰)', () => judgeDiet([
  { type: 'green', category: 'breakfast' },
]) === 'gold');
t('diet · 1끼 일반 → silver (2026-04-26 룰: 기록 즉시 silver 보장)', () => judgeDiet([
  { type: 'normal', category: 'breakfast' },
]) === 'silver');
t('diet · 1끼 red → crimson (즉시 패널티)', () => judgeDiet([
  { type: 'red', category: 'dinner' },
]) === 'crimson');
t('diet · green 2개 → gold', () => judgeDiet([
  { type: 'green', category: 'breakfast' },
  { type: 'green', category: 'lunch' },
]) === 'gold');
t('diet · green 2 + normal 1 → gold', () => judgeDiet([
  { type: 'green', category: 'breakfast' },
  { type: 'green', category: 'lunch' },
  { type: 'normal', category: 'dinner' },
]) === 'gold');
t('diet · green 1 + normal 1 → gold (2026-05-01: 클린 1개라도 gold)', () => judgeDiet([
  { type: 'green', category: 'breakfast' },
  { type: 'normal', category: 'lunch' },
]) === 'gold');
t('diet · 전부 normal 2끼 → silver', () => judgeDiet([
  { type: 'normal', category: 'breakfast' },
  { type: 'normal', category: 'lunch' },
]) === 'silver');
t('diet · green 1 + red 1 → crimson (red 우선)', () => judgeDiet([
  { type: 'green', category: 'breakfast' },
  { type: 'red', category: 'dinner' },
]) === 'crimson');
t('diet · drink(물)만 있음 → gray', () => judgeDiet([{ type: 'normal', category: 'drink' }]) === 'gray');

// ── 운동 ─────────────────────────────────────────────
t('ex · 아무것도 없음 → gray', () => {
  const r = judgeExercise([]);
  return r.exercise === 'gray' && r.exercise_bonus == null;
});
t('ex · 헬스만 → gold, bonus null', () => {
  const r = judgeExercise([{ type: 'gym', status: 'done' }]);
  return r.exercise === 'gold' && r.exercise_bonus == null;
});
t('ex · 유산소만 → gold, bonus null', () => {
  const r = judgeExercise([{ type: 'activity', status: 'done' }]);
  return r.exercise === 'gold' && r.exercise_bonus == null;
});
t('ex · 둘 다 → gold + gold bonus', () => {
  const r = judgeExercise([
    { type: 'gym', status: 'done' },
    { type: 'activity', status: 'done' },
  ]);
  return r.exercise === 'gold' && r.exercise_bonus === 'gold';
});
t('ex · planned 만 있음 (done 아님) → gray', () => {
  const r = judgeExercise([{ type: 'gym', status: 'planned' }]);
  return r.exercise === 'gray';
});

// ── 루틴 ─────────────────────────────────────────────
t('routine · 등록 0개 → gray', () => judgeRoutine([], 3) === 'gray');
t('routine · 실패 1개 → crimson', () => judgeRoutine([
  { done: true, fail: false }, { done: false, fail: true },
], 3) === 'crimson');
t('routine · 모두 done → gold', () => judgeRoutine([
  { done: true, fail: false }, { done: true, fail: false },
], 3) === 'gold');
t('routine · 일부 done 나머지 미기록 → silver', () => judgeRoutine([
  { done: true, fail: false }, { done: false, fail: false },
], 3) === 'silver');
t('routine · 전부 미기록 → gray', () => judgeRoutine([
  { done: false, fail: false }, { done: false, fail: false },
], 3) === 'gray');
t('routine · 오늘 요일 아닌 루틴만 있음 → gray', () => judgeRoutine([
  { done: false, fail: false, days: [0, 6] }, // 주말만
], 3) === 'gray');

// ── 할일 ─────────────────────────────────────────────
t('tasks · 등록 0건 → null', () => judgeTasks([]) === null);
t('tasks · _meta 만 있음 → null', () => judgeTasks([{ _meta: true }]) === null);
t('tasks · 실패 1개 → crimson', () => judgeTasks([
  { text: 'a', st: 'done' }, { text: 'b', st: 'fail' },
]) === 'crimson');
t('tasks · 모두 done → gold', () => judgeTasks([
  { text: 'a', st: 'done' }, { text: 'b', st: 'done' },
]) === 'gold');
t('tasks · 일부 done → silver', () => judgeTasks([
  { text: 'a', st: 'done' }, { text: 'b', st: '' },
]) === 'silver');
t('tasks · 전부 미완료 (실패 없음) → gray (등록만)', () => judgeTasks([
  { text: 'a', st: '' }, { text: 'b', st: '' },
]) === 'gray');

// ── 점수 환산 ────────────────────────────────────────
t('score · gold 4개 = +12', () => scoreFromCubes({
  diet: 'gold', exercise: 'gold', exercise_bonus: null, routine: 'gold', tasks: 'gold', bonus: [],
}) === 12);
t('score · gold 4 + exercise_bonus gold + PR bonus 1 = 15+6 = 21', () => scoreFromCubes({
  diet: 'gold', exercise: 'gold', exercise_bonus: 'gold', routine: 'gold', tasks: 'gold',
  bonus: [{ type: 'pr', color: 'gold', count: 2 }],
}) === 3 + 3 + 3 + 3 + 3 + 6);
t('score · crimson 1 + gray 2 = −5 (2026-05-01 점수 변경)', () => scoreFromCubes({
  diet: 'crimson', exercise: 'gray', exercise_bonus: null, routine: 'gray', tasks: null, bonus: [],
}) === -5);
t('score · 전부 gray (큐브 없음) = 0 (2026-04-24 규칙)', () => scoreFromCubes({
  diet: 'gray', exercise: 'gray', exercise_bonus: null, routine: 'gray', tasks: null, bonus: [],
}) === 0);

// ── PR 감지 ──────────────────────────────────────────
t('pr · 첫 기록은 PR 로 인정', () => {
  const { newPRs } = detectPRs(
    [{ name: '벤치', isStrength: true, sets: [{ kg: 60, reps: 10, done: true }] }],
    { byExercise: {} },
    '2026-04-24',
  );
  return newPRs.some((p) => p.kind === 'one_rm');
});
t('pr · 기존보다 낮은 기록은 PR 아님', () => {
  const { newPRs } = detectPRs(
    [{ name: '벤치', isStrength: true, sets: [{ kg: 50, reps: 8, done: true }] }],
    { byExercise: { '벤치': { one_rm: { kg: 100, date: '2026-04-01' }, volume: { kg: 1000, date: '2026-04-01' }, repMax: { 8: { kg: 80, date: '2026-04-01' } } } } },
    '2026-04-24',
  );
  return newPRs.length === 0;
});
t('pr · 하루 최대 3개 cap', () => {
  const { newPRs, overflow } = detectPRs(
    [
      { name: 'A', isStrength: true, sets: [{ kg: 100, reps: 5, done: true }] },
      { name: 'B', isStrength: true, sets: [{ kg: 200, reps: 3, done: true }] },
      { name: 'C', isStrength: true, sets: [{ kg: 80, reps: 8, done: true }] },
      { name: 'D', isStrength: true, sets: [{ kg: 120, reps: 10, done: true }] },
    ],
    { byExercise: {} },
    '2026-04-24',
  );
  return newPRs.length === 3 && overflow === true;
});

// ── 스트릭 마일스톤 ─────────────────────────────────
t('streak · 7일 첫 도달 → 2큐브', () => {
  const { milestones, nextClaimed } = detectStreakMilestones(7, []);
  return milestones.length === 1 && milestones[0].count === 2 && nextClaimed.includes('streak_7');
});
t('streak · 7일 이미 받음 → 보너스 없음', () => {
  const { milestones } = detectStreakMilestones(8, ['streak_7']);
  return milestones.length === 0;
});
t('streak · 30일 첫 도달 시 7도 같이? → 7은 이미 받았다고 전제, 30만', () => {
  const { milestones } = detectStreakMilestones(30, ['streak_7']);
  return milestones.length === 1 && milestones[0].type === 'streak_30';
});
t('streak · 초기 상태에서 30일 달성 시 7+30 동시 지급', () => {
  const { milestones } = detectStreakMilestones(30, []);
  return milestones.length === 2;
});

// ── judgeAccumulator (신 모델, 2026-05-01) ───────────
// 모든 액션 = 즉시 큐브 카운트. gold +3, silver +1, red -5.
const eq = (a, b) => a === b;
const accEq = (out, exp) => eq(out.gold, exp.gold) && eq(out.silver, exp.silver) && eq(out.red, exp.red);

t('acc · 빈 로그 → 0/0/0', () => accEq(judgeAccumulator({}, { weekday: 3 }), { gold: 0, silver: 0, red: 0 }));

// 식단
t('acc · 일반식 1 → silver 1', () => accEq(judgeAccumulator({ meals: [{ type: 'normal', category: 'breakfast' }] }), { gold: 0, silver: 1, red: 0 }));
t('acc · 클린식(green) 2 → gold 2', () => accEq(judgeAccumulator({ meals: [{ type: 'green' }, { type: 'green' }] }), { gold: 2, silver: 0, red: 0 }));
t('acc · 금지식(red) 1 → red 1', () => accEq(judgeAccumulator({ meals: [{ type: 'red' }] }), { gold: 0, silver: 0, red: 1 }));
t('acc · alcohol → red 1', () => accEq(judgeAccumulator({ meals: [{ category: 'alcohol' }] }), { gold: 0, silver: 0, red: 1 }));
t('acc · drink 무시 → 0', () => accEq(judgeAccumulator({ meals: [{ category: 'drink' }] }), { gold: 0, silver: 0, red: 0 }));
t('acc · 일반2 + 클린1 + 금지1 → s2 g1 r1', () => accEq(judgeAccumulator({ meals: [{ type: 'normal' }, { type: 'normal' }, { type: 'green' }, { type: 'red' }] }), { gold: 1, silver: 2, red: 1 }));

// 물
t('acc · 물 1잔 → silver 1', () => accEq(judgeAccumulator({ water_cups: 1 }, { waterGoal: 6 }), { gold: 0, silver: 1, red: 0 }));
t('acc · 물 6잔 (목표 도달) → silver 1 + gold 1', () => accEq(judgeAccumulator({ water_cups: 6 }, { waterGoal: 6 }), { gold: 1, silver: 1, red: 0 }));
t('acc · 물 0잔 → 0', () => accEq(judgeAccumulator({ water_cups: 0 }, { waterGoal: 6 }), { gold: 0, silver: 0, red: 0 }));

// 운동
t('acc · gym done 1 → gold 1', () => accEq(judgeAccumulator({ workouts: [{ type: 'gym', status: 'done' }] }), { gold: 1, silver: 0, red: 0 }));
t('acc · gym + activity done 둘 다 → gold 2', () => accEq(judgeAccumulator({ workouts: [{ type: 'gym', status: 'done' }, { type: 'activity', status: 'done' }] }), { gold: 2, silver: 0, red: 0 }));
t('acc · 미완료 운동 → 0', () => accEq(judgeAccumulator({ workouts: [{ type: 'gym', status: 'planned' }] }), { gold: 0, silver: 0, red: 0 }));

// 루틴
t('acc · 루틴 1개 done (1개만 등록) → silver 1, gold 0 (≥2 아님)', () => accEq(judgeAccumulator({ mandatory: [{ done: true, days: [3] }] }, { weekday: 3 }), { gold: 0, silver: 1, red: 0 }));
t('acc · 루틴 2개 다 done → silver 2 + gold 1', () => accEq(judgeAccumulator({ mandatory: [{ done: true, days: [3] }, { done: true, days: [3] }] }, { weekday: 3 }), { gold: 1, silver: 2, red: 0 }));
t('acc · 루틴 2 중 1 done → silver 1 (gold 보너스 X)', () => accEq(judgeAccumulator({ mandatory: [{ done: true, days: [3] }, { done: false, days: [3] }] }, { weekday: 3 }), { gold: 0, silver: 1, red: 0 }));

// 할일
t('acc · 할일 1개만 등록 → 0 (≥2 미만)', () => accEq(judgeAccumulator({ targets: [{ text: 'A', st: 'done' }] }), { gold: 0, silver: 0, red: 0 }));
t('acc · 할일 2개 다 done → silver 2 + gold 1', () => accEq(judgeAccumulator({ targets: [{ text: 'A', st: 'done' }, { text: 'B', st: 'done' }] }), { gold: 1, silver: 2, red: 0 }));

// 루틴 + 할일 모두 완료 보너스
t('acc · 루틴 2 + 할일 2 모두 done → silver 보너스 1 추가', () => {
  const out = judgeAccumulator({
    mandatory: [{ done: true, days: [3] }, { done: true, days: [3] }],
    targets: [{ text: 'A', st: 'done' }, { text: 'B', st: 'done' }],
  }, { weekday: 3 });
  // 루틴 silver 2 + gold 1 + 할일 silver 2 + gold 1 + 보너스 silver 1 = silver 5, gold 2
  return accEq(out, { gold: 2, silver: 5, red: 0 });
});

// 체중
t('acc · 체중 입력만 → silver 1', () => accEq(judgeAccumulator({ weight: 70.5 }), { gold: 0, silver: 1, red: 0 }));
t('acc · 체중 감량 (목표 향해) → silver + gold', () => accEq(judgeAccumulator({ weight: 70.0 }, { prevWeight: 70.5, weightGoal: 65 }), { gold: 1, silver: 1, red: 0 }));
t('acc · 체중 증량 (목표 반대) → silver only', () => accEq(judgeAccumulator({ weight: 71.0 }, { prevWeight: 70.5, weightGoal: 65 }), { gold: 0, silver: 1, red: 0 }));
t('acc · 증량 모드 (목표보다 가벼움) 증가 → silver + gold', () => accEq(judgeAccumulator({ weight: 65.5 }, { prevWeight: 65.0, weightGoal: 70 }), { gold: 1, silver: 1, red: 0 }));

// 점수 환산
t('score · {gold:2,silver:3,red:1} → 2*3+3-5 = 4', () => scoreFromCubes({ gold: 2, silver: 3, red: 1 }) === 4);
t('score · {silver:1} → 1', () => scoreFromCubes({ silver: 1 }) === 1);
t('score · {red:2} → -10', () => scoreFromCubes({ red: 2 }) === -10);
t('score · 빈 cubes → 0', () => scoreFromCubes({}) === 0);
t('score · legacy categorical {diet:gold,exercise:silver} → gold(3)+silver(1)=4', () => scoreFromCubes({ diet: 'gold', exercise: 'silver' }) === 4);

// ── 통합 judgeCubes (신 모델은 카운트 반환) ──────────
t('judgeCubes · 빈 로그 → 카운트 0', () => {
  const c = judgeCubes({}, { weekday: 3 });
  return c.gold === 0 && c.silver === 0 && c.red === 0 && Array.isArray(c.bonus);
});

export function runCubeTests() {
  let pass = 0, fail = 0;
  for (const c of _cases) {
    try {
      const ok = c.fn();
      if (ok) { pass++; } else { fail++; console.warn('FAIL:', c.name); }
    } catch (e) {
      fail++;
      console.warn('THROW:', c.name, e && e.message);
    }
  }
  console.log('[cube-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  return { pass, fail, total: _cases.length };
}

if (typeof window !== 'undefined') {
  window.runCubeTests = runCubeTests;
}
