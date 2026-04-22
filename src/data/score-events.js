// Stay Hard · score event registry
// Central table of every score-changing event in the app. `addScore(type)`
// looks up `pts`, `label`, `icon` by key. Negative pts = penalty or undo.
//
// Pure data + one pure helper. No DOM, no app state.

/** @typedef {{pts:number, label:string, icon:string}} ScoreEvent */
/** @type {Record<string, ScoreEvent>} */
export const SCORE_EVENTS = {
  // 물리적 단련 — 30점 기준 (하루 최대 근력+유산소=60)
  workout_done:         { pts: 30,  label: '근력 운동 완료',       icon: '💪' },
  workout_cardio_done:  { pts: 30,  label: '유산소 운동 완료',     icon: '🏃' },
  cold_shower:          { pts: 10,  label: '찬물 샤워',            icon: '🚿' },
  early_rise:           { pts: 10,  label: '새벽 기상',            icon: '🌅' },
  goggins_4x4x48:       { pts: 100, label: '4x4x48 챌린지',        icon: '🏃' },
  pushup_challenge:     { pts: 1,   label: '푸쉬업 챌린지',        icon: '💪' }, // ptsOverride: 30회까지 1점/회, 이후 5회당 1점

  // 체중
  weight_record:        { pts: 1,  label: '공복체중 기록',         icon: '⚖️' },
  weight_loss:          { pts: 5,  label: '체중 감량',             icon: '⬇️' },
  weight_goal:          { pts: 30, label: '목표 체중 달성',        icon: '🎯' },

  // 습관 구조 (작지만 꾸준히)
  routine_done:         { pts: 1,  label: '필수 루틴 완료',        icon: '✅' },
  target_done:          { pts: 2,  label: '할일 완료',             icon: '📋' },

  // 식단
  diet_log:             { pts: 1,  label: '식단 등록',             icon: '🥗' },
  diet_log_only:        { pts: 1,  label: '식단 등록',             icon: '🥗' }, // alias (레거시)
  diet_clean:           { pts: 10, label: '클린 식단',             icon: '🟢' },
  diet_clean_register:  { pts: 10, label: '클린 식단 등록',        icon: '🟢' },
  cheat_bonus:          { pts: 20, label: '치팅 절제 보너스',      icon: '💀' },
  onboarding_bonus:     { pts: 10, label: '첫 출발 보너스',        icon: '🎉' },

  // 패널티
  diet_junk:            { pts: -30, label: '금지 식단',            icon: '🔴' },
  diet_alcohol_register:{ pts: 0,   label: '음주 기록',            icon: '🍺' },
  routine_fail:         { pts: -1,  label: '필수 루틴 실패',       icon: '❌' },
  routine_skip:         { pts: -1,  label: '필수 루틴 스킵',       icon: '⏭️' },
  target_fail:          { pts: -2,  label: '할일 실패',            icon: '💢' },
  workout_delete:       { pts: 0,   label: '운동 취소',            icon: '🗑️' },
  workout_deleted:      { pts: 0,   label: '운동 삭제',            icon: '🗑️' }, // alias (레거시)

  // 취소 — 원래 부여분 반환 (장부 기록)
  workout_done_cancel:       { pts: -30, label: '근력 운동 취소',   icon: '↩️' },
  workout_cardio_done_cancel:{ pts: -30, label: '유산소 운동 취소', icon: '↩️' },
  routine_done_cancel:       { pts: -1,  label: '루틴 완료 취소',   icon: '↩️' },
  target_done_cancel:        { pts: -2,  label: '할일 완료 취소',   icon: '↩️' },
  diet_clean_delete:         { pts: -10, label: '클린 식단 삭제',   icon: '🟢' },
  diet_clean_cancel:         { pts: -10, label: '클린 식단 취소',   icon: '🟢' },
  diet_log_cancel:           { pts: -1,  label: '식단 등록 취소',   icon: '🥗' },
  diet_log_only_cancel:      { pts: -1,  label: '식단 등록 취소',   icon: '🥗' },

  // 패널티 취소 — 패널티만큼 회복
  diet_junk_cancel:     { pts: 30,  label: '금지 식단 만회',        icon: '🔴' },
  diet_alcohol_cancel:  { pts: 0,   label: '음주 기록 취소',        icon: '🍺' },
  routine_fail_cancel:  { pts: 1,   label: '루틴 실패 취소',        icon: '↩️' },
  routine_skip_cancel:  { pts: 1,   label: '루틴 스킵 취소',        icon: '↩️' },
  target_fail_cancel:   { pts: 2,   label: '할일 실패 취소',        icon: '↩️' }
};

/**
 * Push-up challenge scoring curve.
 * 1 pt per rep up to 30; then 1 pt per 5 reps beyond.
 * @param {number} n total reps today
 * @returns {number} points earned
 */
export function _pushupPtsFor(n) {
  n = Math.max(0, +n || 0);
  return n <= 30 ? n : 30 + Math.floor((n - 30) / 5);
}
