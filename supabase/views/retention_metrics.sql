-- 큐록 · retention metrics views
--
-- SERVICE_EVALUATION §7 M1-M10 집계 뷰.
-- metric_events (append-only) + profiles + daily_logs 조합.
-- admin 계정만 전체 조회 가능 (metric_events RLS admin 정책 참조).
--
-- 실행:
--   ./scripts/sb-sql.sh supabase/views/retention_metrics.sql
--
-- 조회:
--   SELECT * FROM retention_m1_time_to_first_cube LIMIT 20;

-- M1. Time-to-first-cube (신규 가입부터 첫 큐브까지 소요 시간)
CREATE OR REPLACE VIEW public.retention_m1_time_to_first_cube AS
SELECT
  p.id AS user_id,
  p.username,
  p.created_at AS signed_up_at,
  me.created_at AS first_cube_at,
  EXTRACT(EPOCH FROM (me.created_at - p.created_at))/60 AS minutes_to_first_cube
FROM public.profiles p
LEFT JOIN LATERAL (
  SELECT created_at FROM public.metric_events e
  WHERE e.user_id = p.id AND e.event_key = 'first_cube_earned'
  ORDER BY e.created_at ASC LIMIT 1
) me ON TRUE;

-- M2. D1 returning with gold-day-1
CREATE OR REPLACE VIEW public.retention_m2_d1_gold AS
SELECT
  p.id AS user_id,
  dl_day0.log_date AS day0_date,
  (dl_day0.cubes IS NOT NULL
    AND (dl_day0.cubes->>'diet' = 'gold'
      OR dl_day0.cubes->>'exercise' = 'gold'
      OR dl_day0.cubes->>'routine' = 'gold'
      OR dl_day0.cubes->>'tasks' = 'gold')) AS had_gold_day0,
  (dl_day1.log_date IS NOT NULL) AS returned_day1
FROM public.profiles p
LEFT JOIN public.daily_logs dl_day0
  ON dl_day0.user_id = p.id AND dl_day0.log_date = p.created_at::date
LEFT JOIN public.daily_logs dl_day1
  ON dl_day1.user_id = p.id AND dl_day1.log_date = (p.created_at + interval '1 day')::date;

-- M3. Notification opt-in rate (onboarding vs D3)
CREATE OR REPLACE VIEW public.retention_m3_opt_in AS
SELECT
  event_key,
  meta->>'trigger' AS trigger_tag,
  meta->>'result' AS result,
  count(*) AS n
FROM public.metric_events
WHERE event_key IN ('opt_in_requested_onboarding','opt_in_requested_d3','opt_in_result')
GROUP BY 1,2,3
ORDER BY 1,3;

-- M4. Friend code exchange funnel
CREATE OR REPLACE VIEW public.retention_m4_friend_funnel AS
SELECT
  event_key,
  count(DISTINCT user_id) AS unique_users,
  count(*) AS events
FROM public.metric_events
WHERE event_key IN ('friend_code_viewed','friend_code_shared','friend_code_entered','friend_added')
GROUP BY 1
ORDER BY array_position(ARRAY['friend_code_viewed','friend_code_shared','friend_code_entered','friend_added']::text[], event_key);

-- M5. Nudge send/receive ratio per WAU (weekly)
CREATE OR REPLACE VIEW public.retention_m5_nudge_ratio AS
SELECT
  date_trunc('week', created_at) AS week,
  event_key,
  count(*) AS n
FROM public.metric_events
WHERE event_key IN ('nudge_sent','nudge_received')
GROUP BY 1,2
ORDER BY 1 DESC, 2;

-- M6. Returner reactivation rate (grace 활성 후 7일 내 로그 남긴 유저)
CREATE OR REPLACE VIEW public.retention_m6_returner_react AS
SELECT
  e.user_id,
  e.created_at AS grace_activated_at,
  EXISTS (
    SELECT 1 FROM public.daily_logs dl
    WHERE dl.user_id = e.user_id
      AND dl.log_date BETWEEN e.created_at::date AND (e.created_at + interval '7 days')::date
  ) AS reactivated_within_7d
FROM public.metric_events e
WHERE e.event_key = 'returner_grace_activated';

-- M7. Red-cube-after-W1 rate (가입 첫 주 crimson 받은 유저의 2주차 유지율)
CREATE OR REPLACE VIEW public.retention_m7_redcube_w1 AS
WITH w1 AS (
  SELECT
    p.id AS user_id,
    bool_or(
      dl.cubes->>'diet' = 'crimson'
      OR dl.cubes->>'exercise' = 'crimson'
      OR dl.cubes->>'routine' = 'crimson'
      OR dl.cubes->>'tasks' = 'crimson'
    ) AS had_crimson_w1
  FROM public.profiles p
  LEFT JOIN public.daily_logs dl
    ON dl.user_id = p.id
    AND dl.log_date BETWEEN p.created_at::date AND (p.created_at + interval '6 days')::date
  GROUP BY p.id
),
w2 AS (
  SELECT
    p.id AS user_id,
    count(*) > 0 AS active_w2
  FROM public.profiles p
  LEFT JOIN public.daily_logs dl
    ON dl.user_id = p.id
    AND dl.log_date BETWEEN (p.created_at + interval '7 days')::date AND (p.created_at + interval '13 days')::date
  GROUP BY p.id
)
SELECT w1.user_id, w1.had_crimson_w1, w2.active_w2
FROM w1 FULL OUTER JOIN w2 USING (user_id);

-- M8. Perfect day 분포 (주당 perfect 수)
CREATE OR REPLACE VIEW public.retention_m8_perfect_day AS
SELECT
  user_id,
  date_trunc('week', created_at) AS week,
  count(*) AS perfect_count
FROM public.metric_events
WHERE event_key = 'perfect_day_achieved'
GROUP BY 1,2
ORDER BY 2 DESC, 1;

-- M9. Status Band dwell (p50/p95 seconds)
CREATE OR REPLACE VIEW public.retention_m9_sb_dwell AS
SELECT
  date_trunc('day', created_at) AS day,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY (meta->>'seconds')::numeric) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (meta->>'seconds')::numeric) AS p95,
  count(*) AS samples
FROM public.metric_events
WHERE event_key = 'status_band_dwell' AND meta ? 'seconds'
GROUP BY 1
ORDER BY 1 DESC;

-- M10. 3-tab 분포 (세션당 탭 방문 비율)
CREATE OR REPLACE VIEW public.retention_m10_tab_split AS
SELECT
  meta->>'tab' AS tab,
  count(*) AS visits,
  count(DISTINCT user_id) AS unique_users
FROM public.metric_events
WHERE event_key = 'tab_visit'
GROUP BY 1
ORDER BY 2 DESC;
