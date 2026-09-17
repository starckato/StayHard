-- 055 · profiles.max_hr — 러닝 대시보드 Zone2 판정 기준 (2026-09-17)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS max_hr int
  CHECK (max_hr IS NULL OR (max_hr BETWEEN 120 AND 230));
COMMENT ON COLUMN public.profiles.max_hr IS 'Zone2 판정용 최대심박 (러닝 대시보드에서 직접 입력)';
