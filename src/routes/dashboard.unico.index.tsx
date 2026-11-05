import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { clientsStore, type ClientRecord } from "@/lib/storage";
import {
  ArrowUpRight,
  Plus,
  Search,
  Pin,
  PinOff,
  Users,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import { AdminLayout } from "./admin";

export const Route = createFileRoute("/dashboard/unico/")({
  head: () => ({
    meta: [
      { title: "Minhas clientes | Senha Baixa" },
      { name: "description", content: "Organize suas clientes, contas e atendimentos." },
    ],
  }),
  component: () => <AdminLayout content={<ClientsListPage />} />,
});

function ClientsListPage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "connected" | "pending">("all");

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

  const filtered = useMemo(
    () =>
      clients
        .filter((client) => {
          const matchesQuery = client.title
            .toLocaleLowerCase("pt-BR")
            .includes(query.trim().toLocaleLowerCase("pt-BR"));
          return (
            matchesQuery &&
            (status === "all" || (status === "connected" ? client.hasSession : !client.hasSession))
          );
        })
        .sort(
          (a, b) =>
            Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
            a.title.localeCompare(b.title, "pt-BR"),
        ),
    [clients, query, status],
  );

  function openClient(client: ClientRecord) {
    navigate({ to: "/dashboard/unico/$clientId", params: { clientId: client.id } });
  }
  function togglePin(client: ClientRecord) {
    clientsStore.update(client.id, { pinned: !client.pinned });
    reload();
  }
  const connected = clients.filter((client) => client.hasSession).length;

  return (
    <main className="sb-page">
      <div className="sb-page-header flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="sb-eyebrow">Organização que acompanha você</p>
          <h1 className="mt-2">
            Minhas clientes<span className="text-muted-foreground">.</span>
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Cada atendimento, no seu lugar. Tudo sob seu controle.
          </p>
        </div>
        <button
          type="button"
          className="sb-button"
          onClick={() => navigate({ to: "/dashboard/cadastro" })}
        >
          <Plus className="size-4" aria-hidden />
          Nova cliente
        </button>
      </div>
      <div className="mt-8 grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-card py-5">
        {[
          { label: "Cadastradas", value: clients.length },
          { label: "Conectadas", value: connected },
          { label: "A reconectar", value: clients.length - connected },
        ].map(({ label, value }) => (
          <div key={label} className="px-4 sm:px-6">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-medium tracking-tight">
              {String(value).padStart(2, "0")}
            </p>
          </div>
        ))}
      </div>
      <section
        className="mt-8 overflow-hidden rounded-xl border border-border bg-card"
        aria-label="Lista de clientes"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-4 sm:p-5">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
              aria-hidden
            />
            <input
              aria-label="Buscar cliente pelo nome"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar cliente..."
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-xs placeholder:text-muted-foreground"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Status
            <select
              className="h-10 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="all">Todas</option>
              <option value="connected">Conectadas</option>
              <option value="pending">A reconectar</option>
            </select>
          </label>
        </div>
        {filtered.length ? (
          <div>
            <div className="hidden grid-cols-[1fr_150px_140px_72px] gap-4 border-b border-border px-6 py-3 text-[10px] uppercase tracking-[0.13em] text-muted-foreground sm:grid">
              <span>Cliente</span>
              <span>Conta Telegram</span>
              <span>Envio previsto</span>
              <span className="text-right">Ações</span>
            </div>
            <ul className="divide-y divide-border">
              {filtered.map((client) => (
                <li
                  key={client.id}
                  className="group grid grid-cols-[1fr_40px] items-center gap-4 px-4 py-4 transition-colors hover:bg-white/[0.025] sm:grid-cols-[1fr_150px_140px_72px] sm:px-6"
                >
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-3 text-left"
                    onClick={() => openClient(client)}
                    aria-label={`${client.hasSession ? "Abrir atendimento de" : "Conectar"} ${client.title}`}
                  >
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-background text-sm font-medium"
                      aria-hidden
                    >
                      {client.title.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
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
                        {client.hasSession ? "Abrir atendimento" : "Reconectar conta"}
                      </span>
                    </span>
                  </button>
                  <span
                    className={`hidden items-center gap-1.5 text-[11px] sm:inline-flex ${client.hasSession ? "text-foreground/80" : "text-warning"}`}
                  >
                    {client.hasSession ? (
                      <CircleCheck className="size-3.5" aria-hidden />
                    ) : (
                      <CircleAlert className="size-3.5" aria-hidden />
                    )}
                    {client.hasSession ? "Conectada" : "A reconectar"}
                  </span>
                  <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
                    {client.scheduleEnv || "Não definido"}
                  </span>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => togglePin(client)}
                      aria-label={`${client.pinned ? "Desafixar" : "Fixar"} ${client.title}`}
                      aria-pressed={Boolean(client.pinned)}
                      className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-white"
                    >
                      {client.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => openClient(client)}
                      aria-label={`Abrir ${client.title}`}
                      className="hidden size-10 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-white sm:grid"
                    >
                      <ArrowUpRight className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="px-6 py-16 text-center">
            <Users className="mx-auto size-8 text-muted-foreground" strokeWidth={1.3} aria-hidden />
            <h2 className="mt-5 text-lg font-medium">
              {clients.length
                ? "Nenhuma cliente encontrada"
                : "Seu próximo atendimento começa aqui"}
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {clients.length
                ? "Tente outro nome ou altere o filtro de status."
                : "Adicione sua primeira cliente, conecte a conta do Telegram e prepare os rascunhos."}
            </p>
            <button
              type="button"
              className="sb-button-secondary mt-6"
              onClick={() =>
                clients.length
                  ? (setQuery(""), setStatus("all"))
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
