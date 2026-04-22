// Stay Hard · analytics
//
// Fire-and-forget event logging to the `events` table. RLS enforces
// user_id = auth.uid(). Silent on failure — never blocks UI.
//
// Reads `window.CU` at call time (not at module load) because CU is set
// by the inline auth flow AFTER the bundle loads. Safe: guarded inside.

import { sb } from './supabase.js';

/**
 * Log a product event.
 * @param {string} eventName snake_case, stable across versions
 * @param {Record<string, unknown>} [meta] arbitrary JSON payload
 */
export function track(eventName, meta) {
  try {
    const CU = typeof window !== 'undefined' ? window.CU : null;
    if (!sb || !CU || !CU.id) return;
    sb.from('events')
      .insert({ user_id: CU.id, event_name: eventName, meta: meta || {} })
      .then(
        () => {},
        (e) => {
          const msg = String(e && e.message || '');
          // Silently ignore "events" table missing (migration not yet run in older envs).
          if (!msg.includes('events')) console.warn('[track]', eventName, e);
        }
      );
  } catch (e) {
    // Absolutely must not break callers.
  }
}
