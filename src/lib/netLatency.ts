// Medidor de latência (RTT) com o datacenter do Telegram.
//
// As amostras vêm dos pings de keep-alive (`updates.getState`), que já
// rodam durante o monitoramento. Servem para dois fins:
//  1. Diagnóstico honesto no log — se o RTT é alto, o gargalo é rede, não código.
//  2. Antecipar o disparo no método de horário fixo, para a mensagem CHEGAR
//     no servidor no instante alvo (e não apenas SAIR nesse instante).

const MAX_SAMPLES = 8;
const samples: number[] = [];

export function recordRtt(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0 || ms > 10000) return;
  samples.push(ms);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

/** Mediana das últimas amostras, ou null se ainda não há medição. */
export function getRtt(): number | null {
  if (samples.length === 0) return null;
  const sorted = samples.slice().sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
}

/** Quanto antecipar um disparo agendado: metade do RTT, no máx. 250ms. */
export function sendLeadMs(): number {
  const rtt = getRtt();
  if (!rtt) return 0;
  return Math.min(250, Math.round(rtt / 2));
}

/** Sufixo pronto pro log (`" · rede ~120ms"`), vazio se não medido. */
export function rttSuffix(): string {
  const rtt = getRtt();
  return rtt ? ` · rede ~${rtt}ms` : "";
}

export function resetRtt(): void {
  samples.length = 0;
}
