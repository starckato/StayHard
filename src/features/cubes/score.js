// Will Cube 점수 환산 — 순수 함수.
// gold: +3, silver: +2, crimson: −3, gray: 0, null: 0
// 2026-04-24 규칙 변경: gray = 0점. "큐브 얻기 전까지 점수 없음".
// 유저가 루틴/할일/식단/운동을 "등록" 만 한 상태는 무점수. 완료/금지 등
// 의미 있는 상태 전환이 일어나야 cube 와 점수가 붙음.
//
// bonus 항목: count × 3 (각 count 는 이미 "몇 개의 황금 큐브 가치인지"로 계산됨)
//   예: PR 1건 { color:'gold', count: 2 } → +6
//       풀마라톤 { color:'gold', count: 5 } → +15

const BASE_SCORE = {
  gold: 3,
  silver: 2,
  crimson: -3,
  gray: 0,
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
