import { BannerArtwork } from "@/components/BannerArtwork";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { WorkspaceIcon } from "@/components/WorkspaceIcon";
import { AdminLayout } from "./admin";
import { AccessNotification } from "@/components/AccessNotification";
import { clientData, clientsStore, type ClientRecord } from "@/lib/storage";
import { clientPreparation } from "@/lib/clientPreparation";
import { PreparationGuide } from "@/components/PreparationGuide";
import { appAuth } from "@/lib/appAuth";
import { ClientAvatar } from "@/components/ClientAvatar";

export const Route = createFileRoute("/dashboard/")({
  validateSearch: (search: Record<string, unknown>): { added?: string } => ({
    added: typeof search.added === "string" ? search.added : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Visão geral · Senha Baixa" },
      { name: "description", content: "Resumo das suas clientes e atendimentos no Senha Baixa." },
      { property: "og:title", content: "Visão geral · Senha Baixa" },
      {
        property: "og:description",
        content: "Resumo das suas clientes e atendimentos no Senha Baixa.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <AdminLayout content={<DashboardHome />} />,
});

function DashboardHome() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/dashboard/" });
  const [notice, setNotice] = useState(false);
  const [clients, setClients] = useState<ClientRecord[]>([]);

  useEffect(() => {
    const refresh = () => {
      const list = clientsStore.list();
      setClients(list);
    };
    refresh();
    window.addEventListener("cloud:changed", refresh);
    return () => window.removeEventListener("cloud:changed", refresh);
  }, []);

  useEffect(() => {
    if (!search.added) return;
    setNotice(true);
    navigate({ to: "/dashboard", search: {}, replace: true });
  }, [search.added, navigate]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(false), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const connected = clients.filter((client) => client.hasSession).length;
  const preparation = clients.map((client) => ({
    client,
    ...clientPreparation(client, clientData.getGroups(client.id)),
  }));
  const pending = preparation.filter((item) => !item.ready);
  const readyCount = preparation.length - pending.length;
  const name = appAuth.current()?.split(/[._-]/)[0] || "";
  const stats = [
    {
      label: "Suas clientes",
      value: clients.length,
      icon: "clients" as const,
      detail: "Sua base de atendimentos",
    },
    {
      label: "Sessões salvas",
      value: connected,
      icon: "connections" as const,
      detail: "Sessões Telegram salvas",
    },
    {
      label: "A reconectar",
      value: clients.length - connected,
      icon: "authorization" as const,
      detail: "Contas que precisam de atenção",
    },
    {
      label: "Clientes fixadas",
      value: clients.filter((client) => client.pinned).length,
      icon: "identity" as const,
      detail: "Clientes fixadas no topo da lista",
    },
  ];

  return (
    <main className="sb-page">
      <AccessNotification open={notice} title="Cliente adicionada com sucesso" />
      <section className="sb-hero">
        <div className="sb-hero-copy">
          <span className="sb-art-pill">VISÃO GERAL</span>
          <h1>
            Olá{name ? `, ${name}` : ""}.<br />
            Suas clientes.
          </h1>
          <p>Grupos e rascunhos para o próximo atendimento.</p>
          <div className="sb-hero-actions">
            <Link to="/dashboard/clientes" className="sb-button">
              Gerenciar clientes <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
        <BannerArtwork image="/art/cat-hero.svg" className="sb-hero-art" priority />
      </section>
      <div className="sb-hero-support">
        <dl className="sb-banner-highlights">
          <div>
            <dt>Preparadas</dt>
            <dd>{readyCount}</dd>
          </div>
          <div>
            <dt>Com pendências</dt>
            <dd>{pending.length}</dd>
          </div>
          <div>
            <dt>Grupos ativos</dt>
            <dd>{preparation.reduce((total, item) => total + item.activeGroups, 0)}</dd>
          </div>
        </dl>
        <div className="sb-banner-actions">
          <Link to="/dashboard/cadastro" className="sb-button-secondary">
            Adicionar cliente <Plus className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
      <PreparationGuide />
      <section className="sb-stats" aria-label="Resumo da sua conta">
        {stats.map(({ label, value, icon, detail }) => (
          <article key={label}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{label}</span>
              <WorkspaceIcon variant={icon} className="size-[18px] text-muted-foreground" />
            </div>
            <p className="my-3 text-3xl font-medium tracking-tight tabular-nums">
              {String(value).padStart(2, "0")}
            </p>
            <p className="text-[11px] text-muted-foreground">{detail}</p>
          </article>
        ))}
      </section>
      <div className="sb-home-bottom">
        <section className="sb-panel overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-5">
            <h2 className="text-base font-medium">
              Minhas clientes{" "}
              <span className="ml-2 text-xs text-muted-foreground">{clients.length}</span>
            </h2>
            <Link
              to="/dashboard/clientes"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white"
            >
              Ver todas <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          {clients.length === 0 ? (
            <div className="sb-empty">
              <span className="sb-empty-icon">
                <WorkspaceIcon variant="clients" className="size-6" />
              </span>
              <h3>Nenhuma cliente cadastrada.</h3>
              <p>
                Adicione uma conta Telegram para preparar
                <br className="hidden sm:block" /> seus grupos e rascunhos.
              </p>
              <Link to="/dashboard/cadastro" className="sb-button-secondary mt-5">
                <Plus className="size-4" /> Adicionar cliente
              </Link>
            </div>
          ) : (
            <div>
              {clients.slice(0, 4).map((client) => (
                <Link
                  key={client.id}
                  to="/dashboard/clientes"
                  search={{ client: client.id }}
                  className="sb-client-row"
                >
                  <ClientAvatar name={client.title} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{client.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {client.hasSession ? "Conta Telegram vinculada" : "Conecte para começar"}
                    </p>
                  </div>
                  <span className={`sb-status ${client.hasSession ? "" : "sb-status-pending"}`}>
                    {client.hasSession ? "Conectada" : "Pendente"}
                  </span>
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="sb-panel p-5">
          <p className="sb-eyebrow">ATALHOS</p>
          <h2 className="mt-2 text-lg">Abrir atendimento</h2>
          <div className="mt-5 space-y-2">
            <Link to="/dashboard/unico" className="sb-mode">
              <WorkspaceIcon variant="single" className="size-5" />
              <div>
                <h3>Atendimento único</h3>
                <p>Monitorar uma conta Telegram.</p>
              </div>
              <ArrowUpRight className="ml-auto size-4" />
            </Link>
            <Link to="/dashboard/multi" className="sb-mode">
              <WorkspaceIcon variant="multi" className="size-5" />
              <div>
                <h3>Atendimento multi</h3>
                <p>Monitorar várias contas juntas.</p>
              </div>
              <ArrowUpRight className="ml-auto size-4" />
            </Link>
          </div>
          <div className="sb-tip">
            <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground">
              <WorkspaceIcon variant="confirmation" className="size-6" />
            </span>
            <div>
              <p className="text-xs font-medium">Confira antes de iniciar</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                Confira o grupo e o rascunho de cada cliente antes de iniciar.
              </p>
            </div>
          </div>
        </section>
      </div>
      {pending.length > 0 && (
        <section className="sb-panel mt-6 overflow-hidden" aria-label="Pendências de preparação">
          <div className="border-b border-border p-5">
            <p className="sb-eyebrow">PRÓXIMOS PASSOS</p>
            <h2 className="mt-2 text-lg">O que falta preparar</h2>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              Pendências do cadastro salvo. A disponibilidade das contas deve ser consultada em
              Conexões.
            </p>
          </div>
          <ul className="divide-y divide-border">
            {pending.slice(0, 5).map(({ client, issues }) => (
              <li key={client.id} className="flex flex-wrap items-center gap-3 p-5">
                <ClientAvatar name={client.title} />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="break-words text-sm font-medium">{client.title}</p>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    {issues.join(" · ")}
                  </p>
                </div>
                {client.hasSession ? (
                  <Link
                    to="/dashboard/unico/$clientId"
                    params={{ clientId: client.id }}
                    className="sb-button-secondary"
                  >
                    Revisar grupos <ArrowUpRight className="size-3" aria-hidden />
                  </Link>
                ) : (
                  <Link
                    to="/dashboard/cadastro"
                    search={{ id: client.id }}
                    className="sb-button-secondary"
                  >
                    Reconectar <ArrowUpRight className="size-3" aria-hidden />
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {pending.length > 5 && (
            <p className="border-t border-border p-5 text-xs text-muted-foreground">
              Mais {pending.length - 5} clientes com pendências. Consulte a lista completa em Minhas
              clientes.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
