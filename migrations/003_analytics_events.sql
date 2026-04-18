-- Phase 1 Analytics: events table + admin dashboard RPC
--
-- Adds:
--   1. profiles.is_admin column (default false)
--   2. is_admin() helper — reads current user's profile
--   3. events append-only table with RLS
--   4. admin_dashboard() RPC — single call returns all metrics as JSON
--
-- Activation model (PM spec):
--   Activated = onboarded AND 3+ log-days in first 7 days AND total_score >= 100
--
-- North star:
--   WAE = distinct users with 3+ log-days in rolling 7-day window
--
-- After running: mark yourself as admin:
--   UPDATE profiles SET is_admin = true WHERE id = '<your-user-id>';


-- ─── 1. Admin flag on profiles ───
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;


-- ─── 2. is_admin() helper ───
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), false);
$$;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;


-- ─── 3. events table ───
CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_user_id_idx ON events(user_id);
CREATE INDEX IF NOT EXISTS events_event_name_idx ON events(event_name);
CREATE INDEX IF NOT EXISTS events_created_at_idx ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS events_name_created_idx ON events(event_name, created_at DESC);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Drop existing policies idempotently
DO $$ DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'events' LOOP
    EXECUTE format('DROP POLICY %I ON events', r.policyname);
  END LOOP;
END $$;

-- Users insert their own events; server can insert via service_role (bypasses RLS)
CREATE POLICY events_insert_self ON events
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users read their own events; admins read all
CREATE POLICY events_select_self_or_admin ON events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());


-- ─── 4. admin_dashboard() — single RPC, returns all metrics ───
CREATE OR REPLACE FUNCTION admin_dashboard() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  RETURN jsonb_build_object(
    'as_of', current_date,
    'generated_at', now(),

    -- Headline KPIs
    'signups_total', (SELECT count(*) FROM auth.users),
    'signups_7d', (SELECT count(*) FROM auth.users WHERE created_at >= current_date - INTERVAL '6 days'),
    'signups_30d', (SELECT count(*) FROM auth.users WHERE created_at >= current_date - INTERVAL '29 days'),

    'dau', (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date = current_date),
    'wau', (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date >= current_date - INTERVAL '6 days'),
    'mau', (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date >= current_date - INTERVAL '29 days'),

    -- North Star: WAE
    'wae', (
      SELECT count(*) FROM (
        SELECT user_id FROM daily_logs
        WHERE log_date >= current_date - INTERVAL '6 days'
        GROUP BY user_id
        HAVING count(DISTINCT log_date) >= 3
      ) t
    ),

    -- Activation funnel
    'activation', jsonb_build_object(
      'signups', (SELECT count(*) FROM auth.users),
      'onboarded', (SELECT count(*) FROM profiles WHERE onboarded = true),
      'first_logged', (SELECT count(DISTINCT user_id) FROM daily_logs),
      'three_day_week1', (
        SELECT count(*) FROM (
          SELECT dl.user_id
          FROM daily_logs dl
          JOIN auth.users u ON u.id = dl.user_id
          WHERE dl.log_date >= u.created_at::date
            AND dl.log_date < u.created_at::date + INTERVAL '7 days'
          GROUP BY dl.user_id
          HAVING count(DISTINCT dl.log_date) >= 3
        ) t
      ),
      'activated', (
        SELECT count(*) FROM (
          SELECT dl.user_id
          FROM daily_logs dl
          JOIN auth.users u ON u.id = dl.user_id
          JOIN profiles p ON p.id = dl.user_id
          WHERE dl.log_date >= u.created_at::date
            AND dl.log_date < u.created_at::date + INTERVAL '7 days'
            AND p.total_score >= 100
            AND p.onboarded = true
          GROUP BY dl.user_id
          HAVING count(DISTINCT dl.log_date) >= 3
        ) t
      )
    ),

    -- Feature adoption for today's DAU
    'feature_adoption_today', (
      SELECT jsonb_build_object(
        'dau', count(*),
        'meals', count(*) FILTER (WHERE jsonb_array_length(COALESCE(meals, '[]'::jsonb)) > 0),
        'workouts', count(*) FILTER (WHERE jsonb_array_length(COALESCE(workouts, '[]'::jsonb)) > 0),
        'water', count(*) FILTER (WHERE COALESCE(water_cups, 0) > 0),
        'weight', count(*) FILTER (WHERE weight IS NOT NULL),
        'mandatory', count(*) FILTER (WHERE jsonb_array_length(COALESCE(mandatory, '[]'::jsonb)) > 0),
        'targets', count(*) FILTER (WHERE jsonb_array_length(COALESCE(targets, '[]'::jsonb)) > 0)
      )
      FROM daily_logs WHERE log_date = current_date
    ),

    -- 14-day active-user trend (for line chart)
    'trend_14d', (
      SELECT jsonb_agg(
        jsonb_build_object('day', d.day, 'active', COALESCE(a.active, 0))
        ORDER BY d.day
      )
      FROM (
        SELECT generate_series(
          current_date - INTERVAL '13 days',
          current_date,
          INTERVAL '1 day'
        )::date AS day
      ) d
      LEFT JOIN (
        SELECT log_date, count(DISTINCT user_id) AS active
        FROM daily_logs
        WHERE log_date >= current_date - INTERVAL '13 days'
        GROUP BY log_date
      ) a ON a.log_date = d.day
    ),

    -- D7 retention cohort (last 8 weeks)
    'cohorts', (
      SELECT jsonb_agg(row_to_json(c) ORDER BY cohort_week DESC)
      FROM (
        SELECT
          date_trunc('week', u.created_at)::date AS cohort_week,
          count(*) AS cohort_size,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM daily_logs dl
            WHERE dl.user_id = u.id
              AND dl.log_date >= u.created_at::date + INTERVAL '7 days'
              AND dl.log_date < u.created_at::date + INTERVAL '14 days'
          )) AS retained_d7
        FROM auth.users u
        WHERE u.created_at >= current_date - INTERVAL '56 days'
        GROUP BY date_trunc('week', u.created_at)::date
      ) c
    ),

    -- Top 10 users by score
    'top_users', (
      SELECT jsonb_agg(
        jsonb_build_object('name', display_name, 'score', total_score)
        ORDER BY total_score DESC NULLS LAST
      )
      FROM (
        SELECT display_name, total_score
        FROM profiles
        ORDER BY total_score DESC NULLS LAST
        LIMIT 10
      ) t
    ),

    -- Recent share events
    'recent_shares', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'user_id', e.user_id,
          'name', p.display_name,
          'created_at', e.created_at,
          'meta', e.meta
        )
        ORDER BY e.created_at DESC
      )
      FROM (
        SELECT * FROM events WHERE event_name = 'share_muscle_map'
        ORDER BY created_at DESC LIMIT 20
      ) e
      LEFT JOIN profiles p ON p.id = e.user_id
    ),

    -- Event counts for the last 7 days
    'event_counts_7d', (
      SELECT jsonb_object_agg(event_name, cnt)
      FROM (
        SELECT event_name, count(*) AS cnt
        FROM events
        WHERE created_at >= current_date - INTERVAL '6 days'
        GROUP BY event_name
      ) t
    ),

    -- Competitions summary
    'competitions', jsonb_build_object(
      'active', (SELECT count(*) FROM competitions WHERE status = 'active'),
      'completed', (SELECT count(*) FROM competitions WHERE status = 'completed'),
      'waiting', (SELECT count(*) FROM competitions WHERE status = 'waiting')
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_dashboard() TO authenticated;


-- ─── Verification queries ───
-- SELECT admin_dashboard();
-- SELECT count(*) FROM events;
-- SELECT event_name, count(*) FROM events GROUP BY event_name;


-- ─── ROLLBACK SNIPPET ───
-- DROP FUNCTION IF EXISTS admin_dashboard();
-- DROP FUNCTION IF EXISTS is_admin();
-- DROP TABLE IF EXISTS events;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS is_admin;
