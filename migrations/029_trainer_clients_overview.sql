-- 029_trainer_clients_overview.sql
-- 트레이너 대시보드용 — 회원별 오늘 식단 + 오늘 운동 집계.
-- 큐브/점수 컬럼 폐지 — 트레이너는 식단·운동 만 본다 (사용자 결정 2026-04-29).

CREATE OR REPLACE FUNCTION trainer_clients_overview()
RETURNS TABLE (
  client_id uuid,
  display_name text,
  username text,
  -- 식단 (오늘)
  meal_total int,
  meal_clean int,
  meal_normal int,
  meal_red int,        -- red + alcohol 합산
  -- 운동 (오늘)
  homework_status text,
  homework_total_sets int,
  homework_done_sets int,
  free_workout_count int,    -- 트레이너 배정 외 자유 운동 수
  free_workout_done int,     -- 자유 운동 중 status='done' 수
  -- 마지막 활동
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
    p.id::uuid,
    p.display_name,
    p.username,
    -- 식단 카운트
    COALESCE((
      SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.meals,'[]'::jsonb)) m
    ), 0),
    COALESCE((
      SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.meals,'[]'::jsonb)) m
      WHERE m->>'type' = 'green'
    ), 0),
    COALESCE((
      SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.meals,'[]'::jsonb)) m
      WHERE m->>'type' = 'normal'
    ), 0),
    COALESCE((
      SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.meals,'[]'::jsonb)) m
      WHERE m->>'type' = 'red' OR m->>'category' = 'alcohol'
    ), 0),
    -- 운동 — 오늘 assignment status
    wa.status,
    COALESCE((
      SELECT SUM(jsonb_array_length(COALESCE(w->'sets','[]'::jsonb)))::int
      FROM jsonb_array_elements(COALESCE(wa.payload->'workouts','[]'::jsonb)) w
    ), 0),
    -- 숙제 done 세트 수: daily_logs.workouts 에서 _trainerAssignmentId 매칭 + s.done=true
    COALESCE((
      SELECT SUM((
        SELECT count(*) FROM jsonb_array_elements(COALESCE(dlw->'sets','[]'::jsonb)) s
        WHERE (s->>'done')::boolean IS TRUE
      ))::int
      FROM jsonb_array_elements(COALESCE(dl.workouts,'[]'::jsonb)) dlw
      WHERE (dlw->>'_trainerAssignmentId')::uuid = wa.id
    ), 0),
    -- 자유 운동 — _trainerAssignmentId 없는 것
    COALESCE((
      SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.workouts,'[]'::jsonb)) w
      WHERE NOT (w ? '_trainerAssignmentId')
    ), 0),
    COALESCE((
      SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl.workouts,'[]'::jsonb)) w
      WHERE NOT (w ? '_trainerAssignmentId') AND w->>'status' = 'done'
    ), 0),
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
  ORDER BY p.display_name NULLS LAST, p.username NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_clients_overview TO authenticated;
