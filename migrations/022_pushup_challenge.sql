-- 022_pushup_challenge.sql
-- 푸쉬업 챌린지 PR 2 — competitions.daily_goal 추가
-- back-compat: 기존 weight/inbody comp 는 NULL 유지.
-- daily_logs.cubes.pushup 은 jsonb 영역에 자유롭게 추가 (스키마 변경 X).

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS daily_goal int;

COMMENT ON COLUMN public.competitions.daily_goal IS
  '푸쉬업 챌린지의 하루 목표 횟수. measure_type=pushup_count 에서만 의미. NULL=N/A.';
