-- Sprint G: Live activity ticker in challenge rooms
-- Adds a small activity feed column to competitions that members can all read/append.
--
-- SAFETY:
--   - Non-destructive: ADD COLUMN with default
--   - Default is empty array (no data migration needed)
--   - Existing rows unaffected
--
-- Run via Supabase Dashboard > SQL Editor, or `supabase db push` if using CLI.

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS recent_activity jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN competitions.recent_activity IS
  'Rolling activity feed — array of {user_id, display_name, pts, type, icon, ts}. Capped client-side at 20 most recent.';

-- NOTE on RLS: we do NOT need a new policy.
-- Existing competitions RLS (SELECT/UPDATE allowed to members) already covers this column.
-- Any member of a competition can:
--   - read recent_activity via SELECT on competitions row
--   - append via UPDATE (client merges the new entry and writes back the full array)
