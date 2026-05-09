ALTER TABLE shift_constraints
  ADD COLUMN IF NOT EXISTS max_staff_per_shift JSONB NOT NULL DEFAULT '{}';
