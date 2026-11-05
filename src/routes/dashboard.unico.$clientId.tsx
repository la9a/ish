import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { activeClient, clientsStore } from "@/lib/storage";
import { pullGroups, pullClientSecrets } from "@/lib/cloudSync";
import { syncClientGroupsMeta } from "@/lib/telegram";
import { appAuth } from "@/lib/appAuth";
import { Dashboard } from "./dashboard";

export const Route = createFileRoute("/dashboard/unico/$clientId")({
  head: () => ({
    meta: [
      { title: "Painel Único | Senha Baixa" },
      { name: "description", content: "Monitoramento único ativo no Senha Baixa." },
      { property: "og:title", content: "Painel Único | Senha Baixa" },
      { property: "og:description", content: "Monitoramento único ativo no Senha Baixa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Painel Único | Senha Baixa" },
      { name: "twitter:description", content: "Monitoramento único ativo no Senha Baixa." },
    ],
  }),
  component: ClientEntry,
});

function ClientEntry() {
  const navigate = useNavigate();
  const { clientId } = Route.useParams();
  // Validação síncrona — se o cliente não existe ou não tem sessão, redireciona
  // sem nunca renderizar o Dashboard.
  const rec = clientsStore.get(clientId);
  const [redirecting] = useState(() => {
    if (!rec) {
      navigate({ to: "/dashboard/unico", replace: true });
      return true;
    }
    if (!rec.hasSession) {
      navigate({ to: "/dashboard/cadastro", search: { id: clientId } as any, replace: true });
      return true;
    }
    // Marca cliente ativo já no primeiro render — o Dashboard depende disso.
    activeClient.set(clientId);
    return false;
  });

  // Sync em background: puxa segredos/grupos do cloud sem bloquear a montagem
  // do Dashboard. O próprio Dashboard cuida de re-hidratar via evento cloud:changed
  // e roda isAuthorized() por conta própria.
  useEffect(() => {
    if (redirecting) return;
    const uid = appAuth.currentUserId();
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([
          pullClientSecrets(uid, clientId),
          pullGroups(uid, clientId),
        ]);
        if (cancelled) return;
        window.dispatchEvent(new CustomEvent("cloud:changed"));
        // Atualiza nome/foto dos grupos monitorados a partir do Telegram.
        syncClientGroupsMeta(clientId).catch(() => { /* ignore */ });
      } catch {
        /* ignore — dados locais já estão disponíveis */
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, redirecting]);

  if (redirecting) return <main className="min-h-dvh" />;
  return <Dashboard />;
}