// 큐록 · Deep Link routing
//
// `/add/{code}` → friends 탭에서 친구 코드 prefill 로 오픈.
// Vercel wildcard rewrite 가 이미 `/:path* → /index.html` 이므로 서버 설정 추가 X.
// 네이티브 Capacitor 는 Custom URL Scheme `qrok://add/{code}` 예정 — Phase 2 rebrand 이후.
//
// Public API:
//   consumeInviteFromUrl()  — 현재 URL 에서 invite 코드 파싱 후 제거. 반환: code | null
//   applyInvite(code, friendsAPI) — UI 오픈 + prefill.

import { logEvent, EVT } from '../metrics/index.js';

/** Parse invite code from current URL. Supports:
 *  - ?invite=CODE query param (existing pattern)
 *  - /add/CODE path segment (new deeplink)
 * Returns normalized uppercase 8-char code or null. */
export function parseInviteFromLocation(location = window.location) {
  if (!location) return null;

  // 1) Path segment /add/:code
  const pathMatch = location.pathname && location.pathname.match(/^\/add\/([A-Za-z0-9-]+)\/?$/);
  if (pathMatch) {
    const raw = pathMatch[1].replace(/-/g, '').toUpperCase();
    if (raw.length >= 6 && raw.length <= 10) return raw.slice(0, 8);
  }

  // 2) Query ?invite=CODE
  try {
    const params = new URLSearchParams(location.search || '');
    const q = params.get('invite');
    if (q) {
      const raw = q.replace(/[\s-]/g, '').toUpperCase();
      if (raw.length === 8) return raw;
    }
  } catch {}

  return null;
}

/** Consume invite — parse + remove from URL (history.replaceState).
 * Returns the code (or null). Call once on app boot. */
export function consumeInviteFromUrl() {
  const code = parseInviteFromLocation();
  if (!code) return null;
  try {
    // Clean URL: rewrite to '/' keeping non-invite query params
    const params = new URLSearchParams(location.search || '');
    params.delete('invite');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname.replace(/^\/add\/[^/]+\/?$/, '/') + (qs ? '?' + qs : ''));
  } catch {}
  return code;
}

/** Build share URL for a friend code. */
export function buildInviteUrl(code, origin = window.location.origin) {
  return `${origin}/add/${code}`;
}

/** Capacitor deep link handler (native).
 *  Call once at boot: await registerNativeDeepLink(handler).
 *  Web: no-op. */
export async function registerNativeDeepLink(handler) {
  if (typeof window === 'undefined') return () => {};
  if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) {
    return () => {};
  }
  try {
    const { App } = await import('@capacitor/app');
    const h = await App.addListener('appUrlOpen', (event) => {
      try {
        const code = parseInviteFromLocation(new URL(event.url));
        if (code && typeof handler === 'function') handler(code);
      } catch (e) { console.warn('[deeplink] parse', e); }
    });
    return () => { try { h.remove(); } catch {} };
  } catch (e) {
    console.warn('[deeplink] native register', e);
    return () => {};
  }
}

/** Log when a friend code is entered via deep link vs manual. */
export function trackInviteSource(code, source /* 'deeplink' | 'manual' */) {
  try { logEvent(EVT.FRIEND_CODE_ENTERED, { code_head: code.slice(0,3), source }); } catch {}
}
