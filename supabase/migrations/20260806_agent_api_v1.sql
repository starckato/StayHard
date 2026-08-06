-- QROK Agent API v1 — 외부 AI(Claude Code 등)가 트레이너 주체로 붙기 위한 기반.
-- 스펙: document-private/AGENT_API_SPEC_v1.md
--
-- 설계 요지: AI 에이전트에게 진짜 Supabase 신원(auth.users)을 부여한다.
-- 그러면 trainer_assign_workout 등 기존 auth.uid() 기반 RPC/RLS 가 그대로 동작하므로
-- 배정 로직은 손대지 않는다. 이 마이그레이션은 전부 additive — drop/alter type 없음.

-- ─────────────────────────────────────────────────────────────
-- 1. trainers.kind — 사람 트레이너와 AI 에이전트를 분리
--    AI 는 자격증 개념이 없다. 대신 소유자의 명시적 토큰 발급이 게이트.
-- ─────────────────────────────────────────────────────────────
alter table public.trainers
  add column if not exists kind text not null default 'human';

alter table public.trainers
  drop constraint if exists trainers_kind_check;
alter table public.trainers
  add constraint trainers_kind_check check (kind in ('human', 'ai'));

comment on column public.trainers.kind is
  'human = 자격증 수동 승인 대상. ai = 유저가 발급한 AI 에이전트(자동 approved).';

-- ─────────────────────────────────────────────────────────────
-- 2. agent_tokens — 개인 액세스 토큰. 평문은 절대 저장하지 않는다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.agent_tokens (
  id            uuid primary key default gen_random_uuid(),
  agent_user_id uuid not null references auth.users(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  token_hash    text not null unique,   -- sha256 hex
  token_prefix  text not null,          -- 'qrok_pat_ab12' — 목록 식별용
  scopes        text[] not null default '{}',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);

create index if not exists agent_tokens_active_hash_idx
  on public.agent_tokens (token_hash) where revoked_at is null;
create index if not exists agent_tokens_owner_idx
  on public.agent_tokens (owner_user_id);

alter table public.agent_tokens enable row level security;

-- 소유자는 자기 토큰 목록만 본다. token_hash 는 컬럼 권한으로 가린다.
drop policy if exists at_owner_select on public.agent_tokens;
create policy at_owner_select on public.agent_tokens
  for select using (owner_user_id = auth.uid());

-- 소유자는 폐기(revoked_at)만 할 수 있다. 컬럼 권한으로 그 외 수정 차단.
drop policy if exists at_owner_revoke on public.agent_tokens;
create policy at_owner_revoke on public.agent_tokens
  for update using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- insert / delete 정책 없음 → service_role(Edge Function) 경유만 가능
revoke all on public.agent_tokens from anon, authenticated;
grant select (id, agent_user_id, owner_user_id, name, token_prefix, scopes,
              created_at, last_used_at, expires_at, revoked_at)
  on public.agent_tokens to authenticated;
grant update (revoked_at) on public.agent_tokens to authenticated;

comment on table public.agent_tokens is
  'AI 에이전트용 개인 액세스 토큰. token_hash 는 sha256, 평문은 발급 응답 1회만 노출.';

-- ─────────────────────────────────────────────────────────────
-- 3. rate limit — 토큰당 분 단위 호출 카운터. Edge Function 이 원자적으로 증가시킨다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.agent_rate_limit (
  token_id     uuid not null references public.agent_tokens(id) on delete cascade,
  window_start timestamptz not null,
  call_count   int not null default 0,
  primary key (token_id, window_start)
);

alter table public.agent_rate_limit enable row level security;
revoke all on public.agent_rate_limit from anon, authenticated;
-- 정책 없음 → service_role(Edge Function) 전용

-- 호출 1건 기록 후 현재 분(minute) 누적치를 반환. 한도 초과 판정은 호출부에서.
create or replace function public.agent_bump_rate(p_token_id uuid)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count  int;
begin
  insert into agent_rate_limit (token_id, window_start, call_count)
  values (p_token_id, v_window, 1)
  on conflict (token_id, window_start)
    do update set call_count = agent_rate_limit.call_count + 1
  returning call_count into v_count;

  delete from agent_rate_limit
   where token_id = p_token_id and window_start < v_window - interval '5 minutes';

  return v_count;
end;
$$;

revoke all on function public.agent_bump_rate(uuid) from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. 에이전트 쓰기 RPC — 기존에 트레이너 쓰기 경로가 없던 두 곳.
--    게이트는 trainer_assign_workout 과 동일하게 맞춘다.
-- ─────────────────────────────────────────────────────────────

create or replace function public.agent_assert_can_write(p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'unauthenticated';
  end if;
  if not exists (
    select 1 from trainer_clients
    where trainer_id = v_actor and client_id = p_client_id and status = 'active'
  ) then
    raise exception 'no active trainer-client relationship';
  end if;
  if not exists (
    select 1 from trainers
    where id = v_actor and certification_status = 'approved'
  ) then
    raise exception 'trainer certification not approved';
  end if;
  return v_actor;
end;
$$;

-- 목표값 쓰기 — 화이트리스트한 3개 필드만. 그 외 profiles 컬럼은 건드리지 않는다.
create or replace function public.agent_set_goals(p_client_id uuid, p_goals jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform agent_assert_can_write(p_client_id);

  update profiles set
    weight_goal = coalesce((p_goals->>'weight_goal')::numeric, weight_goal),
    water_goal  = coalesce((p_goals->>'water_goal')::int,      water_goal),
    goal        = coalesce( p_goals->>'goal',                  goal)
  where id = p_client_id;

  if not found then
    raise exception 'client profile not found';
  end if;
end;
$$;

-- 루틴 upsert — id 가 오면 해당 루틴 갱신(소유자 확인), 없으면 신규 생성.
-- 사용자 데이터 덮어쓰기 금지 원칙에 따라 전체 REPLACE 는 제공하지 않는다.
create or replace function public.agent_upsert_routine(p_client_id uuid, p_routine jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id   uuid := nullif(p_routine->>'id','')::uuid;
  v_name text := p_routine->>'name';
begin
  perform agent_assert_can_write(p_client_id);

  if v_name is null or length(trim(v_name)) = 0 then
    raise exception 'routine name required';
  end if;

  if v_id is not null then
    update user_routines
       set name      = v_name,
           exercises = coalesce(p_routine->'exercises', exercises)
     where id = v_id and user_id = p_client_id;
    if not found then
      raise exception 'routine not found for this client';
    end if;
    return v_id;
  end if;

  insert into user_routines (user_id, name, exercises)
  values (p_client_id, v_name, coalesce(p_routine->'exercises','[]'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. user_routines 트레이너 읽기 정책
--    daily_logs / profiles 에는 이미 *_trainer_read 가 있으나 user_routines 만 없었다.
--    (여기서 다루는 건 운동 루틴 라이브러리. 클라 개인 영역인 '필수 루틴/할일'은
--     daily_logs.mandatory 이고 그대로 비공개다.)
-- ─────────────────────────────────────────────────────────────
drop policy if exists user_routines_trainer_read on public.user_routines;
create policy user_routines_trainer_read on public.user_routines
  for select using (
    exists (
      select 1 from trainer_clients tc
      where tc.trainer_id = auth.uid()
        and tc.client_id = user_routines.user_id
        and tc.status = 'active'
    )
  );

revoke all on function public.agent_assert_can_write(uuid) from anon, authenticated;
grant execute on function public.agent_set_goals(uuid, jsonb)      to authenticated;
grant execute on function public.agent_upsert_routine(uuid, jsonb) to authenticated;
