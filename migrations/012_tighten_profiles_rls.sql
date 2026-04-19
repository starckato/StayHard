-- Migration: 012_tighten_profiles_rls.sql
-- CRITICAL security fix: `profiles` had a SELECT policy `USING (true)` for the
-- `public` role, meaning any caller (including unauthenticated users with the
-- anon key) could dump the entire profiles table — display_names, scores,
-- is_admin flags, is_excluded flags, goal, cheat counters, etc.
--
-- This migration:
-- 1. Drops the permissive `USING (true)` SELECT policy.
-- 2. Keeps own-profile reads via `authenticated USING (auth.uid() = id)`.
-- 3. Adds `get_public_profiles(uuid[])` — a SECURITY DEFINER RPC that returns
--    only safe public fields (id, display_name, username, total_score) for
--    the requested user IDs. Competition rooms use this instead of direct
--    SELECT to show other members' names.

-- ── Drop every existing profiles SELECT policy, rebuild cleanly ──
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='profiles' AND cmd='SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

-- Only authenticated users, only their own row.
CREATE POLICY profiles_select_self
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- ── RPC: get_public_profiles — safe cross-user lookup for comp rooms ──
CREATE OR REPLACE FUNCTION public.get_public_profiles(p_ids uuid[])
RETURNS TABLE(id uuid, display_name text, username text, total_score int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.username, COALESCE(p.total_score, 0) AS total_score
  FROM public.profiles p
  WHERE p.id = ANY(p_ids);
$$;

REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;

-- ── Verify: list remaining profiles policies ──
-- SELECT policyname, cmd, roles::text, qual::text FROM pg_policies
-- WHERE schemaname='public' AND tablename='profiles' ORDER BY cmd;
