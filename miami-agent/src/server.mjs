// Agente de envio "Miami" — roda num VPS perto do datacenter do Telegram
// (DC1/DC3 ficam em Miami). O site continua sendo o cérebro (cadastro,
// clientes, grupos); este processo só mantém as contas quentes e dispara a
// mensagem no instante da abertura, com RTT de ~5-15ms em vez de ~200ms.
//
// Segurança: toda rota exige o header Authorization: Bearer <AGENT_TOKEN>.
// As string sessions ficam só em memória + disco local do VPS.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { TelegramClient, Long, networkMiddlewares } from "@mtcute/node";
import { convertFromTelethonSession } from "@mtcute/convert";

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.AGENT_TOKEN || "";
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

if (!TOKEN) {
  console.error("AGENT_TOKEN não configurado. Abortando.");
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

/** Conexões sem soneca automática: nenhum retry interno com sleep (1s em
 *  RANDOM_ID_DUPLICATE, até 10s em FLOOD_WAIT). O erro volta na hora e o laço
 *  do job decide o que fazer. */
function NO_SLEEP_MIDDLEWARES() {
  return networkMiddlewares.basic({
    floodWaiter: { maxWait: 0, maxRetries: 0 },
    internalErrors: { maxRetries: 0, waitTime: 0 },
  });
}


// Grupo que o Telegram não reconhece nessa sessão (cache de peers vazio após
// reconexão) ou do qual a conta saiu. É recuperável: re-resolvemos e tentamos
// de novo antes de desistir.
const PEER_RE = /PEER_ID_INVALID|CHANNEL_INVALID|CHAT_ID_INVALID|group_unreachable/i;
const CLOSED_RE =
  /CHAT_WRITE_FORBIDDEN|CHAT_SEND_PLAIN_FORBIDDEN|USER_BANNED_IN_CHANNEL|CHAT_RESTRICTED|SLOWMODE_WAIT|TOPIC_CLOSED|CHAT_ADMIN_REQUIRED/i;
// Duas conexões disparam juntas no instante 0 (mesmo randomId, o Telegram
// deduplica). Vence a que não pegar fila no socket. Ondas coladas: qualquer
// recuperação acontece dentro de uma piscada, não em 1 segundo.
const WAVES = [0, 0, 25, 60, 120, 220, 400];
// O Telegram às vezes devolve erro interno quando duas ondas idênticas chegam
// juntas. Isso significa que a mensagem JÁ foi aceita — é sucesso, não falha.
const DUP_RE = /RANDOM_ID_DUPLICATE/i;
const FLOOD_RE = /FLOOD_WAIT_(\d+)/i;
// Cadência fixa da sonda: 50 ms por conexão, duas conexões defasadas 25 ms.
// Rápido o bastante pra pegar a abertura, leve o bastante pra não enfileirar.
const USE_ALT = process.env.USE_ALT === "1";
// Leitura de permissões (sem envio) como recuperação, não para disputar posição.
const RECONCILE_MS = Number(process.env.RECONCILE_MS || 30_000);
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS || 12 * 3600_000);
const MAX_OPEN_CHATS = 10;
// Envia sem pedir o pacote de novidades na resposta (menos trabalho no Telegram).
const SEND_NO_UPDATES = process.env.SEND_NO_UPDATES === "1";

/** Estado de escrita de texto a partir do objeto do grupo.
 *  "unknown" quando o objeto é parcial (min) ou não veio. */
function channelWriteState(ch) {
  if (!ch || (ch._ !== "channel" && ch._ !== "chat")) return "unknown";
  if (ch.min) return "unknown";
  if (ch.creator || ch.adminRights) return "open";
  const own = ch.bannedRights;
  const nowS = Date.now() / 1000;
  if (own && (own.sendMessages || own.sendPlain) && (!own.untilDate || own.untilDate > nowS)) return "closed";
  const d = ch.defaultBannedRights;
  if (!d) return "unknown";
  return d.sendMessages || d.sendPlain ? "closed" : "open";
}


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Relógio da VPS é sincronizado por NTP; segundo atual dentro do minuto.
const serverSecondOfMinute = () => (Date.now() / 1000) % 60;

/** @type {Map<string, Account>} */
const accounts = new Map();
/** @type {Map<string, Job>} */
const jobs = new Map();
// Atrasos do próprio servidor (event loop) — diagnóstico, fora do envio.
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
setInterval(() => {
  if (!jobs.size) return loopDelay.reset();
  console.log("[event-loop]", { p50: +(loopDelay.percentile(50) / 1e6).toFixed(2), p99: +(loopDelay.percentile(99) / 1e6).toFixed(2), max: +(loopDelay.max / 1e6).toFixed(2), rssMB: Math.round(process.memoryUsage().rss / 1e6) });
  loopDelay.reset();
}, 60_000).unref();
/** @type {{ t: number, jobId: string, level: string, text: string }[]} */
let events = [];

function readRegistry() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRegistry() {
  const rows = [...accounts.values()].map((a) => ({
    clientId: a.clientId,
    apiId: a.apiId,
    apiHash: a.apiHash,
  }));
  const tmp = `${ACCOUNTS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows), { mode: 0o600 });
  fs.renameSync(tmp, ACCOUNTS_FILE);
  fs.chmodSync(ACCOUNTS_FILE, 0o600);
}

async function restoreAccounts() {
  for (const row of readRegistry()) {
    try {
      const acc = new Account(row.clientId, row.apiId, row.apiHash);
      await acc.connect(null);
      accounts.set(row.clientId, acc);
      console.log(`conta restaurada: ${row.clientId}`);
    } catch (e) {
      console.warn(`falha ao restaurar ${row.clientId}:`, String(e?.message ?? e));
    }
  }
  writeRegistry();
}

function log(jobId, level, text, extra) {
  events.push({ t: Date.now(), jobId, level, text, ...(extra ?? {}) });
  if (events.length > 800) events = events.slice(-500);
  console.log(`[${level}] ${jobId} ${text}`);
}

function randomId() {
  const b = crypto.randomBytes(8);
  return Long.fromBytesLE([...b], false);
}

// ---------------------------------------------------------------- contas
class Account {
  constructor(clientId, apiId, apiHash) {
    this.clientId = clientId;
    this.apiId = Number(apiId);
    this.apiHash = String(apiHash);
    this.main = null;
    this.alt = null;
    this.rtt = null;
    this.keepAlive = null;
    this.sentMessageIds = new Map();
    this.messageIdHandler = null;
    this.openChats = new Map();
  }

  // O site salva a sessão no formato GramJS/Telethon ("1AaBb..."), que o mtcute
  // não entende direto. Converte quando necessário.
  static normalizeSession(session) {
    if (!session) return null;
    const s = String(session).trim();
    if (!s) return null;
    if (s.startsWith("1")) {
      try {
        return convertFromTelethonSession(s);
      } catch (e) {
        throw new Error(`sessao_invalida: ${String(e?.message ?? e)}`);
      }
    }
    return s;
  }

  async connect(rawSession) {
    const session = Account.normalizeSession(rawSession);
    const mk = (suffix) =>
      new TelegramClient({
        apiId: this.apiId,
        apiHash: this.apiHash,
        storage: path.join(DATA_DIR, `${this.clientId}${suffix}.session`),
        floodSleepThreshold: 0,
        disableUpdates: suffix !== "",
        initConnectionOptions: DEVICE,
        // Sem sonecas automáticas: a biblioteca dormia 1s em RANDOM_ID_DUPLICATE
        // e até 10s em FLOOD_WAIT. Quem decide o recuo é o nosso laço.
        network: {
          middlewares: NO_SLEEP_MIDDLEWARES(),
          pingInterval: 10_000,
        },
      });


    this.main = mk("");
    // Uma conexão por conta: duas cópias da mesma autorização em paralelo
    // podem invalidar a sessão (AUTH_KEY_DUPLICATED). A alt só com USE_ALT=1.
    this.alt = USE_ALT ? mk("-alt") : null;
    for (const c of [this.main, this.alt].filter(Boolean)) {
      if (session) {
        try {
          await c.importSession(session, true);
        } catch (e) {
          console.warn("importSession", this.clientId, String(e));
        }
      }
      await c.connect();
    }
    // connect() não liga o loop de atualizações do mtcute; sem isso nenhuma
    // mensagem nova do grupo chega ao robô (modo "Grupo aberto" nunca dispara).
    try { await this.main.startUpdatesLoop?.(); } catch (e) { console.warn("updatesLoop", this.clientId, String(e)); }
    const me = await this.main.getMe();
    this.selfId = Number(me.id);
    this.messageIdHandler = (raw) => this.captureSentMessageIds(raw);
    this.main.onRawUpdate.add(this.messageIdHandler);
    this.startKeepAlive();
    return { id: Number(me.id), username: me.username ?? null, name: me.displayName ?? null };
  }

  startKeepAlive() {
    if (this.keepAlive) return;
    this.keepAlive = setInterval(async () => {
      for (const c of [this.main, this.alt]) {
        if (!c) continue;
        const t0 = Date.now();
        try {
          await c.call({ _: "updates.getState" });
          const dt = Date.now() - t0;
          this.rtt = this.rtt == null ? dt : Math.round(this.rtt * 0.7 + dt * 0.3);
        } catch {
          /* ignora */
        }
      }
    }, 5000);
  }

  captureSentMessageIds(raw) {
    forEachObject(raw, (item) => {
      if (item?._ !== "updateMessageID") return;
      const id = numericMessageId(item.id);
      const key = longKey(item.randomId);
      if (id === null || key === null) return;
      this.sentMessageIds.set(key, { id, at: Date.now() });
    });
    const cutoff = Date.now() - 120_000;
    for (const [key, value] of this.sentMessageIds) {
      if (value.at < cutoff) this.sentMessageIds.delete(key);
    }
  }

  sentMessageId(random) {
    const key = longKey(random);
    return key === null ? null : this.sentMessageIds.get(key)?.id ?? null;
  }

  /** openChat com contagem por grupo: dois jobs no mesmo grupo dividem a
   *  abertura e o closeChat só acontece quando o último termina. */
  async openPeer(peer) {
    const key = peerKey(peer);
    const cur = this.openChats.get(key);
    if (cur) { cur.count++; return true; }
    if (this.openChats.size >= MAX_OPEN_CHATS) return false;
    this.openChats.set(key, { count: 1 });
    await this.main.openChat(peer).catch(() => {});
    return true;
  }

  closePeer(peer) {
    const key = peerKey(peer);
    const cur = this.openChats.get(key);
    if (!cur) return;
    if (--cur.count > 0) return;
    this.openChats.delete(key);
    this.main?.closeChat(peer).catch(() => {});
  }

  async close() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    if (this.messageIdHandler) {
      try {
        this.main?.onRawUpdate.remove(this.messageIdHandler);
      } catch {
        /* ignora */
      }
      this.messageIdHandler = null;
    }
    for (const c of [this.main, this.alt]) {
      try {
        await c?.close();
      } catch {
        /* ignora */
      }
    }
  }
}

// ------------------------------------------------------- login em Miami
/** @type {Map<string, any>} */
const pendingAuth = new Map();

const DEVICE = {
  deviceModel: "PC 64Bit",
  // Não acrescentar versões do Linux/Node ao nome público do dispositivo.
  // O nome do aplicativo no aviso continua sendo definido pelo Telegram/API ID.
  systemVersion: "Windows 11",
  appVersion: "1.0",
  systemLangCode: "pt-BR",
  langCode: "pt",
};

function makeAuthClient(clientId, apiId, apiHash) {
  return new TelegramClient({
    apiId: Number(apiId),
    apiHash: String(apiHash),
    storage: path.join(DATA_DIR, `${clientId}-auth.session`),
    floodSleepThreshold: 0,
    disableUpdates: true,
    initConnectionOptions: DEVICE,
    network: {
      middlewares: NO_SLEEP_MIDDLEWARES(),
      pingInterval: 10_000,
    },
  });
}

// --------------------------------------------------------------- envio
/** Envia sem pedir nada além do necessário. `noUpdates` embrulha a chamada em
 *  invokeWithoutUpdates: o servidor não monta o pacote de novidades pra essa
 *  conexão, o que corta trabalho do lado do Telegram. */
async function fastSend(client, payload, opts = {}) {
  const query = {
    _: "messages.sendMessage",
    peer: payload.peer,
    message: payload.text,
    randomId: payload.randomId,
    noWebpage: true,
    ...(payload.silent ? { silent: true } : {}),
  };

  try {
    // floodSleepThreshold/maxRetryCount são lidos POR CHAMADA pela biblioteca
    // (o valor do construtor não chega ao middleware). Sem isso ela dorme até
    // 10s sozinha em um FLOOD_WAIT — foi essa a origem dos "3.04s".
    return await client.call(
      opts.noUpdates ? { _: "invokeWithoutUpdates", query } : query,
      { floodSleepThreshold: 0, maxRetryCount: 0 },
    );

  } catch (e) {
    // O erro sozinho não confirma o envio. O job só finaliza depois de
    // reconciliar o random_id com um id concreto de mensagem.
    if (DUP_RE.test(String(e?.message ?? e))) return { __duplicate: true };
    throw e;
  }
}

function numericMessageId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "bigint" && value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  if (Long.isLong(value)) {
    const n = value.toNumber();
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function longKey(value) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Long.isLong(value)) return value.toString();
  if (value && typeof value.toString === "function") {
    const text = value.toString();
    return /^-?\d+$/.test(text) ? text : null;
  }
  return null;
}

function forEachObject(root, visit) {
  if (!root || typeof root !== "object") return;
  const queue = [root];
  const visited = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object" || visited.has(item)) continue;
    visited.add(item);
    visit(item);
    for (const value of Object.values(item)) {
      if (value && typeof value === "object") {
        if (Array.isArray(value)) queue.push(...value);
        else queue.push(value);
      }
    }
  }
}

/** Extrai o id de todos os formatos de confirmação de messages.sendMessage. */
function extractMessageId(res, expectedRandomId) {
  if (!res || typeof res !== "object") return null;
  const expectedKey = longKey(expectedRandomId);
  let correlated = null;
  let responseMessage = null;
  forEachObject(res, (item) => {
    const direct = numericMessageId(item.id);
    if (direct === null) return;
    if (
      correlated === null &&
      item._ === "updateMessageID" &&
      expectedKey !== null &&
      longKey(item.randomId) === expectedKey
    ) {
      correlated = direct;
      return;
    }
    if (
      responseMessage === null &&
      (item === res ||
        item._ === "updateShortSentMessage" ||
        item._ === "updateShortMessage" ||
        item._ === "updateShortChatMessage" ||
        item._ === "updateNewMessage" ||
        item._ === "updateNewChannelMessage" ||
        item._ === "message")
    ) {
      responseMessage = direct;
    }
  });
  return correlated ?? responseMessage;
}

function senderId(m) {
  const f = m?.fromId ?? m?.peerId;
  const raw = f?.userId ?? f?.channelId ?? f?.chatId ?? f?.id;
  if (raw == null) return null;
  if (typeof raw === "bigint" && raw <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(raw);
  if (Long.isLong(raw)) {
    const n = raw.toNumber();
    return Number.isSafeInteger(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function comparableText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

/** As conexões rodam sem espera automática (isso é essencial no envio). Já a
 *  leitura da senha acontece depois do disparo e pode sim aguardar um pedido
 *  de pausa do Telegram — sem isso, um FLOOD_WAIT deixava o histórico vazio e
 *  a senha aparecia como "não encontrada". */
async function readCall(client, req, tries = 2) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      // Nunca espera para sempre: uma chamada presa travava a apuração da senha.
      return await Promise.race([
        client.call(req),
        new Promise((_, rej) => setTimeout(() => rej(new Error("read_timeout")), 8000)),
      ]);
    } catch (e) {
      lastErr = e;
      const flood = FLOOD_RE.exec(String(e?.message ?? e));
      if (!flood) throw e;
      const wait = Math.min(12, Number(flood[1]) || 1);
      await new Promise((r) => setTimeout(r, wait * 1000 + 200));
    }
  }
  throw lastErr;
}

async function latestMessageId(client, peer) {
  if (!client || !peer) return 0;
  const r = await readCall(client, {
    _: "messages.getHistory",
    peer,
    offsetId: 0,
    offsetDate: 0,
    addOffset: 0,
    limit: 1,
    maxId: 0,
    minId: 0,
    hash: Long.ZERO,
  });
  return numericMessageId(r?.messages?.[0]?.id) ?? 0;
}

/** Proteção excepcional caso o Telegram não entregue updateMessageID. */
async function findOwnSentId(client, peer, selfId, text, baselineId) {
  if (!client || !peer) return null;
  const expectedText = comparableText(text);
  const candidates = [];
  let maxId = 0;

  // A referência foi lida antes do disparo: qualquer mensagem nossa depois
  // dela pertence à execução atual, mesmo se o relógio local estiver diferente.
  for (let page = 0; page < 2; page++) {
    const r = await readCall(client, {
      _: "messages.getHistory",
      peer,
      offsetId: 0,
      offsetDate: 0,
      addOffset: 0,
      limit: 100,
      maxId,
      minId: baselineId > 0 ? baselineId : 0,
      hash: Long.ZERO,
    });
    const messages = (r?.messages ?? [])
      .map((m) => ({
        id: numericMessageId(m?.id),
        date: m?.date,
        out: m?.out,
        fromId: m?.fromId,
        peerId: m?.peerId,
        message: m?.message,
      }))
      .filter((m) => m.id !== null && typeof m.date === "number");
    if (!messages.length) break;

    for (const m of messages) {
      if (baselineId > 0 && m.id <= baselineId) continue;
      const own = m.out === true || (typeof selfId === "number" && senderId(m) === selfId);
      if (!own) continue;
      if (expectedText && comparableText(m.message) !== expectedText) continue;
      candidates.push(m);
    }

    const oldest = messages.at(-1);
    if (!oldest || (baselineId > 0 && oldest.id <= baselineId) || messages.length < 100) break;
    maxId = oldest.id;
  }
  if (!candidates.length) return null;
  // Primeiro envio nosso depois da referência. Isso impede pegar uma mensagem
  // igual de um teste posterior enquanto a apuração anterior ainda termina.
  candidates.sort((a, b) => a.id - b.id);
  return candidates[0]?.id ?? null;
}

/** Busca um bloco do histórico (mais recente → mais antigo), sem filtro de minuto. */
async function fetchHistoryBlock(client, peer, limit) {
  if (!client || !peer) return null;
  const r = await readCall(client, {
    _: "messages.getHistory",
    peer,
    offsetId: 0,
    offsetDate: 0,
    addOffset: 0,
    limit,
    maxId: 0,
    minId: 0,
    hash: Long.ZERO,
  });
  const messages = (r?.messages ?? [])
    .map((m) => ({ message: m, id: numericMessageId(m?.id) }))
    .filter((item) => item.id !== null);
  return messages.map(({ message: m, id }) => ({
    id,
    from: senderId(m),
    date: typeof m?.date === "number" ? m.date : null,
    text: String(m.message ?? ""),
  }));
}

/** Contagem por índice dentro do mesmo minuto do Telegram. A partir da minha
 *  mensagem, anda para as mais antigas até mudar o minuto, contando todo mundo
 *  (inclusive outras contas do site). Mensagens de serviço são ignoradas. */
function positionFromHistory(messages, idx, exclude) {
  if (typeof idx !== "number" || idx < 0) return null;
  const sentDate = messages[idx]?.date;
  if (typeof sentDate !== "number") return null;
  const sentMinute = Math.floor(sentDate / 60);
  let count = 0;
  for (let i = idx + 1; i < messages.length; i++) {
    const message = messages[i];
    if (typeof message.date !== "number" || Math.floor(message.date / 60) !== sentMinute) break;
    if (message.from === null) continue;
    if (exclude?.has(message.from)) continue;
    count++;
  }
  return count + 1;
}

/** Contagem determinística ancorada no id real da mensagem. Lê o histórico a
 *  partir dela (ela + anteriores), então não depende de janela compartilhada
 *  nem sofre com grupos movimentados onde muita gente envia junto. */
async function positionByAnchor(client, peer, sentId, exclude) {
  if (!client || !peer || typeof sentId !== "number" || sentId <= 0) return null;
  let count = 0;
  let sentMinute = null;
  let offsetId = sentId + 1;
  for (let page = 0; page < 4; page++) {
    const r = await readCall(client, {
      _: "messages.getHistory",
      peer,
      offsetId,
      offsetDate: 0,
      addOffset: 0,
      limit: 100,
      maxId: 0,
      minId: 0,
      hash: Long.ZERO,
    });
    const messages = (r?.messages ?? [])
      .map((m) => ({ id: numericMessageId(m?.id), date: typeof m?.date === "number" ? m.date : null, from: senderId(m) }))
      .filter((m) => m.id !== null);
    if (!messages.length) break;
    for (const m of messages) {
      if (m.id > sentId) continue;
      if (m.id === sentId) {
        if (m.date === null) return null;
        sentMinute = Math.floor(m.date / 60);
        continue;
      }
      if (sentMinute === null) continue;
      if (m.date === null || Math.floor(m.date / 60) !== sentMinute) return count + 1;
      if (m.from === null) continue;
      if (exclude?.has(m.from)) continue;
      count++;
    }
    const oldest = messages.at(-1);
    if (!oldest || messages.length < 100) break;
    offsetId = oldest.id;
  }
  return sentMinute === null ? null : count + 1;
}

/** Chave estável do grupo, pra juntar as contas que dispararam no mesmo chat. */
function peerKey(peer) {
  if (!peer) return "?";
  const id = peer.channelId ?? peer.chatId ?? peer.userId ?? "?";
  return `${peer._ ?? "peer"}:${String(id)}`;
}

function matchesPeer(actual, expected) {
  if (expected?._ === "inputPeerChannel") {
    return actual?._ === "peerChannel" && Number(actual.channelId) === Number(expected.channelId);
  }
  if (expected?._ === "inputPeerChat") {
    return actual?._ === "peerChat" && Number(actual.chatId) === Number(expected.chatId);
  }
  return false;
}

/** Apuração da senha: uma leitura por grupo, posições comparáveis entre contas. */
const positionGroups = new Map();
let positionBatchSequence = 0;

function registerForPosition({ key, jobId, sentId, base, account, conn, peer, selfId, text, finishedAt, baselineId, randomId, exclude }) {
  let g = positionGroups.get(key);
  if (!g) {
    g = { batchId: ++positionBatchSequence, entries: [], conn, peer, timer: null };
    positionGroups.set(key, g);
  }
  g.entries.push({
    jobId,
    sentId: numericMessageId(sentId),
    base,
    account,
    selfId,
    conn,
    peer,
    text,
    finishedAt,
    baselineId,
    randomId,
    exclude,
  });
  // Espera curta só pra juntar contas do mesmo lote (multi). A contagem é
  // ancorada no id de cada mensagem, então não precisa de mais folga.
  if (g.timer) clearTimeout(g.timer);
  g.timer = setTimeout(() => void resolvePositions(key), 350);
}

async function resolvePositions(key) {
  const g = positionGroups.get(key);
  if (!g || g.running) return;
  g.running = true;
  if (positionGroups.get(key)?.batchId === g.batchId) positionGroups.delete(key);
  if (g.timer) clearTimeout(g.timer);
  // Garante que toda linha recebe a senha final: tenta até 3 rodadas com prazo
  // e, no pior caso, fecha como "não encontrada" (nunca fica carregando).
  const done = new Set();
  for (let round = 0; round < 3 && done.size < g.entries.length; round++) {
    const pending = g.entries.filter((e) => !done.has(e.jobId));
    let results = null;
    try {
      results = await Promise.race([
        computePositions(g, pending),
        new Promise((r) => setTimeout(() => r(null), 25000)),
      ]);
    } catch (err) {
      console.log("[position] erro", String(err?.message ?? err));
    }
    for (const e of pending) {
      const pos = results?.get(e.jobId);
      if (typeof pos === "number" && pos > 0) {
        done.add(e.jobId);
        log(e.jobId, "patch", `${e.base} (Senha: ${pos})`, { key: e.jobId, pending: false });
      }
    }
    if (done.size < g.entries.length) await new Promise((r) => setTimeout(r, 2500));
  }
  for (const e of g.entries) {
    if (!done.has(e.jobId)) log(e.jobId, "patch", `${e.base} (Senha: não encontrada)`, { key: e.jobId, pending: false });
  }
}

async function computePositions(g, entries) {
  g = { ...g, entries };



  // 1) Cada conta descobre o próprio ID com a própria sessão (o `id` do
  // MTProto é local à sessão em grupos básicos). Isso serve só para exibição.
  await Promise.all(g.entries.map(async (e) => {
    if (typeof e.sentId === "number") return;
    const capturedId = e.account?.sentMessageId(e.randomId);
    if (typeof capturedId === "number") {
      e.sentId = capturedId;
      return;
    }
    try {
      e.sentId = await findOwnSentId(e.conn, e.peer, e.selfId, e.text, e.baselineId ?? 0);
    } catch {
      e.sentId = null;
    }
  }));

  // 1b) Com o id em mãos, a posição é contada ancorada nele: lê o histórico a
  // partir da própria mensagem. Funciona mesmo em grupo movimentado, onde a
  // janela compartilhada pode não conter todo mundo.
  const anchored = new Map();
  await Promise.all(g.entries.map(async (e) => {
    if (typeof e.sentId !== "number") return;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const pos = await positionByAnchor(e.conn, e.peer, e.sentId, e.exclude);
        if (typeof pos === "number" && pos > 0) {
          anchored.set(e.jobId, pos);
          return;
        }
      } catch {
        /* tenta de novo enquanto o histórico propaga */
      }
      await new Promise((r) => setTimeout(r, 400 + attempt * 400));
    }
  }));

  // Caminho rápido: todas as contas já têm a senha pelo próprio id. Não lê o
  // bloco compartilhado (era isso que segurava a senha por 8-10 s).
  if (g.entries.every((e) => anchored.has(e.jobId))) return anchored;




  // 2) Uma única conta observadora lê o chat inteiro. A posição é calculada
  // nessa janela compartilhada, casando por remetente + horário (+ texto),
  // porque `sender` e `date` são iguais em qualquer sessão — só o `id` varia.
  const observer = g.entries[0];
  let block = null;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const limit = attempt < 2 ? 200 : attempt < 4 ? 400 : 600;
      const snapshot = await Promise.race([
        fetchHistoryBlock(observer.conn, observer.peer, limit),
        new Promise((r) => setTimeout(() => r(null), 6000)),
      ]);
      // O histórico pode chegar antes da mensagem recém-enviada. Só encerra
      // cedo quando há conteúdo; senão aguarda a propagação e tenta de novo.
      if (snapshot?.length) {
        block = snapshot;
        break;
      }
      await new Promise((r) => setTimeout(r, 500 + attempt * 350));
    }
  } catch {
    block = null;
  }

  // Casamento por sender + tempo: janela apertada primeiro, afrouxando só se
  // preciso. Cada mensagem do histórico só pode ser reivindicada uma vez.
  const claimed = new Set();
  const matchIndex = new Map();
  if (block) {
    // Em canais/supergrupos o ID é global e é a identificação mais confiável.
    // Em grupos básicos ele pode variar por sessão, então o casamento abaixo
    // por remetente/horário/texto continua como fallback.
    for (const e of g.entries) {
      if (typeof e.sentId !== "number") continue;
      const direct = block.findIndex((m, i) => !claimed.has(i) && m.id === e.sentId);
      if (direct >= 0) {
        claimed.add(direct);
        matchIndex.set(e.jobId, direct);
      }
    }
    for (const windowSec of [2, 5, 15, 45]) {
      for (const e of g.entries) {
        if (matchIndex.has(e.jobId) || typeof e.selfId !== "number") continue;
        const sentSec = Math.floor(e.finishedAt / 1000);
        const wanted = comparableText(e.text);
        let best = -1;
        let bestScore = Infinity;
        for (let i = 0; i < block.length; i++) {
          if (claimed.has(i)) continue;
          const m = block[i];
          if (m.from !== e.selfId || m.date === null) continue;
          if (wanted && comparableText(m.text) !== wanted) continue;
          const diff = Math.abs(m.date - sentSec);
          if (diff > windowSec) continue;
          if (diff < bestScore) {
            bestScore = diff;
            best = i;
          }
        }
        if (best >= 0) {
          claimed.add(best);
          matchIndex.set(e.jobId, best);
        }
      }
    }
  }

  console.log("[position]", JSON.stringify({
    batchId: g.batchId,
    observer: observer?.account?.clientId ?? null,
    historyLength: block?.length ?? 0,
    peer: peerKey(observer?.peer),
    entries: g.entries.map((e) => ({
      account: e.account?.clientId ?? null,
      ownId: e.sentId ?? null,
      matchedIndex: matchIndex.has(e.jobId) ? matchIndex.get(e.jobId) : null,
    })),
  }));

  const out = new Map();
  for (const e of g.entries) {
    const idx = matchIndex.has(e.jobId) ? matchIndex.get(e.jobId) : null;
    const fromBlock = block && idx !== null ? positionFromHistory(block, idx, e.exclude) : null;
    const pos = anchored.get(e.jobId) ?? fromBlock;
    if (pos !== null && pos > 0) out.set(e.jobId, pos);
  }
  return out;
}

/** Hedging: mesmo randomId em ondas, alternando conexões. O Telegram
 *  deduplica pelo randomId, então nunca duplica a mensagem no chat.
 *  Resolve com `{ res, latency }` — latency é o tempo da onda que venceu,
 *  não a soma das esperas entre ondas. */
function hedgedSend(conns, payload) {
  return new Promise((resolve, reject) => {
    let done = false;
    let pending = WAVES.length;
    let firstErr = null;
    WAVES.forEach((delay, i) => {
      const conn = conns[i % conns.length];
      setTimeout(() => {
        if (done || !conn) {
          pending--;
          return;
        }
        const t0 = Date.now();
        // A conexão alternativa já usa `disableUpdates`, portanto o mtcute
        // aplica invokeWithoutUpdates sozinho. Não embrulhe duas vezes.
        fastSend(conn, payload).then(
          (r) => {
            if (done) return;
            done = true;
            resolve({ res: r, latency: Date.now() - t0 });
          },
          (e) => {
            firstErr ??= e;
            pending--;
            if (CLOSED_RE.test(String(e?.message ?? e))) {
              done = true;
              reject(e);
            } else if (pending <= 0 && !done) reject(firstErr);
          },
        );
      }, delay);
    });
  });
}

// ---------------------------------------------------------------- jobs
class Job {
  constructor(cfg, account) {
    this.id = cfg.jobId;
    this.cfg = cfg;
    this.acc = account;
    this.stopped = false;
    this.payload = null;
    this.openAt = null;
    this.sent = false;
    this.inFlight = false;
    this.firing = false;
    this.busy = new Set();
    this.lastSendAt = 0;
    this.nextAllowedAt = 0;
    this.jobPing = null;
    this.rawHandler = null;
    this.laneTimers = new Map();
    this.doneResolve = null;
    this.observationToken = 0;

  }

  async prewarm(force = false) {
    const chat = await resolveChatFlexible(this.acc, this.cfg.group, { force });
    const peer = chat.inputPeer ?? (await this.acc.main.resolvePeer(chat));
    this.payload = { peer, text: this.cfg.message, randomId: randomId() };
    // Mantém a conta online e este supergrupo aberto no próprio cliente do
    // Telegram. O mtcute recomenda isso para reduzir atrasos de atualização
    // quando o grupo está hospedado em outro DC.
    if (!this.chatOpened) this.chatOpened = await this.acc.openPeer(peer);
    await Promise.all([
      this.acc.main.call({ _: "account.updateStatus", offline: false }).catch(() => {}),
      this.acc.alt?.call({ _: "account.updateStatus", offline: false }).catch(() => {}),
    ]);
    // Aquece as duas conexões em paralelo antes da janela quente.
    await Promise.all(
      [this.acc.main, this.acc.alt].map((c) =>
        c ? c.call({ _: "updates.getState" }).catch(() => {}) : null,
      ),
    );
    // Limite inferior determinístico para reencontrar a mensagem caso o ACK
    // do Telegram não devolva seu id.
    this.baselineId = await latestMessageId(this.acc.main, peer).catch(() => 0);
  }


  async run() {
    try {
      await this.prewarm();
    } catch (e) {
      if (this.stopped) return;
      const msg = String(e?.message ?? e);
      if (PEER_RE.test(msg) || /group_not_found/i.test(msg)) return this.failPeer();
      throw e;
    }

    // A preparação pode terminar depois do cancelamento; libera também um
    // openPeer adquirido enquanto a chamada assíncrona estava em andamento.
    if (this.stopped) { this.stop(); return; }

    if (this.cfg.targetMs) {
      // Prazo monotônico: não pula se o relógio do sistema for ajustado.
      const lead = Math.min(250, Math.round((this.acc.rtt ?? 0) / 2));
      const deadline = performance.now() + (this.cfg.targetMs - Date.now() - lead);
      const coarse = deadline - performance.now() - 3;
      if (coarse > 0) await sleep(coarse);
      while (performance.now() < deadline) { /* espera fina de até 3 ms */ }
      if (this.stopped) return;
      this.openAt = Date.now();
      this.tl = { sinal: "horario", erroTimerMs: +(performance.now() - deadline).toFixed(2), recebido: performance.now() };
      await this.fire("horario");
      if (this.sent || this.stopped) return;
      // Recusado: volta a esperar o aviso de abertura, sem rajada.
    }

    // "Grupo aberto": só dispara quando o admin/dono mandar mensagem no grupo.
    if (!this.cfg.targetMs && this.cfg.method === "mensagem") return this.runOnAdminMessage();

    // Aviso do Telegram é o gatilho. Só conta sinal do próprio grupo que
    // mostre a escrita liberada; sem envio de teste com o grupo fechado.
    const peer = this.payload.peer;
    const chatId = Number(peer?.channelId ?? peer?.chatId ?? 0);
    const samePeer = (p) => matchesPeer(p, peer);
    this.admins = await this.loadAdmins();
    if (this.stopped) return;
    this.startedAt = Date.now();
    const selfId = Number(this.acc.selfId ?? 0);
    this.rawHandler = (info) => {
      if (this.sent || this.stopped) return;
      const upd = info?.update ?? info;
      if (this.confirmSentUpdate(info)) return;
      if (this.firing || this.reconciling) return;
      const recebido = performance.now();
      let open = null;
      let unknown = false;
      if (peer?._ === "inputPeerChannel" && upd?._ === "updateChannel" && Number(upd.channelId) === chatId) {
        const st = channelWriteState(info?.peers?.chats?.get?.(chatId));
        if (st === "open") open = "permissoes";
        else if (st === "unknown") unknown = true;
        else this.writeState = "closed";
      } else if (upd?._ === "updateChatDefaultBannedRights" && samePeer(upd.peer)) {
        const d = upd.defaultBannedRights;
        if (d && !d.sendMessages && !d.sendPlain) open = "permissoes";
      } else if (
        (upd?._ === "updateNewChannelMessage" || upd?._ === "updateNewMessage") &&
        upd.message?._ === "message" &&
        !upd.message.out &&
        samePeer(upd.message.peerId)
      ) {
        // Membro comum escrevendo = grupo aberto. Admin/dono escrevem fechado.
        const f = upd.message.fromId;
        const uid = f?._ === "peerUser" ? Number(f.userId) : 0;
        // Só mensagem nova: posterior ao início e acima do último id conhecido
        // (descarta histórico recuperado após reconexão).
        const mid = numericMessageId(upd.message.id) ?? 0;
        const fresh = mid > (this.baselineId ?? 0) && Number(upd.message.date ?? 0) * 1000 >= this.startedAt - 2000;
        if (uid && uid !== selfId && !this.admins.has(uid) && fresh) open = "mensagem-membro";
      }
      if (open) {
        this.tl = { sinal: open, recebido };
        this.openAt = Date.now();
        void this.fire(open);
      } else if (unknown) {
        void this.reconcileOnce();
      }
    };
    this.acc.main.onRawUpdate.add(this.rawHandler);
    this.startJobPing();
    // Conferência inicial (grupo já aberto) e reconciliação rara, só leitura.
    if (peer?._ === "inputPeerChannel") void this.reconcileOnce();
    else void this.fire("inicial", true);
    if (RECONCILE_MS > 0) this.reconcileTimer = setInterval(() => this.reconcileOnce(), RECONCILE_MS);
    this.ttlTimer = setTimeout(() => {
      if (this.sent || this.stopped) return;
      log(this.id, "info", "Interrompido; prazo do monitoramento expirou.");
      this.stop();
    }, JOB_TTL_MS);
    await new Promise((resolve) => {
      this.doneResolve = resolve;
    });
  }

  positionExclude() {
    const set = new Set(this.admins ?? []);
    set.delete(Number(this.acc?.selfId ?? 0));
    const peer = this.payload?.peer;
    const gid = Number(peer?.channelId ?? peer?.chatId ?? 0);
    if (gid) set.add(gid);
    return set;
  }

  /** Both trigger modes confirm the account's actual message before waiting
   *  for the RPC to settle. A duplicate error alone is never confirmation. */
  confirmSentUpdate(raw) {
    if (this.sent || this.stopped || !this.lastSendAt || !this.payload?.peer) return false;
    const elapsed = Math.max(0, Date.now() - this.lastSendAt);
    const correlated = this.acc.sentMessageId(this.payload.randomId);
    if (correlated) {
      this.tl = { ...(this.tl ?? {}), confirmacaoVia: "random-id" };
      this.finish(elapsed, correlated);
      return true;
    }
    if (elapsed >= 10_000) return false;
    const peer = this.payload.peer;
    const samePeer = (p) => matchesPeer(p, peer);
    let id = null;
    forEachObject(raw, (upd) => {
      if (id !== null || (upd?._ !== "updateNewChannelMessage" && upd?._ !== "updateNewMessage")) return;
      const message = upd.message;
      if (message?._ !== "message" || !message.out || !samePeer(message.peerId)) return;
      if (String(message.message ?? "") !== this.cfg.message) return;
      const candidate = numericMessageId(message.id);
      if (candidate !== null && candidate > (this.baselineId ?? 0)) id = candidate;
    });
    if (id === null) return false;
    this.tl = { ...(this.tl ?? {}), confirmacaoVia: "propria-mensagem" };
    this.finish(elapsed, id);
    return true;
  }

  async loadAdmins() {
    const peer = this.payload.peer;
    const ids = new Set();
    try {
      if (peer?._ === "inputPeerChannel") {
        const r = await this.acc.main.call({
          _: "channels.getParticipants",
          channel: { _: "inputChannel", channelId: peer.channelId, accessHash: peer.accessHash },
          filter: { _: "channelParticipantsAdmins" },
          offset: 0,
          limit: 200,
          hash: Long.ZERO,
        });
        for (const p of r?.participants ?? []) if (p?.userId != null) ids.add(Number(p.userId));
      } else if (peer?._ === "inputPeerChat") {
        const r = await this.acc.main.call({ _: "messages.getFullChat", chatId: peer.chatId });
        for (const p of r?.fullChat?.participants?.participants ?? []) {
          if (p?._ === "chatParticipantAdmin" || p?._ === "chatParticipantCreator") ids.add(Number(p.userId));
        }
      }
    } catch (e) {
      if (!this.stopped) log(this.id, "error", `Falha ao carregar admins: ${String(e?.message ?? e).slice(0, 120)}`);
    }
    return ids;
  }

  async runOnAdminMessage() {
    const peer = this.payload.peer;
    const chatId = Number(peer?.channelId ?? peer?.chatId ?? 0);
    // "Grupo aberto": só dispara com mensagem de admin, dono ou admin anônimo.
    this.admins = await this.loadAdmins();
    if (this.stopped) return;
    let pollCursor = this.baselineId ?? 0;
    this.adminRefresh = setInterval(() => { this.loadAdmins().then((a) => { if (a.size) this.admins = a; }).catch(() => {}); }, 30_000);
    const selfId = Number(this.acc.selfId ?? 0);
    const isAdminMsg = (m) => {
      const f = m?.fromId;
      if (!f) return true; // admin anônimo / post do próprio grupo
      if (f._ === "peerChannel") return Number(f.channelId) === chatId;
      if (f._ === "peerUser") return this.admins.has(Number(f.userId));
      return false;
    };
    const isFreshMessage = (m) => m?._ === "message" && !m.out
      && (numericMessageId(m.id) ?? 0) > (this.baselineId ?? 0);
    console.log("[mensagem-admins]", this.id, { total: this.admins.size, selfAdmin: this.admins.has(selfId) });
    this.rawHandler = (raw) => {
      if (this.sent || this.stopped) return;
      if (this.confirmSentUpdate(raw)) return;
      if (this.firing || this.reconciling) return;
      const recebido = performance.now();
      let trigger = false;
      forEachObject(raw, (item) => {
        if (trigger) return;
        if (item?._ !== "updateNewChannelMessage" && item?._ !== "updateNewMessage") return;
        const m = item.message;
        if (!isFreshMessage(m)) return;
        if (!matchesPeer(m.peerId, peer)) return;
        if (!isAdminMsg(m)) return;
        trigger = true;
      });
      if (trigger) {
        this.tl = { sinal: "mensagem-admin", recebido };
        this.openAt = Date.now();
        void this.fire("mensagem-admin");
      }
    };
    this.acc.main.onRawUpdate.add(this.rawHandler);
    this.startJobPing();
    console.log("[mensagem-armado]", this.id, { chatId, baseline: this.baselineId });
    // Rede de segurança de leitura a cada 1s. O aviso continua sendo o caminho
    // imediato; o cursor do polling não pode alterar a âncora da confirmação.
    const reader = this.acc.alt ?? this.acc.main;
    this.msgPoll = setInterval(async () => {
      if (this.sent || this.stopped || this.firing || this.reconciling || this.msgPollBusy) return;
      this.msgPollBusy = true;
      try {
        const r = await readCall(reader, { _: "messages.getHistory", peer: this.payload.peer, offsetId: 0, offsetDate: 0, addOffset: 0, limit: 1, maxId: 0, minId: 0, hash: Long.ZERO });
        if (this.sent || this.stopped || this.firing || this.reconciling) return;
        const m = r?.messages?.[0];
        const id = numericMessageId(m?.id) ?? 0;
        if (id <= pollCursor || !isFreshMessage(m)) return;
        pollCursor = id;
        if (isAdminMsg(m)) {
          this.tl = { sinal: "historico-admin", recebido: performance.now() };
          this.openAt = Date.now();
          void this.fire("historico-admin");
        }
      } catch {} finally { this.msgPollBusy = false; }
    }, 1000);
    await new Promise((resolve) => { this.doneResolve = resolve; });
    clearInterval(this.msgPoll);
    clearInterval(this.adminRefresh);
  }
  /** Mantém a conexão quente durante o monitoramento (leve: 1 ping/2s). */
  startJobPing() {
    if (this.jobPing) return;
    this.jobPing = setInterval(() => {
      if (this.sent || this.stopped) return;
      this.acc.main?.call({ _: "updates.getState" }).catch(() => {});
    }, 2000);
  }

  /** Lê as permissões do grupo sem enviar nada. Usado no início, quando o
   *  aviso chega sem as permissões e como reconciliação rara. */
  async readWriteState() {
    const peer = this.payload?.peer;
    if (peer?._ !== "inputPeerChannel") return "unknown";
    try {
      const r = await readCall(this.acc.main, {
        _: "channels.getChannels",
        id: [{ _: "inputChannel", channelId: peer.channelId, accessHash: peer.accessHash }],
      });
      return channelWriteState((r?.chats ?? [])[0]);
    } catch {
      return "unknown";
    }
  }

  /** Disparo único, com trava reservada antes de qualquer await. Os três
   *  gatilhos (aviso, horário, mensagem do admin) passam por aqui. */
  async fire(reason = "sinal", silentClosed = false) {
    if (this.sent || this.stopped || this.firing || this.reconciling) return;
    if (Date.now() < this.nextAllowedAt) return;
    this.firing = true;
    const t0 = Date.now();
    const p0 = performance.now();
    this.lastSendAt = t0;
    // "escrita" é o nome legado do início da chamada RPC; não é uma
    // medição do socket nem do instante de chegada ao servidor do Telegram.
    this.tl = { ...(this.tl ?? {}), motivo: reason, escrita: p0 };
    try {
      const res = await fastSend(this.acc.main, this.payload, { noUpdates: SEND_NO_UPDATES });
      if (this.sent || this.stopped) return;
      this.tl.retorno = performance.now();
      this.tl.envioMs = Math.round(this.tl.retorno - p0);
      if (res?.__duplicate) return this.reconcileDuplicate(t0);
      this.finish(Date.now() - t0, extractMessageId(res, this.payload.randomId));
    } catch (e) {
      if (this.sent || this.stopped) return;
      const msg = String(e?.message ?? e);
      const flood = FLOOD_RE.exec(msg);
      if (flood) {
        const s = Number(flood[1]) || 1;
        this.nextAllowedAt = Date.now() + s * 1000;
        console.log("[flood]", this.id, { seconds: s, via: reason, at: new Date().toISOString() });
        log(this.id, "warn", `Telegram pediu pra esperar ${s}s.`);
        // Depois da espera, só confere as permissões (sem rajada).
        setTimeout(() => this.reconcileOnce(), s * 1000 + 50);
        return;
      }
      if (CLOSED_RE.test(msg)) {
        // Fechado: espera um aviso novo. Nada de repetir pelo relógio.
        this.writeState = "closed";
        if (!silentClosed) console.log("[recusado]", this.id, { via: reason });
      } else if (PEER_RE.test(msg)) {
        this.firing = false;
        return this.recoverPeer();
      } else {
        log(this.id, "error", `Falha: ${msg.slice(0, 200)}`);
      }
    } finally {
      this.firing = false;
    }
  }

  /** "Envio repetido": o id já foi usado. Só confirma quando o Telegram
   *  associar o random_id a um id de mensagem; senão fica "resultado incerto". */
  reconcileDuplicate(t0) {
    this.reconciling = true;
    const started = Date.now();
    const check = () => {
      if (this.sent || this.stopped) return;
      const id = this.acc.sentMessageId(this.payload.randomId);
      if (id) {
        this.reconciling = false;
        return this.finish(Date.now() - t0, id);
      }
      if (Date.now() - started > 5000) {
        this.reconciling = false;
        log(this.id, "warn", "Resultado incerto: o Telegram recusou como envio repetido e não confirmou a mensagem.");
        return this.stop();
      }
      this.dupTimer = setTimeout(check, 50);
    };
    check();
  }

  async reconcileOnce() {
    if (this.sent || this.stopped || this.firing || this.reconcileBusy) return;
    this.reconcileBusy = true;
    try {
      const st = await this.readWriteState();
      if (this.sent || this.stopped) return;
      if (st !== "unknown") this.writeState = st;
      if (st === "open") {
        this.tl = { sinal: "reconciliacao", recebido: performance.now() };
        this.openAt = Date.now();
        await this.fire("reconciliacao");
      }
    } finally {
      this.reconcileBusy = false;
    }
  }

  /** O Telegram não reconheceu o grupo nessa sessão: recarrega a agenda da
   *  conta, refaz o peer e tenta uma única vez mais. */
  async recoverPeer() {
    if (this.sent || this.stopped) return;
    if (this.peerRepaired) return this.failPeer();
    this.peerRepaired = true;
    try {
      await this.prewarm(true);
    } catch {
      return this.failPeer();
    }
    if (this.sent || this.stopped) return;
    return this.fire("peer", true);
  }

  failPeer() {
    if (this.sent || this.stopped) return;
    log(
      this.id,
      "error",
      "Falha: esta conta não tem acesso a esse grupo — verifique se ela ainda participa dele.",
    );
    this.stop();
  }

  finish(ack, sentId) {
    if (this.sent) return;
    this.sent = true;
    // Quando o ACK vem sem id (ex.: "envio repetido"), o aviso do Telegram
    // capturado pela conta serve de confirmação.
    sentId = sentId ?? this.acc?.sentMessageId(this.payload?.randomId) ?? null;
    const base = `Enviado; confirmado em ${(ack / 1000).toFixed(2)}s`;
    const peer = this.payload?.peer;
    const conn = this.acc.main;
    const key = peerKey(peer);
    this.finishedAt = Date.now();
    if (this.tl) {
      const tl = { ...this.tl, mensagemId: sentId, confirmacaoMs: ack, sinalAteEscritaMs: this.tl.escrita && this.tl.recebido ? +(this.tl.escrita - this.tl.recebido).toFixed(2) : null };
      setImmediate(() => console.log("[linha-do-tempo]", this.id, tl));
    }
    this.stop();
    // O site recebe a confirmação na hora; a senha chega depois pelo patch.
    log(this.id, "success", `${base} (Senha: …)`, { key: this.id, pending: true });
    log(this.id, "done", "");
    registerForPosition({
      key,
      jobId: this.id,
      sentId,
      base,
      account: this.acc,
      conn,
      peer,
      selfId: this.acc?.selfId,
      text: this.cfg.message,
      finishedAt: this.finishedAt,
      baselineId: this.baselineId ?? 0,
      randomId: this.payload?.randomId,
      // "Grupo aberto": mensagens do dono/admins (e admin anônimo) não contam na senha.
      exclude: this.cfg.method === "mensagem" ? this.positionExclude() : undefined,
    });
  }

  stop() {
    this.stopped = true;
    this.observationToken++;
    for (const t of this.laneTimers.values()) clearInterval(t);
    this.laneTimers.clear();
    clearInterval(this.reconcileTimer); clearTimeout(this.ttlTimer); clearTimeout(this.dupTimer);
    this.reconcileTimer = null;
    clearInterval(this.jobPing); clearInterval(this.msgPoll); clearInterval(this.adminRefresh);
    this.jobPing = null;
    if (this.rawHandler) {
      try {
        this.acc.main.onRawUpdate.remove(this.rawHandler);
      } catch {
        /* ignora */
      }
      this.rawHandler = null;
    }
    if (this.chatOpened && this.payload?.peer) {
      this.chatOpened = false;
      this.acc.closePeer(this.payload.peer);
    }
    if (this.doneResolve) {
      const r = this.doneResolve;
      this.doneResolve = null;
      r();
    }
  }

}

// ---------------------------------------------------------------- my.telegram.org
// Reserva para criar o app (api_id/api_hash) a partir do IP fixo da VPS, quando
// o Telegram recusa a criação vinda da hospedagem do site. Destino fixo.
const MT_ORIGIN = "https://my.telegram.org";
const MT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
function mtJar(header) {
  const jar = {};
  for (const part of String(header || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) jar[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return jar;
}
function mtApply(jar, headers) {
  for (const sc of headers.getSetCookie?.() ?? []) {
    const first = sc.split(";")[0]; const i = first.indexOf("=");
    if (i <= 0) continue;
    const k = first.slice(0, i).trim(), v = first.slice(i + 1).trim();
    if (v) jar[k] = v; else delete jar[k];
  }
}
const mtCookie = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
function mtCreds(html) {
  const id = html.match(/api_id[\s\S]{0,800}?(?:value=["']|>\s*)(\d{4,12})(?:["']|\s*<)/i);
  const hash = html.match(/api_hash[\s\S]{0,800}?(?:value=["']|>\s*)([a-f0-9]{32})(?:["']|\s*<)/i);
  return id && hash ? { apiId: id[1], apiHash: hash[1].toLowerCase() } : null;
}
function mtFormHash(html) {
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    if (/\bname=["']hash["']/i.test(m[0])) return m[0].match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? null;
  }
  return null;
}
async function mtGetApps(jar) {
  const r = await fetch(`${MT_ORIGIN}/apps`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": MT_UA, "Accept-Language": "pt-BR,pt;q=0.9", Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", Referer: `${MT_ORIGIN}/`, Cookie: mtCookie(jar) },
  });
  if (r.status >= 300 && r.status < 400) throw new Error("apps_redirect");
  mtApply(jar, r.headers);
  return r.text();
}
async function mtEnsureApp({ cookies, title, shortNames, desc }) {
  const jar = mtJar(cookies);
  let html = await mtGetApps(jar);
  let creds = mtCreds(html);
  if (creds) return { ok: true, ...creds, cookies: mtCookie(jar) };
  let last = "";
  for (const shortName of shortNames) {
    const hash = mtFormHash(html);
    if (!hash) return { error: "no_form_no_creds" };
    const body = new URLSearchParams({ hash, app_title: title, app_shortname: shortName, app_url: "", app_platform: "desktop", app_desc: desc }).toString();
    const r = await fetch(`${MT_ORIGIN}/apps/create`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000), body,
      headers: { "User-Agent": MT_UA, "Accept-Language": "pt-BR,pt;q=0.9", Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Origin: MT_ORIGIN,
        "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty", Referer: `${MT_ORIGIN}/apps`, Cookie: mtCookie(jar) },
    });
    mtApply(jar, r.headers);
    const text = (await r.text()).trim();
    console.log(`[mt] create ${shortName} → ${r.status} ${text.slice(0, 80)}`);
    for (let i = 0; i < 3; i++) {
      if (i) await new Promise((ok) => setTimeout(ok, 1000));
      html = await mtGetApps(jar);
      creds = mtCreds(html);
      if (creds) return { ok: true, ...creds, cookies: mtCookie(jar) };
      if (mtFormHash(html)) break; // ainda é o formulário: não criou
    }
    last = text.slice(0, 120);
  }
  return { error: "create_failed", detail: last };
}

// ---------------------------------------------------------------- HTTP
function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Variações de id que o Telegram usa pro mesmo grupo (-100xxx / xxx). */
function idVariants(input) {
  const s = String(input ?? "").trim();
  if (/^-?\d+$/.test(s)) {
    const digits = s.replace(/^-/, "");
    const nums = [];
    if (digits.startsWith("100")) {
      nums.push(-Number(digits), Number(digits.slice(3)), -Number(digits.slice(3)), Number(digits));
    } else {
      nums.push(-Number("100" + digits), Number(digits), -Number(digits));
    }
    return [...new Set(nums.filter((n) => Number.isFinite(n) && n !== 0))];
  }
  return [s];
}


// Depois de reconectar, a "agenda" (cache de peers) da sessão vem vazia e o
// Telegram recusa o grupo pelo número puro com PEER_ID_INVALID. Uma passada
// pelos diálogos preenche o cache. Memoizado por conta pra não repetir a cada
// job; `invalidatePeerCache` força nova passada quando o envio falha.
const primedDialogs = new Map(); // clientId → Promise
const PRIME_TTL_MS = 5 * 60_000;

function invalidatePeerCache(acc) {
  primedDialogs.delete(acc?.clientId);
}

async function primePeerCache(acc) {
  const cached = primedDialogs.get(acc.clientId);
  if (cached && Date.now() - cached.at < PRIME_TTL_MS) return cached.task;
  const task = (async () => {
    const found = new Map();
    const collect = async (mode) => {
      for await (const dialog of acc.main.iterDialogs({ archived: mode })) {
        const chat = dialog.chat ?? dialog.peer;
        if (chat) found.set(String(chat.id), chat);
      }
    };
    try {
      await collect("exclude");
    } catch { /* segue com o que deu */ }
    try {
      await collect("only");
    } catch { /* arquivados podem falhar */ }
    return found;
  })().catch(() => new Map());
  primedDialogs.set(acc.clientId, { at: Date.now(), task });
  return task;
}

/** Grupo comum que virou supergrupo: o id antigo morre (PEER_ID_INVALID).
 *  Segue a migração e devolve o supergrupo atual. */
async function followMigration(acc, chat) {
  const mig = chat?.raw?.migratedTo ?? chat?.migratedTo;
  if (!mig) return chat;
  try {
    const peer = {
      _: "inputPeerChannel",
      channelId: mig.channelId,
      accessHash: mig.accessHash ?? 0,
    };
    const moved = await acc.main.getChat(peer);
    return moved ?? chat;
  } catch {
    return chat;
  }
}

/** Resolve um grupo por link/@usuário/id, tentando todas as variações. */
async function resolveChatFlexible(acc, input, opts = {}) {
  if (opts.force) invalidatePeerCache(acc);
  let lastErr = null;
  const attempt = async () => {
    for (const v of idVariants(input)) {
      try {
        const chat = await acc.main.getChat(v);
        if (chat) return chat;
      } catch (e) {
        lastErr = e;
      }
      try {
        const peer = await acc.main.resolvePeer(v);
        const chat = await acc.main.getChat(peer);
        if (chat) return chat;
      } catch (e) {
        lastErr = e;
      }
    }
    return null;
  };

  const direct = await attempt();
  if (direct) return followMigration(acc, direct);

  // Abre a agenda da conta e tenta de novo (caso clássico após reconexão).
  const dialogs = await primePeerCache(acc);
  const wanted = idVariants(input).map(String);
  for (const v of wanted) {
    const chat = dialogs.get(v);
    if (chat) return followMigration(acc, chat);
  }
  const again = await attempt();
  if (again) return followMigration(acc, again);

  const err = new Error("group_unreachable");
  err.cause = lastErr;
  throw err;
}

async function chatPhotoDataUrl(acc, chat) {
  try {
    const photo = chat?.photo;
    if (!photo) return null;
    const buf = await acc.main.downloadAsBuffer(photo.small ?? photo);
    return "data:image/jpeg;base64," + Buffer.from(buf).toString("base64");
  } catch {
    return null;
  }
}

async function chatDraft(acc, chat) {
  try {
    const d = await acc.main.getDraft(chat.inputPeer ?? chat);
    return d?.text ?? d?.raw?.message ?? null;
  } catch {
    return null;
  }
}


const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    // Ping sem dado nenhum, só pra saber se o processo está de pé.
    if (url.pathname === "/ping" && req.method === "GET") {
      return json(res, 200, { ok: true });
    }

    const auth = req.headers["authorization"] ?? "";
    if (auth !== `Bearer ${TOKEN}`) return json(res, 401, { error: "unauthorized" });

    if (url.pathname === "/health" && req.method === "GET") {
      return json(res, 200, {
        ok: true,
        accounts: [...accounts.keys()],
        jobs: [...jobs.keys()],
        rtt: Object.fromEntries([...accounts].map(([k, a]) => [k, a.rtt])),
      });
    }

    if (url.pathname === "/mt/ensure-app" && req.method === "POST") {
      const b = await readBody(req);
      const names = Array.isArray(b.shortNames) ? b.shortNames.filter((n) => /^[A-Za-z0-9]{5,32}$/.test(n)).slice(0, 4) : [];
      if (typeof b.cookies !== "string" || !/stel_token=/.test(b.cookies) || b.cookies.length > 4096 || !names.length) {
        return json(res, 400, { error: "bad_request" });
      }
      try {
        const out = await mtEnsureApp({ cookies: b.cookies, title: String(b.title || "App").slice(0, 32), shortNames: names, desc: String(b.desc || "Desktop client").slice(0, 120) });
        return json(res, 200, out);
      } catch (e) {
        return json(res, 200, { error: String(e?.message || e).slice(0, 120) });
      }
    }

    if (url.pathname === "/accounts/status" && req.method === "POST") {
      const b = await readBody(req);
      const acc = accounts.get(b.clientId);
      if (!acc) return json(res, 200, { ok: true, active: false });
      try {
        await acc.main.getMe();
        return json(res, 200, { ok: true, active: true, rtt: acc.rtt });
      } catch {
        accounts.delete(b.clientId);
        writeRegistry();
        return json(res, 200, { ok: true, active: false });
      }
    }

    // Lista os grupos/canais da conta direto do VPS (o navegador não tem

    // mais sessão válida — o login vive aqui).
    if (url.pathname === "/accounts/dialogs" && req.method === "POST") {
      const b = await readBody(req);
      const acc = accounts.get(b.clientId);
      if (!acc) return json(res, 400, { error: "account_not_registered" });
      const out = [];
      const seen = new Set();
      const collect = async (mode, archived) => {
        for await (const dialog of acc.main.iterDialogs({ archived: mode })) {
          const chat = dialog.chat ?? dialog.peer;
          const t = chat?.chatType ?? "";
          if (!chat || chat.type !== "chat") continue;
          if (!(t === "group" || t === "supergroup" || t === "channel" || t === "gigagroup")) continue;
          const id = String(chat.id);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({
            id,
            name: chat.title ?? id,
            isChannel: t === "channel",
            chatType: t,
            username: chat.username ?? null,
            archived,
          });
        }
      };
      await collect("exclude", false);
      try {
        await collect("only", true);
      } catch (e) {
        console.warn("[dialogs] arquivados indisponíveis:", String(e?.message ?? e));
      }
      return json(res, 200, { ok: true, groups: out });
    }

    // Resolve um grupo por link/@user/id usando a sessão do VPS.
    if (url.pathname === "/accounts/resolve" && req.method === "POST") {
      const b = await readBody(req);
      const acc = accounts.get(b.clientId);
      if (!acc) return json(res, 400, { error: "account_not_registered" });
      try {
        const chat = await resolveChatFlexible(acc, b.input);
        const [draft, photo] = await Promise.all([chatDraft(acc, chat), chatPhotoDataUrl(acc, chat)]);
        return json(res, 200, {
          ok: true,
          group: {
            id: String(chat.id),
            name: chat.title ?? chat.displayName ?? String(chat.id),
            isChannel: chat.chatType === "channel",
            username: chat.username ?? null,
            draft: draft ?? "",
            photoUrl: photo,
          },
        });
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) });
      }
    }

    // Foto de um grupo já salvo (o navegador não tem mais sessão).
    if (url.pathname === "/accounts/photo" && req.method === "POST") {
      const b = await readBody(req);
      const acc = accounts.get(b.clientId);
      if (!acc) return json(res, 400, { error: "account_not_registered" });
      try {
        const chat = await resolveChatFlexible(acc, b.input);
        return json(res, 200, { ok: true, photoUrl: await chatPhotoDataUrl(acc, chat) });
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) });
      }
    }

    // Lista os dispositivos/sessões do Telegram desta conta.
    if (url.pathname === "/accounts/sessions" && req.method === "POST") {
      const b = await readBody(req);
      const acc = accounts.get(b.clientId);
      if (!acc) return json(res, 400, { error: "account_not_registered" });
      try {
        const r = await acc.main.call({ _: "account.getAuthorizations" });
        const list = (r.authorizations ?? []).map((a) => ({
          hash: String(a.hash),
          current: String(a.hash) === "0",
          device: a.deviceModel ?? "",
          platform: `${a.platform ?? ""} ${a.systemVersion ?? ""}`.trim(),
          app: `${a.appName ?? ""} ${a.appVersion ?? ""}`.trim(),
          country: a.country ?? "",
          ip: a.ip ?? "",
        }));
        return json(res, 200, { ok: true, sessions: list });
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) });
      }
    }

    // Encerra todas as outras sessões (mantém só a de Miami).
    if (url.pathname === "/accounts/sessions/reset-others" && req.method === "POST") {
      const b = await readBody(req);
      const acc = accounts.get(b.clientId);
      if (!acc) return json(res, 400, { error: "account_not_registered" });
      try {
        const r = await acc.main.call({ _: "account.getAuthorizations" });
        const others = (r.authorizations ?? []).filter((a) => String(a.hash) !== "0");
        const killed = [];
        for (const a of others) {
          try {
            await acc.main.call({ _: "account.resetAuthorization", hash: a.hash });
            killed.push(`${a.deviceModel ?? "?"} (${a.country ?? "?"})`);
          } catch (e) {
            killed.push(`falhou: ${a.deviceModel ?? "?"} — ${String(e?.message ?? e)}`);
          }
        }
        return json(res, 200, { ok: true, killed });
      } catch (e) {
        return json(res, 400, { error: String(e?.message ?? e) });
      }
    }




    // ---- login feito AQUI, no servidor de Miami ----
    // Assim o Telegram registra o dispositivo com o IP do VPS (Miami),
    // e não com o IP do navegador do usuário.
    if (url.pathname === "/auth/send-code" && req.method === "POST") {
      const b = await readBody(req);
      const prev = pendingAuth.get(b.clientId);
      pendingAuth.delete(b.clientId);
      if (prev) {
        try { await prev.client.close(); } catch { /* ignora */ }
      }
      // Sempre começa do zero: um arquivo de login antigo (outra API ID ou
      // chave corrompida) fazia o Telegram recusar o envio do código.
      const authFile = path.join(DATA_DIR, `${b.clientId}-auth.session`);
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        for (const f of [authFile, `${authFile}-wal`, `${authFile}-shm`, `${authFile}-journal`]) {
          try { fs.rmSync(f, { force: true }); } catch { /* ignora */ }
        }
        const client = makeAuthClient(b.clientId, b.apiId, b.apiHash);
        try {
          await client.connect();
          const sent = await client.sendCode({ phone: String(b.phone).replace(/[^\d+]/g, "") });
          const hash = sent?.phoneCodeHash ?? sent?.raw?.phoneCodeHash ?? "";
          pendingAuth.set(b.clientId, { client, apiId: b.apiId, apiHash: b.apiHash, phone: b.phone, phoneCodeHash: hash });
          return json(res, 200, { ok: true, phoneCodeHash: hash });
        } catch (e) {
          lastErr = String(e?.message ?? e);
          console.error("[send-code] falhou:", lastErr);
          try { await client.close(); } catch { /* ignora */ }
          // Erros definitivos do Telegram não adiantam repetir.
          if (/PHONE_|API_ID|FLOOD|BANNED|INVALID/i.test(lastErr)) break;
        }
      }
      return json(res, 400, { error: lastErr || "send_code_failed" });
    }

    if (url.pathname === "/auth/resend-code" && req.method === "POST") {
      const b = await readBody(req);
      const p = pendingAuth.get(b.clientId);
      if (!p) return json(res, 400, { error: "no_pending_auth" });
      try {
        const sent = await p.client.resendCode({ phone: p.phone, phoneCodeHash: p.phoneCodeHash });
        p.phoneCodeHash = sent?.phoneCodeHash ?? p.phoneCodeHash;
        return json(res, 200, { ok: true, phoneCodeHash: p.phoneCodeHash });
      } catch (e) {
        const msg = String(e?.message ?? e);
        console.error("[resend-code] falhou:", msg);
        return json(res, 400, { error: msg });
      }
    }

    if (url.pathname === "/auth/sign-in" && req.method === "POST") {
      const b = await readBody(req);
      const p = pendingAuth.get(b.clientId);
      if (!p) return json(res, 400, { error: "no_pending_auth" });
      try {
        await p.client.signIn({
          phone: p.phone,
          phoneCodeHash: b.phoneCodeHash || p.phoneCodeHash,
          phoneCode: String(b.code),
        });
      } catch (e) {
        const msg = String(e?.message ?? e);
        const name = String(e?.constructor?.name ?? e?.name ?? "");
        const need2fa = /SESSION_PASSWORD_NEEDED/i.test(msg) || name.includes("SessionPasswordNeeded");
        if (!need2fa) return json(res, 400, { error: msg });
        if (!b.password) return json(res, 200, { ok: false, error: "2FA_REQUIRED" });
        await p.client.checkPassword(String(b.password));
      }
      const session = await p.client.exportSession();
      const me = await p.client.getMe();
      pendingAuth.delete(b.clientId);
      try {
        await p.client.close();
      } catch {
        /* ignora */
      }
      // Só conclui o cadastro depois que a conta estiver registrada e quente.
      const old = accounts.get(b.clientId);
      if (old) await old.close();
      const acc = new Account(b.clientId, p.apiId, p.apiHash);
      try {
        await acc.connect(session);
        accounts.set(b.clientId, acc);
        writeRegistry();
      } catch (e) {
        await acc.close();
        return json(res, 500, { error: `account_registration_failed: ${String(e?.message ?? e)}` });
      }
      return json(res, 200, {
        ok: true,
        session,
        me: { id: Number(me.id), username: me.username ?? null, name: me.displayName ?? null },
      });
    }

    if (url.pathname === "/accounts" && req.method === "POST") {
      const b = await readBody(req);
      const existing = accounts.get(b.clientId);
      if (existing) await existing.close();
      const acc = new Account(b.clientId, b.apiId, b.apiHash);
      const me = await acc.connect(b.session);
      accounts.set(b.clientId, acc);
      writeRegistry();
      return json(res, 200, { ok: true, me });
    }

    if (url.pathname === "/jobs" && req.method === "POST") {
      const b = await readBody(req);
      const acc = accounts.get(b.clientId);
      if (!acc) return json(res, 400, { error: "account_not_registered" });
      jobs.get(b.jobId)?.stop();
      console.log("[job]", b.jobId, { method: b.method ?? "abertura", target: !!b.targetMs });
      const job = new Job(b, acc);
      jobs.set(b.jobId, job);
      void job.run().catch((e) => log(b.jobId, "error", String(e?.message ?? e)));
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/jobs" && req.method === "DELETE") {
      const id = url.searchParams.get("jobId");
      jobs.get(id)?.stop();
      jobs.delete(id);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/events" && req.method === "GET") {
      const since = Number(url.searchParams.get("since") || 0);
      return json(res, 200, { ok: true, events: events.filter((e) => e.t > since), now: Date.now() });
    }

    return json(res, 404, { error: "not_found" });
  } catch (e) {
    return json(res, 500, { error: String(e?.message ?? e) });
  }
});

await restoreAccounts();
server.listen(PORT, () => console.log(`miami-agent ouvindo em :${PORT}`));
