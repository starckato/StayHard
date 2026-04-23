-- Will Cube Phase 1 — 실시간 판정 데이터 레이어.
-- 실행: supabase/scripts/sb-sql.sh 혹은 Supabase SQL Editor.
-- ⚠️ 프로덕션 실행 전 스테이징에서 먼저 검증할 것.
-- idempotent: IF NOT EXISTS / IF EXISTS 로 여러 번 실행해도 안전.

-- ── daily_logs.cubes ──────────────────────────────────────
-- 일별 Will Cube 판정 결과. 판정 없는 과거 로그는 NULL (백필 스크립트로 소급).
-- 구조:
-- {
--   "diet": "gold|silver|crimson|gray|null",
--   "exercise": "gold|gray|null",
--   "exercise_bonus": "gold|null",
--   "routine": "gold|silver|crimson|gray|null",
--   "tasks": "gold|silver|crimson|null",
--   "bonus": [{ "type": "pr|streak_7|streak_30|...|race_marathon", "color": "gold", "count": 2, ...meta }]
-- }
ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS cubes JSONB DEFAULT NULL;

-- 조회 가속 (선택) — cubes 가 채워진 로그만 필터할 때 쓰면 유용.
CREATE INDEX IF NOT EXISTS idx_daily_logs_cubes_not_null
  ON daily_logs ((cubes IS NOT NULL))
  WHERE cubes IS NOT NULL;

-- ── profiles.streak_milestones ────────────────────────────
-- 유저별로 이미 받은 스트릭 마일스톤 키 (중복 지급 방지).
-- 예: ['streak_7', 'streak_30']
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS streak_milestones JSONB DEFAULT '[]'::jsonb;

-- ── profiles.pr_records ───────────────────────────────────
-- 유저별 운동 PR 이력. 운동 저장 시 1RM/볼륨/rep별 무게와 비교.
-- 구조:
-- {
--   "byExercise": {
--     "벤치프레스": {
--       "one_rm":  { "kg": 102.5, "date": "2026-04-20" },
--       "volume":  { "kg": 3200,  "date": "2026-04-18" },
--       "repMax":  { "5": { "kg": 95, "date": "2026-04-10" }, "3": { "kg": 100, "date": "2026-04-18" } }
--     }
--   }
-- }
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS pr_records JSONB DEFAULT '{"byExercise":{}}'::jsonb;

-- ── profiles.race_history (Phase 4 선제) ──────────────────
-- 대회 수동 등록 이력. Phase 4 모달에서 채움. Phase 1 에서는 컬럼만 준비.
-- [{ "type": "marathon", "name": "서울마라톤", "date": "2026-04-20", "count": 5, "time": "4:23:15", "photo_url": "...", "memo": "..." }]
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS race_history JSONB DEFAULT '[]'::jsonb;

-- ── profiles.max_tier_reached (Phase 5 선제) ──────────────
-- 과거 도달 최고 티어. Phase 5 에서 티어 하락 방지용.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS max_tier_reached INTEGER DEFAULT 1;

-- ── 롤백 SQL (필요 시 수동 실행) ─────────────────────────
-- ALTER TABLE daily_logs DROP COLUMN IF EXISTS cubes;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS streak_milestones;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS pr_records;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS race_history;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS max_tier_reached;
-- DROP INDEX IF EXISTS idx_daily_logs_cubes_not_null;
