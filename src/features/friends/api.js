// QROK · friends/api
//
// Thin wrappers over Supabase RPCs defined in migrations/016_friendships.sql
// and 018_friend_code.sql. Each function returns { ok, ... } or throws on
// transport error. RPC-level errors (e.g., rate_limit) come back as
// { ok:false, error:'...' } — callers should check .ok.

import { sb } from '../../lib/supabase.js';

/**
 * @typedef {Object} Friend
 * @property {string} friend_id
 * @property {string|null} display_name
 * @property {string} username
 * @property {string} friend_code
 * @property {string} tier
 * @property {number} streak
 * @property {boolean} moved_today
 * @property {string} friends_since
 */

/**
 * @typedef {Object} IncomingRequest
 * @property {string} id
 * @property {string} requester_id
 * @property {string|null} requester_display_name
 * @property {string} requester_username
 * @property {string} requester_tier
 * @property {string} created_at
 */

/**
 * Read my own friend_code from my profile row.
 * @returns {Promise<string|null>}
 */
export async function getMyFriendCode() {
  const { data, error } = await sb
    .from('profiles')
    .select('friend_code')
    .single();
  if (error) {
    console.warn('[friends] getMyFriendCode', error);
    return null;
  }
  // M4 metric: FRIEND_CODE_VIEWED (first-view only, dedupe per session via sessionStorage)
  try {
    if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem('friend_code_viewed')) {
      sessionStorage.setItem('friend_code_viewed', '1');
      if (window.logEvent && window.EVT) window.logEvent(window.EVT.FRIEND_CODE_VIEWED, {});
    }
  } catch {}
  return data?.friend_code || null;
}

/**
 * Rotate my friend_code (e.g., after spam).
 * @returns {Promise<string|null>}
 */
export async function rotateMyFriendCode() {
  const { data, error } = await sb.rpc('rotate_my_friend_code');
  if (error) { console.warn('[friends] rotate', error); return null; }
  return data || null;
}

/**
 * @param {string} code
 * @returns {Promise<{ok:boolean, error?:string, pending?:boolean, auto_accepted?:boolean}>}
 */
export async function sendFriendRequestByCode(code) {
  try { if (window.logEvent && window.EVT) window.logEvent(window.EVT.FRIEND_CODE_ENTERED, { code_head: (code||'').slice(0,3) }); } catch {}
  const { data, error } = await sb.rpc('send_friend_request_by_code', { p_code: code });
  if (error) return { ok: false, error: 'network' };
  const res = data || { ok: false, error: 'unknown' };
  if (res.ok) {
    try { if (window.logEvent && window.EVT) window.logEvent(window.EVT.FRIEND_ADDED, { auto_accepted: !!res.auto_accepted }); } catch {}
  }
  return res;
}

/**
 * @returns {Promise<Friend[]>}
 */
export async function listFriends() {
  const { data, error } = await sb.rpc('list_friends_with_status');
  if (error) { console.warn('[friends] list', error); return []; }
  return data || [];
}

/**
 * @returns {Promise<IncomingRequest[]>}
 */
export async function listIncomingRequests() {
  const { data, error } = await sb.rpc('list_incoming_friend_requests');
  if (error) { console.warn('[friends] incoming', error); return []; }
  return data || [];
}

/**
 * Accept or reject an incoming friend request.
 * @param {string} requestId
 * @param {boolean} accept
 */
export async function respondFriendRequest(requestId, accept) {
  const { data, error } = await sb.rpc('respond_friend_request', { p_id: requestId, p_accept: accept });
  if (error) return { ok: false, error: 'network' };
  return data || { ok: false, error: 'unknown' };
}

/**
 * Remove a friend (both sides).
 * @param {string} friendUserId
 */
export async function unfriend(friendUserId) {
  const { data, error } = await sb.rpc('unfriend', { p_friend_id: friendUserId });
  if (error) return { ok: false, error: 'network' };
  return data || { ok: false, error: 'unknown' };
}

/**
 * Block a user (replaces any existing friendship row).
 * @param {string} targetUserId
 */
export async function blockUser(targetUserId) {
  const { data, error } = await sb.rpc('block_user', { p_target_id: targetUserId });
  if (error) return { ok: false, error: 'network' };
  return data || { ok: false, error: 'unknown' };
}

/**
 * Unblock a user.
 * @param {string} targetUserId
 */
export async function unblockUser(targetUserId) {
  const { data, error } = await sb.rpc('unblock_user', { p_target_id: targetUserId });
  if (error) return { ok: false, error: 'network' };
  return data || { ok: false, error: 'unknown' };
}

/** Map RPC error codes to user-facing Korean copy (해요체 for System register). */
export const FRIEND_ERROR_COPY = {
  not_authenticated: '로그인이 필요해요.',
  bad_code:          '코드는 8글자여야 해요.',
  code_not_found:    '그런 코드는 없어요.',
  cannot_friend_self:'본인은 친구 추가 안 돼요.',
  already_friends:   '이미 친구예요.',
  already_pending:   '요청을 이미 보냈어요.',
  rate_limit_daily:  '오늘 요청 너무 많이 보냈어요.',
  not_found:         '요청을 찾을 수 없어요.',
  forbidden:         '권한 없음.',
  not_pending:       '이미 처리된 요청이에요.',
  not_friends:       '친구 관계가 아니에요.',
  cannot_block_self: '본인은 차단 못 해요.',
  not_blocked:       '차단되지 않은 유저예요.',
  network:           '연결을 확인해 주세요.',
  unknown:           '처리 중 오류가 났어요.',
};
