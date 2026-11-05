ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS api_id bigint,
  ADD COLUMN IF NOT EXISTS api_hash text,
  ADD COLUMN IF NOT EXISTS tg_session text;