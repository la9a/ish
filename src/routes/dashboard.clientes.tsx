import { createFileRoute } from "@tanstack/react-router";
import { ClientDirectory } from "@/components/ClientDirectory";
import { AdminLayout } from "./admin";

export const Route = createFileRoute("/dashboard/clientes")({
  validateSearch: (search: Record<string, unknown>): { client?: string } => ({
    client: typeof search.client === "string" ? search.client : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Minhas clientes | Senha Baixa" },
      { name: "description", content: "Consulte os dados, grupos e rascunhos das suas clientes." },
      { property: "og:title", content: "Minhas clientes | Senha Baixa" },
      { property: "og:description", content: "Consulte os dados, grupos e rascunhos das suas clientes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClientsPage,
});

function ClientsPage() {
  const { client } = Route.useSearch();
  return <AdminLayout content={<ClientDirectory mode="browse" initialClient={client} />} />;
}
