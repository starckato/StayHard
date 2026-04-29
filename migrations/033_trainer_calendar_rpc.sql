-- 033_trainer_calendar_rpc.sql
-- 트레이너 dashboard 캘린더용 RPC. 회원별 N일치 운동·식단 활동 집계.

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
    SELECT 1 FROM trainer_clients
    WHERE trainer_id = v_trainer_id AND client_id = p_client_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'no active trainer-client relationship';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(p_start::date, p_end::date, '1 day'::interval)::date AS d
  ),
  assignments AS (
    SELECT
      assigned_for_date AS d,
      id,
      status,
      payload
    FROM workout_assignments
    WHERE trainer_id = v_trainer_id AND client_id = p_client_id
      AND assigned_for_date BETWEEN p_start AND p_end
      AND status NOT IN ('cancelled')
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
    COALESCE((SELECT count(*)::int FROM trainer_messages WHERE trainer_id=v_trainer_id AND client_id=p_client_id AND sent_at::date = d.d), 0)
  FROM days d
  LEFT JOIN assignments a ON a.d = d.d
  LEFT JOIN daily_logs dl ON dl.user_id = p_client_id AND dl.log_date = d.d
  ORDER BY d.d;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_client_calendar TO authenticated;
