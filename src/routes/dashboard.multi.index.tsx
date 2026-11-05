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
  Pause,
  Square,
  Settings as SettingsIcon,
  Check,
  Activity,
  Search,
  ArrowUpRight,
  Pin,
  PinOff,
  UserPlus,
  Plus,
  Users,
} from "lucide-react";
import { MonitorLog } from "@/components/MonitorLog";
import { AddGroupModal } from "@/components/AddGroupModal";
import { EditGroupModal } from "@/components/EditGroupModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpHint } from "@/components/HelpHint";
import { MethodHelp } from "@/components/MethodHelp";

import { Reveal } from "@/components/motion/Reveal";
import { playSound } from "@/lib/beep";
import { ClientAvatar } from "@/components/ClientAvatar";
import { BrasiliaClock } from "@/components/BrasiliaClock";
import { MonitorSettingsPanel } from "@/components/MonitorSettingsPanel";
import { GroupSummaryCard } from "@/components/GroupSummaryCard";
import { MonitorClientCard } from "@/components/MonitorClientCard";
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
    return (
      <main className="sb-page">
        <div className="mx-auto max-w-6xl">
          <div className="sb-page-header">
            <div>
              <p className="sb-eyebrow">MAIS CLIENTES, UM SÓ LUGAR</p>
              <h1 className="mt-2">
                Atendimento múltiplo<span className="text-muted-foreground">.</span>
              </h1>
              <p className="mt-3 max-w-xl text-sm text-muted-foreground">
                Selecione de 2 a {MAX} contas conectadas para preparar e acompanhar seus
                atendimentos.
              </p>
            </div>
            <button
              type="button"
              className="sb-button-secondary"
              onClick={() => navigate({ to: "/dashboard/cadastro" })}
            >
              <Plus className="size-4" aria-hidden />
              Nova cliente
            </button>
          </div>

          {eligible.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-border bg-card p-16 text-center relative overflow-hidden">
              <div className="relative">
                <div className="mx-auto mb-6 inline-flex size-14 items-center justify-center rounded-2xl bg-foreground text-background">
                  <UserPlus className="size-6" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  {clients.length === 0
                    ? "Seu atendimento múltiplo começa aqui"
                    : "Conecte suas clientes para continuar"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {clients.length === 0
                    ? "Adicione e conecte pelo menos duas clientes para operar ao mesmo tempo."
                    : "Reconecte as contas das suas clientes antes de iniciar o atendimento múltiplo."}
                </p>
                <div className="mt-8">
                  <Button
                    onClick={() => navigate({ to: "/dashboard/cadastro" })}
                    className="btn-sweep h-11 rounded-xl px-5"
                  >
                    <Plus className="size-4" /> Adicionar cliente
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <Reveal delay={0.06} className="relative mb-5 mt-6">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar cliente..."
                  aria-label="Buscar cliente pelo nome"
                  className="pl-10 h-10 rounded-xl text-xs"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground">
                  {filteredEligible.length} / {eligible.length}
                </span>
              </Reveal>

              {(() => {
                const renderCard = (c: ClientRecord) => {
                  const checked = selected.has(c.id);
                  const disabled = !checked && selected.size >= MAX;
                  return (
                    <div
                      key={c.id}
                      className={`group flex items-center justify-between gap-3 overflow-hidden rounded-xl border bg-card p-4 shadow-none transition-colors focus-within:ring-2 focus-within:ring-ring ${
                        checked ? "border-primary" : "border-border hover:border-primary/40"
                      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <label
                        className={`flex min-w-0 flex-1 items-center gap-3 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(c)}
                          aria-label={`Selecionar ${c.title}`}
                          className="size-4 shrink-0 accent-white"
                        />
                        <ClientAvatar name={c.title} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium tracking-tight truncate flex items-center gap-1.5">
                            {c.title}
                            <ArrowUpRight
                              className="size-3 text-muted-foreground/50 group-hover:text-primary transition-colors"
                              strokeWidth={1.5}
                            />
                          </div>
                        </div>
                      </label>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => togglePin(c, e)}
                          className={`rounded-lg p-1.5 transition-colors ${c.pinned ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                          aria-label={c.pinned ? "Desafixar" : "Fixar"}
                          title={c.pinned ? "Desafixar" : "Fixar"}
                        >
                          {c.pinned ? (
                            <PinOff className="size-3.5" />
                          ) : (
                            <Pin className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                };
                return (
                  <>
                    {pinnedList.length > 0 && (
                      <div className="mb-8">
                        <h2 className="mb-3 mono-caption inline-flex items-center gap-1.5">
                          <Pin className="size-3 fill-current text-foreground" /> Fixados ·{" "}
                          {pinnedList.length}
                        </h2>
                        <div className="grid gap-4 items-start sm:grid-cols-2 lg:grid-cols-3">
                          {pinnedList.map((c) => (
                            <div key={c.id}>{renderCard(c)}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    {otherList.length > 0 && (
                      <div>
                        {pinnedList.length > 0 && (
                          <h2 className="mb-3 mono-caption">Outros · {otherList.length}</h2>
                        )}
                        <div className="grid gap-4 items-start sm:grid-cols-2 lg:grid-cols-3">
                          {otherList.map((c) => (
                            <div key={c.id}>{renderCard(c)}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}

          {eligible.length > 0 && filteredEligible.length === 0 && (
            <p className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
              Nenhuma cliente encontrada. Tente buscar por outro nome.
            </p>
          )}
          <div className="mt-8 flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 sticky bottom-4">
            <div className="text-xs font-sans text-readable-muted">
              {selected.size}/{MAX} selecionado{selected.size === 1 ? "" : "s"}
            </div>
            {selected.size >= 2 && (
              <Button
                onClick={() => {
                  const ids = Array.from(selected);
                  const hash = combinedSelectionId(ids);
                  storeSelection(hash, ids);
                  navigate({ to: "/dashboard/multi/$selectionId", params: { selectionId: hash } });
                }}
                className="btn-sweep rounded-xl h-10 px-5 text-sm"
              >
                Continuar
              </Button>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ============ PANEL PHASE ============
  return (
    <main className="sb-page">
      <div className="mx-auto max-w-6xl">
        <div className="sb-page-header">
          <div>
            <p className="sb-eyebrow">SEUS ATENDIMENTOS, LADO A LADO</p>
            <h1 className="mt-2">
              Atendimento múltiplo<span className="text-muted-foreground">.</span>
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {selectedList.length} contas selecionadas. Cada cliente com seu grupo e seu rascunho.
            </p>
          </div>
          <span
            role="status"
            className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-[11px] text-muted-foreground"
          >
            <span
              className={`size-1.5 rounded-full ${running ? "bg-success" : "bg-muted-foreground"}`}
              aria-hidden
            />
            {running ? "Monitoramento em andamento" : "Monitoramento pausado"}
          </span>
        </div>
        <Reveal className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (running) {
                try {
                  multiMonitor.stop("manual");
                } catch {
                  /* ignore */
                }
              }
              navigate({ to: "/dashboard" });
            }}
            className="site-control-glass gap-1.5 h-9 rounded-xl"
          >
            <ArrowLeft className="size-4" /> Voltar
          </Button>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <BrasiliaClock />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPanelOpen(true)}
              className="site-control-glass gap-1.5 h-9 rounded-xl shadow-none"
              aria-label="Abrir opções de envio"
            >
              <SettingsIcon className="size-4" />
              <span className="hidden sm:inline">Opções de envio</span>
            </Button>
            {running ? (
              <Button
                onClick={() => multiMonitor.stop("manual")}
                className="rounded-xl h-10 w-28 bg-neutral-800 hover:bg-neutral-700 text-white border border-white/10 shadow-none"
              >
                <Square className="size-3.5 fill-white" strokeWidth={0} /> Parar
              </Button>
            ) : (
              <Button
                onClick={start}
                disabled={!miamiReady || prewarming || !hasAnyActiveGroup}
                className="rounded-xl h-10 w-28 bg-white hover:bg-neutral-100 text-neutral-900 border border-neutral-200 disabled:opacity-40"
              >
                <Play className="size-3.5 fill-neutral-900" strokeWidth={0} /> Iniciar
              </Button>
            )}
          </div>
        </Reveal>

        <Reveal delay={0.05} className="space-y-4">
          <div className="space-y-4">
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
                                    <span className="text-foreground">Clique para adicionar.</span>
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
                                    onEdit={() => setInnerEditor({ clientId: c.id, groupId: g.id })}
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
          </div>
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-sans font-medium text-readable-muted inline-flex items-center gap-1.5">
              <Activity className="size-5 text-primary" strokeWidth={1.5} aria-hidden /> Eventos
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-0 py-0 text-[11px] font-sans text-readable-muted hover:bg-transparent hover:text-foreground"
              onClick={() => multiMonitor.clearLogs()}
            >
              Limpar
            </Button>
          </div>
          <MonitorLog entries={logs} showTime={false} isMonitoring={running} />
        </Reveal>
      </div>
      <MonitorSettingsPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        settings={settings}
        onChange={updateSettings}
      />
      <AddGroupModal
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
