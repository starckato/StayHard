# Stay Hard — Ops SQL Playbook

Two ways to run these:

1. **Supabase Dashboard → SQL Editor** — paste + Run. Runs as `postgres`, bypasses RLS.
2. **`./scripts/sb-sql.sh -c "SELECT …"`** — Management API via Personal Access Token (stored at `~/.stayhard-sb-pat`, `chmod 600`). Can also pass a file path. See `scripts/README.md`.

Requires `migrations/003–011` applied. All queries here are read-only SELECTs unless marked otherwise.

### Current infra reference (as of v2.4 / 2026-04-19)

| Table / Column | Purpose | Migration |
|---|---|---|
| `profiles.is_admin` | Admin flag — gates `admin_dashboard`, `grant_bonus_by_email`, `set_user_excluded` | 003 |
| `profiles.is_excluded` | Hides user from dashboard metrics (internal/test accounts) | 006 |
| `profiles.goal` | `diet` / `muscle` / `habit` (from onboarding) | 010 |
| `profiles.total_score` | Lifetime score; updated via `addScore` + `claim_bonus_grant` RPC | (pre-session) |
| `events` table | Analytics event stream (`track()` client → RLS insert-self) | 003 |
| `bonus_grants` table | Admin-issued celebrations (claim via RPC) | 005 |

| RPC | Caller | Notes |
|---|---|---|
| `admin_dashboard()` | admin.html | Returns full KPI payload; raises if not admin |
| `claim_bonus_grant(id)` | client (post-auth) | Atomic grant consume + score bump |
| `grant_bonus_by_email(email, key, title, msg, pts, icon)` | admin | Upsert on (user_id, event_key) |
| `set_user_excluded(uuid, bool)` | admin | Toggle exclusion flag |
| `is_user_excluded(uuid)` | internal only | REVOKE'd from authenticated/anon (migration 011) |
| `is_admin()` | internal — called by other SECURITY DEFINER fns | pre-session |

---

## 🎯 Daily Pulse (run every morning)

```sql
-- One-shot daily summary
SELECT
  current_date AS day,
  (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date = current_date) AS dau,
  (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date >= current_date - INTERVAL '6 days') AS wau,
  (SELECT count(DISTINCT user_id) FROM daily_logs WHERE log_date >= current_date - INTERVAL '29 days') AS mau,
  (SELECT count(*) FROM auth.users WHERE created_at::date = current_date) AS signups_today,
  (SELECT count(*) FROM auth.users WHERE created_at >= current_date - INTERVAL '6 days') AS signups_7d,
  (SELECT count(*) FROM auth.users) AS signups_total;
```

---

## ⭐ North Star — WAE (Weekly Active & Engaged)

Distinct users with **3+ log days** in the rolling 7-day window.
If this trends up, your habit app is habit-forming. If it trends down, you have a retention problem.

```sql
SELECT count(*) AS wae_current
FROM (
  SELECT user_id
  FROM daily_logs
  WHERE log_date >= current_date - INTERVAL '6 days'
  GROUP BY user_id
  HAVING count(DISTINCT log_date) >= 3
) t;
```

### WAE trend over last 4 weeks
```sql
WITH weeks AS (
  SELECT generate_series(
    date_trunc('week', current_date - INTERVAL '3 weeks')::date,
    date_trunc('week', current_date)::date,
    INTERVAL '1 week'
  )::date AS week_start
)
SELECT
  w.week_start,
  (SELECT count(*) FROM (
    SELECT dl.user_id
    FROM daily_logs dl
    WHERE dl.log_date >= w.week_start AND dl.log_date < w.week_start + INTERVAL '7 days'
    GROUP BY dl.user_id
    HAVING count(DISTINCT dl.log_date) >= 3
  ) t) AS wae
FROM weeks w
ORDER BY w.week_start DESC;
```

---

## 🔥 Activation Funnel

Shows drop-off from signup → onboarded → first log → 3-day week 1 → fully activated (100pt+).

```sql
WITH
  signups AS (SELECT id FROM auth.users),
  onboarded AS (SELECT id FROM profiles WHERE onboarded = true),
  first_logged AS (SELECT DISTINCT user_id AS id FROM daily_logs),
  three_day_w1 AS (
    SELECT dl.user_id AS id
    FROM daily_logs dl
    JOIN auth.users u ON u.id = dl.user_id
    WHERE dl.log_date >= u.created_at::date
      AND dl.log_date < u.created_at::date + INTERVAL '7 days'
    GROUP BY dl.user_id
    HAVING count(DISTINCT dl.log_date) >= 3
  ),
  activated AS (
    SELECT t.id FROM three_day_w1 t
    JOIN profiles p ON p.id = t.id
    WHERE p.total_score >= 100 AND p.onboarded = true
  )
SELECT
  (SELECT count(*) FROM signups) AS "1_signups",
  (SELECT count(*) FROM onboarded) AS "2_onboarded",
  (SELECT count(*) FROM first_logged) AS "3_first_logged",
  (SELECT count(*) FROM three_day_w1) AS "4_three_day_week1",
  (SELECT count(*) FROM activated) AS "5_activated";
```

---

## 📅 D7 Retention by Cohort (last 8 weeks)

Of users who signed up in week X, how many came back and logged in week X+1?

- Green zone: ≥40% (strong habit)
- Yellow: 20–40% (marginal)
- Red: <20% (activation problem)

```sql
SELECT
  date_trunc('week', u.created_at)::date AS cohort_week,
  count(*) AS cohort_size,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM daily_logs dl
    WHERE dl.user_id = u.id
      AND dl.log_date >= u.created_at::date + INTERVAL '7 days'
      AND dl.log_date < u.created_at::date + INTERVAL '14 days'
  )) AS retained_d7,
  ROUND(100.0 * count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM daily_logs dl
    WHERE dl.user_id = u.id
      AND dl.log_date >= u.created_at::date + INTERVAL '7 days'
      AND dl.log_date < u.created_at::date + INTERVAL '14 days'
  )) / NULLIF(count(*), 0), 1) AS retention_pct
FROM auth.users u
WHERE u.created_at >= current_date - INTERVAL '56 days'
GROUP BY cohort_week
ORDER BY cohort_week DESC;
```

---

## 🎯 Feature Adoption (today's DAU)

Of users who logged anything today, what % used each feature?

```sql
WITH today AS (SELECT * FROM daily_logs WHERE log_date = current_date)
SELECT
  count(*) AS dau,
  count(*) FILTER (WHERE jsonb_array_length(COALESCE(meals, '[]'::jsonb)) > 0) AS logged_meals,
  count(*) FILTER (WHERE jsonb_array_length(COALESCE(workouts, '[]'::jsonb)) > 0) AS logged_workouts,
  count(*) FILTER (WHERE COALESCE(water_cups, 0) > 0) AS logged_water,
  count(*) FILTER (WHERE weight IS NOT NULL) AS logged_weight,
  count(*) FILTER (WHERE jsonb_array_length(COALESCE(mandatory, '[]'::jsonb)) > 0) AS set_mandatory,
  count(*) FILTER (WHERE jsonb_array_length(COALESCE(targets, '[]'::jsonb)) > 0) AS set_targets
FROM today;
```

---

## 👑 Top 10 Users by Score

```sql
SELECT
  p.display_name,
  u.email,
  p.total_score,
  p.onboarded,
  p.is_admin,
  u.created_at::date AS signed_up
FROM profiles p
JOIN auth.users u ON u.id = p.id
ORDER BY p.total_score DESC NULLS LAST
LIMIT 10;
```

---

## 📤 Recent Share Events (viral loop check)

Who's sharing? What's the tempo?

```sql
SELECT
  p.display_name,
  u.email,
  e.created_at,
  e.meta->>'mode' AS mode,
  e.meta->>'view' AS view
FROM events e
LEFT JOIN profiles p ON p.id = e.user_id
LEFT JOIN auth.users u ON u.id = e.user_id
WHERE e.event_name = 'share_muscle_map'
ORDER BY e.created_at DESC
LIMIT 20;
```

---

## 📊 Event Counts (last 7 days)

Which events fire most? Good sanity check that tracking is alive.

```sql
SELECT
  event_name,
  count(*) AS cnt_7d,
  min(created_at) AS first_seen,
  max(created_at) AS last_seen
FROM events
WHERE created_at >= current_date - INTERVAL '6 days'
GROUP BY event_name
ORDER BY cnt_7d DESC;
```

---

## 🔍 Drill Down: Single User by Email

Replace the email to dig into one user's full activity.

```sql
WITH target AS (SELECT id FROM auth.users WHERE email = 'starckato@gmail.com')
SELECT
  'profile' AS section,
  jsonb_build_object(
    'display_name', p.display_name,
    'total_score', p.total_score,
    'onboarded', p.onboarded,
    'is_admin', p.is_admin,
    'weight_goal', p.weight_goal,
    'signed_up', u.created_at
  ) AS data
FROM profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.id = (SELECT id FROM target)

UNION ALL

SELECT
  'log_days_count',
  jsonb_build_object('total_log_days', count(*))
FROM daily_logs WHERE user_id = (SELECT id FROM target)

UNION ALL

SELECT
  'recent_logs',
  jsonb_build_object(
    'log_date', log_date,
    'weight', weight,
    'meals_count', jsonb_array_length(COALESCE(meals, '[]'::jsonb)),
    'workouts_count', jsonb_array_length(COALESCE(workouts, '[]'::jsonb))
  )
FROM daily_logs
WHERE user_id = (SELECT id FROM target)
ORDER BY section, data->>'log_date' DESC NULLS LAST
LIMIT 20;
```

---

## 🏆 Competitions Summary

```sql
SELECT
  status,
  count(*) AS cnt,
  avg(jsonb_array_length(members)) AS avg_members,
  max(jsonb_array_length(members)) AS max_members
FROM competitions
GROUP BY status;
```

---

## 🚨 Health Check

Quick "is everything healthy" query.

```sql
SELECT
  (SELECT count(*) FROM auth.users) AS total_users,
  (SELECT count(*) FROM profiles) AS total_profiles,
  (SELECT count(*) FROM daily_logs) AS total_log_rows,
  (SELECT count(*) FROM events) AS total_events,
  (SELECT count(*) FROM competitions) AS total_competitions,
  (SELECT max(created_at) FROM events) AS last_event_at,
  (SELECT max(created_at) FROM auth.users) AS last_signup_at;
```

Mismatch between `total_users` and `total_profiles` = signup flow is broken for someone. Investigate.

---

## Saving Queries in Supabase

In SQL Editor, click **"+ New snippet"** on the left sidebar and paste any of the above. They'll save to your workspace for one-click re-run later.
