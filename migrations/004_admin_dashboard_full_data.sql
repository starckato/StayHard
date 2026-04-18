-- Extends admin_dashboard() to return full row-level data:
--   all_users         — every profile with email & signup date
--   recent_events     — last 100 events
--   recent_logs       — last 50 daily_logs summary rows
--
-- Idempotent (CREATE OR REPLACE). Run once in Supabase SQL Editor.

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

    'signups_total', (SELECT count(*) FROM auth.users),
    'signups_7d', (SELECT count(*) FROM auth.users WHERE created_at >= current_date - INTERVAL '6 days'),
    'signups_30d', (SELECT count(*) FROM auth.users WHERE created_at >= current_date - INTERVAL '29 days'),

    'dau', (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date = current_date),
    'wau', (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date >= current_date - INTERVAL '6 days'),
    'mau', (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date >= current_date - INTERVAL '29 days'),

    'event_counts_7d', (
      SELECT jsonb_object_agg(event_name, cnt)
      FROM (
        SELECT event_name, count(*) AS cnt
        FROM events
        WHERE created_at >= current_date - INTERVAL '6 days'
        GROUP BY event_name
      ) t
    ),

    'competitions', jsonb_build_object(
      'active', (SELECT count(*) FROM competitions WHERE status = 'active'),
      'completed', (SELECT count(*) FROM competitions WHERE status = 'completed'),
      'waiting', (SELECT count(*) FROM competitions WHERE status = 'waiting')
    ),

    -- FULL user list (not limited to top 10)
    'all_users', (
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.total_score DESC NULLS LAST)
      FROM (
        SELECT
          p.id,
          p.display_name,
          COALESCE(p.total_score, 0) AS total_score,
          p.onboarded,
          p.is_admin,
          u.email,
          u.created_at::date AS signed_up,
          (SELECT count(*) FROM daily_logs dl WHERE dl.user_id = p.id) AS log_days,
          (SELECT max(dl.log_date) FROM daily_logs dl WHERE dl.user_id = p.id) AS last_log
        FROM profiles p
        LEFT JOIN auth.users u ON u.id = p.id
      ) t
    ),

    -- Recent 100 events, with user name for convenience
    'recent_events', (
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC)
      FROM (
        SELECT
          e.id, e.user_id, e.event_name, e.meta, e.created_at,
          p.display_name AS user_name
        FROM events e
        LEFT JOIN profiles p ON p.id = e.user_id
        ORDER BY e.created_at DESC
        LIMIT 100
      ) t
    ),

    -- Recent 50 daily_logs (lightweight summary)
    'recent_logs', (
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.log_date DESC, t.display_name)
      FROM (
        SELECT
          dl.log_date,
          dl.user_id,
          p.display_name,
          dl.weight,
          COALESCE(dl.water_cups, 0) AS water_cups,
          jsonb_array_length(COALESCE(dl.meals, '[]'::jsonb)) AS meals_count,
          jsonb_array_length(COALESCE(dl.workouts, '[]'::jsonb)) AS workouts_count,
          jsonb_array_length(COALESCE(dl.mandatory, '[]'::jsonb)) AS mandatory_count,
          jsonb_array_length(COALESCE(dl.targets, '[]'::jsonb)) AS targets_count
        FROM daily_logs dl
        LEFT JOIN profiles p ON p.id = dl.user_id
        ORDER BY dl.log_date DESC
        LIMIT 50
      ) t
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_dashboard() TO authenticated;
