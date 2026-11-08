/** Display preferences never change the canonical 24h schedule sent to Miami. */
export type ClockFormat = "24h" | "12h";
export type DayPeriod = "AM" | "PM";

const TIME_24 = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const TIME_12 = /^(?:0?[1-9]|1[0-2]):[0-5]\d(?::[0-5]\d)?$/;

export function normalizeTime24(value: string | null | undefined): string | null {
  if (!value || !TIME_24.test(value)) return null;
  return value.length === 5 ? `${value}:00` : value;
}

export function time24To12(value: string): { time: string; period: DayPeriod } | null {
  const normalized = normalizeTime24(value);
  if (!normalized) return null;
  const [hour, minute, second] = normalized.split(":");
  const h = Number(hour);
  return { time: `${h % 12 || 12}:${minute}:${second}`, period: h < 12 ? "AM" : "PM" };
}

export function time12To24(value: string, period: DayPeriod): string | null {
  if (!TIME_12.test(value) || (period !== "AM" && period !== "PM")) return null;
  const [hour, minute, second = "00"] = value.split(":");
  const h = (Number(hour) % 12) + (period === "PM" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${minute}:${second}`;
}

export function formatClockTime(value: string, format: ClockFormat): string {
  const normalized = normalizeTime24(value);
  if (!normalized) return "--:--:--";
  if (format === "24h") return normalized;
  const converted = time24To12(normalized)!;
  return `${converted.time} ${converted.period}`;
}

const BRASILIA_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Call with serverNow(), never the device's uncorrected clock. */
export function formatBrasiliaClock(timestamp: number, format: ClockFormat): string {
  if (!Number.isFinite(timestamp)) return "--:--:--";
  const parts = BRASILIA_PARTS.formatToParts(new Date(timestamp));
  const part = (name: string) => parts.find((p) => p.type === name)?.value ?? "00";
  return formatClockTime(`${part("hour")}:${part("minute")}:${part("second")}`, format);
}
