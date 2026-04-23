-- Will Cube Phase 5 — profiles.total_score 재계산.
--
-- 변경 이유: 2026-04-24 에 cube 점수 규칙이 "gray = 0 점" 으로 변경됨
-- (기존 gray = +1). 또한 식단 "1끼만 등록 = gray" 규칙도 들어감. 기존
-- legacy addScore 방식으로 누적된 CP.total_score 는 과대평가 상태.
--
-- 이 마이그레이션은 각 유저의 daily_logs.cubes 를 scoreFromCubes 공식으로
-- 합산해 profiles.total_score 를 갱신.
--
-- 공식 (src/features/cubes/score.js BASE_SCORE 와 동일):
--   gold    : +3
--   silver  : +2
--   crimson : −3
--   gray    :  0
--   null    :  0
--   bonus   : count × 3 (gold 큐브 기준)
--
-- 주의:
--   1) daily_logs.cubes IS NULL 인 날은 0점으로 집계. 유저가 앱 열면 silent
--      sync 가 그 날의 cubes 를 채움 → 다음 백필 때 반영.
--   2) 이 스크립트는 idempotent. 여러 번 돌려도 안전.
--   3) ⚠️ 프로덕션 실행 전 DRY-RUN (아래 SELECT) 로 영향 범위 확인 필수.

-- ── DRY-RUN: 유저별 이전/이후 점수 비교 ──────────────────
-- 실행:
--   ./scripts/sb-sql.sh -c "$(cat <<'EOF'
--   <이 블록 SQL>
--   EOF
--   )"
/*
WITH cube_day_scores AS (
  SELECT
    user_id,
    log_date,
    (CASE cubes->>'diet'           WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 WHEN 'crimson' THEN -3 ELSE 0 END) +
    (CASE cubes->>'exercise'       WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 WHEN 'crimson' THEN -3 ELSE 0 END) +
    (CASE cubes->>'exercise_bonus' WHEN 'gold' THEN 3 ELSE 0 END) +
    (CASE cubes->>'routine'        WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 WHEN 'crimson' THEN -3 ELSE 0 END) +
    (CASE cubes->>'tasks'          WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 WHEN 'crimson' THEN -3 ELSE 0 END) +
    COALESCE((
      SELECT SUM(COALESCE((item->>'count')::int, 0)) * 3
      FROM jsonb_array_elements(COALESCE(cubes->'bonus', '[]'::jsonb)) AS item
    ), 0) AS day_score
  FROM daily_logs
  WHERE cubes IS NOT NULL
),
user_totals AS (
  SELECT
    dl.user_id,
    COALESCE(SUM(cds.day_score), 0) AS cube_total,
    COUNT(DISTINCT cds.log_date) AS cube_days,
    COUNT(DISTINCT dl.log_date) AS total_days
  FROM daily_logs dl
  LEFT JOIN cube_day_scores cds ON cds.user_id = dl.user_id AND cds.log_date = dl.log_date
  GROUP BY dl.user_id
)
SELECT
  ut.user_id,
  p.username,
  p.total_score AS old_score,
  GREATEST(0, ut.cube_total)::int AS new_score,
  ut.cube_total - p.total_score AS diff,
  ut.cube_days || '/' || ut.total_days AS cube_coverage
FROM user_totals ut
JOIN profiles p ON p.id = ut.user_id
ORDER BY ABS(ut.cube_total - p.total_score) DESC
LIMIT 50;
*/

-- ── UPDATE: 실제 적용 ────────────────────────────────────
WITH cube_day_scores AS (
  SELECT
    user_id,
    log_date,
    (CASE cubes->>'diet'           WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 WHEN 'crimson' THEN -3 ELSE 0 END) +
    (CASE cubes->>'exercise'       WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 WHEN 'crimson' THEN -3 ELSE 0 END) +
    (CASE cubes->>'exercise_bonus' WHEN 'gold' THEN 3 ELSE 0 END) +
    (CASE cubes->>'routine'        WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 WHEN 'crimson' THEN -3 ELSE 0 END) +
    (CASE cubes->>'tasks'          WHEN 'gold' THEN 3 WHEN 'silver' THEN 2 WHEN 'crimson' THEN -3 ELSE 0 END) +
    COALESCE((
      SELECT SUM(COALESCE((item->>'count')::int, 0)) * 3
      FROM jsonb_array_elements(COALESCE(cubes->'bonus', '[]'::jsonb)) AS item
    ), 0) AS day_score
  FROM daily_logs
  WHERE cubes IS NOT NULL
),
-- 해당 유저가 daily_logs 를 갖고 있으면 cube_total 반영. 없으면 건드리지 않음.
user_totals AS (
  SELECT
    dl.user_id,
    COALESCE(SUM(cds.day_score), 0)::int AS cube_total
  FROM daily_logs dl
  LEFT JOIN cube_day_scores cds ON cds.user_id = dl.user_id AND cds.log_date = dl.log_date
  GROUP BY dl.user_id
)
UPDATE profiles p
SET total_score = GREATEST(0, ut.cube_total)
FROM user_totals ut
WHERE p.id = ut.user_id
  AND p.total_score IS DISTINCT FROM GREATEST(0, ut.cube_total);

-- ── 롤백 (필요 시 수동 실행) ─────────────────────────────
-- 롤백 불가. 재계산된 값은 cube 기반. 예전 legacy 값 복구는 프로필 백업에서.
