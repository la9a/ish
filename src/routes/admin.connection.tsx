import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleHelp,
  Pencil,
  PlugZap,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { clientsStore, type ClientRecord } from "@/lib/storage";
import { appAuth } from "@/lib/appAuth";
import { checkAllSessions } from "@/lib/telegram";
import { miamiActiveAccounts } from "@/lib/miamiAgent.functions";
import { formatDisplayPhone } from "@/lib/countries";
import { Button } from "@/components/ui/button";
import { PageBanner } from "@/components/PageBanner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export const Route = createFileRoute("/admin/connection")({
  head: () => ({
    meta: [
      { title: "Conexões | Senha Baixa" },
      {
        name: "description",
        content: "Consulte as conexões e reconecte as contas das suas clientes.",
      },
    ],
  }),
  component: ConnectionPage,
});

type StatusFilter = "all" | "saved" | "reconnect";

function formatWhen(ts?: number | null) {
  if (!ts) return null;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return null;
  }
}

function ConnectionPage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [checking, setChecking] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [verifiedIds, setVerifiedIds] = useState<Set<string> | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checkError, setCheckError] = useState("");
  const [removing, setRemoving] = useState<ClientRecord | null>(null);
  const [disconnecting, setDisconnecting] = useState<ClientRecord | null>(null);
  const mounted = useRef(false);
  const checkingRef = useRef(false);

  function reload() {
    setClients(clientsStore.list());
  }

  async function checkConnections() {
    if (checkingRef.current) return;
    const userId = appAuth.currentUserId();
    checkingRef.current = true;
    setChecking(true);
    setCheckError("");
    try {
      await checkAllSessions();
      const result = await miamiActiveAccounts();
      if (!mounted.current || appAuth.currentUserId() !== userId) return;
      reload();
      if (!result.ok) throw new Error("agent-unavailable");
      setVerifiedIds(new Set(result.ids));
      setCheckedAt(Date.now());
    } catch {
      if (mounted.current && appAuth.currentUserId() === userId) {
        setVerifiedIds(null);
        setCheckError(
          "Não foi possível consultar o agente. Os dados salvos continuam disponíveis; tente verificar novamente.",
        );
      }
    } finally {
      checkingRef.current = false;
      if (mounted.current) setChecking(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    reload();
    const onCloud = () => reload();
    window.addEventListener("cloud:changed", onCloud);
    void checkConnections();
    return () => {
      mounted.current = false;
      window.removeEventListener("cloud:changed", onCloud);
    };
    // Verification runs once on entry and on the explicit refresh action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function edit(client: ClientRecord) {
    navigate({ to: "/dashboard/cadastro", search: { id: client.id, edit: "1" } });
  }
  function reconnect(client: ClientRecord) {
    navigate({ to: "/dashboard/cadastro", search: { id: client.id } });
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

  const saved = clients.filter((client) => client.hasSession).length;
  const filtered = clients
    .filter((client) => {
      const matches = `${client.title} ${client.phone ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(query.trim().toLocaleLowerCase("pt-BR"));
      return (
        matches &&
        (filter === "all" || (filter === "saved" ? client.hasSession : !client.hasSession))
      );
    })
    .sort(
      (a, b) =>
        Number(a.hasSession) - Number(b.hasSession) || a.title.localeCompare(b.title, "pt-BR"),
    );

  return (
    <main className="sb-page">
      <PageBanner
        eyebrow="Contas Telegram"
        title="Conexões"
        description="Consulte as contas das suas clientes e veja quais precisam ser reconectadas."
        image="/art/cat-connect.svg"
        tone="lime"
        compact
      >
        <Button
          onClick={() => void checkConnections()}
          disabled={checking || clients.length === 0}
          className="gap-2"
        >
          <RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} aria-hidden />
          {checking ? "Consultando contas…" : "Verificar conexões"}
        </Button>
      </PageBanner>

      <section className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Resumo das conexões">
        {[
          {
            title: "Contas cadastradas",
            value: clients.length,
            Icon: Users,
            detail: "Somente as clientes da sua conta",
          },
          {
            title: "Sessões salvas",
            value: saved,
            Icon: ShieldCheck,
            detail: "Contas com uma sessão vinculada",
          },
          {
            title: "Precisam reconectar",
            value: clients.length - saved,
            Icon: PlugZap,
            detail: "Contas sem uma sessão vinculada",
          },
        ].map(({ title, value, Icon, detail }) => (
          <article className="sb-panel flex items-start gap-4 p-5" key={title}>
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-background">
              <Icon className="size-4 text-muted-foreground" aria-hidden />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">{title}</p>
              <p className="mt-1 text-3xl font-medium tabular-nums">
                {String(value).padStart(2, "0")}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">{detail}</p>
            </div>
          </article>
        ))}
      </section>

      <div
        className={`mt-5 flex items-start gap-2.5 text-xs leading-6 ${checkError ? "text-warning" : "text-muted-foreground"}`}
        role="status"
      >
        {checking ? (
          <RefreshCw className="mt-1 size-4 shrink-0 animate-spin" aria-hidden />
        ) : checkError ? (
          <CircleHelp className="mt-1 size-4 shrink-0" aria-hidden />
        ) : (
          <CheckCircle2 className="mt-1 size-4 shrink-0" aria-hidden />
        )}
        <p>
          {checking
            ? "Consultando as contas no agente de envio. Isso pode levar alguns instantes."
            : checkError ||
              (checkedAt
                ? `Última consulta ao agente: ${formatWhen(checkedAt)}. Uma sessão salva não confirma que a conta está disponível agora.`
                : "O estado salvo da sessão aparece abaixo. Verifique as conexões para consultar o agente.")}
        </p>
      </div>

      <section className="sb-panel mt-6 overflow-hidden" aria-label="Contas e conexões">
        <div className="sb-section-head flex flex-wrap items-center justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-medium">Contas das clientes</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Reconecte uma conta ou atualize os dados do cadastro.
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
              <Search
                className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar nome ou telefone"
                aria-label="Buscar uma conta por nome ou telefone"
                className="sb-input h-10 w-full pl-9 pr-3 text-xs"
              />
            </div>
            <Select value={filter} onValueChange={(value) => setFilter(value as StatusFilter)}>
              <SelectTrigger
                className="h-10 w-[180px] text-xs"
                aria-label="Filtrar conexões por status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as contas</SelectItem>
                <SelectItem value="saved">Com sessão salva</SelectItem>
                <SelectItem value="reconnect">Precisam reconectar</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {filtered.length ? (
          <ul className="divide-y divide-border">
            {filtered.map((client) => (
              <li
                key={client.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-4 p-5 sm:px-6"
              >
                <span
                  className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-background text-sm font-medium"
                  aria-hidden
                >
                  {client.title.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1 basis-40">
                  <h3 className="truncate text-sm font-medium">{client.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {client.phone ? formatDisplayPhone(client.phone) : "Telefone não informado"}
                  </p>
                  {client.connectedAt && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Sessão vinculada em {formatWhen(client.connectedAt)}
                    </p>
                  )}
                </div>
                <div className="min-w-36 text-xs">
                  <span
                    className={`inline-flex items-center gap-1.5 ${client.hasSession ? "text-foreground" : "text-warning"}`}
                  >
                    {client.hasSession ? (
                      <ShieldCheck className="size-3.5" aria-hidden />
                    ) : (
                      <PlugZap className="size-3.5" aria-hidden />
                    )}
                    {client.hasSession ? "Sessão salva" : "Reconexão necessária"}
                  </span>
                  {client.hasSession && (
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      {checking
                        ? "Consultando agente…"
                        : verifiedIds
                          ? verifiedIds.has(client.id)
                            ? "Presente no agente na última consulta"
                            : "Não localizada no agente"
                          : "Disponibilidade não confirmada"}
                    </p>
                  )}
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-4 sm:ml-auto sm:w-auto sm:border-0 sm:pt-0">
                  {client.hasSession ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => edit(client)}
                      >
                        <Pencil className="size-3.5" aria-hidden /> Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setDisconnecting(client)}
                      >
                        <Power className="size-3.5" aria-hidden /> Desconectar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" className="gap-1.5" onClick={() => reconnect(client)}>
                        <PlugZap className="size-3.5" aria-hidden /> Reconectar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-danger"
                        onClick={() => setRemoving(client)}
                      >
                        <Trash2 className="size-3.5" aria-hidden /> Remover
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5 py-14 text-center">
            <PlugZap
              className="mx-auto size-8 text-muted-foreground"
              strokeWidth={1.4}
              aria-hidden
            />
            <h3 className="mt-4 text-base font-medium">
              {clients.length ? "Nenhuma conta com esses filtros" : "Nenhuma conta cadastrada"}
            </h3>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              {clients.length
                ? "Busque outro nome ou altere o status para ver as contas."
                : "Adicione uma cliente e conecte sua conta Telegram para começar."}
            </p>
            <Button
              variant="outline"
              className="mt-5 gap-2"
              onClick={() =>
                clients.length
                  ? (setQuery(""), setFilter("all"))
                  : navigate({ to: "/dashboard/cadastro" })
              }
            >
              {clients.length ? "Limpar filtros" : "Adicionar cliente"}
              <ArrowUpRight className="size-4" aria-hidden />
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[10px] text-muted-foreground">
          <span>
            {filtered.length} {filtered.length === 1 ? "conta" : "contas"}
          </span>
          <span>Dados da sua conta</span>
        </div>
      </section>

      <AlertDialog
        open={!!removing}
        onOpenChange={(value) => {
          if (!value) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              O cadastro de “{removing?.title}”, sua sessão, credenciais e grupos salvos serão
              apagados. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter cliente</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove}>Remover cliente</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!disconnecting}
        onOpenChange={(value) => {
          if (!value) setDisconnecting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar no painel?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta de “{disconnecting?.title}” deixará de ser marcada como conectada no painel.
              Você poderá reconectá-la depois. Esta ação não encerra as sessões nos aplicativos do
              Telegram.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter conexão</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisconnect}>Desconectar no painel</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
