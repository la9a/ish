import { AdminLayout } from "./admin";
import { createFileRoute, useNavigate, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MultiPage, readSelection } from "./dashboard.multi.index";
import { syncClientGroupsMeta } from "@/lib/telegram";
import { activeClient } from "@/lib/storage";

export const Route = createFileRoute("/dashboard/multi/$selectionId")({
  head: () => ({
    meta: [
      { title: "Painel Multi | Senha Baixa" },
      { name: "description", content: "Monitoramento múltiplo ativo no Senha Baixa." },
      { property: "og:title", content: "Painel Multi | Senha Baixa" },
      { property: "og:description", content: "Monitoramento múltiplo ativo no Senha Baixa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Painel Multi | Senha Baixa" },
      { name: "twitter:description", content: "Monitoramento múltiplo ativo no Senha Baixa." },
    ],
  }),
  component: MultiSelectionRoute,
  errorComponent: MultiSelectionError,
});

function MultiSelectionError({ error }: ErrorComponentProps) {
  const navigate = useNavigate();
  return (
    <main className="flex min-h-[60dvh] items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <h2 className="text-lg font-semibold text-foreground">Não foi possível abrir o painel</h2>
        <p className="mt-2 break-words text-sm text-readable-muted">
          {(error as Error | undefined)?.message || "Erro desconhecido."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            className="rounded-lg border border-border px-4 py-2 text-sm"
            onClick={() => navigate({ to: "/dashboard/multi" })}
          >
            Voltar
          </button>
          <button
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Recarregar
          </button>
        </div>
      </div>
    </main>
  );
}

function MultiSelectionRoute() {
  const { selectionId } = Route.useParams();
  const navigate = useNavigate();
  // Leitura síncrona da seleção — evita um tick de tela em branco.
  const [ids] = useState<string[] | null>(() => {
    const stored = readSelection(selectionId);
    const ok = stored && stored.length >= 2 ? stored : null;
    // Aba nova/recarregada perde o cliente ativo (sessionStorage) e o painel
    // quebrava com "Nenhum cliente ativo selecionado". Garante um válido.
    if (ok && (!activeClient.get() || !ok.includes(activeClient.get()!))) activeClient.set(ok[0]);
    return ok;
  });

  useEffect(() => {
    if (!ids) navigate({ to: "/dashboard/multi", replace: true });
  }, [ids, navigate]);

  // Sincroniza nome/foto dos grupos monitorados de cada cliente selecionado
  // com o Telegram em background — reflete renomes automaticamente.
  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    (async () => {
      // Paraleliza a sincronização de metadados por conta — em série,
      // com 4-5 contas isso empilhava segundos antes do prewarm começar.
      await Promise.all(ids.map((id) => syncClientGroupsMeta(id).catch(() => {})));
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  if (!ids) return <main className="min-h-dvh" />;
  return <AdminLayout content={<MultiPage initialSelection={ids} />} />;
}
