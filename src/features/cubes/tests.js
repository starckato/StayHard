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
t('diet · green 2개 이상 → gold (규칙 완화)', () => judgeDiet([
  { type: 'green', category: 'breakfast' },
  { type: 'green', category: 'lunch' },
]) === 'gold');
t('diet · green 2 + normal 1 → gold', () => judgeDiet([
  { type: 'green', category: 'breakfast' },
  { type: 'green', category: 'lunch' },
  { type: 'normal', category: 'dinner' },
]) === 'gold');
t('diet · green 1 + normal 1 → silver', () => judgeDiet([
  { type: 'green', category: 'breakfast' },
  { type: 'normal', category: 'lunch' },
]) === 'silver');
t('diet · 전부 normal → silver', () => judgeDiet([
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
t('score · gold 4 + exercise_bonus gold + PR bonus 1 = +12+3+6 = 21', () => scoreFromCubes({
  diet: 'gold', exercise: 'gold', exercise_bonus: 'gold', routine: 'gold', tasks: 'gold',
  bonus: [{ type: 'pr', color: 'gold', count: 2 }],
}) === 3 + 3 + 3 + 3 + 3 + 6);
t('score · crimson 1 = −3', () => scoreFromCubes({
  diet: 'crimson', exercise: 'gray', exercise_bonus: null, routine: 'gray', tasks: null, bonus: [],
}) === -3 + 1 + 1);
t('score · 전부 gray (기록 없음) = 3 (diet/ex/routine)', () => scoreFromCubes({
  diet: 'gray', exercise: 'gray', exercise_bonus: null, routine: 'gray', tasks: null, bonus: [],
}) === 3);

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

// ── 통합 judgeCubes ──────────────────────────────────
t('judgeCubes · 빈 로그 → 전부 gray/null', () => {
  const c = judgeCubes({}, { weekday: 3 });
  return c.diet === 'gray' && c.exercise === 'gray' && c.exercise_bonus == null
    && c.routine === 'gray' && c.tasks == null && Array.isArray(c.bonus);
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
