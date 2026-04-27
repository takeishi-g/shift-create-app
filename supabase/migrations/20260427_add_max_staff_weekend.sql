ALTER TABLE shift_constraints
  ADD COLUMN IF NOT EXISTS max_staff_weekend integer NOT NULL DEFAULT 4;
