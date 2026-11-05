import { useEffect, useRef, useState } from "react";
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
  const normalized = value && FULL.test(value) ? value : value && /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : "";
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
  const finalValue = FULL.test(draft) ? draft : /^\d{2}:\d{2}$/.test(draft) && FULL.test(`${draft}:00`) ? `${draft}:00` : "";
  const valid = !!finalValue;

  function confirm() {
    if (!valid) return;
    setDraft(finalValue);
    clientsStore.update(clientId, { scheduleEnv: finalValue });
    setEditing(false);
    onSaved?.();
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-sans text-muted-foreground">
        <Clock className="size-3.5 text-primary" strokeWidth={1.5} aria-hidden />
        Horário de envio (Brasília)
        {running && <Lock className="size-3 ml-auto" strokeWidth={1.5} aria-hidden />}
      </div>

      {editing && !running ? (
        <div className="mt-2 flex items-center gap-2">
          <Input
            ref={inputRef}
            value={draft}
            inputMode="numeric"
            placeholder="00:00:00"
            onChange={(e) => setDraft(mask(e.target.value))}
            onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
            className="h-9 w-[9.5rem] rounded-lg font-mono tracking-widest text-center"
          />
          <Button size="sm" className="h-9 rounded-lg" disabled={!valid} onClick={confirm}>
            <Check className="size-3.5 mr-1" strokeWidth={2} aria-hidden /> Confirmar
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-9 flex-1 min-w-0 rounded-lg border border-border bg-background px-3 inline-flex items-center font-mono text-sm tracking-widest">
            {normalized || "--:--:--"}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-9 rounded-lg"
            disabled={running}
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5 mr-1" strokeWidth={1.5} aria-hidden /> Editar
          </Button>
        </div>
      )}

      <div className="mt-1.5 text-[11px] font-mono text-muted-foreground" data-tick={tick}>
        {!normalized
          ? "Defina o horário em formato 24h (ex: 20:00:00)."
          : running
            ? `Aguardando ${normalized} — ${remainingLabel(brasiliaTargetToday(normalized))}`
            : remainingLabel(brasiliaTargetToday(normalized))}
      </div>
    </div>
  );
}
