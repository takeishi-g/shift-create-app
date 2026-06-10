-- UPDATE ポリシーは意図的に除外。日付・名称の変更は DELETE + INSERT で行う運用とする
CREATE TABLE IF NOT EXISTS public.custom_holidays (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date        NOT NULL,
  name        text        NOT NULL DEFAULT '' CHECK (name <> ''),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_custom_holiday_date
  ON public.custom_holidays (date);

CREATE INDEX IF NOT EXISTS idx_custom_holidays_date
  ON public.custom_holidays (date);

ALTER TABLE public.custom_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can read custom_holidays"
  ON public.custom_holidays FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated users can insert custom_holidays"
  ON public.custom_holidays FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated users can delete custom_holidays"
  ON public.custom_holidays FOR DELETE
  TO authenticated USING (true);
