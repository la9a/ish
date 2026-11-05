import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/dashboard")({
  validateSearch: (search: Record<string, unknown>): { added?: string } => ({
    added: typeof search.added === "string" ? search.added : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/dashboard",
      search: search.added ? { added: search.added } : {},
      replace: true,
    });
  },
});
