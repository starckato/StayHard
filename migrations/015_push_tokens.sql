-- Stay Hard · push_tokens table
--
-- Stores native device push tokens (APNs for iOS, FCM for Android).
-- Written by src/platform/notifications.js on registerForPush() success.
-- Consumed by a Supabase Edge Function (or pg_cron + HTTP) that dispatches
-- reminder notifications (e.g. "오늘 기록 안 했어요").
--
-- One user can have multiple tokens (phone + tablet, or reinstall).
-- `upsert on (user_id, token)` so same device on re-register doesn't duplicate.

CREATE TABLE IF NOT EXISTS push_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       text NOT NULL,
  platform    text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON push_tokens (user_id);

-- Keep updated_at fresh on upsert re-hits
CREATE OR REPLACE FUNCTION push_tokens_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_tokens_touch_updated_at ON push_tokens;
CREATE TRIGGER push_tokens_touch_updated_at
  BEFORE UPDATE ON push_tokens
  FOR EACH ROW EXECUTE FUNCTION push_tokens_touch_updated_at();

-- RLS: a user can read / insert / update / delete only their own rows.
-- Edge Functions that send notifications should use the service role key.
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_tokens own rows" ON push_tokens;
CREATE POLICY "push_tokens own rows"
  ON push_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE push_tokens IS
  'Device push tokens (APNs/FCM). Populated by src/platform/notifications.js after registerForPush().';
