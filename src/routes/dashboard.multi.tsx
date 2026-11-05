import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/multi")({
  head: () => ({
    meta: [
      { title: "Multi | Senha Baixa" },
      { name: "description", content: "Área de atendimento múltiplo do Senha Baixa." },
      { property: "og:title", content: "Multi | Senha Baixa" },
      { property: "og:description", content: "Área de atendimento múltiplo do Senha Baixa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Multi | Senha Baixa" },
      { name: "twitter:description", content: "Área de atendimento múltiplo do Senha Baixa." },
    ],
  }),
  component: () => <Outlet />,
});