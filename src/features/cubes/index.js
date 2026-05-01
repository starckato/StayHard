// Will Cube 모듈 — 엔트리. main.js 에서 import 후 window.Cubes 로 노출.
// Phase 1: 판정/점수/PR/streak 순수 함수 + 실시간 재계산 glue.
// UI 변경 없음. 기존 addScore/SCORE_EVENTS 는 그대로 둠 (Phase 5 에서 교체).

export * from './judge.js';
export * from './score.js';
export * from './pr.js';
export * from './streak.js';

import { judgeCubes } from './judge.js';
import { scoreFromCubes } from './score.js';
import { detectPRs, prsToBonusCubes } from './pr.js';
import { detectStreakMilestones, streakMilestonesToBonusCubes } from './streak.js';

// 기존 bonus 배열을 보존하면서 (대회 등록/과거 PR) 새 bonus 추가.
// 중복 방지: 같은 type+date 조합은 덮어쓰지 않음.
function mergeBonus(existing, incoming) {
  const out = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(out.map((b) => (b && b.type ? b.type + '|' + (b.date || '') : '')));
  for (const b of incoming || []) {
    if (!b) continue;
    const key = b.type + '|' + (b.date || '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

// 호출측에서 logCache[key] 를 전달.
// 반환: 새 cubes 객체 (저장은 호출측 책임).
// ctx: { weekday, workoutPRs?, newStreak?, claimedMilestones?, prHistory?,
//        prevWeight?, weightGoal?, waterGoal? }
export function computeCubesForLog(log, ctx = {}) {
  const weekday = typeof ctx.weekday === 'number'
    ? ctx.weekday
    : ((new Date().getDay() + 6) % 7); // Monday-based
  // 액션 누적 모델
  const acc = judgeCubes(log || {}, {
    weekday,
    prevWeight: ctx.prevWeight,
    weightGoal: ctx.weightGoal,
    waterGoal: ctx.waterGoal,
  });

  // Workout PR bonus
  let prBonus = [];
  let nextPrHistory = ctx.prHistory || null;
  if (Array.isArray(ctx.workoutPRs)) {
    prBonus = prsToBonusCubes(ctx.workoutPRs);
  } else if (ctx.detectPRs && log && Array.isArray(log.workouts)) {
    const gym = log.workouts.find((w) => w && w.type === 'gym' && w.status === 'done');
    if (gym && Array.isArray(gym.exercises) && ctx.prHistory) {
      const res = detectPRs(gym.exercises, ctx.prHistory, ctx.dateKey || null);
      prBonus = prsToBonusCubes(res.newPRs);
      nextPrHistory = res.nextHistory;
    }
  }

  // Streak milestone bonus
  let streakBonus = [];
  let nextClaimed = ctx.claimedMilestones || [];
  if (typeof ctx.newStreak === 'number') {
    const res = detectStreakMilestones(ctx.newStreak, ctx.claimedMilestones || []);
    streakBonus = streakMilestonesToBonusCubes(res.milestones);
    nextClaimed = res.nextClaimed;
  }

  const existingBonus = log && log.cubes && Array.isArray(log.cubes.bonus) ? log.cubes.bonus : [];
  const nextBonus = mergeBonus(existingBonus, [...prBonus, ...streakBonus]);

  return {
    cubes: {
      gold: acc.gold,
      silver: acc.silver,
      red: acc.red,
      bonus: nextBonus,
    },
    dayScore: 0,
    nextPrHistory,
    nextClaimed,
    newPRs: prBonus,
    newMilestones: streakBonus,
  };
}

// 편의: logCache key 하나를 받아 큐브를 계산하고 즉시 할당.
// side-effect: log.cubes 를 갱신. 호출측에서 saveNow() 로 Supabase 반영.
// 기존 데이터 파괴 금지 — cubes 필드가 없던 로그는 새로 생성, 있던 경우엔 bonus 보존 병합.
export function recomputeCubesInLog(log, ctx = {}) {
  if (!log || typeof log !== 'object') return null;
  const result = computeCubesForLog(log, ctx);
  log.cubes = result.cubes;
  return result;
}
