-- admin_dashboard() v2 — full row data + previous-period deltas for KPI tracking
--
-- Returns everything the PM dashboard needs:
--   · current-period KPIs (DAU, WAU, MAU, WAE, signups)
--   · previous-period values for delta computation (wae_prev, dau_prev_week, etc.)
--   · activation funnel counts
--   · 14-day active-user trend
--   · D7 retention cohorts
--   · feature adoption for today's DAU
--   · full user list with email/log_days
--   · recent events (100) + recent daily_logs (50)
--   · event_counts_7d + competition status counts
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

    -- Signups
    'signups_total', (SELECT count(*) FROM auth.users),
    'signups_7d', (SELECT count(*) FROM auth.users WHERE created_at >= current_date - INTERVAL '6 days'),
    'signups_prev_7d', (SELECT count(*) FROM auth.users
      WHERE created_at >= current_date - INTERVAL '13 days'
        AND created_at < current_date - INTERVAL '6 days'),
    'signups_30d', (SELECT count(*) FROM auth.users WHERE created_at >= current_date - INTERVAL '29 days'),

    -- Active users now
    'dau', (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date = current_date),
    'wau', (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date >= current_date - INTERVAL '6 days'),
    'mau', (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date >= current_date - INTERVAL '29 days'),

    -- Active users previous period (for delta)
    'dau_7d_ago', (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date = current_date - INTERVAL '7 days'),
    'wau_prev', (SELECT count(DISTINCT user_id) FROM daily_logs
      WHERE log_date >= current_date - INTERVAL '13 days'
        AND log_date < current_date - INTERVAL '6 days'),
    'mau_prev', (SELECT count(DISTINCT user_id) FROM daily_logs
      WHERE log_date >= current_date - INTERVAL '59 days'
        AND log_date < current_date - INTERVAL '29 days'),

    -- North star — WAE (weekly active & engaged = 3+ log days in rolling 7d)
    'wae', (
      SELECT count(*) FROM (
        SELECT user_id FROM daily_logs
        WHERE log_date >= current_date - INTERVAL '6 days'
        GROUP BY user_id HAVING count(DISTINCT log_date) >= 3
      ) t
    ),
    'wae_prev', (
      SELECT count(*) FROM (
        SELECT user_id FROM daily_logs
        WHERE log_date >= current_date - INTERVAL '13 days'
          AND log_date < current_date - INTERVAL '6 days'
        GROUP BY user_id HAVING count(DISTINCT log_date) >= 3
      ) t
    ),

    -- Activation funnel
    'activation', jsonb_build_object(
      'signups', (SELECT count(*) FROM auth.users),
      'onboarded', (SELECT count(*) FROM profiles WHERE onboarded = true),
      'first_logged', (SELECT count(DISTINCT user_id) FROM daily_logs),
      'three_day_week1', (
        SELECT count(*) FROM (
          SELECT dl.user_id FROM daily_logs dl
          JOIN auth.users u ON u.id = dl.user_id
          WHERE dl.log_date >= u.created_at::date
            AND dl.log_date < u.created_at::date + INTERVAL '7 days'
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
            AND p.total_score >= 100
            AND p.onboarded = true
          GROUP BY dl.user_id
          HAVING count(DISTINCT dl.log_date) >= 3
        ) t
      )
    ),

    -- Feature adoption (today's DAU)
    'feature_adoption_today', (
      SELECT jsonb_build_object(
        'dau', count(*),
        'meals', count(*) FILTER (WHERE jsonb_array_length(COALESCE(meals,'[]'::jsonb)) > 0),
        'workouts', count(*) FILTER (WHERE jsonb_array_length(COALESCE(workouts,'[]'::jsonb)) > 0),
        'water', count(*) FILTER (WHERE COALESCE(water_cups, 0) > 0),
        'weight', count(*) FILTER (WHERE weight IS NOT NULL),
        'mandatory', count(*) FILTER (WHERE jsonb_array_length(COALESCE(mandatory,'[]'::jsonb)) > 0),
        'targets', count(*) FILTER (WHERE jsonb_array_length(COALESCE(targets,'[]'::jsonb)) > 0)
      )
      FROM daily_logs WHERE log_date = current_date
    ),

    -- 14-day DAU trend
    'trend_14d', (
      SELECT jsonb_agg(jsonb_build_object('day', d.day, 'active', COALESCE(a.active, 0)) ORDER BY d.day)
      FROM (SELECT generate_series(current_date - INTERVAL '13 days', current_date, INTERVAL '1 day')::date AS day) d
      LEFT JOIN (
        SELECT log_date, count(DISTINCT user_id) AS active
        FROM daily_logs WHERE log_date >= current_date - INTERVAL '13 days'
        GROUP BY log_date
      ) a ON a.log_date = d.day
    ),

    -- D7 retention cohorts (last 8 weeks)
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

    -- Event counts (7d)
    'event_counts_7d', (
      SELECT jsonb_object_agg(event_name, cnt)
      FROM (
        SELECT event_name, count(*) AS cnt FROM events
        WHERE created_at >= current_date - INTERVAL '6 days'
        GROUP BY event_name
      ) t
    ),

    -- Competitions
    'competitions', jsonb_build_object(
      'active', (SELECT count(*) FROM competitions WHERE status = 'active'),
      'completed', (SELECT count(*) FROM competitions WHERE status = 'completed'),
      'waiting', (SELECT count(*) FROM competitions WHERE status = 'waiting')
    ),

    -- Row data
    'all_users', (
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.total_score DESC NULLS LAST)
      FROM (
        SELECT
          p.id, p.display_name,
          COALESCE(p.total_score, 0) AS total_score,
          p.onboarded, p.is_admin,
          u.email,
          u.created_at::date AS signed_up,
          (SELECT count(*) FROM daily_logs dl WHERE dl.user_id = p.id) AS log_days,
          (SELECT max(dl.log_date) FROM daily_logs dl WHERE dl.user_id = p.id) AS last_log
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
        ORDER BY dl.log_date DESC LIMIT 50
      ) t
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_dashboard() TO authenticated;
