# qrok-mcp

다른 Claude 세션(가민 코치 등)이 큐록을 직접 읽고 편집하게 하는 MCP 서버.
REST(`agent-api` Edge Function)를 감싸는 얇은 층이며, 권한 판단은 전부 서버가 한다.

## 1. 토큰 발급 (최초 1회)

`qrok.app` 에 로그인한 상태에서 F12 콘솔:

```js
const { data } = await window.sb.auth.getSession();
const r = await fetch('https://uvaosxhsjscigheyymus.supabase.co/functions/v1/agent-api/agents', {
  method: 'POST',
  headers: { Authorization: `Bearer ${data.session.access_token}`,
             'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '가민 코치',
                         scopes: ['read','assign:write','goals:write','routines:write'] }),
});
console.log(await r.json());
```

응답의 `token` (`qrok_pat_...`) 이 **이때 한 번만** 나온다. 잃어버리면 재발급뿐이다.

여기서 만들어지는 "에이전트"는 따로 관리할 대상이 아니다. 토큰 뒤에 붙는 신원 레코드일
뿐이며, 앱에서 배정이 **예정 → 시작 → 완료** 생명주기를 타게 하려고 기존 트레이너 레일을
재사용한 것이다.

## 2. 세션에 연결

연결하려는 프로젝트에서:

```bash
claude mcp add qrok --env QROK_TOKEN=qrok_pat_xxx -- node /Users/KWAN/StayHard/mcp/qrok-mcp/index.mjs
```

또는 그 프로젝트의 `.mcp.json` 에:

```json
{
  "mcpServers": {
    "qrok": {
      "command": "node",
      "args": ["/Users/KWAN/StayHard/mcp/qrok-mcp/index.mjs"],
      "env": { "QROK_TOKEN": "qrok_pat_xxx" }
    }
  }
}
```

> `.mcp.json` 을 커밋하는 저장소라면 토큰을 직접 박지 말고 `claude mcp add` 를 쓰거나
> 셸 환경변수로 넘길 것.

## 도구

| 도구 | scope | 하는 일 |
|---|---|---|
| `qrok_get_today` | read | 특정 날짜 기록 (운동·식단·체중·물·큐브) |
| `qrok_get_history` | read | 기간 내 일별 기록 |
| `qrok_get_profile` | read | 프로필 + 현재 목표 + 누적 점수 |
| `qrok_get_assignments` | read | 배정 목록 + 수행 상태 |
| `qrok_assign_workout` | assign:write | 운동 배정 → 앱에 "예정" 뱃지 |
| `qrok_update_assignment` | assign:write | 배정 내용 교체 |
| `qrok_delete_assignment` | assign:write | 배정 취소 |
| `qrok_set_goals` | goals:write | 체중·물·목표문구 갱신 |
| `qrok_get_routines` | read | 루틴 목록 |
| `qrok_upsert_routine` | routines:write | 루틴 생성·수정 |

토큰에 없는 scope 를 요구하면 `403 insufficient_scope` 가 돌아온다.

## 안 되는 것 (의도된 것)

- `daily_logs` 직접 쓰기 — 유저의 실제 기록은 유저만 남긴다. AI 는 **배정**만 한다.
- 다른 유저 접근 — 토큰 1개는 소유자 1명에게만 묶인다. 요청으로 대상을 바꿀 수 없다.
- 분당 60회 초과 — `429 rate_limited`.

## 설정

| 환경변수 | 필수 | 기본값 |
|---|---|---|
| `QROK_TOKEN` | 예 | — |
| `QROK_API_BASE` | 아니오 | `https://uvaosxhsjscigheyymus.supabase.co/functions/v1/agent-api` |

## 점검

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 | QROK_TOKEN=qrok_pat_dummy node index.mjs 2>/dev/null
```

도구 10개가 나오면 정상. 실제 호출은 유효한 토큰이 있어야 200 이 뜬다.
