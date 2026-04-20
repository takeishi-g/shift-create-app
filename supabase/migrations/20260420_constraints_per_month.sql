ALTER TABLE shift_constraints
  ADD COLUMN IF NOT EXISTS year_month text,
  ADD COLUMN IF NOT EXISTS target_off_days int NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS bath_days_of_week jsonb NOT NULL DEFAULT '[1,4]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_constraints_year_month
  ON shift_constraints(year_month)
  WHERE year_month IS NOT NULL;
