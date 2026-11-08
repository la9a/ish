import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ChevronDown,
  CircleCheck,
  CircleAlert,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
} from "lucide-react";
import { ClientAvatar } from "@/components/ClientAvatar";
import { TgAvatar } from "@/components/TgAvatar";
import { WorkspaceIcon } from "@/components/WorkspaceIcon";
import { PageBanner } from "@/components/PageBanner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clientData, clientsStore, type ClientRecord } from "@/lib/storage";
import { formatDisplayPhone } from "@/lib/countries";
import { formatClockTime } from "@/lib/clockFormat";
import { useClockFormat } from "@/lib/useClockFormat";
import { clientPreparation } from "@/lib/clientPreparation";
import { PreparationGuide } from "@/components/PreparationGuide";

/** Browsing client details never activates an account or mounts a monitor. */
export function ClientDirectory({
  mode,
  initialClient,
}: {
  mode: "browse" | "single";
  initialClient?: string;
}) {
  const navigate = useNavigate();
  const id = useId();
  const [clockFormat] = useClockFormat();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "connected" | "pending">("all");
  const [preparation, setPreparation] = useState<"all" | "ready" | "review">("all");
  const [expanded, setExpanded] = useState<string | null>(initialClient ?? null);
  const browsing = mode === "browse";

  function reload() {
    setClients(clientsStore.list());
  }
  useEffect(() => {
    reload();
    window.addEventListener("cloud:changed", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("cloud:changed", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  useEffect(() => {
    if (initialClient) setExpanded(initialClient);
  }, [initialClient]);

  const filtered = useMemo(
    () =>
      clients
        .filter((client) => {
          const matches = `${client.title} ${client.phone ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(query.trim().toLocaleLowerCase("pt-BR"));
          const ready = clientPreparation(client, clientData.getGroups(client.id)).ready;
          return (
            matches &&
            (preparation === "all" || (preparation === "ready" ? ready : !ready)) &&
            (status === "all" || (status === "connected" ? client.hasSession : !client.hasSession))
          );
        })
        .sort(
          (a, b) =>
            Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
            a.title.localeCompare(b.title, "pt-BR"),
        ),
    [clients, query, status, preparation],
  );
  const prepared = clients.filter(
    (client) => clientPreparation(client, clientData.getGroups(client.id)).ready,
  ).length;

  function choose(client: ClientRecord) {
    if (browsing) {
      setExpanded((current) => (current === client.id ? null : client.id));
      return;
    }
    navigate({ to: "/dashboard/unico/$clientId", params: { clientId: client.id } });
  }
  function togglePin(client: ClientRecord) {
    clientsStore.update(client.id, { pinned: !client.pinned });
    reload();
  }
  function edit(client: ClientRecord) {
    navigate({ to: "/dashboard/cadastro", search: { id: client.id, edit: "1" } });
  }
  function reconnect(client: ClientRecord) {
    navigate({ to: "/dashboard/cadastro", search: { id: client.id } });
  }

  return (
    <main className="sb-page">
      <PageBanner
        eyebrow={browsing ? "SUAS CLIENTES" : "ATENDIMENTO ÚNICO"}
        title={browsing ? "Minhas clientes" : "Atendimento único"}
        description={
          browsing
            ? "Consulte os dados, grupos e rascunhos de cada cliente."
            : "Escolha uma cliente para abrir o monitoramento individual."
        }
        image={browsing ? "/art/cat-note.svg" : "/art/cat-single-select.svg"}
        tone={browsing ? "lime" : undefined}
        highlights={[
          { label: "Cadastradas", value: clients.length },
          { label: "Preparadas", value: prepared },
          { label: "Com pendências", value: clients.length - prepared },
        ]}
        hint="Preparada = sessão salva, grupo ativo e rascunho preenchido. Confira a conexão antes de iniciar."
        compact
      >
        <button
          type="button"
          className="sb-button"
          onClick={() => navigate({ to: "/dashboard/cadastro" })}
        >
          <Plus className="size-4" aria-hidden /> Nova cliente
        </button>
        <button
          type="button"
          className="sb-button-secondary"
          onClick={() => {
            setPreparation(preparation === "review" ? "all" : "review");
            setQuery("");
            setStatus("all");
          }}
          aria-pressed={preparation === "review"}
        >
          {preparation === "review" ? "Mostrar todas" : "Revisar pendências"}
        </button>
      </PageBanner>
      <PreparationGuide />
      <section
        className="mt-6 overflow-hidden rounded-xl border border-border bg-card"
        aria-label={browsing ? "Lista de clientes" : "Clientes para atendimento único"}
      >
        <div className="sb-directory-toolbar border-b border-border">
          <div className="sb-directory-search relative min-w-0">
            <Search
              className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
              aria-hidden
            />
            <input
              aria-label="Buscar cliente pelo nome"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar nome ou telefone..."
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs placeholder:text-muted-foreground"
            />
          </div>
          <div className="sb-directory-filter text-xs text-muted-foreground">
            <span id={`${id}-status`} className="shrink-0">
              Status
            </span>
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger className="h-10 w-full min-w-0" aria-labelledby={`${id}-status`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">Todas as clientes</SelectItem>
                <SelectItem value="connected">Conectadas</SelectItem>
                <SelectItem value="pending">A reconectar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sb-directory-filter text-xs text-muted-foreground">
            <span id={`${id}-preparation`}>Preparação</span>
            <Select
              value={preparation}
              onValueChange={(value) => setPreparation(value as typeof preparation)}
            >
              <SelectTrigger className="h-10 min-w-0" aria-labelledby={`${id}-preparation`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="ready">Preparadas</SelectItem>
                <SelectItem value="review">Com pendências</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {filtered.length ? (
          <ul className="divide-y divide-border">
            {filtered.map((client) => {
              const open = browsing && expanded === client.id;
              const groups = browsing ? clientData.getGroups(client.id) : [];
              const regionId = `${id}-client-${client.id}`;
              return (
                <li key={client.id}>
                  <div
                    data-selection-item={browsing ? undefined : "single"}
                    className="sb-directory-row flex items-center gap-1 px-3 py-2 transition-colors hover:bg-white/[0.025] sm:gap-3 sm:px-5"
                  >
                    <button
                      type="button"
                      onClick={() => choose(client)}
                      aria-expanded={browsing ? open : undefined}
                      aria-controls={browsing ? regionId : undefined}
                      aria-label={
                        browsing
                          ? `${open ? "Recolher" : "Ver detalhes de"} ${client.title}`
                          : `${client.hasSession ? "Abrir atendimento de" : "Conectar"} ${client.title}`
                      }
                      className="sb-directory-toggle flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
                    >
                      <ClientAvatar name={client.title} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span className="truncate">{client.title}</span>
                          {client.pinned && (
                            <Pin
                              className="size-3 shrink-0 text-muted-foreground"
                              aria-label="Fixada"
                            />
                          )}
                        </span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {browsing
                            ? client.phone
                              ? formatDisplayPhone(client.phone)
                              : "Ver grupos e dados da cliente"
                            : client.hasSession
                              ? "Abrir atendimento"
                              : "Reconectar conta"}
                        </span>
                      </span>
                      <span
                        className={`hidden items-center gap-1.5 text-[11px] sm:inline-flex ${client.hasSession ? "text-foreground/80" : "text-warning"}`}
                      >
                        {client.hasSession ? (
                          <CircleCheck className="size-3.5" aria-hidden />
                        ) : (
                          <CircleAlert className="size-3.5" aria-hidden />
                        )}
                        {client.hasSession ? "Sessão salva" : "A reconectar"}
                      </span>
                      {browsing ? (
                        <ChevronDown
                          className={`ml-1 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                      ) : (
                        <ArrowUpRight
                          className="ml-1 size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePin(client)}
                      aria-label={`${client.pinned ? "Desafixar" : "Fixar"} ${client.title}`}
                      aria-pressed={Boolean(client.pinned)}
                      className="sb-pin-toggle grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-white"
                    >
                      {client.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                    </button>
                  </div>
                  {open && (
                    <div
                      id={regionId}
                      role="region"
                      aria-label={`Detalhes de ${client.title}`}
                      className="animate-in fade-in border-t border-border bg-background/50 px-4 py-5 duration-200 motion-reduce:animate-none sm:px-6"
                    >
                      <dl className="grid gap-x-5 gap-y-4 text-xs sm:grid-cols-3">
                        <div>
                          <dt className="text-[10px] text-muted-foreground">Sessão</dt>
                          <dd className="mt-1">
                            {client.hasSession ? "Sessão salva" : "Sem sessão salva"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] text-muted-foreground">
                            Envio previsto · Brasília
                          </dt>
                          <dd className="mt-1 tabular-nums">
                            {client.scheduleEnv
                              ? formatClockTime(client.scheduleEnv, clockFormat)
                              : "Não definido"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] text-muted-foreground">Método</dt>
                          <dd className="mt-1">
                            {client.method === "abertura2"
                              ? "Grupo aberto 2"
                              : client.method === "mensagem"
                                ? "Grupo aberto"
                                : "Grupo fechado"}
                          </dd>
                        </div>
                      </dl>
                      <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
                        Uma sessão salva não confirma que a conta está disponível agora. Consulte o
                        estado atual em Conexões.
                      </p>
                      <div
                        className="mt-4 rounded-lg border border-border p-3 text-xs"
                        aria-label={`Preparação de ${client.title}`}
                      >
                        {clientPreparation(client, groups).ready ? (
                          <p>Cadastro preparado. Confira a conexão e os dados antes de iniciar.</p>
                        ) : (
                          <>
                            <p className="font-medium">Falta preparar</p>
                            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
                              {clientPreparation(client, groups).issues.map((issue) => (
                                <li key={issue}>{issue}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                      <div className="mt-5 flex items-center justify-between gap-3">
                        <h2 className="text-xs font-medium">Grupos e rascunhos</h2>
                        <span className="text-[10px] text-muted-foreground">
                          {groups.length} {groups.length === 1 ? "grupo" : "grupos"}
                        </span>
                      </div>
                      {groups.length ? (
                        <ul className="mt-3 space-y-3">
                          {groups.map((group) => (
                            <li
                              key={group.id}
                              className="rounded-xl border border-border p-3 sm:p-4"
                            >
                              <div className="flex items-center gap-3">
                                <TgAvatar name={group.name} className="size-8" />
                                <div className="min-w-0 flex-1">
                                  <h3 className="break-words text-xs font-medium">{group.name}</h3>
                                  <p className="mt-1 text-[10px] text-muted-foreground">
                                    {group.active ? "Habilitado para envio" : "Envio desabilitado"}
                                  </p>
                                </div>
                              </div>
                              <p className="mt-3 whitespace-pre-wrap break-words border-t border-border pt-3 text-xs leading-6 text-muted-foreground">
                                {group.message.trim() || "Nenhum rascunho salvo."}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-xs text-muted-foreground">
                          Nenhum grupo cadastrado para esta cliente.
                        </p>
                      )}
                      <div className="mt-5 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="sb-button-secondary"
                          onClick={() => edit(client)}
                        >
                          <Pencil className="size-3.5" aria-hidden /> Editar cliente
                        </button>
                        {!client.hasSession && (
                          <button
                            type="button"
                            className="sb-button-secondary"
                            onClick={() => reconnect(client)}
                          >
                            Reconectar conta <ArrowUpRight className="size-3.5" aria-hidden />
                          </button>
                        )}
                        {client.hasSession && (
                          <button
                            type="button"
                            className="sb-button-secondary"
                            onClick={() =>
                              navigate({
                                to: "/dashboard/unico/$clientId",
                                params: { clientId: client.id },
                              })
                            }
                          >
                            Preparar grupos <ArrowUpRight className="size-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-6 py-16 text-center">
            <WorkspaceIcon
              variant={browsing ? "clients" : "single"}
              className="mx-auto size-8 text-muted-foreground"
            />
            <h2 className="mt-5 text-lg font-medium">
              {clients.length ? "Nenhuma cliente encontrada" : "Nenhuma cliente cadastrada"}
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {clients.length
                ? "Tente outro nome ou altere o filtro de status."
                : "Cadastre uma cliente para conectar sua conta e preparar o atendimento."}
            </p>
            <button
              type="button"
              className="sb-button-secondary mt-6"
              onClick={() =>
                clients.length
                  ? (setQuery(""), setStatus("all"), setPreparation("all"))
                  : navigate({ to: "/dashboard/cadastro" })
              }
            >
              {clients.length ? "Limpar filtros" : "Adicionar primeira cliente"}
            </button>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[10px] text-muted-foreground">
          <span>
            {filtered.length} {filtered.length === 1 ? "cliente" : "clientes"}
          </span>
          <span>Somente as clientes da sua conta</span>
        </div>
      </section>
    </main>
  );
}
