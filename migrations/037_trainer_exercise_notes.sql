-- 037_trainer_exercise_notes.sql
-- 운동별 자세 메모 — 트레이너가 회원의 특정 운동에 대해 메모.
-- 회원이 그 운동을 앱에서 시작할 때 메모 표시.

CREATE TABLE IF NOT EXISTS trainer_exercise_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trainer_id, client_id, exercise_name)
);

CREATE INDEX IF NOT EXISTS idx_ten_trainer_client
  ON trainer_exercise_notes(trainer_id, client_id);
CREATE INDEX IF NOT EXISTS idx_ten_client_exercise
  ON trainer_exercise_notes(client_id, exercise_name);

ALTER TABLE trainer_exercise_notes ENABLE ROW LEVEL SECURITY;

-- 트레이너: 본인 메모 CRUD
DROP POLICY IF EXISTS "trainer manages own notes" ON trainer_exercise_notes;
CREATE POLICY "trainer manages own notes"
  ON trainer_exercise_notes FOR ALL TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

-- 회원: 본인에게 부여된 메모 SELECT 만
DROP POLICY IF EXISTS "client reads own notes" ON trainer_exercise_notes;
CREATE POLICY "client reads own notes"
  ON trainer_exercise_notes FOR SELECT TO authenticated
  USING (client_id = auth.uid());

-- ─────────────────────────────────────────────────────
-- RPC: 트레이너가 회원의 모든 운동 메모 list
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_list_exercise_notes(p_client_id uuid)
RETURNS TABLE (
  id uuid,
  exercise_name text,
  body text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer uuid := auth.uid();
BEGIN
  IF v_trainer IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM trainer_clients tc
    WHERE tc.trainer_id = v_trainer AND tc.client_id = p_client_id AND tc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'no active relationship';
  END IF;
  RETURN QUERY
  SELECT n.id, n.exercise_name, n.body, n.created_at, n.updated_at
  FROM trainer_exercise_notes n
  WHERE n.trainer_id = v_trainer AND n.client_id = p_client_id
  ORDER BY n.updated_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_list_exercise_notes TO authenticated;

-- ─────────────────────────────────────────────────────
-- RPC: upsert 메모 (없으면 insert, 있으면 body 갱신)
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_upsert_exercise_note(
  p_client_id uuid,
  p_exercise_name text,
  p_body text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer uuid := auth.uid();
  v_id uuid;
  v_clean_name text := NULLIF(trim(coalesce(p_exercise_name,'')), '');
  v_clean_body text := NULLIF(trim(coalesce(p_body,'')), '');
BEGIN
  IF v_trainer IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF v_clean_name IS NULL THEN RAISE EXCEPTION 'exercise_name required'; END IF;
  IF v_clean_body IS NULL THEN RAISE EXCEPTION 'body required'; END IF;
  IF length(v_clean_body) > 500 THEN RAISE EXCEPTION 'body too long (max 500)'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM trainer_clients tc
    WHERE tc.trainer_id = v_trainer AND tc.client_id = p_client_id AND tc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'no active relationship';
  END IF;
  INSERT INTO trainer_exercise_notes (trainer_id, client_id, exercise_name, body)
  VALUES (v_trainer, p_client_id, v_clean_name, v_clean_body)
  ON CONFLICT (trainer_id, client_id, exercise_name)
  DO UPDATE SET body = EXCLUDED.body, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_upsert_exercise_note TO authenticated;

-- ─────────────────────────────────────────────────────
-- RPC: delete 메모
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_delete_exercise_note(p_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer uuid := auth.uid();
BEGIN
  IF v_trainer IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  DELETE FROM trainer_exercise_notes
  WHERE id = p_note_id AND trainer_id = v_trainer;
  IF NOT FOUND THEN RAISE EXCEPTION 'note not found'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_delete_exercise_note TO authenticated;

-- ─────────────────────────────────────────────────────
-- RPC: 회원이 본인 운동 메모 fetch (특정 exercise 또는 전체)
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION client_get_exercise_notes(p_exercise_name text DEFAULT NULL)
RETURNS TABLE (
  exercise_name text,
  body text,
  trainer_name text,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT n.exercise_name, n.body, COALESCE(t.trainer_name, '트레이너'), n.updated_at
  FROM trainer_exercise_notes n
  LEFT JOIN trainers t ON t.id = n.trainer_id
  JOIN trainer_clients tc ON tc.trainer_id = n.trainer_id AND tc.client_id = n.client_id AND tc.status = 'active'
  WHERE n.client_id = v_uid
    AND (p_exercise_name IS NULL OR n.exercise_name = p_exercise_name)
  ORDER BY n.updated_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION client_get_exercise_notes TO authenticated;

NOTIFY pgrst, 'reload schema';
