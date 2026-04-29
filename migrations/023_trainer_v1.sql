-- 023_trainer_v1.sql
-- 트레이너 (PT 샘) 기능 v1 — 사용자 결정 2026-04-26 인터뷰
-- spec: ~/.claude/projects/-Users-KWAN-StayHard/memory/project_trainer_feature_spec.md
--
-- 변경:
-- 1. profiles 에 role 컬럼 (user / trainer / admin)
-- 2. trainers 테이블 — 자격증 + 검증 상태
-- 3. trainer_clients 테이블 — 트레이너↔클라 활성 관계
-- 4. workout_assignments — 트레이너가 클라에게 배정한 운동 (참조 row)
-- 5. trainer_messages — 메시지 (커스텀 + 프리셋)
-- 6. RPC: assign_workout (트레이너 → 클라 daily_logs.workouts insert + assignment insert)
-- 7. RLS 정책

-- ─────────────────────────────────────────────────────
-- 1. profiles.role
-- ─────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
    CHECK (role IN ('user','trainer','admin'));

-- ─────────────────────────────────────────────────────
-- 2. trainers (자격증 + 검증)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trainers (
  id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  trainer_name text NOT NULL,
  bio text,
  certification_url text,
  certification_status text NOT NULL DEFAULT 'pending'
    CHECK (certification_status IN ('pending','approved','rejected')),
  certification_reviewed_at timestamptz,
  certification_reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  certification_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trainers_status ON trainers(certification_status);

-- ─────────────────────────────────────────────────────
-- 3. trainer_clients (관계)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trainer_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','graduated','ended')),
  connected_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ended_reason text,
  UNIQUE (trainer_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_tc_trainer_active
  ON trainer_clients(trainer_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_tc_client_active
  ON trainer_clients(client_id) WHERE status='active';

-- ─────────────────────────────────────────────────────
-- 4. workout_assignments (트레이너 운동 배정 참조 row)
--    실제 운동 데이터는 daily_logs.workouts 에 함께 insert.
--    이 테이블은 추적·UI 표시용 — "트레이너 배정" 식별자.
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workout_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_for_date date NOT NULL,
  payload jsonb NOT NULL,           -- {workouts:[{name,sets,reps,weight,type,...}], notes}
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_assignments_client_date
  ON workout_assignments(client_id, assigned_for_date DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_trainer
  ON workout_assignments(trainer_id, created_at DESC);

-- ─────────────────────────────────────────────────────
-- 5. trainer_messages (커스텀 + 프리셋)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trainer_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  msg_type text NOT NULL CHECK (msg_type IN ('custom','preset')),
  preset_id text CHECK (preset_id IN
    ('workout_assigned','workout_missed','diet_coaching','weight_reminder','cheer','routine_recommend')
    OR preset_id IS NULL),
  body text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_msg_client_recent
  ON trainer_messages(client_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_trainer_recent
  ON trainer_messages(trainer_id, sent_at DESC);

-- ─────────────────────────────────────────────────────
-- 6. RLS 정책
-- ─────────────────────────────────────────────────────
ALTER TABLE trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_messages ENABLE ROW LEVEL SECURITY;

-- trainers: 본인만 R/W. admin 은 모두.
DROP POLICY IF EXISTS trainers_self_select ON trainers;
CREATE POLICY trainers_self_select ON trainers FOR SELECT
  USING (id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND is_admin=true));
DROP POLICY IF EXISTS trainers_self_insert ON trainers;
CREATE POLICY trainers_self_insert ON trainers FOR INSERT
  WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS trainers_self_update ON trainers;
CREATE POLICY trainers_self_update ON trainers FOR UPDATE
  USING (id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND is_admin=true));

-- trainer_clients: 양쪽 다 자기 관련 row 읽기 가능. INSERT 는 트레이너만 (회원 등록).
-- UPDATE (status 변경 = 졸업) 는 양쪽 다 가능.
DROP POLICY IF EXISTS tc_select_related ON trainer_clients;
CREATE POLICY tc_select_related ON trainer_clients FOR SELECT
  USING (trainer_id = auth.uid() OR client_id = auth.uid());
DROP POLICY IF EXISTS tc_trainer_insert ON trainer_clients;
CREATE POLICY tc_trainer_insert ON trainer_clients FOR INSERT
  WITH CHECK (
    trainer_id = auth.uid()
    AND EXISTS (SELECT 1 FROM trainers WHERE id=auth.uid() AND certification_status='approved')
  );
DROP POLICY IF EXISTS tc_either_update ON trainer_clients;
CREATE POLICY tc_either_update ON trainer_clients FOR UPDATE
  USING (trainer_id = auth.uid() OR client_id = auth.uid());

-- workout_assignments: 트레이너 R/W (자기 row), 클라 R + 자기 status 업데이트 가능.
DROP POLICY IF EXISTS wa_select_related ON workout_assignments;
CREATE POLICY wa_select_related ON workout_assignments FOR SELECT
  USING (trainer_id = auth.uid() OR client_id = auth.uid());
DROP POLICY IF EXISTS wa_trainer_insert ON workout_assignments;
CREATE POLICY wa_trainer_insert ON workout_assignments FOR INSERT
  WITH CHECK (
    trainer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM trainer_clients
      WHERE trainer_id = auth.uid() AND client_id = workout_assignments.client_id AND status='active'
    )
  );
DROP POLICY IF EXISTS wa_trainer_update ON workout_assignments;
CREATE POLICY wa_trainer_update ON workout_assignments FOR UPDATE
  USING (trainer_id = auth.uid());
DROP POLICY IF EXISTS wa_client_status_update ON workout_assignments;
CREATE POLICY wa_client_status_update ON workout_assignments FOR UPDATE
  USING (client_id = auth.uid());

-- trainer_messages: 트레이너 INSERT, 둘 다 SELECT, 클라 자기 read_at UPDATE.
DROP POLICY IF EXISTS tm_select_related ON trainer_messages;
CREATE POLICY tm_select_related ON trainer_messages FOR SELECT
  USING (trainer_id = auth.uid() OR client_id = auth.uid());
DROP POLICY IF EXISTS tm_trainer_insert ON trainer_messages;
CREATE POLICY tm_trainer_insert ON trainer_messages FOR INSERT
  WITH CHECK (
    trainer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM trainer_clients
      WHERE trainer_id = auth.uid() AND client_id = trainer_messages.client_id AND status='active'
    )
  );
DROP POLICY IF EXISTS tm_client_read_update ON trainer_messages;
CREATE POLICY tm_client_read_update ON trainer_messages FOR UPDATE
  USING (client_id = auth.uid());

-- ─────────────────────────────────────────────────────
-- 7. 트레이너 → 클라 daily_logs.workouts insert 권한
--    클라 daily_logs 에 직접 RLS update 권한 주는 대신 RPC 사용.
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_assign_workout(
  p_client_id uuid,
  p_assigned_for date,
  p_payload jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer_id uuid := auth.uid();
  v_assignment_id uuid;
  v_existing_log jsonb;
  v_new_workouts jsonb;
  v_log_exists boolean;
BEGIN
  IF v_trainer_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM trainer_clients
    WHERE trainer_id = v_trainer_id AND client_id = p_client_id AND status='active'
  ) THEN
    RAISE EXCEPTION 'no active trainer-client relationship';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM trainers WHERE id = v_trainer_id AND certification_status='approved'
  ) THEN
    RAISE EXCEPTION 'trainer certification not approved';
  END IF;

  -- 1. workout_assignments insert
  INSERT INTO workout_assignments (trainer_id, client_id, assigned_for_date, payload)
  VALUES (v_trainer_id, p_client_id, p_assigned_for, p_payload)
  RETURNING id INTO v_assignment_id;

  -- 2. daily_logs.workouts 에 추가 (existing row + workouts 배열에 append)
  SELECT EXISTS(SELECT 1 FROM daily_logs WHERE user_id=p_client_id AND log_date=p_assigned_for)
    INTO v_log_exists;

  -- payload 의 workouts 배열에 _trainerAssignmentId 마킹 추가
  v_new_workouts := (
    SELECT jsonb_agg(
      jsonb_set(
        jsonb_set(elem, '{_trainerAssignmentId}', to_jsonb(v_assignment_id::text)),
        '{_assignedBy}', to_jsonb(v_trainer_id::text)
      )
    )
    FROM jsonb_array_elements(COALESCE(p_payload->'workouts','[]'::jsonb)) elem
  );

  IF v_log_exists THEN
    UPDATE daily_logs
    SET workouts = COALESCE(workouts,'[]'::jsonb) || COALESCE(v_new_workouts,'[]'::jsonb),
        updated_at = now()
    WHERE user_id = p_client_id AND log_date = p_assigned_for;
  ELSE
    INSERT INTO daily_logs (user_id, log_date, workouts)
    VALUES (p_client_id, p_assigned_for, COALESCE(v_new_workouts,'[]'::jsonb));
  END IF;

  RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION trainer_assign_workout FROM public;
GRANT EXECUTE ON FUNCTION trainer_assign_workout TO authenticated;

-- ─────────────────────────────────────────────────────
-- 8. 트레이너 가입 (자가 RPC) — profiles.role 변경 + trainers row 생성
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_signup(
  p_trainer_name text,
  p_bio text DEFAULT NULL,
  p_certification_url text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  INSERT INTO trainers (id, trainer_name, bio, certification_url, certification_status)
  VALUES (v_uid, p_trainer_name, p_bio, p_certification_url, 'pending')
  ON CONFLICT (id) DO UPDATE
    SET trainer_name = EXCLUDED.trainer_name,
        bio = EXCLUDED.bio,
        certification_url = COALESCE(EXCLUDED.certification_url, trainers.certification_url),
        updated_at = now();

  -- role 은 자격증 승인 후 어드민이 변경 (또는 자동 trigger). 일단 user 그대로.
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_signup TO authenticated;

-- ─────────────────────────────────────────────────────
-- 9. 어드민 자격증 승인 RPC
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_approve_trainer(p_trainer_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=v_admin AND is_admin=true) THEN
    RAISE EXCEPTION 'forbidden — admin only';
  END IF;

  UPDATE trainers
  SET certification_status = 'approved',
      certification_reviewed_at = now(),
      certification_reviewed_by = v_admin,
      certification_note = COALESCE(p_note, certification_note),
      updated_at = now()
  WHERE id = p_trainer_id;

  UPDATE profiles SET role = 'trainer' WHERE id = p_trainer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_approve_trainer TO authenticated;

-- ─────────────────────────────────────────────────────
-- 10. 회원 등록 (트레이너가 클라 friend_code 입력)
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_register_client(p_friend_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trainer_id uuid := auth.uid();
  v_client_id uuid;
  v_existing_id uuid;
BEGIN
  IF v_trainer_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  IF NOT EXISTS (SELECT 1 FROM trainers WHERE id = v_trainer_id AND certification_status='approved') THEN
    RAISE EXCEPTION 'trainer certification not approved';
  END IF;

  SELECT id INTO v_client_id FROM profiles WHERE friend_code = upper(p_friend_code);
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'no profile with that code';
  END IF;
  IF v_client_id = v_trainer_id THEN
    RAISE EXCEPTION 'cannot register self';
  END IF;

  -- 이미 active 관계가 있으면 그대로 반환
  SELECT id INTO v_existing_id FROM trainer_clients
    WHERE trainer_id=v_trainer_id AND client_id=v_client_id AND status='active';
  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- graduated/ended 관계가 있으면 active 로 reactivate, 없으면 new
  INSERT INTO trainer_clients (trainer_id, client_id, status, connected_at)
  VALUES (v_trainer_id, v_client_id, 'active', now())
  ON CONFLICT (trainer_id, client_id) DO UPDATE
    SET status='active', connected_at=now(), ended_at=NULL, ended_by=NULL, ended_reason=NULL
  RETURNING id INTO v_existing_id;

  RETURN v_existing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_register_client TO authenticated;

-- ─────────────────────────────────────────────────────
-- 11. 졸업 RPC (트레이너 또는 클라 양쪽 가능)
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trainer_client_graduate(p_relationship_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  UPDATE trainer_clients
  SET status='graduated',
      ended_at=now(),
      ended_by=v_uid,
      ended_reason=p_reason
  WHERE id = p_relationship_id
    AND (trainer_id = v_uid OR client_id = v_uid)
    AND status='active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'relationship not found or not active';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION trainer_client_graduate TO authenticated;

-- ─────────────────────────────────────────────────────
-- DONE
-- ─────────────────────────────────────────────────────
