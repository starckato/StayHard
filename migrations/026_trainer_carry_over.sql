-- 026_trainer_carry_over.sql
-- 어제 미완료 숙제 자동 carry-over + 트레이너 알림 + dashboard sync
-- 사용자 결정 2026-04-29.
--
-- 흐름:
-- 1. 매 클라 앱 진입 시 process_homework_carryover() 호출
-- 2. 어제 status≠completed 인 workout_assignments 찾음
-- 3. 같은 payload 로 오늘 날짜에 새 assignment 생성 + daily_logs.workouts insert
-- 4. 옛 assignment status='skipped' + carried_over_to=새 assignment id
-- 5. 트레이너에게 trainer_messages preset='workout_missed' 자동 insert

-- ─────────────────────────────────────────────────────
-- 1. workout_assignments 에 carry-over 추적 column
-- ─────────────────────────────────────────────────────
ALTER TABLE workout_assignments
  ADD COLUMN IF NOT EXISTS carried_over_from uuid REFERENCES workout_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS carried_over_to uuid REFERENCES workout_assignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assignments_carryover_from
  ON workout_assignments(carried_over_from) WHERE carried_over_from IS NOT NULL;

-- ─────────────────────────────────────────────────────
-- 2. process_homework_carryover RPC
--    클라가 호출. 어제 미완료 → 오늘로 carry-over.
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION process_homework_carryover()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_yesterday date := v_today - INTERVAL '1 day';
  v_assignment record;
  v_new_id uuid;
  v_carried int := 0;
  v_msg_count int := 0;
  v_new_workouts jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','unauthenticated'); END IF;

  -- 어제 미완료 + carry-over 안 된 assignments 처리
  FOR v_assignment IN
    SELECT * FROM workout_assignments
    WHERE client_id = v_uid
      AND assigned_for_date = v_yesterday
      AND status NOT IN ('completed','skipped')
      AND carried_over_to IS NULL
  LOOP
    -- 1. 새 assignment (오늘 날짜) 생성
    INSERT INTO workout_assignments (
      trainer_id, client_id, assigned_for_date, payload, status, carried_over_from
    )
    VALUES (
      v_assignment.trainer_id, v_uid, v_today, v_assignment.payload, 'pending', v_assignment.id
    )
    RETURNING id INTO v_new_id;

    -- 2. 옛 assignment 종료 표시
    UPDATE workout_assignments
    SET status = 'skipped', carried_over_to = v_new_id
    WHERE id = v_assignment.id;

    -- 3. daily_logs.workouts 에 새 운동 row insert (오늘)
    v_new_workouts := (
      SELECT jsonb_agg(
        jsonb_set(
          jsonb_set(elem, '{_trainerAssignmentId}', to_jsonb(v_new_id::text)),
          '{_assignedBy}', to_jsonb(v_assignment.trainer_id::text)
        )
      )
      FROM jsonb_array_elements(COALESCE(v_assignment.payload->'workouts','[]'::jsonb)) elem
    );

    IF EXISTS (SELECT 1 FROM daily_logs WHERE user_id=v_uid AND log_date=v_today) THEN
      UPDATE daily_logs
      SET workouts = COALESCE(workouts,'[]'::jsonb) || COALESCE(v_new_workouts,'[]'::jsonb),
          updated_at = now()
      WHERE user_id = v_uid AND log_date = v_today;
    ELSE
      INSERT INTO daily_logs (user_id, log_date, workouts)
      VALUES (v_uid, v_today, COALESCE(v_new_workouts,'[]'::jsonb));
    END IF;

    -- 4. 트레이너에게 알림 — preset workout_missed
    INSERT INTO trainer_messages (trainer_id, client_id, msg_type, preset_id, body)
    VALUES (
      v_assignment.trainer_id,
      v_uid,
      'preset',
      'workout_missed',
      '회원이 어제 숙제를 완료하지 못했습니다. 오늘로 자동 carry-over 됨.'
    );
    v_msg_count := v_msg_count + 1;
    v_carried := v_carried + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'carried_over', v_carried,
    'messages_sent', v_msg_count,
    'today', v_today
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_homework_carryover TO authenticated;

-- ─────────────────────────────────────────────────────
-- 3. trainer_messages 의 trainer_id RLS — 자동 insert 도 통과
--    기존 정책 (trainer_id = auth.uid()) 와 충돌 안 하게:
--    SECURITY DEFINER 함수 안에서 INSERT 하므로 RLS 우회됨. OK.
-- ─────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────
-- 4. 트레이너 dashboard용: 회원별 오늘 숙제 진행 상태 RPC
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_clients_homework_status()
RETURNS TABLE (
  client_id uuid,
  display_name text,
  username text,
  total_score int,
  today_assignment_id uuid,
  today_status text,
  today_total_sets int,
  today_done_sets int,
  last_assignment_date date
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
    COALESCE(p.total_score, 0)::int,
    wa.id,
    wa.status,
    COALESCE((
      SELECT SUM(jsonb_array_length(COALESCE(w->'sets','[]'::jsonb)))
      FROM jsonb_array_elements(COALESCE(wa.payload->'workouts','[]'::jsonb)) w
    ), 0)::int AS total_sets,
    COALESCE((
      SELECT SUM((
        SELECT count(*) FROM jsonb_array_elements(COALESCE(dlw->'sets','[]'::jsonb)) s
        WHERE (s->>'done')::boolean IS TRUE
      ))
      FROM daily_logs dl
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(dl.workouts,'[]'::jsonb)) dlw ON true
      WHERE dl.user_id = p.id
        AND dl.log_date = v_today
        AND (dlw->>'_trainerAssignmentId')::uuid = wa.id
    ), 0)::int AS done_sets,
    (
      SELECT MAX(assigned_for_date) FROM workout_assignments
      WHERE client_id = p.id AND trainer_id = v_trainer_id
    ) AS last_date
  FROM trainer_clients tc
  JOIN profiles p ON p.id = tc.client_id
  LEFT JOIN LATERAL (
    SELECT id, status, payload FROM workout_assignments
    WHERE client_id = p.id AND trainer_id = v_trainer_id AND assigned_for_date = v_today
    ORDER BY created_at DESC LIMIT 1
  ) wa ON true
  WHERE tc.trainer_id = v_trainer_id AND tc.status = 'active'
  ORDER BY p.display_name NULLS LAST, p.username NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_clients_homework_status TO authenticated;

-- ─────────────────────────────────────────────────────
-- DONE
-- ─────────────────────────────────────────────────────
