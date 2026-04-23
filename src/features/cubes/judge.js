// Will Cube 판정 — 순수 함수. side effect 없음.
// 호출측(saveMeal, togMand, togTgt, saveSessionToLog 등)이 결과를 받아 저장.
// Phase 1: 판정 로직만. 기존 점수 시스템(addScore, SCORE_EVENTS)은 건드리지 않음.

// ── 식단 큐브 ──
// - 금지식(type==='red') or 주류(category==='alcohol')가 1건이라도 있음 → crimson
// - 식사 기록 0건 → gray
// - 모든 끼니 type==='green' (at least 1 meal) → gold
// - 그 외 (일부 청정 / 일반식 혼재) → silver
export function judgeDiet(meals) {
  const list = Array.isArray(meals) ? meals : [];
  if (list.length === 0) return 'gray';
  const hasRed = list.some((m) => m && (m.type === 'red' || m.category === 'alcohol'));
  if (hasRed) return 'crimson';
  const nonDrink = list.filter((m) => m && m.category !== 'drink');
  if (nonDrink.length === 0) return 'gray';
  const allGreen = nonDrink.every((m) => m.type === 'green');
  if (allGreen) return 'gold';
  return 'silver';
}

// ── 운동 큐브 + exercise_bonus ──
// - 헬스 완료(type==='gym' && status==='done') OR 유산소 완료(type==='activity' && status==='done') → gold
// - 둘 다 없음 → gray
// - 둘 다 완료 → exercise: gold, exercise_bonus: gold
export function judgeExercise(workouts) {
  const list = Array.isArray(workouts) ? workouts : [];
  let hasGym = false;
  let hasCardio = false;
  for (const w of list) {
    if (!w || w.status !== 'done') continue;
    if (w.type === 'gym') hasGym = true;
    else if (w.type === 'activity') hasCardio = true;
  }
  if (!hasGym && !hasCardio) {
    return { exercise: 'gray', exercise_bonus: null };
  }
  return {
    exercise: 'gold',
    exercise_bonus: hasGym && hasCardio ? 'gold' : null,
  };
}

// ── 루틴 큐브 ──
// mandatory: [{done, fail, type, days, ...}]
// - 오늘 요일에 해당하는 루틴이 0개 (등록 없음) → gray
// - fail===true 1개라도 → crimson
// - 모두 done (fail 없음) → gold
// - 일부 done, 나머지 미기록 (fail 없음) → silver
// - 전부 미기록 (fail 0, done 0) → gray
export function judgeRoutine(mandatory, weekday) {
  const all = Array.isArray(mandatory) ? mandatory : [];
  // 오늘 요일(weekday)에 해당하는 항목만. days 배열이 없으면 매일.
  const today = all.filter((m) => {
    if (!m) return false;
    if (!Array.isArray(m.days) || m.days.length === 0) return true;
    return m.days.includes(weekday);
  });
  if (today.length === 0) return 'gray';
  const hasFail = today.some((m) => m.fail === true);
  if (hasFail) return 'crimson';
  const doneCount = today.filter((m) => m.done === true).length;
  if (doneCount === 0) return 'gray';
  if (doneCount === today.length) return 'gold';
  return 'silver';
}

// ── 할일 큐브 ──
// targets: [{text, st: ''|'done'|'fail', _meta?}]
// - _meta 제외 실제 할일 0건 → null (큐브 자체가 렌더되지 않음)
// - st==='fail' 1건이라도 → crimson
// - 모두 'done' → gold
// - 일부 'done', 나머지 '' (fail 없음) → silver
export function judgeTasks(targets) {
  const list = Array.isArray(targets) ? targets : [];
  const real = list.filter((t) => t && !t._meta);
  if (real.length === 0) return null;
  const hasFail = real.some((t) => t.st === 'fail');
  if (hasFail) return 'crimson';
  const doneCount = real.filter((t) => t.st === 'done').length;
  if (doneCount === 0) return 'silver'; // 등록만 되고 미완료. 전부 빈 상태 = silver (부분 완료 없음)
  // spec: "부분 완료 (실패 없음) → silver" / "모두 완료 → gold"
  if (doneCount === real.length) return 'gold';
  return 'silver';
}

// ── 전체 큐브 판정 ──
// log: daily_logs row
// ctx: { weekday?, prevMilestones?, prevPRs?, streakBefore? }
// 반환: { diet, exercise, exercise_bonus, routine, tasks, bonus: [] }
// 주의: bonus 배열은 streak/PR 보너스는 별도 detector로 채움. 여기선 [] 반환.
export function judgeCubes(log, ctx = {}) {
  const weekday = typeof ctx.weekday === 'number' ? ctx.weekday : new Date().getDay();
  const ex = judgeExercise(log && log.workouts);
  return {
    diet: judgeDiet(log && log.meals),
    exercise: ex.exercise,
    exercise_bonus: ex.exercise_bonus,
    routine: judgeRoutine(log && log.mandatory, weekday),
    tasks: judgeTasks(log && log.targets),
    bonus: Array.isArray(log && log.cubes && log.cubes.bonus) ? log.cubes.bonus : [],
  };
}
