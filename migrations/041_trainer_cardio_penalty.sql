-- 041_trainer_cardio_penalty.sql
-- 유산소 징역 — 트레이너가 회원에게 N 분 유산소 부여 (식단 위반 등 페널티).
-- 회원 앱 운동 탭에 별도 빨강 카드 + "징역 N분" 뱃지로 표시.
-- 1-click 완료 (시간 입력 X — 부여 시간 그대로 인정).

-- ─────────────────────────────────────────────────────
-- RPC: 트레이너가 유산소 징역 부여
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_assign_cardio_penalty(
  p_client_id uuid,
  p_assigned_for date,
  p_minutes int,
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
BEGIN
  IF v_trainer IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_minutes IS NULL OR p_minutes < 5 OR p_minutes > 240 THEN
    RAISE EXCEPTION 'minutes must be between 5 and 240';
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
    'reason', v_clean_reason,
    'notes', v_clean_notes
  );

  INSERT INTO workout_assignments (trainer_id, client_id, assigned_for_date, payload)
  VALUES (v_trainer, p_client_id, p_assigned_for, v_payload)
  RETURNING id INTO v_assignment_id;

  -- daily_logs.workouts 에 nested entry — 빨강 카드 표시용 마커 포함
  v_session_entry := jsonb_build_object(
    'type', 'gym',
    'sessionName', '유산소 징역',
    'status', 'planned',
    '_trainerAssignmentId', v_assignment_id::text,
    '_assignedBy', v_trainer::text,
    '_isPenalty', true,
    '_penaltyMinutes', p_minutes,
    '_penaltyReason', v_clean_reason,
    '_penaltyNotes', v_clean_notes,
    'exercises', jsonb_build_array(
      jsonb_build_object(
        'name', '유산소 징역 (' || p_minutes || '분)',
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

  -- 트레이너 메시지 자동 발송 (회원 앱 인박스에 표시됨)
  INSERT INTO trainer_messages (trainer_id, client_id, msg_type, preset_id, body)
  VALUES (
    v_trainer,
    p_client_id,
    'preset',
    'workout_assigned',
    '⏱ 유산소 징역 ' || p_minutes || '분형이 부여됐습니다.' ||
    CASE WHEN v_clean_reason IS NOT NULL THEN ' 사유: ' || v_clean_reason ELSE '' END ||
    CASE WHEN v_clean_notes IS NOT NULL THEN E'\n메모: ' || v_clean_notes ELSE '' END
  );

  RETURN v_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_assign_cardio_penalty TO authenticated;

-- ─────────────────────────────────────────────────────
-- RPC: 회원이 유산소 징역 1-click 완료
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION client_complete_cardio_penalty(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  UPDATE workout_assignments
  SET status = 'completed', completed_at = now()
  WHERE id = p_assignment_id AND client_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found or not yours'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION client_complete_cardio_penalty TO authenticated;

NOTIFY pgrst, 'reload schema';
