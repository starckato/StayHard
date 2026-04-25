-- Migration: 021_admin_retention_rpc.sql
-- Admin 전용 retention metrics 통합 RPC.
--
-- 문제: retention_m1~m10 뷰는 SECURITY INVOKER 라 caller 의 RLS 권한으로 동작.
-- profiles/daily_logs JOIN 하는 뷰는 admin 이라도 본인 행만 보임.
--
-- 해결: SECURITY DEFINER RPC 로 admin 체크 후 모든 뷰 통합 JSON 반환.
-- 일반 유저 호출 시 권한 거부.

CREATE OR REPLACE FUNCTION public.admin_retention_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_result jsonb;
BEGIN
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  v_result := jsonb_build_object(
    -- M1: time-to-first-cube (분 단위 평균/중앙값)
    'm1', (
      SELECT jsonb_build_object(
        'total_users',    count(*),
        'with_first_cube', count(minutes_to_first_cube),
        'p50_minutes',    percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes_to_first_cube),
        'p95_minutes',    percentile_cont(0.95) WITHIN GROUP (ORDER BY minutes_to_first_cube)
      )
      FROM retention_m1_time_to_first_cube
    ),

    -- M2: D1 gold returning rate
    'm2', (
      SELECT jsonb_build_object(
        'total',           count(*),
        'had_gold_d0',     count(*) FILTER (WHERE had_gold_day0),
        'returned_d1',     count(*) FILTER (WHERE returned_day1),
        'gold_and_return', count(*) FILTER (WHERE had_gold_day0 AND returned_day1)
      )
      FROM retention_m2_d1_gold
    ),

    -- M3: opt-in rate
    'm3', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'event', event_key, 'trigger', trigger_tag, 'result', result, 'n', n
      )), '[]'::jsonb)
      FROM retention_m3_opt_in
    ),

    -- M4: friend funnel
    'm4', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'event', event_key, 'unique_users', unique_users, 'events', events
      ) ORDER BY array_position(ARRAY['friend_code_viewed','friend_code_shared','friend_code_entered','friend_added']::text[], event_key)),
      '[]'::jsonb)
      FROM retention_m4_friend_funnel
    ),

    -- M5: nudge ratio (last 4 weeks)
    'm5', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'week', to_char(week, 'YYYY-MM-DD'), 'event', event_key, 'n', n
      ) ORDER BY week DESC), '[]'::jsonb)
      FROM (
        SELECT week, event_key, n FROM retention_m5_nudge_ratio
        ORDER BY week DESC LIMIT 8
      ) t
    ),

    -- M6: returner reactivation
    'm6', (
      SELECT jsonb_build_object(
        'activated',     count(*),
        'reactivated_7d', count(*) FILTER (WHERE reactivated_within_7d)
      )
      FROM retention_m6_returner_react
    ),

    -- M7: red-cube W1 → W2
    'm7', (
      SELECT jsonb_build_object(
        'total',           count(*),
        'had_crimson_w1',  count(*) FILTER (WHERE had_crimson_w1),
        'active_w2',       count(*) FILTER (WHERE active_w2),
        'crimson_and_active', count(*) FILTER (WHERE had_crimson_w1 AND active_w2)
      )
      FROM retention_m7_redcube_w1
    ),

    -- M8: perfect day distribution (last 4 weeks)
    'm8', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id', user_id, 'week', to_char(week, 'YYYY-MM-DD'), 'count', perfect_count
      ) ORDER BY week DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM retention_m8_perfect_day
        ORDER BY week DESC LIMIT 30
      ) t
    ),

    -- M9: status band dwell (last 14 days)
    'm9', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', to_char(day, 'YYYY-MM-DD'), 'p50', p50, 'p95', p95, 'samples', samples
      ) ORDER BY day DESC), '[]'::jsonb)
      FROM (
        SELECT * FROM retention_m9_sb_dwell ORDER BY day DESC LIMIT 14
      ) t
    ),

    -- M10: tab split
    'm10', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'tab', tab, 'visits', visits, 'unique_users', unique_users
      ) ORDER BY visits DESC), '[]'::jsonb)
      FROM retention_m10_tab_split
    )
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retention_summary() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_retention_summary() TO authenticated;

COMMENT ON FUNCTION public.admin_retention_summary() IS
  'Admin-only retention metrics aggregator. Consolidates M1-M10 views into single JSON.';
