-- schedule_months に year_month / confirmed_at を追加
ALTER TABLE public.schedule_months
  ADD COLUMN IF NOT EXISTS year_month text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- 既存レコードの year_month を year/month から生成
UPDATE public.schedule_months
SET year_month = CONCAT(year::text, '-', LPAD(month::text, 2, '0'))
WHERE year_month IS NULL;

-- year_month の UNIQUE インデックス
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_months_year_month
  ON public.schedule_months(year_month)
  WHERE year_month IS NOT NULL;

-- shift_assignments に shift_code / is_bath_day を追加
ALTER TABLE public.shift_assignments
  ADD COLUMN IF NOT EXISTS shift_code text,
  ADD COLUMN IF NOT EXISTS is_bath_day bool NOT NULL DEFAULT false;

-- shift_type_id を nullable に変更（shift_code で代替）
ALTER TABLE public.shift_assignments
  ALTER COLUMN shift_type_id DROP NOT NULL;
