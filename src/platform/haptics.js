// QROK · haptic feedback
//
// Native (iOS/Android): @capacitor/haptics with Impact/Notification styles.
// Web: noop (browser vibration API is unreliable on iOS Safari).

import { isNative } from './platform.js';

async function _capacitorHaptics() {
  try {
    const mod = await import('@capacitor/haptics');
    return mod;
  } catch { return null; }
}

/** Soft/medium/heavy tap feedback. Default: light. */
export async function tap(style = 'light') {
  if (!isNative()) return;
  const hap = await _capacitorHaptics();
  if (!hap) return;
  const { Haptics, ImpactStyle } = hap;
  try {
    await Haptics.impact({ style: ImpactStyle[style[0].toUpperCase() + style.slice(1)] || ImpactStyle.Light });
  } catch {}
}

/** Success/Warning/Error notification haptic. */
export async function notify(type = 'success') {
  if (!isNative()) return;
  const hap = await _capacitorHaptics();
  if (!hap) return;
  const { Haptics, NotificationType } = hap;
  const map = { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error };
  try { await Haptics.notification({ type: map[type] || map.success }); } catch {}
}

/** Quick selection click (softer than tap). */
export async function select() {
  if (!isNative()) return;
  const hap = await _capacitorHaptics();
  if (!hap) return;
  try { await hap.Haptics.selectionChanged(); } catch {}
}
