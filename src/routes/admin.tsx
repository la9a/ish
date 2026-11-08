import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouterState,
  redirect,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { appAuth } from "@/lib/appAuth";
import { supabase } from "@/integrations/supabase/client";
import { pullAll, subscribeRealtime, migrateLegacyLocalDataOnce } from "@/lib/cloudSync";
import { LogOut, Menu } from "lucide-react";
import { WorkspaceIcon } from "@/components/WorkspaceIcon";
import { clientsStore } from "@/lib/storage";
import { Logo } from "@/components/Logo";
import { PageEntrance } from "@/components/PageEntrance";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
  },
  head: () => ({
    meta: [
      { title: "Senha Baixa | Painel" },
      { property: "og:title", content: "Senha Baixa | Painel" },
      { property: "og:description", content: "Suas clientes e seus atendimentos em um só lugar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "description", content: "Suas clientes e seus atendimentos em um só lugar." },
    ],
  }),
  component: AdminLayout,
});

export function AdminLayout({ content }: { content?: ReactNode } = {}) {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [user, setUser] = useState<string | null>(() => appAuth.current());
  const [open, setOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [disconnectedIds, setDisconnectedIds] = useState<string[]>([]);
  const ackKey = `sb:disconnected:ack:${appAuth.currentUserId() ?? "anon"}`;
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(ackKey) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    const refresh = () => {
      const ids = clientsStore
        .list()
        .filter((c) => !c.hasSession)
        .map((c) => c.id);
      setDisconnectedIds(ids);
      setAcknowledged((prev) => {
        const next = new Set([...prev].filter((id) => ids.includes(id)));
        if (next.size === prev.size) return prev;
        try {
          localStorage.setItem(ackKey, JSON.stringify([...next]));
        } catch {
          /* storage unavailable */
        }
        return next;
      });
    };
    refresh();
    window.addEventListener("cloud:changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("cloud:changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [ackKey]);

  useEffect(() => {
    if (!path.startsWith("/admin/connection") || !disconnectedIds.length) return;
    setAcknowledged((prev) => {
      const next = new Set([...prev, ...disconnectedIds]);
      if (next.size === prev.size) return prev;
      try {
        localStorage.setItem(ackKey, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, [path, disconnectedIds, ackKey]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      await appAuth.hydrate();
      if (cancelled) return;
      const current = appAuth.current();
      const uid = appAuth.currentUserId();
      if (!current || !uid) {
        navigate({ to: "/login", replace: true });
        return;
      }
      setUser(current);
      migrateLegacyLocalDataOnce(uid, current)
        .then(() => pullAll(uid))
        .then(() => {
          if (!cancelled) window.dispatchEvent(new CustomEvent("cloud:changed"));
        })
        .catch(() => {
          /* Local data remains available while offline. */
        });
      unsubscribe = subscribeRealtime(uid, () => {
        if (!cancelled) window.dispatchEvent(new CustomEvent("cloud:changed"));
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [navigate]);

  const alertCount = disconnectedIds.filter((id) => !acknowledged.has(id)).length;
  const nav = [
    {
      to: "/dashboard" as const,
      label: "Visão geral",
      icon: "overview" as const,
      active: path === "/dashboard" || path === "/dashboard/",
    },
    {
      to: "/dashboard/clientes" as const,
      label: "Minhas clientes",
      icon: "clients" as const,
      active: path.startsWith("/dashboard/clientes") || path.startsWith("/dashboard/cadastro"),
    },
    {
      to: "/dashboard/unico" as const,
      label: "Atendimento único",
      icon: "single" as const,
      active: path.startsWith("/dashboard/unico"),
    },
    {
      to: "/dashboard/multi" as const,
      label: "Atendimento multi",
      icon: "multi" as const,
      active: path.startsWith("/dashboard/multi"),
    },
    {
      to: "/admin/connection" as const,
      label: "Conexões",
      icon: "connections" as const,
      active: path.startsWith("/admin/connection"),
    },
  ];
  const pageTitle = nav.find((item) => item.active)?.label ?? "Seu painel";

  async function performLogout() {
    await appAuth.logout();
    // A fresh document clears Telegram pools, monitors and in-flight work
    // before another operator signs in on this browser.
    window.location.assign("/login");
  }

  function SidebarContents() {
    return (
      <>
        <Link
          to="/dashboard"
          className="flex items-center gap-2.5 px-5 py-8 text-lg font-semibold tracking-tight"
          onClick={() => setOpen(false)}
          aria-label="Senha Baixa, visão geral"
        >
          <Logo className="size-9 shrink-0" />
          <span>Senha Baixa</span>
        </Link>
        <p className="mb-3 px-6 text-xs font-medium tracking-wide text-muted-foreground">
          Workspace
        </p>
        <nav aria-label="Navegação principal" className="space-y-1 px-3">
          {nav.map(({ to, label, icon, active }) => (
            <Link
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors ${active ? "bg-white text-black" : "text-muted-foreground hover:bg-white/5 hover:text-white"}`}
            >
              <WorkspaceIcon variant={icon} className="size-[18px] shrink-0" />
              <span className="flex-1">{label}</span>
              {to === "/admin/connection" && alertCount > 0 && (
                <span
                  aria-label={`${alertCount} clientes precisam de conexão`}
                  className={`grid min-w-5 place-items-center rounded-full px-1 text-[10px] font-semibold ${active ? "bg-black/10 text-black" : "bg-white/10 text-white"}`}
                >
                  {alertCount}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-3 border-t border-border px-5 py-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
            <WorkspaceIcon variant="person" className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{user}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Sua conta</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setConfirmLogout(true);
            }}
            aria-label="Sair da conta"
            className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-white"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-dvh w-full bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:p-3 focus:text-black"
      >
        Pular para o conteúdo
      </a>
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <SidebarContents />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex h-[76px] items-center justify-between gap-4 border-b border-border px-5 md:px-9">
          <div className="flex items-center gap-3">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Abrir menu"
                  className="grid size-10 place-items-center rounded-lg border border-border md:hidden"
                >
                  <Menu className="size-4" />
                </button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="flex w-[280px] flex-col gap-0 p-0"
                aria-describedby="navigation-description"
              >
                <SheetTitle className="sr-only">Menu Senha Baixa</SheetTitle>
                <SheetDescription id="navigation-description" className="sr-only">
                  Navegue entre suas clientes, atendimentos e conexões.
                </SheetDescription>
                <SidebarContents />
              </SheetContent>
            </Sheet>
            <span className="text-xs text-muted-foreground">
              Seu painel<span className="mx-3 text-border">/</span>
              <span className="font-medium text-foreground">{pageTitle}</span>
            </span>
          </div>
          <span className="hidden text-[11px] text-muted-foreground sm:block">
            Clientes e monitoramento
          </span>
        </header>
        <div id="main-content" tabIndex={-1}>
          <PageEntrance>{content ?? <Outlet />}</PageEntrance>
        </div>
      </div>
      <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair da sua conta?</AlertDialogTitle>
            <AlertDialogDescription>
              Suas clientes e sessões continuam salvas. Para voltar, use sua chave de acesso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar no painel</AlertDialogCancel>
            <AlertDialogAction onClick={performLogout}>Sair da conta</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
