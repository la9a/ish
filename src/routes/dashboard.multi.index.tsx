import { PageBanner } from "@/components/PageBanner";
import { clientPreparation } from "@/lib/clientPreparation";
import { AdminLayout } from "./admin";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clientsStore,
  clientData,
  monitorSettings,
  type ClientRecord,
  type MonitorSettings,
  type MonitoredGroup,
} from "@/lib/storage";
import { multiMonitor } from "@/lib/multiMonitor";
import {
  checkSessionHealth,
  pruneMissingGroups,
  syncClientGroupsMeta,
  type LogEntry,
} from "@/lib/telegram";
import {
  ArrowLeft,
  Play,
  Square,
  Settings as SettingsIcon,
  Search,
  ArrowUpRight,
  Pin,
  PinOff,
  Plus,
} from "lucide-react";
import { MonitorLog } from "@/components/MonitorLog";
import { AddGroupModal } from "@/components/AddGroupModal";
import { EditGroupModal } from "@/components/EditGroupModal";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { HelpHint } from "@/components/HelpHint";
import { MethodHelp } from "@/components/MethodHelp";

import { playSound } from "@/lib/beep";
import { ClientAvatar } from "@/components/ClientAvatar";
import { BrasiliaClock } from "@/components/BrasiliaClock";
import { MonitorSettingsPanel } from "@/components/MonitorSettingsPanel";
import { GroupSummaryCard } from "@/components/GroupSummaryCard";
import { MonitorClientCard } from "@/components/MonitorClientCard";
import { MonitoringWorkspace } from "@/components/MonitoringWorkspace";
import { WorkspaceIcon } from "@/components/WorkspaceIcon";
import { ScheduleTimeCard } from "@/components/ScheduleTimeCard";
export const Route = createFileRoute("/dashboard/multi/")({
  head: () => ({
    meta: [
      { title: "Atendimento Múltiplo | Senha Baixa" },
      { name: "description", content: "Monitore várias contas ao mesmo tempo no Senha Baixa." },
      { property: "og:title", content: "Atendimento Múltiplo | Senha Baixa" },
      {
        property: "og:description",
        content: "Monitore várias contas ao mesmo tempo no Senha Baixa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Atendimento Múltiplo | Senha Baixa" },
      {
        name: "twitter:description",
        content: "Monitore várias contas ao mesmo tempo no Senha Baixa.",
      },
    ],
  }),
  component: () => <AdminLayout content={<MultiPage />} />,
  errorComponent: ({ error, reset }) => (
    <div className="flex min-h-[60dvh] items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <h2 className="text-lg font-semibold text-foreground">Não foi possível carregar</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "Ocorreu um erro ao abrir o Atendimento Múltiplo."}
        </p>
        <Button
          onClick={() => {
            reset();
            window.location.reload();
          }}
          className="mt-4"
        >
          Recarregar
        </Button>
      </div>
    </div>
  ),
});

const MAX = 20;

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function fnv1a64(seed: string, salt: number): bigint {
  let h = 0xcbf29ce484222325n ^ BigInt(salt);
  for (let i = 0; i < seed.length; i++) {
    h ^= BigInt(seed.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}
function toBase62(n: bigint, len: number): string {
  let s = "";
  let v = n;
  for (let i = 0; i < len; i++) {
    s += B62[Number(v % 62n)];
    v = v / 62n;
  }
  return s;
}
/** Combina os IDs selecionados num hash determinístico de 18 chars (prefixo CC_/CCC_). */
export function combinedSelectionId(ids: string[]): string {
  const sorted = [...ids].sort();
  const seed = sorted.join("|");
  const prefix = sorted.length >= 3 ? "CCC_" : "CC_";
  const bodyLen = 18 - prefix.length;
  let out = "";
  let salt = 0;
  while (out.length < bodyLen) {
    out += toBase62(fnv1a64(seed, salt++), 11);
  }
  return prefix + out.slice(0, bodyLen);
}

const SELECTION_STORE_KEY = "multi:selection";
export function storeSelection(hash: string, ids: string[]) {
  try {
    const raw = sessionStorage.getItem(SELECTION_STORE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[hash] = ids;
    sessionStorage.setItem(SELECTION_STORE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
export function readSelection(hash: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(SELECTION_STORE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return Array.isArray(map[hash]) ? map[hash] : null;
  } catch {
    return null;
  }
}

export function MultiPage({ initialSelection }: { initialSelection?: string[] } = {}) {
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection ?? []));
  const [phase, setPhase] = useState<"select" | "panel">(
    initialSelection && initialSelection.length >= 2 ? "panel" : "select",
  );
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [statusByClient, setStatusByClient] = useState<Record<string, Record<string, string>>>({});
  const [settings, setSettings] = useState<MonitorSettings>(() => monitorSettings.get());
  const [panelOpen, setPanelOpen] = useState(false);
  const [prewarming, setPrewarming] = useState(false);
  const [miamiReady, setMiamiReady] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [innerEditor, setInnerEditor] = useState<{
    clientId: string;
    groupId?: string;
    addNew?: boolean;
  } | null>(null);

  const [, setReloadTick] = useState(0);
  const wasRunningRef = useRef(false);
  const [query, setQuery] = useState("");

  // Bip curto idêntico ao Single (start/stop).
  function beep(kind: "start" | "stop") {
    if (kind === "start" && !settings.soundStart) return;
    if (kind === "stop" && !settings.soundStop) return;
    playSound(kind === "start" ? settings.soundStartName : settings.soundStopName);
  }

  // Toca som ao iniciar/parar — inclui parada automática.
  useEffect(() => {
    if (running && !wasRunningRef.current) beep("start");
    if (!running && wasRunningRef.current) beep("stop");
    wasRunningRef.current = running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    setClients(clientsStore.list());
    const onCloud = () => setClients(clientsStore.list());
    window.addEventListener("cloud:changed", onCloud);
    return () => window.removeEventListener("cloud:changed", onCloud);
  }, []);

  // Prewarm quando entramos direto na rota /dashboard/multi/$selectionId
  useEffect(() => {
    if (initialSelection && initialSelection.length >= 2) {
      multiMonitor.resetPrewarm();
      multiMonitor.clearLogs();
      multiMonitor.clearSends();
      setMiamiReady(false);
      setPrewarming(true);
      // Timeout de segurança: nunca deixa o botão Iniciar preso em "..."
      const t = setTimeout(() => setPrewarming(false), 15_000);
      // Sincroniza metadados dos grupos (nome/foto/id atual) ANTES do prewarm.
      // Sem isso, na primeira sessão o resolveWith pode falhar com
      // "Grupo não encontrado" até o usuário abrir/fechar o modal de grupos.
      (async () => {
        try {
          const connection = multiMonitor.prewarm(initialSelection);
          void Promise.all(initialSelection.map((id) => syncClientGroupsMeta(id).catch(() => {})));
          setMiamiReady(await connection);
        } catch {
          setMiamiReady(false);
        } finally {
          clearTimeout(t);
          setPrewarming(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = multiMonitor.subscribe((s) => {
      setRunning(s.running);
      setLogs(s.logs);
      setStatusByClient(s.statusByClient);
    });
    return () => {
      unsub();
    };
  }, []);

  // Auto-stop
  useEffect(() => {
    if (!running || !settings.autoStop) return;
    if (multiMonitor.allDone()) multiMonitor.stop("auto");
  }, [statusByClient, running, settings.autoStop]);

  // Prevenir reload acidental
  useEffect(() => {
    function before(e: BeforeUnloadEvent) {
      if (running) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [running]);

  function updateSettings(p: Partial<MonitorSettings>) {
    const next = { ...settings, ...p };
    setSettings(next);
    monitorSettings.set(next);
  }

  function toggle(c: ClientRecord) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c.id)) next.delete(c.id);
      else {
        if (next.size >= MAX) return prev;
        next.add(c.id);
      }
      return next;
    });
  }

  const eligible = clients.filter((c) => c.hasSession);
  const preparedClients = eligible.filter(
    (client) => clientPreparation(client, clientData.getGroups(client.id)).ready,
  );
  const filteredEligible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? eligible.filter((c) =>
          String(c.title ?? "")
            .toLowerCase()
            .includes(q),
        )
      : eligible.slice();
    return base;
  }, [eligible, query]);
  const selectedList = clients.filter((c) => selected.has(c.id));
  const editingGroup = innerEditor?.groupId
    ? (clientData.getGroups(innerEditor.clientId).find((g) => g.id === innerEditor.groupId) ?? null)
    : null;

  function togglePin(c: ClientRecord, e: React.MouseEvent) {
    e.stopPropagation();
    clientsStore.update(c.id, { pinned: !c.pinned });
    setClients(clientsStore.list());
  }

  const pinnedList = filteredEligible.filter((c) => c.pinned);
  const otherList = filteredEligible.filter((c) => !c.pinned);
  const hasAnyActiveGroup = useMemo(() => {
    for (const c of selectedList) {
      if (clientData.getGroups(c.id).some((g) => g.active)) return true;
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedList, clients]);

  // Auto-remove grupos monitorados dos quais a conta saiu no Telegram.
  useEffect(() => {
    if (phase !== "panel") return;
    let cancelled = false;
    (async () => {
      for (const c of selectedList) {
        if (cancelled) return;
        const removed = await pruneMissingGroups(c.id);
        if (removed.length && !cancelled) {
          setClients(clientsStore.list());
          setReloadTick((n) => n + 1);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, selectedList.length]);
  function start() {
    if (!miamiReady || prewarming) return;
    multiMonitor.clearSends();
    const ids = Array.from(selected);
    // Dispara imediatamente para resposta instantânea; a checagem de
    // sessão roda em paralelo e derruba/avisa caso alguma esteja morta.
    multiMonitor.start(ids);
    Promise.all(ids.map(async (id) => ({ id, h: await checkSessionHealth(id) })))
      .then((checks) => {
        const dead = checks.filter((c) => c.h === "dead").map((c) => c.id);
        if (dead.length === 0) return;
        for (const id of dead) clientsStore.update(id, { hasSession: false });
        setClients(clientsStore.list());
        const titles = dead.map((id) => clientsStore.get(id)?.title ?? id).join(", ");
        multiMonitor.stop("manual");
        alert(`Sessão expirada em: ${titles}. Reconecte essas contas antes de iniciar.`);
      })
      .catch(() => {
        /* ignore */
      });
  }

  // ============ SELECT PHASE ============
  if (phase === "select") {
    const renderClient = (c: ClientRecord) => {
      const checked = selected.has(c.id);
      const disabled = !checked && selected.size >= MAX;
      const groupCount = clientData.getGroups(c.id).filter((group) => group.active).length;
      return (
        <div
          key={c.id}
          data-selection-item="multi"
          data-selected={checked}
          className={`sb-multi-client-option flex min-w-0 items-center gap-2 rounded-xl p-3 sm:gap-3 sm:p-4 ${checked ? "bg-white/[.05]" : "bg-background/40"} ${disabled ? "opacity-40" : ""}`}
        >
          <label
            data-client-option-content=""
            className={`grid min-w-0 flex-1 grid-cols-[1rem_2.5rem_minmax(0,1fr)] items-center gap-x-2.5 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(c)}
              aria-label={`Selecionar ${c.title}`}
              className="col-start-1 row-span-2 row-start-1 size-4 self-center accent-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            />
            <span className="col-start-2 row-span-2 row-start-1 self-center">
              <ClientAvatar name={c.title} />
            </span>
            <span
              data-client-title="available"
              className={`col-start-3 row-start-1 block min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] text-sm font-medium leading-5 ${settings.censorClientTitle ? "censor-text" : ""}`}
            >
              {c.title}
            </span>
            <span className="col-start-3 row-start-2 mt-1 block text-[10px] text-muted-foreground">
              {groupCount} {groupCount === 1 ? "grupo ativo" : "grupos ativos"}
              {c.scheduleEnv ? ` · ${c.scheduleEnv}` : ""}
            </span>
          </label>
          <button
            type="button"
            onClick={(event) => togglePin(c, event)}
            className={`sb-pin-toggle grid size-9 shrink-0 place-items-center rounded-lg hover:bg-white/5 ${c.pinned ? "text-foreground" : "text-muted-foreground"}`}
            aria-label={`${c.pinned ? "Desafixar" : "Fixar"} ${c.title}`}
            aria-pressed={Boolean(c.pinned)}
          >
            {c.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
        </div>
      );
    };
    return (
      <main className="sb-page">
        <div className="mx-auto max-w-7xl">
          <PageBanner
            image="/art/cat-multi-select.svg"
            eyebrow="ATENDIMENTO MULTI"
            title="Atendimento multi"
            description={`Escolha de 2 a ${MAX} contas conectadas para o monitoramento simultâneo.`}
            tone="lilac"
            highlights={[
              { label: "Sessões salvas", value: eligible.length },
              { label: "Preparadas", value: preparedClients.length },
              { label: "Selecionadas", value: `${selected.size} / ${MAX}` },
            ]}
            hint="Cada cliente usa os próprios grupos e rascunhos. A seleção não inicia o envio."
          >
            <button
              type="button"
              className="sb-button-secondary"
              onClick={() => navigate({ to: "/dashboard/cadastro" })}
            >
              <Plus className="size-4" aria-hidden />
              Nova cliente
            </button>
            <button
              type="button"
              className="sb-button"
              disabled={!preparedClients.length}
              onClick={() =>
                setSelected(new Set(preparedClients.slice(0, MAX).map((client) => client.id)))
              }
            >
              Selecionar preparadas
            </button>
          </PageBanner>
          <div className="sb-monitor-strip" aria-label="Resumo das contas">
            <div className="flex flex-wrap gap-7">
              <div>
                <span className="block text-[10px] text-muted-foreground">Contas conectadas</span>
                <span className="sb-number mt-1 block">
                  {String(eligible.length).padStart(2, "0")}
                </span>
              </div>
              <div>
                <span className="block text-[10px] text-muted-foreground">Selecionadas</span>
                <span className="sb-number mt-1 block">
                  {String(selected.size).padStart(2, "0")}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">/ {MAX}</span>
                </span>
              </div>
            </div>
            {clients.length > eligible.length && (
              <button
                type="button"
                className="sb-text-action text-xs text-muted-foreground underline underline-offset-4"
                onClick={() => navigate({ to: "/admin/connection" })}
              >
                {clients.length - eligible.length}{" "}
                {clients.length - eligible.length === 1 ? "conta precisa" : "contas precisam"} de
                conexão
              </button>
            )}
          </div>
          <div className="sb-workspace-grid">
            <section
              className="sb-panel @container min-w-0"
              aria-labelledby="select-clients-heading"
            >
              <div className="sb-section-head">
                <h2 id="select-clients-heading" className="text-base font-medium">
                  Contas disponíveis
                </h2>
                <span className="text-xs text-muted-foreground">
                  {filteredEligible.length} {filteredEligible.length === 1 ? "conta" : "contas"}
                </span>
              </div>
              <div className="border-b border-border p-4">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar cliente..."
                    aria-label="Buscar cliente pelo nome"
                    className="h-10 rounded-lg pl-10 text-xs"
                  />
                </div>
              </div>
              <div className="p-4 sm:p-5">
                {!eligible.length ? (
                  <div className="py-10 text-center">
                    <WorkspaceIcon
                      variant="connections"
                      className="mx-auto size-8 text-muted-foreground"
                    />
                    <h3 className="mt-4 text-base">Nenhuma conta conectada</h3>
                    <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">
                      Conecte pelo menos duas clientes para iniciar um atendimento múltiplo.
                    </p>
                    <button
                      type="button"
                      className="sb-button-secondary mt-6"
                      onClick={() =>
                        navigate({
                          to: clients.length ? "/admin/connection" : "/dashboard/cadastro",
                        })
                      }
                    >
                      {clients.length ? "Gerenciar conexões" : "Adicionar cliente"}
                    </button>
                  </div>
                ) : !filteredEligible.length ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    Nenhuma cliente encontrada para “{query}”.
                  </p>
                ) : (
                  <div className="space-y-5">
                    {pinnedList.length > 0 && (
                      <div>
                        <h3 className="mb-3 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                          <Pin className="size-3" aria-hidden />
                          Fixadas
                        </h3>
                        <div className="grid min-w-0 gap-3 @min-[40rem]:grid-cols-2">
                          {pinnedList.map(renderClient)}
                        </div>
                      </div>
                    )}
                    {otherList.length > 0 && (
                      <div>
                        {pinnedList.length > 0 && (
                          <h3 className="mb-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                            Outras clientes
                          </h3>
                        )}
                        <div className="grid min-w-0 gap-3 @min-[40rem]:grid-cols-2">
                          {otherList.map(renderClient)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
            <aside
              className="sb-panel min-w-0 self-start"
              aria-labelledby="selected-clients-heading"
            >
              <div className="sb-section-head">
                <div>
                  <p className="sb-eyebrow">SELEÇÃO ATUAL</p>
                  <h2 id="selected-clients-heading" className="mt-1 text-base font-medium">
                    Clientes no atendimento
                  </h2>
                </div>
                <span className="sb-number">{String(selected.size).padStart(2, "0")}</span>
              </div>
              <div className="p-5">
                <button
                  type="button"
                  className="sb-text-action mb-4 text-xs text-muted-foreground underline underline-offset-4 disabled:opacity-40"
                  disabled={!selected.size}
                  onClick={() => setSelected(new Set())}
                >
                  Limpar seleção
                </button>
                {selectedList.length ? (
                  <ol className="space-y-3">
                    {selectedList.map((c, index) => (
                      <li
                        key={c.id}
                        className="flex min-w-0 items-start gap-3 border-b border-border pb-3"
                      >
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span
                          data-client-title="selected"
                          className={`min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere] text-xs leading-5 ${settings.censorClientTitle ? "censor-text" : ""}`}
                        >
                          {c.title}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
                          onClick={() => toggle(c)}
                          aria-label={`Remover ${c.title} da seleção`}
                        >
                          Remover
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="rounded-xl border border-dashed border-border px-5 py-9 text-center">
                    <WorkspaceIcon
                      variant="multi"
                      className="mx-auto size-6 text-muted-foreground"
                    />
                    <p className="mt-3 text-xs text-muted-foreground">
                      As clientes selecionadas aparecem aqui.
                    </p>
                  </div>
                )}
                <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
                  {selected.size < 2
                    ? `Selecione mais ${2 - selected.size} ${2 - selected.size === 1 ? "cliente" : "clientes"} para continuar.`
                    : "Revise a seleção antes de abrir o monitoramento."}
                </p>
                <Button
                  type="button"
                  disabled={selected.size < 2}
                  className="mt-4 h-11 w-full rounded-lg"
                  onClick={() => {
                    const ids = Array.from(selected);
                    const hash = combinedSelectionId(ids);
                    storeSelection(hash, ids);
                    navigate({
                      to: "/dashboard/multi/$selectionId",
                      params: { selectionId: hash },
                    });
                  }}
                >
                  Abrir monitoramento
                  <ArrowUpRight className="size-4" aria-hidden />
                </Button>
              </div>
            </aside>
          </div>
        </div>
      </main>
    );
  }

  // ============ PANEL PHASE ============
  return (
    <main className="sb-page">
      <div className="mx-auto max-w-7xl">
        <PageBanner
          image="/art/cat-multi.svg"
          compact
          eyebrow="ATENDIMENTO MÚLTIPLO"
          title="Monitoramento"
          description="Confira os grupos e rascunhos das clientes antes de iniciar."
          tone="lilac"
          highlights={[
            { label: "Clientes", value: selectedList.length },
            { label: "Estado", value: running ? "Em execução" : "Parado" },
          ]}
          hint="Acompanhe a confirmação de envio e a apuração da senha nos eventos de cada cliente."
        >
          <button
            type="button"
            className="sb-button-secondary"
            onClick={() => {
              if (running) {
                try {
                  multiMonitor.stop("manual");
                } catch {
                  /* ignore */
                }
              }
              navigate({ to: "/dashboard/multi" });
            }}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Alterar seleção
          </button>
        </PageBanner>
        <section
          className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-3 sm:p-4 min-[1100px]:flex min-[1100px]:items-center min-[1100px]:justify-between"
          aria-label="Controles do monitoramento múltiplo"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 min-[1100px]:justify-start min-[1100px]:gap-5">
            <span className={`sb-live-chip ${running ? "is-live" : ""}`} role="status">
              <span aria-hidden />
              {running ? "Em execução" : "Parado"}
            </span>
            <div>
              <span className="block text-[10px] text-muted-foreground">Clientes</span>
              <span className="sb-number mt-1 block">
                {String(selectedList.length).padStart(2, "0")}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-muted-foreground">Grupos ativos</span>
              <span className="sb-number mt-1 block">
                {selectedList.reduce(
                  (total, c) =>
                    total + clientData.getGroups(c.id).filter((group) => group.active).length,
                  0,
                )}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-muted-foreground">Conexão</span>
              <span role="status" className="mt-1 block text-xs">
                {prewarming ? "Conectando…" : miamiReady ? "Pronta" : "Aguardando"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 [&>div:first-child]:mr-auto min-[1100px]:[&>div:first-child]:mr-0">
            <BrasiliaClock />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPanelOpen(true)}
              className="h-10 rounded-lg gap-2"
              aria-label="Abrir opções de envio"
            >
              <SettingsIcon className="size-4" aria-hidden />
              <span className="hidden xl:inline">Opções de envio</span>
            </Button>
            {running ? (
              <Button
                onClick={() => multiMonitor.stop("manual")}
                className="rounded-xl h-10 w-24 sm:w-28 bg-neutral-800 hover:bg-neutral-700 text-white border border-white/10 shadow-none"
              >
                <Square className="size-3.5 fill-white" strokeWidth={0} /> Parar
              </Button>
            ) : (
              <Button
                onClick={start}
                disabled={!miamiReady || prewarming || !hasAnyActiveGroup}
                className="rounded-xl h-10 w-24 sm:w-28 bg-white hover:bg-neutral-100 text-neutral-900 border border-neutral-200 disabled:opacity-40"
              >
                <Play className="size-3.5 fill-neutral-900" strokeWidth={0} /> Iniciar
              </Button>
            )}
          </div>
        </section>
        <MonitoringWorkspace
          clientCount={selectedList.length}
          eventCount={logs.length}
          clients={
            <>
              {selectedList.map((c) => {
                const groups = clientData.getGroups(c.id).filter((g) => g.active);
                return (
                  <div key={c.id}>
                    <MonitorClientCard
                      title={c.title}
                      censorTitle={settings.censorClientTitle}
                      editing={editingClientId === c.id}
                      disabled={running}
                      onEditingChange={() =>
                        setEditingClientId(editingClientId === c.id ? null : c.id)
                      }
                      clientId={c.id}
                      groups={groups.map((g) => ({ id: g.id, name: g.name }))}
                    >
                      <div className="mb-1 text-xs font-sans text-readable-muted">Grupo</div>
                      <div className="space-y-2">
                        {editingClientId === c.id ? (
                          (() => {
                            const all = clientData.getGroups(c.id);
                            return (
                              <div className="space-y-2">
                                {all.length === 0 ? (
                                  <button
                                    type="button"
                                    disabled={running}
                                    onClick={() => setInnerEditor({ clientId: c.id, addNew: true })}
                                    className="w-full text-left hairline rounded-xl p-3 transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-70"
                                  >
                                    <div className="text-xs text-muted-foreground">
                                      Nenhum grupo cadastrado.{" "}
                                      <span className="text-foreground">
                                        Clique para adicionar.
                                      </span>
                                    </div>
                                  </button>
                                ) : (
                                  all.map((g) => (
                                    <GroupSummaryCard
                                      key={g.id}
                                      group={g}
                                      showIcon={settings.showGroupIcons}
                                      censorPhoto={settings.censorGroupPhoto}
                                      censorName={settings.censorGroupName}
                                      censorDraft={settings.censorDraft}
                                      editing
                                      disabled={running}
                                      onToggle={() => {
                                        clientData.upsertGroup(c.id, { ...g, active: !g.active });
                                        setReloadTick((n) => n + 1);
                                      }}
                                      onEdit={() =>
                                        setInnerEditor({ clientId: c.id, groupId: g.id })
                                      }
                                      onRemove={() => {
                                        const next = clientData
                                          .getGroups(c.id)
                                          .filter((x) => x.id !== g.id);
                                        clientData.setGroups(c.id, next);
                                        setReloadTick((n) => n + 1);
                                      }}
                                    />
                                  ))
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={running}
                                  onClick={() => setInnerEditor({ clientId: c.id, addNew: true })}
                                  className="site-control-glass rounded-lg h-9 w-full"
                                >
                                  + Adicionar grupo
                                </Button>
                              </div>
                            );
                          })()
                        ) : (
                          <>
                            {groups.length === 0 && (
                              <button
                                type="button"
                                disabled={running}
                                onClick={() => setEditingClientId(c.id)}
                                className="w-full text-left hairline rounded-xl p-3 transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                <div className="text-xs text-muted-foreground">
                                  Nenhum grupo ativo.{" "}
                                  <span className="text-foreground">
                                    Clique para escolher um grupo e definir o rascunho.
                                  </span>
                                </div>
                              </button>
                            )}
                            {groups.map((g: MonitoredGroup) => {
                              return (
                                <GroupSummaryCard
                                  key={g.id}
                                  group={g}
                                  showIcon={settings.showGroupIcons}
                                  censorPhoto={settings.censorGroupPhoto}
                                  censorName={settings.censorGroupName}
                                  censorDraft={settings.censorDraft}
                                />
                              );
                            })}
                          </>
                        )}
                      </div>
                      <div className="mt-4 pt-4 hairline-t">
                        <div className="text-xs font-sans text-readable-muted mb-1.5 inline-flex items-center gap-1.5">
                          Método
                          <HelpHint side="top" iconClassName="size-3">
                            <MethodHelp />
                          </HelpHint>
                        </div>
                        <Select
                          value={c.method ?? "abertura"}
                          onValueChange={(v) => {
                            clientsStore.update(c.id, {
                              method: v as "abertura" | "mensagem" | "abertura2",
                            });
                            setClients(clientsStore.list());
                          }}
                          disabled={running}
                        >
                          <SelectTrigger className="site-control-glass h-9 rounded-lg border-border shadow-none">
                            {c.method === "mensagem"
                              ? "Grupo aberto"
                              : c.method === "abertura2"
                                ? "Grupo aberto 2"
                                : "Grupo fechado"}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="abertura">Grupo fechado</SelectItem>
                            <SelectItem value="mensagem">Grupo aberto</SelectItem>
                            <SelectItem value="abertura2">Grupo aberto 2</SelectItem>
                          </SelectContent>
                        </Select>
                        {c.method === "abertura2" && (
                          <ScheduleTimeCard
                            clientId={c.id}
                            value={c.scheduleEnv}
                            running={running}
                            onSaved={() => setClients(clientsStore.list())}
                          />
                        )}
                      </div>
                    </MonitorClientCard>
                  </div>
                );
              })}
            </>
          }
          events={
            <MonitorLog
              entries={logs}
              showTime
              isMonitoring={running}
              onClear={() => multiMonitor.clearLogs()}
            />
          }
        />
      </div>
      <MonitorSettingsPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        settings={settings}
        onChange={updateSettings}
      />
      <AddGroupModal
        key={innerEditor?.clientId ?? "no-client"}
        open={!!innerEditor?.addNew}
        onOpenChange={(v) => {
          if (!v) setInnerEditor(null);
        }}
        clientId={innerEditor?.clientId}
        onSaved={() => {
          setInnerEditor(null);
          setReloadTick((n) => n + 1);
          setClients(clientsStore.list());
        }}
      />
      <EditGroupModal
        group={editingGroup}
        clientId={innerEditor?.clientId}
        onOpenChange={(v) => {
          if (!v) setInnerEditor(null);
        }}
        onSaved={() => {
          setInnerEditor(null);
          setReloadTick((n) => n + 1);
          setClients(clientsStore.list());
        }}
      />
    </main>
  );
}
