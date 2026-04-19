-- Migration: 010_profiles_goal_column.sql
-- Persist onboarding goal on profile (diet / muscle / habit). Populated by
-- obSelectGoal() in the client. Status Band + future copy can branch on this.
--
-- Run anytime after 001_competition_recent_activity.sql.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS goal text
  CHECK (goal IS NULL OR goal IN ('diet','muscle','habit'));

CREATE INDEX IF NOT EXISTS profiles_goal_idx ON public.profiles (goal) WHERE goal IS NOT NULL;
