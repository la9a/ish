// Telegram client — implementação 100% via @mtcute/web.
// Tudo (auth, resolução de grupo, drafts, fotos, monitor) vive aqui.
// Sessão é persistida automaticamente em IndexedDB pelo mtcute,
// com nome do storage isolado por (usuário do app, cliente ativo).

import { appAuth } from "@/lib/appAuth";
import {
  storage as appStorage,
  activeClient,
  clientsStore,
  clientData,
  type MonitoredGroup,
} from "@/lib/storage";
import Long from "long";
import { recordRtt, sendLeadMs, rttSuffix } from "@/lib/netLatency";
import { brasiliaTargetToday, serverNow } from "@/lib/brasiliaSync";
import { armMiami, disarmMiami, isAgentArmed } from "@/lib/miamiBridge";


// ============================================================
// Tipos públicos (espelham a API anterior baseada em GramJS)
// ============================================================

export interface ResolvedGroup {
  id: string;
  name: string;
  draft: string | null;
  isChannel: boolean;
  photoUrl: string | null;
  /** @usuário público do grupo, quando existir — segundo caminho de resolução. */
  username?: string | null;
}

export interface DialogGroup {
  id: string;
  name: string;
  isChannel: boolean;
  photoUrl?: string | null;
  archived?: boolean;
}

export type LogLevel = "info" | "success" | "warn" | "error";
export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  msg: string;
  /** Chave estável pra substituir o texto depois (apuração da senha). */
  key?: string;
  /** True enquanto o servidor ainda calcula a senha. */
  pending?: boolean;
}

export type OpenStatus = "open" | "closed" | "unknown";

export interface SendInfo {
  groupId: string;
  groupName: string;
  messageId: number;
  /** Unix seconds do envio (registrado pelo Telegram). */
  dateSec: number;
}

// ============================================================
// Pool de clientes — um TelegramClient por (usuário, cliente ativo)
// ============================================================

type AnyClient = any;

interface ClientWrap {
  client: AnyClient;
  storageName: string;
}

const pool = new Map<string, ClientWrap>();
const connecting = new Map<string, Promise<ClientWrap>>();

// Invalida o client em cache pra um clientId específico (ou pro cliente ativo,
// se omitido). Usado quando as creds mudam durante o cadastro, pra evitar
// reutilizar um client mtcute construído com apiId/apiHash antigos.
export function resetPooledClient(clientId?: string | null): void {
  const u = appAuth.current() ?? "_anon";
  const cid = clientId ?? activeClient.get();
  if (!cid) return;
  const key = `${u}::${cid}`;
  const wrap = pool.get(key);
  if (wrap) {
    try { wrap.client?.disconnect?.(); } catch { /* ignore */ }
  }
  pool.delete(key);
  connecting.delete(key);
}

// Carregamento lazy de @mtcute/web — evita quebrar SSR (precisa de window/IDB/WebSocket).
let TelegramClientCtor: any | null = null;
async function loadMtcute(): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("Telegram client só pode ser usado no navegador.");
  }
  if (!TelegramClientCtor) {
    const mod: any = await import("@mtcute/web");
    TelegramClientCtor = mod.TelegramClient ?? mod.default?.TelegramClient ?? mod.default;
  }
  return TelegramClientCtor;
}

function poolKey(): string {
  const u = appAuth.current() ?? "_anon";
  const c = activeClient.get();
  if (!c) throw new Error("Nenhum cliente ativo. Selecione um cliente primeiro.");
  return `${u}::${c}`;
}

function storageNameFor(key: string): string {
  return `mtcute:${key}`;
}

async function deleteIdb(name: string): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

async function getClientInternal(): Promise<AnyClient> {
  const key = poolKey();
  const existing = pool.get(key);
  if (existing) return existing.client;
  const inflight = connecting.get(key);
  if (inflight) return (await inflight).client;

  const p = (async () => {
    const creds = appStorage.getCreds();
    if (!creds) throw new Error("Sem credenciais API. Configure api_id e api_hash.");
    const Ctor = await loadMtcute();
    const storageName = storageNameFor(key);
    const client = new Ctor({
      apiId: Number(creds.apiId),
      apiHash: String(creds.apiHash),
      storage: storageName,
      // 0 = nunca dormir em FLOOD_WAIT. Por padrão o mtcute engole
      // FLOOD_WAIT_x (x<=10) dormindo x segundos e reenviando por baixo dos
      // panos — era isso que aparecia como "enviado em 4 segundos".
      floodSleepThreshold: 0,
    });
    // Restaura a sessão sincronizada via cloud se o IDB local ainda não tem
    // auth_key (acontece quando o usuário abre a conta num dispositivo novo).
    await maybeImportSavedSession(client, appStorage.getSession());
    const wrap: ClientWrap = { client, storageName };
    pool.set(key, wrap);
    return wrap;
  })();
  connecting.set(key, p);
  try {
    return (await p).client;
  } finally {
    connecting.delete(key);
  }
}

export async function getClient(): Promise<AnyClient> {
  return getClientInternal();
}

// Cria/recupera client de um clientId específico, sem trocar o activeClient.
// Útil para o monitor multi-conta.
export async function getClientForId(clientId: string): Promise<AnyClient> {
  const u = appAuth.current() ?? "_anon";
  const key = `${u}::${clientId}`;
  const existing = pool.get(key);
  if (existing) return existing.client;
  const inflight = connecting.get(key);
  if (inflight) return (await inflight).client;
  const p = (async () => {
    const { clientData } = await import("@/lib/storage");
    const creds = clientData.getCreds(clientId);
    if (!creds) throw new Error(`Sem credenciais para o cliente ${clientId}.`);
    const Ctor = await loadMtcute();
    const storageName = storageNameFor(key);
    const client = new Ctor({
      apiId: Number(creds.apiId),
      apiHash: String(creds.apiHash),
      storage: storageName,
      // 0 = nunca dormir em FLOOD_WAIT. Por padrão o mtcute engole
      // FLOOD_WAIT_x (x<=10) dormindo x segundos e reenviando por baixo dos
      // panos — era isso que aparecia como "enviado em 4 segundos".
      floodSleepThreshold: 0,
    });
    await maybeImportSavedSession(client, clientData.getSession(clientId));
    const wrap: ClientWrap = { client, storageName };
    pool.set(key, wrap);
    return wrap;
  })();
  connecting.set(key, p);
  try {
    return (await p).client;
  } finally {
    connecting.delete(key);
  }
}

// ============================================================
// Caminho quente de envio
// ============================================================

/** Dispara `messages.sendMessage` já montado, sem passar pelo `sendText`
 *  (que ainda normaliza peer e faz parse de entidades na hora H).
 *  Cai pro `sendText` só se a chamada crua não for suportada. */
export async function fastSend(
  client: any,
  payload: { peer: any; text: string; randomId: Long },
): Promise<any> {
  if (typeof client?.call === "function") {
    try {
      return await client.call({
        _: "messages.sendMessage",
        peer: payload.peer,
        message: payload.text,
        randomId: payload.randomId,
        noWebpage: true,
      });
    } catch (e: any) {
      const m = String(e?.message ?? e);
      const isRpcError = /_[A-Z]|FLOOD|FORBIDDEN|INVALID|BANNED|SLOWMODE|PEER|AUTH_KEY/.test(m);
      if (isRpcError) throw e;
      // Erro de esquema/serialização → caminho tradicional.
      return client.sendText(payload.peer, payload.text, { randomId: payload.randomId });
    }
  }
  return client.sendText(payload.peer, payload.text, { randomId: payload.randomId });
}

/** Resolve com o PRIMEIRO que der certo; só rejeita se todos falharem
 *  (preservando o erro original, ao contrário do AggregateError). */
export function firstOk<T>(list: Promise<T>[]): Promise<T> {
  if (list.length === 1) return list[0];
  return new Promise<T>((resolve, reject) => {
    let left = list.length;
    let firstErr: any;
    for (const p of list) {
      p.then(resolve, (e) => {
        if (firstErr === undefined) firstErr = e;
        if (--left === 0) reject(firstErr);
      });
    }
  });
}

/** Reenvio escalonado (hedging): dispara o MESMO payload (mesmo randomId, que
 *  o Telegram deduplica no servidor) em ondas até o primeiro ack chegar.
 *  Motivo: quando o socket trava esperando salt/handshake, um ack pode levar
 *  segundos — uma nova tentativa em outra conexão chega em ~200ms.
 *  Rejeita imediatamente no primeiro erro real do servidor (grupo fechado etc.). */
export function hedgedSend(
  conns: any[],
  payload: { peer: any; text: string; randomId: Long },
  opts?: { steps?: number[]; alive?: () => boolean },
): Promise<any> {
  const live = conns.filter(Boolean);
  const steps = opts?.steps ?? [0, 150, 350, 650, 1000, 1400];
  const alive = opts?.alive ?? (() => true);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timers: any[] = [];
    const done = (fn: (v: any) => void) => (v: any) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      fn(v);
    };
    const ok = done(resolve);
    const fail = done(reject);
    steps.forEach((delay, i) => {
      const shoot = () => {
        if (settled || !alive()) return;
        const conn = live[i % live.length];
        if (!conn) return;
        fastSend(conn, payload).then(ok, fail);
      };
      if (delay === 0) shoot();
      else timers.push(setTimeout(shoot, delay));
    });
  });
}


// ---- Conexão secundária (corrida de pacotes) -------------------------------
// Segundo socket MTProto da MESMA conta, em storage próprio (importa a string
// session), sem loop de updates. Disparar nas duas conexões com o MESMO
// randomId faz o Telegram deduplicar no servidor: nunca duplica mensagem, e
// vence o pacote que chegar primeiro — mata o jitter de fila do WebSocket.
const altPool = new Map<string, AnyClient>();
const altConnecting = new Map<string, Promise<AnyClient | null>>();

export async function getAltClientForId(clientId: string): Promise<AnyClient | null> {
  const u = appAuth.current() ?? "_anon";
  const key = `${u}::${clientId}`;
  const existing = altPool.get(key);
  if (existing) return existing;
  const inflight = altConnecting.get(key);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      const creds = clientData.getCreds(clientId);
      const session = clientData.getSession(clientId);
      if (!creds || !session || session.length < 8) return null;
      const Ctor = await loadMtcute();
      const client = new Ctor({
        apiId: Number(creds.apiId),
        apiHash: String(creds.apiHash),
        storage: `mtcute:alt:${key}`,
        floodSleepThreshold: 0,
        disableUpdates: true,
      });
      await client.importSession(session, true);
      // Esquenta o socket (handshake + auth) já no prewarm.
      try { await client.call({ _: "updates.getState" }); } catch { /* ignore */ }
      altPool.set(key, client);
      return client;
    } catch (e) {
      console.warn("[telegram] conexão secundária indisponível:", e);
      return null;
    }
  })();
  altConnecting.set(key, p);
  try {
    return await p;
  } finally {
    altConnecting.delete(key);
  }
}

export function dropAltClient(clientId: string): void {
  const u = appAuth.current() ?? "_anon";
  const key = `${u}::${clientId}`;
  const c = altPool.get(key);
  if (c) { try { c.disconnect?.(); } catch { /* ignore */ } }
  altPool.delete(key);
}

/** Ping barato usado como keep-alive; alimenta o medidor de RTT. */
export function pingClient(client: any): void {
  if (!client) return;
  try {
    const t0 = performance.now();
    const p = client.call?.({ _: "updates.getState" }) ?? client.getState?.();
    p?.then?.(() => recordRtt(performance.now() - t0))?.catch?.(() => {});
  } catch { /* ignore */ }
}



// Importa uma string session salva (cloud) caso ela exista e seja real.
// É seguro chamar várias vezes: se já houver auth_key no IDB local idêntico,
// o mtcute simplesmente substitui pelo mesmo valor.
async function maybeImportSavedSession(client: any, saved: string): Promise<void> {
  if (!saved || saved.length < 8) return; // ignora marcadores antigos ("1")
  try {
    await client.importSession(saved, true);
  } catch (e) {
    console.warn("[telegram] importSession falhou:", e);
  }
}

// Exporta a string session atual do mtcute e salva no localStorage (e cloud).
async function exportAndStoreSession(client: any, clientId: string | null): Promise<void> {
  try {
    const s: string = await client.exportSession();
    if (!s) return;
    if (clientId) appStorage.setSessionFor(clientId, s);
    else appStorage.setSession(s);
  } catch (e) {
    console.warn("[telegram] exportSession falhou:", e);
  }
}

export function getClientUnsafe(): AnyClient | null {
  try {
    return pool.get(poolKey())?.client ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// Autenticação (telefone → código → 2FA)
// ============================================================

export async function isAuthorized(): Promise<boolean> {
  // Captura o cliente ativo neste exato momento. Se o usuário trocar
  // de cliente enquanto a chamada estiver em voo, os dados ainda serão
  // gravados sob o escopo correto.
  const cid = activeClient.get();
  try {
    const client = await getClientInternal();
    const me = await client.getMe();
    await persistMe(me, cid);
    return true;
  } catch (e: any) {
    const msg = String(e?.message ?? e?.text ?? e);
    // Apenas erros definitivos de autenticação contam como "não autorizado".
    // Erros transitórios (rede, timeout, websocket) NÃO devem desconectar.
    const fatal =
      msg.includes("AUTH_KEY_UNREGISTERED") ||
      msg.includes("AUTH_KEY_INVALID") ||
      msg.includes("SESSION_REVOKED") ||
      msg.includes("SESSION_EXPIRED") ||
      msg.includes("USER_DEACTIVATED");
    if (fatal) return false;
    // Otimista: mantém a sessão pra evitar logout falso em refresh.
    throw e;
  }
}

// ============================================================
// Health-check de sessões — usado pelo painel pra detectar
// contas marcadas como "Conectada" cuja sessão Telegram está morta.
// ============================================================

export type SessionHealth = "alive" | "dead" | "unknown";

const FATAL_AUTH_ERRORS = [
  "AUTH_KEY_UNREGISTERED",
  "AUTH_KEY_INVALID",
  "SESSION_REVOKED",
  "SESSION_EXPIRED",
  "USER_DEACTIVATED",
];

/**
 * Verifica se a sessão Telegram de um cliente específico ainda é válida.
 * Retorna "dead" apenas para erros definitivos de autenticação;
 * erros transitórios (rede, timeout) retornam "unknown".
 */
function isFatalAuthError(e: any): boolean {
  const msg = String(e?.message ?? e?.text ?? e);
  return FATAL_AUTH_ERRORS.some((c) => msg.includes(c));
}

/**
 * Erros transitórios do armazenamento local (IndexedDB) — acontecem quando um
 * client é recriado/fechado enquanto outra operação da mesma conta está em voo.
 * Nunca significam sessão morta: basta repetir a operação.
 */
export function isTransientStorageError(e: any): boolean {
  const msg = String(e?.message ?? e?.text ?? e);
  return (
    /database connection is closing/i.test(msg) ||
    /InvalidStateError/i.test(msg) ||
    /Failed to execute 'transaction' on 'IDBDatabase'/i.test(msg) ||
    /TransactionInactiveError/i.test(msg) ||
    /object store/i.test(msg)
  );
}

/** Descarta o client em memória de um cliente (força recriação no próximo uso). */
export async function dropClientForId(clientId: string): Promise<void> {
  const u = appAuth.current() ?? "_anon";
  const key = `${u}::${clientId}`;
  const wrap = pool.get(key);
  pool.delete(key);
  connecting.delete(key);
  // NÃO fecha imediatamente: fechar o client fecha o IndexedDB dele, e
  // qualquer operação ainda em voo (pré-resolver grupo, sendText) quebra com
  // "The database connection is closing". Fecha em background, depois de uma
  // janela de graça pras operações pendentes terminarem.
  const old = wrap?.client as any;
  if (old) {
    setTimeout(() => {
      try { void old.close?.(); } catch { /* ignore */ }
    }, 10_000);
  }
}

/**
 * Reconecta uma conta: puxa a sessão mais recente da nuvem, descarta o client
 * em memória (que pode estar com socket morto) e recria a partir da sessão
 * salva. Retorna o novo client já validado com getMe().
 */
export async function reconnectClientForId(clientId: string): Promise<AnyClient> {
  try {
    const cloud = await import("@/lib/cloudSync");
    await cloud.pullClientSecrets(appAuth.currentUserId(), clientId);
  } catch {
    /* segue com o que já tem local */
  }
  await dropClientForId(clientId);
  const client = await getClientForId(clientId);
  await client.getMe();
  // Reexporta a sessão viva — evita depender de string antiga/inválida.
  try {
    await exportAndStoreSession(client, clientId);
  } catch {
    /* ignore */
  }
  return client;
}

export async function checkSessionHealth(clientId: string): Promise<SessionHealth> {
  try {
    const { ensureMiamiAccount } = await import("@/lib/miamiBridge");
    return (await ensureMiamiAccount(clientId)) ? "alive" : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Roda health-check em todos os clientes marcados como conectados.
 * Pra cada um que estiver morto, atualiza `hasSession = false`.
 * Retorna a lista de ids que foram marcados como mortos nesta varredura.
 */
export async function checkAllSessions(): Promise<string[]> {
  const { clientsStore } = await import("@/lib/storage");
  const { miamiPruneAccounts, miamiActiveAccounts } = await import("@/lib/miamiAgent.functions");
  const { ensureMiamiAccount } = await import("@/lib/miamiBridge");
  const all = clientsStore.list().filter((c) => c.hasSession);
  const dead: string[] = [];
  const markDead = (id: string) => {
    clientsStore.clearSessionOnly(id);
    clientsStore.update(id, { hasSession: false });
    dead.push(id);
  };
  try {
    // 1) Tira do robô as contas cujo login o Telegram encerrou.
    const pruned = await miamiPruneAccounts();
    for (const id of pruned.removed) if (all.some((c) => c.id === id)) markDead(id);
    // 2) Contas marcadas como conectadas mas ausentes do robô: tenta religar
    //    com a sessão salva; se o Telegram recusar, vira "Desconectado".
    const active = await miamiActiveAccounts();
    if (!active.ok) return dead;
    const missing = all.filter((c) => !dead.includes(c.id) && !active.ids.includes(c.id));
    for (const c of missing) {
      const ok = await ensureMiamiAccount(c.id, undefined, true).catch(() => false);
      const now = clientsStore.get(c.id);
      if (!ok && (now?.hasSession === false || !clientData.getSession(c.id))) {
        if (now?.hasSession !== false) markDead(c.id);
        else dead.push(c.id);
      }
    }
  } catch {
    /* robô inacessível: não altera nada */
  }
  if (dead.length) {
    try { window.dispatchEvent(new CustomEvent("cloud:changed")); } catch { /* SSR */ }
  }
  return dead;
}

export async function sendCode(phone: string): Promise<{ phoneCodeHash: string }> {
  const cid = activeClient.get();
  const creds = appStorage.getCreds();
  if (cid && creds?.apiId && creds?.apiHash) {
    const { miamiLoginSendCode } = await import("@/lib/miamiBridge");
    const r = await miamiLoginSendCode({
      clientId: cid,
      apiId: String(creds.apiId),
      apiHash: String(creds.apiHash),
      phone,
    });
    if (r) {
      return r;
    }
  }
  throw new Error("O login precisa ser iniciado no servidor de Miami. Tente novamente em alguns segundos.");
}

export async function resendCode(
  _phone: string,
  _phoneCodeHash: string,
): Promise<{ phoneCodeHash: string }> {
  const cid = activeClient.get();
  if (cid) {
    const { miamiLoginResendCode } = await import("@/lib/miamiBridge");
    const r = await miamiLoginResendCode(cid);
    if (r) return r;
  }
  throw new Error("Não há um login pendente no servidor de Miami. Envie um novo código.");
}

export async function signIn(opts: {
  phone: string;
  phoneCodeHash: string;
  code: string;
  password?: string;
}): Promise<void> {
  const cid = activeClient.get();
  if (cid) {
    const { miamiLoginSignIn } = await import("@/lib/miamiBridge");
    const r = await miamiLoginSignIn({
      clientId: cid,
      code: opts.code,
      phoneCodeHash: opts.phoneCodeHash,
      password: opts.password,
    });
    if (r === "2FA_REQUIRED") {
      const err: any = new Error("2FA_REQUIRED");
      err.code = "2FA_REQUIRED";
      throw err;
    }
    if (r?.session) {
      // Guarda uma cópia de recuperação, mas NÃO importa a sessão no browser:
      // isso faria o mesmo dispositivo passar a trafegar por Jacareí.
      appStorage.setSessionFor(cid, r.session);
      if (r.me) appStorage.setMeFor(cid, {
        id: String(r.me.id ?? ""),
        firstName: r.me.name ?? r.me.username ?? "Cliente",
        username: r.me.username ?? null,
        phone: opts.phone,
        photoUrl: null,
      });
      return;
    }
    throw new Error("O servidor de Miami não confirmou o login. Envie um novo código.");
  }
  throw new Error("Nenhuma conta ativa para concluir o login em Miami.");
}

async function persistMe(user: any, clientIdOverride?: string | null) {
  if (!user) return;
  // Usa o clientId capturado pelo chamador (evita race quando o usuário
  // alterna entre clientes enquanto getMe está em andamento).
  const cid = clientIdOverride ?? activeClient.get();
  // Exporta e persiste a string session real do mtcute — necessário pra
  // multi-device (cloud sync). Em falhas, mantém o marcador antigo "1".
  try {
    const u = appAuth.current() ?? "_anon";
    const wrap = cid ? pool.get(`${u}::${cid}`) : pool.get(poolKey());
    if (wrap?.client) {
      await exportAndStoreSession(wrap.client, cid ?? null);
    } else {
      if (cid) appStorage.setSessionFor(cid, "1");
      else appStorage.setSession("1");
    }
  } catch {
    if (cid) appStorage.setSessionFor(cid, "1");
    else appStorage.setSession("1");
  }
  let photoUrl: string | null = null;
  try {
    const photo = user?.photo ?? user?.raw?.photo;
    if (photo) {
      const u = appAuth.current() ?? "_anon";
      const wrap = cid ? pool.get(`${u}::${cid}`) : pool.get(poolKey());
      const client = wrap?.client;
      if (client) {
        const buf: Uint8Array = await client.downloadAsBuffer(photo.small ?? photo);
        let bin = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          bin += String.fromCharCode(...buf.subarray(i, i + chunk));
        }
        photoUrl = "data:image/jpeg;base64," + btoa(bin);
      }
    }
  } catch { /* ignore */ }
  const me = {
    id: String(user.id ?? user.raw?.id ?? ""),
    firstName: user.firstName ?? user.raw?.firstName ?? "",
    username: user.username ?? user.raw?.username ?? null,
    phone: user.phone ?? user.raw?.phone ?? null,
    photoUrl,
  };
  if (cid) appStorage.setMeFor(cid, me);
  else appStorage.setMe(me);
}

export async function logout(): Promise<void> {
  let key: string | null = null;
  try { key = poolKey(); } catch { /* ignore */ }
  if (key) {
    const wrap = pool.get(key);
    if (wrap) {
      try { await wrap.client.logOut(); } catch { /* ignore */ }
      try { await wrap.client.close?.(); } catch { /* ignore */ }
      await deleteIdb(wrap.storageName);
      pool.delete(key);
    }
  }
  appStorage.clearActiveClient();
}

export async function disconnectActive(opts: { keepSession: boolean }): Promise<void> {
  let key: string | null = null;
  try { key = poolKey(); } catch { /* ignore */ }
  if (key) {
    const wrap = pool.get(key);
    if (wrap) {
      try { await wrap.client.close?.(); } catch { /* ignore */ }
      if (!opts.keepSession) await deleteIdb(wrap.storageName);
      pool.delete(key);
    }
  }
  if (!opts.keepSession) {
    try { appStorage.clearSession(); } catch { /* ignore */ }
  }
}

// ============================================================
// Entidades / resolução de grupos
// ============================================================

const chatCache = new Map<string, any>();
const photoCache = new Map<string, string | null>();

function cacheScope(): string {
  return `${appAuth.current() ?? "_anon"}::${activeClient.get() ?? "_"}`;
}

function peerCacheKey(kind: "q" | "id", key: string): string {
  return `${cacheScope()}::${kind}:${key}`;
}

function photoCacheKey(id: string, clientId?: string): string {
  const scope = clientId == null
    ? cacheScope()
    : `${appAuth.current() ?? "_anon"}::${clientId || "_"}`;
  return `${scope}::photo:${id}`;
}

function forgetCachedGroupKeys(...keys: Array<string | null | undefined>) {
  for (const key of keys) {
    if (!key) continue;
    chatCache.delete(peerCacheKey("q", key));
    chatCache.delete(peerCacheKey("id", key));
    photoCache.delete(photoCacheKey(key));
    for (const variant of peerIdVariants(key)) {
      chatCache.delete(peerCacheKey("q", variant));
      chatCache.delete(peerCacheKey("id", variant));
      photoCache.delete(photoCacheKey(variant));
    }
  }
}

async function resolveSendPeer(client: any, chat: any): Promise<any> {
  if (typeof client?.resolvePeer === "function") {
    const id = chat?.id != null ? String(chat.id) : null;
    const attempts = [id, chat].filter(Boolean);
    for (const target of attempts) {
      try { return await client.resolvePeer(target, true); } catch { /* try next */ }
    }
  }
  return chat?.inputPeer ?? chat;
}

function isObsoleteMigratedChat(chat: any): boolean {
  return !!(chat?.migratedTo || chat?.raw?.migratedTo || chat?.raw?.migrated_to);
}

function migratedTargetIds(chat: any): string[] {
  const target = chat?.migratedTo ?? chat?.raw?.migratedTo ?? chat?.raw?.migrated_to;
  const id = firstPresent(
    target?.id,
    target?.channelId,
    target?.chatId,
    target?.channel_id,
    target?.chat_id,
  );
  return id ? peerIdVariants(id) : [];
}

function isModernChatEntity(chat: any): boolean {
  return String(chat?.id ?? "").startsWith("-100") ||
    chat?.chatType === "supergroup" ||
    chat?.chatType === "channel" ||
    chat?.chatType === "gigagroup";
}

export function isPeerInvalidError(error: any): boolean {
  const msg = String(error?.message ?? error?.text ?? error ?? "").toUpperCase();
  return msg.includes("CHANNEL_INVALID") ||
    msg.includes("PEER_ID_INVALID") ||
    msg.includes("INPUT_CHAT_INVALID") ||
    msg.includes("CHAT_ID_INVALID");
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s._\-,!?:;"'()[\]{}]+/g, "").trim();
}

function extractInviteHash(input: string): string | null {
  const m = input.match(/t\.me\/(?:joinchat\/|\+)([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function parseUsername(s: string): string | null {
  const m = s.match(/^(?:@|https?:\/\/t\.me\/|t\.me\/)?([A-Za-z][A-Za-z0-9_]{3,31})$/);
  return m ? m[1] : null;
}

// Resolve um input para um objeto Chat do mtcute.
// `titleHint` é usado como fallback quando o ID salvo está obsoleto
// (ex.: grupo básico migrou para supergrupo e o id mudou).
export async function resolveEntity(input: string, titleHint?: string, opts?: { force?: boolean }): Promise<any> {
  const key = input.trim();
  const cached = chatCache.get(peerCacheKey("q", key));
  if (!opts?.force && cached && !isObsoleteMigratedChat(cached)) return cached;
  if (cached) chatCache.delete(peerCacheKey("q", key));

  const client = await getClientInternal();

  // 1) Convite privado (t.me/+hash ou t.me/joinchat/hash)
  const inviteHash = extractInviteHash(key);
  if (inviteHash) {
    try {
      const chat: any = await client.getChat(`https://t.me/+${inviteHash}`);
      if (chat) {
        chatCache.set(peerCacheKey("q", key), chat);
        chatCache.set(peerCacheKey("id", String(chat.id)), chat);
        return chat;
      }
    } catch (err: any) {
      const m = String(err?.message ?? "");
      if (m.includes("INVITE_HASH_EXPIRED") || m.includes("INVITE_HASH_INVALID")) {
        throw new Error(`Convite "${input}" inválido ou expirado.`);
      }
      // segue p/ outras estratégias
    }
  }

  // 2) Username, @user ou t.me/<user>
  const username = parseUsername(key);
  if (username) {
    try {
      const chat: any = await client.getChat(username);
      if (chat) {
        chatCache.set(peerCacheKey("q", key), chat);
        chatCache.set(peerCacheKey("id", String(chat.id)), chat);
        return chat;
      }
    } catch {
      /* fallthrough */
    }
  }

  // 3) ID numérico — tenta direto pelo mtcute (com variantes -100 / sem -100)
  const isNumeric = /^-?\d+$/.test(key);
  // Quando temos um titleHint (nome salvo) + id numérico, PULAMOS a resolução
  // direta por id: se o grupo migrou pra supergrupo, `getChat(id-antigo)`
  // pode devolver uma entidade obsoleta que passa aqui mas falha em
  // `openChat`/`sendMessage` com CHANNEL_INVALID. A busca por título nos
  // diálogos abaixo escolhe a versão migrada (-100...).
  if (isNumeric && !titleHint) {
    const n = Number(key);
    const abs = Math.abs(n);
    const variants = new Set<number>([n, -abs, Number(`-100${abs}`)]);
    const stripped = String(abs).replace(/^100/, "");
    if (stripped && stripped !== String(abs)) {
      variants.add(Number(stripped));
      variants.add(-Number(stripped));
    }
    for (const v of variants) {
      try {
        const chat: any = await client.getChat(v);
        if (chat) {
          chatCache.set(peerCacheKey("q", key), chat);
          chatCache.set(peerCacheKey("id", String(chat.id)), chat);
          return chat;
        }
      } catch { /* try next */ }
    }
  }

  // 4) Busca por título nos diálogos. Para IDs numéricos usamos o titleHint
  //    (nome salvo) — importante quando o grupo migrou pra supergrupo e o id
  //    salvo virou lixo.
  const searchTitle = (!isNumeric ? key : (titleHint ?? "")).trim();
  const qNorm = normalize(searchTitle);
  const qLower = searchTitle.toLowerCase();
  const idTargets = new Set<string>();
  if (isNumeric) {
    const abs = String(Math.abs(Number(key)));
    idTargets.add(key); idTargets.add(abs); idTargets.add(`-${abs}`); idTargets.add(`-100${abs}`);
    const stripped = abs.replace(/^100/, "");
    if (stripped && stripped !== abs) {
      idTargets.add(stripped); idTargets.add(`-${stripped}`); idTargets.add(`-100${stripped}`);
    }
  }
  let exact: any = null;
  let partial: any = null;
  let count = 0;
  for await (const dialog of client.iterDialogs()) {
    const chat = dialog.chat ?? dialog.peer;
    if (!chat || chat.type !== "chat") continue;
    if (isObsoleteMigratedChat(chat)) {
      if (idTargets.size && idTargets.has(String(chat.id))) {
        for (const id of migratedTargetIds(chat)) idTargets.add(id);
      }
      continue;
    }
    count++;
    const title: string = chat.title ?? "";
    chatCache.set(peerCacheKey("id", String(chat.id)), chat);
    if (idTargets.size && idTargets.has(String(chat.id))) {
      if (!titleHint || isModernChatEntity(chat)) { exact = chat; break; }
    }
    if (!title || !qLower) continue;
    const tLower = title.toLowerCase();
    const tNorm = normalize(title);
    if (tLower === qLower || tNorm === qNorm) {
      // Se já achamos um exato, prefere versão migrada (-100/supergrupo)
      if (!exact || (!isModernChatEntity(exact) && isModernChatEntity(chat))) exact = chat;
      if (isModernChatEntity(exact)) break;
      continue;
    }
    if (!partial && (tLower.includes(qLower) || qLower.includes(tLower) || tNorm.includes(qNorm) || qNorm.includes(tNorm))) partial = chat;
  }
  const found = exact ?? partial;
  if (!found) {
    const label = titleHint ? `${titleHint} (${input})` : input;
    throw new Error(
      `Grupo "${label}" não encontrado nos seus diálogos (${count} verificados). Verifique se você é membro.`,
    );
  }
  chatCache.set(peerCacheKey("q", key), found);
  return found;
}

function isGroupOrChannel(chat: any): boolean {
  const t: string = chat?.chatType ?? "";
  return t === "group" || t === "supergroup" || t === "channel" || t === "gigagroup";
}

const GROUPS_TTL_MS = 60_000;
const groupsCache = new Map<string, { at: number; data: DialogGroup[] }>();
const dialogsWarmedAt = new Map<string, number>();
export function invalidateGroupsCache(clientId?: string) {
  if (clientId == null) { groupsCache.clear(); dialogsWarmedAt.clear(); return; }
  groupsCache.delete(clientId);
  dialogsWarmedAt.delete(clientId);
}

// Fila única pra operações que trocam temporariamente o cliente ativo.
// Sem ela, várias contas do Multi em paralelo sobrescreviam umas às outras
// ("Nenhum cliente ativo" / grupos lidos da conta errada).
let activeQueue: Promise<unknown> = Promise.resolve();
function withActiveClient<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
  const run = activeQueue.then(async () => {
    const prev = activeClient.get();
    activeClient.set(clientId);
    try { return await fn(); } finally { if (prev) activeClient.set(prev); }
  });
  activeQueue = run.catch(() => {});
  return run;
}

export async function listGroups(clientId?: string): Promise<DialogGroup[]> {
  const cid = clientId ?? activeClient.get() ?? "";
  const now = Date.now();
  const hit = groupsCache.get(cid);
  if (hit && now - hit.at < GROUPS_TTL_MS) return hit.data;
  // A sessão vive no servidor de Miami — a lista de grupos vem de lá.
  if (cid) {
    try {
      const { miamiGroups } = await import("@/lib/miamiBridge");
      const remote = await miamiGroups(cid);
      if (remote) {
        const mapped = remote
          .map((g) => ({ id: g.id, name: g.name, isChannel: !!g.isChannel, archived: !!g.archived }))
          .sort((a, b) => a.name.localeCompare(b.name));
        groupsCache.set(cid, { at: now, data: mapped });
        return mapped;
      }
    } catch { /* cai pro caminho local */ }
  }
  const client = await getClientInternal();
  const raw: Array<DialogGroup & { _chatType?: string }> = [];
  const iterate = async () => {
    for await (const dialog of client.iterDialogs()) {
    const chat = dialog.chat ?? dialog.peer;
    if (!chat || chat.type !== "chat" || !isGroupOrChannel(chat)) continue;
    // Grupo básico que migrou pra supergrupo: Telegram ainda devolve a
    // entrada antiga (título/foto antigos, id obsoleto). Ignoramos.
    if (isObsoleteMigratedChat(chat)) continue;
    chatCache.set(peerCacheKey("id", String(chat.id)), chat);
    raw.push({
      id: String(chat.id),
      name: chat.title ?? String(chat.id),
      isChannel: chat.chatType === "channel",
      _chatType: chat.chatType,
    });
    }
  };
  let timer: any;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("Tempo esgotado ao carregar grupos. Telegram pode estar limitando. Tente novamente em alguns segundos.")), 25_000);
  });
  try {
    await Promise.race([iterate(), timeout]);
  } finally {
    clearTimeout(timer);
  }
  const score = (g: DialogGroup & { _chatType?: string }) => {
    const isMigrated = g.id.startsWith("-100");
    const t = g._chatType ?? "";
    const modernType = t === "supergroup" || t === "channel" || t === "gigagroup";
    return (isMigrated ? 2 : 0) + (modernType ? 1 : 0);
  };
  // Dedupe por id (variantes) — mesma entidade em duas formas.
  const byId = new Map<string, DialogGroup & { _chatType?: string }>();
  for (const g of raw) {
    const variants = peerIdVariants(g.id);
    const key = variants.length ? variants.sort()[0] : g.id;
    const prev = byId.get(key);
    if (!prev || score(g) > score(prev)) byId.set(key, g);
  }
  // Dedupe por nome — pega residuais quando `migratedTo` não veio preenchido.
  const byName = new Map<string, DialogGroup & { _chatType?: string }>();
  for (const g of byId.values()) {
    const key = g.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev || score(g) > score(prev)) byName.set(key, g);
  }
  const out = Array.from(byName.values()).map(({ _chatType, ...g }) => g);
  out.sort((a, b) => a.name.localeCompare(b.name));
  groupsCache.set(cid, { at: now, data: out });
  dialogsWarmedAt.set(cid, now);
  // Sincroniza nomes atualizados do Telegram com os grupos já monitorados
  // deste cliente — se o admin renomear o grupo, o site reflete na hora.
  if (cid) {
    try {
      const stored = clientData.getGroups(cid);
      if (stored.length) {
        const nameById = new Map<string, string>();
        for (const g of out) {
          for (const v of peerIdVariants(g.id)) nameById.set(v, g.name);
          nameById.set(g.id, g.name);
        }
        let changed = false;
        for (const s of stored) {
          const fresh = nameById.get(s.id);
          if (fresh && fresh !== s.name) {
            changed = true;
            clientData.upsertGroup(cid, { ...s, name: fresh });
          }
        }
        if (changed) {
          try { window.dispatchEvent(new CustomEvent("cloud:changed")); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
  return out;
}

/**
 * Sincroniza a lista de grupos monitorados de um cliente com a lista atual
 * de grupos que a conta participa no Telegram. Se um grupo monitorado não
 * aparece mais entre os diálogos ativos, ele é removido automaticamente.
 * Retorna a lista de ids removidos.
 */
export async function pruneMissingGroups(clientId: string): Promise<string[]> {
  if (!clientId) return [];
  return withActiveClient(clientId, () => pruneMissingGroupsInner(clientId));
}

async function pruneMissingGroupsInner(clientId: string): Promise<string[]> {
  try {
    const stored = clientData.getGroups(clientId);
    if (!stored.length) return [];
    const live = await listGroups(clientId);
    // Lista vazia = falha de leitura; nunca apaga grupos por isso.
    if (!live.length) return [];
    const liveIds = new Set<string>();
    for (const g of live) {
      liveIds.add(g.id);
      for (const v of peerIdVariants(g.id)) liveIds.add(v);
    }
    const removed: string[] = [];
    for (const s of stored) {
      const variants = new Set<string>([s.id, ...peerIdVariants(s.id)]);
      let found = false;
      for (const v of variants) if (liveIds.has(v)) { found = true; break; }
      if (!found) {
        clientData.removeGroup(clientId, s.id);
        removed.push(s.id);
      }
    }
    if (removed.length) {
      try { window.dispatchEvent(new CustomEvent("cloud:changed")); } catch { /* ignore */ }
    }
    return removed;
  } catch {
    return [];
  }
}

/**
 * Aquece o cache de chats iterando os diálogos uma vez.
 * Necessário pra que `loadGroupPhotoById` consiga resolver fotos
 * de grupos salvos após reload da página.
 */
export async function warmDialogsCache(): Promise<void> {
  try {
    const cid = activeClient.get() ?? "";
    const warmedAt = dialogsWarmedAt.get(cid) ?? 0;
    if (Date.now() - warmedAt < GROUPS_TTL_MS) return;
    if (cid) {
      const { isMiamiOwned } = await import("@/lib/miamiBridge");
      // Sessão em Miami: nada de abrir conexão no navegador.
      if (await isMiamiOwned(cid)) {
        dialogsWarmedAt.set(cid, Date.now());
        return;
      }
    }
    const client = await getClientInternal();
    for await (const dialog of client.iterDialogs()) {
      const chat = dialog.chat ?? dialog.peer;
      if (isObsoleteMigratedChat(chat)) continue;
      if (chat?.id != null) chatCache.set(peerCacheKey("id", String(chat.id)), chat);
    }
    dialogsWarmedAt.set(cid, Date.now());
  } catch {
    /* ignore */
  }
}

export async function getGroupPhoto(chat: any): Promise<string | null> {
  const id = String(chat?.id ?? "");
  if (!id) return null;
  const pKey = photoCacheKey(id);
  if (photoCache.has(pKey)) return photoCache.get(pKey) ?? null;
  const photo = chat?.photo;
  if (!photo) {
    photoCache.set(pKey, null);
    return null;
  }
  try {
    const client = await getClientInternal();
    const buf: Uint8Array = await client.downloadAsBuffer(photo.small ?? photo);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    const url = "data:image/jpeg;base64," + btoa(bin);
    photoCache.set(pKey, url);
    return url;
  } catch {
    photoCache.set(pKey, null);
    return null;
  }
}

/** Carrega a foto de um grupo pelo id (servidor de Miami primeiro). */
export async function loadGroupPhotoById(id: string, clientId?: string): Promise<string | null> {
  // O cliente explícito evita que o carregamento em background troque de
  // conta quando a lista termina e `activeClient` volta ao valor anterior.
  const cid = clientId ?? activeClient.get() ?? "";
  const pKey = photoCacheKey(id, cid);
  if (photoCache.has(pKey)) return photoCache.get(pKey) ?? null;
  if (cid) {
    try {
      const { isMiamiOwned, miamiPhoto } = await import("@/lib/miamiBridge");
      if (await isMiamiOwned(cid)) {
        const url = await miamiPhoto(cid, id);
        // Não guarda falhas/null indefinidamente: a próxima abertura tenta de
        // novo. Fotos válidas continuam em cache para abrir instantaneamente.
        if (url) photoCache.set(pKey, url);
        return url;
      }
    } catch {
      return null;
    }
  }
  const chat = chatCache.get(peerCacheKey("id", id));
  if (!chat) return null;
  return getGroupPhoto(chat);
}


/**
 * Sincroniza nome e foto dos grupos monitorados de um cliente com o Telegram.
 * Chamado em background ao abrir uma página que renderiza esses grupos.
 */
export async function syncClientGroupsMeta(clientId: string): Promise<void> {
  if (!clientId) return;
  return withActiveClient(clientId, () => syncClientGroupsMetaInner(clientId));
}

async function syncClientGroupsMetaInner(clientId: string): Promise<void> {
  try {
    invalidateGroupsCache(clientId);
    await listGroups(clientId); // já atualiza nomes e popula chatCache
    const stored = clientData.getGroups(clientId);
    let changed = false;
    for (const s of stored) {
      try {
        const url = await loadGroupPhotoById(s.id);
        if (url && url !== s.photoUrl) {
          clientData.upsertGroup(clientId, { ...s, photoUrl: url });
          changed = true;
        }
      } catch { /* ignore */ }
    }
    if (changed) {
      try { window.dispatchEvent(new CustomEvent("cloud:changed")); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

export async function getDraft(input: string): Promise<string | null> {
  try {
    const target = await resolveEntity(input);
    const targetId = String(target.id);
    const client = await getClientInternal();
    for await (const dialog of client.iterDialogs()) {
      const chat = dialog.chat ?? dialog.peer;
      if (String(chat?.id) !== targetId) continue;
      const d: any = dialog.draftMessage;
      const text = d?.text ?? d?.raw?.message ?? null;
      return text || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function checkOpen(input: string): Promise<OpenStatus> {
  try {
    const entity = await resolveEntity(input);
    const perms: any = entity?.defaultPermissions;
    if (!perms) return "open";
    // canSendText / canSendMessages = true → grupo aberto
    const canSend = perms.canSendText ?? perms.canSendMessages;
    if (canSend === undefined) return "open";
    return canSend ? "open" : "closed";
  } catch (err) {
    console.warn("[checkOpen] error", err);
    return "unknown";
  }
}

export async function sendMessageTo(entity: any, text: string): Promise<void> {
  const client = await getClientInternal();
  await client.sendText(entity.inputPeer ?? entity, text);
}

export async function sendMessage(input: string, text: string): Promise<void> {
  const entity = await resolveEntity(input);
  await sendMessageTo(entity, text);
}

export async function resolveGroup(input: string): Promise<ResolvedGroup> {
  const cid = activeClient.get() ?? "";
  if (cid) {
    const { miamiResolve, isMiamiOwned } = await import("@/lib/miamiBridge");
    // Conta logada no servidor de Miami: tudo vem de lá. Nada de cair pro
    // navegador (a sessão local não existe mais → 401 AUTH_KEY_UNREGISTERED).
    if (await isMiamiOwned(cid)) {
      const g = await miamiResolve(cid, input);
      if (!g) throw new Error("Não foi possível abrir esse grupo pelo servidor de Miami.");
      return {
        id: g.id,
        name: g.name,
        draft: g.draft ?? "",
        isChannel: !!g.isChannel,
        photoUrl: g.photoUrl ?? null,
        username: g.username ?? null,
      };
    }
  }
  const entity: any = await resolveEntity(input);
  const id = String(entity.id);
  const name = entity.title ?? entity.firstName ?? id;
  const [draft, photoUrl] = await Promise.all([getDraft(input), getGroupPhoto(entity)]);
  return {
    id,
    name,
    draft,
    isChannel: entity.chatType === "channel",
    photoUrl,
  };
}


// ============================================================
// Monitor — loop de envio + listener de updates push
// ============================================================

// Polling rápido — verifica a cada 10ms como fallback caso o push falhe.
// A detecção real ainda vem do listener de updates do mtcute.
const POLL_IDLE_MS = 0;
const ONLINE_REFRESH_MS = 20_000;
const HOT_SEND_MAX_INFLIGHT = 24;
const CLOSED_ERRORS = [
  "CHAT_WRITE_FORBIDDEN",
  "CHAT_SEND_PLAIN_FORBIDDEN",
  "CHAT_SEND_MESSAGES_FORBIDDEN",
  "SEND_MESSAGES_FORBIDDEN",
  "USER_BANNED_IN_CHANNEL",
  "SLOWMODE_WAIT",
];

type MonitorListener = (
  entries: LogEntry[],
  running: boolean,
  statuses: Record<string, string>,
  sends: SendInfo[],
) => void;

interface SendPayload {
  peer: any;
  text: string;
  randomId: Long;
}

function makeRandomId(): Long {
  const buf = new Uint8Array(8);
  (globalThis.crypto ?? (window as any).crypto).getRandomValues(buf);
  const lo = (buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0;
  const hi = (buf[4] | (buf[5] << 8) | (buf[6] << 16) | (buf[7] << 24)) >>> 0;
  return new Long(lo | 0, hi | 0, false);
}

function statusOfMember(m: any): string {
  return String(m?.status ?? m?.raw?._ ?? "");
}

function isAdminMember(m: any): boolean {
  const status = statusOfMember(m);
  return status === "creator" || status === "admin" || status === "channelParticipantCreator" || status === "chatParticipantCreator" || status === "channelParticipantAdmin" || status === "chatParticipantAdmin";
}

function memberUserId(m: any): string {
  return String(m?.user?.id ?? m?.userId ?? m?.raw?.userId ?? m?.raw?.peer?.userId ?? "");
}

function memberDisplayName(m: any): string | null {
  const u = m?.user;
  const full = `${u?.firstName ?? ""}${u?.lastName ? " " + u.lastName : ""}`.trim();
  return full || u?.username || memberUserId(m) || null;
}

function peerIdVariants(id: string): string[] {
  const raw = String(id || "");
  if (!raw) return [];
  const abs = raw.replace(/^-/, "").replace(/^100/, "");
  return Array.from(new Set([raw, abs, `-${abs}`, `-100${abs}`, `100${abs}`]));
}

function firstPresent(...values: any[]): string {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function chatIdFromIncomingMessage(message: any): string {
  const raw = message?.raw ?? message;
  return firstPresent(
    message?.chat?.id,
    raw?.peerId?.channelId,
    raw?.peerId?.chatId,
    raw?.peerId?.userId,
    raw?.peer_id?.channel_id,
    raw?.peer_id?.chat_id,
    raw?.peer_id?.user_id,
    raw?.chatId,
    raw?.chat_id,
  );
}

function senderIdFromIncomingMessage(message: any): { id: string; anonymous: boolean } {
  const raw = message?.raw ?? message;
  const id = firstPresent(
    message?.sender?.id,
    message?.from?.id,
    raw?.fromId?.userId,
    raw?.fromId?.channelId,
    raw?.fromId?.chatId,
    raw?.from_id?.user_id,
    raw?.from_id?.channel_id,
    raw?.from_id?.chat_id,
    raw?.senderId,
    raw?.userId,
  );
  // Se o remetente é o próprio chat/canal, é admin anônimo.
  const chatId = chatIdFromIncomingMessage(message);
  const anonymous = !!id && !!chatId && peerIdVariants(chatId).includes(String(id));
  return { id, anonymous };
}

async function collectChatMembers(client: any, target: any, type: "admins" | "all" = "admins"): Promise<any[]> {
  try {
    const list: any = await client.getChatMembers?.(target, { type, limit: 200 });
    const arr = Array.isArray(list) ? list : (list ? Array.from(list) : []);
    if (arr.length > 0) return arr;
  } catch {
    /* fallback abaixo */
  }
  const out: any[] = [];
  try {
    const it: any = client.iterChatMembers?.(target, { type, limit: 200 });
    if (it && typeof it[Symbol.asyncIterator] === "function") {
      for await (const m of it as AsyncIterable<any>) out.push(m);
    }
  } catch {
    /* ignore */
  }
  return out;
}

export async function getChatAdminInfo(client: any, target: any): Promise<{ ids: Set<string>; ownerId: string | null; ownerName: string | null; adminCount: number }> {
  let members = (await collectChatMembers(client, target, "admins")).filter(isAdminMember);
  if (members.length === 0) {
    members = (await collectChatMembers(client, target, "all")).filter(isAdminMember);
  }
  const ids = new Set<string>();
  let ownerId: string | null = null;
  let ownerName: string | null = null;
  for (const m of members) {
    const uid = memberUserId(m);
    if (uid) ids.add(uid);
    const status = statusOfMember(m);
    if (status === "creator" || status === "channelParticipantCreator" || status === "chatParticipantCreator") {
      ownerId = uid || ownerId;
      ownerName = memberDisplayName(m) ?? ownerName;
    }
  }
  return { ids, ownerId, ownerName, adminCount: members.length };
}

export async function isSenderAdmin(client: any, chatId: any, userId: any): Promise<boolean> {
  if (!client?.getChatMember || !chatId || !userId) return false;
  try {
    const member = await client.getChatMember({ chatId, userId });
    return !!member && isAdminMember(member);
  } catch {
    return false;
  }
}

class Monitor {
  private logs: LogEntry[] = [];
  private listeners = new Set<MonitorListener>();
  private running = false;
  private nextLogId = 1;
  private sent = new Set<string>();
  private statuses: Record<string, string> = {};
  private loopHandle: any = null;
  private peers = new Map<string, any>();
  private payloads = new Map<string, SendPayload>();
  // Cache de grupos ativos resolvido no start — evita ler localStorage no hot path do push.
  private groupCache = new Map<string, MonitoredGroup>();
  private lastPushLog = 0;
  private boundClient: any = null;
  private offRawUpdate: (() => void) | null = null;
  private offNewMessage: (() => void) | null = null;
  private keepaliveHandle: any = null;
  private onlineHandle: any = null;
  private openedChats: any[] = [];
  private sends: SendInfo[] = [];
  private adminCache = new Map<string, Set<string>>();
  private completed = new Set<string>();
  private inFlight = new Map<string, Promise<void>>();
  /** Marco da PRIMEIRA detecção de abertura por grupo (raw update ou poll). */
  private openMarks = new Map<string, number>();
  /** Prewarm state — evita re-executar preparação a cada mount/start. */
  private prewarmed = false;
  private prewarmedClient: string | null = null;
  private prewarmPromise: Promise<boolean> | null = null;
  /** Grupos que já aguardaram o horário ABE nesta sessão (método
   *  "abertura2"). Reset a cada start(). */
  private scheduleWaited = new Set<string>();
  /** Hot-path: pré-computados no start() pra evitar leituras de storage em fireOne. */
  private hotMethod: string = "abertura";
  private hotNeedsScheduleWait = false;
  private hotLabel = "após abertura";
  private hotClientTitle = "Cliente";
  private warmHandle: any = null;
  /** Segundo socket MTProto da mesma conta — corrida de pacotes no disparo. */
  private altClient: any = null;

  /** Janela quente: faltam <10s pro horário alvo do método "abertura2". */
  private inHotWindow(): boolean {
    if (!this.hotNeedsScheduleWait) return false;
    try {
      const cid = activeClient.get();
      const env = cid ? clientsStore.get(cid)?.scheduleEnv : null;
      if (!env) return false;
      const remaining = brasiliaTargetToday(env) - serverNow();
      return remaining > 0 && remaining <= 10000;
    } catch {
      return false;
    }
  }


  subscribe(fn: MonitorListener) {
    this.listeners.add(fn);
    fn(this.logs, this.running, this.statuses, this.sends);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    // clona statuses pra forçar nova referência (caso contrário React faz bail-out
    // e o autoStop / cards não disparam).
    const statusesCopy = { ...this.statuses };
    const sendsCopy = this.sends.slice();
    for (const fn of this.listeners) fn(this.logs, this.running, statusesCopy, sendsCopy);
  }

  private log(level: LogLevel, msg: string, opts?: { key?: string; pending?: boolean }) {
    this.logs = [
      ...this.logs,
      { id: this.nextLogId++, ts: Date.now(), level, msg, ...(opts ?? {}) },
    ].slice(-300);
    this.emit();
  }

  /** Substitui o texto de uma linha já publicada (ex.: senha apurada em Miami). */
  private patchLog(key: string, msg: string, pending = false) {
    let changed = false;
    this.logs = this.logs.map((e) => {
      if (e.key !== key) return e;
      changed = true;
      return { ...e, msg, pending };
    });
    if (changed) this.emit();
  }

  isRunning() { return this.running; }

  clearLogs() {
    this.logs = [];
    this.emit();
  }

  resetPrewarm() {
    this.prewarmed = false;
    this.prewarmedClient = null;
    this.prewarmPromise = null;
  }

  getPeerFor(groupId: string): any | undefined {
    return this.peers.get(groupId);
  }

  private async refreshPeerForInvalidGroup(g: MonitoredGroup, randomId: Long): Promise<{ group: MonitoredGroup; payload: SendPayload }> {
    forgetCachedGroupKeys(g.id, g.input, g.name);
    const peer = await resolveEntity(g.input, g.name, { force: true });
    const client = this.boundClient ?? (await getClientInternal());
    const sendPeer = await resolveSendPeer(client, peer);
    const nextId = String(peer.id ?? g.id);
    const nextName = peer.title ?? peer.firstName ?? g.name;
    let nextPhoto = g.photoUrl ?? null;
    try { nextPhoto = (await getGroupPhoto(peer)) ?? nextPhoto; } catch { /* ignore */ }
    const nextGroup: MonitoredGroup = {
      ...g,
      id: nextId,
      input: nextId,
      name: nextName,
      photoUrl: nextPhoto,
    };

    if (nextId !== g.id) {
      appStorage.removeGroup(g.id);
      appStorage.upsertGroup(nextGroup);
      this.statuses[nextId] = this.statuses[g.id] ?? "closed";
      delete this.statuses[g.id];
      const admins = this.adminCache.get(g.id);
      if (admins) {
        this.adminCache.set(nextId, admins);
        this.adminCache.delete(g.id);
      }
    } else if (nextName !== g.name || nextPhoto !== (g.photoUrl ?? null)) {
      appStorage.upsertGroup(nextGroup);
    }

    this.groupCache.delete(g.id);
    this.groupCache.set(nextId, nextGroup);
    this.peers.delete(g.id);
    this.peers.set(nextId, peer);
    const payload = { peer: sendPeer, text: nextGroup.message, randomId };
    this.payloads.delete(g.id);
    this.payloads.set(nextId, payload);
    this.sent.delete(g.id);
    return { group: nextGroup, payload };
  }

  clearSends() {
    this.sends = [];
    this.emit();
  }

  /**
   * Prepara o Monitor: conecta o cliente mtcute, resolve peers e carrega admins.
   * No painel, emite só o formato curto: "User; Conectado" e "Grupo; Nome".
   * Idempotente: se já rodou para o cliente ativo atual, é no-op.
   */
  async prewarm(): Promise<boolean> {
    if (this.running) return true;
    const cid = activeClient.get();
    if (this.prewarmed && this.prewarmedClient === cid) return true;
    if (this.prewarmPromise) return this.prewarmPromise;

    const run = async () => {
      // Reset do estado de preparação (não mexe em logs/sends — quem controla é clearLogs).
      this.peers.clear();
      this.payloads.clear();
      this.groupCache.clear();
      this.adminCache.clear();
      this.statuses = {};
      // Troca de cliente (ou primeiro prewarm): higieniza o estado do singleton
      // pra não vazar histórico entre contas diferentes.
      if (this.prewarmedClient !== cid) {
        this.sent.clear();
        this.sends = [];
      }

      const groups = appStorage.getGroups().filter((g) => g.active);
      for (const g of groups) {
        this.statuses[g.id] = "closed";
        this.groupCache.set(g.id, g);
      }
      this.emit();

      const clientTitle = (cid ? clientsStore.get(cid)?.title : null) ?? "Cliente";
      // Uma conta já ativa no VPS não pode ser aberta no browser durante o
      // prewarm, senão o Telegram passa a enxergar tráfego vindo de Jacareí.
      if (cid) {
        try {
          const { ensureMiamiAccount } = await import("@/lib/miamiBridge");
          if (await ensureMiamiAccount(cid, (level, msg) => this.log(level, msg), true)) {
            this.prewarmed = true;
            this.prewarmedClient = cid;
            this.log("success", `${clientTitle}; Conectado`);
            return true;
          }
        } catch { /* o start mostrará o erro real */ }
      }

      if (clientsStore.get(cid ?? "")?.hasSession !== false) {
        this.log("error", `${clientTitle}: não foi possível conectar no servidor de Miami.`);
      }
      return false;
    };

    this.prewarmPromise = run().finally(() => { this.prewarmPromise = null; });
    return this.prewarmPromise;
  }

  async start() {
    if (this.running) return;

    // Garante que a preparação foi feita (peers/payloads/admins).
    const miamiReady = await this.prewarm();
    if (!miamiReady) return;

    const groups = Array.from(this.groupCache.values());
    if (groups.length === 0) {
      this.log("error", "Nenhum grupo ativo. Adicione e ative ao menos um.");
      return;
    }

    this.running = true;
    // Pinta o botão como "Parar" na hora: o preparo com Miami continua abaixo.
    this.emit();

    this.sent.clear();
    this.completed.clear();
    this.inFlight.clear();
    this.openMarks.clear();
    this.sends = [];
    this.scheduleWaited.clear();
    // Pré-computa metadados do hot-path pra fireOne não tocar em storage.
    try {
      const cid = activeClient.get();
      const rec = cid ? clientsStore.get(cid) : null;
      this.hotMethod = rec?.method ?? "abertura";
      this.hotNeedsScheduleWait = this.hotMethod === "abertura2" && !!rec?.scheduleEnv;
      this.hotLabel = this.hotMethod === "mensagem" ? "após mensagem da guia" : "após abertura";
      this.hotClientTitle = rec?.title ?? "Cliente";
    } catch {
      this.hotMethod = "abertura";
      this.hotNeedsScheduleWait = false;
      this.hotLabel = "após abertura";
      this.hotClientTitle = "Cliente";
    }
    // Se o método é "abertura2", sincroniza o relógio pra disparar
    // no horário ABE exato.
    try {
      const rec = clientsStore.get(activeClient.get() ?? "");
      if (rec?.method === "abertura2") {
        const { syncServerClock } = await import("@/lib/brasiliaSync");
        await syncServerClock().catch(() => {});
      }
    } catch { /* ignore */ }
    for (const g of groups) {
      const payload = this.payloads.get(g.id);
      if (payload) {
        this.payloads.set(g.id, { ...payload, text: g.message, randomId: makeRandomId() });
      }
      this.statuses[g.id] = "closed";
    }
    {
      const cid = activeClient.get();
      const clientTitle = (cid ? clientsStore.get(cid)?.title : null) ?? "Cliente";
      // Turbo Miami: robô do VPS assume o disparo quando disponível.
      let taken: string[] = [];
      try {
        if (cid) {
          const rec = clientsStore.get(cid);
          const targetMs =
            rec?.method === "abertura2" && rec?.scheduleEnv
              ? brasiliaTargetToday(rec.scheduleEnv)
              : null;
          taken = await armMiami({
            clientId: cid,
            clientTitle,
            groups,
            targetMs,
            log: (level, msg, opts) => this.log(level, msg, opts),
            patch: (key, msg, pending) => this.patchLog(key, msg, pending),
            onAllDone: () => this.stop("auto"),
          });
        }
      } catch (e) {
        this.log("error", `Turbo Miami falhou: ${String((e as Error)?.message ?? e)}`);
      }
      // Miami assumiu tudo: o navegador não abre conexão de monitoramento
      // nenhuma (sem updates loop, sem keep-alive, sem openChat), então a
      // conta fica logada apenas pelo servidor de Miami.
      if (taken.length && taken.length === groups.length) {
        this.emit();
        return;
      }
      this.running = false;
      this.log("error", "Monitoramento não iniciado: Miami não assumiu todos os grupos.");
      this.emit();
      return;
    }
    this.emit();


    let loopStarted = false;
    try {
      const client = await getClientInternal();
      this.boundClient = client;
      try {
        await client.startUpdatesLoop?.();
      } catch (e) {
        this.log("warn", `Loop de updates falhou: ${String((e as any)?.message ?? e)}`);
      }

      // Marca a conta como ONLINE uma única vez ao iniciar o monitor:
      // esse primeiro RPC "esquenta" a socket MTProto (sem ele, se o grupo
      // abrir logo em seguida o sendText corre contra o handshake e o
      // primeiro envio pode levar 5s+) e coloca a conta na fila prioritária
      // de "recentemente online" do Telegram. O refresh periódico não
      // reduz latência de update — só gasta quota — então foi removido.
      try { this.boundClient.call({ _: "account.updateStatus", offline: false }).catch((e: any) => console.warn("[online] updateStatus erro", e)); }
      catch (e) { console.warn("[online] updateStatus erro", e); }

      // Keep-alive: mantém socket MTProto + TLS quentes pra que o primeiro
      // envio após ociosidade não pague reconexão. getState é o call mais
      // barato do MTProto (~200 bytes) e serve de amostra de RTT.
      // Ritmo: 5s normal, 1s na janela quente (últimos 10s antes do alvo).
      if (this.warmHandle) { clearInterval(this.warmHandle); this.warmHandle = null; }
      let lastPing = 0;
      this.warmHandle = setInterval(() => {
        const c = this.boundClient;
        if (!c || !this.running) return;
        const now = performance.now();
        const interval = this.inHotWindow() ? 1000 : 5000;
        if (now - lastPing < interval - 50) return;
        lastPing = now;
        pingClient(c);
        if (this.altClient) pingClient(this.altClient);
      }, 1000);

      // Conexão secundária pronta (corrida de pacotes no disparo).
      void (async () => {
        try {
          const cid = activeClient.get();
          if (cid) this.altClient = await getAltClientForId(cid);
        } catch { /* segue com uma conexão só */ }
      })();


      const methodAtStart = (() => {
        try { return clientsStore.get(activeClient.get() ?? "")?.method ?? "abertura"; } catch { return "abertura"; }
      })();
      if (methodAtStart === "abertura" || methodAtStart === "abertura2") {
        this.loop();
        loopStarted = true;
      }

      const fireFromIncomingMessage = (message: any): boolean => {
        const peerId = chatIdFromIncomingMessage(message);
        if (!peerId) return false;
        const gid = peerIdVariants(peerId).find((id) => this.groupCache.has(id) && this.payloads.has(id));
        if (!gid) return false;
        const g = this.groupCache.get(gid);
        if (!g) return false;
        // Gate: só dispara se o remetente é admin/dono (ou admin anônimo = próprio chat).
        const { id: senderId, anonymous } = senderIdFromIncomingMessage(message);
        const admins = this.adminCache.get(gid);
        const isKnownAdmin = anonymous || (!!senderId && !!admins && admins.has(String(senderId)));
        if (!isKnownAdmin) {
          if (!senderId) return false;
          // Valida on-the-fly e atualiza cache; não bloqueia disparo desta vez se falhar.
          const peer = this.peers.get(gid);
          isSenderAdmin(this.boundClient, peer?.inputPeer ?? peer, senderId).then((ok) => {
            if (ok) {
              const set = this.adminCache.get(gid) ?? new Set<string>();
              set.add(String(senderId));
              this.adminCache.set(gid, set);
              const tDetect = performance.now();
              this.fireOne(g, tDetect).then(() => this.emit());
            }
          }).catch(() => {});
          return false;
        }
        const tDetect = performance.now();
        this.fireOne(g, tDetect).then(() => this.emit());
        return true;
      };

      const handler = (info: any) => {
        const updates: any[] = info?.update ? [info.update] : info?.updates ?? [];
        const method = (() => {
          try { return clientsStore.get(activeClient.get() ?? "")?.method ?? "abertura"; } catch { return "abertura"; }
        })();
        for (const u of updates) {
          const t = u?._;
          // Modo "mensagem" em teste: qualquer mensagem nova no grupo dispara o rascunho.
          if (method === "mensagem" && (t === "updateNewMessage" || t === "updateNewChannelMessage")) {
            fireFromIncomingMessage(u.message);
            continue;
          }
          if (t === "updateChannelDefaultBannedRights" || t === "updateChatDefaultBannedRights") {
            if (method !== "abertura" && method !== "abertura2") continue;
            // FIRE FIRST: dispara o send imediatamente, sem qualquer await/log/setState antes.
            const peerId = String(u.peer?.channelId ?? u.peer?.chatId ?? u.peer?.channel_id ?? u.peer?.chat_id ?? "");
            const tDetect = performance.now();
            // Hot path: NÃO ler storage aqui — usa o map de payloads pré-resolvidos.
            // Só dispara para os grupos com payload já pronto (peer + texto + randomId).
            const fired: Promise<void>[] = [];
            if (peerId) {
              const gid = peerIdVariants(peerId).find((id) => this.groupCache.has(id) && this.payloads.has(id));
              const g = gid ? this.groupCache.get(gid) : null;
              if (g) {
                fired.push(this.fireOne(g, tDetect));
              }
            } else {
              for (const gid of this.payloads.keys()) {
                const g = this.groupCache.get(gid);
                if (g) fired.push(this.fireOne(g, tDetect));
              }
            }
            // UI vem DEPOIS do disparo (sem log de evento — apenas iniciado, rascunho e encerramento).
            Promise.all(fired).then(() => this.emit());
          }
        }
      };
      const emitter: any = client.onRawUpdate ?? client.onUpdate;
      if (emitter?.add) {
        emitter.add(handler);
        this.offRawUpdate = () => emitter.remove?.(handler);
      } else if (typeof client.on === "function") {
        client.on("update", handler);
        this.offRawUpdate = () => client.off?.("update", handler);
      }
      // Camada D — listener único (onRawUpdate já cobre updateNewMessage /
      // updateNewChannelMessage). Não registramos onNewMessage pra evitar
      // fire duplo no mesmo evento.

      // KEEPALIVE 1: openChat — vem DEPOIS do listener, em background, para
      // não criar janela cega se o grupo abrir durante esse await.
      const peers = Array.from(this.peers.values()).slice(0, 10);
      this.openedChats = [];
      Promise.allSettled(peers.map(async (p) => {
        try {
          await client.openChat(p.inputPeer ?? p);
          this.openedChats.push(p);
        } catch (e) {
          if (!isPeerInvalidError(e)) this.log("warn", `openChat falhou: ${String((e as any)?.message ?? e)}`);
        }
      })).catch(() => {});

      // KEEPALIVE via openChat acima já é suficiente: o mtcute pinga o DC
      // sozinho enquanto o chat está aberto. Pings extras via
      // help.getNearestDc não reduzem latência do onRawUpdate — apenas
      // competem pelo mesmo WebSocket no momento do disparo.
    } catch (e) {
      this.log("warn", `Listener de updates falhou: ${String((e as any)?.message ?? e)}`);
    }

      if (!loopStarted) this.loop();
  }

  stop(reason?: "auto" | "manual") {
    if (!this.running) return;
    this.running = false;
    void disarmMiami();
    if (this.loopHandle) {
      clearTimeout(this.loopHandle);
      this.loopHandle = null;
    }
    if (this.keepaliveHandle) {
      clearInterval(this.keepaliveHandle);
      this.keepaliveHandle = null;
    }
    if (this.warmHandle) {
      clearInterval(this.warmHandle);
      this.warmHandle = null;
    }
    if (this.onlineHandle) {
      clearInterval(this.onlineHandle);
      this.onlineHandle = null;
    }
    // Marca offline ao parar (best-effort).
    try { this.boundClient?.call({ _: "account.updateStatus", offline: true }); } catch { /* ignore */ }
    // fecha chats abertos pra parar o ping interno do mtcute
    const client = this.boundClient;
    const opened = this.openedChats;
    this.openedChats = [];
    if (client) {
      for (const p of opened) {
        client.closeChat(p.inputPeer ?? p).catch(() => { /* ignore */ });
      }
    }
    try { this.offRawUpdate?.(); } catch { /* ignore */ }
    this.offRawUpdate = null;
    try { this.offNewMessage?.(); } catch { /* ignore */ }
    this.offNewMessage = null;
    this.sent.clear();
    this.completed.clear();
    this.inFlight.clear();
    this.openMarks.clear();
    this.boundClient = null;
    this.log(
      "info",
      reason === "auto" ? "Interrompido; automático" : "Interrompido; manual",
    );
  }

  private async loop() {
    const method = (() => {
      try { return clientsStore.get(activeClient.get() ?? "")?.method ?? "abertura"; } catch { return "abertura"; }
    })();
    if (method === "mensagem") {
      // event-driven — nenhum polling.
      this.loopHandle = setTimeout(() => {}, 0);
      return;
    }
    if (method === "abertura2") {
      // Modo "Grupo aberto 2": não espera o grupo abrir. Só aguarda o
      // horário exato de Brasília definido em scheduleEnv e dispara em
      // todos os grupos ativos ao mesmo tempo (uma única vez).
      this.loopHandle = setTimeout(() => {}, 0);
      try {
        const cid = activeClient.get();
        const rec = cid ? clientsStore.get(cid) : null;
        if (rec?.scheduleEnv) {
          const { waitUntilBrasilia } = await import("@/lib/brasiliaSync");
          await waitUntilBrasilia(rec.scheduleEnv, () => !this.running, sendLeadMs());
        }
      } catch { /* ignore — dispara mesmo assim */ }
      if (!this.running) return;
      const groups = Array.from(this.groupCache.values());
      // Marca todos como já "aguardados" pra fireOne não esperar de novo.
      for (const g of groups) this.scheduleWaited.add(g.id);
      await Promise.all(groups.map((g) => this.fireOne(g, performance.now())));
      this.emit();
      return;
    }
    // Event-driven: uma tentativa inicial (cobre grupo já aberto no start)
    // e depois confia no handler de updateChannelDefaultBannedRights pra
    // reagir no instante em que o Telegram avisa que a permissão mudou.
    // Safety-net rápido só como fallback. O inFlight/completed evita spam e log duplicado.
    const SAFETY_POLL_MS = 40;
    const inFlight = new Map<string, boolean>();
    const runGroupLoop = async (g: MonitoredGroup) => {
      let closedTries = 0;
      while (this.running) {
        const stillActive = appStorage.getGroups().find((x) => x.id === g.id)?.active;
        if (!stillActive) return;
        if (this.statuses[g.id] === "open" || this.completed.has(g.id)) { this.emit(); return; }
        if (!inFlight.get(g.id)) {
          inFlight.set(g.id, true);
          try {
            await this.fireOne(g, performance.now());
          } finally {
            inFlight.set(g.id, false);
          }
        }
        if (this.statuses[g.id] === "open" || this.completed.has(g.id)) { this.emit(); return; }
        closedTries++;
        // Backoff suave: o gatilho real é o raw update. Sondar com sendText a
        // cada 40ms por minutos gera FLOOD_WAIT e ATRASA o envio de verdade.
        // Janela quente: 40ms fixos por ~30s. Só em ociosidade longa desacelera.
        const wait = closedTries < 750 ? SAFETY_POLL_MS : closedTries < 1500 ? 100 : 250;
        await new Promise((r) => setTimeout(r, wait));
      }
    };
    const loops: Promise<void>[] = [];
    for (const g of this.groupCache.values()) {
      loops.push(runGroupLoop(g));
    }
    this.loopHandle = setTimeout(() => {}, 0);
    await Promise.all(loops);
    this.emit();
  }

  /**
   * Caminho ultra-rápido: usa o payload pré-montado (peer + texto + randomId)
   * e dispara o sendText como PRIMEIRA instrução. UI/log só depois.
   */
  private async fireOne(g: MonitoredGroup, tDetect?: number) {
    // Trava por grupo: raw update + polling podem chegar juntos. Se já tem
    // envio em voo, não dispara outro sendText e não gera segundo log.
    if (this.statuses[g.id] === "open" || this.completed.has(g.id)) return;
    const existing = this.inFlight.get(g.id);
    if (existing) return existing;

    const work = this.fireOneLocked(g, tDetect).finally(() => {
      this.inFlight.delete(g.id);
      this.emit();
    });
    this.inFlight.set(g.id, work);
    return work;
  }

  private async fireOneLocked(g: MonitoredGroup, tDetect?: number) {
    if (!this.running || this.statuses[g.id] === "open" || this.completed.has(g.id)) return;
    // Robô de Miami assumiu esse grupo: o navegador não envia (sem duplicata).
    {
      const cid = activeClient.get();
      if (cid && isAgentArmed(cid, g.id)) return;
    }
    // "Grupo aberto 2": grupo já detectado, mas aguarda o horário ABE
    // exato de Brasília antes de disparar. Espera 1x por grupo, com
    // precisão de ms.
    let waitedSchedule = false;
    if (this.hotNeedsScheduleWait && !this.scheduleWaited.has(g.id)) {
      this.scheduleWaited.add(g.id);
      try {
        const cid = activeClient.get();
        const rec = cid ? clientsStore.get(cid) : null;
        if (rec?.scheduleEnv) {
          const { waitUntilBrasilia } = await import("@/lib/brasiliaSync");
          await waitUntilBrasilia(rec.scheduleEnv, () => !this.running, sendLeadMs());
          if (!this.running) return;
          if (this.statuses[g.id] === "open" || this.completed.has(g.id)) return;
          waitedSchedule = true;
        }
      } catch { /* ignore — cai no envio normal */ }
    }
    // T0 = PRIMEIRA detecção do grupo aberto (raw update ou poll). Ancorado
    // por grupo pra que retentativas não reiniciem o cronômetro. Se houve
    // espera agendada, o cronômetro recomeça no instante do horário alvo.
    let T0: number;
    if (waitedSchedule) {
      T0 = performance.now();
      this.openMarks.set(g.id, T0);
    } else {
      const mark = this.openMarks.get(g.id);
      T0 = mark ?? tDetect ?? performance.now();
      if (mark === undefined) this.openMarks.set(g.id, T0);
    }
    // T1 = checagem da conexão ativa.
    const T1 = performance.now();
    const clientReady = !!this.boundClient;
    // T2 = resolução do peer (pré-resolvido em memória → instantâneo).
    const T2 = performance.now();
    // Payload já pronto em memória — nada de resolver peer agora.
    const payload = this.payloads.get(g.id);
    let sendPromise: Promise<any>;
    let T3: number;
    if (payload && clientReady) {
      // T3 = disparo (PRIMEIRA instrução, sem await intermediário).
      // Hedging: o mesmo randomId em ondas escalonadas, alternando entre as
      // duas conexões. O Telegram deduplica no servidor (nunca duplica) e
      // vence o primeiro ack — se um socket travar esperando salt/handshake,
      // a onda seguinte responde em ~150ms em vez de segundos.
      T3 = performance.now();
      const conns = [this.boundClient, this.altClient].filter(Boolean);
      sendPromise = hedgedSend(conns, payload, { alive: () => this.running });

    } else {

      // Fallback: peer não foi pré-resolvido (resolução falhou no start).
      T3 = performance.now();
      sendPromise = (async () => {
        const peer = this.peers.get(g.id) ?? (await resolveEntity(g.input, g.name));
        const client = this.boundClient ?? (await getClientInternal());
        const sendPeer = await resolveSendPeer(client, peer);
        // Camada C — randomId estável mesmo no fallback pra dedupe do Telegram.
        const existing = this.payloads.get(g.id);
        const rid = existing?.randomId ?? makeRandomId();
        if (!existing) {
          this.payloads.set(g.id, { peer: sendPeer, text: g.message, randomId: rid });
        }
        return client.sendText(sendPeer, g.message, { randomId: rid });
      })();
    }
    // ===== DISPATCH SEM LOG OTIMISTA =====
    // ANTES: logávamos sucesso já em T3 (dispatch) assumindo que o
    // randomId dedup do Telegram sela o envio. Mas se o grupo estiver
    // fechado (CHAT_SEND_PLAIN_FORBIDDEN etc.), o dispatch "sai" mas a
    // mensagem é recusada pelo servidor — resultado: falso positivo
    // ("enviado em 0.001s" sem envio real).
    //
    // AGORA: só marcamos "open"/sent e logamos sucesso APÓS o ack do
    // servidor (T4). Se der CLOSED_ERROR ou peer inválido, tratamos como
    // fechado sem log de sucesso. O multi já faz assim e não tem falso
    // positivo — alinhamos os dois caminhos.
    const dt = Math.max(1, Math.round(T3 - T0));
    const logSuccessOnce = (ackMs?: number, target: MonitoredGroup = g) => {
      if (this.completed.has(g.id) || this.completed.has(target.id) || this.statuses[target.id] === "open") return false;
      this.completed.add(g.id);
      this.completed.add(target.id);
      this.statuses[g.id] = "open";
      this.statuses[target.id] = "open";
      this.sent.add(target.id);
      // Número principal = detecção → disparo (comparável aos antigos 0.19s).
      // Entre parênteses, o tempo até a confirmação do servidor.
      const ack = typeof ackMs === "number" ? ackMs : dt;
      this.log("success", `${this.hotClientTitle}; Enviado; confirmado em ${(ack / 1000).toFixed(2)}s`);
      return true;
    };

    try {
      const msg: any = await sendPromise;
      if (!this.running) return;
      const T4 = performance.now();
      const rtt = Math.round(T4 - T0);
      // Sucesso confirmado pelo servidor.
      if (!logSuccessOnce(rtt)) return;
      // Diagnóstico detalhado (T3→T4) sai do caminho quente.
      queueMicrotask(() => {
        const r = (a: number, b: number) => Math.round(b - a);
        const timings = `T0→T1: ${r(T0, T1)}ms | T1→T2: ${r(T1, T2)}ms | T2→T3: ${r(T2, T3)}ms | T3→T4: ${r(T3, T4)}ms`;
        console.log(`[fireOne] '${g.name}' dispatch=${dt}ms ack=${rtt}ms ${timings}`);
      });
      const tgDate: number | undefined = msg?.date ?? msg?.raw?.date;
      const tgMsgId: number | undefined = msg?.id ?? msg?.raw?.id;
      if (typeof tgDate === "number" && typeof tgMsgId === "number") {
        if (this.sends.some((s) => s.groupId === g.id && s.messageId === Number(tgMsgId))) return;
        const dupPrev = this.sends.find(
          (s) => s.groupId === g.id && Math.abs(Number(tgDate) - s.dateSec) <= 60,
        );
        if (dupPrev && dupPrev.messageId !== Number(tgMsgId)) {
          this.log(
            "error",
            `Duplicata detectada em '${g.name}': mensagem enviada 2x (msgIds ${dupPrev.messageId} e ${tgMsgId}).`,
          );
        }
        this.sends = [
          ...this.sends,
          { groupId: g.id, groupName: g.name, messageId: Number(tgMsgId), dateSec: Number(tgDate) },
        ];
        this.emit();
      }
    } catch (e: any) {
      // Compatível também com AggregateError de versões anteriores: escolhe
      // a mensagem mais informativa para classificação abaixo.
      const rawErrors: any[] = Array.isArray(e?.errors) ? e.errors : [e];
      const pickErr = (): any => {
        const score = (m: string) => {
          if (isPeerInvalidError({ message: m })) return 5;
          if (m.includes("FLOOD")) return 4;
          if (CLOSED_ERRORS.some((c) => m.includes(c))) return 3;
          if (/AUTH_KEY_UNREGISTERED|CONNECTION_NOT_INITED|SESSION_REVOKED|SESSION_PASSWORD_NEEDED|not connected|no client|Client is not started/i.test(m)) return 2;
          return 1;
        };
        let best = rawErrors[0];
        let bestScore = -1;
        for (const err of rawErrors) {
          const s = score(String(err?.message ?? err));
          if (s > bestScore) { bestScore = s; best = err; }
        }
        return best;
      };
      const chosen = pickErr();
      const errMsg = String(chosen?.message ?? chosen);
      // Monitor já parou (encerramento automático / stop manual): silencia
      // rejeições em background — cliente desconectou depois do dispatch,
      // não é "grupo fechou".
      if (!this.running) {
        console.warn(`[fireOne] ack pós-stop em '${g.name}': ${errMsg}`);
        return;
      }
      if (isPeerInvalidError(chosen)) {
        // Ainda não marcamos como open — só tentamos refresh.
        try {
          const rid = payload?.randomId ?? this.payloads.get(g.id)?.randomId ?? makeRandomId();
          const refreshed = await this.refreshPeerForInvalidGroup(g, rid);
          const client = this.boundClient ?? (await getClientInternal());
          const msg: any = await client.sendText(refreshed.payload.peer, refreshed.payload.text, { randomId: refreshed.payload.randomId });
          if (!logSuccessOnce(undefined, refreshed.group)) return;
          const tgDate: number | undefined = msg?.date ?? msg?.raw?.date;
          const tgMsgId: number | undefined = msg?.id ?? msg?.raw?.id;
          if (typeof tgDate === "number" && typeof tgMsgId === "number") {
            this.sends = [
              ...this.sends,
              { groupId: refreshed.group.id, groupName: refreshed.group.name, messageId: Number(tgMsgId), dateSec: Number(tgDate) },
            ];
          }
          return;
        } catch (e2) {
          this.log("warn", `Grupo '${g.name}' com referência inválida: ${String((e2 as any)?.message ?? e2)}`);
          return;
        }
      }
      if (CLOSED_ERRORS.some((c) => errMsg.includes(c))) {
        this.statuses[g.id] = "closed";
        this.sent.delete(g.id);
        // O grupo ainda estava fechado: o marco de "abertura" dessa tentativa
        // não vale — descarta pra não inflar o cronômetro do envio real.
        this.openMarks.delete(g.id);
        // Igual ao monitoramento multi: grupo fechado é estado normal de
        // espera, não erro visível. O monitor continua aguardando a abertura
        // e só registra log quando o envio for confirmado pelo servidor.
        return;
      }
      if (errMsg.includes("FLOOD")) {
        const m = /FLOOD_WAIT_(\d+)/.exec(errMsg);
        const secs = m ? parseInt(m[1], 10) : 5;
        this.log("warn", `Flood wait ${secs}s em '${g.name}'`);
        return;
      }
      const PRE_SEND_ERRORS = [
        "AUTH_KEY_UNREGISTERED",
        "CONNECTION_NOT_INITED",
        "SESSION_REVOKED",
        "SESSION_PASSWORD_NEEDED",
        "not connected",
        "no client",
        "Client is not started",
      ];
      const isPreSend = PRE_SEND_ERRORS.some((c) => errMsg.toLowerCase().includes(c.toLowerCase()));
      if (isPreSend) {
        this.statuses[g.id] = "closed";
        this.sent.delete(g.id);
        // Conexão/sessão caiu no meio do monitoramento: tenta restabelecer
        // sozinho em vez de ficar tentando com um client morto.
        void this.tryReconnect(errMsg);
      } else {
        // Erro pós-dispatch opaco: não retenta para evitar duplicata, mas
        // também não loga sucesso sem confirmação do servidor.
        this.completed.add(g.id);
        this.statuses[g.id] = "unknown";
        console.warn(`[fireOne] ack falhou em '${g.name}': ${errMsg}`);
      }
    }
  }

  /** Reconecta a conta ativa quando o envio falha por sessão/conexão caída. */
  private reconnecting: Promise<void> | null = null;
  private async tryReconnect(errMsg: string) {
    if (!this.running) return;
    if (this.reconnecting) return this.reconnecting;
    const cid = activeClient.get();
    if (!cid) {
      this.log("error", `Erro pré-envio: ${errMsg}`);
      return;
    }
    this.reconnecting = (async () => {
      try {
        this.log("warn", "Conexão caiu — reconectando a conta...");
        const client = await reconnectClientForId(cid);
        this.boundClient = client;
        this.log("info", "Conexão restabelecida. Monitoramento continua.");
      } catch (e) {
        const m = String((e as any)?.message ?? e);
        if (isFatalAuthError(e)) {
          this.log("error", "Sessão do Telegram expirou nessa conta. Reconecte-a para continuar.");
        } else {
          this.log("warn", `Não consegui reconectar agora (${m}) — vou tentar de novo.`);
        }
      } finally {
        this.reconnecting = null;
      }
    })();
    return this.reconnecting;
  }
}

export const monitor = new Monitor();

// ============================================================
// Verificação prévia do modo "Grupo aberto"
// ============================================================

export interface OpenGroupVerification {
  groupId: string;
  groupName: string;
  members: number | null;
  ownerName: string | null;
  ownerId: string | null;
  adminCount: number;
  error?: string;
}

/**
 * Verifica cada grupo ativo de um cliente: resolve peer, conta membros,
 * lista admins e identifica o dono (creator). Popula caches em memória
 * para que o start subsequente não precise refazer as chamadas.
 */
export async function verifyOpenGroupsFor(clientId: string): Promise<OpenGroupVerification[]> {
  const { clientData } = await import("@/lib/storage");
  const groups = clientData.getGroups(clientId).filter((g) => g.active);
  const client = await getClientForId(clientId);
  const results: OpenGroupVerification[] = [];
  for (const g of groups) {
    try {
      // resolve
      let peer: any = null;
      try { peer = await client.getChat(g.input); }
      catch {
        // fallback via resolveEntity (mais tolerante)
        peer = await resolveEntity(g.input, g.name);
      }
      const target = peer?.inputPeer ?? peer;
      // members
      let members: number | null = null;
      try {
        const n = await (client.getChatMemberCount?.(target) ?? client.getChatMembersCount?.(target));
        if (typeof n === "number") members = n;
      } catch { /* ignore */ }
      // admins + owner
      let ownerName: string | null = null;
      let ownerId: string | null = null;
      let adminCount = 0;
      try {
        const info = await getChatAdminInfo(client, target);
        ownerName = info.ownerName;
        ownerId = info.ownerId;
        adminCount = info.adminCount;
      } catch (e: any) {
        throw new Error(`Falha ao listar admins: ${String(e?.message ?? e)}`);
      }
      results.push({
        groupId: g.id,
        groupName: g.name,
        members,
        ownerName,
        ownerId,
        adminCount,
      });
    } catch (e: any) {
      results.push({
        groupId: g.id,
        groupName: g.name,
        members: null,
        ownerName: null,
        ownerId: null,
        adminCount: 0,
        error: String(e?.message ?? e),
      });
    }
  }
  return results;
}

/**
 * Conta quantas mensagens foram enviadas no MESMO MINUTO do nosso envio
 * e estão ACIMA da nossa no histórico do grupo (ou seja: foram enviadas
 * milissegundos antes). Esse número costuma corresponder à "senha".
 */