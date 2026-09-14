-- 054 · activities source 에 'file' 추가 (2026-09-14)
-- 범용 활동 파일 임포트 (.fit/.tcx/.gpx — 가민·코로스·순토·폴라 등 전 워치 공통).
-- 스트라바를 쓰지 않는 가민 유저 등을 커버하는 경로.
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_source_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_source_check
  CHECK (source IN ('strava','garmin','manual','agent','file'));
