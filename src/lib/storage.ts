import { appAuth } from "@/lib/appAuth";
import * as cloud from "@/lib/cloudSync";

const KEY_CREDS = "creds";
const KEY_SESSION = "session";
const KEY_GROUPS = "groups";
const KEY_ME = "me";
const ACTIVE_CLIENT_KEY = "active_client_v1";

export interface TgCreds {
  apiId: number;
  apiHash: string;
}

export interface TgMe {
  id: string;
  firstName: string;
  username: string | null;
  phone: string | null;
  photoUrl?: string | null;
}

export interface MonitoredGroup {
  id: string; // string form of peer id
  input: string; // username/link/id used to resolve
  /** @usuário público do grupo (quando houver) — usado como 2º caminho. */
  username?: string | null;
  name: string;
  message: string;
  active: boolean;
  addedAt: number;
  photoUrl?: string | null;
  /** Epoch ms do horário previsto de abertura do grupo (opcional). */
  openAt?: number | null;
}

export interface ClientRecord {
  id: string;
  title: string;
  createdAt: number;
  phone?: string | null;
  meName?: string | null;
  hasSession: boolean;
  photoUrl?: string | null;
  /** Horário (HH:MM) — Rascunho. */
  scheduleRas?: string | null;
  /** Horário (HH:MM) — Fechamento após rascunho. */
  scheduleFim?: string | null;
  /** Horário (HH:MM) — Envio do rascunho. */
  scheduleEnv?: string | null;
  /** Cliente fixado no topo da lista. */
  pinned?: boolean;
  /** Dias da semana ativos (0=Dom ... 6=Sáb). */
  weekdays?: number[] | null;
  /** Frequência de atendimento. */
  frequency?: "diaria" | "semanal" | "quinzenal" | "mensal" | null;
  /** Âncora de recorrência quinzenal: epoch ms de UM dia em que o cliente atende.
   *  As demais ocorrências caem a cada 2 semanas nos dias marcados em `weekdays`,
   *  contando semanas ISO a partir da semana desse anchor. */
  biweeklyAnchor?: number | null;
  /** Dias do mês (1–31) em que o cliente atende (frequência "mensal").
   *  Se o mês não tem o dia (ex: 31/fev), pula pro último dia do mês. */
  monthlyDays?: number[] | null;
  /** Exceções pontuais: "mover atendimento de X pra Y". Datas em YYYY-MM-DD (fuso local). */
  scheduleOverrides?: Array<{ id: string; from: string; to: string; note?: string | null; skip?: boolean | null }> | null;
  /** Username/link do grupo preferencial (opcional). */
  preferredGroup?: string | null;
  /** Método de disparo:
   *  - "abertura"  → dispara assim que o grupo abre (padrão).
   *  - "mensagem"  → dispara após mensagem de admin.
   *  - "abertura2" → detecta abertura mas só dispara no horário exato
   *                  do último ABE (scheduleEnv) em Brasília. */
  method?: "abertura" | "mensagem" | "abertura2" | null;
  /** Epoch ms de quando a sessão Telegram foi conectada com sucesso. */
  connectedAt?: number | null;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function userScope(): string {
  // prioriza UUID do supabase (estável); cai pro username em sessões antigas
  const id = appAuth.currentUserId();
  if (id) return `tg_cloud_v1:${id}`;
  const u = appAuth.current() ?? "_anon";
  return `tg_app_v2:${u}`;
}

// In-memory + sessionStorage active client id (per tab).
let _activeClientId: string | null = null;
export const activeClient = {
  set(id: string | null) {
    _activeClientId = id;
    if (!isBrowser()) return;
    if (id) window.sessionStorage.setItem(ACTIVE_CLIENT_KEY, id);
    else window.sessionStorage.removeItem(ACTIVE_CLIENT_KEY);
  },
  get(): string | null {
    if (_activeClientId) return _activeClientId;
    if (!isBrowser()) return null;
    _activeClientId = window.sessionStorage.getItem(ACTIVE_CLIENT_KEY);
    return _activeClientId;
  },
};

function clientScope(): string {
  const cid = activeClient.get();
  if (!cid) throw new Error("Nenhum cliente ativo selecionado.");
  return `${userScope()}:client:${cid}`;
}

function k(scope: string, suffix: string) {
  return `${scope}:${suffix}`;
}

function read<T>(key: string): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write<T>(key: string, value: T) {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function remove(key: string) {
  if (!isBrowser()) return;
  window.localStorage.removeItem(key);
}

export const storage = {
  getCreds: () => read<TgCreds>(k(clientScope(), KEY_CREDS)),
  setCreds: (c: TgCreds) => {
    write(k(clientScope(), KEY_CREDS), c);
    const cid = activeClient.get();
    if (cid) cloud.pushCreds(appAuth.currentUserId(), cid, c);
  },

  getSession: (): string => {
    if (!isBrowser()) return "";
    return window.localStorage.getItem(k(clientScope(), KEY_SESSION)) ?? "";
  },
  setSession: (s: string) => {
    if (!isBrowser()) return;
    window.localStorage.setItem(k(clientScope(), KEY_SESSION), s);
    const cid = activeClient.get();
    if (cid) cloud.pushSession(appAuth.currentUserId(), cid, s);
  },
  clearSession: () => {
    remove(k(clientScope(), KEY_SESSION));
    const cid = activeClient.get();
    if (cid) cloud.pushSession(appAuth.currentUserId(), cid, null);
  },

  // Apenas grava local — usado pelo cloudSync no pull, sem reenviar pra nuvem.
  _setCredsLocalFor: (clientId: string, c: TgCreds) => {
    if (!isBrowser()) return;
    window.localStorage.setItem(`${userScope()}:client:${clientId}:${KEY_CREDS}`, JSON.stringify(c));
  },
  _setSessionLocalFor: (clientId: string, s: string) => {
    if (!isBrowser()) return;
    window.localStorage.setItem(`${userScope()}:client:${clientId}:${KEY_SESSION}`, s);
  },
  setMeFor: (clientId: string, m: TgMe) => {
    if (!isBrowser()) return;
    window.localStorage.setItem(`${userScope()}:client:${clientId}:${KEY_ME}`, JSON.stringify(m));
  },
  setSessionFor: (clientId: string, s: string) => {
    if (!isBrowser()) return;
    window.localStorage.setItem(`${userScope()}:client:${clientId}:${KEY_SESSION}`, s);
    void cloud.pushSession(appAuth.currentUserId(), clientId, s);
  },

  getMe: () => read<TgMe>(k(clientScope(), KEY_ME)),
  setMe: (m: TgMe) => write(k(clientScope(), KEY_ME), m),

  getGroups: (): MonitoredGroup[] => read<MonitoredGroup[]>(k(clientScope(), KEY_GROUPS)) ?? [],
  setGroups: (g: MonitoredGroup[]) => write(k(clientScope(), KEY_GROUPS), g),
  // Atualiza apenas o cache local (usado pelo cloudSync no pull).
  _setGroupsLocal: (g: MonitoredGroup[]) => write(k(clientScope(), KEY_GROUPS), g),
  _setGroupsLocalFor: (clientId: string, g: MonitoredGroup[]) =>
    write(`${userScope()}:client:${clientId}:${KEY_GROUPS}`, g),
  upsertGroup: (g: MonitoredGroup) => {
    const all = storage.getGroups();
    const idx = all.findIndex((x) => x.id === g.id);
    if (idx >= 0) all[idx] = g;
    else all.push(g);
    storage.setGroups(all);
    cloud.pushGroup(appAuth.currentUserId(), activeClient.get(), g);
  },
  removeGroup: (id: string) => {
    storage.setGroups(storage.getGroups().filter((g) => g.id !== id));
    cloud.deleteGroup(appAuth.currentUserId(), activeClient.get(), id);
  },

  // Limpa apenas a sessão do cliente ativo (creds + session + me + groups).
  clearActiveClient: () => {
    try {
      const s = clientScope();
      remove(k(s, KEY_CREDS));
      remove(k(s, KEY_SESSION));
      remove(k(s, KEY_GROUPS));
      remove(k(s, KEY_ME));
    } catch {
      // sem cliente ativo — nada a limpar
    }
  },
};

// ----------------- Lista de clientes (por usuário do app) -----------------

const CLIENTS_INDEX_KEY = "clients_index_v1";

function clientsKey() {
  return `${userScope()}:${CLIENTS_INDEX_KEY}`;
}

export const clientsStore = {
  list(): ClientRecord[] {
    return read<ClientRecord[]>(clientsKey()) ?? [];
  },
  get(id: string): ClientRecord | undefined {
    return clientsStore.list().find((c) => c.id === id);
  },
  _setAll(list: ClientRecord[]) {
    write(clientsKey(), list);
  },
  add(rec: ClientRecord) {
    const all = clientsStore.list();
    all.push(rec);
    write(clientsKey(), all);
    cloud.pushClient(appAuth.currentUserId(), rec);
  },
  update(id: string, patch: Partial<ClientRecord>) {
    const all = clientsStore.list();
    const idx = all.findIndex((c) => c.id === id);
    if (idx < 0) return;
    all[idx] = { ...all[idx], ...patch };
    write(clientsKey(), all);
    cloud.pushClient(appAuth.currentUserId(), all[idx]);
  },
  remove(id: string) {
    write(clientsKey(), clientsStore.list().filter((c) => c.id !== id));
    cloud.deleteClient(appAuth.currentUserId(), id);
  },
  // Apaga creds/session/groups/me daquele cliente, independente de estar ativo.
  wipeClientData(id: string) {
    if (!isBrowser()) return;
    const base = `${userScope()}:client:${id}`;
    remove(`${base}:${KEY_CREDS}`);
    remove(`${base}:${KEY_SESSION}`);
    remove(`${base}:${KEY_GROUPS}`);
    remove(`${base}:${KEY_ME}`);
  },
  clearSessionOnly(id: string) {
    if (!isBrowser()) return;
    remove(`${userScope()}:client:${id}:${KEY_SESSION}`);
    void cloud.pushSession(appAuth.currentUserId(), id, null);
  },
};

// ----------------- Leituras por clientId (sem trocar o cliente ativo) -----------------

function clientScopeFor(clientId: string) {
  return `${userScope()}:client:${clientId}`;
}

export const clientData = {
  getCreds(clientId: string): TgCreds | null {
    return read<TgCreds>(`${clientScopeFor(clientId)}:${KEY_CREDS}`);
  },
  getSession(clientId: string): string {
    if (!isBrowser()) return "";
    return window.localStorage.getItem(`${clientScopeFor(clientId)}:${KEY_SESSION}`) ?? "";
  },
  getGroups(clientId: string): MonitoredGroup[] {
    return read<MonitoredGroup[]>(`${clientScopeFor(clientId)}:${KEY_GROUPS}`) ?? [];
  },
  getMe(clientId: string): TgMe | null {
    return read<TgMe>(`${clientScopeFor(clientId)}:${KEY_ME}`);
  },
  setGroups(clientId: string, list: MonitoredGroup[]) {
    write(`${clientScopeFor(clientId)}:${KEY_GROUPS}`, list);
  },
  upsertGroup(clientId: string, g: MonitoredGroup) {
    const all = clientData.getGroups(clientId);
    const idx = all.findIndex((x) => x.id === g.id);
    if (idx >= 0) all[idx] = g;
    else all.push(g);
    clientData.setGroups(clientId, all);
    cloud.pushGroup(appAuth.currentUserId(), clientId, g);
  },
  removeGroup(clientId: string, id: string) {
    clientData.setGroups(clientId, clientData.getGroups(clientId).filter((g) => g.id !== id));
    cloud.deleteGroup(appAuth.currentUserId(), clientId, id);
  },
};

// ----------------- Configurações de monitoramento (por usuário) -----------------

export interface MonitorSettings {
  autoStop: boolean;
  showClock: boolean;
  showGroupIcons: boolean;
  sound: boolean;
  /** Toca som ao iniciar monitoramento. */
  soundStart: boolean;
  /** Toca som ao parar monitoramento. */
  soundStop: boolean;
  /** Nome do som ao iniciar. */
  soundStartName: string;
  /** Nome do som ao parar. */
  soundStopName: string;
  /** Limpa o console automaticamente após parar. */
  autoClearConsole: boolean;
  /** Aplica blur no rascunho do cliente. */
  censorDraft: boolean;
  /** Aplica blur no nome do grupo. */
  censorGroupName: boolean;
  /** Aplica blur na foto do grupo. */
  censorGroupPhoto: boolean;
  /** Mostra a foto de perfil do cliente. */
  showClientPhoto: boolean;
  /** Aplica blur na foto de perfil do cliente. */
  censorClientPhoto: boolean;
  /** Aplica blur no nome/usuário do cliente. */
  censorClientName: boolean;
  /** Aplica blur no título (apelido) do cliente. */
  censorClientTitle: boolean;
  /** Aplica blur no ID do cliente (breadcrumb). */
  censorClientId: boolean;
}

const MONITOR_SETTINGS_KEY = "monitor_settings_v1";
const DEFAULT_SETTINGS: MonitorSettings = {
  autoStop: true,
  showClock: true,
  showGroupIcons: true,
  sound: true,
  soundStart: true,
  soundStop: true,
  soundStartName: "sparkles",
  soundStopName: "sparkles2",
  autoClearConsole: false,
  censorDraft: false,
  censorGroupName: false,
  censorGroupPhoto: false,
  showClientPhoto: true,
  censorClientPhoto: false,
  censorClientName: false,
  censorClientTitle: false,
  censorClientId: false,
};

function settingsKey() {
  return `${userScope()}:${MONITOR_SETTINGS_KEY}`;
}

export const monitorSettings = {
  get(): MonitorSettings {
    const s = read<Partial<MonitorSettings>>(settingsKey());
    return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  },
  _setLocal(s: MonitorSettings) {
    write(settingsKey(), s);
  },
  set(s: MonitorSettings) {
    write(settingsKey(), s);
    void cloud.pushSettings(appAuth.currentUserId(), s);
  },
  patch(p: Partial<MonitorSettings>) {
    monitorSettings.set({ ...monitorSettings.get(), ...p });
  },
};

// ----------------- Rascunho do wizard de novo cliente (por usuário) -----------------

export type WizardStep = "title" | "creds" | "phone" | "mtCode" | "code";

export interface WizardDraft {
  step: WizardStep;
  title: string;
  schedRas: string;
  schedFim: string;
  schedEnv: string;
  weekdays: number[];
  apiId: string;
  apiHash: string;
  ddi: string;
  phone: string;
  phoneCodeHash: string;
  randomHash?: string;
  /** Mensagem laranja persistente quando cai no fallback manual de credenciais. */
  credsInfo?: string;
  /** Timestamp em ms de quando o phoneCodeHash foi obtido (sendCode/resendCode). */
  codeSentAt?: number;
  savedAt: number;
}

const WIZARD_DRAFT_KEY = "wizard_draft_v2";
function wizardKey() {
  return `${userScope()}:${WIZARD_DRAFT_KEY}`;
}

export const wizardDraft = {
  get(): WizardDraft | null {
    return read<WizardDraft>(wizardKey());
  },
  set(d: WizardDraft) {
    write(wizardKey(), d);
  },
  clear() {
    remove(wizardKey());
  },
};