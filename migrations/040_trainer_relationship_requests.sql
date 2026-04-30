-- 040_trainer_relationship_requests.sql
-- 트레이너가 회원 nickname/friend_code 검색 → 등록 요청 → 회원 승낙 플로우.
-- friend_code 직접 입력은 기존 trainer_register_client RPC 로 fallback 유지.

CREATE TABLE IF NOT EXISTS trainer_relationship_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','expired','cancelled')),
  trainer_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

-- 동일 트레이너↔회원 pending 요청은 1개만
CREATE UNIQUE INDEX IF NOT EXISTS idx_trr_unique_pending
  ON trainer_relationship_requests(trainer_id, client_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_trr_client_pending
  ON trainer_relationship_requests(client_id, status);
CREATE INDEX IF NOT EXISTS idx_trr_trainer
  ON trainer_relationship_requests(trainer_id);

ALTER TABLE trainer_relationship_requests ENABLE ROW LEVEL SECURITY;

-- 양쪽 당사자 select
DROP POLICY IF EXISTS "request parties select" ON trainer_relationship_requests;
CREATE POLICY "request parties select"
  ON trainer_relationship_requests FOR SELECT TO authenticated
  USING (trainer_id = auth.uid() OR client_id = auth.uid());

-- 트레이너 insert (자기 trainer_id 만)
DROP POLICY IF EXISTS "trainer insert request" ON trainer_relationship_requests;
CREATE POLICY "trainer insert request"
  ON trainer_relationship_requests FOR INSERT TO authenticated
  WITH CHECK (trainer_id = auth.uid());

-- 회원 update (status 변경 — 본인 요청만)
DROP POLICY IF EXISTS "client update own request" ON trainer_relationship_requests;
CREATE POLICY "client update own request"
  ON trainer_relationship_requests FOR UPDATE TO authenticated
  USING (client_id = auth.uid())
  WITH CHECK (client_id = auth.uid());

-- 트레이너 update (cancel 본인 요청만)
DROP POLICY IF EXISTS "trainer update own request" ON trainer_relationship_requests;
CREATE POLICY "trainer update own request"
  ON trainer_relationship_requests FOR UPDATE TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

-- ─────────────────────────────────────────────────────
-- RPC: 유저 검색 (트레이너만 호출 가능)
-- 검색 키: friend_code 정확 매칭, display_name/username partial.
-- 이미 다른 트레이너 active 관계인 사용자는 result 에 빠짐 (privacy).
-- 단, 본인 (트레이너) 자신 제외.
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_users_for_trainer(p_query text)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  username text,
  friend_code text,
  joined_at timestamptz,
  -- 관계 상태 — 'none' / 'active_with_me' / 'pending_with_me' / 'has_other_trainer'
  relation_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer uuid := auth.uid();
  v_q text := lower(trim(coalesce(p_query, '')));
  v_q_upper text := upper(trim(coalesce(p_query, '')));
BEGIN
  IF v_trainer IS NULL THEN RETURN; END IF;
  IF v_q = '' OR length(v_q) < 2 THEN RETURN; END IF;
  -- 트레이너 자격 확인
  IF NOT EXISTS (SELECT 1 FROM trainers t WHERE t.id = v_trainer AND t.certification_status = 'approved') THEN
    RAISE EXCEPTION 'not an approved trainer';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.display_name,
    p.username,
    p.friend_code,
    p.created_at,
    CASE
      WHEN EXISTS (SELECT 1 FROM trainer_clients tc WHERE tc.trainer_id = v_trainer AND tc.client_id = p.id AND tc.status = 'active') THEN 'active_with_me'
      WHEN EXISTS (SELECT 1 FROM trainer_relationship_requests rr WHERE rr.trainer_id = v_trainer AND rr.client_id = p.id AND rr.status = 'pending') THEN 'pending_with_me'
      WHEN EXISTS (SELECT 1 FROM trainer_clients tc WHERE tc.client_id = p.id AND tc.status = 'active') THEN 'has_other_trainer'
      ELSE 'none'
    END
  FROM profiles p
  WHERE p.id <> v_trainer
    AND (
      p.friend_code = v_q_upper
      OR lower(coalesce(p.display_name, '')) LIKE '%' || v_q || '%'
      OR lower(coalesce(p.username, '')) LIKE '%' || v_q || '%'
    )
  ORDER BY
    CASE WHEN p.friend_code = v_q_upper THEN 0 ELSE 1 END,
    p.display_name NULLS LAST,
    p.username NULLS LAST
  LIMIT 20;
END;
$$;

GRANT EXECUTE ON FUNCTION search_users_for_trainer TO authenticated;

-- ─────────────────────────────────────────────────────
-- RPC: 트레이너가 등록 요청 보냄
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_request_relationship(
  p_client_id uuid,
  p_message text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer uuid := auth.uid();
  v_id uuid;
  v_msg text := NULLIF(trim(coalesce(p_message,'')),'');
BEGIN
  IF v_trainer IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF v_trainer = p_client_id THEN RAISE EXCEPTION 'cannot request self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM trainers t WHERE t.id = v_trainer AND t.certification_status = 'approved') THEN
    RAISE EXCEPTION 'not an approved trainer';
  END IF;
  -- 이미 active 관계
  IF EXISTS (SELECT 1 FROM trainer_clients WHERE trainer_id = v_trainer AND client_id = p_client_id AND status = 'active') THEN
    RAISE EXCEPTION 'already active relationship';
  END IF;
  -- 다른 트레이너의 active client
  IF EXISTS (SELECT 1 FROM trainer_clients WHERE client_id = p_client_id AND status = 'active') THEN
    RAISE EXCEPTION 'client has another active trainer';
  END IF;
  -- 이미 pending 요청
  IF EXISTS (SELECT 1 FROM trainer_relationship_requests WHERE trainer_id = v_trainer AND client_id = p_client_id AND status = 'pending') THEN
    RAISE EXCEPTION 'request already pending';
  END IF;
  -- 메시지 길이 제한
  IF v_msg IS NOT NULL AND length(v_msg) > 200 THEN
    RAISE EXCEPTION 'message too long (max 200)';
  END IF;
  INSERT INTO trainer_relationship_requests (trainer_id, client_id, status, trainer_message)
  VALUES (v_trainer, p_client_id, 'pending', v_msg)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_request_relationship TO authenticated;

-- ─────────────────────────────────────────────────────
-- RPC: 회원이 본인 받은 pending 요청 list
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION client_list_pending_requests()
RETURNS TABLE (
  request_id uuid,
  trainer_id uuid,
  trainer_name text,
  trainer_bio text,
  trainer_message text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    r.id,
    r.trainer_id,
    COALESCE(t.trainer_name, '트레이너'),
    t.bio,
    r.trainer_message,
    r.created_at
  FROM trainer_relationship_requests r
  LEFT JOIN trainers t ON t.id = r.trainer_id
  WHERE r.client_id = v_uid AND r.status = 'pending'
  ORDER BY r.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION client_list_pending_requests TO authenticated;

-- ─────────────────────────────────────────────────────
-- RPC: 회원이 요청에 응답 (accept/decline)
-- accept 시 trainer_clients (status='active') 자동 생성.
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION client_respond_relationship_request(
  p_request_id uuid,
  p_accept boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_trainer uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT trainer_id INTO v_trainer
  FROM trainer_relationship_requests
  WHERE id = p_request_id AND client_id = v_uid AND status = 'pending'
  FOR UPDATE;
  IF v_trainer IS NULL THEN RAISE EXCEPTION 'request not found or not pending'; END IF;

  IF p_accept THEN
    -- 다른 트레이너 active 가 있으면 거부 (1 회원 = 1 트레이너)
    IF EXISTS (SELECT 1 FROM trainer_clients WHERE client_id = v_uid AND status = 'active') THEN
      RAISE EXCEPTION 'already has active trainer';
    END IF;
    INSERT INTO trainer_clients (trainer_id, client_id, status, connected_at)
    VALUES (v_trainer, v_uid, 'active', now())
    ON CONFLICT (trainer_id, client_id) DO UPDATE
      SET status = 'active', connected_at = now(), ended_at = NULL, ended_reason = NULL;
    UPDATE trainer_relationship_requests
    SET status = 'accepted', responded_at = now()
    WHERE id = p_request_id;
  ELSE
    UPDATE trainer_relationship_requests
    SET status = 'declined', responded_at = now()
    WHERE id = p_request_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION client_respond_relationship_request TO authenticated;

-- ─────────────────────────────────────────────────────
-- RPC: 트레이너 본인이 보낸 pending 요청 list (선택, UI 에서 cancel 용)
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_list_sent_requests()
RETURNS TABLE (
  request_id uuid,
  client_id uuid,
  client_name text,
  client_username text,
  trainer_message text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer uuid := auth.uid();
BEGIN
  IF v_trainer IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT r.id, r.client_id, p.display_name, p.username, r.trainer_message, r.created_at
  FROM trainer_relationship_requests r
  JOIN profiles p ON p.id = r.client_id
  WHERE r.trainer_id = v_trainer AND r.status = 'pending'
  ORDER BY r.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_list_sent_requests TO authenticated;

NOTIFY pgrst, 'reload schema';
