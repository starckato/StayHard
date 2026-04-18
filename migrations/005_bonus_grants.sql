-- Migration: 005_bonus_grants.sql
-- Admin-triggered bonus score + celebration events
-- Use cases: event completion (메디오폰도, marathon, 4x4x48), season rewards,
-- referral milestones, admin-issued morale bonuses.
--
-- Run AFTER 003_analytics_events.sql (depends on public.is_admin()).

-- ── TABLE ──
CREATE TABLE IF NOT EXISTS public.bonus_grants (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key text NOT NULL,              -- stable identifier, e.g. 'buan_mediofondo_2026'
  title text NOT NULL,                  -- headline shown to user
  message text NOT NULL,                -- celebration body copy
  points int NOT NULL DEFAULT 0,        -- added to profiles.total_score on claim
  icon text NOT NULL DEFAULT '🏆',
  shown boolean NOT NULL DEFAULT false, -- set true after user claims
  shown_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_key)
);

CREATE INDEX IF NOT EXISTS bonus_grants_user_unshown_idx
  ON public.bonus_grants (user_id) WHERE shown = false;

-- ── RLS ──
ALTER TABLE public.bonus_grants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS bg_select_self ON public.bonus_grants;
  DROP POLICY IF EXISTS bg_insert_admin ON public.bonus_grants;
  DROP POLICY IF EXISTS bg_update_admin ON public.bonus_grants;
  DROP POLICY IF EXISTS bg_delete_admin ON public.bonus_grants;
END $$;

-- User can read own grants; admin can read all
CREATE POLICY bg_select_self
  ON public.bonus_grants FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- Insert only by admin (user claims via RPC, not direct write)
CREATE POLICY bg_insert_admin
  ON public.bonus_grants FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Update only by admin (claim RPC runs SECURITY DEFINER)
CREATE POLICY bg_update_admin
  ON public.bonus_grants FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY bg_delete_admin
  ON public.bonus_grants FOR DELETE TO authenticated
  USING (public.is_admin());

-- ── RPC: claim_bonus_grant ──
-- Atomically marks grant as shown + adds points to profiles.total_score.
-- Idempotent: second call returns already_claimed without double-adding.
CREATE OR REPLACE FUNCTION public.claim_bonus_grant(p_grant_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_grant public.bonus_grants%ROWTYPE;
  v_new_total int;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_grant
  FROM public.bonus_grants
  WHERE id = p_grant_id AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_grant.shown THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_claimed',
      'grant_id', p_grant_id, 'points', v_grant.points);
  END IF;

  UPDATE public.bonus_grants
    SET shown = true, shown_at = now()
    WHERE id = p_grant_id;

  UPDATE public.profiles
    SET total_score = GREATEST(0, COALESCE(total_score, 0) + v_grant.points)
    WHERE id = v_user
    RETURNING total_score INTO v_new_total;

  RETURN jsonb_build_object(
    'ok', true,
    'grant_id', p_grant_id,
    'event_key', v_grant.event_key,
    'points', v_grant.points,
    'total_score', v_new_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_bonus_grant(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_bonus_grant(bigint) TO authenticated;

-- ── RPC: grant_bonus_by_email (admin helper) ──
-- Upsert a grant by user email without looking up UUID. Resets shown=false on re-grant.
CREATE OR REPLACE FUNCTION public.grant_bonus_by_email(
  p_email text,
  p_event_key text,
  p_title text,
  p_message text,
  p_points int DEFAULT 100,
  p_icon text DEFAULT '🏆'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_id bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_admin');
  END IF;

  SELECT id INTO v_user FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found', 'email', p_email);
  END IF;

  INSERT INTO public.bonus_grants (user_id, event_key, title, message, points, icon)
    VALUES (v_user, p_event_key, p_title, p_message, p_points, p_icon)
    ON CONFLICT (user_id, event_key) DO UPDATE
      SET title   = EXCLUDED.title,
          message = EXCLUDED.message,
          points  = EXCLUDED.points,
          icon    = EXCLUDED.icon,
          shown   = false,
          shown_at = null
    RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'grant_id', v_id, 'user_id', v_user, 'event_key', p_event_key);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_bonus_by_email(text,text,text,text,int,text) FROM public;
GRANT EXECUTE ON FUNCTION public.grant_bonus_by_email(text,text,text,text,int,text) TO authenticated;

-- ── Usage examples (run as starckato@gmail.com in SQL Editor) ──
-- Test grant:
--   SELECT public.grant_bonus_by_email(
--     'test2@test.com',
--     'buan_mediofondo_2026',
--     '부안 메디오폰도 완주',
--     E'부안 메디오폰도 완주를 축하드립니다.\n앞으로도 쭉 Stay Hard!',
--     100,
--     '🚴'
--   );
--
-- Real grant (after test verified):
--   SELECT public.grant_bonus_by_email(
--     'dudgnsdla123@naver.com',
--     'buan_mediofondo_2026',
--     '부안 메디오폰도 완주',
--     E'부안 메디오폰도 완주를 축하드립니다.\n앞으로도 쭉 Stay Hard!',
--     100,
--     '🚴'
--   );
--
-- Revoke / cleanup:
--   DELETE FROM public.bonus_grants WHERE event_key = 'buan_mediofondo_2026' AND user_id = (SELECT id FROM auth.users WHERE email = 'test2@test.com');
