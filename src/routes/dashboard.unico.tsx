import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/unico")({
  head: () => ({
    meta: [
      { title: "Único | Senha Baixa" },
      { name: "description", content: "Área de atendimento único do Senha Baixa." },
      { property: "og:title", content: "Único | Senha Baixa" },
      { property: "og:description", content: "Área de atendimento único do Senha Baixa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Único | Senha Baixa" },
      { name: "twitter:description", content: "Área de atendimento único do Senha Baixa." },
    ],
  }),
  component: () => <Outlet />,
});