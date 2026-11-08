// Espelha clientes, grupos e settings no Lovable Cloud.
// O `storage.ts` mantém um cache local (localStorage) com API síncrona;
// cada escrita do storage chama as funções `push*` daqui em background.
// No login (e ao trocar de cliente) chamamos `pullAll` / `pullGroups`
// pra atualizar o cache local com o que está no banco.

import { supabase } from "@/integrations/supabase/client";
import { appAuth } from "@/lib/appAuth";
import {
  storage,
  clientsStore,
  monitorSettings,
  type ClientRecord,
  type MonitoredGroup,
  type MonitorSettings,
  type TgCreds,
} from "@/lib/storage";
import {
  pushClientSecrets as pushClientSecretsFn,
  pullClientSecrets as pullClientSecretsFn,
  pullAllClientSecrets as pullAllClientSecretsFn,
} from "@/lib/sessionCrypto.functions";

// Async replies belong to the account that started the request. Storage uses
// the current account at write time, so stale replies must never reach it.
function isCurrentUser(userId: string | null): userId is string {
  return !!userId && appAuth.currentUserId() === userId;
}

function logErr(ctx: string, err: unknown) {
  // não atrapalha o uso — só loga
  console.warn(`[cloudSync] ${ctx}:`, err);
}

// ---------- mappers ----------
function rowToClient(r: any): ClientRecord {
  const scheduleOverrides = Array.isArray(r.schedule_overrides)
    ? r.schedule_overrides
        .filter(
          (o: any) =>
            o && typeof o.id === "string" && typeof o.from === "string" && typeof o.to === "string",
        )
        .map((o: any) => ({
          id: o.id,
          from: o.from,
          to: o.to,
          note: o.note ?? null,
          skip: !!o.skip,
        }))
    : null;
  return {
    id: r.id,
    title: r.title,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    phone: r.phone ?? null,
    meName: r.me_name ?? null,
    hasSession: !!r.has_session,
    photoUrl: r.photo_url ?? null,
    scheduleRas: r.schedule_ras ?? null,
    scheduleFim: r.schedule_fim ?? null,
    scheduleEnv: r.schedule_env ?? null,
    pinned: !!r.pinned,
    weekdays: Array.isArray(r.weekdays) ? r.weekdays : null,
    frequency:
      r.frequency === "quinzenal" || r.frequency === "mensal" || r.frequency === "diaria"
        ? r.frequency
        : "semanal",
    biweeklyAnchor: r.biweekly_anchor != null ? Number(r.biweekly_anchor) : null,
    monthlyDays: Array.isArray(r.monthly_days) ? r.monthly_days : null,
    scheduleOverrides,
    method:
      r.method === "abertura2" ? "abertura2" : r.method === "mensagem" ? "mensagem" : "abertura",
  };
}

function clientToRow(c: ClientRecord, userId: string) {
  return {
    id: c.id,
    user_id: userId,
    title: c.title,
    phone: c.phone ?? null,
    me_name: c.meName ?? null,
    has_session: !!c.hasSession,
    photo_url: c.photoUrl ?? null,
    schedule_ras: c.scheduleRas ?? null,
    schedule_fim: c.scheduleFim ?? null,
    schedule_env: c.scheduleEnv ?? null,
    pinned: !!c.pinned,
    weekdays: c.weekdays ?? null,
    frequency: c.frequency ?? "semanal",
    biweekly_anchor: c.biweeklyAnchor ?? null,
    monthly_days: c.monthlyDays ?? null,
    schedule_overrides: c.scheduleOverrides ?? [],
    method: c.method ?? "abertura",
  };
}

function hasFlexibleAgenda(c: ClientRecord | undefined): boolean {
  if (!c) return false;
  return (
    c.frequency === "quinzenal" ||
    c.frequency === "mensal" ||
    c.biweeklyAnchor != null ||
    (c.monthlyDays?.length ?? 0) > 0 ||
    (c.scheduleOverrides?.length ?? 0) > 0
  );
}

function mergePreservingLocalAgenda(
  remote: ClientRecord,
  local: ClientRecord | undefined,
): ClientRecord {
  if (!local || !hasFlexibleAgenda(local) || hasFlexibleAgenda(remote)) return remote;
  return {
    ...remote,
    weekdays: local.weekdays ?? remote.weekdays,
    frequency: local.frequency ?? remote.frequency,
    biweeklyAnchor: local.biweeklyAnchor ?? remote.biweeklyAnchor,
    monthlyDays: local.monthlyDays ?? remote.monthlyDays,
    scheduleOverrides: local.scheduleOverrides ?? remote.scheduleOverrides,
  };
}

function rowToGroup(r: any): MonitoredGroup {
  return {
    id: r.id,
    input: r.input,
    name: r.name,
    message: r.message ?? "",
    active: !!r.active,
    addedAt: r.added_at ? new Date(r.added_at).getTime() : Date.now(),
    photoUrl: r.photo_url ?? null,
    openAt: r.open_at ? new Date(r.open_at).getTime() : null,
  };
}

function groupToRow(g: MonitoredGroup, clientId: string, userId: string) {
  return {
    id: g.id,
    client_id: clientId,
    user_id: userId,
    input: g.input,
    name: g.name,
    message: g.message ?? "",
    active: !!g.active,
    photo_url: g.photoUrl ?? null,
    open_at: g.openAt ? new Date(g.openAt).toISOString() : null,
  };
}

function rowToSettings(r: any): MonitorSettings {
  // Merge com defaults atuais — campos novos (censura/foto/som split/etc.)
  // vivem só local até existirem colunas no schema.
  const base = monitorSettings.get();
  return {
    ...base,
    autoStop: !!r.auto_stop,
    showClock: !!r.show_clock,
    showGroupIcons: !!r.show_group_icons,
    sound: !!r.sound,
  };
}

// ---------- PULL (cloud → local) ----------
export async function pullAll(userId: string): Promise<void> {
  if (!isCurrentUser(userId)) return;
  try {
    const { data, error } = await supabase
      .from("clients")
      .select(
        "id,title,created_at,phone,me_name,has_session,photo_url,schedule_ras,schedule_fim,schedule_env,pinned,weekdays,frequency,biweekly_anchor,monthly_days,schedule_overrides,method",
      )
      .eq("user_id", userId);
    if (!isCurrentUser(userId)) return;
    if (error) throw error;
    const localById = new Map(clientsStore.list().map((c) => [c.id, c]));
    const list = (data ?? []).map((row) =>
      mergePreservingLocalAgenda(rowToClient(row), localById.get(row.id)),
    );
    clientsStore._setAll(list);
    for (const c of list) {
      const local = localById.get(c.id);
      if (
        hasFlexibleAgenda(local) &&
        !hasFlexibleAgenda(rowToClient((data ?? []).find((row) => row.id === c.id)))
      ) {
        pushClient(userId, c);
      }
    }
    // Espelha credenciais e session do Telegram (decriptadas server-side)
    // pra cada cliente — necessário pra abrir a conta em outro dispositivo.
    try {
      const secrets = await pullAllClientSecretsFn();
      if (!isCurrentUser(userId)) return;
      const mod = await import("@/lib/storage");
      if (!isCurrentUser(userId)) return;
      for (const row of data ?? []) {
        const s = secrets?.[row.id];
        if (s?.apiId != null && s.apiHash) {
          storage._setCredsLocalFor(row.id, { apiId: Number(s.apiId), apiHash: String(s.apiHash) });
        } else {
          const localCreds = mod.clientData.getCreds(row.id);
          if (localCreds) pushCreds(userId, row.id, localCreds);
        }
        if (s?.session) {
          storage._setSessionLocalFor(row.id, String(s.session));
        } else {
          const localSess = mod.clientData.getSession(row.id);
          if (localSess && localSess.length > 4) pushSession(userId, row.id, localSess);
        }
      }
    } catch (e) {
      logErr("pullAll/secrets", e);
    }
  } catch (e) {
    logErr("pullAll/clients", e);
  }
  if (!isCurrentUser(userId)) return;
  try {
    const { data, error } = await supabase
      .from("monitor_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!isCurrentUser(userId)) return;
    if (error) throw error;
    if (data) monitorSettings._setLocal(rowToSettings(data));
    else {
      // primeira vez: cria com defaults
      const s = monitorSettings.get();
      await pushSettings(userId, s);
    }
  } catch (e) {
    logErr("pullAll/settings", e);
  }
}

export async function pullGroups(userId: string, clientId: string): Promise<void> {
  if (!isCurrentUser(userId) || !clientId) return;
  try {
    const { data, error } = await supabase
      .from("monitored_groups")
      .select("*")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .order("added_at", { ascending: true });
    if (!isCurrentUser(userId)) return;
    if (error) throw error;
    storage._setGroupsLocalFor(clientId, (data ?? []).map(rowToGroup));
  } catch (e) {
    logErr("pullGroups", e);
  }
}

// ---------- PUSH (local → cloud) ----------
export function pushClient(userId: string | null, c: ClientRecord) {
  if (!isCurrentUser(userId)) return;
  void supabase
    .from("clients")
    .upsert(clientToRow(c, userId), { onConflict: "id" })
    .then(({ error }) => {
      if (error) logErr("pushClient", error);
    });
}

// Credenciais do Telegram sincronizadas via server function, com envelope
// encryption (AES-GCM + SESSION_ENCRYPTION_KEY). O browser nunca escreve
// api_hash/tg_session em plaintext no Postgres.
export function pushCreds(userId: string | null, clientId: string, creds: TgCreds) {
  if (!isCurrentUser(userId) || !clientId) return;
  void pushClientSecretsFn({
    data: { clientId, apiId: Number(creds.apiId), apiHash: String(creds.apiHash) },
  }).catch((err) => logErr("pushCreds", err));
}

export function pushSession(userId: string | null, clientId: string, session: string | null) {
  if (!isCurrentUser(userId) || !clientId) return;
  const payload = session && session.length > 4 ? session : null;
  void pushClientSecretsFn({ data: { clientId, session: payload } }).catch((err) =>
    logErr("pushSession", err),
  );
}

export async function pullClientSecrets(userId: string | null, clientId: string): Promise<void> {
  if (!isCurrentUser(userId) || !clientId) return;
  try {
    const s = await pullClientSecretsFn({ data: { clientId } });
    if (!isCurrentUser(userId) || !s) return;
    if (s.apiId != null && s.apiHash) {
      storage._setCredsLocalFor(clientId, { apiId: Number(s.apiId), apiHash: String(s.apiHash) });
    }
    if (s.session) storage._setSessionLocalFor(clientId, String(s.session));
  } catch (e) {
    logErr("pullClientSecrets", e);
  }
}

export function deleteClient(userId: string | null, id: string) {
  if (!isCurrentUser(userId)) return;
  void supabase
    .from("clients")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .then(({ error }) => {
      if (error) logErr("deleteClient", error);
    });
}

export function pushGroup(userId: string | null, clientId: string | null, g: MonitoredGroup) {
  if (!isCurrentUser(userId) || !clientId) return;
  void supabase
    .from("monitored_groups")
    .upsert(groupToRow(g, clientId, userId), { onConflict: "client_id,id" })
    .then(({ error }) => {
      if (error) logErr("pushGroup", error);
    });
}

export function deleteGroup(userId: string | null, clientId: string | null, id: string) {
  if (!isCurrentUser(userId) || !clientId) return;
  void supabase
    .from("monitored_groups")
    .delete()
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .eq("id", id)
    .then(({ error }) => {
      if (error) logErr("deleteGroup", error);
    });
}

export async function pushSettings(userId: string | null, s: MonitorSettings) {
  if (!isCurrentUser(userId)) return;
  const { error } = await supabase.from("monitor_settings").upsert(
    {
      user_id: userId,
      auto_stop: s.autoStop,
      show_clock: s.showClock,
      show_group_icons: s.showGroupIcons,
      sound: s.sound,
    },
    { onConflict: "user_id" },
  );
  if (error) logErr("pushSettings", error);
}

// ---------- migração one-shot dos dados antigos do localStorage ----------
const MIGRATION_FLAG = "cloud_migrated_v1";
export async function migrateLegacyLocalDataOnce(userId: string, username: string) {
  if (typeof window === "undefined" || !isCurrentUser(userId) || appAuth.current() !== username)
    return;
  const flagKey = `${MIGRATION_FLAG}:${userId}`;
  const oldScope = `tg_app_v2:${username}`;
  const rawClients = window.localStorage.getItem(`${oldScope}:clients_index_v1`);

  // Se já rodou E não há dado local novo pra subir, sai.
  if (window.localStorage.getItem(flagKey) && !rawClients) return;

  // Checa se a nuvem já tem clientes desse usuário — se sim e flag setada, sai.
  if (window.localStorage.getItem(flagKey)) {
    try {
      const { count } = await supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if (!isCurrentUser(userId) || (count ?? 0) > 0) return;
    } catch {
      /* segue tentando migrar */
    }
  }

  if (!isCurrentUser(userId)) return;
  if (rawClients) {
    try {
      const list = JSON.parse(rawClients) as ClientRecord[];
      for (const c of list) {
        pushClient(userId, c);
        // grupos por cliente
        const rawGroups = window.localStorage.getItem(`${oldScope}:client:${c.id}:groups`);
        if (rawGroups) {
          try {
            const groups = JSON.parse(rawGroups) as MonitoredGroup[];
            for (const g of groups) pushGroup(userId, c.id, g);
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // settings antigos
  const rawSettings = window.localStorage.getItem(`${oldScope}:monitor_settings_v1`);
  if (rawSettings) {
    try {
      const s = JSON.parse(rawSettings) as Partial<MonitorSettings>;
      await pushSettings(userId, { ...monitorSettings.get(), ...s });
    } catch {
      /* ignore */
    }
  }

  if (isCurrentUser(userId)) window.localStorage.setItem(flagKey, "1");
}

// ---------- realtime (atualização cross-device) ----------
export function subscribeRealtime(userId: string, onChange: () => void) {
  if (!isCurrentUser(userId)) return () => {};
  let subscribed = true;
  const isActive = () => subscribed && isCurrentUser(userId);
  const notify = () => {
    if (isActive()) onChange();
  };
  const ch = supabase
    .channel(`user:${userId}:${Math.random().toString(36).slice(2, 10)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "clients", filter: `user_id=eq.${userId}` },
      () => {
        if (isActive()) void pullAll(userId).then(notify);
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "monitored_groups", filter: `user_id=eq.${userId}` },
      () => {
        if (!isActive()) return;
        const active =
          typeof window !== "undefined" ? window.sessionStorage.getItem("active_client_v1") : null;
        if (active) void pullGroups(userId, active).then(notify);
        else notify();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "monitor_settings", filter: `user_id=eq.${userId}` },
      () => {
        if (isActive()) void pullAll(userId).then(notify);
      },
    )
    .subscribe();
  return () => {
    subscribed = false;
    void supabase.removeChannel(ch);
  };
}
