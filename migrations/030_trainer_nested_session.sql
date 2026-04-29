-- 030_trainer_nested_session.sql
-- 트레이너 배정을 nested gym session 형식으로 daily_logs.workouts 에 insert.
-- 사용자 결정 2026-04-29:
-- 1. 1 assignment = 1 헬스 세션 (여러 종목 묶음)
-- 2. 시간차 완료 가능 (각 종목 sets[].done 추적)
-- 3. 메인 앱 근육맵 자동 반영 (gym session 구조 호환)
--
-- 필드명 통일: weight → kg (메인 앱 패턴 준수)

-- ─────────────────────────────────────────────────────
-- 1. trainer_assign_workout v2 — nested gym session
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_assign_workout(
  p_client_id uuid,
  p_assigned_for date,
  p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer_id uuid := auth.uid();
  v_assignment_id uuid;
  v_session_entry jsonb;
  v_log_exists boolean;
  v_remaining_workouts jsonb;
BEGIN
  IF v_trainer_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trainer_clients WHERE trainer_id=v_trainer_id AND client_id=p_client_id AND status='active') THEN
    RAISE EXCEPTION 'no active trainer-client relationship';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM trainers WHERE id=v_trainer_id AND certification_status='approved') THEN
    RAISE EXCEPTION 'trainer certification not approved';
  END IF;

  -- 1. workout_assignments insert
  INSERT INTO workout_assignments (trainer_id, client_id, assigned_for_date, payload)
  VALUES (v_trainer_id, p_client_id, p_assigned_for, p_payload)
  RETURNING id INTO v_assignment_id;

  -- 2. nested gym session entry 구성 — exercises[] 안에 종목별 sets
  --    payload.workouts 의 각 entry → exercises 배열의 1 entry.
  --    필드: name, sets[{kg, reps, done:false}], muscle, equipment, icon
  v_session_entry := jsonb_build_object(
    'type', 'gym',
    'sessionName', '오늘의 운동 숙제',
    'status', 'planned',
    '_trainerAssignmentId', v_assignment_id::text,
    '_assignedBy', v_trainer_id::text,
    'exercises', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', elem->>'name',
          'muscle', elem->>'muscle',
          'equipment', elem->>'equipment',
          'icon', elem->>'icon',
          'sets', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'kg', COALESCE((s->>'kg')::numeric, (s->>'weight')::numeric, 0),
                'reps', COALESCE((s->>'reps')::int, 0),
                'done', false
              )
            ), '[]'::jsonb)
            FROM jsonb_array_elements(COALESCE(elem->'sets','[]'::jsonb)) s
          )
        )
      )
      FROM jsonb_array_elements(COALESCE(p_payload->'workouts','[]'::jsonb)) elem
    )
  );

  -- 3. daily_logs.workouts 에 1 entry append (옛 _trainerAssignmentId 마커 entries 제거 후)
  SELECT EXISTS(SELECT 1 FROM daily_logs WHERE user_id=p_client_id AND log_date=p_assigned_for)
    INTO v_log_exists;

  IF v_log_exists THEN
    -- 같은 assignment 의 옛 entries 제거 (수정 시 중복 방지)
    SELECT jsonb_agg(elem) INTO v_remaining_workouts
    FROM jsonb_array_elements(
      COALESCE((SELECT workouts FROM daily_logs WHERE user_id=p_client_id AND log_date=p_assigned_for), '[]'::jsonb)
    ) elem
    WHERE COALESCE(elem->>'_trainerAssignmentId','') <> v_assignment_id::text;

    UPDATE daily_logs
    SET workouts = COALESCE(v_remaining_workouts,'[]'::jsonb) || jsonb_build_array(v_session_entry),
        updated_at = now()
    WHERE user_id = p_client_id AND log_date = p_assigned_for;
  ELSE
    INSERT INTO daily_logs (user_id, log_date, workouts)
    VALUES (p_client_id, p_assigned_for, jsonb_build_array(v_session_entry));
  END IF;

  RETURN v_assignment_id;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 2. trainer_update_assignment v2 — nested 구조 + 진행 보존
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
  v_session_entry jsonb;
  v_remaining_workouts jsonb;
BEGIN
  IF v_trainer_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_assignment FROM workout_assignments
    WHERE id = p_assignment_id AND trainer_id = v_trainer_id;
  IF v_assignment IS NULL THEN RAISE EXCEPTION 'assignment not found'; END IF;
  IF v_assignment.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'cannot edit completed or cancelled assignment';
  END IF;

  -- 새 nested session entry 구성
  v_session_entry := jsonb_build_object(
    'type', 'gym',
    'sessionName', '오늘의 운동 숙제',
    'status', 'planned',
    '_trainerAssignmentId', p_assignment_id::text,
    '_assignedBy', v_trainer_id::text,
    'exercises', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', elem->>'name',
          'muscle', elem->>'muscle',
          'equipment', elem->>'equipment',
          'icon', elem->>'icon',
          'sets', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'kg', COALESCE((s->>'kg')::numeric, (s->>'weight')::numeric, 0),
                'reps', COALESCE((s->>'reps')::int, 0),
                'done', false
              )
            ), '[]'::jsonb)
            FROM jsonb_array_elements(COALESCE(elem->'sets','[]'::jsonb)) s
          )
        )
      )
      FROM jsonb_array_elements(COALESCE(p_new_payload->'workouts','[]'::jsonb)) elem
    )
  );

  IF EXISTS (SELECT 1 FROM daily_logs WHERE user_id=v_assignment.client_id AND log_date=v_assignment.assigned_for_date) THEN
    SELECT jsonb_agg(elem) INTO v_remaining_workouts
    FROM jsonb_array_elements(
      COALESCE((SELECT workouts FROM daily_logs WHERE user_id=v_assignment.client_id AND log_date=v_assignment.assigned_for_date), '[]'::jsonb)
    ) elem
    WHERE COALESCE(elem->>'_trainerAssignmentId','') <> p_assignment_id::text;

    UPDATE daily_logs
    SET workouts = COALESCE(v_remaining_workouts,'[]'::jsonb) || jsonb_build_array(v_session_entry),
        updated_at = now()
    WHERE user_id = v_assignment.client_id AND log_date = v_assignment.assigned_for_date;
  ELSE
    INSERT INTO daily_logs (user_id, log_date, workouts)
    VALUES (v_assignment.client_id, v_assignment.assigned_for_date, jsonb_build_array(v_session_entry));
  END IF;

  UPDATE workout_assignments
  SET payload = p_new_payload, status = 'pending', started_at = NULL, completed_at = NULL
  WHERE id = p_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_assign_workout TO authenticated;
GRANT EXECUTE ON FUNCTION trainer_update_assignment TO authenticated;

-- ─────────────────────────────────────────────────────
-- 3. Carry-over RPC 도 nested 호환 (process_homework_carryover)
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
  v_session_entry jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','unauthenticated'); END IF;

  FOR v_assignment IN
    SELECT * FROM workout_assignments
    WHERE client_id = v_uid AND assigned_for_date = v_yesterday
      AND status NOT IN ('completed','skipped','cancelled')
      AND carried_over_to IS NULL
  LOOP
    INSERT INTO workout_assignments (trainer_id, client_id, assigned_for_date, payload, status, carried_over_from)
    VALUES (v_assignment.trainer_id, v_uid, v_today, v_assignment.payload, 'pending', v_assignment.id)
    RETURNING id INTO v_new_id;

    UPDATE workout_assignments SET status='skipped', carried_over_to=v_new_id WHERE id=v_assignment.id;

    -- nested session entry
    v_session_entry := jsonb_build_object(
      'type', 'gym',
      'sessionName', '오늘의 운동 숙제',
      'status', 'planned',
      '_trainerAssignmentId', v_new_id::text,
      '_assignedBy', v_assignment.trainer_id::text,
      'exercises', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'name', elem->>'name',
            'muscle', elem->>'muscle',
            'equipment', elem->>'equipment',
            'icon', elem->>'icon',
            'sets', (
              SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                  'kg', COALESCE((s->>'kg')::numeric, (s->>'weight')::numeric, 0),
                  'reps', COALESCE((s->>'reps')::int, 0),
                  'done', false
                )
              ), '[]'::jsonb)
              FROM jsonb_array_elements(COALESCE(elem->'sets','[]'::jsonb)) s
            )
          )
        )
        FROM jsonb_array_elements(COALESCE(v_assignment.payload->'workouts','[]'::jsonb)) elem
      )
    );

    IF EXISTS (SELECT 1 FROM daily_logs WHERE user_id=v_uid AND log_date=v_today) THEN
      UPDATE daily_logs
      SET workouts = COALESCE(workouts,'[]'::jsonb) || jsonb_build_array(v_session_entry),
          updated_at = now()
      WHERE user_id = v_uid AND log_date = v_today;
    ELSE
      INSERT INTO daily_logs (user_id, log_date, workouts)
      VALUES (v_uid, v_today, jsonb_build_array(v_session_entry));
    END IF;

    INSERT INTO trainer_messages (trainer_id, client_id, msg_type, preset_id, body)
    VALUES (v_assignment.trainer_id, v_uid, 'preset', 'workout_missed',
            '회원이 어제 숙제를 완료하지 못했습니다. 오늘로 자동 carry-over 됨.');
    v_carried := v_carried + 1;
  END LOOP;

  RETURN jsonb_build_object('carried_over', v_carried, 'today', v_today);
END;
$$;

GRANT EXECUTE ON FUNCTION process_homework_carryover TO authenticated;
