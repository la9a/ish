import { AdminLayout } from "./admin";
import { createFileRoute, Outlet, useNavigate, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  storage,
  activeClient,
  clientsStore,
  monitorSettings,
  type MonitoredGroup,
  type TgMe,
  type ClientRecord,
  type MonitorSettings,
} from "@/lib/storage";
import {
  isAuthorized,
  disconnectActive,
  monitor,
  warmDialogsCache,
  loadGroupPhotoById,
  checkSessionHealth,
  pruneMissingGroups,
  syncClientGroupsMeta,
  type LogEntry,
  type SendInfo,
} from "@/lib/telegram";
import { appAuth } from "@/lib/appAuth";
import { AddGroupModal } from "@/components/AddGroupModal";
import { EditGroupModal } from "@/components/EditGroupModal";
import { MonitorLog } from "@/components/MonitorLog";
import {
  Pause,
  Play,
  Square,
  AlertTriangle,
  ArrowLeft,
  Settings as SettingsIcon,
  Activity,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpHint } from "@/components/HelpHint";
import { MethodHelp } from "@/components/MethodHelp";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Reveal } from "@/components/motion/Reveal";
import { playSound } from "@/lib/beep";
import { Logo } from "@/components/Logo";
import { BrasiliaClock } from "@/components/BrasiliaClock";
import { MonitorSettingsPanel } from "@/components/MonitorSettingsPanel";
import { GroupSummaryCard } from "@/components/GroupSummaryCard";
import { MonitorClientCard } from "@/components/MonitorClientCard";
import { ScheduleTimeCard } from "@/components/ScheduleTimeCard";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  beforeLoad: async () => {
    // A marca local não vale como prova de sessão: sempre confere no servidor.
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
  },
  head: () => ({
    meta: [
      { title: "Senha Baixa | Monitoramento" },
      { name: "description", content: "Área de monitoramento do Senha Baixa." },
      { property: "og:title", content: "Senha Baixa | Monitoramento" },
      { property: "og:description", content: "Área de monitoramento do Senha Baixa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Senha Baixa | Monitoramento" },
      { name: "twitter:description", content: "Área de monitoramento do Senha Baixa." },
    ],
  }),
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <div className="relative min-h-dvh w-full">
      <Outlet />
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const [me, setMe] = useState<TgMe | null>(null);
  const [client, setClient] = useState<ClientRecord | null>(null);
  const [groups, setGroups] = useState<MonitoredGroup[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [, setSends] = useState<SendInfo[]>([]);
  const [running, setRunning] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MonitoredGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [removing, setRemoving] = useState<MonitoredGroup | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [keepSession, setKeepSession] = useState(true);
  const [settings, setSettings] = useState<MonitorSettings>(() => monitorSettings.get());
  const [panelOpen, setPanelOpen] = useState(false);
  const wasRunningRef = useRef(false);
  const methodReloadRef = useRef<number | null>(null);
  const [editingGroups, setEditingGroups] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [miamiReady, setMiamiReady] = useState(false);
  const [miamiConnecting, setMiamiConnecting] = useState(false);

  function updateSettings(p: Partial<MonitorSettings>) {
    const next = { ...settings, ...p };
    setSettings(next);
    monitorSettings.set(next);
  }

  // Som curto via WebAudio — sem assets externos.
  function beep(kind: "start" | "stop") {
    if (kind === "start" && !settings.soundStart) return;
    if (kind === "stop" && !settings.soundStop) return;
    playSound(kind === "start" ? settings.soundStartName : settings.soundStopName);
  }

  useEffect(() => {
    (async () => {
      if (!appAuth.current()) {
        navigate({ to: "/login", replace: true });
        return;
      }
      const cid = activeClient.get();
      if (!cid) {
        navigate({ to: "/dashboard/unico", replace: true });
        return;
      }
      const rec = clientsStore.get(cid);
      if (!rec) {
        activeClient.set(null);
        navigate({ to: "/dashboard/unico", replace: true });
        return;
      }
      setClient(rec);
      const loadedMe = storage.getMe();
      setMe(loadedMe);
      // Mantém o avatar do cliente sincronizado com a foto do Telegram.
      if (loadedMe) {
        const rec = clientsStore.get(cid);
        if (rec && (rec.photoUrl ?? null) !== (loadedMe.photoUrl ?? null)) {
          clientsStore.update(cid, { photoUrl: loadedMe.photoUrl ?? null });
        }
      }
      setGroups(storage.getGroups());
      setReady(true);
      // Sessão revogada → manda re-autenticar. Roda em background para não
      // travar a entrada no painel; erro transitório mantém a tela aberta.
      isAuthorized()
        .then((ok) => {
          if (!ok) {
            navigate({
              to: "/dashboard/unico/$clientId",
              params: { clientId: cid },
              replace: true,
            });
          }
        })
        .catch(() => {
          /* mantém no dashboard com os dados locais */
        });
      // Aquece cache de chats e completa fotos faltantes em background.
      (async () => {
        await warmDialogsCache();
        // Remove automaticamente grupos monitorados dos quais a conta
        // não faz mais parte no Telegram.
        try {
          const removed = await pruneMissingGroups(cid);
          if (removed.length) setGroups(storage.getGroups());
        } catch {
          /* ignore */
        }
        const saved = storage.getGroups();
        let changed = false;
        for (const g of saved) {
          if (g.photoUrl) continue;
          const url = await loadGroupPhotoById(g.id, cid);
          if (url) {
            storage.upsertGroup({ ...g, photoUrl: url });
            changed = true;
          }
        }
        if (changed) setGroups(storage.getGroups());
      })();
    })();
  }, [navigate]);

  useEffect(() => {
    const unsub = monitor.subscribe((entries, isRun, st, snd) => {
      setLogs(entries);
      setRunning(isRun);
      setStatuses(st);
      setSends(snd);
    });
    const onCloud = () => setGroups(storage.getGroups());
    window.addEventListener("cloud:changed", onCloud);
    return () => {
      unsub();
      window.removeEventListener("cloud:changed", onCloud);
    };
  }, []);

  // Prewarm automático ao entrar no painel: conecta o cliente, resolve grupos
  // e emite "User; Conectado" + "Grupo; Nome" antes do Iniciar.
  useEffect(() => {
    if (!ready || running) return;
    monitor.resetPrewarm();
    monitor.clearLogs();
    setMiamiReady(false);
    setMiamiConnecting(true);
    let cancelled = false;
    (async () => {
      const cid = client?.id;
      const connection = monitor.prewarm();
      if (cid) void syncClientGroupsMeta(cid).catch(() => {});
      try {
        const connected = await connection;
        if (!cancelled) setMiamiReady(connected);
      } catch {
        if (!cancelled) setMiamiReady(false);
      } finally {
        if (!cancelled) setMiamiConnecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, client?.id]);

  // Beep ao iniciar/parar o monitoramento.
  useEffect(() => {
    if (running && !wasRunningRef.current) beep("start");
    if (!running && wasRunningRef.current) {
      beep("stop");
    }
    wasRunningRef.current = running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // Parada automática: quando todos os grupos ativos enviaram com sucesso.
  useEffect(() => {
    if (!running || !settings.autoStop) return;
    const activeCount = groups.filter((g) => g.active).length;
    if (activeCount === 0) return;
    const opened = Object.values(statuses).filter((s) => s === "open").length;
    if (opened >= activeCount) {
      monitor.stop("auto");
    }
  }, [statuses, running, settings.autoStop, groups]);

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

  function reloadGroups() {
    setGroups(storage.getGroups());
    if (!monitor.isRunning()) {
      monitor.resetPrewarm();
      monitor.clearLogs();
      setMiamiReady(false);
      setMiamiConnecting(true);
      monitor
        .prewarm()
        .then(setMiamiReady)
        .catch(() => setMiamiReady(false))
        .finally(() => setMiamiConnecting(false));
    }
  }

  function toggleActive(g: MonitoredGroup) {
    storage.upsertGroup({ ...g, active: !g.active });
    reloadGroups();
  }

  function remove(g: MonitoredGroup) {
    setRemoving(g);
  }

  function confirmRemove() {
    if (!removing) return;
    storage.removeGroup(removing.id);
    setRemoving(null);
    reloadGroups();
  }

  function doLogout() {
    setKeepSession(true);
    setConfirmLogout(true);
  }

  async function performLogout() {
    setConfirmLogout(false);
    monitor.stop();
    const cid = activeClient.get();
    await disconnectActive({ keepSession });
    if (cid) {
      clientsStore.update(cid, { hasSession: keepSession });
    }
    activeClient.set(null);
    navigate({ to: "/dashboard/unico", replace: true });
  }

  if (!ready) {
    return <main className="min-h-dvh" />;
  }

  return (
    <AdminLayout
      content={
        <main className="sb-page">
          <div className="relative z-10 mx-auto max-w-6xl">
            <div className="sb-page-header">
              <div>
                <p className="sb-eyebrow">UMA CLIENTE, TODA A SUA ATENÇÃO</p>
                <h1 className="mt-2">
                  Atendimento<span className="text-muted-foreground">.</span>
                </h1>
                <p className="mt-3 text-sm text-muted-foreground">
                  Prepare o rascunho e acompanhe os envios de {client?.title ?? "sua cliente"}.
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

            {/* Top bar */}
            <Reveal className="mb-8 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate({ to: "/dashboard/unico" })}
                  className="site-control-glass gap-1.5 h-9 rounded-xl"
                >
                  <ArrowLeft className="size-4" /> Voltar
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <BrasiliaClock />
                <Button
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
                    onClick={() => monitor.stop("manual")}
                    className="rounded-xl h-10 w-28 bg-neutral-800 hover:bg-neutral-700 text-white border border-white/10 shadow-none"
                  >
                    <Square className="size-3.5 fill-white" strokeWidth={0} /> Parar
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      // Inicia imediatamente para resposta instantânea; a checagem
                      // de sessão roda em paralelo e derruba caso esteja morta.
                      monitor.start();
                      const cid = activeClient.get();
                      if (cid) {
                        checkSessionHealth(cid)
                          .then((h) => {
                            if (h === "dead") {
                              monitor.stop("manual");
                              clientsStore.update(cid, { hasSession: false });
                              setClient(clientsStore.get(cid) ?? null);
                              alert(
                                "Sessão Telegram expirada. Volte e clique em 'Reconectar' nessa conta.",
                              );
                              navigate({
                                to: "/dashboard/unico/$clientId",
                                params: { clientId: cid },
                              });
                            }
                          })
                          .catch(() => {
                            /* ignore */
                          });
                      }
                    }}
                    disabled={
                      !miamiReady || miamiConnecting || groups.filter((g) => g.active).length === 0
                    }
                    className="rounded-xl h-10 w-28 bg-white hover:bg-neutral-100 text-neutral-900 border border-neutral-200 disabled:opacity-40"
                  >
                    <Play className="size-3.5 fill-neutral-900" strokeWidth={0} /> Iniciar
                  </Button>
                )}
              </div>
            </Reveal>

            <Reveal delay={0.05} className="space-y-4 mb-6">
              <MonitorClientCard
                title={client?.title ?? "Cliente"}
                censorTitle={settings.censorClientTitle}
                editing={editingGroups}
                disabled={running}
                onEditingChange={() => setEditingGroups((v) => !v)}
                clientId={client?.id}
                groups={groups.filter((g) => g.active).map((g) => ({ id: g.id, name: g.name }))}
              >
                {/* Grupos */}
                <div className="mb-1 text-xs font-sans text-readable-muted">
                  {groups.length > 1 ? "Grupos" : "Grupo"}
                </div>
                <div className="space-y-2">
                  {groups.length === 0 ? (
                    <button
                      type="button"
                      disabled={running}
                      onClick={() => setModalOpen(true)}
                      className="w-full text-left hairline rounded-xl p-3 transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <div className="text-xs text-muted-foreground">
                        Nenhum grupo ainda.{" "}
                        <span className="text-foreground">Clique para adicionar.</span>
                      </div>
                    </button>
                  ) : editingGroups ? (
                    <>
                      {groups.map((g) => (
                        <GroupSummaryCard
                          key={g.id}
                          group={g}
                          showIcon={settings.showGroupIcons}
                          censorPhoto={settings.censorGroupPhoto}
                          censorName={settings.censorGroupName}
                          censorDraft={settings.censorDraft}
                          editing
                          disabled={running}
                          onToggle={() => toggleActive(g)}
                          onEdit={() => setEditing(g)}
                          onRemove={() => remove(g)}
                        />
                      ))}
                      <Button
                        variant="outline"
                        onClick={() => setModalOpen(true)}
                        disabled={running}
                        className="site-control-glass rounded-xl h-9 w-full"
                      >
                        + Adicionar grupo
                      </Button>
                    </>
                  ) : groups.filter((g) => g.active).length === 0 ? (
                    <button
                      type="button"
                      disabled={running}
                      onClick={() => setEditingGroups(true)}
                      className="w-full text-left hairline rounded-xl p-3 transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <div className="text-xs text-muted-foreground">
                        Nenhum grupo ativo.{" "}
                        <span className="text-foreground">Clique em editar para ativar.</span>
                      </div>
                    </button>
                  ) : (
                    groups
                      .filter((g) => g.active)
                      .map((g) => {
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
                      })
                  )}
                </div>

                {/* Método */}
                <div className="mt-4 pt-4 hairline-t">
                  <div className="text-xs font-sans text-readable-muted mb-1.5 inline-flex items-center gap-1.5">
                    Método
                    <HelpHint side="top" iconClassName="size-3">
                      <MethodHelp />
                    </HelpHint>
                  </div>
                  <Select
                    value={client?.method ?? "abertura"}
                    onValueChange={(v) => {
                      if (!client) return;
                      if (methodReloadRef.current) window.clearTimeout(methodReloadRef.current);
                      setVerifying(true);
                      clientsStore.update(client.id, {
                        method: v as "abertura" | "mensagem" | "abertura2",
                      });
                      setClient(clientsStore.get(client.id) ?? null);
                      methodReloadRef.current = window.setTimeout(() => setVerifying(false), 900);
                    }}
                    disabled={running}
                  >
                    <SelectTrigger className="site-control-glass h-9 rounded-lg border-border shadow-none">
                      {client?.method === "mensagem"
                        ? "Grupo aberto"
                        : client?.method === "abertura2"
                          ? "Grupo aberto 2"
                          : "Grupo fechado"}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="abertura">Grupo fechado</SelectItem>
                      <SelectItem value="mensagem">Grupo aberto</SelectItem>
                      <SelectItem value="abertura2">Grupo aberto 2</SelectItem>
                    </SelectContent>
                  </Select>
                  {client?.method === "abertura2" && (
                    <ScheduleTimeCard
                      clientId={client.id}
                      value={client.scheduleEnv}
                      running={running}
                      onSaved={() => setClient(clientsStore.get(client.id) ?? null)}
                    />
                  )}
                </div>
              </MonitorClientCard>
            </Reveal>

            {/* Eventos */}
            <Reveal delay={0.1} className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-sans font-medium text-readable-muted inline-flex items-center gap-1.5">
                  <Activity className="size-5 text-primary" strokeWidth={1.5} aria-hidden /> Eventos
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 py-0 text-[11px] font-sans text-readable-muted hover:bg-transparent hover:text-foreground"
                  onClick={() => monitor.clearLogs()}
                >
                  Limpar
                </Button>
              </div>
              <MonitorLog entries={logs} showTime={false} isMonitoring={running} />
            </Reveal>
          </div>

          <AddGroupModal open={modalOpen} onOpenChange={setModalOpen} onSaved={reloadGroups} />
          <EditGroupModal
            group={editing}
            onOpenChange={(v) => {
              if (!v) setEditing(null);
            }}
            onSaved={reloadGroups}
          />

          <AlertDialog
            open={!!removing}
            onOpenChange={(v) => {
              if (!v) setRemoving(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover grupo</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza que deseja remover '{removing?.name}'? Esta ação não pode ser
                  desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={confirmRemove}>Remover</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sair do cliente</AlertDialogTitle>
                <AlertDialogDescription>
                  Você pode manter a sessão salva neste dispositivo para voltar sem precisar de
                  código novamente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <label className="flex items-start gap-2 px-1 py-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepSession}
                  onChange={(e) => setKeepSession(e.target.checked)}
                  className="mt-0.5 size-4 rounded border-input"
                />
                <span>
                  <strong>Manter conectado neste dispositivo</strong>
                  <span className="block text-xs text-muted-foreground">
                    Se desmarcar, a sessão será apagada e você precisará reautenticar com o código
                    do Telegram.
                  </span>
                </span>
              </label>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={performLogout}>Sair</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <MonitorSettingsPanel
            open={panelOpen}
            onOpenChange={setPanelOpen}
            settings={settings}
            onChange={updateSettings}
          />
        </main>
      }
    />
  );
}
