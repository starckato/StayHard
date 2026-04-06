-- daily_logs 인덱스 추가 (데이터 조회 성능 개선)
-- Supabase Dashboard > SQL Editor에서 실행하세요.

-- 1. (user_id, log_date) 복합 유니크 인덱스 — upsert/단일 조회 최적화
--    onConflict:'user_id,log_date' upsert가 이 인덱스를 사용합니다.
CREATE UNIQUE INDEX IF NOT EXISTS daily_logs_user_date_idx
  ON daily_logs (user_id, log_date);

-- 2. log_date 범위 조회용 인덱스 — 통계/그래프 등 날짜 범위 쿼리 최적화
CREATE INDEX IF NOT EXISTS daily_logs_user_date_range_idx
  ON daily_logs (user_id, log_date DESC);

-- 3. profiles 테이블 — user_id 조회 최적화 (기본 PK 없을 경우)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_id_idx
  ON profiles (id);
