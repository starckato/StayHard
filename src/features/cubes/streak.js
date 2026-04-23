// 스트릭 마일스톤 감지 — 순수 함수.
// 7/30/100/365일 최초 도달 시만 보너스 큐브. 끊긴 뒤 재도달은 무효.

export const STREAK_MILESTONES = [
  { days: 7, count: 2 },
  { days: 30, count: 5 },
  { days: 100, count: 15 },
  { days: 365, count: 50 },
];

// streak: 오늘 기준 streak 값
// claimedMilestones: string[] — 이미 받은 마일스톤 키 (예: ['streak_7'])
// 반환: { milestones: [{type, color, count}], nextClaimed: [...] }
export function detectStreakMilestones(streak, claimedMilestones) {
  const claimed = Array.isArray(claimedMilestones) ? [...claimedMilestones] : [];
  const milestones = [];
  if (typeof streak !== 'number' || !Number.isFinite(streak) || streak <= 0) {
    return { milestones: [], nextClaimed: claimed };
  }
  for (const ms of STREAK_MILESTONES) {
    const key = 'streak_' + ms.days;
    if (streak >= ms.days && !claimed.includes(key)) {
      milestones.push({ type: key, color: 'gold', count: ms.count });
      claimed.push(key);
    }
  }
  return { milestones, nextClaimed: claimed };
}

// 마일스톤 배열 → 보너스 큐브 항목 배열
export function streakMilestonesToBonusCubes(milestones) {
  if (!Array.isArray(milestones)) return [];
  return milestones.map((m) => ({
    type: m.type,
    color: m.color,
    count: m.count,
  }));
}
