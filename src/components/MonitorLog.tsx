import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { easeClaude } from "@/lib/motion";
import type { LogEntry } from "@/lib/telegram";
import { formatBrasiliaHMS } from "@/lib/brasiliaTime";

const colors: Record<LogEntry["level"], string> = {
  info: "text-foreground/80",
  success: "text-foreground",
  warn: "text-warning",
  error: "text-danger",
};

const SPINNER = ["✢", "✳", "✴", "✻", "✷", "·"];
const MONITOR_START_RE = /^\s*iniciado/i;



export function MonitorLog({
  entries,
  showTime = true,
  isMonitoring = false,
}: {
  entries: LogEntry[];
  showTime?: boolean;
  isMonitoring?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [spinIdx, setSpinIdx] = useState(0);

  // Cap rendered entries — DOM com centenas de linhas trava scroll/render.
  const MAX_RENDERED = 300;
  const visibleEntries =
    entries.length > MAX_RENDERED ? entries.slice(entries.length - MAX_RENDERED) : entries;

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries]);

  // Linhas com a senha ainda sendo apurada no servidor também animam.
  const hasPending = visibleEntries.some((e) => e.pending);

  useEffect(() => {
    if (!isMonitoring && !hasPending) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const id = setInterval(() => setSpinIdx((i) => (i + 1) % SPINNER.length), 180);
    return () => clearInterval(id);
  }, [isMonitoring, hasPending]);

  // Index of the latest "Monitoramento iniciado" entry (animated only while monitoring).
  let animatedId: string | number | null = null;
  for (let i = visibleEntries.length - 1; i >= 0; i--) {
    if (MONITOR_START_RE.test(visibleEntries[i].msg)) {
      animatedId = visibleEntries[i].id;
      break;
    }
  }

  return (
    <div className="site-glass overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-muted/70 px-3 py-2">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-3 w-3 rounded-full"
            animate={
              isMonitoring && !reduce
                ? {
                    backgroundColor: ["#525252", "#737373", "#FFFFFF", "#737373", "#525252"],
                  }
                : { backgroundColor: "#525252" }
            }
            transition={{
              duration: isMonitoring && !reduce ? 1.2 : 0.55,
              repeat: isMonitoring && !reduce ? Infinity : 0,
              delay: isMonitoring && !reduce ? i * 0.3 : 0,
              times: isMonitoring && !reduce ? [0, 0.25, 0.5, 0.75, 1] : undefined,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
      <div
        ref={ref}
        onWheel={(e) => {
          // Deixa o scroll subir pro container pai quando este log já está no
          // topo/fundo ou não tem overflow. Sem isso, passar o mouse em cima
          // do log trava o scroll da página em atendimento multi.
          const el = e.currentTarget;
          const atTop = el.scrollTop <= 0;
          const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          const canScroll = el.scrollHeight > el.clientHeight + 1;
          if (!canScroll || (e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
            // Não consome — deixa o scroll seguir pra página.
            return;
          }
        }}
        className="h-72 overflow-y-auto bg-transparent p-3 font-mono text-xs leading-relaxed"
      >
      {visibleEntries.length > 0 && (
        <AnimatePresence initial={false}>
          {visibleEntries.map((e) => {
            const isAnimated = isMonitoring && e.id === animatedId;
            const prefix = isAnimated ? SPINNER[spinIdx] : ">";
            return (
              <motion.div
                key={e.id}
                initial={reduce ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, ease: easeClaude }}
                className={`${colors[e.level]} flex items-start gap-1.5`}
              >
                <span className="shrink-0 font-bold text-white tabular-nums w-3 text-center" style={{ textShadow: "0 0 8px rgba(255,255,255,0.55)" }}>
                  {prefix}
                </span>
                <span>
                  {showTime && (
                    <>
                      <span className="text-muted-foreground/60">[{formatBrasiliaHMS(new Date(e.ts))}]</span>{" "}
                    </>
                  )}
                  {e.pending && e.msg.includes("…")
                    ? e.msg.replace("…", SPINNER[spinIdx])
                    : e.msg}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}
      </div>
    </div>
  );

}