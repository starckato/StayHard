-- 032_trainer_self_edit.sql
-- 트레이너 본인 이름·소개 편집 RPC.

CREATE OR REPLACE FUNCTION trainer_update_self(
  p_trainer_name text,
  p_bio text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  v_name := trim(coalesce(p_trainer_name,''));
  IF length(v_name) < 1 THEN RAISE EXCEPTION 'name required'; END IF;
  IF length(v_name) > 30 THEN RAISE EXCEPTION 'name too long (max 30)'; END IF;
  UPDATE trainers
  SET trainer_name = v_name,
      bio = trim(coalesce(p_bio, bio, '')),
      updated_at = now()
  WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'trainer not found'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_update_self TO authenticated;
