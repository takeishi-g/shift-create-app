ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS off_days_constraint text NOT NULL DEFAULT 'hard'
  CHECK (off_days_constraint IN ('hard', 'soft'));
