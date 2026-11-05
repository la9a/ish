ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'semanal',
  ADD COLUMN IF NOT EXISTS biweekly_anchor bigint,
  ADD COLUMN IF NOT EXISTS monthly_days integer[],
  ADD COLUMN IF NOT EXISTS schedule_overrides jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clients_frequency_check'
      AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_frequency_check
      CHECK (frequency IN ('diaria', 'semanal', 'quinzenal', 'mensal'));
  END IF;
END $$;

UPDATE public.clients
SET frequency = 'semanal'
WHERE frequency IS NULL;