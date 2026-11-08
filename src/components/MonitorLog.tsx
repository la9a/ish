import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  CircleCheck,
  CircleHelp,
  Info,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import type { LogEntry } from "@/lib/telegram";
import { formatBrasiliaClock } from "@/lib/clockFormat";
import { useClockFormat } from "@/lib/useClockFormat";
import { Button } from "@/components/ui/button";
import { pendingPositionParts } from "@/lib/pendingPosition";

const levels = {
  info: {
    label: "Informação",
    Icon: Info,
    color: "text-muted-foreground",
    border: "border-border",
  },
  success: {
    label: "Concluído",
    Icon: CircleCheck,
    color: "text-success",
    border: "border-success/25",
  },
  warn: {
    label: "Atenção",
    Icon: TriangleAlert,
    color: "text-warning",
    border: "border-warning/25",
  },
  error: { label: "Erro", Icon: CircleHelp, color: "text-danger", border: "border-danger/25" },
} satisfies Record<
  LogEntry["level"],
  { label: string; Icon: typeof Info; color: string; border: string }
>;

export function MonitorLog({
  entries,
  showTime = true,
  isMonitoring = false,
  onClear,
}: {
  entries: LogEntry[];
  showTime?: boolean;
  isMonitoring?: boolean;
  onClear?: () => void;
}) {
  const [clockFormat] = useClockFormat();
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const visibleEntries = entries.slice(-300);

  useEffect(() => {
    if (!ref.current) return;
    if (following.current) ref.current.scrollTop = ref.current.scrollHeight;
    else setShowLatest(true);
  }, [entries]);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    // The phone tabs retain the mounted log; follow the tail when it becomes visible.
    const observer = new ResizeObserver(() => {
      if (following.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function jumpToLatest() {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    following.current = true;
    setShowLatest(false);
  }

  return (
    <section
      className="sb-panel relative overflow-hidden"
      aria-label="Histórico de eventos do atendimento"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Activity className="size-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-medium">Eventos</h2>
            <span className="text-[10px] tabular-nums text-muted-foreground">{entries.length}</span>
          </div>
          <span className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span
              className={`size-1.5 rounded-full ${isMonitoring ? "bg-success motion-safe:animate-pulse" : "bg-muted-foreground/50"}`}
              aria-hidden
            />
            {isMonitoring ? "Monitoramento em andamento" : "Monitoramento parado"}
          </span>
        </div>
        {onClear && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={!entries.length}
            className="h-9 px-3 text-xs"
          >
            Limpar
          </Button>
        )}
      </header>
      <div
        ref={ref}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        tabIndex={0}
        aria-label="Eventos mais recentes"
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
          if (following.current) setShowLatest(false);
        }}
        className="h-[min(60dvh,30rem)] min-h-60 overflow-y-auto overscroll-contain px-3 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4 min-[900px]:h-[32rem]"
      >
        {visibleEntries.length ? (
          <ol className="space-y-0">
            {visibleEntries.map((entry, index) => {
              const { label, Icon, color, border } = levels[entry.level];
              const pendingPosition = pendingPositionParts(entry.msg, entry.pending);
              return (
                <li key={entry.id} className="relative flex gap-2.5 pb-4 last:pb-0">
                  {index < visibleEntries.length - 1 && (
                    <span
                      className="absolute bottom-0 left-[13px] top-7 w-px bg-border"
                      aria-hidden
                    />
                  )}
                  <span
                    className={`relative z-10 grid size-7 shrink-0 place-items-center rounded-full border bg-card ${border} ${color}`}
                  >
                    {entry.pending ? (
                      <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden />
                    ) : (
                      <Icon className="size-3.5" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={`text-[10px] font-medium ${color}`}>
                        {entry.pending ? "Em apuração" : label}
                      </span>
                      {showTime && (
                        <time
                          dateTime={new Date(entry.ts).toISOString()}
                          className="text-[10px] tabular-nums text-muted-foreground"
                        >
                          {formatBrasiliaClock(entry.ts, clockFormat)}
                          <span className="sr-only">, horário de Brasília</span>
                        </time>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-xs leading-5 text-foreground/85">
                      {pendingPosition ? (
                        <>
                          {pendingPosition.before}
                          <span
                            role="status"
                            aria-label="Apurando senha"
                            className="mx-0.5 inline-flex align-middle"
                          >
                            <LoaderCircle
                              className="size-3.5 motion-safe:animate-spin"
                              aria-hidden
                            />
                            <span className="sr-only">Apurando senha</span>
                          </span>
                          {pendingPosition.after}
                        </>
                      ) : (
                        entry.msg
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Activity className="size-7 text-muted-foreground" strokeWidth={1.3} aria-hidden />
            <p className="mt-4 text-sm font-medium">Os eventos aparecerão aqui</p>
            <p className="mt-2 max-w-xs text-xs leading-6 text-muted-foreground">
              {isMonitoring
                ? "Aguardando atualizações do monitoramento."
                : "Ao iniciar o atendimento, acompanhe a conexão, o envio e a apuração da senha."}
            </p>
          </div>
        )}
      </div>
      {(entries.length > 300 || showLatest) && <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2.5 text-[10px] text-muted-foreground sm:px-4">
        {entries.length > 300 && <span>Exibindo os 300 eventos mais recentes</span>}
        {showLatest && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="inline-flex min-h-8 items-center gap-1.5 text-foreground"
          >
            <ArrowDown className="size-3" aria-hidden />
            Ir ao mais recente
          </button>
        )}
      </footer>}
    </section>
  );
}
