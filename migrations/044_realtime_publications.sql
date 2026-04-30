-- 044_realtime_publications.sql
-- Supabase Realtime 이 daily_logs / trainer_relationship_requests 변경을
-- 회원 앱에 emit 하도록 supabase_realtime publication 에 추가.

-- daily_logs — 트레이너가 운동/징역 부여 시 회원 앱 즉시 갱신
ALTER PUBLICATION supabase_realtime ADD TABLE daily_logs;
-- trainer_relationship_requests — 신규 등록 요청 즉시 알림
ALTER PUBLICATION supabase_realtime ADD TABLE trainer_relationship_requests;
-- workout_assignments — 트레이너 측에서 회원 진행 상태 실시간 모니터링용
ALTER PUBLICATION supabase_realtime ADD TABLE workout_assignments;
-- trainer_messages — 양방향 메시지 채널
ALTER PUBLICATION supabase_realtime ADD TABLE trainer_messages;
