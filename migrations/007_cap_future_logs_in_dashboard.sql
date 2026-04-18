-- Migration: 007_cap_future_logs_in_dashboard.sql
-- Fix: future-dated daily_logs rows (user navigates day slider past today and logs)
-- were inflating last_log, log_days, WAU, MAU, WAE, and prev-period counts.
-- All daily_logs reads now capped at log_date <= current_date.
--
-- Run AFTER 006_exclude_users_from_dashboard.sql.

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

    -- Signups (excluded users removed)
    'signups_total', (
      SELECT count(*) FROM auth.users u
      WHERE NOT is_user_excluded(u.id)
    ),
    'signups_7d', (
      SELECT count(*) FROM auth.users u
      WHERE u.created_at >= current_date - INTERVAL '6 days'
        AND NOT is_user_excluded(u.id)
    ),
    'signups_prev_7d', (
      SELECT count(*) FROM auth.users u
      WHERE u.created_at >= current_date - INTERVAL '13 days'
        AND u.created_at < current_date - INTERVAL '6 days'
        AND NOT is_user_excluded(u.id)
    ),
    'signups_30d', (
      SELECT count(*) FROM auth.users u
      WHERE u.created_at >= current_date - INTERVAL '29 days'
        AND NOT is_user_excluded(u.id)
    ),

    -- Active users now (log_date <= current_date cap added)
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

    -- Active users previous period (for delta)
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

    -- North star — WAE (weekly active & engaged = 3+ log days in rolling 7d, past only)
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

    -- Activation funnel
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

    -- Feature adoption (today's DAU)
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

    -- 14-day DAU trend (generate_series ends at current_date so future rows auto-excluded)
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
              AND dl.log_date <= current_date
          )) AS retained_d7
        FROM auth.users u
        WHERE u.created_at >= current_date - INTERVAL '56 days'
          AND NOT is_user_excluded(u.id)
        GROUP BY date_trunc('week', u.created_at)::date
      ) c
    ),

    -- Event counts (7d) — events table uses created_at (real timestamps, not user-entered)
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

    -- Competitions (kept unfiltered — low volume, cross-user)
    'competitions', jsonb_build_object(
      'active', (SELECT count(*) FROM competitions WHERE status = 'active'),
      'completed', (SELECT count(*) FROM competitions WHERE status = 'completed'),
      'waiting', (SELECT count(*) FROM competitions WHERE status = 'waiting')
    ),

    -- Row data — log_days and last_log capped at current_date so future-dated rows
    -- don't show as "last active on 2026-08-30" etc.
    'all_users', (
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.is_excluded ASC, t.total_score DESC NULLS LAST)
      FROM (
        SELECT
          p.id, p.display_name,
          COALESCE(p.total_score, 0) AS total_score,
          p.onboarded, p.is_admin,
          COALESCE(p.is_excluded, false) AS is_excluded,
          u.email,
          u.created_at::date AS signed_up,
          (SELECT count(*) FROM daily_logs dl
             WHERE dl.user_id = p.id AND dl.log_date <= current_date) AS log_days,
          (SELECT max(dl.log_date) FROM daily_logs dl
             WHERE dl.user_id = p.id AND dl.log_date <= current_date) AS last_log,
          (SELECT count(*) FROM daily_logs dl
             WHERE dl.user_id = p.id AND dl.log_date > current_date) AS future_logs
        FROM profiles p
        LEFT JOIN auth.users u ON u.id = p.id
      ) t
    ),

    -- Recent events — capped at now() for consistency
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

    -- Recent logs — capped at current_date
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

-- ── Diagnostic: see users with future-dated logs ──
--   SELECT u.email, count(*) AS future_rows, array_agg(dl.log_date ORDER BY dl.log_date)
--   FROM daily_logs dl JOIN auth.users u ON u.id=dl.user_id
--   WHERE dl.log_date > current_date GROUP BY u.email;
--
-- ── One-shot cleanup (CAREFUL — deletes future-dated rows) ──
--   DELETE FROM daily_logs WHERE log_date > current_date;
