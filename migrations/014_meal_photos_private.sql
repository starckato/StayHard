-- Migration: 014_meal_photos_private.sql
-- Privacy: meal-photos bucket was public — anyone with the URL could view
-- anyone's meal photo. Switch to private + per-user folder RLS (same pattern
-- as workout-videos). Client will use createSignedUrl with short expiry
-- instead of getPublicUrl. Existing photos remain readable by their owner
-- (via signed URL) but strangers can no longer fetch them.

-- ── Flip bucket to private ──
UPDATE storage.buckets
SET public = false
WHERE id = 'meal-photos';

-- ── Drop the permissive public read policy ──
DROP POLICY IF EXISTS "Public read meal photos" ON storage.objects;

-- ── Per-user folder read policy ──
-- Path format: meals/<user_id>/<timestamp>.jpg
-- storage.foldername(name) returns array — [1]='meals', [2]=<user_id>
CREATE POLICY "Users read own meal photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'meal-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- INSERT policy already exists ("Users can upload own meal photos"); tighten
-- to match the folder pattern so users can't upload into another user's folder.
DROP POLICY IF EXISTS "Users can upload own meal photos" ON storage.objects;
CREATE POLICY "Users can upload own meal photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'meal-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- DELETE policy already matches this pattern; leave as-is.
