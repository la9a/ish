CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_row public.auth_rate_limits%ROWTYPE;
  now_at timestamptz := now();
BEGIN
  IF length(p_key) < 3 OR length(p_key) > 300 OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate limit parameters';
  END IF;

  INSERT INTO public.auth_rate_limits AS limits (key, window_started_at, request_count, updated_at)
  VALUES (p_key, now_at, 1, now_at)
  ON CONFLICT (key) DO UPDATE SET
    window_started_at = CASE
      WHEN limits.window_started_at + make_interval(secs => p_window_seconds) <= now_at THEN now_at
      ELSE limits.window_started_at
    END,
    request_count = CASE
      WHEN limits.window_started_at + make_interval(secs => p_window_seconds) <= now_at THEN 1
      ELSE limits.request_count + 1
    END,
    updated_at = now_at
  RETURNING * INTO current_row;

  allowed := current_row.request_count <= p_limit;
  retry_after_seconds := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (current_row.window_started_at + make_interval(secs => p_window_seconds) - now_at)))::integer);
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) TO service_role;