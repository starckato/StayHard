-- 039_trainer_clients_memo.sql
-- 트레이너가 회원별 비공개 메모 (체형·목표·결제 등). 회원에게는 안 보임.

ALTER TABLE trainer_clients
  ADD COLUMN IF NOT EXISTS trainer_memo text;

NOTIFY pgrst, 'reload schema';
