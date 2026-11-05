// Ícone padrão de grupo (sem moldura): usado quando não há foto carregada.

import { MessageCircle } from "lucide-react";

export function TgAvatar({
  className = "",
  single = false,
}: {
  name?: string | null;
  className?: string;
  /** mantido para compatibilidade */
  single?: boolean;
}) {
  // Ignora classes de container (tamanho/borda/raio) vindas de fora.
  const keep = className
    .split(" ")
    .filter((c) => c === "censor-text" || c === "shrink-0")
    .join(" ");
  return (
    <MessageCircle
      className={`size-6 shrink-0 text-white/90 select-none ${keep}`}
      strokeWidth={2}
      aria-hidden
    />
  );
}

export default TgAvatar;
