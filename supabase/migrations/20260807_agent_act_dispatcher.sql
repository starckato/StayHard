-- QROK Agent API — service_role 전용 실행 디스패처.
-- 스펙: document-private/AGENT_API_SPEC_v1.md
--
-- 왜 이게 필요한가
--   당초 설계는 Edge Function 이 프로젝트 JWT secret 으로 에이전트 JWT 를 서명해
--   PostgREST 에 붙이는 방식이었다. 그러려면 secret 을 따로 받아 보관해야 한다.
--   대신 여기서는 트랜잭션 로컬로 request.jwt.claims 를 세워 auth.uid() 를 에이전트로
--   만든다. 검증 완료: set_config(...,true) 직후 auth.uid() 가 해당 sub 를 반환한다.
--   → 관리할 secret 이 하나 줄고, 기존 trainer_* RPC 를 그대로 재사용한다.
--
-- 보안 근거
--   * 이 함수는 service_role 만 실행할 수 있다 (아래 revoke/grant).
--   * p_actor_id 는 Edge Function 이 PAT 해시 대조로 확정한 값이다.
--   * 하위 RPC 들이 trainer_clients active + trainers approved 를 각자 재검증한다.
--     즉 여기서 권한을 새로 발명하지 않는다 — 신원만 세우고 위임한다.

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
begin
  if p_actor_id is null or p_client_id is null then
    raise exception 'actor and client are required';
  end if;

  -- 에이전트 신원을 트랜잭션 로컬로 세운다 → 하위 RPC 의 auth.uid() 가 이 값이 된다.
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

comment on function public.agent_act(uuid, text, uuid, jsonb) is
  'Agent API 쓰기 디스패처. service_role 전용. 에이전트 신원을 세운 뒤 기존 trainer_* RPC 에 위임한다.';
