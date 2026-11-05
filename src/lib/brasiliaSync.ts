// Sincroniza o relógio local com o servidor (mais confiável que o horário
// do dispositivo do usuário) e permite aguardar um horário HH:MM exato
// em Brasília (UTC-3, fixo — sem DST desde 2019).

import { getServerNow } from "@/lib/serverTime.functions";

let offsetMs = 0; // serverNow - clientNow
let synced = false;
let syncInFlight: Promise<void> | null = null;

/** Sincroniza offset com o servidor. Idempotente por chamada — chame
 *  antes de iniciar monitores com método "abertura2". */
export async function syncServerClock(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    try {
      const t0 = Date.now();
      const { now } = await getServerNow();
      const t1 = Date.now();
      const rtt = t1 - t0;
      // Assume simetria de latência → servidor no meio do RTT.
      offsetMs = now - (t0 + Math.floor(rtt / 2));
      synced = true;
    } catch {
      // Mantém o último offset válido; nunca volta ao relógio do aparelho.
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

export function isClockSynced(): boolean {
  return synced;
}

/** "Agora" corrigido, em ms Unix. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Calcula o instante alvo (ms Unix) do HH:MM de hoje em Brasília.
 *  Brasília é UTC-3 fixo. Se o alvo já passou hoje, retorna o valor
 *  já ultrapassado (o chamador decide se dispara imediatamente). */
export function brasiliaTargetToday(hhmm: string): number {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return serverNow();
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  const nowMs = serverNow();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const mo = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);
  // Brasília = UTC-3 → HH em BRT equivale a HH+3 em UTC.
  return Date.UTC(y, mo - 1, d, hh + 3, mm, ss, 0);
}

/** Aguarda até o instante HH:MM (Brasília) de hoje, com precisão de
 *  milissegundos. `abort` é consultado a cada tick — se retornar true,
 *  a promise resolve imediatamente sem disparar.
 *  `leadMs` antecipa o disparo (compensação de metade do RTT), pra que a
 *  mensagem CHEGUE no servidor no instante alvo. */
export function waitUntilBrasilia(
  hhmm: string,
  abort?: () => boolean,
  leadMs = 0,
): Promise<void> {
  return new Promise((resolve) => {
    const lead = Math.max(0, Math.min(250, Math.round(leadMs)));
    const target = brasiliaTargetToday(hhmm) - lead;
    const tick = () => {
      if (abort && abort()) return resolve();
      const remaining = target - serverNow();
      if (remaining <= 0) return resolve();

      if (remaining <= 30) {
        // Spin final — precisão sub-ms. Bloqueia a thread por no
        // máximo ~30ms.
        const deadline = target;
        while (serverNow() < deadline) {
          if (abort && abort()) break;
        }
        return resolve();
      }
      // Agenda próximo tick: dorme quase todo o tempo restante, deixando
      // uma margem pra spin final.
      const nextIn = remaining > 1000 ? Math.min(remaining - 500, 1000) : remaining - 25;
      setTimeout(tick, Math.max(1, nextIn));
    };
    tick();
  });
}