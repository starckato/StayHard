// QROK · platform detection
//
// Thin wrapper around Capacitor's runtime detection. In web (Vercel) builds,
// `window.Capacitor` is undefined so we return 'web'. In native (iOS/Android)
// builds, Capacitor injects its global at page load.
//
// Usage (from any module or inline):
//   import { isNative, platform } from './platform/platform.js';
//   if (isNative()) { /* use Capacitor API */ }

/**
 * Whether the app is running inside a Capacitor native shell (iOS or Android).
 * @returns {boolean}
 */
export function isNative() {
  return (
    typeof window !== 'undefined' &&
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform()
  );
}

/**
 * Platform slug: 'ios' | 'android' | 'web'.
 * @returns {'ios'|'android'|'web'}
 */
export function platform() {
  if (typeof window === 'undefined') return 'web';
  const cap = window.Capacitor;
  if (!cap || typeof cap.getPlatform !== 'function') return 'web';
  const p = cap.getPlatform();
  return p === 'ios' || p === 'android' ? p : 'web';
}

/** `'web'`-checks convenience. */
export function isWeb() {
  return platform() === 'web';
}
