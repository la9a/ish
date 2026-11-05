type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error("Rate limit unavailable", error.message);
    return { allowed: false, retryAfterSeconds: windowSeconds };
  }

  const row = data?.[0];
  return {
    allowed: row?.allowed === true,
    retryAfterSeconds: Math.max(0, Number(row?.retry_after_seconds ?? windowSeconds)),
  };
}

export async function requireRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const result = await consumeRateLimit(key, limit, windowSeconds);
  if (!result.allowed) {
    throw new Error(`Muitas tentativas. Aguarde ${result.retryAfterSeconds} segundos.`);
  }
}