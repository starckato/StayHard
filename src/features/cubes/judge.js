// Will Cube — 액션 누적 모델 (2026-05-01 사용자 결정).
// 기존 categorical (diet/exercise/routine/tasks 각 1색) 폐기.
//
// 모든 사용자 액션 = 즉시 cube 지급. 하루 상한 없음.
//
// 큐브 점수: gold +3, silver +1, red -5.
//
// 액션별 규칙:
//  - 체중: 입력 silver +1, 목표 향해 이동(prev → 목표 방향) gold +1
//  - 식단: 일반 silver, 클린(green) gold, 금지(red)/술 red — 끼니 마다 즉시
//  - 물: 컵당 silver, 목표 컵 도달 시 gold +1 (1회)
//  - 운동: 완료 entry (gym OR activity status==='done') 마다 gold +1
//  - 루틴(mandatory): 오늘 요일 항목 완료 마다 silver +1; 2개 이상 모두 완료 시 gold +1
//  - 할일(targets): 2개 이상일 때 완료 마다 silver +1; 모두 완료 시 gold +1
//  - 루틴+할일 모두 완료 시 silver +1 추가 보너스
//
// 출력: { gold:int, silver:int, red:int }
// bonus 배열은 PR / streak 으로 분리됨 — index.js 에서 합산.

export function judgeAccumulator(log, ctx = {}) {
  const meals = (log && Array.isArray(log.meals)) ? log.meals : [];
  const workouts = (log && Array.isArray(log.workouts)) ? log.workouts : [];
  const mandatory = (log && Array.isArray(log.mandatory)) ? log.mandatory : [];
  const targets = (log && Array.isArray(log.targets)) ? log.targets : [];
  const water = (log && typeof log.water_cups === 'number') ? log.water_cups : 0;
  const waterGoal = (typeof ctx.waterGoal === 'number' && ctx.waterGoal > 0) ? ctx.waterGoal : 0;
  const hasWeight = log && (log.weight != null) && !isNaN(parseFloat(log.weight));
  const prevWeight = (typeof ctx.prevWeight === 'number') ? ctx.prevWeight : null;
  const weightGoal = (typeof ctx.weightGoal === 'number' && ctx.weightGoal > 0) ? ctx.weightGoal : null;

  let gold = 0, silver = 0, red = 0;

  // ── 식단 ──
  for (const m of meals) {
    if (!m) continue;
    if (m.category === 'drink') continue; // 음료 는 별도 처리 안 함
    if (m.type === 'skip') continue;       // 명시적 스킵 — 큐브 보상 없음
    if (m.type === 'red' || m.category === 'alcohol') {
      red++;
    } else if (m.type === 'green') {
      gold++;
    } else {
      // normal / 일반식
      silver++;
    }
  }

  // ── 물 ──
  // 최초 1회 등록 → silver +1.
  // 목표 컵 수 도달 → gold +1.
  if (water > 0) {
    silver++;
    if (waterGoal > 0 && water >= waterGoal) gold++;
  }

  // ── 운동 ──
  for (const w of workouts) {
    if (!w || w.status !== 'done') continue;
    if (w.type === 'gym' || w.type === 'activity') gold++;
  }

  // ── 루틴 (mandatory, 오늘 요일 활성 항목만) ──
  // weekday: Monday-based (Mon=0..Sun=6). renderMandatory 패턴과 동일.
  const weekday = (typeof ctx.weekday === 'number')
    ? ctx.weekday
    : ((new Date().getDay() + 6) % 7);
  const todayRoutines = mandatory.filter(m => {
    if (!m) return false;
    if (!Array.isArray(m.days) || m.days.length === 0) return true;
    return m.days.includes(weekday);
  });
  const doneRoutines = todayRoutines.filter(m => m.done === true).length;
  silver += doneRoutines;
  const allRoutinesDone = todayRoutines.length >= 2 && doneRoutines === todayRoutines.length;
  if (allRoutinesDone) gold++;

  // ── 할일 (targets) ──
  const realTargets = targets.filter(t => t && !t._meta && t.text);
  const doneTargets = realTargets.filter(t => t.st === 'done').length;
  if (realTargets.length >= 2) {
    silver += doneTargets;
    if (doneTargets === realTargets.length) {
      gold++;
      // 루틴+할일 둘 다 완료 시 silver 추가 보너스
      if (allRoutinesDone) silver++;
    }
  }

  // ── 체중 ──
  if (hasWeight) {
    silver++;
    // 목표 방향 이동 시 gold
    // 감량 (current > goal): new < prev
    // 증량 (current < goal): new > prev
    if (prevWeight != null && weightGoal != null) {
      const cur = parseFloat(log.weight);
      if (!isNaN(cur)) {
        const wantDecrease = prevWeight > weightGoal; // 감량 모드
        const wantIncrease = prevWeight < weightGoal; // 증량 모드
        if ((wantDecrease && cur < prevWeight) || (wantIncrease && cur > prevWeight)) {
          gold++;
        }
      }
    }
  }

  return { gold, silver, red };
}

// 호환 — 옛 호출 (judgeCubes) 도 지원. categorical 출력 대신 새 카운트 반환.
// 기존 cubes.bonus 배열은 호출측에서 별도 처리.
export function judgeCubes(log, ctx = {}) {
  const acc = judgeAccumulator(log, ctx);
  const existingBonus = (log && log.cubes && Array.isArray(log.cubes.bonus))
    ? log.cubes.bonus
    : [];
  return {
    gold: acc.gold,
    silver: acc.silver,
    red: acc.red,
    bonus: existingBonus,
  };
}

// ── Legacy categorical helpers — 옛 코드 호환 (기존 호출 안 깨지게) ──
// 새 모델로 갈아탔지만 일부 외부 코드 (UI dot 등) 가 이 색 함수를 호출하므로 남겨둠.
// 실제 점수 산정 / 표시는 카운트 기반으로 함.
export function judgeDiet(meals) {
  const list = Array.isArray(meals) ? meals : [];
  if (list.length === 0) return 'gray';
  const hasRed = list.some(m => m && (m.type === 'red' || m.category === 'alcohol'));
  if (hasRed) return 'crimson';
  const nonDrink = list.filter(m => m && m.category !== 'drink');
  if (nonDrink.length === 0) return 'gray';
  const greenCount = nonDrink.filter(m => m.type === 'green').length;
  if (greenCount >= 1) return 'gold';
  return 'silver';
}
export function judgeExercise(workouts) {
  const list = Array.isArray(workouts) ? workouts : [];
  let hasGym = false, hasCardio = false;
  for (const w of list) {
    if (!w || w.status !== 'done') continue;
    if (w.type === 'gym') hasGym = true;
    else if (w.type === 'activity') hasCardio = true;
  }
  if (!hasGym && !hasCardio) return { exercise: 'gray', exercise_bonus: null };
  return { exercise: 'gold', exercise_bonus: hasGym && hasCardio ? 'gold' : null };
}
export function judgeRoutine(mandatory, weekday) {
  const all = Array.isArray(mandatory) ? mandatory : [];
  const today = all.filter(m => {
    if (!m) return false;
    if (!Array.isArray(m.days) || m.days.length === 0) return true;
    return m.days.includes(weekday);
  });
  if (today.length === 0) return 'gray';
  const hasFail = today.some(m => m.fail === true);
  if (hasFail) return 'crimson';
  const doneCount = today.filter(m => m.done === true).length;
  if (doneCount === 0) return 'gray';
  if (doneCount === today.length) return 'gold';
  return 'silver';
}
export function judgeTasks(targets) {
  const list = Array.isArray(targets) ? targets : [];
  const real = list.filter(t => t && !t._meta);
  if (real.length === 0) return null;
  const hasFail = real.some(t => t.st === 'fail');
  if (hasFail) return 'crimson';
  const doneCount = real.filter(t => t.st === 'done').length;
  if (doneCount === 0) return 'gray';
  if (doneCount === real.length) return 'gold';
  return 'silver';
}

// 체중 입력 → 카드 칩 색상.
// 입력만: silver. 어제 대비 목표 방향으로 이동: gold. 멀어지거나 정보 부족: silver.
// 미입력: 'gray'. (judgeAccumulator 의 ── 체중 ── 블록과 같은 규칙.)
export function judgeWeight(log, ctx = {}) {
  if (!log) return 'gray';
  const cur = (log.weight != null) ? parseFloat(log.weight) : NaN;
  if (isNaN(cur) || cur <= 0) return 'gray';
  const prev = (typeof ctx.prevWeight === 'number') ? ctx.prevWeight : null;
  const goal = (typeof ctx.weightGoal === 'number' && ctx.weightGoal > 0) ? ctx.weightGoal : null;
  if (prev != null && goal != null) {
    const wantDecrease = prev > goal;
    const wantIncrease = prev < goal;
    if ((wantDecrease && cur < prev) || (wantIncrease && cur > prev)) {
      return 'gold';
    }
  }
  return 'silver';
}
