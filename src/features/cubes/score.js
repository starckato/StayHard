// Will Cube 점수 환산 — 순수 함수.
// gold: +3, silver: +2, crimson: −3, gray: +1, null: 0
// bonus 항목: count × 3 (각 count 는 이미 "몇 개의 황금 큐브 가치인지"로 계산됨)
//   예: PR 1건 { color:'gold', count: 2 } → +6
//       풀마라톤 { color:'gold', count: 5 } → +15

const BASE_SCORE = {
  gold: 3,
  silver: 2,
  crimson: -3,
  gray: 1,
};

// 단일 큐브 색 → 점수
export function colorScore(color) {
  if (color == null) return 0;
  const v = BASE_SCORE[color];
  return typeof v === 'number' ? v : 0;
}

// cubes 객체 → 일일 합산 점수
export function scoreFromCubes(cubes) {
  if (!cubes || typeof cubes !== 'object') return 0;
  let total = 0;
  total += colorScore(cubes.diet);
  total += colorScore(cubes.exercise);
  total += colorScore(cubes.exercise_bonus);
  total += colorScore(cubes.routine);
  total += colorScore(cubes.tasks);
  if (Array.isArray(cubes.bonus)) {
    for (const b of cubes.bonus) {
      if (!b) continue;
      const count = typeof b.count === 'number' ? b.count : 0;
      total += count * 3;
    }
  }
  return total;
}

// 여러 일일 cubes 의 합산 — Phase 5 total_score 재계산용
export function scoreFromManyCubes(cubesArray) {
  if (!Array.isArray(cubesArray)) return 0;
  let total = 0;
  for (const c of cubesArray) total += scoreFromCubes(c);
  return total;
}
