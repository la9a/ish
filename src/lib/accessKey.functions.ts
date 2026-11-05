import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

const LOCK_MS = 30 * 60 * 1000;

function clientIp(): string {
  const h = getRequest()?.headers;
  // Somente o endereço escrito pela borda é aceito. Cabeçalhos que o
  // navegador consegue forjar (x-forwarded-for / x-real-ip) são ignorados,
  // senão bastaria trocar o cabeçalho a cada tentativa para burlar o
  // bloqueio e o limite de tentativas.
  const cf = h?.get("cf-connecting-ip");
  return cf?.trim() || "unknown";
}

// Só usamos o IP como chave de bloqueio quando ele é um IP público real e
// identificável. Sem isso ("unknown", localhost, rede interna) o bloqueio
// viraria global e atingiria gente que não tem nada a ver.
function lockableIp(ip: string): string | null {
  if (!ip || ip === "unknown") return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|::1|fc|fd)/i.test(ip)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return null;
  const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
  const isV6 = ip.includes(":");
  if (!isV4 && !isV6) return null;
  return `ip:${ip}`;
}

function subjects(): string[] {
  const ip = lockableIp(clientIp());
  return ip ? [ip] : [];
}

async function readLock(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("auth_ip_locks").select("locked_until").in("ip", keys);
  const now = Date.now();
  let max = 0;
  for (const row of data ?? []) {
    const until = row.locked_until ? new Date(row.locked_until).getTime() : 0;
    if (until > now && until > max) max = until;
  }
  return max;
}

// Detecção de VPN / proxy / datacenter. Usa proxycheck.io (chave opcional em
// PROXYCHECK_KEY). Quando o serviço não responde devolvemos "unknown" — o
// chamador aperta o limite de tentativas em vez de deixar a proteção sumir.
type ProxyVerdict = "yes" | "no" | "unknown";

async function proxyVerdict(ip: string): Promise<ProxyVerdict> {
  if (!ip || ip === "unknown") return "no";
  if (/^(127\.|10\.|192\.168\.|::1)/.test(ip)) return "no";
  const key = process.env["PROXYCHECK_KEY"];
  const url =
    `https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=3&asn=0&risk=0` +
    (key ? `&key=${encodeURIComponent(key)}` : "");
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return "unknown";
    const json = (await res.json()) as Record<string, any>;
    const entry = json?.[ip];
    if (!entry) return "unknown";
    const proxy = String(entry.proxy ?? "no").toLowerCase() === "yes";
    const type = String(entry.type ?? "").toLowerCase();
    return proxy || type === "vpn" || type === "tor" || type === "hosting" ? "yes" : "no";
  } catch {
    return "unknown";
  }
}

async function isProxyOrVpn(ip: string): Promise<boolean> {
  return (await proxyVerdict(ip)) === "yes";
}

export const getAccessLock = createServerFn({ method: "GET" }).handler(async () => {
  const ip = clientIp();
  const keys = subjects();
  if (keys.length === 0) return { remainingMs: 0, vpn: false };
  const { consumeRateLimit } = await import("@/lib/rateLimit.server");
  const rate = await consumeRateLimit(`lock-check:${keys[0]}`, 30, 60);
  if (!rate.allowed) return { remainingMs: rate.retryAfterSeconds * 1000, vpn: false };
  const until = await readLock(keys);
  const vpn = until ? false : await isProxyOrVpn(ip);
  return { remainingMs: until ? until - Date.now() : 0, vpn };
});

// Login por chave de acesso. Cada chave (guardada como segredo do backend)
// leva a uma conta específica. O navegador nunca vê as chaves.

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a.padEnd(256, "\0").slice(0, 256));
  const right = enc.encode(b.padEnd(256, "\0").slice(0, 256));
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0 && a.length === b.length;
}

export const loginWithAccessKey = createServerFn({ method: "POST" })
  .inputValidator((input: { key: string }) => ({
    key: String(input?.key ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    const ip = clientIp();
    const keys = subjects();
    const { consumeRateLimit } = await import("@/lib/rateLimit.server");
    const globalRate = await consumeRateLimit("login:global", 120, 60);
    if (!globalRate.allowed) {
      return {
        ok: false as const,
        error: "Serviço temporariamente ocupado.",
        remainingMs: globalRate.retryAfterSeconds * 1000,
        vpn: false,
      };
    }
    // Sem IP público identificável não há bloqueio por rede: nesse caso o
    // limite de tentativas é bem mais apertado, para não virar porta aberta.
    const rateKey = keys[0] ?? "no-ip";
    const rate = await consumeRateLimit(`login:${rateKey}`, keys.length ? 6 : 3, 60);
    if (!rate.allowed) {
      return {
        ok: false as const,
        error: "Muitas tentativas.",
        remainingMs: rate.retryAfterSeconds * 1000,
        vpn: false,
      };
    }
    const existing = await readLock(keys);
    if (existing) {
      return {
        ok: false as const,
        error: "Acesso bloqueado.",
        remainingMs: existing - Date.now(),
        vpn: false,
      };
    }

    const verdict = await proxyVerdict(ip);
    if (verdict === "yes") {
      return { ok: false as const, error: "Rede não permitida.", remainingMs: 0, vpn: true };
    }
    if (verdict === "unknown") {
      // Checagem de VPN indisponível: em vez de liberar geral, aperta muito
      // o limite de tentativas nessa rede enquanto o serviço não volta.
      const strict = await consumeRateLimit(`login-novpncheck:${rateKey}`, 3, 900);
      if (!strict.allowed) {
        return {
          ok: false as const,
          error: "Muitas tentativas.",
          remainingMs: strict.retryAfterSeconds * 1000,
          vpn: false,
        };
      }
    }

    const lockNow = async () => {
      const until = Date.now() + LOCK_MS;
      const stamp = new Date().toISOString();
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("auth_ip_locks")
        .upsert(
          keys.map((k) => ({
            ip: k,
            locked_until: new Date(until).toISOString(),
            updated_at: stamp,
          })),
        );
      return { ok: false as const, error: "Acesso bloqueado.", remainingMs: LOCK_MS, vpn: false };
    };

    const fail = lockNow;
    if (!data.key || data.key.length > 200) return await fail();

    const map: Array<{ secret: string | undefined; email: string }> = [
      { secret: process.env["ACCESS_KEY_RONEI"], email: "ronei@app.local" },
      { secret: process.env["ACCESS_KEY_PEDRO"], email: "pedro@app.local" },
    ];

    const hit = map.find((m) => m.secret && safeEqual(m.secret, data.key));
    if (!hit) return await fail();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const link = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: hit.email,
    });
    const hashed = link.data?.properties?.hashed_token;
    if (link.error || !hashed) return await fail();

    const verified = await supabaseAdmin.auth.verifyOtp({
      type: "magiclink",
      token_hash: hashed,
    });
    const session = verified.data?.session;
    if (verified.error || !session) return await fail();

    return {
      ok: true as const,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    };
  });
