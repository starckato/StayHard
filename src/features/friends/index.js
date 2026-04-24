// Stay Hard · friends
//
// Public entry. Called once at app bootstrap to register the sub-tab renderer
// and the inbox badge updater. Lazy: only mounts the UI when the user switches
// to the "친구" sub-tab.

import * as ui from './ui.js';
import * as nudgeApi from './nudge.js';

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

export { ui as friendsUI, nudgeApi as nudgeAPI };
