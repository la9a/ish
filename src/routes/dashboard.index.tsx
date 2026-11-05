import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Plus,
  Users,
  Radio,
  FileText,
  UserRound,
  Zap,
} from "lucide-react";
import { AdminLayout } from "./admin";
import { AccessNotification } from "@/components/AccessNotification";
import { clientsStore, type ClientRecord } from "@/lib/storage";
import { appAuth } from "@/lib/appAuth";
import { ClientAvatar } from "@/components/ClientAvatar";

export const Route = createFileRoute("/dashboard/")({
  validateSearch: (search: Record<string, unknown>): { added?: string } => ({
    added: typeof search.added === "string" ? search.added : undefined,
  }),
  head: () => ({ meta: [{ title: "Visão geral · Senha Baixa" }] }),
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
  const name = appAuth.current()?.split(/[._-]/)[0] || "";
  const stats = [
    {
      label: "Suas clientes",
      value: clients.length,
      Icon: Users,
      detail: "Sua base de atendimentos",
    },
    {
      label: "Contas conectadas",
      value: connected,
      Icon: Radio,
      detail: "Sessões Telegram salvas",
    },
    {
      label: "A reconectar",
      value: clients.length - connected,
      Icon: Zap,
      detail: "Contas que precisam de atenção",
    },
    {
      label: "Clientes fixadas",
      value: clients.filter((client) => client.pinned).length,
      Icon: FileText,
      detail: "Sempre à mão na sua lista",
    },
  ];

  return (
    <main className="sb-page">
      <AccessNotification open={notice} title="Cliente adicionada com sucesso" />
      <div className="sb-page-header">
        <div>
          <p className="sb-eyebrow">SENHA BAIXA</p>
          <h1 className="mt-2">
            Visão geral<span className="text-muted-foreground">.</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Olá{name ? `, ${name}` : ""}. Aqui está o resumo das suas contas.
          </p>
        </div>
        <Link to="/dashboard/cadastro" className="sb-button">
          <Plus className="size-4" /> Adicionar cliente
        </Link>
      </div>
      <section className="sb-hero">
        <div className="sb-hero-copy">
          <span className="sb-art-pill">CLIENTES E ATENDIMENTOS</span>
          <h2>
            Suas clientes
            <br />
            e seus grupos.
            <br />
            <span>Contas e rascunhos.</span>
          </h2>
          <p>
            Contas, grupos e rascunhos juntos.
            <br />
            Abra uma cliente para preparar o envio.
          </p>
          <Link to="/dashboard/unico" className="sb-button mt-6">
            Gerenciar minhas clientes <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <div className="sb-hero-art">
          <img
            src="/art/cat-hero.svg"
            alt="Gato estiloso de óculos em arte colorida"
            fetchPriority="high"
          />
        </div>
      </section>
      <section className="sb-stats" aria-label="Resumo da sua conta">
        {stats.map(({ label, value, Icon, detail }) => (
          <article key={label}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Icon className="size-4 text-muted-foreground" strokeWidth={1.5} />
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
              to="/dashboard/unico"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white"
            >
              Ver todas <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
          {clients.length === 0 ? (
            <div className="sb-empty">
              <span className="sb-empty-icon">
                <Users className="size-6" strokeWidth={1.5} />
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
                  to="/dashboard/unico/$clientId"
                  params={{ clientId: client.id }}
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
              <UserRound className="size-5" strokeWidth={1.5} />
              <div>
                <h3>Atendimento único</h3>
                <p>Monitorar uma conta Telegram.</p>
              </div>
              <ArrowUpRight className="ml-auto size-4" />
            </Link>
            <Link to="/dashboard/multi" className="sb-mode">
              <Users className="size-5" strokeWidth={1.5} />
              <div>
                <h3>Atendimento múltiplo</h3>
                <p>Monitorar várias contas juntas.</p>
              </div>
              <ArrowUpRight className="ml-auto size-4" />
            </Link>
          </div>
          <div className="sb-tip">
            <img src="/art/cat-note.svg" alt="" loading="lazy" />
            <div>
              <p className="text-xs font-medium">Confira antes de iniciar</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                Confira o grupo e o rascunho de cada cliente antes de iniciar.
              </p>
            </div>
          </div>
        </section>
      </div>
      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-[10px] tracking-wider text-muted-foreground">
        <span>SENHA BAIXA © {new Date().getFullYear()}</span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5" /> Painel de atendimento
        </span>
      </footer>
    </main>
  );
}
