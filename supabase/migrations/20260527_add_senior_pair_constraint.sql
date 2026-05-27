ALTER TABLE public.staff_pair_constraints
  ADD CONSTRAINT check_constraint_type
  CHECK (constraint_type IN ('must_pair', 'must_not_pair', 'senior_pair'));

ALTER TABLE public.staff_pair_constraints
  ADD CONSTRAINT unique_staff_pair_constraint_type
  UNIQUE (staff_id_a, staff_id_b, constraint_type);

CREATE INDEX IF NOT EXISTS idx_staff_pair_constraints_type
  ON public.staff_pair_constraints (constraint_type);
