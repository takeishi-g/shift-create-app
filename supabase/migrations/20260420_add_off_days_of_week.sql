ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS off_days_of_week jsonb NOT NULL DEFAULT '[]'::jsonb;
