import { createFileRoute } from "@tanstack/react-router";
import { ClientDirectory } from "@/components/ClientDirectory";
import { AdminLayout } from "./admin";

export const Route = createFileRoute("/dashboard/unico/")({
  head: () => ({
    meta: [
      { title: "Atendimento único | Senha Baixa" },
      { property: "og:title", content: "Atendimento único | Senha Baixa" },
      { property: "og:description", content: "Escolha uma cliente para abrir o monitoramento individual." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        name: "description",
        content: "Escolha uma cliente para abrir o monitoramento individual.",
      },
    ],
  }),
  component: () => <AdminLayout content={<ClientDirectory mode="single" />} />,
});
