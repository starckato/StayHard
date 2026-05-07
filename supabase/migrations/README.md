# supabase/migrations/ — DEPRECATED

> 이 폴더는 *역사적 보존* 용. 신규 마이그레이션은 `/migrations/` 에 작성.

## 이유

큐록은 Supabase CLI 자동 마이그레이션 파이프라인을 사용하지 않음. 모든 SQL 은
`scripts/sb-sql.sh` (Management API + PAT) 로 *수동 적용*. 따라서:

- **canonical 폴더**: `/migrations/` (047_will_cube_b_formula_phase1.sql 등 47+ 파일)
- **이 폴더 (`/supabase/migrations/`)**: 2026-04 시점 Will Cube 초기 구상 SQL. 이미 DB
  적용 완료. 보존 목적 외 사용 금지.

## 적용 이력

| 파일 | 적용일 | 후속 조치 |
|---|---|---|
| `20260424_will_cube_phase1.sql` | 2026-04-24 | `/migrations/047` 가 컬럼/RPC 재정의로 superseded |
| `20260424_will_cube_total_score_backfill.sql` | 2026-04-24 | 사용자 결정 (2026-05-06) "전체 0 리셋" 으로 obsoleted |

## 신규 마이그레이션 작성 시

`/migrations/` 에 `NNN_description.sql` 형식 (현재 048, 049 까지). idempotent
(IF NOT EXISTS / OR REPLACE) 로 재실행 안전하게.

## 참조

- security audit 2026-05-07 — 이 폴더 중복이 BLOCKER 후보로 식별됨
- `/migrations/048_security_blockers.sql` — pre-launch 보안 블로커 일괄 수정
- `/migrations/049_protect_lifetime_via_trigger.sql` — 트리거 기반 lifetime 보호
