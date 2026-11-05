// Ponte cliente → robô de Miami. Quando o robô está configurado e saudável,
// ele assume o disparo (fica no mesmo datacenter do Telegram, rede ~10ms) e o
// navegador só acompanha os logs. O envio não volta silenciosamente ao
// navegador, pois isso mudaria o IP/dispositivo e criaria corrida duplicada.

import {
  miamiHealth,
  miamiAccountStatus,
  miamiRegisterAccount,
  miamiListGroups,
  miamiResolveGroup,
  miamiGroupPhoto,
  miamiStartJob,
  miamiStopJob,
  miamiEvents,
  miamiSendCode,
  miamiResendCode,
  miamiSignIn,
} from "@/lib/miamiAgent.functions";
import { clientData, clientsStore, type MonitoredGroup } from "@/lib/storage";

export type BridgeLog = (
  level: "info" | "success" | "warn" | "error",
  msg: string,
  opts?: { key?: string; pending?: boolean },
) => void;

/** Atualiza uma linha já publicada (senha apurada depois no servidor). */
export type BridgePatch = (key: string, msg: string, pending: boolean) => void;

// `armed` guarda IDs únicos por execução. O mesmo grupo pode ser iniciado
// várias vezes, então reutilizar `${clientId}:${groupId}` faria o painel
// reproduzir confirmações antigas ainda presentes no histórico do agente.
const armed = new Set<string>();
const armedByGroup = new Map<string, string>(); // chave lógica → jobId único
const labels = new Map<string, string>(); // jobId → rótulo pro log
const registered = new Set<string>(); // contas já registradas nesta aba
const registering = new Map<string, Promise<boolean>>(); // evita conexões duplicadas da mesma conta
const doneJobs = new Set<string>(); // jobs que já enviaram
// Jobs cuja senha ainda está sendo apurada no VPS — o polling continua vivo
// mesmo após a parada automática, só pra receber o texto final.
const awaitingPatch = new Set<string>();
const pendingText = new Map<string, string>(); // jobId → texto já exibido
const jobClients = new Map<string, string>(); // jobId → conta dona do monitoramento
let allDoneCb: (() => void) | null = null;

let pollHandle: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
let since = 0;
let logSink: BridgeLog | null = null;
let patchSink: BridgePatch | null = null;
let agentUsable: boolean | null = null;
let agentCheckedAt = 0;
let agentReason = "";
const AGENT_RECHECK_MS = 6_000; // não trava em "fora do ar": tenta de novo
// Se o VPS não devolver a senha de um envio, a linha não pode ficar carregando
// pra sempre — cada job pendente tem um prazo próprio.
const patchTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PATCH_TIMEOUT_MS = 120_000;

/** Traduz os códigos do robô pra algo que o usuário entenda. */
function friendlyReason(reason: string): string {
  const r = String(reason || "");
  if (/agent_unreachable|abort|timeout|network|fetch failed/i.test(r)) return "o servidor demorou a responder";
  if (/agent_not_configured/i.test(r)) return "servidor não configurado";
  if (/agent_bad_response|agent_error/i.test(r)) return "o servidor respondeu com erro";
  if (/PEER_ID_INVALID|CHANNEL_INVALID|CHAT_ID_INVALID|group_unreachable|group_not_found/i.test(r))
    return "esta conta não tem acesso a esse grupo";
  if (/401|unauthor/i.test(r)) return "sessão do site expirada — entre de novo";
  return r || "sem detalhes";
}

function key(clientId: string, groupId: string) {
  return `${clientId}:${groupId}`;
}

/** True quando o robô de Miami assumiu o disparo desse grupo. */
export function isAgentArmed(clientId: string, groupId: string): boolean {
  return armedByGroup.has(key(clientId, groupId));
}

export function agentHasAnyJob(): boolean {
  return armed.size > 0;
}

async function agentAvailable(): Promise<boolean> {
  const now = Date.now();
  if (agentUsable === true) return true;
  if (agentUsable === false && now - agentCheckedAt < AGENT_RECHECK_MS) return false;
  agentCheckedAt = now;
  try {
    const h = (await miamiHealth()) as { ok?: boolean; error?: string; detail?: string };
    agentUsable = !!h?.ok;
    agentReason = h?.ok ? "" : friendlyReason(h?.detail ?? h?.error ?? "sem resposta");
  } catch (e) {
    agentUsable = false;
    const msg = String((e as Error)?.message ?? e);
    agentReason = friendlyReason(msg);
  }
  return agentUsable;
}

/** Força uma nova checagem na próxima tentativa. */
export function resetAgentCheck(): void {
  agentUsable = null;
  agentCheckedAt = 0;
}

function disconnectInvalidAccount(clientId: string): void {
  registered.delete(clientId);
  clientsStore.clearSessionOnly(clientId);
  clientsStore.update(clientId, { hasSession: false });
  try { window.dispatchEvent(new CustomEvent("cloud:changed")); } catch { /* SSR */ }
}

/** Login exclusivamente pelo servidor de Miami. */
export async function miamiLoginSendCode(opts: {
  clientId: string;
  apiId: string;
  apiHash: string;
  phone: string;
}): Promise<{ phoneCodeHash: string } | null> {
  let r: { ok?: boolean; phoneCodeHash?: string; error?: string };
  try {
    r = (await miamiSendCode({ data: opts })) as typeof r;
  } catch (e) {
    throw new Error(`Não foi possível enviar o código: ${friendlyLoginError(String((e as Error)?.message ?? e))}`);
  }
  if (!r?.ok || !r.phoneCodeHash) {
    throw new Error(`Não foi possível enviar o código: ${friendlyLoginError(r?.error ?? "send_code_not_confirmed")}`);
  }
  return { phoneCodeHash: r.phoneCodeHash };
}

function friendlyLoginError(code: string): string {
  const c = String(code || "");
  if (/PHONE_NUMBER_INVALID/i.test(c)) return "número de telefone inválido (use DDI, ex.: +5511999999999).";
  if (/PHONE_NUMBER_BANNED/i.test(c)) return "esse número foi banido pelo Telegram.";
  if (/PHONE_NUMBER_FLOOD|FLOOD_WAIT|FLOOD/i.test(c)) {
    const s = c.match(/FLOOD_WAIT_(\d+)/i)?.[1];
    return s ? `o Telegram pediu pra esperar ${Math.ceil(Number(s) / 60)} min antes de pedir outro código.` : "muitas tentativas; espere alguns minutos e tente de novo.";
  }
  if (/API_ID_INVALID|API_ID_PUBLISHED_FLOOD/i.test(c)) return "API ID ou API Hash incorretos. Confira em my.telegram.org.";
  if (/PHONE_CODE_EXPIRED/i.test(c)) return "o código expirou; peça um novo.";
  if (/PHONE_CODE_INVALID/i.test(c)) return "código incorreto.";
  if (/PASSWORD_HASH_INVALID/i.test(c)) return "senha de duas etapas incorreta.";
  if (/no_pending_auth/i.test(c)) return "o login expirou; peça o código de novo.";
  if (/agent_unreachable|agent_error|timeout|abort/i.test(c)) return "o servidor de Miami não respondeu; tente de novo em alguns segundos.";
  return friendlyReason(c);
}

export async function miamiLoginResendCode(clientId: string): Promise<{ phoneCodeHash: string } | null> {
  try {
    const r = (await miamiResendCode({ data: { clientId } })) as { ok?: boolean; phoneCodeHash?: string };
    if (!r?.ok) throw new Error((r as { error?: string })?.error ?? "");
    return { phoneCodeHash: r.phoneCodeHash ?? "" };
  } catch (e) {
    throw new Error(`Não foi possível reenviar o código: ${friendlyLoginError(String((e as Error)?.message ?? e))}`);
  }
}

/** Conclui o login em Miami. Devolve a string session pro site guardar. */
export async function miamiLoginSignIn(opts: {
  clientId: string;
  code: string;
  phoneCodeHash?: string;
  password?: string;
}): Promise<{ session: string; me?: { id?: number; username?: string | null; name?: string | null } } | "2FA_REQUIRED" | null> {
  let r: { ok?: boolean; session?: string; error?: string; me?: { id?: number; username?: string | null; name?: string | null } };
  try {
    r = (await miamiSignIn({ data: opts })) as typeof r;
  } catch (e) {
    throw new Error(`Não foi possível confirmar o login em Miami: ${String((e as Error)?.message ?? e)}`);
  }
  if (r?.error === "2FA_REQUIRED") return "2FA_REQUIRED";
  if (!r?.ok || !r.session) {
    if (r?.error) throw new Error(friendlyLoginError(r.error));
    return null;
  }
  registered.add(opts.clientId);
  return { session: r.session, me: r.me };
}

export async function isMiamiAccountActive(clientId: string): Promise<boolean> {
  try {
    const status = (await miamiAccountStatus({ data: { clientId } })) as { ok?: boolean; active?: boolean; error?: string };
    agentCheckedAt = Date.now();
    agentUsable = status?.ok === true;
    agentReason = status?.ok ? "" : friendlyReason(status?.error ?? "sem resposta");
    if (status?.active) registered.add(clientId);
    else registered.delete(clientId);
    return !!status?.active;
  } catch {
    agentCheckedAt = Date.now();
    agentUsable = false;
    registered.delete(clientId);
    return false;
  }
}

export async function ensureMiamiAccount(clientId: string, log?: BridgeLog, forceVerify = false): Promise<boolean> {
  if (registered.has(clientId) && !forceVerify) return true;
  const current = registering.get(clientId);
  if (current) return current;

  const task = (async () => {
    try {
      // A própria consulta da conta também confirma que a VPS está online.
      // Isso evita a chamada /health anterior e reduz uma viagem site ↔ Miami.
      const status = (await miamiAccountStatus({ data: { clientId } })) as {
        ok?: boolean;
        active?: boolean;
        error?: string;
      };
      agentCheckedAt = Date.now();
      agentUsable = status?.ok === true;
      agentReason = status?.ok ? "" : friendlyReason(status?.error ?? "sem resposta");
      if (!status?.ok) {
        log?.("error", `Turbo Miami indisponível (${agentReason}). Tente iniciar de novo em alguns segundos.`);
        return false;
      }
      if (status.active) {
        registered.add(clientId);
        return true;
      }

      const creds = clientData.getCreds(clientId);
      const savedSession = clientData.getSession(clientId);
      if (!creds?.apiId || !creds?.apiHash) {
        log?.("error", "Turbo Miami: conta sem API ID/Hash salvos.");
        return false;
      }
      if (!savedSession || savedSession.length < 20) {
        log?.("error", "Turbo Miami: sessão da conta não encontrada. Reconecte a conta pelo cadastro.");
        return false;
      }
      const res = (await miamiRegisterAccount({
        data: {
          clientId,
          apiId: String(creds.apiId),
          apiHash: String(creds.apiHash),
          session: savedSession,
        },
      })) as { ok?: boolean; error?: string };
      if (!res?.ok) {
        if (res?.error === "telegram_auth_invalid") {
          disconnectInvalidAccount(clientId);
          const title = clientsStore.get(clientId)?.title ?? clientId;
          log?.("error", `${title}; Telegram API error 401: O usuário não está conectado.`);
          return false;
        }
        log?.("error", `Turbo Miami: servidor recusou a conta (${friendlyReason(res?.error ?? "erro")}).`);
        return false;
      }
      registered.add(clientId);
      log?.("success", "Turbo Miami: conta conectada no servidor de Miami.");
      return true;
    } catch (e) {
      agentCheckedAt = Date.now();
      agentUsable = false;
      log?.("error", `Turbo Miami indisponível (${friendlyReason(String((e as Error)?.message ?? e))}).`);
      return false;
    }
  })().finally(() => registering.delete(clientId));

  registering.set(clientId, task);
  return task;
}

export type MiamiGroup = {
  id: string;
  name: string;
  isChannel: boolean;
  username?: string | null;
  chatType?: string;
  archived?: boolean;
  draft?: string;
  photoUrl?: string | null;
};

/** Lista os grupos da conta usando a sessão que vive no servidor de Miami. */
export async function miamiGroups(clientId: string): Promise<MiamiGroup[] | null> {
  if (!(await ensureMiamiAccount(clientId))) return null;
  try {
    const r = (await miamiListGroups({ data: { clientId } })) as {
      ok?: boolean;
      groups?: MiamiGroup[];
      error?: string;
    };
    if (!r?.ok || !Array.isArray(r.groups)) return null;
    return r.groups;
  } catch {
    return null;
  }
}

/** True quando a conta está conectada no servidor de Miami. */
export async function isMiamiOwned(clientId: string): Promise<boolean> {
  if (registered.has(clientId)) return true;
  return isMiamiAccountActive(clientId);
}

/** Resolve um grupo por link/@usuário/id no servidor de Miami. */
export async function miamiResolve(clientId: string, input: string): Promise<MiamiGroup | null> {
  if (!(await ensureMiamiAccount(clientId))) return null;
  const r = (await miamiResolveGroup({ data: { clientId, input } })) as {
    ok?: boolean;
    group?: MiamiGroup;
    error?: string;
    detail?: string;
  };
  if (r?.ok && r.group) return r.group;
  throw new Error(
    `Não foi possível abrir esse grupo pelo servidor de Miami (${r?.detail ?? r?.error ?? "sem detalhes"}).`,
  );
}

/** Foto de um grupo pelo servidor de Miami. */
export async function miamiPhoto(clientId: string, input: string): Promise<string | null> {
  if (!(await ensureMiamiAccount(clientId))) return null;
  try {
    const r = (await miamiGroupPhoto({ data: { clientId, input } })) as {
      ok?: boolean;
      photoUrl?: string | null;
    };
    return r?.ok ? (r.photoUrl ?? null) : null;
  } catch {
    return null;
  }
}


/**
 * Entrega o monitoramento desses grupos ao robô de Miami.
 * Retorna os ids dos grupos que o robô assumiu (vazio = nada mudou).
 */
export async function armMiami(opts: {
  clientId: string;
  clientTitle?: string;
  groups: MonitoredGroup[];
  targetMs?: number | null;
  log: BridgeLog;
  patch?: BridgePatch;
  onAllDone?: () => void;
}): Promise<string[]> {
  const { clientId, groups, targetMs, log } = opts;
  if (!groups.length) return [];
  if (!(await agentAvailable())) {
    log("error", `Turbo Miami fora do ar (${agentReason || "sem detalhes"}). Monitoramento não iniciado.`);
    return [];
  }
  // Confirma a sessão novamente no instante do início. O cache não pode liberar
  // um monitoramento se a conta caiu depois da preparação do painel.
  if (!(await ensureMiamiAccount(clientId, log, true))) return [];

  logSink = log;
  if (opts.patch) patchSink = opts.patch;
  const taken: string[] = [];
  await Promise.all(
    groups.map(async (g) => {
      try {
        const logicalKey = key(clientId, g.id);
        const previousJobId = armedByGroup.get(logicalKey);
        if (previousJobId) {
          armed.delete(previousJobId);
          labels.delete(previousJobId);
          doneJobs.delete(previousJobId);
          try {
            await miamiStopJob({ data: { jobId: previousJobId } });
          } catch {
            /* a nova execução ainda pode começar normalmente */
          }
        }
        const jobId = `${logicalKey}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
        const res = (await miamiStartJob({
          data: {
            jobId,
            clientId,
            // @usuário primeiro: funciona mesmo quando a agenda da sessão
            // recém-reconectada ainda não conhece o número do grupo.
            group: g.username ? `@${String(g.username).replace(/^@/, "")}` : g.input,
            message: g.message,
            ...(targetMs ? { targetMs } : {}),
            method: (clientsStore.get(clientId)?.method ?? "abertura") as "abertura" | "mensagem" | "abertura2",
          },
        })) as { ok?: boolean };
        if (!res?.ok) return;
        const label = opts.clientTitle?.trim() || g.name;
        labels.set(jobId, label);
        jobClients.set(jobId, clientId);
        doneJobs.delete(jobId);
        armed.add(jobId);
        armedByGroup.set(logicalKey, jobId);
        taken.push(g.id);
        log("info", `${label}; Iniciado`);
      } catch (e) {
        log("error", `${g.name}: Miami não iniciou o monitoramento (${String((e as Error)?.message ?? e)}).`);
      }
    }),
  );

  if (taken.length) {
    if (opts.onAllDone) allDoneCb = opts.onAllDone;
    startPolling();
  }
  return taken;
}

/** Devolve o disparo ao navegador (parada do monitoramento). */
export async function disarmMiami(clientId?: string): Promise<void> {
  const ids = [...armed].filter((k) => !clientId || k.startsWith(`${clientId}:`));
  await Promise.all(
    ids.map(async (jobId) => {
      armed.delete(jobId);
      // O rótulo só some depois que a senha chegar (o patch precisa dele).
      if (!awaitingPatch.has(jobId)) labels.delete(jobId);
      doneJobs.delete(jobId);
      for (const [logicalKey, activeJobId] of armedByGroup) {
        if (activeJobId === jobId) armedByGroup.delete(logicalKey);
      }
      try {
        await miamiStopJob({ data: { jobId } });
      } catch {
        /* ignora */
      }
    }),
  );
  if (!armed.size && !awaitingPatch.size) stopPolling();
  else if (!armed.size) {
    // Segurança: se o VPS não devolver a senha, encerra a espera.
    setTimeout(() => {
      if (!armed.size && awaitingPatch.size) {
        for (const jobId of awaitingPatch) {
          const shown = pendingText.get(jobId) ?? "";
          labels.delete(jobId);
          pendingText.delete(jobId);
          { const b = shown.replace(/\s*\(Senha:.*\)\s*$/, ""); patchSink?.(jobId, b ? `${b} (Senha: não confirmada)` : "", false); }
        }
        awaitingPatch.clear();
        stopPolling();
      }
    }, PATCH_TIMEOUT_MS);
  }
}

function clearPatchTimer(jobId: string) {
  const t = patchTimers.get(jobId);
  if (t) clearTimeout(t);
  patchTimers.delete(jobId);
}

/** Fecha a linha quando a senha não chega do VPS, em vez de ficar carregando. */
function finalizePending(jobId: string) {
  clearPatchTimer(jobId);
  if (!awaitingPatch.has(jobId)) return;
  const shown = pendingText.get(jobId) ?? "";
  awaitingPatch.delete(jobId);
  pendingText.delete(jobId);
  if (!armed.has(jobId)) labels.delete(jobId);
  const base = shown.replace(/\s*\(Senha:.*\)\s*$/, "");
  patchSink?.(jobId, base ? `${base} (Senha: não confirmada)` : "", false);
  if (!armed.size && !awaitingPatch.size) stopPolling();
}

function armPatchWatchdog(jobId: string) {
  clearPatchTimer(jobId);
  patchTimers.set(jobId, setTimeout(() => finalizePending(jobId), PATCH_TIMEOUT_MS));
}

async function pollEvents() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const out = (await miamiEvents({ data: { since } })) as {
      events?: {
        t: number;
        jobId: string;
        level: string;
        text: string;
        key?: string;
        pending?: boolean;
      }[];
      now?: number;
    };
    const list = out?.events ?? [];
    for (const e of list) {
      since = Math.max(since, e.t);
      if (!armed.has(e.jobId) && !awaitingPatch.has(e.jobId)) continue;
      const label = labels.get(e.jobId);
      const authInvalid = /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/i.test(e.text);
      if (authInvalid) {
        const clientId = jobClients.get(e.jobId);
        if (clientId) disconnectInvalidAccount(clientId);
      }
      const eventText = authInvalid
        ? "Telegram API error 401: O usuário não está conectado."
        : e.text;
      const text = label ? `${label}; ${eventText}` : eventText;
      if (e.level === "patch") {
        clearPatchTimer(e.jobId);
        awaitingPatch.delete(e.jobId);
        pendingText.delete(e.jobId);
        if (!armed.has(e.jobId)) labels.delete(e.jobId);
        patchSink?.(e.key ?? e.jobId, text, false);
        continue;
      }
      if (e.level === "done") {
        doneJobs.add(e.jobId);
        continue;
      }
      const level = (["info", "success", "warn", "error"].includes(e.level) ? e.level : "info") as
        | "info"
        | "success"
        | "warn"
        | "error";
      if (e.pending && e.key) {
        awaitingPatch.add(e.jobId);
        pendingText.set(e.jobId, text);
        armPatchWatchdog(e.jobId);
      }
      logSink?.(level, text, e.key ? { key: e.key, pending: !!e.pending } : undefined);
    }
    if (!armed.size && !awaitingPatch.size) stopPolling();
    if (armed.size && [...armed].every((id) => doneJobs.has(id))) {
      const cb = allDoneCb;
      allDoneCb = null;
      cb?.();
    }
  } catch {
    /* ignora — o painel segue normal */
  } finally {
    pollInFlight = false;
  }
}

function startPolling() {
  if (pollHandle) return;
  pollHandle = setInterval(() => void pollEvents(), 700);
}

function stopPolling() {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
  pollInFlight = false;
}
