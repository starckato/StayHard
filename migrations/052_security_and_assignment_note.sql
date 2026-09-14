-- 052 · 보안 수정 + 배정 payload note 필드 (2026-09-14)
--
-- (1) [CRITICAL] 트레이너 자가 승인 차단
--     trainers_self_update 정책이 certification_status/kind 변경을 막지 않아
--     일반 계정이 스스로 approved 트레이너가 될 수 있었다.
--     → 컬럼 UPDATE 권한 회수(048 패턴) + 트리거 2차 방어(049 패턴).
-- (2) [CRITICAL] 동의 없는 트레이너-클라이언트 연결 차단
--     023 의 tc_trainer_insert 정책은 클라이언트 동의를 확인하지 않았다.
--     040 의 요청·수락 플로우(SECURITY DEFINER RPC)만 남기고 원시 INSERT 정책 제거.
--     * Agent API 는 service_role 로 insert 하므로 영향 없음 (RLS 미적용).
-- (3) dispatch_nudge_webhook search_path 고정 (린터 플래그, 관례 일관성)
-- (4) trainer_assign_workout / trainer_update_assignment 에 exercises[].note 보존
--     운동 타이틀에 메모를 욱여넣는 대신 별도 note 필드로 — 세션 화면 메모 칸에 표시.
-- (5) agent_act 에 scope 재검증 (Edge Function 단일 계층 → DB 2차 방어선)

-- ─────────────────────────────────────────────────────
-- (1) 트레이너 자격 컬럼 잠금
-- ─────────────────────────────────────────────────────
REVOKE UPDATE (certification_status, kind) ON public.trainers FROM authenticated;

CREATE OR REPLACE FUNCTION public.trainers_guard_cert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.certification_status IS DISTINCT FROM OLD.certification_status
      OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
    -- service_role (Agent API 등) 은 통과, 그 외에는 관리자만
    IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role'
       AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
      RAISE EXCEPTION 'certification_status/kind can only be changed by an admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trainers_guard_cert ON public.trainers;
CREATE TRIGGER trg_trainers_guard_cert
  BEFORE UPDATE ON public.trainers
  FOR EACH ROW EXECUTE FUNCTION public.trainers_guard_cert();

-- ─────────────────────────────────────────────────────
-- (2) 동의 없는 연결 정책 제거 — 040 요청·수락 플로우만 유지
-- ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS tc_trainer_insert ON public.trainer_clients;

-- ─────────────────────────────────────────────────────
-- (3) webhook 함수 search_path 고정
-- ─────────────────────────────────────────────────────
ALTER FUNCTION public.dispatch_nudge_webhook() SET search_path = public, pg_temp;

-- ─────────────────────────────────────────────────────
-- (4) note 필드 보존 — assign
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

  INSERT INTO workout_assignments (trainer_id, client_id, assigned_for_date, payload)
  VALUES (v_trainer_id, p_client_id, p_assigned_for, p_payload)
  RETURNING id INTO v_assignment_id;

  -- nested gym session entry — exercises[] 안에 종목별 sets + note (052 추가)
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
          'note', LEFT(COALESCE(elem->>'note',''), 200),
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

  SELECT EXISTS(SELECT 1 FROM daily_logs WHERE user_id=p_client_id AND log_date=p_assigned_for)
    INTO v_log_exists;

  IF v_log_exists THEN
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
-- (4) note 필드 보존 — update
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
          'note', LEFT(COALESCE(elem->>'note',''), 200),
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

-- ─────────────────────────────────────────────────────
-- (5) agent_act scope 재검증 — DB 2차 방어선
-- ─────────────────────────────────────────────────────
create or replace function public.agent_act(
  p_actor_id  uuid,
  p_action    text,
  p_client_id uuid,
  p_args      jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uuid uuid;
  v_required_scope text;
begin
  if p_actor_id is null or p_client_id is null then
    raise exception 'actor and client are required';
  end if;

  -- scope 재검증 (052): Edge Function 의 requireScope 와 별개로 DB 에서도 확인.
  -- agent_act 가 service_role 을 가진 다른 경로에서 호출되더라도 scope 우회가 불가능해진다.
  v_required_scope := case p_action
    when 'assign' then 'assign:write'
    when 'update_assignment' then 'assign:write'
    when 'delete_assignment' then 'assign:write'
    when 'set_goals' then 'goals:write'
    when 'upsert_routine' then 'routines:write'
    else null end;
  if v_required_scope is null then
    raise exception 'unknown action: %', p_action;
  end if;
  if not exists (
    select 1 from agent_tokens
    where agent_user_id = p_actor_id
      and owner_user_id = p_client_id
      and revoked_at is null
      and expires_at > now()
      and v_required_scope = any(scopes)
  ) then
    raise exception 'scope % not granted for this agent', v_required_scope;
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_actor_id::text, 'role', 'authenticated')::text,
    true
  );

  if p_action = 'assign' then
    v_uuid := trainer_assign_workout(
      p_client_id,
      coalesce((p_args->>'assigned_for')::date, current_date),
      coalesce(p_args->'payload', '{}'::jsonb)
    );
    return jsonb_build_object('assignment_id', v_uuid);

  elsif p_action = 'update_assignment' then
    perform trainer_update_assignment(
      (p_args->>'assignment_id')::uuid,
      coalesce(p_args->'payload', '{}'::jsonb)
    );
    return jsonb_build_object('ok', true);

  elsif p_action = 'delete_assignment' then
    perform trainer_delete_assignment((p_args->>'assignment_id')::uuid);
    return jsonb_build_object('ok', true);

  elsif p_action = 'set_goals' then
    perform agent_set_goals(p_client_id, coalesce(p_args->'goals', '{}'::jsonb));
    return jsonb_build_object('ok', true);

  elsif p_action = 'upsert_routine' then
    v_uuid := agent_upsert_routine(p_client_id, coalesce(p_args->'routine', '{}'::jsonb));
    return jsonb_build_object('routine_id', v_uuid);
  end if;

  raise exception 'unknown action: %', p_action;
end;
$$;

revoke all on function public.agent_act(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.agent_act(uuid, text, uuid, jsonb) to service_role;
