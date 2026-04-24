// Stay Hard · friends
//
// Public entry. Called once at app bootstrap to register the sub-tab renderer
// and the inbox badge updater. Lazy: only mounts the UI when the user switches
// to the "친구" sub-tab.

import * as ui from './ui.js';
import * as nudgeApi from './nudge.js';
import { sb } from '../../lib/supabase.js';
import { presetBody } from './presets.js';

let _mounted = false;
let _badgeTickerId = null;

/**
 * Mount the friends sub-tab inside a container. Idempotent — safe to call
 * on every sub-tab activation.
 * @param {HTMLElement} root
 */
export async function mountFriendsTab(root) {
  if (!root) return;
  if (_mounted && root.firstElementChild) {
    // already mounted — just refresh
    await ui.refresh();
    return;
  }
  await ui.mount(root);
  _mounted = true;
}

/** Force a data refresh (call after external events like realtime nudge). */
export function refreshFriendsTab() {
  if (_mounted) ui.refresh();
}

/**
 * Poll unread nudge count every N seconds. Updates an element's text content
 * and hidden attribute. Also returns a stop function.
 * @param {HTMLElement|null} badgeEl
 * @param {number} [pollMs=60000]
 */
export function startUnreadBadgePoll(badgeEl, pollMs = 60000) {
  if (!badgeEl) return () => {};
  stopUnreadBadgePoll();
  const tick = async () => {
    const n = await nudgeApi.unreadCount();
    if (!n) {
      badgeEl.hidden = true;
      badgeEl.textContent = '';
    } else {
      badgeEl.hidden = false;
      badgeEl.textContent = n > 9 ? '9+' : String(n);
    }
  };
  tick();
  _badgeTickerId = setInterval(tick, pollMs);
  return stopUnreadBadgePoll;
}

export function stopUnreadBadgePoll() {
  if (_badgeTickerId) { clearInterval(_badgeTickerId); _badgeTickerId = null; }
}

// ── Realtime subscription for incoming nudges ─────────────────
// Listens to INSERT on public.nudges filtered to the current user. On hit:
// 1) Refresh inbox render (friends sub-tab, if mounted).
// 2) Bump the unread badge.
// 3) Show a top-center toast ("○○에서 nudge") as in-app notification.
// Falls back silently if realtime not configured for the table.
let _channel = null;
let _channelUserId = null;

/**
 * Start realtime subscription. Call once per session after auth.
 * @param {string} userId — auth.uid()
 * @param {HTMLElement|null} badgeEl — optional badge to live-increment
 */
export function startRealtimeNudges(userId, badgeEl) {
  if (!userId) return;
  if (_channel && _channelUserId === userId) return; // already subscribed
  stopRealtimeNudges();
  _channelUserId = userId;

  try {
    _channel = sb
      .channel(`friends-nudges-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'nudges',
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload?.new;
          if (!n) return;
          // Badge bump.
          if (badgeEl) {
            const cur = parseInt(badgeEl.textContent || '0', 10) || 0;
            const next = cur + 1;
            badgeEl.hidden = false;
            badgeEl.textContent = next > 9 ? '9+' : String(next);
          }
          // Toast — use window.showToast if available.
          const body = presetBody(n.preset_id);
          if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
            window.showToast(`친구에게서 nudge · ${body}`);
          }
          // If user is currently on friends sub-tab, refresh inbox.
          const subFriends = document.getElementById('sub-friends');
          if (subFriends && !subFriends.hidden) {
            ui.refresh();
          }
        }
      )
      .subscribe();
  } catch (e) {
    console.warn('[friends] realtime subscribe failed', e);
  }
}

export function stopRealtimeNudges() {
  if (_channel) {
    try { sb.removeChannel(_channel); } catch {}
    _channel = null;
    _channelUserId = null;
  }
}

export { ui as friendsUI, nudgeApi as nudgeAPI };
