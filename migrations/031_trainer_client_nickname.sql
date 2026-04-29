-- 031_trainer_client_nickname.sql
-- 트레이너가 회원에게 본인만 보는 nickname 부여 (예: "월수금 박씨").
-- trainer_clients_overview() RPC 도 nickname 노출.

ALTER TABLE trainer_clients
  ADD COLUMN IF NOT EXISTS nickname text;

CREATE INDEX IF NOT EXISTS idx_tc_trainer_nickname
  ON trainer_clients(trainer_id, nickname);

-- ─────────────────────────────────────────────────────
-- nickname 설정 RPC
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_set_client_nickname(
  p_relationship_id uuid,
  p_nickname text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  v_clean := NULLIF(trim(coalesce(p_nickname,'')), '');
  IF v_clean IS NOT NULL AND length(v_clean) > 40 THEN
    RAISE EXCEPTION 'nickname too long (max 40)';
  END IF;
  UPDATE trainer_clients
  SET nickname = v_clean
  WHERE id = p_relationship_id AND trainer_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'relationship not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_set_client_nickname TO authenticated;

-- ─────────────────────────────────────────────────────
-- trainer_clients_overview — nickname 컬럼 추가
-- ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS trainer_clients_overview();

CREATE OR REPLACE FUNCTION trainer_clients_overview()
RETURNS TABLE (
  relationship_id uuid,
  client_id uuid,
  display_name text,
  username text,
  nickname text,
  meal_total int,
  meal_clean int,
  meal_normal int,
  meal_red int,
  homework_status text,
  homework_total_sets int,
  homework_done_sets int,
  free_workout_count int,
  free_workout_done int,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF v_trainer_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    tc.id::uuid,
    p.id::uuid,
    p.display_name,
    p.username,
    tc.nickname,
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.meals,'[]'::jsonb))), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.meals,'[]'::jsonb)) m WHERE m->>'type' = 'green'), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.meals,'[]'::jsonb)) m WHERE m->>'type' = 'normal'), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.meals,'[]'::jsonb)) m WHERE m->>'type' = 'red' OR m->>'category' = 'alcohol'), 0),
    wa.status,
    COALESCE((SELECT SUM(jsonb_array_length(COALESCE(w->'sets','[]'::jsonb)))::int
              FROM jsonb_array_elements(COALESCE(wa.payload->'workouts','[]'::jsonb)) w), 0),
    COALESCE((SELECT SUM((SELECT count(*) FROM jsonb_array_elements(COALESCE(dlw->'sets','[]'::jsonb)) s
                          WHERE (s->>'done')::boolean IS TRUE))::int
              FROM jsonb_array_elements(COALESCE(dl.workouts,'[]'::jsonb)) dlw
              WHERE (dlw->>'_trainerAssignmentId')::uuid = wa.id), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.workouts,'[]'::jsonb)) w
              WHERE NOT (w ? '_trainerAssignmentId')), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.workouts,'[]'::jsonb)) w
              WHERE NOT (w ? '_trainerAssignmentId') AND w->>'status' = 'done'), 0),
    dl.updated_at
  FROM trainer_clients tc
  JOIN profiles p ON p.id = tc.client_id
  LEFT JOIN daily_logs dl ON dl.user_id = p.id AND dl.log_date = v_today
  LEFT JOIN LATERAL (
    SELECT id, status, payload FROM workout_assignments
    WHERE client_id = p.id AND trainer_id = v_trainer_id AND assigned_for_date = v_today
      AND status NOT IN ('cancelled','skipped')
    ORDER BY created_at DESC LIMIT 1
  ) wa ON true
  WHERE tc.trainer_id = v_trainer_id AND tc.status = 'active'
  ORDER BY COALESCE(tc.nickname, p.display_name, p.username) NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_clients_overview TO authenticated;
