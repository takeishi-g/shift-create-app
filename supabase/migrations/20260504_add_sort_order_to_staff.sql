-- staff_profiles に sort_order カラムを追加
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS sort_order integer;

-- 既存レコードに created_at 順で sort_order を設定
UPDATE staff_profiles
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY is_active ORDER BY created_at) AS rn
  FROM staff_profiles
) sub
WHERE staff_profiles.id = sub.id;

-- NOT NULL 制約を付与（初期値設定後）
ALTER TABLE staff_profiles ALTER COLUMN sort_order SET NOT NULL;
ALTER TABLE staff_profiles ALTER COLUMN sort_order SET DEFAULT 0;
