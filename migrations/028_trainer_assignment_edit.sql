-- 028_trainer_assignment_edit.sql
-- 트레이너가 배정한 운동 수정/삭제 RPC.
-- 사용자 결정 2026-04-29.

-- 023 의 status CHECK 확장: 'cancelled' 추가 (소프트 삭제용)
ALTER TABLE workout_assignments
  DROP CONSTRAINT IF EXISTS workout_assignments_status_check;
ALTER TABLE workout_assignments
  ADD CONSTRAINT workout_assignments_status_check
  CHECK (status IN ('pending','in_progress','completed','skipped','cancelled'));

-- ─────────────────────────────────────────────────────
-- 1. trainer_update_assignment — 배정 운동 payload 교체
--    클라가 이미 진행 중인 항목도 reset 됨 (UI 에서 confirm 필수).
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_update_assignment(
  p_assignment_id uuid,
  p_new_payload jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer_id uuid := auth.uid();
  v_assignment record;
  v_new_workouts jsonb;
  v_remaining_workouts jsonb;
BEGIN
  IF v_trainer_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_assignment FROM workout_assignments
    WHERE id = p_assignment_id AND trainer_id = v_trainer_id;
  IF v_assignment IS NULL THEN RAISE EXCEPTION 'assignment not found'; END IF;
  IF v_assignment.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'cannot edit completed or cancelled assignment';
  END IF;

  -- 새 payload 의 workouts 에 _trainerAssignmentId 마킹
  v_new_workouts := (
    SELECT jsonb_agg(
      jsonb_set(
        jsonb_set(elem, '{_trainerAssignmentId}', to_jsonb(p_assignment_id::text)),
        '{_assignedBy}', to_jsonb(v_trainer_id::text)
      )
    )
    FROM jsonb_array_elements(COALESCE(p_new_payload->'workouts','[]'::jsonb)) elem
  );

  -- daily_logs.workouts 에서 옛 entries 제거 (해당 assignment_id 마커 가진 것)
  IF EXISTS (SELECT 1 FROM daily_logs WHERE user_id=v_assignment.client_id AND log_date=v_assignment.assigned_for_date) THEN
    SELECT jsonb_agg(elem) INTO v_remaining_workouts
    FROM jsonb_array_elements(
      COALESCE((SELECT workouts FROM daily_logs WHERE user_id=v_assignment.client_id AND log_date=v_assignment.assigned_for_date), '[]'::jsonb)
    ) elem
    WHERE COALESCE(elem->>'_trainerAssignmentId','') <> p_assignment_id::text;

    UPDATE daily_logs
    SET workouts = COALESCE(v_remaining_workouts,'[]'::jsonb) || COALESCE(v_new_workouts,'[]'::jsonb),
        updated_at = now()
    WHERE user_id = v_assignment.client_id AND log_date = v_assignment.assigned_for_date;
  ELSE
    INSERT INTO daily_logs (user_id, log_date, workouts)
    VALUES (v_assignment.client_id, v_assignment.assigned_for_date, COALESCE(v_new_workouts,'[]'::jsonb));
  END IF;

  -- assignment payload 교체 + status reset → 'pending' (이전 진행 무효)
  UPDATE workout_assignments
  SET payload = p_new_payload,
      status = 'pending',
      started_at = NULL,
      completed_at = NULL
  WHERE id = p_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_update_assignment TO authenticated;

-- ─────────────────────────────────────────────────────
-- 2. trainer_delete_assignment — 배정 운동 삭제 (소프트 — status='cancelled')
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_delete_assignment(
  p_assignment_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer_id uuid := auth.uid();
  v_assignment record;
  v_remaining_workouts jsonb;
BEGIN
  IF v_trainer_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_assignment FROM workout_assignments
    WHERE id = p_assignment_id AND trainer_id = v_trainer_id;
  IF v_assignment IS NULL THEN RAISE EXCEPTION 'assignment not found'; END IF;

  -- daily_logs.workouts 에서 해당 entries 제거
  IF EXISTS (SELECT 1 FROM daily_logs WHERE user_id=v_assignment.client_id AND log_date=v_assignment.assigned_for_date) THEN
    SELECT jsonb_agg(elem) INTO v_remaining_workouts
    FROM jsonb_array_elements(
      COALESCE((SELECT workouts FROM daily_logs WHERE user_id=v_assignment.client_id AND log_date=v_assignment.assigned_for_date), '[]'::jsonb)
    ) elem
    WHERE COALESCE(elem->>'_trainerAssignmentId','') <> p_assignment_id::text;

    UPDATE daily_logs
    SET workouts = COALESCE(v_remaining_workouts,'[]'::jsonb),
        updated_at = now()
    WHERE user_id = v_assignment.client_id AND log_date = v_assignment.assigned_for_date;
  END IF;

  -- assignment 자체는 audit 로 cancelled 마크 (row 삭제 아님)
  UPDATE workout_assignments
  SET status = 'cancelled', completed_at = now()
  WHERE id = p_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_delete_assignment TO authenticated;
