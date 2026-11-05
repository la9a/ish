/** Helpers de horário de Brasília (America/Sao_Paulo). */

const FMT_HMS = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const FMT_HM = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});
const FMT_FULL = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatBrasiliaHMS(d: Date = new Date()): string {
  return FMT_HMS.format(d);
}
export function formatBrasiliaHM(d: Date = new Date()): string {
  return FMT_HM.format(d);
}
export function formatBrasiliaFull(d: Date = new Date()): string {
  return FMT_FULL.format(d);
}

/** Retorna minutos desde 00:00 no fuso de Brasília (0..1439). */
export function nowBrasiliaMinutes(d: Date = new Date()): number {
  const [h, m] = FMT_HM.format(d).split(":").map(Number);
  return h * 60 + m;
}

/** Dia da semana (0=Dom..6=Sáb) no fuso de Brasília. */
export function nowBrasiliaWeekday(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[parts] ?? 0;
}