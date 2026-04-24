-- Migration: 019_nudges_webhook.sql
--
-- Trigger nudges INSERT → HTTP POST to dispatch-nudge Edge Function.
-- Alternative path: Supabase Dashboard → Database Webhooks (zero-SQL).
-- Both work; this SQL route keeps the wiring in version control.
--
-- Requires:
--   1. pg_net extension enabled (Supabase: Database → Extensions → pg_net)
--   2. GUC variables set at the database level:
--        ALTER DATABASE postgres SET app.edge_function_url = 'https://<PROJECT>.supabase.co';
--        ALTER DATABASE postgres SET app.service_role_key = '<SERVICE_ROLE_KEY>';
--      Service role key is a SECRET — never commit.
--   3. Edge function deployed:
--        npx supabase functions deploy dispatch-nudge --project-ref <PROJECT_REF>
--
-- To disable the webhook without dropping function: DROP TRIGGER nudges_after_insert_dispatch ON public.nudges;

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.dispatch_nudge_webhook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- Read GUCs; if unset, skip silently (non-destructive).
  v_url := current_setting('app.edge_function_url', true);
  v_key := current_setting('app.service_role_key', true);
  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/dispatch-nudge',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'nudge_id',     NEW.id,
      'sender_id',    NEW.sender_id,
      'recipient_id', NEW.recipient_id,
      'preset_id',    NEW.preset_id
    )::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nudges_after_insert_dispatch ON public.nudges;
CREATE TRIGGER nudges_after_insert_dispatch
  AFTER INSERT ON public.nudges
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_nudge_webhook();

-- Verify:
-- SELECT current_setting('app.edge_function_url', true);
-- SELECT current_setting('app.service_role_key', true);
