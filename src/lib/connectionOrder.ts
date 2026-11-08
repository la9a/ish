/** Saved session is a sorting hint, never evidence of current agent availability. */
export function compareConnectionAccounts(
  a: { hasSession?: boolean; title: string },
  b: { hasSession?: boolean; title: string },
) {
  return Number(Boolean(b.hasSession)) - Number(Boolean(a.hasSession)) ||
    a.title.localeCompare(b.title, "pt-BR");
}