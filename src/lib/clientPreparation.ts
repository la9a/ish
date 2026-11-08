import type { ClientRecord, MonitoredGroup } from "./storage";

/** Local preparation only: a saved session is not a live connection check. */
export function clientPreparation(
  client: Pick<ClientRecord, "hasSession">,
  groups: Pick<MonitoredGroup, "active" | "message">[],
) {
  const active = groups.filter((group) => group.active);
  const emptyDrafts = active.filter((group) => !group.message.trim()).length;
  const issues: string[] = [];
  if (!client.hasSession) issues.push("Reconectar conta");
  if (!active.length) issues.push("Adicionar ou ativar um grupo");
  if (emptyDrafts)
    issues.push(`Revisar ${emptyDrafts} ${emptyDrafts === 1 ? "rascunho" : "rascunhos"}`);
  return { ready: issues.length === 0, activeGroups: active.length, emptyDrafts, issues };
}
