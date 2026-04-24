-- Migration: 017_nudges.sql
-- Preset-only messages from friend to friend. Rate-limited (3-tier).
-- No free text. Client renders copy from src/features/friends/presets.js
-- using preset_id as lookup.
--
-- IP NOTE (2026-04-24): Preset ids intentionally avoid brand-sensitive text
-- per AGENT_COORDINATION.md marketing blocker. Replacement id `no_retreat`
-- with body "물러서지 마." takes the slot formerly reserved for a
-- brand-sensitive phrase in an earlier plan draft.

-- ── Preset whitelist (server-authoritative) ────────────────────
CREATE TABLE IF NOT EXISTS public.nudge_presets (
  id       text PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('check','streak','routine','sleep','recovery','callout'))
);

INSERT INTO public.nudge_presets(id,category) VALUES
  ('move_today','check'),
  ('streak_alive','streak'),
  ('routine_check','routine'),
  ('sleep_check','sleep'),
  ('back_up','recovery'),
  ('no_excuse','callout'),
  ('half_done','check'),
  ('one_rep','check'),
  ('cold_shower','routine'),
  ('step_out','check'),
  ('log_it','routine'),
  ('no_retreat','callout')
ON CONFLICT DO NOTHING;

-- ── nudges table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nudges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preset_id     text NOT NULL REFERENCES public.nudge_presets(id),
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nudges_no_self CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS nudges_recipient_unread_idx
  ON public.nudges(recipient_id, read_at);
CREATE INDEX IF NOT EXISTS nudges_pair_created_idx
  ON public.nudges(sender_id, recipient_id, created_at);

ALTER TABLE public.nudges ENABLE ROW LEVEL SECURITY;

-- SELECT: either side.
DROP POLICY IF EXISTS nudges_select_self ON public.nudges;
CREATE POLICY nudges_select_self ON public.nudges
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

-- UPDATE: recipient marks read.
DROP POLICY IF EXISTS nudges_update_read ON public.nudges;
CREATE POLICY nudges_update_read ON public.nudges
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- INSERT: blocked for clients. RPC only.
-- DELETE: either side may clear history.
DROP POLICY IF EXISTS nudges_delete_self ON public.nudges;
CREATE POLICY nudges_delete_self ON public.nudges
  FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

-- nudge_presets is public read-only reference data.
ALTER TABLE public.nudge_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nudge_presets_select_all ON public.nudge_presets;
CREATE POLICY nudge_presets_select_all ON public.nudge_presets
  FOR SELECT TO authenticated USING (true);

-- ── RPC: send_nudge ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_nudge(p_recipient uuid, p_preset_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_is_friend boolean;
  v_today_pair int;
  v_today_total int;
  v_last_ts timestamptz;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;
  IF v_me = p_recipient THEN RETURN jsonb_build_object('ok',false,'error','cannot_nudge_self'); END IF;

  IF NOT EXISTS (SELECT 1 FROM nudge_presets WHERE id = p_preset_id) THEN
    RETURN jsonb_build_object('ok',false,'error','bad_preset');
  END IF;

  -- Friendship check: must be accepted, no block.
  SELECT EXISTS (
    SELECT 1 FROM friendships
    WHERE status='accepted'
      AND ((requester_id=v_me AND addressee_id=p_recipient)
        OR (requester_id=p_recipient AND addressee_id=v_me))
  ) INTO v_is_friend;
  IF NOT v_is_friend THEN
    RETURN jsonb_build_object('ok',false,'error','not_friends');
  END IF;

  -- Guard: if either side blocked the other, treat as not-friend.
  IF EXISTS (
    SELECT 1 FROM friendships
    WHERE status='blocked'
      AND ((requester_id=v_me AND addressee_id=p_recipient)
        OR (requester_id=p_recipient AND addressee_id=v_me))
  ) THEN
    RETURN jsonb_build_object('ok',false,'error','not_friends');
  END IF;

  -- Rate limit 1: per-friend daily.
  SELECT count(*) INTO v_today_pair FROM nudges
    WHERE sender_id=v_me AND recipient_id=p_recipient
      AND created_at::date = CURRENT_DATE;
  IF v_today_pair >= 1 THEN
    RETURN jsonb_build_object('ok',false,'error','pair_daily_limit');
  END IF;

  -- Rate limit 2: total daily.
  SELECT count(*) INTO v_today_total FROM nudges
    WHERE sender_id=v_me AND created_at::date = CURRENT_DATE;
  IF v_today_total >= 5 THEN
    RETURN jsonb_build_object('ok',false,'error','total_daily_limit');
  END IF;

  -- Rate limit 3: 4-hour cooldown per friend (across any day boundary).
  SELECT max(created_at) INTO v_last_ts FROM nudges
    WHERE sender_id=v_me AND recipient_id=p_recipient;
  IF v_last_ts IS NOT NULL AND v_last_ts > now() - interval '4 hours' THEN
    RETURN jsonb_build_object('ok',false,'error','cooldown');
  END IF;

  INSERT INTO nudges(sender_id, recipient_id, preset_id)
    VALUES (v_me, p_recipient, p_preset_id);
  RETURN jsonb_build_object('ok',true);
END;
$$;

REVOKE ALL ON FUNCTION public.send_nudge(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.send_nudge(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_nudge(uuid, text) TO authenticated;

-- ── RPC: list_inbox ───────────────────────────────────────────
-- Returns received nudges with sender display_name + tier.
CREATE OR REPLACE FUNCTION public.list_nudge_inbox(p_unread_only boolean DEFAULT false, p_limit int DEFAULT 50)
RETURNS TABLE(
  id uuid,
  sender_id uuid,
  sender_display_name text,
  sender_username text,
  preset_id text,
  read_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT
    n.id, n.sender_id, p.display_name, p.username,
    n.preset_id, n.read_at, n.created_at
  FROM nudges n
  JOIN profiles p ON p.id = n.sender_id
  WHERE n.recipient_id = auth.uid()
    AND (NOT p_unread_only OR n.read_at IS NULL)
  ORDER BY n.created_at DESC
  LIMIT LEAST(COALESCE(p_limit, 50), 200);
$$;

REVOKE ALL ON FUNCTION public.list_nudge_inbox(boolean, int) FROM public;
REVOKE ALL ON FUNCTION public.list_nudge_inbox(boolean, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_nudge_inbox(boolean, int) TO authenticated;

-- ── RPC: mark_nudges_read ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_nudges_read(p_ids uuid[])
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE nudges SET read_at = now()
   WHERE recipient_id = auth.uid() AND id = ANY(p_ids) AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_nudges_read(uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.mark_nudges_read(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_nudges_read(uuid[]) TO authenticated;

-- ── RPC: unread_nudge_count ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.unread_nudge_count()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT count(*)::int FROM nudges
   WHERE recipient_id = auth.uid() AND read_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.unread_nudge_count() FROM public;
REVOKE ALL ON FUNCTION public.unread_nudge_count() FROM anon;
GRANT EXECUTE ON FUNCTION public.unread_nudge_count() TO authenticated;
