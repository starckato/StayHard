-- Sprint H: Tighten competitions RLS + atomic join RPC
--
-- BEFORE:  Any authenticated user could UPDATE any competition row
--          (boot members, rewrite weight goals, spam activity feed, etc.)
--
-- AFTER:   UPDATE only permitted to creator or existing members.
--          DELETE only permitted to creator.
--          JOIN flow uses SECURITY DEFINER RPC that validates atomically.
--
-- SAFETY:
--   - Migration is idempotent (CREATE OR REPLACE, IF EXISTS, drop-then-create)
--   - SELECT remains permissive (needed for join-by-code lookup; codes are secret)
--   - Rollback snippet at bottom (commented out)
--
-- Run via Supabase Dashboard > SQL Editor.

-- ─── 1. SECURITY DEFINER RPC for atomic joining ───
-- Runs with elevated privileges (bypasses RLS), validates that caller has
-- actually reached the competition via its secret code.
CREATE OR REPLACE FUNCTION join_competition_by_code(
  p_code text,
  p_weight_goal numeric DEFAULT NULL,
  p_inbody_goals jsonb DEFAULT NULL
) RETURNS competitions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp competitions;
  v_user uuid := auth.uid();
  v_members jsonb;
  v_wgoals jsonb;
  v_inbody jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_comp FROM competitions WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Competition not found';
  END IF;

  -- Already a member or creator -> return as-is
  IF v_comp.creator_id = v_user OR v_comp.members::jsonb ? v_user::text THEN
    RETURN v_comp;
  END IF;

  -- Capacity check
  IF jsonb_array_length(v_comp.members::jsonb) >= COALESCE(v_comp.max_members, 6) THEN
    RAISE EXCEPTION 'Competition full';
  END IF;

  -- Append member + optional weight/inbody goals
  v_members := v_comp.members::jsonb || to_jsonb(v_user::text);
  v_wgoals := COALESCE(v_comp.member_wgoals, '{}'::jsonb);
  IF p_weight_goal IS NOT NULL THEN
    v_wgoals := v_wgoals || jsonb_build_object(v_user::text, p_weight_goal);
  END IF;
  v_inbody := v_comp.member_inbody_goals;
  IF p_inbody_goals IS NOT NULL THEN
    v_inbody := COALESCE(v_inbody, '{}'::jsonb) || jsonb_build_object(v_user::text, p_inbody_goals);
  END IF;

  UPDATE competitions
    SET members = v_members,
        member_wgoals = v_wgoals,
        member_inbody_goals = v_inbody,
        status = CASE WHEN status = 'waiting' THEN 'active' ELSE status END,
        start_date = COALESCE(start_date, CURRENT_DATE)
    WHERE id = v_comp.id
    RETURNING * INTO v_comp;

  RETURN v_comp;
END;
$$;

GRANT EXECUTE ON FUNCTION join_competition_by_code(text, numeric, jsonb) TO authenticated;


-- ─── 2. Drop all existing competitions policies ───
-- Idempotent: loops over every policy currently attached to competitions.
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'competitions'
  LOOP
    EXECUTE format('DROP POLICY %I ON competitions', r.policyname);
  END LOOP;
END $$;


-- ─── 3. New strict policies ───

-- SELECT: any authenticated user (join-by-code needs this; codes are secret strings)
CREATE POLICY competitions_authenticated_select ON competitions
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: creator must equal the authenticated user
CREATE POLICY competitions_creator_insert ON competitions
  FOR INSERT TO authenticated
  WITH CHECK (creator_id = auth.uid());

-- UPDATE: only creator or existing members of THIS competition row
CREATE POLICY competitions_member_update ON competitions
  FOR UPDATE TO authenticated
  USING (
    creator_id = auth.uid()
    OR (members::jsonb ? auth.uid()::text)
  )
  WITH CHECK (
    creator_id = auth.uid()
    OR (members::jsonb ? auth.uid()::text)
  );

-- DELETE: only the creator
CREATE POLICY competitions_creator_delete ON competitions
  FOR DELETE TO authenticated
  USING (creator_id = auth.uid());


-- ─── 4. Verification queries (run manually after migration to confirm) ───
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'competitions' ORDER BY cmd;
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'join_competition_by_code';


-- ─── ROLLBACK SNIPPET (uncomment + run if the tightening breaks a flow) ───
-- DO $$ DECLARE r record;
-- BEGIN
--   FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'competitions' LOOP
--     EXECUTE format('DROP POLICY %I ON competitions', r.policyname);
--   END LOOP;
-- END $$;
-- CREATE POLICY competitions_open_all ON competitions
--   FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- DROP FUNCTION IF EXISTS join_competition_by_code(text, numeric, jsonb);
