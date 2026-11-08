/** Present only the server's pending placeholder differently; never infer a position. */
export function pendingPositionParts(
  message: string,
  pending: boolean | undefined,
): { before: string; after: string } | null {
  if (!pending) return null;
  const match = /\bSenha\s*:\s*(?:\.{3,}|…)(?=$|[\s)])/i.exec(message);
  if (!match || match.index === undefined) return null;
  const placeholder = /(?:\.{3,}|…)$/.exec(match[0]);
  if (!placeholder || placeholder.index === undefined) return null;
  return {
    before: message.slice(0, match.index + placeholder.index),
    after: message.slice(match.index + match[0].length),
  };
}
