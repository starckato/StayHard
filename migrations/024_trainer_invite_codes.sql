-- 024_trainer_invite_codes.sql
-- 트레이너 가입 코드 시스템 — 사용자 결정 2026-04-29
-- 3 종류 코드: founder (직접 영업), ad (광고), referral (트레이너 추천)
-- 코드로 가입 시 즉시 approved (자격증 심사 폐지 → 신원 확인만)

-- ─────────────────────────────────────────────────────
-- 1. trainer_invite_codes — 코드 발급 정보
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trainer_invite_codes (
  code text PRIMARY KEY,
  code_type text NOT NULL CHECK (code_type IN ('founder','ad','referral')),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  max_uses int,                        -- null = unlimited
  used_count int NOT NULL DEFAULT 0,
  expires_at timestamptz,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. trainer_invite_uses — 코드 사용 audit
CREATE TABLE IF NOT EXISTS trainer_invite_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL REFERENCES trainer_invite_codes(code) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_uses_user ON trainer_invite_uses(user_id);

-- ─────────────────────────────────────────────────────
-- 3. 코드로 가입 — 즉시 approved
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_signup_with_code(
  p_trainer_name text,
  p_bio text DEFAULT NULL,
  p_invite_code text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code record;
  v_normalized_code text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  v_normalized_code := upper(trim(coalesce(p_invite_code,'')));
  IF v_normalized_code = '' THEN
    RAISE EXCEPTION 'invite code required';
  END IF;

  -- 코드 검증 (lock for update)
  SELECT * INTO v_code FROM trainer_invite_codes
    WHERE code = v_normalized_code
    FOR UPDATE;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'invalid invite code';
  END IF;
  IF v_code.expires_at IS NOT NULL AND v_code.expires_at < now() THEN
    RAISE EXCEPTION 'invite code expired';
  END IF;
  IF v_code.max_uses IS NOT NULL AND v_code.used_count >= v_code.max_uses THEN
    RAISE EXCEPTION 'invite code exhausted';
  END IF;

  -- trainers row 생성 — 즉시 approved (코드 검증 = 신원 확인 완료)
  INSERT INTO trainers (id, trainer_name, bio, certification_status, certification_reviewed_at, certification_note)
  VALUES (v_uid, p_trainer_name, p_bio, 'approved', now(), 'invite_code:'||v_normalized_code)
  ON CONFLICT (id) DO UPDATE
    SET trainer_name = EXCLUDED.trainer_name,
        bio = COALESCE(EXCLUDED.bio, trainers.bio),
        certification_status = 'approved',
        certification_reviewed_at = now(),
        certification_note = COALESCE(trainers.certification_note,'')||' invite_code:'||v_normalized_code,
        updated_at = now();

  -- profiles.role = trainer
  UPDATE profiles SET role = 'trainer' WHERE id = v_uid;

  -- 코드 사용 카운트 증가 + audit row
  UPDATE trainer_invite_codes
    SET used_count = used_count + 1
    WHERE code = v_normalized_code;
  INSERT INTO trainer_invite_uses (code, user_id) VALUES (v_normalized_code, v_uid);

  RETURN jsonb_build_object(
    'status','approved',
    'code_type', v_code.code_type
  );
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_signup_with_code TO authenticated;

-- ─────────────────────────────────────────────────────
-- 4. 트레이너가 referral 코드 발급
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_create_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 헷갈림 글자 제외 (I,O,0,1)
  v_attempt int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM trainers WHERE id=v_uid AND certification_status='approved') THEN
    RAISE EXCEPTION 'forbidden — only approved trainers can issue referral codes';
  END IF;

  -- 6자리 코드 생성 (충돌 시 재시도)
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'failed to generate unique code';
    END IF;
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1+floor(random()*length(v_alphabet))::int, 1);
    END LOOP;
    -- 충돌 검사
    EXIT WHEN NOT EXISTS (SELECT 1 FROM trainer_invite_codes WHERE code = v_code);
  END LOOP;

  INSERT INTO trainer_invite_codes (code, code_type, created_by, max_uses, description)
  VALUES (v_code, 'referral', v_uid, 5, 'trainer-issued referral');

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_create_referral_code TO authenticated;

-- ─────────────────────────────────────────────────────
-- 5. RLS — 코드 read 는 누구나 (검증용), write 는 admin / 본인
-- ─────────────────────────────────────────────────────
ALTER TABLE trainer_invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_invite_uses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tic_select_all ON trainer_invite_codes;
CREATE POLICY tic_select_all ON trainer_invite_codes FOR SELECT USING (true);

DROP POLICY IF EXISTS tic_admin_insert ON trainer_invite_codes;
CREATE POLICY tic_admin_insert ON trainer_invite_codes FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND is_admin=true));

DROP POLICY IF EXISTS tic_admin_update ON trainer_invite_codes;
CREATE POLICY tic_admin_update ON trainer_invite_codes FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND is_admin=true));

-- 사용 audit — 본인만 본인 row 보임. admin 은 모두.
DROP POLICY IF EXISTS tiu_select_own ON trainer_invite_uses;
CREATE POLICY tiu_select_own ON trainer_invite_uses FOR SELECT
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND is_admin=true));

-- ─────────────────────────────────────────────────────
-- 6. 초기 코드 (founder + ad)
-- ─────────────────────────────────────────────────────
INSERT INTO trainer_invite_codes (code, code_type, description, max_uses)
VALUES
  ('FOUNDER', 'founder', '창업자 직접 영업 — 제한 없음', NULL),
  ('AD2026', 'ad', '광고 캠페인 2026 — 1000회 한도', 1000)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────
-- DONE
-- ─────────────────────────────────────────────────────
