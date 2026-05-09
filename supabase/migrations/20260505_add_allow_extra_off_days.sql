ALTER TABLE public.staff_profiles
  ADD COLUMN IF NOT EXISTS allow_extra_off_days bool NOT NULL DEFAULT true;
