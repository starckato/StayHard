-- 036_trainer_weekly_summary.sql
-- 트레이너 Roster 뷰 (전체 회원 상태 한눈에) 용 — 최근 7일 + 시작체중/현재체중.
-- Feed 와 별개: Feed=오늘 액션, Roster=주간 trend.

CREATE OR REPLACE FUNCTION trainer_clients_weekly_summary()
RETURNS TABLE (
  relationship_id uuid,
  client_id uuid,
  display_name text,
  username text,
  nickname text,
  -- 관계
  relationship_started_at timestamptz,
  -- 최근 7일 숙제
  week_homework_total_sets int,
  week_homework_done_sets int,
  -- 최근 7일 식단
  week_meal_clean int,
  week_meal_red int,
  week_meal_total int,
  -- 체중
  start_weight numeric,
  current_weight numeric,
  weight_first_recorded_at date,
  weight_last_recorded_at date,
  -- 활성도
  week_active_days int,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer_id uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_week_start date := v_today - INTERVAL '6 days';
BEGIN
  IF v_trainer_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    tc.id::uuid,
    p.id::uuid,
    p.display_name,
    p.username,
    tc.nickname,
    tc.connected_at,
    -- 주간 숙제 합산
    COALESCE((
      SELECT SUM(jsonb_array_length(COALESCE(w->'sets','[]'::jsonb)))::int
      FROM workout_assignments wa
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(wa.payload->'workouts','[]'::jsonb)) w ON true
      WHERE wa.trainer_id = v_trainer_id AND wa.client_id = tc.client_id
        AND wa.assigned_for_date BETWEEN v_week_start AND v_today
        AND wa.status NOT IN ('cancelled','skipped')
    ), 0),
    COALESCE((
      SELECT SUM((
        SELECT count(*) FROM jsonb_array_elements(COALESCE(dlw->'sets','[]'::jsonb)) s
        WHERE (s->>'done')::boolean IS TRUE
      ))::int
      FROM workout_assignments wa
      LEFT JOIN daily_logs dl2 ON dl2.user_id = tc.client_id AND dl2.log_date = wa.assigned_for_date
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(dl2.workouts,'[]'::jsonb)) dlw ON true
      WHERE wa.trainer_id = v_trainer_id AND wa.client_id = tc.client_id
        AND wa.assigned_for_date BETWEEN v_week_start AND v_today
        AND wa.status NOT IN ('cancelled','skipped')
        AND (dlw->>'_trainerAssignmentId')::uuid = wa.id
    ), 0),
    -- 주간 식단
    COALESCE((
      SELECT SUM((
        SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl3.meals,'[]'::jsonb)) m
        WHERE m->>'type' = 'green'
      ))::int FROM daily_logs dl3
      WHERE dl3.user_id = tc.client_id AND dl3.log_date BETWEEN v_week_start AND v_today
    ), 0),
    COALESCE((
      SELECT SUM((
        SELECT count(*)::int FROM jsonb_array_elements(COALESCE(dl3.meals,'[]'::jsonb)) m
        WHERE m->>'type' = 'red' OR m->>'category' = 'alcohol'
      ))::int FROM daily_logs dl3
      WHERE dl3.user_id = tc.client_id AND dl3.log_date BETWEEN v_week_start AND v_today
    ), 0),
    COALESCE((
      SELECT SUM(jsonb_array_length(COALESCE(dl3.meals,'[]'::jsonb)))::int FROM daily_logs dl3
      WHERE dl3.user_id = tc.client_id AND dl3.log_date BETWEEN v_week_start AND v_today
    ), 0),
    -- 시작 체중 — 관계 시작 이후 첫 기록 (없으면 전체 기간 첫 기록)
    (
      SELECT dl4.weight FROM daily_logs dl4
      WHERE dl4.user_id = tc.client_id AND dl4.weight IS NOT NULL
        AND dl4.log_date >= tc.connected_at::date
      ORDER BY dl4.log_date ASC LIMIT 1
    ),
    -- 현재 체중 — 가장 최근 기록
    (
      SELECT dl5.weight FROM daily_logs dl5
      WHERE dl5.user_id = tc.client_id AND dl5.weight IS NOT NULL
      ORDER BY dl5.log_date DESC LIMIT 1
    ),
    (
      SELECT dl4b.log_date FROM daily_logs dl4b
      WHERE dl4b.user_id = tc.client_id AND dl4b.weight IS NOT NULL
        AND dl4b.log_date >= tc.connected_at::date
      ORDER BY dl4b.log_date ASC LIMIT 1
    ),
    (
      SELECT dl5b.log_date FROM daily_logs dl5b
      WHERE dl5b.user_id = tc.client_id AND dl5b.weight IS NOT NULL
      ORDER BY dl5b.log_date DESC LIMIT 1
    ),
    -- 주간 활성 일수
    COALESCE((
      SELECT count(*)::int FROM daily_logs dl6
      WHERE dl6.user_id = tc.client_id
        AND dl6.log_date BETWEEN v_week_start AND v_today
        AND (jsonb_array_length(COALESCE(dl6.meals,'[]'::jsonb)) > 0
             OR jsonb_array_length(COALESCE(dl6.workouts,'[]'::jsonb)) > 0
             OR dl6.weight IS NOT NULL)
    ), 0),
    -- 마지막 활동
    (
      SELECT MAX(dl7.updated_at) FROM daily_logs dl7
      WHERE dl7.user_id = tc.client_id
    )
  FROM trainer_clients tc
  JOIN profiles p ON p.id = tc.client_id
  WHERE tc.trainer_id = v_trainer_id AND tc.status = 'active'
  ORDER BY COALESCE(tc.nickname, p.display_name, p.username) NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_clients_weekly_summary TO authenticated;
NOTIFY pgrst, 'reload schema';
