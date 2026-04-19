-- Migration: 013_delete_my_account.sql
-- Self-service account deletion — user deletes their own account + all data.
-- FK cascade from auth.users → profiles / events / bonus_grants / user_routines /
-- workout_uploads → daily_logs (via profiles). Also cleans up JSONB refs in
-- competitions (members list, member_wgoals, member_inbody_goals, recent_activity)
-- since FK can't be on JSONB.
--
-- Storage: orphaned objects in meal-photos/<user_id>/ and workout-videos/<user_id>/
-- remain in storage but RLS (per-user folder prefix) makes them unreadable
-- because auth.uid() will never match the deleted user's id again.

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_deleted int;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Clean competitions JSONB refs to this user (safe no-op if none match)
  UPDATE public.competitions
  SET
    members = COALESCE(
      (SELECT jsonb_agg(m) FROM jsonb_array_elements(members) m
       WHERE trim(both '"' FROM m::text) != v_user::text),
      '[]'::jsonb
    ),
    member_wgoals = COALESCE(member_wgoals, '{}'::jsonb) - v_user::text,
    member_inbody_goals = COALESCE(member_inbody_goals, '{}'::jsonb) - v_user::text,
    recent_activity = COALESCE(
      (SELECT jsonb_agg(a) FROM jsonb_array_elements(COALESCE(recent_activity,'[]'::jsonb)) a
       WHERE (a->>'user_id') IS DISTINCT FROM v_user::text),
      '[]'::jsonb
    )
  WHERE
    members ? v_user::text
    OR (member_wgoals IS NOT NULL AND member_wgoals ? v_user::text)
    OR (member_inbody_goals IS NOT NULL AND member_inbody_goals ? v_user::text)
    OR (recent_activity IS NOT NULL AND recent_activity::text LIKE '%'||v_user::text||'%');

  -- Delete auth.users row — cascades to all public.* tables via FK ON DELETE CASCADE
  DELETE FROM auth.users WHERE id = v_user;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'deleted', true, 'user_id', v_user);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM public;
REVOKE ALL ON FUNCTION public.delete_my_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
