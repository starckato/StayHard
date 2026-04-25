// QROK · friends/presets
//
// Nudge preset catalog. Server whitelists `id` only (migrations/017_nudges.sql);
// client owns the Korean Manifesto body + subtitle. Adding a preset requires a
// DB insert too — IDs must match.

/** @typedef {{id:string, body:string, subtitle:string, category:'check'|'streak'|'routine'|'sleep'|'recovery'|'callout'}} NudgePreset */

/** @type {NudgePreset[]} */
export const NUDGE_PRESETS = [
  { id: 'move_today',   category: 'check',    body: '오늘 움직였나.',              subtitle: '움직임 확인' },
  { id: 'streak_alive', category: 'streak',   body: '연속 기록, 아직 살아있나.',     subtitle: '연속 일수' },
  { id: 'routine_check',category: 'routine',  body: '루틴 체크했나.',              subtitle: '루틴 확인' },
  { id: 'sleep_check',  category: 'sleep',    body: '어제 몇 시에 잤지.',          subtitle: '수면 점검' },
  { id: 'back_up',      category: 'recovery', body: '쉬었으면 이제 일어나.',        subtitle: '복귀' },
  { id: 'no_excuse',    category: 'callout',  body: '핑계 없음.',                  subtitle: '각성' },
  { id: 'half_done',    category: 'check',    body: '반만 해도 한 거다. 시작해.',   subtitle: '시작 유도' },
  { id: 'one_rep',      category: 'check',    body: '한 세트라도.',                subtitle: '최소 행동' },
  { id: 'cold_shower',  category: 'routine',  body: '찬물. 지금.',                 subtitle: '충격 요법' },
  { id: 'step_out',     category: 'check',    body: '밖으로 5분.',                 subtitle: '움직임 제안' },
  { id: 'log_it',       category: 'routine',  body: '기록은 남겼나.',              subtitle: '기록 확인' },
  { id: 'no_retreat',   category: 'callout',  body: '물러서지 마.',                subtitle: '버티기' },
];

const BY_ID = Object.fromEntries(NUDGE_PRESETS.map(p => [p.id, p]));

/**
 * Lookup preset by id.
 * @param {string} id
 * @returns {NudgePreset|null}
 */
export function getPreset(id) {
  return BY_ID[id] || null;
}

/**
 * Render body text for preset id. Falls back to id if unknown (should not happen
 * if DB and client are in sync).
 * @param {string} id
 * @returns {string}
 */
export function presetBody(id) {
  return BY_ID[id]?.body || id;
}

/**
 * Render subtitle for preset id.
 * @param {string} id
 * @returns {string}
 */
export function presetSubtitle(id) {
  return BY_ID[id]?.subtitle || '';
}
