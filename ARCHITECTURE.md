# 큐록 (QROK) — Architecture Guide

> **목표**: 새 개발자가 5분 안에 코드 구조를 파악하고, 기능을 수정할 때 *한 폴더만* 만지면 되도록.
> 마지막 갱신: 2026-05-07.

## 30초 개요

큐록은 **단련/직면** 컨셉의 한국어 라이프 트래커. 식단·운동·루틴·체중·할일을 매일 기록해서 **Will Cube** (gold/silver/red) 를 모으고, 누적 큐브가 *티어* 를 결정 (방관자 → 기록자 6단). 12명 운영 중 · 앱스토어 출시 보류.

### 스택
| 층 | 기술 |
|---|---|
| Frontend | Vanilla JS · esbuild (IIFE 번들) · ES Modules |
| 호스팅 | Vercel (Edge Middleware 로 보안 헤더 + Supabase config 주입) |
| 모바일 | Capacitor (선택, iOS/Android 감싸기) |
| 백엔드 | Supabase — Postgres + Auth + Storage + Realtime |
| 빌드 | `npm run build` → `dist/app.js` + `dist/app.css` |

### URL/엔트리
- `/` → `index.html` (메인 앱)
- `/trainer` → `trainer.html` (PT 대시보드, 별도 SPA)
- `/admin` → `admin.html` (운영 대시보드)

---

## 저장소 지도

```
StayHard/
├── index.html              ← 메인 앱. ⚠️ 16,800줄 (인라인 JS 90%) — 점진적 추출 진행 중
├── trainer.html            ← PT 대시보드 (별도 SPA, 3,900줄)
├── admin.html              ← 운영 대시보드
├── middleware.js           ← Vercel Edge — Supabase config + 보안 헤더 주입
├── src/
│   ├── main.js             ← 번들 진입점. 모든 feature import + window 노출
│   ├── data/               ← 정적 데이터 (운동 라이브러리 / 점수 이벤트 / 카피 / ...)
│   │   ├── exercises.js    ← 운동 라이브러리
│   │   ├── score-events.js ← SCORE_EVENTS (legacy 점수 — 큐브제로 이행 중)
│   │   ├── pushup-cv.js    ← MediaPipe 푸쉬업 CV 데이터
│   │   └── ...
│   ├── features/           ← 기능별 폴더 (canonical 위치)
│   │   ├── targets/        ← 할일 ✓ 추출 완료 (모범 예시)
│   │   ├── weight/         ← 체중 ✓ 추출 완료 (모범 예시)
│   │   ├── friends/        ← 친구 ✓ 추출 완료 (모범 예시)
│   │   ├── cubes/          ← Will Cube 판정/점수/PR/streak
│   │   ├── stats/          ← 분석 탭
│   │   ├── pushup/         ← CV 카운터 모달 (일부)
│   │   ├── onboarding/     ← 첫 큐브 / 첫 주 미션 (일부)
│   │   ├── flags/          ← Feature Flags
│   │   ├── notif/          ← 로컬 알림 opt-in
│   │   └── ...
│   ├── lib/                ← 순수 유틸 (date / tier / supabase client / icons / ...)
│   │   ├── tier.js         ← 6단 티어 + getTierFromCubes (B 공식)
│   │   ├── supabase.js     ← Supabase client (window.__SB_CONFIG 사용)
│   │   └── ...
│   ├── platform/           ← native/web 플랫폼 추상화 (camera/haptics/notifications)
│   ├── styles/             ← 글로벌 토큰 (CSS variables)
│   │   ├── tokens.shared.css
│   │   ├── tokens.dark.css
│   │   ├── tokens.light.css
│   │   └── index.css       ← feature CSS @import 들의 진입점
│   └── ui/toast.js         ← 글로벌 토스트
├── migrations/             ← canonical Supabase SQL (수동 적용 via scripts/sb-sql.sh)
│   ├── 001_*.sql ~ 049_*.sql
├── supabase/migrations/    ← DEPRECATED (README 참고). 신규는 /migrations/ 에
├── scripts/                ← 운영 스크립트
│   ├── sb-sql.sh           ← Supabase Management API 로 SQL 실행 (PAT 필요)
│   └── backfill-cubes.mjs
├── prototypes/             ← UI 실험 — 직접 보고 결정 (production X)
├── document-private/       ← 기획/스펙 문서 (gitignored, 로컬 보관)
└── dist/                   ← esbuild 출력 (gitignored)
```

---

## 이 기능을 수정하려면 — *한 폴더만*

### ✅ 잘 된 예시 (모범)

#### 할일 (targets) — `src/features/targets/`
- 카드 markup → `index.html` 의 `<div id="targets-card">` (mount 지점만)
- 그 외 모든 것 → `src/features/targets/`
  - `index.js` — `renderTargets`, `addTarget`, `togTgt`, `markFail`, `delTgt`, `toggleAddTgt`, `toggleTargetsCard`, `renderTargetsSummary`, `openPromoteTodoModal` 등
  - `targets.css` — `.tgt-row`, `.tgt-btn`, `.add-tgt-input` 등 스타일
  - `tests.js` — smoke tests

수정 시나리오:
- "할일 완료 시 점수 +2 → +5" → `src/data/score-events.js` 의 `target_done` 값 변경 (+ 모달 카피 동기화)
- "할일 카드 디자인 변경" → `src/features/targets/targets.css`
- "할일 표시 로직 변경" → `src/features/targets/index.js` 의 `renderTargets`

#### 체중 (weight) — `src/features/weight/`
- 마크업 → `index.html` `<div id="wt-card">`, weight modal `<div id="weight-modal">`
- 로직 → `src/features/weight/index.js` (renderWeight / openWeightModal / saveWeight / 그래프)

#### 친구 (friends) — `src/features/friends/`
- 마크업 → `<div id="sub-friends">` (mount 지점만)
- 로직 → `src/features/friends/{index,ui,api,nudge,presets}.js`

### ⚠️ 아직 흩어진 기능 (점진적 이전 중)

| 기능 | 현재 위치 | 우선순위 |
|---|---|---|
| 식단 (meals) | index.html 7개 region + `src/lib/meal-photo.js` + `src/lib/cheat.js` + `src/features/cubes/judge.js` | HIGH |
| 운동 (workouts) | index.html 4개 region (~2500줄) + `src/data/exercises.js` | HIGH |
| 루틴 (mandatory) | index.html 2개 region | MED |
| 챌린지 | index.html (markup + logic 2500줄) | MED |
| CV 푸쉬업 | index.html 끝부분 950줄 + `src/features/pushup/` 병렬 구현 | MED |
| 점수 가이드 모달 | index.html + SCORE_EVENTS 하드코딩 mismatch 위험 | LOW |

---

## Feature Folder 컨벤션

새 기능 / 큰 기능 추출 시 다음 구조 따름:

```
src/features/X/
├── index.js     ← public API. main.js 가 import 후 window 에 spread
├── ui.js        ← (선택) 큰 경우 분리. DOM 템플릿 / 렌더 헬퍼
├── api.js       ← (선택) Supabase read/write. plain 객체 반환
├── judge.js     ← (선택) 큐브/점수 판정 (또는 cubes/judge.js re-export)
├── X.css        ← feature CSS — `src/styles/index.css` 에서 @import
└── tests.js     ← smoke tests (`window.run<Feature>Tests()` 콘솔 호출)
```

### 규칙

1. **`window.log` / `window.CP` 직접 사용 금지** — 가능하면 `mount(el, store)` 형태로 store 인자 받기. (현재 부분 적용 — 점진 진행)
2. **`onclick="globalFn()"` 가능하지만, fn 은 반드시 `src/features/X/index.js` 에서 export → `main.js` 가 window 에 노출**
3. **CSS 는 feature 폴더 안에** — 글로벌 변수 (var(--accent)) 는 `src/styles/tokens.shared.css` 에서 가져옴
4. **DB 작업은 `api.js` 한 곳에 모음** — 컴포넌트가 직접 `sb.from(...)` 호출 안 함 (가능하면)
5. **SECURITY DEFINER RPC 추가 시** — `migrations/NNN_X_*.sql` 에 작성 + 호출은 `api.js`

### 새 기능 추가 시 단계

1. `src/features/X/index.js` 생성 — export 정의
2. `src/features/X/X.css` 생성 (필요 시)
3. `src/main.js` 에서 import 후 `Object.assign(window, X)` 추가
4. `src/styles/index.css` 에서 `@import './features/X/X.css';`
5. `index.html` 에 mount 지점 (마크업) 추가
6. `tests.js` 작성 (최소 smoke test)
7. `npm run build` 로 번들 검증

---

## DB 와 마이그레이션

### 캐노니컬 위치
- `migrations/NNN_description.sql` — 모든 신규 마이그레이션
- `supabase/migrations/` — DEPRECATED (README 참고)

### 적용 방법
```bash
# 사용자 (KWAN) 의 PAT 가 ~/.qrok-sb-pat 에 있어야 함
./scripts/sb-sql.sh migrations/NNN_yourfile.sql
```

### 마이그레이션 작성 규칙
- 파일명 `NNN_lowercase_with_underscores.sql` (다음 번호: 050)
- `BEGIN; ... COMMIT;` 트랜잭션으로 감쌈
- **idempotent** — `IF NOT EXISTS` / `OR REPLACE` / `DROP IF EXISTS` 활용
- 검증 쿼리 + 롤백 SQL 을 주석으로 파일 끝에
- destructive 변경은 PR/사용자 명시 승인 필요

### RLS 패턴
- 모든 user-data 테이블은 `ENABLE ROW LEVEL SECURITY` + `auth.uid()` 정책
- UPDATE 정책엔 반드시 `WITH CHECK` (USING 만 있으면 row 변조 가능)
- admin RPC 는 `is_admin()` gate
- 클라이언트 직접 변경하면 안 되는 컬럼 (예: `lifetime_*`) 은 BEFORE UPDATE 트리거 + SECURITY DEFINER RPC 패턴 (`migrations/049` 참고)

### 주요 RPC
| RPC | 용도 | 위치 |
|---|---|---|
| `apply_cube_delta(date, dG, dS, dR)` | lifetime 큐브 갱신 (정상 경로) | 049 |
| `tier_from_cubes(g, s, r)` | B 공식 티어 산출 | 047 |
| `score_from_cubes(g, s, r)` | B 공식 점수 환산 | 047 |
| `tier_from_score(score)` | LEGACY — total_score 기반 (deprecate 예정) | 016 |
| `list_friends_with_status()` | 친구 목록 + 티어/streak | 016 + 026 |
| `send_nudge(receiver, preset)` | 친구 nudge 보내기 | 017 + 019 |
| `admin_dashboard()` | 운영 KPI (is_admin gate) | 004 |
| `delete_my_account()` | 계정 + 데이터 삭제 cascade | 013 |

---

## 보안 체크리스트 (출시 전)

- [x] 모든 user-data 테이블 RLS 활성 + 본인 row 만 (`migrations/048` 명시)
- [x] 모든 UPDATE 정책에 `WITH CHECK` (047 ~ 049 에서 보강)
- [x] CSP / HSTS / X-Frame-Options 헤더 (`middleware.js`)
- [x] env var 주입 시 `JSON.stringify` escape (`middleware.js`)
- [x] lifetime 큐브 직접 UPDATE 차단 — 트리거 + RPC (`migrations/049`)
- [x] XSS — `innerHTML` interpolation 시 사용자 입력은 `textContent` 사용
- [ ] secrets 가 dist 번들에 노출 안 됨 — 정기 검토 (`grep -i "secret\|key\|password" dist/app.js`)
- [ ] meal photos signed URL TTL 적절 (1h)
- [ ] 친구 코드 / nudge / 트레이너 메시지 rate limit (일부 적용 — `017_nudges.sql`)

---

## Build & Deploy

### 로컬 dev
```bash
npm run dev  # esbuild watch + serve
```
→ `localhost:3000` (또는 esbuild 기본 포트)

### Production build
```bash
npm run build  # esbuild → dist/app.js + dist/app.css
```

### Vercel deploy
- main 브랜치 push → 자동 배포
- preview URL: PR 별 자동 생성
- env vars: SB_URL / SB_KEY / SB_SERVICE_ROLE 등 Vercel dashboard 에서 관리

### Capacitor (모바일)
```bash
./scripts/cap-prepare.sh  # iOS/Android 빌드 prep
npx cap sync
npx cap open ios   # 또는 android
```

---

## 흔한 함정 / 주의사항

1. **`index.html` 인라인 스크립트가 `src/` 모듈 함수를 *덮어쓸* 수 있음** — 같은 이름의 글로벌이 양쪽에 있으면 inline 이 나중 실행되어 덮어쓰기. main.js 가 먼저 spread 하지만 inline 이 재할당하면 그게 win.
2. **`window.log` 글로벌 mutation** — 어떤 함수든 `log.meals.push(...)` 직접 호출. 새 코드는 *함수 인자로 log 받기* 권장.
3. **두 개의 점수 시스템 공존** — `addScore()` (legacy) + `recomputeCubesHook()` (새). cutover 진행 중. 새 기능은 cube 시스템만 사용.
4. **마이그레이션 폴더 두 개** — `/migrations/` 만 사용. `/supabase/migrations/` 는 historical.
5. **인라인 `onclick="fn()"`** — 함수가 반드시 `window.fn` 에 있어야 동작. 모듈 export 후 main.js 에서 noexpose 하면 break.
6. **CUBE_UI_MODE 플래그** — `window.CUBE_UI_MODE = true` 하드코딩. addScore 가 분기 처리. 큐브제 cutover 완료 후 제거.

---

## 새 코드는 어디로?

| 종류 | 위치 |
|---|---|
| 새 기능 (UI + 로직) | `src/features/X/` 새 폴더 |
| 정적 데이터 (운동 라이브러리, 코피 풀) | `src/data/` |
| 순수 유틸 (계산, 포매팅, 쿠키) | `src/lib/` |
| native/web 추상화 | `src/platform/` |
| Supabase SQL | `migrations/NNN_*.sql` |
| Vercel Edge 로직 | `middleware.js` |
| 신규 ProtoType | `prototypes/` |
| 운영 스크립트 | `scripts/` |

**❌ 새 코드를 `index.html` 인라인에 추가하지 마세요.** 이미 16,800줄. 새 추가 = 미래 newcomer 가 또 헤맴.

---

## 도움 요청

- 코드 구조 / 패턴 질문 → 이 문서 먼저 + `document-private/IA_SPEC/15_glossary.csv`
- DB 스키마 / RLS → `migrations/` 의 최신 파일 + Supabase dashboard
- 디자인 / UX 결정 → `prototypes/` 의 prototype HTML 직접 보기
- Will Cube 시스템 → `document-private/CUBE_TIER_MIGRATION.md` + `src/features/cubes/judge.js`
- 사용자 플로우 → `src/features/onboarding/index.js`
