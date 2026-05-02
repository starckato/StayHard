-- 045_trainer_overview_yesterday_meals.sql
-- trainer_clients_overview 확장: 어제 식단 카운트 (어제 식단 기록 안 한 사람 alert 용)
-- 신규 컬럼: yesterday_meal_total, yesterday_meal_clean, yesterday_meal_red

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
  meals_today jsonb,
  homework_status text,
  homework_total_sets int,
  homework_done_sets int,
  free_workout_count int,
  free_workout_done int,
  yesterday_homework_status text,
  yesterday_homework_total_sets int,
  yesterday_homework_done_sets int,
  yesterday_meal_total int,
  yesterday_meal_clean int,
  yesterday_meal_red int,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_yesterday date := v_today - INTERVAL '1 day';
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
    COALESCE(dl.meals, '[]'::jsonb),
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
    wa_y.status,
    COALESCE((SELECT SUM(jsonb_array_length(COALESCE(w->'sets','[]'::jsonb)))::int
              FROM jsonb_array_elements(COALESCE(wa_y.payload->'workouts','[]'::jsonb)) w), 0),
    COALESCE((SELECT SUM((SELECT count(*) FROM jsonb_array_elements(COALESCE(dlw_y->'sets','[]'::jsonb)) s
                          WHERE (s->>'done')::boolean IS TRUE))::int
              FROM jsonb_array_elements(COALESCE(dl_y.workouts,'[]'::jsonb)) dlw_y
              WHERE (dlw_y->>'_trainerAssignmentId')::uuid = wa_y.id), 0),
    -- 어제 식단 합산
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl_y.meals,'[]'::jsonb))), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl_y.meals,'[]'::jsonb)) m WHERE m->>'type' = 'green'), 0),
    COALESCE((SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl_y.meals,'[]'::jsonb)) m WHERE m->>'type' = 'red' OR m->>'category' = 'alcohol'), 0),
    dl.updated_at
  FROM trainer_clients tc
  JOIN profiles p ON p.id = tc.client_id
  LEFT JOIN daily_logs dl ON dl.user_id = tc.client_id AND dl.log_date = v_today
  LEFT JOIN daily_logs dl_y ON dl_y.user_id = tc.client_id AND dl_y.log_date = v_yesterday
  LEFT JOIN LATERAL (
    SELECT wa2.id, wa2.status, wa2.payload FROM workout_assignments wa2
    WHERE wa2.client_id = tc.client_id AND wa2.trainer_id = v_trainer_id
      AND wa2.assigned_for_date = v_today
      AND wa2.status NOT IN ('cancelled','skipped')
    ORDER BY wa2.created_at DESC LIMIT 1
  ) wa ON true
  LEFT JOIN LATERAL (
    SELECT wa3.id, wa3.status, wa3.payload FROM workout_assignments wa3
    WHERE wa3.client_id = tc.client_id AND wa3.trainer_id = v_trainer_id
      AND wa3.assigned_for_date = v_yesterday
      AND wa3.status NOT IN ('cancelled','skipped')
    ORDER BY wa3.created_at DESC LIMIT 1
  ) wa_y ON true
  WHERE tc.trainer_id = v_trainer_id AND tc.status = 'active'
  ORDER BY COALESCE(tc.nickname, p.display_name, p.username) NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_clients_overview TO authenticated;
NOTIFY pgrst, 'reload schema';
