// QROK · agent-api Edge Function
//
// 외부 AI(Claude Code / Claude Desktop / 임의 에이전트)가 큐록에 접근하는 REST 진입점.
// 스펙: document-private/AGENT_API_SPEC_v1.md
//
// 설계 요지
//   AI 에이전트는 진짜 Supabase 신원(auth.users 행)을 갖고 kind='ai' 트레이너로 등록되며,
//   trainer_clients 로 소유자와 연결된다. PAT 를 해시 대조로 검증한 뒤
//   쓰기는 agent_act(service_role 전용 디스패처)에 위임한다. agent_act 는 트랜잭션 로컬로
//   에이전트 신원을 세우고 기존 trainer_* RPC 를 호출하므로 배정 로직은 재구현하지 않는다.
//
// 읽기 경로의 불변식 (중요)
//   읽기는 service_role 로 수행되므로 RLS 가 적용되지 않는다. 대신 조회 대상은 항상
//   `auth.ownerUserId` — PAT 행에서 나온 값 — 으로만 스코프한다.
//   v1 에는 클라이언트 id 를 요청에서 받는 경로가 존재하지 않는다. 이 불변식을 깨지 말 것.
//
// Secrets (전부 Supabase 가 자동 주입 — 추가로 설정할 것 없음):
//   SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY
//
// 배포 (플랫폼의 JWT 선검증을 반드시 꺼야 한다 — 우리는 자체 PAT 를 Bearer 로 받으므로
//       켜두면 qrok_pat_... 헤더가 이 코드에 닿기 전에 401 로 잘린다):
//   SUPABASE_ACCESS_TOKEN="$(tr -d '\n' < ~/.qrok-sb-pat)" \
//     npx supabase functions deploy agent-api \
//     --project-ref uvaosxhsjscigheyymus --no-verify-jwt

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { EXERCISE_CATALOG } from './exercise-catalog.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TOKEN_PREFIX = 'qrok_pat_';
const DEFAULT_TTL_DAYS = 90;
const MAX_TTL_DAYS = 365;
const RATE_LIMIT_PER_MIN = 60;

const VALID_SCOPES = ['read', 'assign:write', 'goals:write', 'routines:write'] as const;
type Scope = typeof VALID_SCOPES[number];

const CORS = {
  // 브라우저 컨텍스트는 앱 오리진만. 비브라우저 호출(MCP/CLI/서버)은 CORS 의 영향을 받지 않는다.
  'Access-Control-Allow-Origin': 'https://qrok.app',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
};

// ── helpers ────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function fail(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// ── 배정 payload 검증 ──────────────────────────────────────────
// 남용 캡: 운동명에 메모를 욱여넣는 것(썸네일 매칭 파괴), 무제한 항목으로 payload 를
// 비대화시키는 것, 제어문자/HTML 주입을 여기서 차단한다.
const MAX_WORKOUTS = 5;
const MAX_EXERCISES = 15;
const MAX_SETS = 20;
const MAX_NAME_LEN = 60;
const MAX_NOTE_LEN = 200;

function cleanText(v: string, max: number): string {
  // 제어문자 제거 + 트림 + 길이 캡
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// 반환: 오류 메시지 | null. 통과 시 workouts 를 제자리에서 정규화(이름/메모 클린)한다.
function validateWorkouts(workouts: unknown): string | null {
  if (!Array.isArray(workouts) || !workouts.length) {
    return 'Field "workouts" must be a non-empty array.';
  }
  if (workouts.length > MAX_WORKOUTS) return `Too many workouts (max ${MAX_WORKOUTS}).`;
  for (const w of workouts) {
    if (typeof w !== 'object' || w === null) return 'Each workout must be an object.';
    if (typeof w.name !== 'string' || !w.name.trim()) return 'Each workout needs a "name".';
    w.name = cleanText(w.name, MAX_NAME_LEN);
    if (!w.name) return 'Workout "name" is empty after sanitization.';
    if (w.note != null) {
      if (typeof w.note !== 'string') return '"note" must be a string.';
      w.note = cleanText(w.note, MAX_NOTE_LEN);
    }
    if (w.sets != null) {
      if (!Array.isArray(w.sets)) return '"sets" must be an array.';
      if (w.sets.length > MAX_SETS) return `Too many sets (max ${MAX_SETS}).`;
    }
  }
  return null;
}

// 운동명 카탈로그 매칭 — 정확 일치 우선, 아니면 부분 일치
function searchCatalog(qstr: string) {
  const needle = qstr.trim().toLowerCase();
  if (!needle) return [];
  const exact = EXERCISE_CATALOG.filter((x) => x.n.toLowerCase() === needle);
  if (exact.length) return exact;
  return EXERCISE_CATALOG.filter((x) => x.n.toLowerCase().includes(needle)).slice(0, 20);
}

function unmatchedNames(workouts: { name: string }[]): string[] {
  const known = new Set(EXERCISE_CATALOG.map((x) => x.n));
  return [...new Set(workouts.map((w) => w.name).filter((n) => !known.has(n)))];
}

// ── PAT 인증 ───────────────────────────────────────────────────

interface AgentAuth {
  tokenId: string;
  agentUserId: string;
  ownerUserId: string;
  scopes: Scope[];
  svc: SupabaseClient;
}

// 토큰 평문·해시는 절대 로그·응답에 남기지 않는다.
async function authenticateAgent(req: Request): Promise<AgentAuth | Response> {
  const header = req.headers.get('Authorization') ?? '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!raw.startsWith(TOKEN_PREFIX)) {
    return fail(401, 'unauthorized', 'Missing or malformed Bearer token.');
  }

  const svc = serviceClient();
  const { data: row, error } = await svc
    .from('agent_tokens')
    .select('id, agent_user_id, owner_user_id, scopes, expires_at, revoked_at')
    .eq('token_hash', await sha256hex(raw))
    .maybeSingle();

  if (error) return fail(500, 'lookup_failed', 'Token lookup failed.');
  if (!row) return fail(401, 'unauthorized', 'Unknown token.');
  if (row.revoked_at) return fail(401, 'revoked', 'Token has been revoked.');
  if (new Date(row.expires_at) <= new Date()) {
    return fail(401, 'expired', 'Token has expired.');
  }

  const { data: calls } = await svc.rpc('agent_bump_rate', { p_token_id: row.id });
  if (typeof calls === 'number' && calls > RATE_LIMIT_PER_MIN) {
    return fail(429, 'rate_limited', `Over ${RATE_LIMIT_PER_MIN} requests/min.`);
  }

  // 감사용. 실패해도 요청은 진행한다.
  svc.from('agent_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(() => {}, () => {});

  return {
    tokenId: row.id,
    agentUserId: row.agent_user_id,
    ownerUserId: row.owner_user_id,
    scopes: (row.scopes ?? []) as Scope[],
    svc,
  };
}

function requireScope(auth: AgentAuth, scope: Scope): Response | null {
  if (!auth.scopes.includes(scope)) {
    return fail(403, 'insufficient_scope', `This token lacks the "${scope}" scope.`);
  }
  return null;
}

// 쓰기는 전부 이 한 곳을 통과한다.
async function act(
  auth: AgentAuth, action: string, args: Record<string, unknown>,
): Promise<{ data?: unknown; error?: string }> {
  const { data, error } = await auth.svc.rpc('agent_act', {
    p_actor_id: auth.agentUserId,
    p_action: action,
    p_client_id: auth.ownerUserId,
    p_args: args,
  });
  return error ? { error: error.message } : { data };
}

// ── POST /agents — 에이전트 생성 + 토큰 1회 발급 ────────────────
// 호출자는 앱에 로그인한 *유저 세션* JWT 를 보낸다 (PAT 아님).

async function createAgent(req: Request): Promise<Response> {
  const header = req.headers.get('Authorization') ?? '';
  const userJwt = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!userJwt || userJwt.startsWith(TOKEN_PREFIX)) {
    return fail(401, 'unauthorized', 'A logged-in user session is required.');
  }

  const svc = serviceClient();
  const { data: userData, error: userErr } = await svc.auth.getUser(userJwt);
  if (userErr || !userData?.user) return fail(401, 'unauthorized', 'Invalid user session.');
  const owner = userData.user;

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  if (!name) return fail(400, 'bad_request', 'Field "name" is required.');

  // 소유자당 활성 에이전트 상한 — 무제한 신원/토큰 발급 차단
  const { count: activeCount } = await svc
    .from('agent_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('owner_user_id', owner.id)
    .is('revoked_at', null);
  if ((activeCount ?? 0) >= 10) {
    return fail(429, 'too_many_agents', 'Active agent limit reached (10). Revoke unused tokens first.');
  }

  const requested: Scope[] = Array.isArray(body.scopes) && body.scopes.length
    ? body.scopes.filter((s: string) => VALID_SCOPES.includes(s as Scope))
    : ['read', 'assign:write'];
  if (!requested.length) return fail(400, 'bad_request', 'No valid scopes requested.');

  const ttlDays = Number.isInteger(body.expires_in_days) && body.expires_in_days > 0
    ? Math.min(body.expires_in_days, MAX_TTL_DAYS)
    : DEFAULT_TTL_DAYS;

  // 1) 에이전트용 auth 유저 — 로그인 불가(임의 비밀번호), 신원 용도로만 존재
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email: `agent+${crypto.randomUUID()}@agents.qrok.app`,
    password: b64url(crypto.getRandomValues(new Uint8Array(32))),
    email_confirm: true,
    user_metadata: { qrok_agent: true, owner_user_id: owner.id, agent_name: name },
  });
  if (createErr || !created?.user) {
    return fail(500, 'agent_create_failed', 'Could not create agent identity.');
  }
  const agentId = created.user.id;

  // 이후 단계가 실패하면 고아를 남기지 않는다.
  // profiles/trainers 는 auth.users 에 ON DELETE CASCADE 로 물려 있으므로 유저만 지우면 된다.
  const rollback = async () => { await svc.auth.admin.deleteUser(agentId).catch(() => {}); };

  // 2) profiles 행 — trainers.id 가 profiles(id) 를 참조하므로 선행되어야 한다.
  //    사람 트레이너 가입 경로(trainer.html)와 같은 패턴. username 은 unique.
  //    에이전트는 앱에 로그인하지 않으며 is_excluded 로 집계에서 빼둔다.
  const { error: profErr } = await svc.from('profiles').insert({
    id: agentId,
    username: `ai_${agentId.slice(0, 8)}`,
    display_name: name,
    role: 'trainer',
    is_excluded: true,
  });
  if (profErr) {
    await rollback();
    return fail(500, 'agent_create_failed', `Could not create agent profile: ${profErr.message}`);
  }

  // 3) trainers 행 (kind='ai' → 자격증 심사 대상 아님. 게이트는 소유자의 발급 행위)
  const { error: trainerErr } = await svc.from('trainers').insert({
    id: agentId, trainer_name: name, kind: 'ai', certification_status: 'approved',
  });
  if (trainerErr) {
    await rollback();
    return fail(500, 'agent_create_failed', `Could not register agent as trainer: ${trainerErr.message}`);
  }

  // 4) 소유자와의 active 관계 — 배정 RLS 가 요구하는 것
  const { error: relErr } = await svc.from('trainer_clients').insert({
    trainer_id: agentId, client_id: owner.id, status: 'active', nickname: name,
  });
  if (relErr) {
    await rollback();
    return fail(500, 'agent_create_failed', `Could not link agent to owner: ${relErr.message}`);
  }

  // 5) 토큰 — 평문은 이 응답에서만 노출된다
  const plaintext = `${TOKEN_PREFIX}${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const expiresAt = new Date(Date.now() + ttlDays * 86400_000).toISOString();

  const { error: tokErr } = await svc.from('agent_tokens').insert({
    agent_user_id: agentId,
    owner_user_id: owner.id,
    name,
    token_hash: await sha256hex(plaintext),
    token_prefix: plaintext.slice(0, TOKEN_PREFIX.length + 4),
    scopes: requested,
    expires_at: expiresAt,
  });
  if (tokErr) {
    await rollback();
    return fail(500, 'agent_create_failed', `Could not issue token: ${tokErr.message}`);
  }

  return json({
    agent_id: agentId,
    name,
    scopes: requested,
    expires_at: expiresAt,
    token: plaintext,
    notice: '이 토큰은 지금 한 번만 표시됩니다. 안전한 곳에 보관하세요.',
  }, 201);
}

// ── 라우트 ─────────────────────────────────────────────────────

async function route(req: Request, path: string, auth: AgentAuth): Promise<Response> {
  const q = new URL(req.url).searchParams;
  // 불변식: 조회·쓰기 대상은 항상 토큰이 지목한 소유자. 요청에서 받지 않는다.
  const client = auth.ownerUserId;

  const body = ['POST', 'PATCH', 'PUT'].includes(req.method)
    ? await req.json().catch(() => ({}))
    : {};

  // GET /exercises?q= — 운동 카탈로그 검색.
  // 배정 전 타이틀을 여기서 먼저 찾을 것: 카탈로그 명칭을 그대로 쓰면 앱에서 썸네일이 표시된다.
  // 검색 결과가 없으면 신규 명칭 배정도 허용되지만 썸네일 없이 텍스트로만 렌더된다.
  if (req.method === 'GET' && path === 'exercises') {
    const denied = requireScope(auth, 'read'); if (denied) return denied;
    const qstr = q.get('q') ?? '';
    if (!qstr.trim()) {
      return json({
        total: EXERCISE_CATALOG.length,
        exercises: EXERCISE_CATALOG.map((x) => ({ name: x.n, muscle: x.m, equipment: x.e, has_thumbnail: x.g })),
      });
    }
    const hits = searchCatalog(qstr);
    return json({
      query: qstr,
      exercises: hits.map((x) => ({ name: x.n, muscle: x.m, equipment: x.e, has_thumbnail: x.g })),
      hint: hits.length
        ? 'Use "name" verbatim as the exercise title so the app shows its thumbnail. Extra instructions go in "note".'
        : 'No catalog match. You may assign a new title, but it will render without a thumbnail. Keep titles short; put details in "note".',
    });
  }

  // GET /me
  if (req.method === 'GET' && path === 'me') {
    const denied = requireScope(auth, 'read'); if (denied) return denied;
    const { data, error } = await auth.svc
      .from('profiles')
      .select('id, username, display_name, goal, weight_goal, water_goal, total_score')
      .eq('id', client).maybeSingle();
    if (error) return fail(500, 'read_failed', error.message);
    return json({ agent_id: auth.agentUserId, scopes: auth.scopes, client: data });
  }

  // GET /today?date=
  if (req.method === 'GET' && path === 'today') {
    const denied = requireScope(auth, 'read'); if (denied) return denied;
    const { data, error } = await auth.svc
      .from('daily_logs').select('*')
      .eq('user_id', client).eq('log_date', q.get('date') ?? todayISO()).maybeSingle();
    if (error) return fail(500, 'read_failed', error.message);
    return json({ log: data });
  }

  // GET /history?from=&to=
  if (req.method === 'GET' && path === 'history') {
    const denied = requireScope(auth, 'read'); if (denied) return denied;
    const from = q.get('from'), to = q.get('to');
    if (!from || !to) return fail(400, 'bad_request', 'Both "from" and "to" are required.');
    const { data, error } = await auth.svc
      .from('daily_logs').select('*')
      .eq('user_id', client).gte('log_date', from).lte('log_date', to)
      .order('log_date', { ascending: true });
    if (error) return fail(500, 'read_failed', error.message);
    return json({ logs: data ?? [] });
  }

  // GET /activities?from=&to= — 종목 중립 활동 테이블 (Strava/가민 임포트 포함).
  // 러닝 페이스·HR·케이던스·고도 등 rich 데이터. daily_logs 표시 엔트리의 원본.
  if (req.method === 'GET' && path === 'activities') {
    const denied = requireScope(auth, 'read'); if (denied) return denied;
    let qb = auth.svc.from('activities')
      .select('id, source, sport, name, started_at, local_date, distance_m, duration_s, moving_s, elev_gain_m, avg_hr, max_hr, avg_cadence, calories, avg_pace_s_km')
      .eq('user_id', client);
    if (q.get('from')) qb = qb.gte('local_date', q.get('from')!);
    if (q.get('to')) qb = qb.lte('local_date', q.get('to')!);
    const { data, error } = await qb.order('started_at', { ascending: false }).limit(100);
    if (error) return fail(500, 'read_failed', error.message);
    return json({ activities: data ?? [] });
  }

  // GET /assignments?from=&to=
  if (req.method === 'GET' && path === 'assignments') {
    const denied = requireScope(auth, 'read'); if (denied) return denied;
    let qb = auth.svc.from('workout_assignments')
      .select('id, trainer_id, client_id, assigned_for_date, payload, status, started_at, completed_at, created_at')
      .eq('client_id', client);
    if (q.get('from')) qb = qb.gte('assigned_for_date', q.get('from')!);
    if (q.get('to')) qb = qb.lte('assigned_for_date', q.get('to')!);
    const { data, error } = await qb.order('assigned_for_date', { ascending: false });
    if (error) return fail(500, 'read_failed', error.message);
    return json({ assignments: data ?? [] });
  }

  // POST /assignments
  if (req.method === 'POST' && path === 'assignments') {
    const denied = requireScope(auth, 'assign:write'); if (denied) return denied;
    const verr = validateWorkouts(body.workouts);
    if (verr) return fail(400, 'bad_request', verr);
    const r = await act(auth, 'assign', {
      assigned_for: body.assigned_for ?? todayISO(),
      payload: { workouts: body.workouts },
    });
    if (r.error) return fail(400, 'assign_failed', r.error);
    const unknown = unmatchedNames(body.workouts);
    return json({
      ...(r.data as Record<string, unknown>),
      ...(unknown.length ? {
        unmatched_names: unknown,
        hint: 'These titles are not in the exercise catalog, so no thumbnail will show. Search GET /exercises?q= first and reuse the catalog name when one exists.',
      } : {}),
    }, 201);
  }

  // PATCH /assignments/:id
  if (req.method === 'PATCH' && path.startsWith('assignments/')) {
    const denied = requireScope(auth, 'assign:write'); if (denied) return denied;
    const verr = validateWorkouts(body.workouts);
    if (verr) return fail(400, 'bad_request', verr);
    const r = await act(auth, 'update_assignment', {
      assignment_id: path.slice('assignments/'.length),
      payload: { workouts: body.workouts },
    });
    if (r.error) return fail(400, 'update_failed', r.error);
    return json({ assignment_id: path.slice('assignments/'.length) });
  }

  // DELETE /assignments/:id
  if (req.method === 'DELETE' && path.startsWith('assignments/')) {
    const denied = requireScope(auth, 'assign:write'); if (denied) return denied;
    const r = await act(auth, 'delete_assignment', {
      assignment_id: path.slice('assignments/'.length),
    });
    if (r.error) return fail(400, 'delete_failed', r.error);
    return json({ deleted: true });
  }

  // PUT /goals
  if (req.method === 'PUT' && path === 'goals') {
    const denied = requireScope(auth, 'goals:write'); if (denied) return denied;
    const r = await act(auth, 'set_goals', { goals: body });
    if (r.error) return fail(400, 'goals_failed', r.error);
    return json({ updated: true });
  }

  // GET /routines
  if (req.method === 'GET' && path === 'routines') {
    const denied = requireScope(auth, 'read'); if (denied) return denied;
    const { data, error } = await auth.svc
      .from('user_routines').select('id, user_id, name, exercises, created_at, updated_at').eq('user_id', client);
    if (error) return fail(500, 'read_failed', error.message);
    return json({ routines: data ?? [] });
  }

  // PUT /routines
  if (req.method === 'PUT' && path === 'routines') {
    const denied = requireScope(auth, 'routines:write'); if (denied) return denied;
    if (typeof body.name === 'string') body.name = cleanText(body.name, MAX_NAME_LEN);
    if (Array.isArray(body.exercises)) {
      if (body.exercises.length > 30) return fail(400, 'bad_request', 'Too many exercises (max 30).');
      for (const ex of body.exercises) {
        if (typeof ex !== 'object' || ex === null || typeof ex.name !== 'string' || !ex.name.trim()) {
          return fail(400, 'bad_request', 'Each routine exercise needs a "name".');
        }
        ex.name = cleanText(ex.name, MAX_NAME_LEN);
        if (ex.note != null) {
          if (typeof ex.note !== 'string') return fail(400, 'bad_request', '"note" must be a string.');
          ex.note = cleanText(ex.note, MAX_NOTE_LEN);
        }
      }
    }
    const r = await act(auth, 'upsert_routine', { routine: body });
    if (r.error) return fail(400, 'routine_failed', r.error);
    return json(r.data);
  }

  return fail(404, 'not_found', `No route for ${req.method} /${path}`);
}

// ── entrypoint ─────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // /functions/v1/agent-api/<path>
  const path = new URL(req.url).pathname
    .replace(/^\/functions\/v1/, '')
    .replace(/^\/agent-api\/?/, '')
    .replace(/\/+$/, '');

  try {
    if (req.method === 'POST' && path === 'agents') return await createAgent(req);

    const auth = await authenticateAgent(req);
    if (auth instanceof Response) return auth;
    return await route(req, path, auth);
  } catch (e) {
    // 토큰이 섞여 들어갈 수 있는 값은 절대 응답·로그에 넣지 않는다.
    console.error('[agent-api] unhandled', e instanceof Error ? e.message : 'unknown');
    return fail(500, 'internal_error', 'Unexpected error.');
  }
});
