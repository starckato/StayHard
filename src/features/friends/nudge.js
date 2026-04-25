// QROK · friends/nudge
//
// Nudge send + inbox RPCs (migrations/017_nudges.sql). Server-side rate limits
// are authoritative; this module also mirrors limits locally for instant UX
// (button disable, eager error copy) before the round-trip.

import { sb } from '../../lib/supabase.js';

/**
 * @param {string} recipientId
 * @param {string} presetId
 */
export async function sendNudge(recipientId, presetId) {
  const { data, error } = await sb.rpc('send_nudge', {
    p_recipient: recipientId,
    p_preset_id: presetId,
  });
  if (error) return { ok: false, error: 'network' };
  const res = data || { ok: false, error: 'unknown' };
  if (res.ok) {
    try { if (window.logEvent && window.EVT) window.logEvent(window.EVT.NUDGE_SENT, { preset_id: presetId }); } catch {}
  }
  return res;
}

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.unreadOnly=false]
 * @param {number} [opts.limit=50]
 */
export async function listInbox(opts = {}) {
  const { unreadOnly = false, limit = 50 } = opts;
  const { data, error } = await sb.rpc('list_nudge_inbox', {
    p_unread_only: unreadOnly,
    p_limit: limit,
  });
  if (error) { console.warn('[nudge] inbox', error); return []; }
  return data || [];
}

/** @param {string[]} ids */
export async function markRead(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const { data, error } = await sb.rpc('mark_nudges_read', { p_ids: ids });
  if (error) { console.warn('[nudge] markRead', error); return 0; }
  return data || 0;
}

/** Unread count for the tab badge. */
export async function unreadCount() {
  const { data, error } = await sb.rpc('unread_nudge_count');
  if (error) { console.warn('[nudge] unread', error); return 0; }
  return data || 0;
}

export const NUDGE_ERROR_COPY = {
  not_authenticated: '로그인이 필요해요.',
  cannot_nudge_self: '본인에게는 못 보내요.',
  bad_preset:        '알 수 없는 메시지예요.',
  not_friends:       '친구 관계가 아니에요.',
  pair_daily_limit:  '오늘은 이 친구에게 이미 보냈어요.',
  total_daily_limit: '오늘 nudge 5개 다 썼어요.',
  cooldown:          '4시간 뒤에 다시 보낼 수 있어요.',
  network:           '연결을 확인해 주세요.',
  unknown:           '처리 중 오류가 났어요.',
};
