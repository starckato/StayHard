-- 038_assignment_user_cancel.sql
-- 회원이 본인 앱에서 트레이너 배정 운동을 취소할 수 있도록 status 추가.
-- workout_assignments.status enum 에 'cancelled_by_user' 도입.
-- 기존 enum 이 text 면 그냥 새 값 허용, CHECK constraint 면 ALTER.

-- 기존 정의 확인 후 안전하게 처리 — text 에 CHECK 가 있다고 가정하고 CHECK 만 갱신
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'workout_assignments'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE workout_assignments DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END$$;

ALTER TABLE workout_assignments
  ADD CONSTRAINT workout_assignments_status_check
  CHECK (status IN ('pending','in_progress','completed','skipped','cancelled','cancelled_by_user'));

-- ─────────────────────────────────────────────────────
-- RPC: 회원이 본인 assignment 취소
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION client_cancel_assignment(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  UPDATE workout_assignments
  SET status = 'cancelled_by_user',
      completed_at = COALESCE(completed_at, now())
  WHERE id = p_assignment_id AND client_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found or not yours'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION client_cancel_assignment TO authenticated;

NOTIFY pgrst, 'reload schema';
