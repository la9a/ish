import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { appAuth } from "@/lib/appAuth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Senha Baixa | Entrada" },
      { name: "description", content: "Entrada segura para o painel Senha Baixa." },
      { property: "og:title", content: "Senha Baixa | Entrada" },
      { property: "og:description", content: "Entrada segura para o painel Senha Baixa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Senha Baixa | Entrada" },
      { name: "twitter:description", content: "Entrada segura para o painel Senha Baixa." },
    ],
  }),
  component: IndexRedirect,
});

function IndexRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      await appAuth.hydrate();
      const u = appAuth.current();
      navigate({ to: u ? "/dashboard" : "/login", replace: true });
    })();
  }, [navigate]);
  return null;

}
