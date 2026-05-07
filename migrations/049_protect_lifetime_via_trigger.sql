-- 049_protect_lifetime_via_trigger.sql
-- 048 의 REVOKE column-level 이 Supabase default table-level GRANT ALL 에 의해 무효화됨.
-- → BEFORE UPDATE 트리거로 lifetime_* 직접 변경 차단. apply_cube_delta() 만 우회 허용.
--
-- 패턴: SET LOCAL 으로 세션 변수를 RPC 안에서만 설정, 트리거가 변수 확인.

BEGIN;

-- ── Lifetime 보호 트리거 ──────────────────────────────────
CREATE OR REPLACE FUNCTION public._protect_lifetime_cubes()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  -- apply_cube_delta() 안에서만 플래그 설정. 일반 UPDATE 는 변수 없음 → reject.
  IF COALESCE(current_setting('app.allow_lifetime_update', true), '') = 'true' THEN
    RETURN NEW;
  END IF;
  -- service_role / postgres (관리자 직접 SQL) 는 통과.
  IF session_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  -- 위 조건 외 = authenticated 가 직접 UPDATE 시도. 차단.
  IF NEW.lifetime_gold   IS DISTINCT FROM OLD.lifetime_gold
     OR NEW.lifetime_silver IS DISTINCT FROM OLD.lifetime_silver
     OR NEW.lifetime_red    IS DISTINCT FROM OLD.lifetime_red THEN
    RAISE EXCEPTION 'lifetime_cubes_protected: use apply_cube_delta() RPC' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_lifetime ON public.profiles;
CREATE TRIGGER profiles_protect_lifetime
  BEFORE UPDATE OF lifetime_gold, lifetime_silver, lifetime_red
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public._protect_lifetime_cubes();

-- ── apply_cube_delta 갱신 — 트리거 우회 플래그 설정 ──────
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

  IF abs(COALESCE(p_delta_gold, 0))   > 50
     OR abs(COALESCE(p_delta_silver, 0)) > 50
     OR abs(COALESCE(p_delta_red, 0))    > 50 THEN
    RAISE EXCEPTION 'delta_out_of_range' USING ERRCODE = '22023';
  END IF;

  IF p_log_date IS NULL
     OR p_log_date > (CURRENT_DATE + 1)
     OR p_log_date < (CURRENT_DATE - 365) THEN
    RAISE EXCEPTION 'date_out_of_range' USING ERRCODE = '22023';
  END IF;

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

  v_g := GREATEST(0, v_g + p_delta_gold);
  v_s := GREATEST(0, v_s + p_delta_silver);
  v_r := GREATEST(0, v_r + p_delta_red);

  IF p_delta_red > 0 THEN
    v_g := GREATEST(0, v_g - 2 * p_delta_red);
    v_s := GREATEST(0, v_s - 2 * p_delta_red);
  END IF;

  -- 트리거 우회 플래그 (이 트랜잭션 내에서만).
  PERFORM set_config('app.allow_lifetime_update', 'true', true);

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

-- 048 의 REVOKE 는 무효화되었지만 그대로 둠 — defense-in-depth 의도 표시.

COMMIT;

-- ── 검증 ─────────────────────────────────────────────────
-- 1) 직접 UPDATE 차단 확인 (실제 유저 세션에서):
--    UPDATE profiles SET lifetime_gold = 99999 WHERE id = auth.uid();
--    → ERROR: lifetime_cubes_protected: use apply_cube_delta() RPC
--
-- 2) RPC 정상 동작:
--    SELECT apply_cube_delta(CURRENT_DATE, 1, 0, 0);
--    → {"gold": 1, ...}
--
-- 3) 트리거 / 함수 존재 확인:
--    SELECT tgname FROM pg_trigger WHERE tgrelid='public.profiles'::regclass;
--    → profiles_protect_lifetime
