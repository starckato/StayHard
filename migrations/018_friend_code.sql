-- Migration: 018_friend_code.sql
-- Add profiles.friend_code — 8-char sharable unique code for friend requests.
--
-- Why: Friend discovery channel must be user-controlled (prevent stalking, PII
-- leaks). Email/username search is out. Code is 8-char uppercase alphanumeric,
-- ambiguous chars (0/O, 1/I/l) excluded → 32^8 ≈ 1.1 trillion combinations.
-- User can rotate their code if spammed (rotate_my_friend_code RPC).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS friend_code text UNIQUE;

-- Generator: 8-char code from curated 32-char alphabet (no 0/1/I/O/l).
CREATE OR REPLACE FUNCTION public.gen_friend_code() RETURNS text
  LANGUAGE plpgsql VOLATILE SET search_path=public AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  attempts int := 0;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..8 LOOP
      code := code || substr(alphabet, 1 + floor(random()*32)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE friend_code = code);
    attempts := attempts + 1;
    IF attempts > 10 THEN RAISE EXCEPTION 'friend_code generation failed after 10 attempts'; END IF;
  END LOOP;
  RETURN code;
END;
$$;

-- Backfill existing rows.
UPDATE public.profiles SET friend_code = gen_friend_code() WHERE friend_code IS NULL;

-- Auto-assign on insert.
CREATE OR REPLACE FUNCTION public.profiles_assign_friend_code() RETURNS trigger
  LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.friend_code IS NULL THEN
    NEW.friend_code := gen_friend_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_friend_code_before_insert ON public.profiles;
CREATE TRIGGER profiles_friend_code_before_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_assign_friend_code();

-- RPC: rotate code (spam escape hatch).
CREATE OR REPLACE FUNCTION public.rotate_my_friend_code() RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_code text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_code := gen_friend_code();
  UPDATE profiles SET friend_code = v_code WHERE id = auth.uid();
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_my_friend_code() FROM public;
REVOKE ALL ON FUNCTION public.rotate_my_friend_code() FROM anon;
GRANT EXECUTE ON FUNCTION public.rotate_my_friend_code() TO authenticated;

-- Index friendly — already covered by UNIQUE constraint on friend_code.

-- Verify:
-- SELECT count(*) filter (where friend_code is null) AS missing, count(*) AS total FROM profiles;
-- → missing should be 0
