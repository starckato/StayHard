#!/usr/bin/env node
// QROK MCP server — 외부 Claude 세션이 큐록을 직접 읽고 편집하게 한다.
//
// 스펙: document-private/AGENT_API_SPEC_v1.md
// REST(agent-api Edge Function)를 감싸는 얇은 층. 권한 판단은 전부 서버가 한다.
//
// 설정:
//   QROK_TOKEN     (필수) qrok_pat_... 개인 액세스 토큰
//   QROK_API_BASE  (선택) 기본값 아래 PROD_BASE

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const PROD_BASE =
  'https://uvaosxhsjscigheyymus.supabase.co/functions/v1/agent-api';

const TOKEN = process.env.QROK_TOKEN;
const BASE = (process.env.QROK_API_BASE || PROD_BASE).replace(/\/+$/, '');

if (!TOKEN) {
  console.error('[qrok-mcp] QROK_TOKEN is not set. Add it to the MCP server env.');
  process.exit(1);
}

// ── REST 호출 ──────────────────────────────────────────────────

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    // 토큰이 섞일 수 있는 값은 절대 밖으로 내보내지 않는다.
    throw new Error(`네트워크 오류: ${e instanceof Error ? e.message : 'unknown'}`);
  }

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`서버가 JSON 이 아닌 응답을 보냈습니다 (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    const err = parsed?.error;
    throw new Error(
      `HTTP ${res.status} ${err?.code ?? 'error'}: ${err?.message ?? '알 수 없는 오류'}`,
    );
  }
  return parsed;
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ── 스키마 조각 ────────────────────────────────────────────────

const DATE = { type: 'string', description: 'YYYY-MM-DD' };

// trainer_assign_workout 이 실제로 소비하는 형태 그대로.
const WORKOUTS = {
  type: 'array',
  minItems: 1,
  description: '운동 종목 배열. 각 종목은 세트 목록을 가진다.',
  items: {
    type: 'object',
    required: ['name', 'sets'],
    properties: {
      name: { type: 'string', description: '종목명. 예: 벤치프레스' },
      muscle: { type: 'string', description: '주동근. 예: chest, back, legs' },
      equipment: { type: 'string', description: '기구. 예: barbell, dumbbell, bodyweight' },
      icon: { type: 'string', description: '아이콘 키 (선택)' },
      sets: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['reps'],
          properties: {
            kg: { type: 'number', description: '중량(kg). 맨몸이면 0' },
            reps: { type: 'integer', description: '반복 횟수' },
          },
        },
      },
    },
  },
};

const TOOLS = [
  {
    name: 'qrok_get_today',
    description:
      '큐록의 특정 날짜 기록을 읽는다. 운동·식단·체중·물·큐브 전부 포함. ' +
      '오늘 뭘 했는지 확인하거나 운동을 배정하기 전 현재 상태를 볼 때 쓴다.',
    inputSchema: {
      type: 'object',
      properties: { date: { ...DATE, description: 'YYYY-MM-DD. 생략하면 오늘' } },
    },
  },
  {
    name: 'qrok_get_history',
    description:
      '기간 내 일별 기록을 읽는다. 최근 훈련량·체중 추이를 보고 다음 운동을 계획할 때 쓴다.',
    inputSchema: {
      type: 'object',
      required: ['from', 'to'],
      properties: { from: DATE, to: DATE },
    },
  },
  {
    name: 'qrok_get_profile',
    description: '유저 프로필과 현재 목표(체중·물·목표문구), 누적 점수를 읽는다.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'qrok_get_assignments',
    description:
      '배정된 운동 목록과 수행 상태를 읽는다. 내가 배정한 운동을 실제로 했는지 확인할 때 쓴다. ' +
      'status: pending(아직 안 함) · in_progress(일부 세트 완료) · completed(전부 완료) · ' +
      'skipped · cancelled · cancelled_by_user.',
    inputSchema: {
      type: 'object',
      properties: { from: DATE, to: DATE },
    },
  },
  {
    name: 'qrok_assign_workout',
    description:
      '큐록에 운동을 배정한다. 배정하면 앱의 해당 날짜 "오늘의 운동" 카드에 "예정" 뱃지로 ' +
      '나타나고, 유저가 시작·완료하면 상태가 자동으로 갱신된다. ' +
      '같은 날짜에 또 배정하면 별도 항목으로 추가된다(덮어쓰지 않는다).',
    inputSchema: {
      type: 'object',
      required: ['workouts'],
      properties: {
        assigned_for: { ...DATE, description: '배정 날짜. 생략하면 오늘' },
        workouts: WORKOUTS,
      },
    },
  },
  {
    name: 'qrok_update_assignment',
    description:
      '이미 배정한 운동의 내용을 교체한다. assignment_id 는 qrok_get_assignments 로 얻는다.',
    inputSchema: {
      type: 'object',
      required: ['assignment_id', 'workouts'],
      properties: {
        assignment_id: { type: 'string', description: '배정 UUID' },
        workouts: WORKOUTS,
      },
    },
  },
  {
    name: 'qrok_delete_assignment',
    description: '배정한 운동을 취소한다. 유저가 이미 완료한 기록은 지우지 않는다.',
    inputSchema: {
      type: 'object',
      required: ['assignment_id'],
      properties: { assignment_id: { type: 'string', description: '배정 UUID' } },
    },
  },
  {
    name: 'qrok_set_goals',
    description:
      '유저 목표를 갱신한다. 지정한 필드만 바뀌고 나머지는 그대로 둔다.',
    inputSchema: {
      type: 'object',
      properties: {
        weight_goal: { type: 'number', description: '목표 체중(kg)' },
        water_goal: { type: 'integer', description: '하루 목표 물잔 수' },
        goal: { type: 'string', description: '목표 문구' },
      },
    },
  },
  {
    name: 'qrok_get_routines',
    description: '저장된 운동 루틴 목록을 읽는다.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'qrok_upsert_routine',
    description:
      '운동 루틴을 만들거나 수정한다. id 를 주면 해당 루틴을 갱신하고, 없으면 새로 만든다.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        id: { type: 'string', description: '기존 루틴 UUID. 새로 만들 땐 생략' },
        name: { type: 'string', description: '루틴 이름' },
        exercises: { ...WORKOUTS, minItems: 0, description: '루틴에 포함된 종목' },
      },
    },
  },
];

// ── 도구 실행 ──────────────────────────────────────────────────

async function runTool(name, args = {}) {
  switch (name) {
    case 'qrok_get_today':
      return api('GET', `/today${qs({ date: args.date })}`);
    case 'qrok_get_history':
      return api('GET', `/history${qs({ from: args.from, to: args.to })}`);
    case 'qrok_get_profile':
      return api('GET', '/me');
    case 'qrok_get_assignments':
      return api('GET', `/assignments${qs({ from: args.from, to: args.to })}`);
    case 'qrok_assign_workout':
      return api('POST', '/assignments', {
        assigned_for: args.assigned_for,
        workouts: args.workouts,
      });
    case 'qrok_update_assignment':
      return api('PATCH', `/assignments/${encodeURIComponent(args.assignment_id)}`, {
        workouts: args.workouts,
      });
    case 'qrok_delete_assignment':
      return api('DELETE', `/assignments/${encodeURIComponent(args.assignment_id)}`);
    case 'qrok_set_goals':
      return api('PUT', '/goals', {
        weight_goal: args.weight_goal,
        water_goal: args.water_goal,
        goal: args.goal,
      });
    case 'qrok_get_routines':
      return api('GET', '/routines');
    case 'qrok_upsert_routine':
      return api('PUT', '/routines', {
        id: args.id,
        name: args.name,
        exercises: args.exercises ?? [],
      });
    default:
      throw new Error(`알 수 없는 도구: ${name}`);
  }
}

// ── 서버 ───────────────────────────────────────────────────────

const server = new Server(
  { name: 'qrok', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const result = await runTool(name, args ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: e instanceof Error ? e.message : '알 수 없는 오류' }],
    };
  }
});

await server.connect(new StdioServerTransport());
console.error(`[qrok-mcp] ready · ${BASE}`);
