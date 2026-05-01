// Will Cube 점수 환산.
// 2026-05-01 (사용자 결정):
//   gold:   +3
//   silver: +1
//   red:    -5
//   gray:    0 (등록 전 상태)
//   bonus 항목: count × 3 (각 count 는 "황금 큐브 가치 단위")

const BASE_SCORE = {
  gold: 3,
  silver: 1,
  red: -5,
  // legacy aliases
  crimson: -5,
  gray: 0,
};

export function colorScore(color) {
  if (color == null) return 0;
  const v = BASE_SCORE[color];
  return typeof v === 'number' ? v : 0;
}

// cubes 객체 → 일일 합산 점수.
// 두 가지 shape 호환:
//   1) NEW: { gold, silver, red, bonus }
//   2) LEGACY: { diet, exercise, exercise_bonus, routine, tasks, bonus }
export function scoreFromCubes(cubes) {
  if (!cubes || typeof cubes !== 'object') return 0;
  let total = 0;
  // NEW shape — direct counts
  if (typeof cubes.gold === 'number' || typeof cubes.silver === 'number' || typeof cubes.red === 'number') {
    total += (cubes.gold || 0) * BASE_SCORE.gold;
    total += (cubes.silver || 0) * BASE_SCORE.silver;
    total += (cubes.red || 0) * BASE_SCORE.red;
  } else {
    // LEGACY categorical
    total += colorScore(cubes.diet);
    total += colorScore(cubes.exercise);
    total += colorScore(cubes.exercise_bonus);
    total += colorScore(cubes.routine);
    total += colorScore(cubes.tasks);
  }
  if (Array.isArray(cubes.bonus)) {
    for (const b of cubes.bonus) {
      if (!b) continue;
      const count = typeof b.count === 'number' ? b.count : 0;
      total += count * BASE_SCORE.gold;
    }
  }
  return total;
}

export function scoreFromManyCubes(cubesArray) {
  if (!Array.isArray(cubesArray)) return 0;
  let total = 0;
  for (const c of cubesArray) total += scoreFromCubes(c);
  return total;
}
