-- 043_assignment_revert.sql
-- 회원이 본인이 완료/탈주 표시한 숙제·징역을 다시 미완료(in_progress)로 되돌리기.
-- 실수로 표시했거나, 마음 바꿨을 때.

CREATE OR REPLACE FUNCTION client_revert_assignment_completion(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing_payload jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT payload INTO v_existing_payload FROM workout_assignments
    WHERE id = p_assignment_id AND client_id = v_uid;
  IF v_existing_payload IS NULL THEN RAISE EXCEPTION 'assignment not found or not yours'; END IF;

  -- payload 의 outcome / actual_minutes 도 클리어 (남아있으면 혼동 유발)
  UPDATE workout_assignments
  SET status = 'in_progress',
      completed_at = NULL,
      payload = v_existing_payload - 'outcome' - 'actual_minutes' - 'actual_cardio_type'
  WHERE id = p_assignment_id AND client_id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION client_revert_assignment_completion TO authenticated;

NOTIFY pgrst, 'reload schema';
