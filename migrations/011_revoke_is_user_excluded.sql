-- Migration: 011_revoke_is_user_excluded.sql
-- Security fix: is_user_excluded() was granted to `authenticated`, letting any
-- logged-in user probe which UUIDs are flagged as internal/test accounts.
-- The function is only called from admin_dashboard() (which is itself
-- SECURITY DEFINER), so no external grant is needed.
--
-- Run AFTER 006_exclude_users_from_dashboard.sql.

REVOKE EXECUTE ON FUNCTION public.is_user_excluded(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_user_excluded(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_user_excluded(uuid) FROM public;

-- admin_dashboard() calls is_user_excluded() as SECURITY DEFINER, so the
-- function will continue to work from within that context without any
-- further grants. Direct client calls are now denied.
