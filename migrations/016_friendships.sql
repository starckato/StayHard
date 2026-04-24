-- Migration: 016_friendships.sql
-- 1:1 permanent friend relationships. Discovery via friend_code (018).
--
-- Design:
-- - INSERT is blocked at RLS level; use send_friend_request_by_code RPC only.
--   This ensures rate limit + code validation + duplicate check are atomic.
-- - UPDATE only by addressee (accept/reject pending).
-- - DELETE by either party (unfriend).
-- - Helper tier_from_score / user_streak_days for friend-status summary.

-- ── Helper: tier label from total_score (mirrors src/lib/tier.js TIERS) ──
-- Tier 6 name is a placeholder (`"_tier6"`) pending rebrand decision —
-- see AGENT_COORDINATION.md 2026-04-24 BLOCKER. Client maps this to user-facing
-- label. Keeping DB-side as opaque placeholder decouples rename from migration.
CREATE OR REPLACE FUNCTION public.tier_from_score(p_score int)
  RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_score IS NULL OR p_score < 200 THEN '방관자'
    WHEN p_score < 600 THEN '각성자'
    WHEN p_score < 1500 THEN '저항자'
    WHEN p_score < 3500 THEN '수련자'
    WHEN p_score < 7000 THEN '지배자'
    ELSE '_tier6'
  END;
$$;

-- ── Helper: count consecutive days with a daily_logs row, ending today ─
-- Starts at today if logged, else yesterday. Caps at 365 for safety.
CREATE OR REPLACE FUNCTION public.user_streak_days(p_user_id uuid)
  RETURNS int LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path=public AS $$
DECLARE
  v_streak int := 0;
  v_date date := CURRENT_DATE;
  v_exists boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM daily_logs WHERE user_id=p_user_id AND log_date=v_date) INTO v_exists;
  IF NOT v_exists THEN v_date := v_date - 1; END IF;
  LOOP
    SELECT EXISTS(SELECT 1 FROM daily_logs WHERE user_id=p_user_id AND log_date=v_date) INTO v_exists;
    EXIT WHEN NOT v_exists;
    v_streak := v_streak + 1;
    v_date := v_date - 1;
    EXIT WHEN v_streak > 365;
  END LOOP;
  RETURN v_streak;
END;
$$;

-- ── Table: friendships ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.friendships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('pending','accepted','blocked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  CONSTRAINT friendships_unique_pair UNIQUE (requester_id, addressee_id),
  CONSTRAINT friendships_no_self CHECK (requester_id <> addressee_id)
);

CREATE INDEX IF NOT EXISTS friendships_addressee_status_idx
  ON public.friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS friendships_requester_status_idx
  ON public.friendships(requester_id, status);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- SELECT: self-relevant rows only.
DROP POLICY IF EXISTS friendships_select_self ON public.friendships;
CREATE POLICY friendships_select_self ON public.friendships
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- INSERT: blocked for clients. RPC only.
-- (No INSERT policy = no INSERT allowed.)

-- UPDATE: addressee may transition their pending request.
DROP POLICY IF EXISTS friendships_update_addressee ON public.friendships;
CREATE POLICY friendships_update_addressee ON public.friendships
  FOR UPDATE TO authenticated
  USING (addressee_id = auth.uid() AND status = 'pending')
  WITH CHECK (addressee_id = auth.uid() AND status IN ('accepted','blocked'));

-- DELETE: either side may unfriend.
DROP POLICY IF EXISTS friendships_delete_either ON public.friendships;
CREATE POLICY friendships_delete_either ON public.friendships
  FOR DELETE TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- ── RPC: send_friend_request_by_code ───────────────────────────
CREATE OR REPLACE FUNCTION public.send_friend_request_by_code(p_code text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_target uuid;
  v_existing friendships%ROWTYPE;
  v_daily_count int;
  v_clean_code text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;

  -- Normalize: strip whitespace, hyphens, uppercase.
  v_clean_code := upper(regexp_replace(coalesce(p_code,''), '[\s-]', '', 'g'));
  IF length(v_clean_code) <> 8 THEN
    RETURN jsonb_build_object('ok',false,'error','bad_code');
  END IF;

  SELECT id INTO v_target FROM profiles WHERE friend_code = v_clean_code;
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','code_not_found');
  END IF;
  IF v_target = v_me THEN
    RETURN jsonb_build_object('ok',false,'error','cannot_friend_self');
  END IF;

  SELECT * INTO v_existing FROM friendships
    WHERE (requester_id=v_me AND addressee_id=v_target)
       OR (requester_id=v_target AND addressee_id=v_me)
    LIMIT 1;

  IF FOUND THEN
    IF v_existing.status='accepted' THEN
      RETURN jsonb_build_object('ok',false,'error','already_friends');
    ELSIF v_existing.status='blocked' THEN
      -- Generic error — don't reveal who blocked whom.
      RETURN jsonb_build_object('ok',false,'error','code_not_found');
    ELSIF v_existing.status='pending' AND v_existing.addressee_id=v_me THEN
      UPDATE friendships SET status='accepted', responded_at=now() WHERE id=v_existing.id;
      RETURN jsonb_build_object('ok',true,'auto_accepted',true);
    ELSE
      RETURN jsonb_build_object('ok',false,'error','already_pending');
    END IF;
  END IF;

  -- Rate limit: 20 outgoing requests per 24h.
  SELECT count(*) INTO v_daily_count FROM friendships
    WHERE requester_id=v_me AND created_at > now() - interval '24 hours';
  IF v_daily_count >= 20 THEN
    RETURN jsonb_build_object('ok',false,'error','rate_limit_daily');
  END IF;

  INSERT INTO friendships(requester_id, addressee_id, status)
    VALUES (v_me, v_target, 'pending');

  RETURN jsonb_build_object('ok',true,'pending',true);
END;
$$;

REVOKE ALL ON FUNCTION public.send_friend_request_by_code(text) FROM public;
REVOKE ALL ON FUNCTION public.send_friend_request_by_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.send_friend_request_by_code(text) TO authenticated;

-- ── RPC: list_friends_with_status ──────────────────────────────
-- Returns accepted friends with public tier + streak + "moved today".
-- Does NOT expose total_score, cubes, meals, workouts, weight, email.
CREATE OR REPLACE FUNCTION public.list_friends_with_status()
RETURNS TABLE(
  friend_id uuid,
  display_name text,
  username text,
  friend_code text,
  tier text,
  streak int,
  moved_today boolean,
  friends_since timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH my_friends AS (
    SELECT
      CASE WHEN requester_id = auth.uid() THEN addressee_id ELSE requester_id END AS fid,
      responded_at
    FROM friendships
    WHERE status='accepted'
      AND (requester_id = auth.uid() OR addressee_id = auth.uid())
  )
  SELECT
    mf.fid,
    p.display_name,
    p.username,
    p.friend_code,
    tier_from_score(COALESCE(p.total_score, 0)),
    user_streak_days(mf.fid),
    EXISTS (SELECT 1 FROM daily_logs dl WHERE dl.user_id = mf.fid AND dl.log_date = CURRENT_DATE),
    mf.responded_at
  FROM my_friends mf
  JOIN profiles p ON p.id = mf.fid
  ORDER BY p.display_name NULLS LAST, p.username;
$$;

REVOKE ALL ON FUNCTION public.list_friends_with_status() FROM public;
REVOKE ALL ON FUNCTION public.list_friends_with_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_friends_with_status() TO authenticated;

-- ── RPC: list_incoming_requests ────────────────────────────────
-- Pending friend requests where I am the addressee.
CREATE OR REPLACE FUNCTION public.list_incoming_friend_requests()
RETURNS TABLE(
  id uuid,
  requester_id uuid,
  requester_display_name text,
  requester_username text,
  requester_tier text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT
    f.id,
    f.requester_id,
    p.display_name,
    p.username,
    tier_from_score(COALESCE(p.total_score, 0)),
    f.created_at
  FROM friendships f
  JOIN profiles p ON p.id = f.requester_id
  WHERE f.addressee_id = auth.uid() AND f.status = 'pending'
  ORDER BY f.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_incoming_friend_requests() FROM public;
REVOKE ALL ON FUNCTION public.list_incoming_friend_requests() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_incoming_friend_requests() TO authenticated;

-- ── RPC: respond_friend_request (accept / reject) ──────────────
CREATE OR REPLACE FUNCTION public.respond_friend_request(p_id uuid, p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row friendships%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;

  SELECT * INTO v_row FROM friendships WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  IF v_row.addressee_id <> auth.uid() THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  IF v_row.status <> 'pending' THEN RETURN jsonb_build_object('ok',false,'error','not_pending'); END IF;

  IF p_accept THEN
    UPDATE friendships SET status='accepted', responded_at=now() WHERE id=p_id;
  ELSE
    -- Reject = hard delete (no passive-aggressive "rejected" state).
    DELETE FROM friendships WHERE id=p_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'accepted',p_accept);
END;
$$;

REVOKE ALL ON FUNCTION public.respond_friend_request(uuid, boolean) FROM public;
REVOKE ALL ON FUNCTION public.respond_friend_request(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, boolean) TO authenticated;

-- ── RPC: unfriend ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unfriend(p_friend_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_deleted int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;

  DELETE FROM friendships
  WHERE status='accepted'
    AND ((requester_id=auth.uid() AND addressee_id=p_friend_id)
      OR (requester_id=p_friend_id AND addressee_id=auth.uid()));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN RETURN jsonb_build_object('ok',false,'error','not_friends'); END IF;
  RETURN jsonb_build_object('ok',true);
END;
$$;

REVOKE ALL ON FUNCTION public.unfriend(uuid) FROM public;
REVOKE ALL ON FUNCTION public.unfriend(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unfriend(uuid) TO authenticated;

-- ── RPC: block_user ────────────────────────────────────────────
-- Upsert a blocked row (from me to target). If any existing friendship row
-- exists between us, replace it with blocked (me as requester).
CREATE OR REPLACE FUNCTION public.block_user(p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;
  IF v_me = p_target_id THEN RETURN jsonb_build_object('ok',false,'error','cannot_block_self'); END IF;

  -- Delete any existing relationship either direction.
  DELETE FROM friendships
  WHERE (requester_id=v_me AND addressee_id=p_target_id)
     OR (requester_id=p_target_id AND addressee_id=v_me);

  -- Insert fresh blocked row (me = requester).
  INSERT INTO friendships(requester_id, addressee_id, status, responded_at)
    VALUES (v_me, p_target_id, 'blocked', now());

  RETURN jsonb_build_object('ok',true);
END;
$$;

REVOKE ALL ON FUNCTION public.block_user(uuid) FROM public;
REVOKE ALL ON FUNCTION public.block_user(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated;

-- ── RPC: unblock_user ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unblock_user(p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_deleted int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;
  DELETE FROM friendships
  WHERE status='blocked' AND requester_id=auth.uid() AND addressee_id=p_target_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN RETURN jsonb_build_object('ok',false,'error','not_blocked'); END IF;
  RETURN jsonb_build_object('ok',true);
END;
$$;

REVOKE ALL ON FUNCTION public.unblock_user(uuid) FROM public;
REVOKE ALL ON FUNCTION public.unblock_user(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated;
