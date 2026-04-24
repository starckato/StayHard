-- Migration: 020_retention_phase2.sql
-- 큐록 (QROK) retention Phase 2 인프라 — SERVICE_EVALUATION.md 백로그 실행용.
--
-- 비파괴 원칙:
--   - 기존 컬럼 변경 없음
--   - 추가만 (IF NOT EXISTS / DEFAULT 안전)
--   - 롤백 가능
--
-- 추가 항목:
--   profiles.feature_flags       — 신규 기능 FF 점진 롤아웃
--   profiles.return_state        — Returner Grace 72h
--   profiles.exempt_log          — 회식 면제 1-tap (주 2회)
--   profiles.accent_preference   — P2 accent 선택 (Phase 3)
--   profiles.notif_opt_in_history — 온보딩+D3 2차 요청 이력
--   profiles.onboarding_state    — 첫 큐브 체험 추적
--   metric_events                — M1-M10 계측용 이벤트 테이블

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS return_state jsonb,
  ADD COLUMN IF NOT EXISTS exempt_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accent_preference text NOT NULL DEFAULT 'crimson',
  ADD COLUMN IF NOT EXISTS notif_opt_in_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_state jsonb NOT NULL DEFAULT '{}'::jsonb;

-- accent 프리셋 체크 (추후 Phase 3 UI 에서 제한)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_accent_preference_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_accent_preference_check
  CHECK (accent_preference IN ('crimson','charcoal','deep_green'));

-- ── metric_events — append-only 이벤트 테이블 ─────────────────
CREATE TABLE IF NOT EXISTS public.metric_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key  text NOT NULL,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS metric_events_user_key_idx
  ON public.metric_events(user_id, event_key, created_at DESC);

CREATE INDEX IF NOT EXISTS metric_events_key_date_idx
  ON public.metric_events(event_key, created_at DESC);

ALTER TABLE public.metric_events ENABLE ROW LEVEL SECURITY;

-- 본인만 insert/select. 파괴적 작업 없음.
DROP POLICY IF EXISTS metric_events_own_insert ON public.metric_events;
CREATE POLICY metric_events_own_insert ON public.metric_events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS metric_events_own_select ON public.metric_events;
CREATE POLICY metric_events_own_select ON public.metric_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 관리자 계정은 전체 조회 가능 (retention_metrics view 용)
DROP POLICY IF EXISTS metric_events_admin_select ON public.metric_events;
CREATE POLICY metric_events_admin_select ON public.metric_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

COMMENT ON TABLE public.metric_events IS
  'QROK retention metrics — append-only event log. Used by retention_metrics SQL views.';

-- Rollback 스니펫 (주석 · 긴급 시에만):
-- ALTER TABLE public.profiles
--   DROP COLUMN IF EXISTS feature_flags,
--   DROP COLUMN IF EXISTS return_state,
--   DROP COLUMN IF EXISTS exempt_log,
--   DROP COLUMN IF EXISTS accent_preference,
--   DROP COLUMN IF EXISTS notif_opt_in_history,
--   DROP COLUMN IF EXISTS onboarding_state;
-- DROP TABLE IF EXISTS public.metric_events CASCADE;
