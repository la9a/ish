import { createServerFn } from "@tanstack/react-start";

// Retorna o "agora" do servidor em ms Unix. Usado pelo cliente pra corrigir
// o relógio local (que pode estar dessincronizado) e disparar envios no
// horário exato de Brasília no método "Grupo aberto 2".
export const getServerNow = createServerFn({ method: "GET" }).handler(async () => ({
  now: Date.now(),
}));