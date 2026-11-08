import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Clock, Check, Pencil, Lock } from "lucide-react";
import { clientsStore } from "@/lib/storage";
import { brasiliaTargetToday, isClockSynced, serverNow, syncServerClock } from "@/lib/brasiliaSync";
import {
  formatClockTime,
  normalizeTime24,
  time12To24,
  time24To12,
  type ClockFormat,
  type DayPeriod,
} from "@/lib/clockFormat";
import { useClockFormat } from "@/lib/useClockFormat";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type EditorValue = { time: string; period: DayPeriod; format: ClockFormat };
function editorValue(canonical: string, format: ClockFormat): EditorValue {
  const converted = time24To12(canonical);
  return {
    time: format === "12h" ? (converted?.time.padStart(8, "0") ?? "") : canonical,
    period: converted?.period ?? "AM",
    format,
  };
}
function canonicalValue(editor: EditorValue): string | null {
  return editor.format === "12h"
    ? time12To24(editor.time, editor.period)
    : normalizeTime24(editor.time);
}

/** Editors use two hour digits; display clocks omit the leading zero in 12h. */
function mask(raw: string, format: ClockFormat): string {
  let digits = raw.replace(/\D/g, "").slice(0, 6);
  // A single 12h digit such as 5 becomes 05 so a mobile numeric keyboard
  // can enter 5:59:36 without needing a colon key.
  if (format === "12h" && digits && (Number(digits[0]) > 1 || raw.indexOf(":") === 1)) {
    digits = `0${digits}`.slice(0, 6);
  }
  const out: string[] = [];
  for (let i = 0; i < digits.length; i++) {
    let ch = digits[i];
    if (format === "24h") {
      if (i === 0 && Number(ch) > 2) ch = "2";
      if (i === 1 && digits[0] === "2" && Number(ch) > 3) ch = "3";
      if ((i === 2 || i === 4) && Number(ch) > 5) ch = "5";
    }
    out.push(ch);
    if ((i === 1 || i === 3) && i !== digits.length - 1) out.push(":");
  }
  return out.join("");
}

function remainingLabel(target: number): string {
  if (!isClockSynced()) return "sincronizando horário de Brasília…";
  const ms = target - serverNow();
  if (ms <= 0) return "horário atingido";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `faltam ${pad(h)}:${pad(m)}:${pad(s)}`;
}

interface Props {
  clientId: string;
  /** Valor salvo (HH:MM:SS ou HH:MM de registros antigos). */
  value?: string | null;
  /** Monitoramento em execução — bloqueia edição. */
  running: boolean;
  onSaved?: () => void;
}

export function ScheduleTimeCard({ clientId, value, running, onSaved }: Props) {
  const scheduleId = useId();
  const [format] = useClockFormat();
  const normalized = normalizeTime24(value) ?? "";
  const [editor, setEditor] = useState(() => editorValue(normalized, format));
  const [editing, setEditing] = useState(!normalized);
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditor(editorValue(normalized, format));
    setEditing(!normalized);
    // Changing clients starts a fresh editor; format changes preserve valid drafts below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    setEditor((previous) =>
      previous.format === format
        ? previous
        : editorValue(canonicalValue(previous) ?? normalized, format),
    );
  }, [format, normalized]);

  useEffect(() => {
    syncServerClock().catch(() => {});
  }, []);

  useEffect(() => {
    if (editing || !normalized) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [editing, normalized]);

  // Conversion is display-only. Stored schedules remain HH:MM:SS in 24h.
  const finalValue = canonicalValue(editor);
  const valid = !!finalValue;

  function confirm() {
    if (!finalValue || running) return;
    setEditor(editorValue(finalValue, format));
    clientsStore.update(clientId, { scheduleEnv: finalValue });
    setEditing(false);
    onSaved?.();
  }

  return (
    <section
      className="mt-4 overflow-hidden rounded-xl border border-border bg-background"
      aria-labelledby={`${scheduleId}-label`}
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#c8d8a5]/10 text-[#c8d8a5]">
          <Clock className="size-4" strokeWidth={1.5} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`${scheduleId}-label`} className="text-xs font-medium">
            Horário de envio
          </h3>
          <p className="mt-0.5 text-[9px] uppercase tracking-[.1em] text-muted-foreground">
            Brasília · formato {format}
          </p>
        </div>
        {running && (
          <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
            <Lock className="size-3" aria-hidden />
            Em execução
          </span>
        )}
      </div>
      <div className="px-4 py-4">
        {editing && !running ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor={scheduleId} className="mb-2 block text-[10px] text-muted-foreground">
                Hora, minuto e segundo
              </label>
              <Input
                id={scheduleId}
                ref={inputRef}
                value={editor.time}
                inputMode="numeric"
                autoComplete="off"
                placeholder={format === "12h" ? "05:59:36" : "17:59:36"}
                onChange={(event) =>
                  setEditor((previous) => ({
                    ...previous,
                    time: mask(event.target.value, previous.format),
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") confirm();
                }}
                className="h-12 min-w-32 rounded-lg border-border bg-card text-center text-xl md:text-xl font-medium tabular-nums tracking-[.14em]"
                aria-describedby={`${scheduleId}-help`}
              />
            </div>
            {format === "12h" && (
              <div className="w-24 shrink-0">
                <label
                  htmlFor={`${scheduleId}-period`}
                  className="mb-2 block text-[10px] text-muted-foreground"
                >
                  Período
                </label>
                <Select
                  value={editor.period}
                  onValueChange={(period) =>
                    setEditor((previous) => ({ ...previous, period: period as DayPeriod }))
                  }
                >
                  <SelectTrigger
                    id={`${scheduleId}-period`}
                    className="h-12"
                    aria-label="Período do horário de envio"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AM">AM</SelectItem>
                    <SelectItem value="PM">PM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              type="button"
              size="sm"
              className="h-12 rounded-lg px-3"
              disabled={!valid}
              onClick={confirm}
            >
              <Check className="size-4" aria-hidden />
              <span>Confirmar</span>
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[1.75rem] font-medium leading-none tabular-nums tracking-[.06em]">
              {formatClockTime(normalized, format)}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 rounded-lg px-3 text-[11px]"
              disabled={running}
              onClick={() => {
                setEditor(editorValue(normalized, format));
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" aria-hidden />
              Editar
            </Button>
          </div>
        )}
        <p
          id={`${scheduleId}-help`}
          className="mt-3 border-t border-border pt-3 text-[10px] leading-relaxed tabular-nums text-muted-foreground"
          data-tick={tick}
        >
          {!normalized
            ? format === "12h"
              ? "Informe hora, minuto e segundo (ex.: 05:59:36) e escolha AM ou PM."
              : "Defina o horário em formato 24h (ex.: 20:00:00)."
            : running
              ? `Aguardando ${formatClockTime(normalized, format)} · ${remainingLabel(brasiliaTargetToday(normalized))}`
              : remainingLabel(brasiliaTargetToday(normalized))}
        </p>
      </div>
    </section>
  );
}
