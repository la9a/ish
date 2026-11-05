// Monitor multi-conta: opera várias contas Telegram em paralelo,
// cada uma com seus próprios grupos pré-resolvidos. Quando um grupo
// abre, dispara o envio com o cliente DAQUELA conta.

import { getClientForId, getAltClientForId, fastSend, firstOk, hedgedSend, pingClient, getChatAdminInfo, isPeerInvalidError, isSenderAdmin, isTransientStorageError, reconnectClientForId, type LogEntry, type LogLevel, type SendInfo } from "@/lib/telegram";
import { sendLeadMs, rttSuffix } from "@/lib/netLatency";
import { clientData, clientsStore, type MonitoredGroup } from "@/lib/storage";
import Long from "long";
import { syncServerClock, waitUntilBrasilia, brasiliaTargetToday, serverNow } from "@/lib/brasiliaSync";
import { isAgentArmed, disarmMiami } from "@/lib/miamiBridge";

export interface MultiClientStatus {
  clientId: string;
  running: boolean;
  groups: Record<string, "open" | "closed" | "unknown">;
}

interface SendPayload {
  peer: any;
  text: string;
  randomId: Long;
}

type Listener = (state: {
  running: boolean;
  logs: LogEntry[];
  statusByClient: Record<string, Record<string, string>>;
  sends: SendInfo[];
}) => void;

function makeRandomId(): Long {
  const buf = new Uint8Array(8);
  (globalThis.crypto ?? (window as any).crypto).getRandomValues(buf);
  const lo = (buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) >>> 0;
  const hi = (buf[4] | (buf[5] << 8) | (buf[6] << 16) | (buf[7] << 24)) >>> 0;
  return new Long(lo | 0, hi | 0, false);
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
  const chatId = chatIdFromIncomingMessage(message);
  const anonymous = !!id && !!chatId && peerIdVariants(chatId).includes(String(id));
  return { id, anonymous };
}

const CLOSED_ERRORS = [
  "CHAT_WRITE_FORBIDDEN",
  "CHAT_SEND_PLAIN_FORBIDDEN",
  "CHAT_SEND_MESSAGES_FORBIDDEN",
  "SEND_MESSAGES_FORBIDDEN",
  "USER_BANNED_IN_CHANNEL",
];

const HOT_SEND_MAX_INFLIGHT = 24;

/** Sem stagger: RPCs de contas diferentes largam ao mesmo tempo. O
 *  `randomId` estável por (conta, grupo) garante que o Telegram deduplica
 *  no servidor, então múltiplas chamadas em voo geram no máximo 1
 *  mensagem entregue. FLOOD_WAIT é tratado dormindo o `waitSec` pedido
 *  pelo servidor. */

interface PerClient {
  clientId: string;
  title: string;
  client: any;
  /** Segundo socket MTProto da mesma conta (corrida de pacotes). */
  altClient: any;
  peers: Map<string, any>;
  payloads: Map<string, SendPayload>;
  groupCache: Map<string, MonitoredGroup>;
  statuses: Record<string, string>;
  sent: Set<string>;
  /** Trava PERMANENTE por sessão. Após um sendText bem-sucedido,
   *  o grupo entra em `completed` e NUNCA mais é reenviado — nem por
   *  raw update, nem por retry, nem por polling. Só limpa em stop(). */
  completed: Set<string>;
  /** Promises de envio em andamento por grupo. Qualquer nova entrada
   *  em fireOne aguarda a mesma promise — impede que 2 sendText
   *  concorrentes para o mesmo grupo sejam disparados. */
  inFlight: Map<string, Promise<void>>;
  /** randomId estável para o path de fallback (sem payload pré-resolvido),
   *  pra dedupe do Telegram também funcionar nesse caminho. */
  fallbackRandomIds: Map<string, Long>;
  offRawUpdate: (() => void) | null;
  offNewMessage: (() => void) | null;
  openedChats: any[];
  keepaliveHandle: any;
  method: "abertura" | "mensagem" | "abertura2";
  /** HH:MM do último ABE (scheduleEnv) — só usado em "abertura2". */
  scheduleEnv: string | null;
  /** Já aguardou o horário ABE nesta sessão (por grupo). */
  scheduleWaited: Set<string>;
  adminCache: Map<string, Set<string>>;
}

class MultiMonitor {
  private running = false;
  /** Incrementa a cada start/stop. Cada fireOne captura o token no início
   *  e descarta qualquer efeito colateral (log de sucesso, marca de
   *  completed, push em sends) se o token divergir — ou seja, se o
   *  monitor foi parado enquanto o RPC estava em voo. */
  private sessionToken = 0;
  private logs: LogEntry[] = [];
  private nextLogId = 1;
  private listeners = new Set<Listener>();
  private perClient = new Map<string, PerClient>();
  private sends: SendInfo[] = [];
  /** Envios em andamento (contador global). Auto-stop só dispara em 0. */
  private inFlightSends = 0;
  /**
   * Marco da PRIMEIRA detecção de abertura por grupo (compartilhado entre
   * todas as contas). Sem isso cada conta cronometrava a partir do momento
   * em que *ela* percebeu a abertura, e o mesmo evento aparecia como
   * 0.59 / 0.61 / 1.08 segundos em contas diferentes.
   */
  private openMarks = new Map<string, number>();
  private lastPushLog = 0;
  private loopHandle: any = null;
  /** Só permite auto-stop depois que todos os boots terminaram. */
  private bootCompleted = false;
  private lastEmit = 0;
  private emitScheduled = false;
  /** Evita logs duplicados de conexão/grupo no prewarm. */
  private prewarmedClients = new Set<string>();
  /** Cache de peer resolvido durante prewarm — reusa em bootClient pra
   *  não iterar diálogos de novo (cada iterDialogs é 1 messages.getDialogs
   *  no Telegram → estoura FLOOD_WAIT rápido). Chave: `${clientId}::${input}`. */
  private resolvedCache = new Map<string, any>();
  /** Cache de admins pré-carregado no prewarm. Chave: `${clientId}::${input}`. */
  private adminInfoCache = new Map<string, Set<string>>();
  /** Índice reverso: groupId → set de clientIds que monitoram esse grupo.
   *  Serve pro fanout cross-account no handler de raw update — se uma
   *  conta detecta a abertura, todas as outras disparam junto sem esperar
   *  o próprio raw update chegar (pode nunca chegar). */
  private groupIdToClients = new Map<string, Set<string>>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  isRunning() { return this.running; }
  getLogs() { return this.logs; }
  getSends() { return this.sends; }

  private snapshot() {
    const statusByClient: Record<string, Record<string, string>> = {};
    for (const [id, pc] of this.perClient) statusByClient[id] = { ...pc.statuses };
    return {
      running: this.running,
      logs: this.logs.slice(),
      statusByClient,
      sends: this.sends.slice(),
    };
  }

  private emit() {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  /** Emit throttled — re-renderizar React a cada 10ms freava o hot loop. */
  private emitThrottled() {
    const now = performance.now();
    if (now - this.lastEmit >= 80) {
      this.lastEmit = now;
      this.emit();
      return;
    }
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    setTimeout(() => {
      this.emitScheduled = false;
      this.lastEmit = performance.now();
      this.emit();
    }, 80);
  }

  private log(level: LogLevel, msg: string, opts?: { key?: string; pending?: boolean }) {
    const now = Date.now();
    // O prewarm pode ser solicitado por mais de um fluxo ao mesmo tempo.
    // A confirmação inicial de uma conta é única nesta sessão do painel.
    if (/; Conectado$/.test(msg) && this.logs.some((entry) => entry.msg === msg)) return;
    this.logs = [
      ...this.logs,
      { id: this.nextLogId++, ts: now, level, msg, ...(opts ?? {}) },
    ].slice(-400);
    // Erros/eventos importantes emitem já; o resto passa pelo throttle
    // pra não competir com o hot loop de detecção.
    if (level === "error") this.emit();
    else this.emitThrottled();
  }

  /** Substitui o texto de uma linha já publicada (senha apurada em Miami). */
  private patchLog(key: string, msg: string, pending = false) {
    let changed = false;
    this.logs = this.logs.map((e) => {
      if (e.key !== key) return e;
      changed = true;
      return { ...e, msg, pending };
    });
    if (changed) this.emit();
  }

  clearLogs() {
    this.logs = [];
    this.emit();
  }

  resetPrewarm() {
    this.prewarmedClients.clear();
  }
  clearSends() { this.sends = []; this.emit(); }

  async start(clientIds: string[]) {
    if (this.running) return;
    if (clientIds.length === 0) {
      this.log("error", "Nenhum cliente selecionado.");
      return;
    }
    if (clientIds.length > 20) {
      this.log("error", "Máximo de 20 contas simultâneas.");
      return;
    }
    this.sessionToken++;
    this.running = true;
    this.sends = [];
    this.perClient.clear();
    this.groupIdToClients.clear();
    this.openMarks.clear();
    this.bootCompleted = false;
    // Se algum cliente usa "abertura2", sincroniza o relógio com o servidor
    // pra garantir precisão no disparo agendado. Best-effort.
    if (clientIds.some((id) => clientsStore.get(id)?.method === "abertura2")) {
      await syncServerClock().catch(() => {});
    }
    this.emit();



    // Turbo Miami PRIMEIRO: o robô do VPS assume as contas antes do navegador
    // abrir qualquer conexão, então a conta aparece logada só em Miami.
    const fullyInMiami = new Set<string>();
    try {
      const { armMiami } = await import("@/lib/miamiBridge");
      await Promise.all(clientIds.map(async (clientId) => {
        const rec = clientsStore.get(clientId);
        const groups = clientData.getGroups(clientId).filter((g) => g.active);
        if (!groups.length) return;
        const targetMs =
          rec?.method === "abertura2" && rec?.scheduleEnv
            ? brasiliaTargetToday(rec.scheduleEnv)
            : null;
        const taken = await armMiami({
          clientId,
          clientTitle: rec?.title ?? clientId,
          groups,
          targetMs,
          log: (level, msg, opts) => this.log(level as any, msg, opts),
          patch: (key, msg, pending) => this.patchLog(key, msg, pending),
          onAllDone: () => this.stop("auto"),
        });
        if (taken.length === groups.length) fullyInMiami.add(clientId);
      }));
    } catch (e) {
      this.log("error", `Turbo Miami falhou: ${String((e as Error)?.message ?? e)}`);
    }

    if (fullyInMiami.size !== clientIds.length) {
      await disarmMiami();
      this.running = false;
      this.bootCompleted = true;
      this.log("error", "Monitoramento não iniciado: Miami não assumiu todas as contas e grupos.");
      this.emit();
      return;
    }
    this.bootCompleted = true;
    // Se o usuário clicou em Parar durante o boot, aborta antes de entrar
    // no loop — evita "estado inoperante".
    if (!this.running) {
      return;
    }
    this.emit();
    // Cada conta inicia seu próprio hot-loop assim que termina o boot,
    // sem esperar as demais contas.
  }

  /** Conecta nas contas e pré-resolve os grupos em paralelo, sem ativar o
   *  monitoramento. Chamado ao entrar no painel para deixar o Start leve. */
  async prewarm(clientIds: string[]): Promise<boolean> {
    if (clientIds.length === 0) return false;
    const results = await Promise.all(clientIds.map(async (clientId) => {
      const rec = clientsStore.get(clientId);
      const title = rec?.title ?? clientId;
      try {
        const { ensureMiamiAccount } = await import("@/lib/miamiBridge");
        if (await ensureMiamiAccount(clientId, (level, msg) => this.log(level, msg), true)) {
          if (!this.prewarmedClients.has(clientId + ":miami")) {
            this.prewarmedClients.add(clientId + ":miami");
            this.log("success", `${title}; Conectado`);
          }
          return true;
        }
        if (clientsStore.get(clientId)?.hasSession !== false) {
          this.log("error", `${title}: não foi possível conectar no servidor de Miami.`);
        }
        return false;
      } catch (e: any) {
        this.log("error", `${title}: falha ao conectar — ${e?.message ?? e}`);
        return false;
      }
    }));
    return results.every(Boolean);
  }

  private async bootClient(clientId: string) {
    const groups = clientData.getGroups(clientId).filter((g) => g.active);
    const rec = clientsStore.get(clientId);
    const title = rec?.title ?? clientId;
    if (groups.length === 0) {
      this.log("warn", `${title}: sem grupos ativos — ignorado.`);
      return;
    }
    const client = await getClientForId(clientId);
    const method = (rec?.method ?? "abertura") as "abertura" | "mensagem" | "abertura2";
    const pc: PerClient = {
      clientId,
      title,
      client,
      altClient: null,
      peers: new Map(),
      payloads: new Map(),
      groupCache: new Map(),
      statuses: {},
      sent: new Set(),
      completed: new Set(),
      inFlight: new Map(),
      fallbackRandomIds: new Map(),
      offRawUpdate: null,
      offNewMessage: null,
      openedChats: [],
      keepaliveHandle: null,
      method,
      scheduleEnv: rec?.scheduleEnv ?? null,
      scheduleWaited: new Set(),
      adminCache: new Map(),
    };
    this.perClient.set(clientId, pc);

    try { await client.startUpdatesLoop?.(); } catch { /* raw/onNewMessage ainda pode funcionar */ }

    // A conta permanece offline. Não enviamos account.updateStatus para
    // evitar que os usuários vejam a conta como "online" quando o monitor inicia.

    // Keep-alive: mantém socket MTProto + TLS quentes durante monitoramentos
    // longos. Sem isso, após ociosidade o primeiro envio paga reconexão
    // (handshake) e sai com atraso de segundos. updates.getState é o call
    // mais barato do MTProto (~200 bytes) e não marca a conta como online.
    if (pc.keepaliveHandle) clearInterval(pc.keepaliveHandle);
    let lastPing = 0;
    pc.keepaliveHandle = setInterval(() => {
      if (!this.running) return;
      const now = performance.now();
      const interval = this.inHotWindow(pc) ? 1000 : 5000;
      if (now - lastPing < interval - 50) return;
      lastPing = now;
      pingClient(pc.client);
      if (pc.altClient) pingClient(pc.altClient);
    }, 1000);

    // Conexão secundária: handshake feito no boot, fora do caminho quente.
    void getAltClientForId(clientId).then((alt) => { pc.altClient = alt; }).catch(() => {});


    for (const g of groups) {
      pc.statuses[g.id] = "closed";
      pc.groupCache.set(g.id, g);
      // Índice reverso pro fanout cross-account.
      let set = this.groupIdToClients.get(g.id);
      if (!set) { set = new Set(); this.groupIdToClients.set(g.id, set); }
      set.add(clientId);
    }

    // ========================================================================
    // Registra o handler de raw update ANTES de qualquer preload pesado, pra
    // não perder abertura/mensagem que chegue durante o boot.
    // ========================================================================
    const fireFromIncomingMessage = (message: any): boolean => {
      const peerId = chatIdFromIncomingMessage(message);
      if (!peerId) return false;
      const gid = peerIdVariants(peerId).find((id) => pc.groupCache.has(id) && pc.payloads.has(id));
      if (!gid) return false;
      const g = pc.groupCache.get(gid);
      if (!g) return false;
      const { id: senderId, anonymous } = senderIdFromIncomingMessage(message);
      const admins = pc.adminCache.get(gid);
      const isKnownAdmin = anonymous || (!!senderId && !!admins && admins.has(String(senderId)));
      if (!isKnownAdmin) {
        if (!senderId) return false;
        const peer = pc.peers.get(gid);
        isSenderAdmin(pc.client, peer?.inputPeer ?? peer, senderId).then((ok) => {
          if (ok) {
            const set = pc.adminCache.get(gid) ?? new Set<string>();
            set.add(String(senderId));
            pc.adminCache.set(gid, set);
            const tDetect = performance.now();
            this.fireOne(pc, g, tDetect).then(() => this.emitThrottled());
          }
        }).catch(() => {});
        return false;
      }
      const tDetect = performance.now();
      this.fireOne(pc, g, tDetect).then(() => this.emitThrottled());
      return true;
    };
    const handler = (info: any) => {
      const updates: any[] = info?.update ? [info.update] : info?.updates ?? [];
      for (const u of updates) {
        const t = u?._;
        if (pc.method === "mensagem" && (t === "updateNewMessage" || t === "updateNewChannelMessage")) {
          fireFromIncomingMessage(u.message);
          continue;
        }
        if (t === "updateChannelDefaultBannedRights" || t === "updateChatDefaultBannedRights") {
          if (pc.method !== "abertura" && pc.method !== "abertura2") continue;
          const peerId = String(u.peer?.channelId ?? u.peer?.chatId ?? u.peer?.channel_id ?? u.peer?.chat_id ?? "");
          const tDetect = performance.now();
          const fired: Promise<void>[] = [];
          if (peerId) {
            const gid = peerIdVariants(peerId).find((id) => pc.groupCache.has(id) && pc.payloads.has(id));
            const g = gid ? pc.groupCache.get(gid) : null;
            if (g) fired.push(this.fireOne(pc, g, tDetect));
            // Fanout cross-account: se essa conta detectou a abertura, todas
            // as outras contas que monitoram o mesmo grupo disparam JUNTO
            // (sem esperar o próprio raw update, que pode nunca chegar).
            if (gid) {
              const others = this.groupIdToClients.get(gid);
              if (others) {
                for (const otherId of others) {
                  if (otherId === pc.clientId) continue;
                  const otherPc = this.perClient.get(otherId);
                  if (!otherPc) continue;
                  if (otherPc.method !== "abertura" && otherPc.method !== "abertura2") continue;
                  const otherG = otherPc.groupCache.get(gid);
                  if (otherG && otherPc.payloads.has(gid)) {
                    fired.push(this.fireOne(otherPc, otherG, tDetect));
                  }
                }
              }
            }
          } else {
            for (const gid of pc.payloads.keys()) {
              const g = pc.groupCache.get(gid);
              if (g) fired.push(this.fireOne(pc, g, tDetect));
              // Fanout também no caminho sem peerId (update global).
              const others = this.groupIdToClients.get(gid);
              if (others) {
                for (const otherId of others) {
                  if (otherId === pc.clientId) continue;
                  const otherPc = this.perClient.get(otherId);
                  if (!otherPc) continue;
                  if (otherPc.method !== "abertura" && otherPc.method !== "abertura2") continue;
                  const otherG = otherPc.groupCache.get(gid);
                  if (otherG && otherPc.payloads.has(gid)) {
                    fired.push(this.fireOne(otherPc, otherG, tDetect));
                  }
                }
              }
            }
          }
          Promise.all(fired).then(() => this.emitThrottled());
        }
      }
    };
    const emitter: any = client.onRawUpdate ?? client.onUpdate;
    if (emitter?.add) {
      emitter.add(handler);
      pc.offRawUpdate = () => emitter.remove?.(handler);
    } else if (typeof client.on === "function") {
      client.on("update", handler);
      pc.offRawUpdate = () => client.off?.("update", handler);
    }

    // Pré-resolve peers em paralelo
    await Promise.all(groups.map(async (g) => {
      try {
        const key = `${clientId}::${g.input}`;
        let e: any = this.resolvedCache.get(key);
        if (!e) {
          e = await this.resolveResilient(clientId, client, g.input, g.name);
          this.resolvedCache.set(key, e);
        }
        const sendPeer = await this.resolveSendPeer(client, e);
        pc.peers.set(g.id, e);
        pc.payloads.set(g.id, {
          peer: sendPeer,
          text: g.message,
          randomId: makeRandomId(),
        });
      } catch (e: any) {
        this.log("warn", `Falha ao pré-resolver '${g.name}': ${String(e?.message ?? e)}`);
      }
    }));

    // Para o modo abertura, já começa o pipeline de sendText agora: não
    // depende de admins/openChat. Isso evita esperar boot auxiliar se o
    // grupo abrir durante a preparação.
    this.startClientLoop(pc);

    // Keepalive openChat (até 10). Em paralelo para não serializar o boot
    // quando várias contas/grupos estão sendo preparados.
    await Promise.allSettled(Array.from(pc.peers.values()).slice(0, 10).map(async (p) => {
      try {
        await client.openChat(p.inputPeer ?? p);
        pc.openedChats.push(p);
      } catch {/* ignore */}
    }));

    // Preload de admins: só é necessário no modo "mensagem". Nos outros
    // métodos o gate de admin nem existe. E mesmo no "mensagem" NÃO
    // bloqueamos o boot — se um update chegar antes do cache, o handler
    // resolve lazy via `isSenderAdmin`.
    if (pc.method === "mensagem") {
      Promise.all(groups.map(async (g) => {
        try {
          const key = `${clientId}::${g.input}`;
          const cached = this.adminInfoCache.get(key);
          if (cached) { pc.adminCache.set(g.id, cached); return; }
          const peer = pc.peers.get(g.id);
          const info = await getChatAdminInfo(client, peer?.inputPeer ?? peer ?? g.input);
          pc.adminCache.set(g.id, info.ids);
          this.adminInfoCache.set(key, info.ids);
        } catch { /* fallback lazy via isSenderAdmin */ }
      })).catch(() => {});
    }

    // Camada D — listener único (onRawUpdate já cobre updateNewMessage /
    // updateNewChannelMessage). Não registramos onNewMessage pra evitar
    // fire duplo no mesmo evento.

    // Iniciação individual silenciosa — o log consolidado é emitido em start().
  }

  /** Contas com reconexão em andamento (evita reboot duplicado). */
  private reconnectingClients = new Set<string>();

  /**
   * Sessão/conexão de uma conta caiu no meio do monitoramento. Em vez de
   * ficar tentando enviar com um client morto, reconecta a conta e refaz o
   * boot dela, preservando as travas de envio já concluído.
   */
  private async tryReconnectClient(pc: PerClient, errMsg: string): Promise<void> {
    if (!this.running) return;
    const clientId = pc.clientId;
    if (this.reconnectingClients.has(clientId)) return;
    this.reconnectingClients.add(clientId);
    const completed = new Set(pc.completed);
    const sent = new Set(pc.sent);
    try {
      this.log("warn", `${pc.title}: conexão caiu (${errMsg}) — reconectando...`);
      try { pc.offRawUpdate?.(); } catch { /* ignore */ }
      try { pc.offNewMessage?.(); } catch { /* ignore */ }
      if (pc.keepaliveHandle) clearInterval(pc.keepaliveHandle);
      this.perClient.delete(clientId);
      // Invalida peers em cache — access_hash é por sessão/conexão.
      for (const key of Array.from(this.resolvedCache.keys())) {
        if (key.startsWith(`${clientId}::`)) this.resolvedCache.delete(key);
      }
      await reconnectClientForId(clientId);
      if (!this.running) return;
      await this.bootClient(clientId);
      const fresh = this.perClient.get(clientId);
      if (fresh) {
        for (const id of completed) fresh.completed.add(id);
        for (const id of sent) fresh.sent.add(id);
      }
      this.log("success", `${pc.title}: conexão restabelecida — monitoramento continua.`);
    } catch (e: any) {
      const m = String(e?.message ?? e);
      if (/AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/i.test(m)) {
        this.log("error", `${pc.title}: sessão do Telegram expirou. Reconecte essa conta para continuar.`);
      } else {
        this.log("warn", `${pc.title}: não consegui reconectar agora (${m}) — vou tentar de novo.`);
      }
    } finally {
      this.reconnectingClients.delete(clientId);
      this.emitThrottled();
    }
  }

  private async resolveWith(client: any, input: string, titleHint?: string): Promise<any> {
    return this.resolveWithRaw(client, input, titleHint);
  }

  /**
   * Igual ao resolveWith, mas tolerante a erro transitório de IndexedDB
   * ("The database connection is closing") — nesse caso pega um client novo
   * da conta e tenta de novo, em vez de logar falha ao pré-resolver.
   */
  private async resolveResilient(clientId: string, client: any, input: string, titleHint?: string): Promise<any> {
    try {
      return await this.resolveWithRaw(client, input, titleHint);
    } catch (e: any) {
      if (!isTransientStorageError(e)) throw e;
      await new Promise((r) => setTimeout(r, 300));
      const fresh = await getClientForId(clientId);
      return await this.resolveWithRaw(fresh, input, titleHint);
    }
  }

  private async resolveWithRaw(client: any, input: string, titleHint?: string): Promise<any> {
    const key = input.trim();
    const inviteMatch = key.match(/t\.me\/(?:joinchat\/|\+)([A-Za-z0-9_-]+)/i);
    if (inviteMatch) {
      try { return await client.getChat(`https://t.me/+${inviteMatch[1]}`); } catch {/* fallthrough */}
    }
    const userMatch = key.match(/^(?:@|https?:\/\/t\.me\/|t\.me\/)?([A-Za-z][A-Za-z0-9_]{3,31})$/);
    if (userMatch) {
      try { return await client.getChat(userMatch[1]); } catch {/* fallthrough */}
    }
    const isNumeric = /^-?\d+$/.test(key);
    // Se temos titleHint, pulamos getChat por id direto: entidade obsoleta
    // após migração pra supergrupo passa aqui mas falha em openChat/sendMessage
    // com CHANNEL_INVALID. Deixamos a varredura de diálogos pegar a versão -100.
    if (isNumeric && !titleHint) {
      const variants = new Set<number>();
      const n = Number(key);
      variants.add(n);
      const abs = Math.abs(n);
      variants.add(-abs);
      variants.add(Number(`-100${abs}`));
      const stripped = String(abs).replace(/^100/, "");
      if (stripped && stripped !== String(abs)) {
        variants.add(Number(stripped));
        variants.add(-Number(stripped));
      }
      for (const v of variants) {
        try { return await client.getChat(v); } catch {/* try next */}
      }
    }
    // Fallback: itera diálogos buscando por id (todas variações) ou título
    // (exato → normalizado → parcial). Para grupos privados o access_hash
    // só é conhecido após carregar o diálogo — por isso essa varredura.
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s._\-,!?:;"'()[\]{}]+/g, "").trim();
    const qLower = key.toLowerCase();
    const qNorm = norm(key);
    const idTargets = new Set<string>();
    if (isNumeric) {
      const abs = String(Math.abs(Number(key)));
      idTargets.add(key);
      idTargets.add(abs);
      idTargets.add(`-${abs}`);
      idTargets.add(`-100${abs}`);
      const stripped = abs.replace(/^100/, "");
      if (stripped && stripped !== abs) {
        idTargets.add(stripped);
        idTargets.add(`-${stripped}`);
        idTargets.add(`-100${stripped}`);
      }
    }
    let count = 0;
    let exact: any = null;
    let partial: any = null;
    const hint = (titleHint ?? "").trim();
    const hintLower = hint.toLowerCase();
    const hintNorm = norm(hint);
    const isModernChat = (c: any) =>
      String(c?.id ?? "").startsWith("-100") ||
      c?.chatType === "supergroup" ||
      c?.chatType === "channel" ||
      c?.chatType === "gigagroup";
    const migratedTargetIds = (chat: any): string[] => {
      const target = chat?.migratedTo ?? chat?.raw?.migratedTo ?? chat?.raw?.migrated_to;
      const id = firstPresent(target?.id, target?.channelId, target?.chatId, target?.channel_id, target?.chat_id);
      return id ? peerIdVariants(id) : [];
    };
    for await (const dialog of client.iterDialogs()) {
      const chat = dialog.chat ?? dialog.peer;
      if (!chat) continue;
      if (chat?.migratedTo || chat?.raw?.migratedTo || chat?.raw?.migrated_to) {
        if (idTargets.size && idTargets.has(String(chat.id ?? ""))) {
          for (const id of migratedTargetIds(chat)) idTargets.add(id);
        }
        continue;
      }
      count++;
      const chatId = String(chat.id ?? "");
      if (idTargets.size && idTargets.has(chatId)) {
        if (!titleHint || isModernChat(chat)) return chat;
      }
      const title: string = chat.title ?? "";
      if (!title) continue;
      const tLower = title.toLowerCase();
      const tNorm = norm(title);
      if (!isNumeric) {
        if (tLower === qLower || tNorm === qNorm) {
          if (!exact || (!isModernChat(exact) && isModernChat(chat))) exact = chat;
          if (isModernChat(exact)) break;
          continue;
        }
        if (!partial && (tLower.includes(qLower) || qLower.includes(tLower) || tNorm.includes(qNorm) || qNorm.includes(tNorm))) partial = chat;
      } else if (hint) {
        // ID salvo pode estar obsoleto (grupo migrou pra supergrupo).
        // Faz match por título se um hint foi fornecido.
        if (tLower === hintLower || tNorm === hintNorm) {
          if (!exact || (!isModernChat(exact) && isModernChat(chat))) exact = chat;
          if (isModernChat(exact)) break;
          continue;
        }
        if (!partial && (tLower.includes(hintLower) || hintLower.includes(tLower) || tNorm.includes(hintNorm) || hintNorm.includes(tNorm))) partial = chat;
      }
    }
    const found = exact ?? partial;
    if (found) return found;
    const label = titleHint ? `${titleHint} (${input})` : input;
    throw new Error(`Grupo "${label}" não encontrado (${count} diálogos verificados). Verifique se a conta é membro.`);
  }

  private async resolveSendPeer(client: any, chat: any): Promise<any> {
    if (typeof client?.resolvePeer === "function") {
      const id = chat?.id != null ? String(chat.id) : null;
      const attempts = [id, chat].filter(Boolean);
      for (const target of attempts) {
        try { return await client.resolvePeer(target, true); } catch { /* try next */ }
      }
    }
    return chat?.inputPeer ?? chat;
  }

  /** Janela quente: faltam <10s pro horário alvo (método "abertura2"). */
  private inHotWindow(pc: PerClient): boolean {
    if (pc.method !== "abertura2" || !pc.scheduleEnv) return false;
    const remaining = brasiliaTargetToday(pc.scheduleEnv) - serverNow();
    return remaining > 0 && remaining <= 10000;
  }

  private async fireOne(pc: PerClient, g: MonitoredGroup, tDetect: number) {
    // Se o robô de Miami assumiu esse grupo, o navegador não envia nada
    // (evita mensagem duplicada) — o log vem dos eventos do robô.
    if (isAgentArmed(pc.clientId, g.id)) return;
    // Cronômetro do log ancorado na PRIMEIRA detecção de abertura do grupo
    // (vale para todas as contas). Em "Grupo aberto 2" ele é reiniciado no
    // instante do horário alvo — senão o tempo de espera entraria na conta.
    const firstMark = this.openMarks.get(g.id);
    let tClock = firstMark ?? tDetect;
    if (firstMark === undefined) this.openMarks.set(g.id, tClock);
    // Instante em que o sendText realmente foi disparado (T3).
    let tDispatch = 0;
    const token = this.sessionToken;
    const cancelled = () => !this.running || token !== this.sessionToken;
    // Camada F — trava PERMANENTE por sessão. Uma vez enviado com sucesso
    // nesse grupo (por qualquer caminho), nunca mais reenvia.
    if (pc.completed.has(g.id)) return;
    const existing = pc.inFlight.get(g.id);
    if (existing) return existing;
    // Pipeline: várias chamadas paralelas do `sendText` são permitidas —
    // o Telegram deduplica pelo `randomId` estável. Isso remove a janela
    // morta entre CHAT_WRITE_FORBIDDEN e a próxima tentativa.
    if (cancelled()) return;
    const payload = pc.payloads.get(g.id);
    this.inFlightSends++;
    let countedInFlight = true;
    let floodRetryCount = 0;
    let activeGroup = g;
    const refreshPeerForInvalidGroup = async (rid: Long): Promise<SendPayload> => {
      const peer = await this.resolveWith(pc.client, activeGroup.input, activeGroup.name);
      const sendPeer = await this.resolveSendPeer(pc.client, peer);
      const nextId = String(peer.id ?? activeGroup.id);
      const nextName = peer.title ?? peer.firstName ?? activeGroup.name;
      const nextGroup: MonitoredGroup = {
        ...activeGroup,
        id: nextId,
        input: nextId,
        name: nextName,
      };

      if (nextId !== activeGroup.id) {
        clientData.removeGroup(pc.clientId, activeGroup.id);
        clientData.upsertGroup(pc.clientId, nextGroup);
        pc.statuses[nextId] = pc.statuses[activeGroup.id] ?? "closed";
        delete pc.statuses[activeGroup.id];
        const admins = pc.adminCache.get(activeGroup.id);
        if (admins) {
          pc.adminCache.set(nextId, admins);
          pc.adminCache.delete(activeGroup.id);
        }
      } else if (nextName !== activeGroup.name) {
        clientData.upsertGroup(pc.clientId, nextGroup);
      }

      pc.groupCache.delete(activeGroup.id);
      pc.groupCache.set(nextId, nextGroup);
      pc.peers.delete(activeGroup.id);
      pc.peers.set(nextId, peer);
      pc.payloads.delete(activeGroup.id);
      const nextPayload = { peer: sendPeer, text: nextGroup.message, randomId: rid };
      pc.payloads.set(nextId, nextPayload);
      pc.sent.delete(activeGroup.id);
      activeGroup = nextGroup;
      return nextPayload;
    };
    const runSend = async () => {
      if (cancelled()) throw new Error("__CANCELLED__");
      // "Grupo aberto 2": grupo já foi detectado como aberto, mas o
      // disparo só acontece quando o relógio de Brasília bater o horário
      // exato do último ABE (scheduleEnv). Espera com precisão de ms.
      if (pc.method === "abertura2" && pc.scheduleEnv && !pc.scheduleWaited.has(activeGroup.id)) {
        pc.scheduleWaited.add(activeGroup.id);
        await waitUntilBrasilia(pc.scheduleEnv, () => cancelled(), sendLeadMs());
        if (cancelled()) throw new Error("__CANCELLED__");
        tClock = performance.now();
        this.openMarks.set(activeGroup.id, tClock);
        this.openMarks.set(g.id, tClock);
      }
      let msg: any;
      try {
        if (payload) {
          tDispatch = performance.now();
          // RPC cru pré-montado, em ondas escalonadas alternando as duas
          // conexões da conta com o MESMO randomId (o Telegram deduplica no
          // servidor) — se um socket travar, a próxima onda responde em ~150ms.
          msg = await hedgedSend([pc.client, pc.altClient].filter(Boolean), payload, {
            alive: () => this.running,
          });

        } else {
          const peer = pc.peers.get(activeGroup.id) ?? (await this.resolveWith(pc.client, activeGroup.input, activeGroup.name));
          const sendPeer = await this.resolveSendPeer(pc.client, peer);
          // Camada C — fallback com randomId estável (dedupe do Telegram vale
          // até no path lento).
          let rid = pc.fallbackRandomIds.get(activeGroup.id);
          if (!rid) { rid = makeRandomId(); pc.fallbackRandomIds.set(activeGroup.id, rid); }
          tDispatch = performance.now();
          msg = await pc.client.sendText(sendPeer, activeGroup.message, { randomId: rid });
        }
      } catch (e) {
        if (!isPeerInvalidError(e)) throw e;
        const rid = payload?.randomId ?? pc.fallbackRandomIds.get(activeGroup.id) ?? makeRandomId();
        pc.fallbackRandomIds.set(activeGroup.id, rid);
        const nextPayload = await refreshPeerForInvalidGroup(rid);
        msg = await pc.client.sendText(nextPayload.peer, nextPayload.text, { randomId: nextPayload.randomId });
      }
      return msg;
    };
    // Sem stagger — todas as contas largam o sendText no mesmo instante.
    // O `randomId` estável cobre dedupe do lado servidor, e FLOOD_WAIT é
    // tratado dormindo o `waitSec` retornado.
    const sendPromise = (async () => {
      if (cancelled()) throw new Error("__CANCELLED__");
      return await runSend();
    })();
    // Registra a promise ANTES do primeiro await, pra qualquer nova
    // entrada em fireOne enxergar e aguardar.
    pc.inFlight.set(g.id, sendPromise.then(() => {}, () => {}));
    try {
      const msg: any = await sendPromise;
      // Se o monitor foi parado enquanto o RPC estava em voo, descarta
      // TUDO: não marca completed, não empurra em sends, não loga sucesso.
      // A mensagem pode ter chegado no Telegram, mas do ponto de vista
      // do painel esse envio não existiu.
      if (cancelled()) {
        this.log("warn", `Envio descartado em '${g.name}' — monitor foi parado. (${pc.title})`);
        return;
      }
      const tAck = performance.now();
      // dt = detecção da abertura → disparo do sendText (número comparável
      // aos antigos "0.19s"). ackMs = até a confirmação do servidor.
      const dt = Math.max(0, Math.round((tDispatch || tAck) - tClock));
      const ackMs = Math.round(tAck - tClock);
      // Sela a trava permanente ANTES de qualquer log/emit — nenhuma
      // outra entrada em fireOne pode passar depois deste ponto.
      // Se outro sendText paralelo já venceu a corrida (Telegram dedupou
      // pelo randomId), esse é o "vencedor perdedor" — não loga sucesso
      // duplicado nem empurra em `sends`.
      if (pc.completed.has(g.id) || pc.completed.has(activeGroup.id)) return;
      // Fire-and-forget: não bloqueia o log/emit do envio bem-sucedido.
      pc.client.call({ _: "account.updateStatus", offline: true }).catch(() => { /* ignore */ });
      pc.completed.add(g.id);
      pc.completed.add(activeGroup.id);
      pc.statuses[activeGroup.id] = "open";
      const tgDate: number | undefined = msg?.date ?? msg?.raw?.date;
      const tgMsgId: number | undefined = msg?.id ?? msg?.raw?.id;
      if (typeof tgDate === "number" && typeof tgMsgId === "number") {
        this.sends = [...this.sends, {
          groupId: activeGroup.id, groupName: `${pc.title} · ${activeGroup.name}`,
          messageId: Number(tgMsgId), dateSec: Number(tgDate),
        }];
      }
      this.log("success", `${pc.title}; Enviado; confirmado em ${(ackMs / 1000).toFixed(2)}s`);
      queueMicrotask(() => {
        console.log(`[multi] '${pc.title} · ${activeGroup.name}' detecção→dispatch=${dt}ms dispatch→ack=${Math.max(0, ackMs - dt)}ms total=${ackMs}ms`);
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("__CANCELLED__") || cancelled()) {
        // Cancelado antes de sair (ou durante). Não retenta, não loga erro.
        return;
      }
      // Camada I — FLOOD_WAIT / SLOWMODE_WAIT: aguarda o tempo pedido e
      // retenta com o MESMO randomId (dedup nativo do Telegram evita
      // duplicata se por acaso a chamada anterior tiver chegado no server).
      const waitMatch = msg.match(/(?:FLOOD_WAIT|SLOWMODE_WAIT)_(\d+)/i);
      if (waitMatch && !pc.completed.has(g.id)) {
        const waitSec = Math.min(Number(waitMatch[1]) || 1, 60);
        floodRetryCount++;
        this.log("warn", `FLOOD_WAIT ${waitSec}s em '${g.name}' — aguardando e retentando. (${pc.title})`);
        // Solta a fila antes de dormir pra não travar outras contas.
        pc.inFlight.delete(g.id);
        this.inFlightSends = Math.max(0, this.inFlightSends - 1);
        countedInFlight = false;
        await new Promise((r) => setTimeout(r, waitSec * 1000 + 150));
        if (cancelled()) return;
        pc.sent.delete(g.id);
        await this.fireOne(pc, g, tDetect);
        return;
      }
      if (CLOSED_ERRORS.some((c) => msg.includes(c))) {
        // Fechado/slowmode → libera pra próxima abertura, MAS só se ainda
        // não completamos. (Camada F garante isso.)
        if (!pc.completed.has(g.id)) {
          pc.sent.delete(g.id);
          pc.statuses[g.id] = "closed";
          // Marco de abertura inválido (grupo ainda fechado) — descarta pra
          // o cronômetro do envio real não somar o tempo de espera.
          this.openMarks.delete(g.id);
        }
        return;
      }
      // Camada B — só libera pra retry quando temos CERTEZA de que a
      // mensagem não saiu (erros pré-envio). Qualquer outro erro pode
      // significar que o Telegram já processou; NÃO reenviamos.
      const PRE_SEND_ERRORS = [
        "AUTH_KEY_UNREGISTERED",
        "CONNECTION_NOT_INITED",
        "SESSION_REVOKED",
        "SESSION_PASSWORD_NEEDED",
        "not connected",
        "no client",
        "Client is not started",
      ];
      const isPreSend = PRE_SEND_ERRORS.some((c) => msg.toLowerCase().includes(c.toLowerCase()));
      if (isTransientStorageError(e) && !pc.completed.has(g.id)) {
        // Falha do IndexedDB local: a mensagem com certeza não saiu.
        // Libera pro loop tentar de novo no próximo tick, sem selar o grupo.
        pc.sent.delete(g.id);
      } else if (isPreSend && !pc.completed.has(g.id)) {
        pc.sent.delete(g.id);
        void this.tryReconnectClient(pc, msg);
      } else if (isPeerInvalidError(e) && !pc.completed.has(g.id)) {
        pc.peers.delete(g.id);
        pc.payloads.delete(g.id);
        pc.sent.delete(g.id);
        pc.statuses[g.id] = "closed";
        this.log("warn", `Grupo '${g.name}' estava com referência inválida; cache atualizado para tentar novamente. (${pc.title})`);
      } else {
        // Trava total: mantém sent e sela completed.
        pc.completed.add(g.id);
        this.log("warn", `Envio incerto em '${g.name}': ${msg} — não vou retentar pra evitar duplicata. (${pc.title})`);
      }
    } finally {
      pc.inFlight.delete(g.id);
      if (countedInFlight) this.inFlightSends = Math.max(0, this.inFlightSends - 1);
      this.emitThrottled();
    }
  }

  stop(reason?: "auto" | "manual") {
    if (!this.running) return;
    this.running = false;
    void disarmMiami();
    if (this.loopHandle) { clearTimeout(this.loopHandle); this.loopHandle = null; }
    for (const pc of this.perClient.values()) {
      if (pc.keepaliveHandle) clearInterval(pc.keepaliveHandle);
      try { pc.offRawUpdate?.(); } catch {/* ignore */}
      try { pc.offNewMessage?.(); } catch {/* ignore */}
      for (const p of pc.openedChats) {
        pc.client.closeChat?.(p.inputPeer ?? p).catch(() => {});
      }
      pc.sent.clear();
      pc.completed.clear();
      pc.inFlight.clear();
    }
    // Invalida o token AGORA — qualquer sendText que resolva depois
    // disso será descartado silenciosamente por fireOne.
    this.sessionToken++;
    this.inFlightSends = 0;
    this.openMarks.clear();
    this.groupIdToClients.clear();
    this.log(
      "info",
      reason === "auto" ? "Interrompido; automático" : "Interrompido; manual",
    );
    this.emit();
  }

  private startClientLoop(pc: PerClient) {
    if (pc.method === "mensagem") return; // event-driven, sem polling
    if (!this.loopHandle) this.loopHandle = setTimeout(() => {}, 0);
    // "Grupo aberto 2": não espera o grupo abrir — aguarda o horário exato
    // de Brasília (HH:MM:SS) e dispara em todos os grupos ativos.
    if (pc.method === "abertura2" && pc.scheduleEnv) {
      void (async () => {
        const hhmmss = pc.scheduleEnv!;
        await waitUntilBrasilia(hhmmss, () => !this.running);
        if (!this.running) return;
        const groups = Array.from(pc.groupCache.values());
        for (const g of groups) pc.scheduleWaited.add(g.id);
        await Promise.all(groups.map((g) => this.fireOne(pc, g, performance.now())));
        this.emit();
      })();
      return;
    }
    for (const g of pc.groupCache.values()) {
      void (async () => {
        // 1) Tentativa inicial: cobre o caso raro do grupo já estar aberto
        //    no start do monitor.
        // 2) Se voltar CHAT_WRITE_FORBIDDEN, PARA de tentar. O handler de
        //    updateChannelDefaultBannedRights (raw update) dispara fireOne
        //    no instante em que o Telegram avisa que a permissão mudou.
        // 3) Safety-net lento (a cada 3s) só como fallback caso o Telegram
        //    não broadcaste o update. Sem spam → sem FLOOD_WAIT.
        // Safety-net rápido: se o raw update não chegar nessa conta (drop
        // de WebSocket, DC lento), o fanout cross-account já cobre a maioria
        // dos casos. Este poll é o último recurso — 750ms mantém a detecção
        // rápida sem gerar FLOOD (CLOSED_ERROR não conta pro rate limit).
        const SAFETY_POLL_MS = 40;
        let closedTries = 0;
        while (this.running) {
          if (pc.completed.has(g.id)) return;
          const stillActive = clientData.getGroups(pc.clientId).find((x) => x.id === g.id)?.active;
          if (!stillActive) return;
          if (pc.statuses[g.id] === "open") return;
          // Só dispara se não há outro sendText do mesmo grupo em voo.
          if (!pc.inFlight.has(g.id)) {
            await this.fireOne(pc, g, performance.now());
          }
          if (pc.completed.has(g.id) || pc.statuses[g.id] === "open") return;
          closedTries++;
          // Backoff: sondar com sendText a cada 40ms por minutos gera
          // FLOOD_WAIT e faz o envio real sair segundos depois. O gatilho
          // rápido continua sendo o raw update + fanout cross-account.
          // Janela quente: 40ms fixos por ~30s (CLOSED_ERROR não conta pro
          // rate limit do Telegram). Só depois de muito tempo ocioso o poll
          // desacelera, pra não gerar FLOOD à toa. O gatilho principal segue
          // sendo o raw update + fanout cross-account.
          const wait = closedTries < 750 ? SAFETY_POLL_MS : closedTries < 1500 ? 100 : 250;
          await new Promise((r) => setTimeout(r, wait));
        }
      })();
    }
  }

  /** Auto-stop quando todos os grupos de todas as contas abriram. */
  allDone(): boolean {
    if (this.perClient.size === 0) return false;
    // Ainda booting — peers/payloads podem não estar resolvidos.
    if (!this.bootCompleted) return false;
    // Se ainda há envio em andamento, não é o momento de encerrar.
    if (this.inFlightSends > 0) return false;
    let anyExpected = false;
    for (const pc of this.perClient.values()) {
      const expected = pc.payloads.size || pc.peers.size;
      if (expected === 0) continue;
      anyExpected = true;
      const opened = Object.values(pc.statuses).filter((s) => s === "open").length;
      if (opened < expected) return false;
    }
    // Nenhum grupo resolvido em nenhuma conta → não encerra sozinho.
    return anyExpected;
  }
}

export const multiMonitor = new MultiMonitor();
