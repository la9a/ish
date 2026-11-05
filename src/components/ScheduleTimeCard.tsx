import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Clock, Check, Pencil, Lock } from "lucide-react";
import { clientsStore } from "@/lib/storage";
import { brasiliaTargetToday, serverNow, syncServerClock } from "@/lib/brasiliaSync";

const FULL = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

/** Máscara 24h HH:MM:SS a partir de dígitos digitados. */
function mask(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 6);
  const out: string[] = [];
  for (let i = 0; i < d.length; i++) {
    let ch = d[i];
    // Clamps por posição (24h)
    if (i === 0 && Number(ch) > 2) ch = "2";
    if (i === 1 && d[0] === "2" && Number(ch) > 3) ch = "3";
    if ((i === 2 || i === 4) && Number(ch) > 5) ch = "5";
    out.push(ch);
    if ((i === 1 || i === 3) && i !== d.length - 1) out.push(":");
  }
  return out.join("");
}

function remainingLabel(target: number): string {
  let ms = target - serverNow();
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
  const normalized =
    value && FULL.test(value) ? value : value && /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : "";
  const [draft, setDraft] = useState(normalized || "");
  const [editing, setEditing] = useState(!normalized);
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(normalized || "");
    setEditing(!normalized);
  }, [clientId]);

  useEffect(() => {
    syncServerClock().catch(() => {});
  }, []);

  useEffect(() => {
    if (editing || !normalized) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [editing, normalized]);

  // Aceita HH:MM (completa com :00) ou HH:MM:SS.
  const finalValue = FULL.test(draft)
    ? draft
    : /^\d{2}:\d{2}$/.test(draft) && FULL.test(`${draft}:00`)
      ? `${draft}:00`
      : "";
  const valid = !!finalValue;

  function confirm() {
    if (!valid) return;
    setDraft(finalValue);
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
            Brasília · formato 24h
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
                value={draft}
                inputMode="numeric"
                autoComplete="off"
                placeholder="00:00:00"
                onChange={(event) => setDraft(mask(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") confirm();
                }}
                className="h-12 min-w-32 rounded-lg border-border bg-card text-center text-xl md:text-xl font-medium tabular-nums tracking-[.14em]"
                aria-describedby={`${scheduleId}-help`}
              />
            </div>
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
          <div className="flex items-center justify-between gap-3">
            <span className="text-[1.75rem] font-medium leading-none tabular-nums tracking-[.06em]">
              {normalized || "--:--:--"}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 rounded-lg px-3 text-[11px]"
              disabled={running}
              onClick={() => setEditing(true)}
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
            ? "Defina o horário em formato 24h (ex.: 20:00:00)."
            : running
              ? `Aguardando ${normalized} · ${remainingLabel(brasiliaTargetToday(normalized))}`
              : remainingLabel(brasiliaTargetToday(normalized))}
        </p>
      </div>
    </section>
  );
}
