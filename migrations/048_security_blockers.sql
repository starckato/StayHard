-- 048_security_blockers.sql
-- Pre-app-store-launch 보안 블로커 일괄 수정 (2026-05-07).
-- 출처: security audit 2026-05-07 — 5 BLOCKERS 중 DB 사이드 4개.
--
-- 1. CRITICAL — 클라이언트가 profiles.lifetime_* 직접 update 가능 (자기 큐브 무제한 자가 인플레)
--    → REVOKE UPDATE column-level + apply_cube_delta() SECURITY DEFINER RPC
-- 2. MEDIUM — daily_logs RLS 가 마이그레이션에 명시 안 됨 (수동 적용 추정)
--    → idempotent ALTER TABLE / CREATE POLICY IF NOT EXISTS 로 명시
-- 3. MEDIUM — workout_assignments client UPDATE 의 WITH CHECK 누락
--    → 정책 재생성 (DROP + CREATE)
-- 4. MEDIUM — trainer_clients UPDATE 의 WITH CHECK 누락
--    → 정책 재생성
--
-- idempotent: IF NOT EXISTS / OR REPLACE / DROP IF EXISTS — 재실행 안전.

BEGIN;

-- ════════════════════════════════════════════════════════════
-- BLOCKER 1 — lifetime_* 컬럼 클라이언트 직접 update 차단
-- ════════════════════════════════════════════════════════════

-- 컬럼 레벨 GRANT 회수 — authenticated 가 직접 UPDATE 못 하도록.
-- profiles 의 다른 컬럼은 기존 RLS UPDATE 정책으로 계속 가능.
REVOKE UPDATE (lifetime_gold, lifetime_silver, lifetime_red)
  ON public.profiles
  FROM authenticated, anon;

-- 정상 경로 — 클라이언트는 이 RPC 만 호출.
-- 입력: 일별 cube 변화량 (delta). 절대값 ±50 cap (악의적 큰 입력 차단).
-- 처리: 본인 row 락 → lifetime 누적 (max 0) → red destruction (delta_red>0 시 N=2) → return 새 값.
-- security: SECURITY DEFINER 로 컬럼 GRANT 우회. auth.uid() 로 본인 row 만.
CREATE OR REPLACE FUNCTION public.apply_cube_delta(
  p_log_date     date,
  p_delta_gold   integer,
  p_delta_silver integer,
  p_delta_red    integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_g int; v_s int; v_r int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  -- 절대값 cap — 단일 호출 max ±50. 정상 사용자 하루 영향 (최대 ~10) 의 5배 여유.
  IF abs(COALESCE(p_delta_gold, 0))   > 50
     OR abs(COALESCE(p_delta_silver, 0)) > 50
     OR abs(COALESCE(p_delta_red, 0))    > 50 THEN
    RAISE EXCEPTION 'delta_out_of_range' USING ERRCODE = '22023';
  END IF;

  -- log_date 가 미래거나 너무 과거면 거부 (정상 케이스: 오늘 또는 최근 30일).
  IF p_log_date IS NULL
     OR p_log_date > (CURRENT_DATE + 1)
     OR p_log_date < (CURRENT_DATE - 365) THEN
    RAISE EXCEPTION 'date_out_of_range' USING ERRCODE = '22023';
  END IF;

  -- 본인 row 락 + 현재값 읽기.
  SELECT
    COALESCE(lifetime_gold,   0),
    COALESCE(lifetime_silver, 0),
    COALESCE(lifetime_red,    0)
  INTO v_g, v_s, v_r
  FROM profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- 일반 누적 (음수 가능 — undo 케이스).
  v_g := GREATEST(0, v_g + p_delta_gold);
  v_s := GREATEST(0, v_s + p_delta_silver);
  v_r := GREATEST(0, v_r + p_delta_red);

  -- Red destruction (사용자 결정 N=2): delta_red > 0 시 추가 차감.
  -- delta_red < 0 (undo) 시 차감 복구는 비가역 — red 카운트만 감소.
  IF p_delta_red > 0 THEN
    v_g := GREATEST(0, v_g - 2 * p_delta_red);
    v_s := GREATEST(0, v_s - 2 * p_delta_red);
  END IF;

  UPDATE profiles
  SET lifetime_gold   = v_g,
      lifetime_silver = v_s,
      lifetime_red    = v_r
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'gold',   v_g,
    'silver', v_s,
    'red',    v_r
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_cube_delta(date, integer, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.apply_cube_delta(date, integer, integer, integer) IS
  'Will Cube — lifetime delta 적용 (단일 정상 경로). authenticated 만. 절대값 ±50 cap. red destruction N=2. profiles.lifetime_* 직접 UPDATE 차단됨 (REVOKE).';

-- ════════════════════════════════════════════════════════════
-- BLOCKER 4 — daily_logs RLS 명시 (idempotent assert)
-- ════════════════════════════════════════════════════════════

-- 활성화 (이미 활성이어도 문제 없음).
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;

-- 본인 row 만 SELECT — 기존 정책 있으면 보존, 없으면 생성.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='daily_logs' AND policyname='daily_logs_owner_select'
  ) THEN
    CREATE POLICY daily_logs_owner_select ON public.daily_logs
      FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- 본인 row 만 INSERT.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='daily_logs' AND policyname='daily_logs_owner_insert'
  ) THEN
    CREATE POLICY daily_logs_owner_insert ON public.daily_logs
      FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- 본인 row 만 UPDATE.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='daily_logs' AND policyname='daily_logs_owner_update'
  ) THEN
    CREATE POLICY daily_logs_owner_update ON public.daily_logs
      FOR UPDATE TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- 본인 row 만 DELETE.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='daily_logs' AND policyname='daily_logs_owner_delete'
  ) THEN
    CREATE POLICY daily_logs_owner_delete ON public.daily_logs
      FOR DELETE TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- BLOCKER 3 — workout_assignments / trainer_clients UPDATE WITH CHECK
-- ════════════════════════════════════════════════════════════

-- workout_assignments: 클라이언트가 status 만 변경. WITH CHECK 누락 → trainer_id 등 임의 변경 가능했음.
DROP POLICY IF EXISTS wa_client_status_update ON public.workout_assignments;
CREATE POLICY wa_client_status_update ON public.workout_assignments
  FOR UPDATE TO authenticated
  USING (client_id = auth.uid())
  WITH CHECK (client_id = auth.uid());

-- trainer_clients: 양쪽 (트레이너/클라이언트) UPDATE. WITH CHECK 추가.
DROP POLICY IF EXISTS tc_either_update ON public.trainer_clients;
CREATE POLICY tc_either_update ON public.trainer_clients
  FOR UPDATE TO authenticated
  USING (trainer_id = auth.uid() OR client_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid() OR client_id = auth.uid());

COMMIT;

-- ════════════════════════════════════════════════════════════
-- 검증 쿼리 (수동 실행)
-- ════════════════════════════════════════════════════════════
-- 1. RPC 호출 테스트 (정상)
-- SELECT apply_cube_delta(CURRENT_DATE, 1, 0, 0);
-- → {"gold": 1, "silver": 0, "red": 0}
--
-- 2. RPC 호출 (cap 초과 → 에러)
-- SELECT apply_cube_delta(CURRENT_DATE, 999, 0, 0);
-- → ERROR: delta_out_of_range
--
-- 3. 직접 UPDATE 차단 확인 (RLS bypass 시도)
-- UPDATE profiles SET lifetime_gold = 99999 WHERE id = auth.uid();
-- → ERROR: permission denied for table profiles
--
-- 4. daily_logs 정책 확인
-- SELECT polname FROM pg_policies WHERE tablename='daily_logs' ORDER BY polname;
-- → daily_logs_owner_delete / _insert / _select / _update + (existing trainer policies)
--
-- 5. trainer_clients / workout_assignments 정책 WITH CHECK 확인
-- SELECT polname, polcmd, qual, with_check FROM pg_policies
-- WHERE tablename IN ('trainer_clients','workout_assignments') AND polcmd='u';
-- → with_check 가 NOT NULL 이어야 함

-- ════════════════════════════════════════════════════════════
-- 롤백 (재해 시)
-- ════════════════════════════════════════════════════════════
-- BEGIN;
-- GRANT UPDATE (lifetime_gold, lifetime_silver, lifetime_red) ON public.profiles TO authenticated;
-- DROP FUNCTION IF EXISTS public.apply_cube_delta(date, integer, integer, integer);
-- (daily_logs RLS / trainer_clients / workout_assignments 정책은 보안 강화이므로 롤백 불필요)
-- COMMIT;
