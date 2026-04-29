-- 025_trainer_read_access.sql
-- 트레이너가 활성 관계 클라의 profiles + daily_logs 를 SELECT 가능하도록 RLS 추가.
-- 이전 023 에서 누락된 정책. 사용자 자동 sync 모델 의존 (요청-제출 X).

-- ─────────────────────────────────────────────────────
-- 1. profiles — 트레이너가 활성 클라 profile 조회
-- ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS profiles_trainer_read ON profiles;
CREATE POLICY profiles_trainer_read ON profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trainer_clients tc
      WHERE tc.trainer_id = auth.uid()
        AND tc.client_id = profiles.id
        AND tc.status = 'active'
    )
  );

-- ─────────────────────────────────────────────────────
-- 2. daily_logs — 트레이너가 활성 클라 daily_logs 조회
-- ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS daily_logs_trainer_read ON daily_logs;
CREATE POLICY daily_logs_trainer_read ON daily_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trainer_clients tc
      WHERE tc.trainer_id = auth.uid()
        AND tc.client_id = daily_logs.user_id
        AND tc.status = 'active'
    )
  );

-- ─────────────────────────────────────────────────────
-- DONE
-- 졸업(graduated) / 종료(ended) 시 자동으로 SELECT 권한 회수.
-- ─────────────────────────────────────────────────────
