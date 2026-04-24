// 큐록 · Activation — 첫 큐브 체험 카드
//
// 온보딩 종료 직후 Status Band 아래 단일 타깃 카드 노출.
// "오늘 물 2잔만" / "5분 걷기" / "할일 1개" / "루틴 1개" 중 1개 랜덤 제시 →
// 완료 판정 시 silver/gold 큐브 즉시 생성 + FIRST_CUBE_EARNED 메트릭 기록.
//
// Acceptance (SERVICE_EVALUATION §6 · B3):
//   - Time-to-first-cube 중앙값 5분 이내
//   - 카드는 `onboarding_state.first_cube_earned_at == null` 인 유저만 노출

import { logEvent, EVT } from '../metrics/index.js';

/** @typedef {Object} TaskPreset
 *  @property {string} id
 *  @property {string} title   — 카드 대제목 (해라체·명사구)
 *  @property {string} hint    — 작은 설명 한 줄
 *  @property {'routine'|'task'|'water'|'exercise'} category
 */

/** @type {TaskPreset[]} */
export const FIRST_CUBE_TASKS = [
  { id: 'water_2',     title: '오늘, 물 두 잔.',    hint: '기록하고 끝.',       category: 'water' },
  { id: 'walk_5',      title: '5분만 걷는다.',      hint: '계단·마당·복도 OK.', category: 'exercise' },
  { id: 'task_1',      title: '할일 하나.',         hint: '무엇이든 체크.',     category: 'task' },
  { id: 'routine_1',   title: '루틴 하나.',         hint: '가장 쉬운 것부터.',  category: 'routine' },
];

/** Pick a preset. Deterministic by user.id for consistent onboarding. */
export function pickTask(userId) {
  if (!userId) return FIRST_CUBE_TASKS[0];
  // Simple hash → index.
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = ((h << 5) - h + userId.charCodeAt(i)) | 0;
  return FIRST_CUBE_TASKS[Math.abs(h) % FIRST_CUBE_TASKS.length];
}

/**
 * Check if the task is completed in today's log.
 * Returns { done: bool, evidence?: string }
 */
export function checkCompletion(log, taskId) {
  if (!log) return { done: false };
  switch (taskId) {
    case 'water_2':
      return { done: (log.water_cups || 0) >= 2, evidence: `${log.water_cups || 0}잔 기록` };
    case 'walk_5':
      return {
        done: Array.isArray(log.workouts) && log.workouts.some(w =>
          w && (w.status === 'done' || w.status === 'planned') &&
          (w.type === 'cardio' || w.type === 'activity' || (w.meta && String(w.meta).includes('걷')))
        ),
        evidence: '운동 기록 완료',
      };
    case 'task_1':
      return {
        done: Array.isArray(log.targets) && log.targets.some(t => t && t.st === 'done'),
        evidence: '할일 하나 완료',
      };
    case 'routine_1':
      return {
        done: Array.isArray(log.mandatory) && log.mandatory.some(m => m && m.done),
        evidence: '루틴 하나 완료',
      };
    default:
      return { done: false };
  }
}

/**
 * Mark onboarding first-cube completed — server write.
 * Caller should pass sb client to avoid circular import.
 * @param {any} sb
 * @param {string} userId
 * @param {string} taskId
 */
export async function markEarned(sb, userId, taskId) {
  if (!sb || !userId) return { ok: false };
  try {
    const nowIso = new Date().toISOString();
    // Merge-update onboarding_state
    const { data: prof } = await sb.from('profiles').select('onboarding_state').eq('id', userId).single();
    const next = {
      ...(prof?.onboarding_state || {}),
      first_cube_task: taskId,
      first_cube_earned_at: nowIso,
    };
    await sb.from('profiles').update({ onboarding_state: next }).eq('id', userId);
    logEvent(EVT.FIRST_CUBE_EARNED, { task_id: taskId });
    return { ok: true };
  } catch (e) {
    console.warn('[first-cube] markEarned', e);
    return { ok: false, error: String(e) };
  }
}

/** Check if the user has ever earned first cube. */
export function hasEarned(profile) {
  return !!(profile && profile.onboarding_state && profile.onboarding_state.first_cube_earned_at);
}

/** Should show the card — gated by FF and completion status. */
export function shouldShow(profile, flagsGet) {
  if (!profile) return false;
  // FF gate (Phase rollout).
  try {
    if (typeof flagsGet === 'function' && !flagsGet('first_cube_card', false)) return false;
  } catch {}
  return !hasEarned(profile);
}
