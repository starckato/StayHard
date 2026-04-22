// Stay Hard · push notifications
//
// Native only. Registers with APNs/FCM, gets a device token, and persists it
// to Supabase `push_tokens` (table created by migrations/015_push_tokens.sql —
// migration pending).
//
// Web path: no-op. Web Push with VAPID is a separate effort (post-launch).
//
// Typical usage (call after auth succeeds):
//   import { registerForPush } from './platform/notifications.js';
//   const token = await registerForPush();

import { isNative, platform } from './platform.js';
import { sb } from '../lib/supabase.js';

/**
 * Request push permission and register this device.
 * Returns the native push token string, or null on web / permission denied.
 * Also upserts into Supabase `push_tokens` if CU is set.
 *
 * @returns {Promise<string|null>}
 */
export async function registerForPush() {
  if (!isNative()) return null;

  const mod = await import('@capacitor/push-notifications');
  const { PushNotifications } = mod;

  // Permission prompt
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return null;

  // Register — triggers native APNs/FCM registration
  await PushNotifications.register();

  return new Promise((resolve) => {
    let done = false;
    const finish = (token) => {
      if (done) return;
      done = true;
      resolve(token);
    };

    PushNotifications.addListener('registration', async (t) => {
      const token = t && t.value;
      if (!token) return finish(null);
      try { await _persistToken(token); } catch (e) { console.warn('[push-token persist]', e); }
      finish(token);
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.warn('[push-register]', err);
      finish(null);
    });

    // Safety timeout in case neither event fires (shouldn't happen)
    setTimeout(() => finish(null), 15000);
  });
}

async function _persistToken(token) {
  const CU = typeof window !== 'undefined' ? window.CU : null;
  if (!sb || !CU || !CU.id) return;
  const row = {
    user_id: CU.id,
    token,
    platform: platform(),
    updated_at: new Date().toISOString()
  };
  // Requires push_tokens table (migrations/015_push_tokens.sql). Silent on error
  // so missing table in dev doesn't crash auth flow.
  try {
    await sb.from('push_tokens').upsert(row, { onConflict: 'user_id,token' });
  } catch (e) {
    const msg = String(e && e.message || '');
    if (!msg.includes('push_tokens')) console.warn('[push-token upsert]', e);
  }
}

/**
 * Attach a listener for received notifications (foreground).
 * Returns an unsubscribe function.
 * @param {(n: any) => void} cb
 * @returns {Promise<() => void>}
 */
export async function onNotification(cb) {
  if (!isNative()) return () => {};
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const handle = await PushNotifications.addListener('pushNotificationReceived', cb);
  return () => { try { handle.remove(); } catch {} };
}

/**
 * Attach a listener for taps on notifications (foreground + background).
 * @param {(action: any) => void} cb
 * @returns {Promise<() => void>}
 */
export async function onNotificationTap(cb) {
  if (!isNative()) return () => {};
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const handle = await PushNotifications.addListener('pushNotificationActionPerformed', cb);
  return () => { try { handle.remove(); } catch {} };
}
