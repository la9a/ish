import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Pencil, PlugZap, Power, Trash2, RefreshCw, Plug } from "lucide-react";
import { clientsStore, type ClientRecord } from "@/lib/storage";
import { checkAllSessions } from "@/lib/telegram";
import { formatDisplayPhone } from "@/lib/countries";
import { Button } from "@/components/ui/button";
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
import { Reveal } from "@/components/motion/Reveal";

import { ClientAvatar } from "@/components/ClientAvatar";

export const Route = createFileRoute("/admin/connection")({
  head: () => ({
    meta: [
      { title: "Conexões | Senha Baixa" },
      { name: "description", content: "Gerencie as contas conectadas ao painel Senha Baixa." },
      { property: "og:title", content: "Conexões | Senha Baixa" },
      { property: "og:description", content: "Gerencie as contas conectadas ao painel Senha Baixa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Conexões | Senha Baixa" },
      { name: "twitter:description", content: "Gerencie as contas conectadas ao painel Senha Baixa." },
    ],
  }),
  component: ConnectionPage,
});

function ConnectionPage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [checking, setChecking] = useState(false);
  const [removing, setRemoving] = useState<ClientRecord | null>(null);
  const [disconnecting, setDisconnecting] = useState<ClientRecord | null>(null);

  function reload() {
    setClients(clientsStore.list());
  }

  useEffect(() => {
    reload();
    const onCloud = () => reload();
    window.addEventListener("cloud:changed", onCloud);
    let cancelled = false;
    setChecking(true);
    checkAllSessions()
      .then(() => { if (!cancelled) reload(); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => {
      cancelled = true;
      window.removeEventListener("cloud:changed", onCloud);
    };
  }, []);

  function edit(c: ClientRecord) {
    navigate({ to: "/dashboard/cadastro", search: { id: c.id, edit: "1" } as any });
  }
  function reconnect(c: ClientRecord) {
    navigate({ to: "/dashboard/cadastro", search: { id: c.id } as any });
  }
  function confirmDisconnect() {
    if (!disconnecting) return;
    clientsStore.update(disconnecting.id, { hasSession: false });
    setDisconnecting(null);
    reload();
  }
  function confirmRemove() {
    if (!removing) return;
    clientsStore.wipeClientData(removing.id);
    clientsStore.remove(removing.id);
    setRemoving(null);
    reload();
  }

  const connected = clients.filter((c) => c.hasSession);
  const disconnected = clients.filter((c) => !c.hasSession);

  return (
    <main className="px-6 py-8 md:px-10 md:py-10">
      <div className="mx-auto max-w-4xl space-y-10">
        <Reveal>
          <h1 className="font-serif font-bold text-3xl md:text-4xl tracking-tight inline-flex items-center gap-3 leading-none">
            <Plug className="size-10 text-primary shrink-0" strokeWidth={1.5} aria-hidden />
            <span className="leading-none">Conexões</span>
            {checking && (
              <span className="ml-3 inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
                <RefreshCw className="size-3 animate-spin" /> verificando…
              </span>
            )}
          </h1>
        </Reveal>

        <Section
          title="Conectados"
          count={connected.length}
          empty="Nenhum cliente conectado."
          items={connected}
          renderActions={(c) => (
            <>
              <Button variant="outline" size="sm" onClick={() => edit(c)} className="gap-1.5 rounded-lg h-8">
                <Pencil className="size-3.5" /> Editar
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDisconnecting(c)} className="gap-1.5 rounded-lg h-8">
                <Power className="size-3.5" /> Desconectar
              </Button>
            </>
          )}
        />

        <Section
          title="Desconectados"
          count={disconnected.length}
          empty="Nenhum cliente desconectado."
          items={disconnected}
          renderActions={(c) => (
            <>
              <Button size="sm" onClick={() => reconnect(c)} className="gap-1.5 rounded-lg h-8">
                <PlugZap className="size-3.5" /> Reconectar
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRemoving(c)} className="gap-1.5 rounded-lg h-8 !text-danger hover:!text-danger">
                <Trash2 className="size-3.5" /> Remover
              </Button>
            </>
          )}
        />
      </div>

      <AlertDialog open={!!removing} onOpenChange={(v) => { if (!v) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Remover "{removing?.title}"? Isso apaga a sessão, credenciais e grupos salvos deste cliente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!disconnecting} onOpenChange={(v) => { if (!v) setDisconnecting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Desconectar "{disconnecting?.title}"? A sessão do Telegram será encerrada e será preciso reconectar depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisconnect}>Desconectar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function Section({
  title,
  count,
  empty,
  items,
  renderActions,
}: {
  title: string;
  count: number;
  empty: string;
  items: ClientRecord[];
  renderActions: (c: ClientRecord) => React.ReactNode;
}) {
  const fmtWhen = (ts?: number | null) => {
    if (!ts) return null;
    try {
      const d = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(new Date(ts));
      const g = (t: string) => d.find((p) => p.type === t)?.value ?? "";
      return `${g("day")}/${g("month")}/${g("year")} às ${g("hour")}:${g("minute")}`;
    } catch { return null; }
  };
  return (
    <section>
      <h2 className="mono-caption mb-3">
        <span className="text-sm font-normal normal-case tracking-normal text-muted-foreground">{title} · {count}</span>
      </h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground text-center">{empty}</p>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center gap-3 transition-colors hover:bg-muted/40">
              <ClientAvatar name={c.title} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium tracking-tight truncate leading-tight">{c.title}</div>
                {c.hasSession && fmtWhen(c.connectedAt ?? c.createdAt) && (
                  <div className="text-xs text-readable-muted mt-0.5 truncate">
                    Conectado em {fmtWhen(c.connectedAt ?? c.createdAt)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                {renderActions(c)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}