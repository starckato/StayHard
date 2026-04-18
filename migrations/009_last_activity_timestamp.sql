-- Migration: 009_last_activity_timestamp.sql
-- Replace last_login (auth.users.last_sign_in_at) with last_activity
-- (MAX(daily_logs.updated_at)) for true "user did something in the app" metric.
--
-- Why: Supabase keeps sessions alive for 7+ days. last_sign_in_at only refreshes
-- on explicit re-login, so users who stay signed in can show 3 weeks ago even
-- though they were active yesterday. daily_logs.updated_at bumps on every save
-- (weight, meals, routines, workouts, targets, points_log) — honest proxy for
-- actual app engagement.
--
-- Run AFTER 008_show_last_login_not_last_log.sql.

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

    -- Signups
    'signups_total', (SELECT count(*) FROM auth.users u WHERE NOT is_user_excluded(u.id)),
    'signups_7d', (SELECT count(*) FROM auth.users u
      WHERE u.created_at >= current_date - INTERVAL '6 days' AND NOT is_user_excluded(u.id)),
    'signups_prev_7d', (SELECT count(*) FROM auth.users u
      WHERE u.created_at >= current_date - INTERVAL '13 days'
        AND u.created_at < current_date - INTERVAL '6 days'
        AND NOT is_user_excluded(u.id)),
    'signups_30d', (SELECT count(*) FROM auth.users u
      WHERE u.created_at >= current_date - INTERVAL '29 days' AND NOT is_user_excluded(u.id)),

    -- Active users now (log_date <= current_date)
    'dau', (SELECT count(DISTINCT dl.user_id) FROM daily_logs dl
      WHERE dl.log_date = current_date AND NOT is_user_excluded(dl.user_id)),
    'wau', (SELECT count(DISTINCT dl.user_id) FROM daily_logs dl
      WHERE dl.log_date >= current_date - INTERVAL '6 days'
        AND dl.log_date <= current_date
        AND NOT is_user_excluded(dl.user_id)),
    'mau', (SELECT count(DISTINCT dl.user_id) FROM daily_logs dl
      WHERE dl.log_date >= current_date - INTERVAL '29 days'
        AND dl.log_date <= current_date
        AND NOT is_user_excluded(dl.user_id)),

    'dau_7d_ago', (SELECT count(DISTINCT dl.user_id) FROM daily_logs dl
      WHERE dl.log_date = current_date - INTERVAL '7 days' AND NOT is_user_excluded(dl.user_id)),
    'wau_prev', (SELECT count(DISTINCT dl.user_id) FROM daily_logs dl
      WHERE dl.log_date >= current_date - INTERVAL '13 days'
        AND dl.log_date < current_date - INTERVAL '6 days'
        AND NOT is_user_excluded(dl.user_id)),
    'mau_prev', (SELECT count(DISTINCT dl.user_id) FROM daily_logs dl
      WHERE dl.log_date >= current_date - INTERVAL '59 days'
        AND dl.log_date < current_date - INTERVAL '29 days'
        AND NOT is_user_excluded(dl.user_id)),

    'wae', (
      SELECT count(*) FROM (
        SELECT dl.user_id FROM daily_logs dl
        WHERE dl.log_date >= current_date - INTERVAL '6 days'
          AND dl.log_date <= current_date
          AND NOT is_user_excluded(dl.user_id)
        GROUP BY dl.user_id HAVING count(DISTINCT dl.log_date) >= 3
      ) t
    ),
    'wae_prev', (
      SELECT count(*) FROM (
        SELECT dl.user_id FROM daily_logs dl
        WHERE dl.log_date >= current_date - INTERVAL '13 days'
          AND dl.log_date < current_date - INTERVAL '6 days'
          AND NOT is_user_excluded(dl.user_id)
        GROUP BY dl.user_id HAVING count(DISTINCT dl.log_date) >= 3
      ) t
    ),

    'activation', jsonb_build_object(
      'signups', (SELECT count(*) FROM auth.users u WHERE NOT is_user_excluded(u.id)),
      'onboarded', (SELECT count(*) FROM profiles p
        WHERE p.onboarded = true AND p.is_excluded = false),
      'first_logged', (SELECT count(DISTINCT dl.user_id) FROM daily_logs dl
        WHERE dl.log_date <= current_date AND NOT is_user_excluded(dl.user_id)),
      'three_day_week1', (
        SELECT count(*) FROM (
          SELECT dl.user_id FROM daily_logs dl
          JOIN auth.users u ON u.id = dl.user_id
          WHERE dl.log_date >= u.created_at::date
            AND dl.log_date < u.created_at::date + INTERVAL '7 days'
            AND dl.log_date <= current_date
            AND NOT is_user_excluded(dl.user_id)
          GROUP BY dl.user_id
          HAVING count(DISTINCT dl.log_date) >= 3
        ) t
      ),
      'activated', (
        SELECT count(*) FROM (
          SELECT dl.user_id FROM daily_logs dl
          JOIN auth.users u ON u.id = dl.user_id
          JOIN profiles p ON p.id = dl.user_id
          WHERE dl.log_date >= u.created_at::date
            AND dl.log_date < u.created_at::date + INTERVAL '7 days'
            AND dl.log_date <= current_date
            AND p.total_score >= 100
            AND p.onboarded = true
            AND p.is_excluded = false
          GROUP BY dl.user_id
          HAVING count(DISTINCT dl.log_date) >= 3
        ) t
      )
    ),

    'feature_adoption_today', (
      SELECT jsonb_build_object(
        'dau', count(*),
        'meals', count(*) FILTER (WHERE jsonb_array_length(COALESCE(dl.meals,'[]'::jsonb)) > 0),
        'workouts', count(*) FILTER (WHERE jsonb_array_length(COALESCE(dl.workouts,'[]'::jsonb)) > 0),
        'water', count(*) FILTER (WHERE COALESCE(dl.water_cups, 0) > 0),
        'weight', count(*) FILTER (WHERE dl.weight IS NOT NULL),
        'mandatory', count(*) FILTER (WHERE jsonb_array_length(COALESCE(dl.mandatory,'[]'::jsonb)) > 0),
        'targets', count(*) FILTER (WHERE jsonb_array_length(COALESCE(dl.targets,'[]'::jsonb)) > 0)
      )
      FROM daily_logs dl
      WHERE dl.log_date = current_date AND NOT is_user_excluded(dl.user_id)
    ),

    'trend_14d', (
      SELECT jsonb_agg(jsonb_build_object('day', d.day, 'active', COALESCE(a.active, 0)) ORDER BY d.day)
      FROM (SELECT generate_series(current_date - INTERVAL '13 days', current_date, INTERVAL '1 day')::date AS day) d
      LEFT JOIN (
        SELECT dl.log_date, count(DISTINCT dl.user_id) AS active
        FROM daily_logs dl
        WHERE dl.log_date >= current_date - INTERVAL '13 days'
          AND dl.log_date <= current_date
          AND NOT is_user_excluded(dl.user_id)
        GROUP BY dl.log_date
      ) a ON a.log_date = d.day
    ),

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
              AND dl.log_date <= current_date
          )) AS retained_d7
        FROM auth.users u
        WHERE u.created_at >= current_date - INTERVAL '56 days'
          AND NOT is_user_excluded(u.id)
        GROUP BY date_trunc('week', u.created_at)::date
      ) c
    ),

    'event_counts_7d', (
      SELECT jsonb_object_agg(event_name, cnt)
      FROM (
        SELECT e.event_name, count(*) AS cnt FROM events e
        WHERE e.created_at >= current_date - INTERVAL '6 days'
          AND e.created_at <= now()
          AND NOT is_user_excluded(e.user_id)
        GROUP BY e.event_name
      ) t
    ),

    'competitions', jsonb_build_object(
      'active', (SELECT count(*) FROM competitions WHERE status = 'active'),
      'completed', (SELECT count(*) FROM competitions WHERE status = 'completed'),
      'waiting', (SELECT count(*) FROM competitions WHERE status = 'waiting')
    ),

    -- all_users — last_activity = MAX(daily_logs.updated_at) per user.
    -- Supabase auto-bumps updated_at on every row write, so this is the honest
    -- proxy for "last time the user actually did something in the app", unaffected
    -- by long-lived sessions or pre-propagated future log_date rows.
    'all_users', (
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.is_excluded ASC, t.last_activity DESC NULLS LAST)
      FROM (
        SELECT
          p.id, p.display_name,
          COALESCE(p.total_score, 0) AS total_score,
          p.onboarded, p.is_admin,
          COALESCE(p.is_excluded, false) AS is_excluded,
          u.email,
          u.created_at::date AS signed_up,
          (SELECT MAX(dl.updated_at) FROM daily_logs dl WHERE dl.user_id = p.id) AS last_activity,
          (SELECT count(*) FROM daily_logs dl
             WHERE dl.user_id = p.id AND dl.log_date <= current_date) AS log_days,
          u.last_sign_in_at AS last_login
        FROM profiles p
        LEFT JOIN auth.users u ON u.id = p.id
      ) t
    ),

    'recent_events', (
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC)
      FROM (
        SELECT e.id, e.user_id, e.event_name, e.meta, e.created_at, p.display_name AS user_name
        FROM events e
        LEFT JOIN profiles p ON p.id = e.user_id
        WHERE NOT is_user_excluded(e.user_id)
          AND e.created_at <= now()
        ORDER BY e.created_at DESC LIMIT 100
      ) t
    ),

    'recent_logs', (
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.log_date DESC, t.display_name)
      FROM (
        SELECT
          dl.log_date, dl.user_id, p.display_name,
          dl.weight, COALESCE(dl.water_cups, 0) AS water_cups,
          jsonb_array_length(COALESCE(dl.meals,'[]'::jsonb)) AS meals_count,
          jsonb_array_length(COALESCE(dl.workouts,'[]'::jsonb)) AS workouts_count,
          jsonb_array_length(COALESCE(dl.mandatory,'[]'::jsonb)) AS mandatory_count,
          jsonb_array_length(COALESCE(dl.targets,'[]'::jsonb)) AS targets_count
        FROM daily_logs dl
        LEFT JOIN profiles p ON p.id = dl.user_id
        WHERE NOT is_user_excluded(dl.user_id)
          AND dl.log_date <= current_date
        ORDER BY dl.log_date DESC LIMIT 50
      ) t
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_dashboard() TO authenticated;
