-- Migration: 006_exclude_users_from_dashboard.sql
-- Add profiles.is_excluded flag to hide internal/test accounts from admin metrics.
-- Affects: admin_dashboard() — every aggregation filters out excluded users.
-- `all_users` still returns everyone (so admin can toggle), marked with is_excluded=true.
--
-- Run AFTER 004_admin_dashboard_full_data.sql.

-- ── 1) Column ──
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_excluded boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS profiles_is_excluded_idx
  ON public.profiles (id) WHERE is_excluded = true;

-- ── 2) Helper — STABLE so query planner can inline ──
CREATE OR REPLACE FUNCTION public.is_user_excluded(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_excluded FROM public.profiles WHERE id = p_user_id LIMIT 1),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_user_excluded(uuid) TO authenticated;

-- ── 3) Admin-only toggle RPC ──
CREATE OR REPLACE FUNCTION public.set_user_excluded(p_user_id uuid, p_excluded boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_admin');
  END IF;
  UPDATE public.profiles SET is_excluded = p_excluded WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'is_excluded', p_excluded);
END;
$$;
REVOKE ALL ON FUNCTION public.set_user_excluded(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_user_excluded(uuid, boolean) TO authenticated;

-- ── 4) Seed: flag known internal accounts ──
-- test2@test.com and both admin aliases. Adjust / extend as needed.
UPDATE public.profiles SET is_excluded = true
WHERE id IN (
  SELECT id FROM auth.users
  WHERE lower(email) IN (
    'test2@test.com',
    'test@test.com',
    'starckato@stayhard.com',
    'starckato@gmail.com'
  )
);

-- ── 5) Rewrite admin_dashboard() with exclusion filters ──
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

    -- Active users now
    'dau', (SELECT count(DISTINCT dl.user_id) FROM daily_logs dl
      WHERE dl.log_date = current_date AND NOT is_user_excluded(dl.user_id)),
    'wau', (SELECT count(DISTINCT dl.user_id) FROM daily_logs dl
      WHERE dl.log_date >= current_date - INTERVAL '6 days' AND NOT is_user_excluded(dl.user_id)),
    'mau', (SELECT count(DISTINCT dl.user_id) FROM daily_logs dl
      WHERE dl.log_date >= current_date - INTERVAL '29 days' AND NOT is_user_excluded(dl.user_id)),

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

    -- North star — WAE (weekly active & engaged = 3+ log days in rolling 7d)
    'wae', (
      SELECT count(*) FROM (
        SELECT dl.user_id FROM daily_logs dl
        WHERE dl.log_date >= current_date - INTERVAL '6 days'
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
        WHERE NOT is_user_excluded(dl.user_id)),
      'three_day_week1', (
        SELECT count(*) FROM (
          SELECT dl.user_id FROM daily_logs dl
          JOIN auth.users u ON u.id = dl.user_id
          WHERE dl.log_date >= u.created_at::date
            AND dl.log_date < u.created_at::date + INTERVAL '7 days'
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

    -- 14-day DAU trend
    'trend_14d', (
      SELECT jsonb_agg(jsonb_build_object('day', d.day, 'active', COALESCE(a.active, 0)) ORDER BY d.day)
      FROM (SELECT generate_series(current_date - INTERVAL '13 days', current_date, INTERVAL '1 day')::date AS day) d
      LEFT JOIN (
        SELECT dl.log_date, count(DISTINCT dl.user_id) AS active
        FROM daily_logs dl
        WHERE dl.log_date >= current_date - INTERVAL '13 days'
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
          )) AS retained_d7
        FROM auth.users u
        WHERE u.created_at >= current_date - INTERVAL '56 days'
          AND NOT is_user_excluded(u.id)
        GROUP BY date_trunc('week', u.created_at)::date
      ) c
    ),

    -- Event counts (7d)
    'event_counts_7d', (
      SELECT jsonb_object_agg(event_name, cnt)
      FROM (
        SELECT e.event_name, count(*) AS cnt FROM events e
        WHERE e.created_at >= current_date - INTERVAL '6 days'
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

    -- Row data — INCLUDES excluded users but marks them (so admin can toggle)
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
          (SELECT count(*) FROM daily_logs dl WHERE dl.user_id = p.id) AS log_days,
          (SELECT max(dl.log_date) FROM daily_logs dl WHERE dl.user_id = p.id) AS last_log
        FROM profiles p
        LEFT JOIN auth.users u ON u.id = p.id
      ) t
    ),

    -- Recent events — excluded users filtered out
    'recent_events', (
      SELECT jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC)
      FROM (
        SELECT e.id, e.user_id, e.event_name, e.meta, e.created_at, p.display_name AS user_name
        FROM events e
        LEFT JOIN profiles p ON p.id = e.user_id
        WHERE NOT is_user_excluded(e.user_id)
        ORDER BY e.created_at DESC LIMIT 100
      ) t
    ),

    -- Recent logs — excluded users filtered out
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
        ORDER BY dl.log_date DESC LIMIT 50
      ) t
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_dashboard() TO authenticated;

-- ── 6) Usage ──
-- Check which users are excluded:
--   SELECT u.email, p.is_excluded FROM profiles p JOIN auth.users u ON u.id=p.id WHERE p.is_excluded;
--
-- Add/remove via RPC (from admin.html or SQL Editor):
--   SELECT set_user_excluded('<uuid>', true);  -- exclude
--   SELECT set_user_excluded('<uuid>', false); -- include
