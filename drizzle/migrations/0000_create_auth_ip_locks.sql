CREATE TABLE public.auth_ip_locks (
  ip text PRIMARY KEY,
  locked_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.auth_ip_locks TO service_role;

ALTER TABLE public.auth_ip_locks ENABLE ROW LEVEL SECURITY;