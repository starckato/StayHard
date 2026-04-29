-- 027_trainer_meal_photo_read.sql
-- 트레이너가 활성 클라의 식단 사진 (storage.objects bucket=meal-photos) 을
-- SELECT 가능하도록 RLS 추가. 졸업 시 자동 회수.
--
-- 사용자 보고: trainer.html 에서 식단 사진 깨져 안 보임.
-- 원인: storage.objects 정책이 본인 사진만 SELECT 허용. 트레이너 미허용.

-- 트레이너가 활성 관계 클라의 meal-photos SELECT 가능
DROP POLICY IF EXISTS "Trainer reads active client meal photos" ON storage.objects;
CREATE POLICY "Trainer reads active client meal photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'meal-photos'
    AND EXISTS (
      SELECT 1 FROM trainer_clients tc
      WHERE tc.trainer_id = auth.uid()
        AND tc.client_id::text = (storage.foldername(name))[2]
        AND tc.status = 'active'
    )
  );
