-- 034_fix_ambiguous_client_id.sql
-- 원인: trainer_clients_overview / trainer_client_calendar 의 RETURNS TABLE 에서
--      client_id 가 OUT 파라미터로 선언됨 + 함수 내부 SELECT 에서 unqualified
--      `client_id` 가 테이블 컬럼인지 OUT 파라미터인지 ambiguous.
-- Fix: 함수 내부 모든 SELECT 에서 client_id 를 명시적으로 qualify (tc., wa., dl. 등)

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
  LEFT JOIN daily_logs dl ON dl.user_id = tc.client_id AND dl.log_date = v_today
  LEFT JOIN LATERAL (
    SELECT wa2.id, wa2.status, wa2.payload FROM workout_assignments wa2
    WHERE wa2.client_id = tc.client_id AND wa2.trainer_id = v_trainer_id AND wa2.assigned_for_date = v_today
      AND wa2.status NOT IN ('cancelled','skipped')
    ORDER BY wa2.created_at DESC LIMIT 1
  ) wa ON true
  WHERE tc.trainer_id = v_trainer_id AND tc.status = 'active'
  ORDER BY COALESCE(tc.nickname, p.display_name, p.username) NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_clients_overview TO authenticated;

-- ─────────────────────────────────────────────────────
-- trainer_client_calendar 도 동일 fix
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_client_calendar(
  p_client_id uuid,
  p_start date,
  p_end date
) RETURNS TABLE (
  log_date date,
  assignment_id uuid,
  assignment_status text,
  homework_total int,
  homework_done int,
  meal_total int,
  meal_clean int,
  meal_red int,
  free_workout_count int,
  free_workout_done int,
  trainer_msg_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer_id uuid := auth.uid();
BEGIN
  IF v_trainer_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM trainer_clients tc
    WHERE tc.trainer_id = v_trainer_id AND tc.client_id = p_client_id AND tc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'no active trainer-client relationship';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(p_start::date, p_end::date, '1 day'::interval)::date AS d
  ),
  assignments AS (
    SELECT
      wa.assigned_for_date AS d,
      wa.id,
      wa.status,
      wa.payload
    FROM workout_assignments wa
    WHERE wa.trainer_id = v_trainer_id AND wa.client_id = p_client_id
      AND wa.assigned_for_date BETWEEN p_start AND p_end
      AND wa.status NOT IN ('cancelled')
  )
  SELECT
    d.d,
    a.id,
    a.status,
    COALESCE((
      SELECT SUM(jsonb_array_length(COALESCE(w->'sets','[]'::jsonb)))::int
      FROM jsonb_array_elements(COALESCE(a.payload->'workouts','[]'::jsonb)) w
    ), 0),
    COALESCE((
      SELECT SUM((
        SELECT count(*) FROM jsonb_array_elements(COALESCE(dlw->'sets','[]'::jsonb)) s
        WHERE (s->>'done')::boolean IS TRUE
      ))::int
      FROM daily_logs dl2
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(dl2.workouts,'[]'::jsonb)) dlw ON true
      WHERE dl2.user_id = p_client_id AND dl2.log_date = d.d
        AND (dlw->>'_trainerAssignmentId')::uuid = a.id
    ), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.meals,'[]'::jsonb))), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.meals,'[]'::jsonb)) m WHERE m->>'type'='green'), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.meals,'[]'::jsonb)) m WHERE m->>'type'='red' OR m->>'category'='alcohol'), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.workouts,'[]'::jsonb)) w WHERE NOT (w ? '_trainerAssignmentId')), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.workouts,'[]'::jsonb)) w WHERE NOT (w ? '_trainerAssignmentId') AND w->>'status'='done'), 0),
    COALESCE((SELECT count(*)::int FROM trainer_messages tm WHERE tm.trainer_id=v_trainer_id AND tm.client_id=p_client_id AND tm.sent_at::date = d.d), 0)
  FROM days d
  LEFT JOIN assignments a ON a.d = d.d
  LEFT JOIN daily_logs dl ON dl.user_id = p_client_id AND dl.log_date = d.d
  ORDER BY d.d;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_client_calendar TO authenticated;

NOTIFY pgrst, 'reload schema';
