-- 큐록 · profile.routine_defs canonical source
--
-- 배경: daily_logs.mandatory 의 self-propagation 패턴 (loadRoutineDefinitions 가
-- cache 의 가장 최근 mandatory 를 다음 날로 복사) 이 데이터 손실/오염을 확산시킴.
-- starckato 5/9 사태 + 6/8 "🐱 고양이 화장실" ghost routine 의 재발 방지.
--
-- 해결: profile.routine_defs JSONB 컬럼 — 사용자의 canonical routine 정의.
-- daily_logs.mandatory 는 그날의 done/fail state 스냅샷일 뿐.
--
-- 데이터 형식 (배열):
--   [
--     { "name": "양치", "days": [0,1,2,3,4,5,6], "_scoreType": null, "end_date": null },
--     ...
--   ]
--
-- migration:
--   - 컬럼 추가 (default null, 기존 사용자 무영향)
--   - 클라이언트 saveMandatory 가 profile.routine_defs 를 즉시 갱신하도록
--     다음 commit 에서 수정 (sync write)
--   - loadRoutineDefinitions 가 routine_defs 우선 사용 (이미 6/8 적용)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS routine_defs jsonb;

COMMENT ON COLUMN profiles.routine_defs IS
  'Canonical list of user custom routine definitions. Snapshot stored in daily_logs.mandatory only carries done/fail state. Format: [{name, days, _scoreType, end_date}].';

-- 기존 사용자 backfill: 가장 최근 30일 중 가장 많은 customs 를 가진 daily_log 의
-- mandatory 를 routine_defs 로 복사 (custom 만).
WITH latest_logs AS (
  SELECT
    user_id,
    mandatory,
    log_date,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY log_date DESC) AS rn
  FROM daily_logs
  WHERE mandatory IS NOT NULL AND jsonb_array_length(mandatory) > 0
),
candidate AS (
  SELECT DISTINCT ON (user_id)
    user_id,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', m->>'name',
          'days', COALESCE(m->'days', '[0,1,2,3,4,5,6]'::jsonb),
          '_scoreType', m->'_scoreType',
          'end_date', m->'end_date'
        )
      )
      FROM jsonb_array_elements(mandatory) m
      WHERE m->>'type' = 'custom' AND m->>'name' IS NOT NULL
    ) AS defs
  FROM latest_logs
  WHERE rn <= 7
  ORDER BY user_id, log_date DESC
)
UPDATE profiles p
SET routine_defs = c.defs
FROM candidate c
WHERE p.id = c.user_id AND p.routine_defs IS NULL AND c.defs IS NOT NULL;
