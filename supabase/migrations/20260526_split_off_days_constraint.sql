-- 新カラム追加
ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS hard_off_days_of_week jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS soft_off_days_of_week jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS hard_off_on_holidays boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS soft_off_on_holidays boolean NOT NULL DEFAULT false;

-- 既存データ移行（off_days_constraint の値に応じて振り分け）
UPDATE staff_profiles
  SET hard_off_days_of_week = CASE WHEN off_days_constraint = 'hard' THEN off_days_of_week ELSE '[]'::jsonb END,
      soft_off_days_of_week = CASE WHEN off_days_constraint = 'soft' THEN off_days_of_week ELSE '[]'::jsonb END,
      hard_off_on_holidays = CASE WHEN off_days_constraint = 'hard' THEN off_on_holidays ELSE false END,
      soft_off_on_holidays = CASE WHEN off_days_constraint = 'soft' THEN off_on_holidays ELSE false END;

-- 旧カラム削除
ALTER TABLE staff_profiles
  DROP COLUMN IF EXISTS off_days_of_week,
  DROP COLUMN IF EXISTS off_on_holidays,
  DROP COLUMN IF EXISTS off_days_constraint;
