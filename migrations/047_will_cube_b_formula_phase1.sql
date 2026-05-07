-- 047_will_cube_b_formula_phase1.sql
-- Will Cube · B 공식 (score = gold + silver/3) 티어 시스템 마이그레이션 — Phase 1.
--
-- 목적:
--   1. profiles 에 lifetime_gold/silver/red 컬럼 추가 (default 0).
--   2. 전체 유저 *큐브 시스템 출시 = 모두 같은 출발선* — total_score / pr_records /
--      streak_milestones / lifetime_* 모두 0/빈값으로 리셋. 백필 없음.
--   3. tier_from_cubes(g, s, r) RPC — B 공식 임계 (12/60/200/500/1400) 반환.
--   4. score_from_cubes(g, s, r) RPC — 환산 점수 반환.
--
-- 사용자 결정 (2026-05-06):
--   * 티어 공식: B (gold + silver/3)
--   * Red 패널티: N=2 (1 red 발생 시 lifetime_gold −2 + lifetime_silver −2 + lifetime_red +1)
--     → 차감 로직은 *클라이언트 hook* 책임. SQL 은 컬럼/RPC 만.
--   * 임계값: 각성자 12 · 저항자 60 · 수련자 200 · 지배자 500 · 기록자 1400
--   * 기존 daily_logs.cubes 는 *보존* (참고/감사용) — lifetime 합산엔 미포함.
--
-- 실행: supabase/scripts/sb-sql.sh 또는 SQL Editor.
-- ⚠️ 프로덕션 적용 전 스테이징 검증 + dry-run.
-- ⚠️ destructive: 모든 유저 점수/마일스톤/PR 0 으로 리셋. 되돌릴 수 없음.
-- idempotent: IF NOT EXISTS / OR REPLACE — 재실행 시 컬럼/함수 재생성만.

BEGIN;

-- ── 1. lifetime cube counters ─────────────────────────────
-- 평생 누적 큐브. recomputeCubesHook (클라이언트) 가 일별 cube delta 를
-- atomic 하게 더함. tier_from_cubes 의 source-of-truth.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS lifetime_gold   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_silver integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_red    integer NOT NULL DEFAULT 0;

-- ── 2. 전체 리셋 — 큐브 시스템 출시 이벤트 ──────────────
-- Phase 0 (사용자 결정). 모든 유저 같은 출발선.
-- 보존: username · display_name · email · water_goal · weight_goal ·
--       cheat_quota · cheat_used · feature_flags · accent_preference ·
--       notif_opt_in_history · onboarded · is_admin · system_notice ·
--       return_state · exempt_log · daily_logs.cubes (역사 보존).
-- 리셋: total_score · pr_records · streak_milestones · lifetime_*.
UPDATE profiles
SET total_score        = 0,
    pr_records         = '{}'::jsonb,
    streak_milestones  = '[]'::jsonb,
    lifetime_gold      = 0,
    lifetime_silver    = 0,
    lifetime_red       = 0;

-- ── 3. tier_from_cubes(g, s, r) RPC ───────────────────────
-- B 공식: score = gold + silver/3.
-- red 인자는 미사용 — clarity 위해 시그니처에 포함 (호출측 코드 일관성).
-- 실제 차감은 lifetime_gold/silver 갱신 시점에 클라이언트가 적용.
-- IMMUTABLE: 동일 입력 → 동일 출력. 인덱스/뷰에 안전.
CREATE OR REPLACE FUNCTION public.tier_from_cubes(
  p_gold   integer,
  p_silver integer,
  p_red    integer DEFAULT 0
)
  RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_gold, 0) + COALESCE(p_silver, 0) / 3.0 < 12   THEN '방관자'
    WHEN COALESCE(p_gold, 0) + COALESCE(p_silver, 0) / 3.0 < 60   THEN '각성자'
    WHEN COALESCE(p_gold, 0) + COALESCE(p_silver, 0) / 3.0 < 200  THEN '저항자'
    WHEN COALESCE(p_gold, 0) + COALESCE(p_silver, 0) / 3.0 < 500  THEN '수련자'
    WHEN COALESCE(p_gold, 0) + COALESCE(p_silver, 0) / 3.0 < 1400 THEN '지배자'
    ELSE '기록자'
  END;
$$;

-- ── 4. score_from_cubes(g, s, r) RPC ──────────────────────
-- B 공식 점수 환산. 리더보드 정렬 · 분석 · UI 표시용.
CREATE OR REPLACE FUNCTION public.score_from_cubes(
  p_gold   integer,
  p_silver integer,
  p_red    integer DEFAULT 0
)
  RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_gold, 0) + COALESCE(p_silver, 0) / 3.0;
$$;

-- ── 5. 컬럼/함수 주석 ─────────────────────────────────────
COMMENT ON COLUMN profiles.lifetime_gold IS
  'Will Cube — 평생 누적 gold. B 공식 티어 입력 1차.';
COMMENT ON COLUMN profiles.lifetime_silver IS
  'Will Cube — 평생 누적 silver. B 공식: score = gold + silver/3.';
COMMENT ON COLUMN profiles.lifetime_red IS
  'Will Cube — 평생 누적 red (audit/통계). 1 red 발생 시 클라이언트가 즉시 lifetime_gold -=2, lifetime_silver -=2, lifetime_red +=1 (max 0 floor) 적용.';
COMMENT ON FUNCTION public.tier_from_cubes(int,int,int) IS
  'Will Cube B 공식 → 티어 레이블. score=gold+silver/3 임계 12/60/200/500/1400.';
COMMENT ON FUNCTION public.score_from_cubes(int,int,int) IS
  'Will Cube B 공식 점수 환산: gold + silver/3.';

COMMIT;

-- ── 검증 (수동 실행) ──────────────────────────────────────
-- SELECT
--   COUNT(*) AS total_users,
--   SUM(CASE WHEN total_score=0 THEN 1 ELSE 0 END) AS reset_score,
--   SUM(CASE WHEN lifetime_gold=0 AND lifetime_silver=0 AND lifetime_red=0 THEN 1 ELSE 0 END) AS reset_cubes
-- FROM profiles;
-- → 모든 카운트가 같으면 리셋 성공.
--
-- SELECT tier_from_cubes(0, 0)        AS t1,   -- 방관자
--        tier_from_cubes(8, 12)       AS t2,   -- 각성자  (8 + 4 = 12)
--        tier_from_cubes(40, 60)      AS t3,   -- 저항자  (40 + 20 = 60)
--        tier_from_cubes(150, 150)    AS t4,   -- 수련자  (150 + 50 = 200)
--        tier_from_cubes(400, 300)    AS t5,   -- 지배자  (400 + 100 = 500)
--        tier_from_cubes(1100, 900)   AS t6;   -- 기록자  (1100 + 300 = 1400)

-- ── 롤백 (재해 시) ────────────────────────────────────────
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.tier_from_cubes(int,int,int);
-- DROP FUNCTION IF EXISTS public.score_from_cubes(int,int,int);
-- ALTER TABLE profiles
--   DROP COLUMN IF EXISTS lifetime_gold,
--   DROP COLUMN IF EXISTS lifetime_silver,
--   DROP COLUMN IF EXISTS lifetime_red;
-- COMMIT;
-- (NOTE: total_score / pr_records / streak_milestones 리셋 은 자동 복원 불가.
--  Supabase 백업에서 PITR (Point-in-Time Recovery) 로만 복구 가능.)
