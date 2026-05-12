-- shift_types テーブルに is_active と sort_order カラムを追加
ALTER TABLE public.shift_types
  ADD COLUMN IF NOT EXISTS is_active bool NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- 日勤・夜勤のマスタデータを投入（未存在の場合のみ）
INSERT INTO public.shift_types (name, is_overnight, is_off, is_active, sort_order, color)
SELECT '日勤', false, false, true, 1, '#3B82F6'
WHERE NOT EXISTS (SELECT 1 FROM public.shift_types WHERE name = '日勤');

INSERT INTO public.shift_types (name, is_overnight, is_off, is_active, sort_order, color)
SELECT '夜勤', true, false, true, 2, '#8B5CF6'
WHERE NOT EXISTS (SELECT 1 FROM public.shift_types WHERE name = '夜勤');
