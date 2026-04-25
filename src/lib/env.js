// QROK · environment configuration
//
// Phase 2 (temporary inline constants). Phase 4 will replace these with
// esbuild `define` options sourced from Vercel environment variables.
//
// Security note: SB_KEY is the Supabase anon (public) key — designed to be
// exposed client-side. It is NOT a service role key. RLS policies enforce
// per-row access control on every table.

/** Supabase project URL. */
export const SB_URL = 'https://uvaosxhsjscigheyymus.supabase.co';

/** Supabase anon (public) key. Row-Level Security gates all queries. */
export const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2YW9zeGhzanNjaWdoZXl5bXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1ODExNjQsImV4cCI6MjA5MDE1NzE2NH0.aS1ZxN0ds8CUs3q_dMTFlEwjvNFgCH7JwY-tg4q0NA8';
