-- ============================================================
-- Initial Schema Migration
-- ============================================================

-- 1. users（Supabase Auth と連携）
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 2. shift_types（シフト種別マスタ）
CREATE TABLE IF NOT EXISTS public.shift_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_time time,
  end_time time,
  is_overnight bool DEFAULT false,
  is_off bool DEFAULT false,
  color text,
  display_order int,
  created_at timestamptz DEFAULT now()
);

-- 3. staff_profiles（スタッフ情報）
CREATE TABLE IF NOT EXISTS public.staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  qualification text NOT NULL,
  role text NOT NULL DEFAULT '一般',
  work_start_time time NOT NULL,
  work_end_time time NOT NULL,
  max_night_shifts int DEFAULT 8,
  experience_years int DEFAULT 0,
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. shift_constraints（勤務制約マスタ：病棟単位で1レコード）
CREATE TABLE IF NOT EXISTS public.shift_constraints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_staff_per_shift jsonb,
  min_staff_weekend int DEFAULT 3,
  min_staff_bath_day int DEFAULT 4,
  max_consecutive_work_days int DEFAULT 5,
  min_rest_hours_after_night int DEFAULT 11,
  auto_insert_off_after_night bool DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

-- 5. bath_days（お風呂の日）
CREATE TABLE IF NOT EXISTS public.bath_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  month int NOT NULL,
  pattern text NOT NULL,
  day_of_week int,
  date int,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bath_days_year_month ON public.bath_days(year, month);

-- 6. staff_pair_constraints（スタッフペア制約）
CREATE TABLE IF NOT EXISTS public.staff_pair_constraints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id_a uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  staff_id_b uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  constraint_type text NOT NULL,
  shift_type_id uuid REFERENCES public.shift_types(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz DEFAULT now()
);

-- 7. leave_requests（勤務希望）
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  type text,
  preferred_shift_type_id uuid REFERENCES public.shift_types(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_staff_date ON public.leave_requests(staff_id, date);

-- 8. schedule_months（月次スケジュールヘッダー）
CREATE TABLE IF NOT EXISTS public.schedule_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  month int NOT NULL,
  status text DEFAULT 'draft',
  generated_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(year, month)
);

-- 9. shift_assignments（シフト割り当て）
CREATE TABLE IF NOT EXISTS public.shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_month_id uuid NOT NULL REFERENCES public.schedule_months(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  shift_type_id uuid NOT NULL REFERENCES public.shift_types(id) ON DELETE RESTRICT,
  is_auto_generated bool DEFAULT true,
  note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(schedule_month_id, staff_id, date)
);

CREATE INDEX IF NOT EXISTS idx_shift_assignments_month ON public.shift_assignments(schedule_month_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_staff ON public.shift_assignments(staff_id);
CREATE INDEX IF NOT EXISTS idx_shift_assignments_date ON public.shift_assignments(date);

-- ============================================================
-- RLS（Row Level Security）
-- 認証済みユーザー（管理者）は全テーブルに全操作可能
-- ============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bath_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_pair_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON public.users FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.shift_types FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.staff_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.shift_constraints FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.bath_days FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.staff_pair_constraints FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.leave_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.schedule_months FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.shift_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- shift_types 初期データ
-- ============================================================

INSERT INTO public.shift_types (name, start_time, end_time, is_overnight, is_off, color, display_order) VALUES
  ('早番', '07:00', '16:00', false, false, '#60A5FA', 1),
  ('日勤', '08:30', '17:30', false, false, '#34D399', 2),
  ('遅番', '11:00', '20:00', false, false, '#FBBF24', 3),
  ('夜勤', '16:30', '09:00', true,  false, '#A78BFA', 4),
  ('明け', NULL,    NULL,    false, true,  '#94A3B8', 5),
  ('公休', NULL,    NULL,    false, true,  '#94A3B8', 6),
  ('有給', NULL,    NULL,    false, true,  '#F472B6', 7),
  ('その他', NULL,  NULL,    false, true,  '#94A3B8', 8),
  ('希望休', NULL,  NULL,    false, true,  '#FB923C', 9)
ON CONFLICT DO NOTHING;

-- shift_constraints 初期レコード（病棟単位で1件）
INSERT INTO public.shift_constraints (
  min_staff_per_shift,
  min_staff_weekend,
  min_staff_bath_day,
  max_consecutive_work_days,
  min_rest_hours_after_night,
  auto_insert_off_after_night
) VALUES (
  '{"早番": 2, "日勤": 3, "遅番": 2, "夜勤": 2}',
  3,
  4,
  5,
  11,
  true
) ON CONFLICT DO NOTHING;
