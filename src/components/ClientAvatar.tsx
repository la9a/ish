// Ícone genérico de cliente (sem moldura). Não usa foto nem nome do Telegram.

import { CircleUserRound } from "lucide-react";

export function ClientAvatar({
  className = "",
}: {
  name?: string;
  className?: string;
}) {
  // Ignora classes de container (tamanho/borda/raio) vindas de fora.
  const keep = className
    .split(" ")
    .filter((c) => c === "censor-text" || c === "shrink-0")
    .join(" ");
  return (
    <CircleUserRound
      className={`size-8 shrink-0 text-white/90 select-none ${keep}`}
      strokeWidth={2}
      aria-hidden
    />
  );
}

export default ClientAvatar;
