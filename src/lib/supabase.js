// QROK · Supabase client
//
// Single shared client. Created from SB_URL/SB_KEY at module load (bundle
// execution time, which happens BEFORE inline body scripts — see IIFE load
// order in index.html head).
//
// Depends on the global `supabase` UMD (loaded via CDN <script> in <head>
// BEFORE this bundle). If the CDN fails, `window.supabase` will be undefined
// and this module throws at load — which is correct fail-fast behavior.

import { SB_URL, SB_KEY } from './env.js';

if (typeof window === 'undefined' || !window.supabase || !window.supabase.createClient) {
  throw new Error('[qrok/supabase] Supabase UMD not loaded. Check CDN script order in index.html.');
}

/** Shared Supabase client (auth + postgrest + storage). */
export const sb = window.supabase.createClient(SB_URL, SB_KEY);
