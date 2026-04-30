-- 042_cardio_penalty_type_outcome.sql
-- 유산소 징역 확장:
--  1. cardio_type — 트레이너가 종류 지정 (달리기/걷기/자전거/수영/로잉/줄넘기/자유)
--  2. outcome — 회원이 완료 시 '복역 완료(completed)' / '탈주(escaped)' 선택
--  3. actual_minutes — 회원이 실제 한 시간 입력 (default 부여 시간)
--
-- workout_assignments.payload 에 cardio_type / actual_minutes / outcome 추가.
-- daily_logs.workouts entry 에 _penaltyType 마커.

-- ─────────────────────────────────────────────────────
-- RPC: 부여 — cardio_type 추가 (기존 시그너처 drop 필요)
-- ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS trainer_assign_cardio_penalty(uuid, date, int, text, text);
DROP FUNCTION IF EXISTS client_complete_cardio_penalty(uuid);

CREATE OR REPLACE FUNCTION trainer_assign_cardio_penalty(
  p_client_id uuid,
  p_assigned_for date,
  p_minutes int,
  p_cardio_type text DEFAULT '자유',
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer uuid := auth.uid();
  v_assignment_id uuid;
  v_session_entry jsonb;
  v_log_exists boolean;
  v_payload jsonb;
  v_clean_reason text := NULLIF(trim(coalesce(p_reason,'')),'');
  v_clean_notes text := NULLIF(trim(coalesce(p_notes,'')),'');
  v_clean_type text := NULLIF(trim(coalesce(p_cardio_type,'')), '');
BEGIN
  IF v_trainer IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_minutes IS NULL OR p_minutes < 5 OR p_minutes > 240 THEN
    RAISE EXCEPTION 'minutes must be between 5 and 240';
  END IF;
  IF v_clean_type IS NULL THEN v_clean_type := '자유'; END IF;
  IF v_clean_type NOT IN ('달리기','걷기','자전거','수영','로잉','줄넘기','자유') THEN
    RAISE EXCEPTION 'invalid cardio_type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trainer_clients WHERE trainer_id=v_trainer AND client_id=p_client_id AND status='active') THEN
    RAISE EXCEPTION 'no active trainer-client relationship';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trainers WHERE id=v_trainer AND certification_status='approved') THEN
    RAISE EXCEPTION 'trainer certification not approved';
  END IF;

  v_payload := jsonb_build_object(
    'type', 'cardio_penalty',
    'minutes', p_minutes,
    'cardio_type', v_clean_type,
    'reason', v_clean_reason,
    'notes', v_clean_notes
  );

  INSERT INTO workout_assignments (trainer_id, client_id, assigned_for_date, payload)
  VALUES (v_trainer, p_client_id, p_assigned_for, v_payload)
  RETURNING id INTO v_assignment_id;

  v_session_entry := jsonb_build_object(
    'type', 'gym',
    'sessionName', '유산소 징역',
    'status', 'planned',
    '_trainerAssignmentId', v_assignment_id::text,
    '_assignedBy', v_trainer::text,
    '_isPenalty', true,
    '_penaltyMinutes', p_minutes,
    '_penaltyType', v_clean_type,
    '_penaltyReason', v_clean_reason,
    '_penaltyNotes', v_clean_notes,
    'exercises', jsonb_build_array(
      jsonb_build_object(
        'name', '유산소 징역 (' || v_clean_type || ' ' || p_minutes || '분)',
        'muscle', '유산소',
        'equipment', '징역',
        'icon', '⏱',
        'isStrength', false,
        'sets', jsonb_build_array(
          jsonb_build_object(
            'dist', 0,
            'time', p_minutes,
            'done', false
          )
        )
      )
    )
  );

  SELECT EXISTS(SELECT 1 FROM daily_logs WHERE user_id=p_client_id AND log_date=p_assigned_for)
    INTO v_log_exists;

  IF v_log_exists THEN
    UPDATE daily_logs
    SET workouts = COALESCE(workouts,'[]'::jsonb) || jsonb_build_array(v_session_entry),
        updated_at = now()
    WHERE user_id = p_client_id AND log_date = p_assigned_for;
  ELSE
    INSERT INTO daily_logs (user_id, log_date, workouts)
    VALUES (p_client_id, p_assigned_for, jsonb_build_array(v_session_entry));
  END IF;

  INSERT INTO trainer_messages (trainer_id, client_id, msg_type, preset_id, body)
  VALUES (
    v_trainer,
    p_client_id,
    'preset',
    'workout_assigned',
    '⏱ 유산소 징역 ' || p_minutes || '분형 (' || v_clean_type || ').' ||
    CASE WHEN v_clean_reason IS NOT NULL THEN ' 사유: ' || v_clean_reason ELSE '' END ||
    CASE WHEN v_clean_notes IS NOT NULL THEN E'\n메모: ' || v_clean_notes ELSE '' END
  );

  RETURN v_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_assign_cardio_penalty TO authenticated;

-- ─────────────────────────────────────────────────────
-- RPC: 회원 응답 (완료 OR 탈주)
-- outcome: 'completed' (복역 완료) / 'escaped' (탈주)
-- actual_minutes: 회원이 실제 한 시간 (탈주 시 0 가능)
-- actual_cardio_type: 회원이 실제 한 종류 (트레이너가 '자유' 부여 시 의미)
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION client_complete_cardio_penalty(
  p_assignment_id uuid,
  p_outcome text DEFAULT 'completed',
  p_actual_minutes int DEFAULT NULL,
  p_actual_cardio_type text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean_outcome text := lower(trim(coalesce(p_outcome,'completed')));
  v_status text;
  v_existing_payload jsonb;
  v_new_payload jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF v_clean_outcome NOT IN ('completed','escaped') THEN
    RAISE EXCEPTION 'outcome must be completed or escaped';
  END IF;
  v_status := CASE WHEN v_clean_outcome = 'completed' THEN 'completed' ELSE 'skipped' END;

  -- 기존 payload 에 actual_* 합치기
  SELECT payload INTO v_existing_payload FROM workout_assignments
    WHERE id = p_assignment_id AND client_id = v_uid;
  IF v_existing_payload IS NULL THEN RAISE EXCEPTION 'assignment not found or not yours'; END IF;

  v_new_payload := v_existing_payload || jsonb_build_object(
    'outcome', v_clean_outcome,
    'actual_minutes', COALESCE(p_actual_minutes, 0),
    'actual_cardio_type', NULLIF(trim(coalesce(p_actual_cardio_type,'')),'')
  );

  UPDATE workout_assignments
  SET status = v_status,
      payload = v_new_payload,
      completed_at = now()
  WHERE id = p_assignment_id AND client_id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION client_complete_cardio_penalty TO authenticated;

NOTIFY pgrst, 'reload schema';
