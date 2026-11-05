import { createFileRoute, redirect } from "@tanstack/react-router";

// Keep old bookmarks working without exposing profile or appearance settings.
export const Route = createFileRoute("/admin/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", replace: true });
  },
});
