// Ponte entre o site e o robô de Miami (miami-agent). O token nunca vai pro
// navegador: todas as chamadas passam por estas server functions.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const id = z.string().trim().min(1).max(128).regex(/^[\w:.-]+$/);
const apiId = z.string().trim().regex(/^\d{4,12}$/);
const apiHash = z.string().trim().min(16).max(128);
const session = z.string().min(20).max(16_384);
const phone = z.string().trim().min(7).max(24).regex(/^\+?[0-9 ()-]+$/);
const groupInput = z.string().trim().min(1).max(512);
const message = z.string().min(1).max(4_096);

type AgentInit = {
  method: string;
  body?: unknown;
  query?: Record<string, string>;
  /** Tempo máximo por tentativa. */
  timeoutMs?: number;
  /** Retentativas extras (só em chamadas seguras de repetir). */
  retries?: number;
};

const AUTH_FATAL_RE = /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/i;

async function agentFetch(pathname: string, init: AgentInit) {
  const base = process.env.MIAMI_AGENT_URL;
  const token = process.env.MIAMI_AGENT_TOKEN;
  if (!base || !token) return { error: "agent_not_configured" as const };

  const baseUrl = new URL(base);
  if ((baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") || baseUrl.username || baseUrl.password) {
    console.error("MIAMI_AGENT_URL inválida");
    return { error: "agent_not_configured" as const };
  }
  const primaryUrl = new URL(pathname, baseUrl);
  if (primaryUrl.origin !== baseUrl.origin) return { error: "agent_not_configured" as const };
  for (const [k, v] of Object.entries(init.query ?? {})) primaryUrl.searchParams.set(k, v);

  // Todos os endereços abaixo são derivados do host já configurado, portanto
  // não ampliam os destinos permitidos pela ponte:
  // 1) HTTPS por nome sslip.io (resolve para o mesmo IP) — preferido;
  // 2) a URL configurada; 3) a porta HTTP padrão quando a configurada é 8787/8080.
  // Aceita IP puro e nomes com o IP dentro (a.b.c.d.nip.io / a-b-c-d.sslip.io).
  const urls: URL[] = [];
  const ipv4 =
    /^(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?:\.(?:nip|sslip)\.io)?$/.exec(baseUrl.hostname);
  if (ipv4 && ipv4.slice(1).every((o) => Number(o) <= 255)) {
    const httpsUrl = new URL(primaryUrl);
    httpsUrl.protocol = "https:";
    httpsUrl.hostname = `${ipv4.slice(1).join("-")}.sslip.io`;
    httpsUrl.port = "";
    if (httpsUrl.href !== primaryUrl.href) urls.push(httpsUrl);
  }
  urls.push(primaryUrl);
  if (baseUrl.port === "8787" || baseUrl.port === "8080") {
    const standardUrl = new URL(primaryUrl);
    standardUrl.protocol = "http:";
    standardUrl.port = "";
    urls.push(standardUrl);
  }

  const timeoutMs = init.timeoutMs ?? 20_000;
  const retries = Math.max(0, init.retries ?? 0);
  let lastDetail = "";
  // Orçamento total da chamada (todas as tentativas somadas), pra tela nunca
  // ficar girando: no máximo o tempo de uma tentativa + 5s.
  const deadline = Date.now() + timeoutMs + 5_000;

  const attempts = (retries + 1) * urls.length;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const url = urls[attempt % urls.length];
    if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(400 * attempt, 1_500)));
    const remaining = deadline - Date.now();
    if (remaining < 1_000) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
    try {
      const res = await fetch(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`[miami] ${pathname} falhou [${res.status}]: ${text}`);
        if (AUTH_FATAL_RE.test(text)) {
          return { error: "telegram_auth_invalid" as const, status: res.status };
        }
        // 5xx costuma ser o robô reiniciando: vale outra tentativa.
        if (res.status >= 500 && attempt + 1 < attempts) {
          lastDetail = `http_${res.status}`;
          continue;
        }
        // Repassa o motivo real (ex.: PHONE_NUMBER_INVALID) sem vazar detalhes internos.
        let detail = "";
        try {
          const j = JSON.parse(text) as { error?: unknown };
          const m = String(j?.error ?? "").match(/[A-Z][A-Z0-9_]{3,}/);
          detail = m ? m[0] : "";
        } catch { /* ignora */ }
        return { error: (detail || "agent_error") as string, status: res.status };
      }
      try {
        return JSON.parse(text);
      } catch {
        console.error(`[miami] ${pathname} resposta não-JSON: ${text.slice(0, 200)}`);
        return { error: "agent_bad_response" as const };
      }
    } catch (e) {
      lastDetail = String((e as Error)?.message ?? e);
      console.error(`[miami] ${pathname} inacessível (tentativa ${attempt + 1}): ${lastDetail}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: "agent_unreachable" as const, detail: lastDetail.slice(0, 200) };
}

/** Estado do robô: contas registradas e latência de cada uma. */
export const miamiHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => agentFetch("/health", { method: "GET", timeoutMs: 12_000, retries: 1 }));

/** Confirma se uma conta deste usuário já está conectada no agente. */
export const miamiAccountStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ clientId: id }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return agentFetch("/accounts/status", {
      method: "POST",
      timeoutMs: 25_000,
      retries: 2,
      body: { clientId: `${userId}::${data.clientId}` },
    });
  });

/** Lista os grupos da conta usando a sessão que vive no servidor de Miami. */
export const miamiListGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ clientId: id }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return agentFetch("/accounts/dialogs", {
      method: "POST",
      timeoutMs: 40_000,
      retries: 1,
      body: { clientId: `${userId}::${data.clientId}` },
    });
  });

/** Resolve um grupo por link/@usuário/id usando a sessão de Miami. */
export const miamiResolveGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ clientId: id, input: groupInput }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return agentFetch("/accounts/resolve", {
      method: "POST",
      timeoutMs: 30_000,
      retries: 1,
      body: { input: data.input, clientId: `${userId}::${data.clientId}` },
    });
  });

/** Foto de um grupo (a sessão vive no servidor de Miami). */
export const miamiGroupPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ clientId: id, input: groupInput }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return agentFetch("/accounts/photo", {
      method: "POST",
      timeoutMs: 30_000,
      retries: 1,
      body: { input: data.input, clientId: `${userId}::${data.clientId}` },
    });
  });


/** Sobe a sessão de uma conta pro robô (fica quente e pronta pra disparar). */
export const miamiRegisterAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ clientId: id, apiId, apiHash, session }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return agentFetch("/accounts", {
      method: "POST",
      timeoutMs: 60_000,
      retries: 1,
      body: { ...data, clientId: `${userId}::${data.clientId}` },
    });
  });

/** Manda o robô monitorar um grupo e enviar assim que abrir (ou na hora certa). */
export const miamiStartJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jobId: id, clientId: id, group: groupInput, message, targetMs: z.number().int().nonnegative().max(4_102_444_800_000).optional(), method: z.enum(["abertura", "mensagem", "abertura2"]).optional() }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return agentFetch("/jobs", {
      method: "POST",
      timeoutMs: 30_000,
      body: {
        ...data,
        jobId: `${userId}::${data.jobId}`,
        clientId: `${userId}::${data.clientId}`,
      },
    });
  });

export const miamiStopJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jobId: id }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return agentFetch("/jobs", { method: "DELETE", timeoutMs: 20_000, retries: 1, query: { jobId: `${userId}::${data.jobId}` } });
  });

/** Login da conta feito no servidor de Miami (o Telegram registra o IP de lá). */
export const miamiSendCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ clientId: id, apiId, apiHash, phone }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return agentFetch("/auth/send-code", {
      method: "POST",
      timeoutMs: 25_000,
      body: { ...data, clientId: `${userId}::${data.clientId}` },
    });
  });

export const miamiResendCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ clientId: id }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return agentFetch("/auth/resend-code", {
      method: "POST",
      timeoutMs: 25_000,
      body: { clientId: `${userId}::${data.clientId}` },
    });
  });

export const miamiSignIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ clientId: id, code: z.string().trim().min(1).max(16), phoneCodeHash: z.string().max(512).optional(), password: z.string().max(256).optional() }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return agentFetch("/auth/sign-in", {
      method: "POST",
      timeoutMs: 60_000,
      body: { ...data, clientId: `${userId}::${data.clientId}` },
    });
  });

/** Logs do robô pro painel. */
export const miamiEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ since: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).transform((d) => ({ since: d.since ?? 0 })))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const out = await agentFetch("/events", { method: "GET", timeoutMs: 15_000, query: { since: String(data.since) } });
    if ((out as { events?: { jobId: string }[] }).events) {
      const o = out as { events: { jobId: string }[] };
      o.events = o.events
        .filter((e) => e.jobId.startsWith(`${userId}::`))
        .map((e) => ({ ...e, jobId: e.jobId.slice(userId.length + 2) }));
    }
    return out;
  });

/** Remove do robô as contas deste usuário cujo login o Telegram encerrou. */
export const miamiPruneAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const r = (await agentFetch("/accounts/prune", {
      method: "POST",
      timeoutMs: 30_000,
      body: { prefix: `${userId}::` },
    })) as { ok?: boolean; removed?: string[]; error?: string };
    if (!r?.ok) return { ok: false as const, removed: [] as string[] };
    const prefix = `${userId}::`;
    return {
      ok: true as const,
      removed: (r.removed ?? []).filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length)),
    };
  });

/** IDs das contas deste usuário que estão ativas no robô. */
export const miamiActiveAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const r = (await agentFetch("/health", { method: "GET", timeoutMs: 12_000, retries: 1 })) as {
      ok?: boolean;
      accounts?: string[];
    };
    if (!r?.ok) return { ok: false as const, ids: [] as string[] };
    const prefix = `${userId}::`;
    return {
      ok: true as const,
      ids: (r.accounts ?? []).filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length)),
    };
  });

/** DC da conta, DC/membros dos grupos e tempo de resposta (só leitura). */
export const miamiAccountInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ clientId: id, groups: z.array(groupInput).max(12) }))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    return agentFetch("/accounts/info", {
      method: "POST",
      timeoutMs: 20_000,
      body: { clientId: `${userId}::${data.clientId}`, groups: data.groups },
    }) as Promise<{
      ok?: boolean;
      active?: boolean;
      accountDc?: number;
      country?: string;
      rtt?: number | null;
      groups?: Record<string, { dc: number | null; members: number | null }>;
      error?: string;
    }>;
  });
