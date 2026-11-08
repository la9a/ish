import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { isClockSynced, serverNow, syncServerClock } from "@/lib/brasiliaSync";

import { formatBrasiliaClock } from "@/lib/clockFormat";
import { useClockFormat } from "@/lib/useClockFormat";

export function BrasiliaClock() {
  const [now, setNow] = useState<number | null>(null);
  const [format] = useClockFormat();

  useEffect(() => {
    // Sincroniza com o servidor na montagem e re-sincroniza a cada 60s
    // para corrigir qualquer desvio do relógio do aparelho.
    syncServerClock().catch(() => {});
    const resync = window.setInterval(() => {
      syncServerClock().catch(() => {});
    }, 60_000);

    const tick = () => {
      if (!isClockSynced()) {
        syncServerClock().catch(() => {});
        return;
      }
      setNow(serverNow());
    };
    tick();
    // Alinha o tick com a virada exata de cada segundo (sem isso o
    // relógio fica até ~1s atrasado em relação ao segundo real).
    let timer: number | undefined;
    const scheduleNext = () => {
      const msIntoSecond = serverNow() % 1000;
      timer = window.setTimeout(
        () => {
          tick();
          scheduleNext();
        },
        Math.max(1, 1000 - msIntoSecond),
      );
    };
    scheduleNext();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.clearInterval(resync);
    };
  }, []);

  return (
    <div
      aria-label={
        now === null
          ? "Sincronizando relógio de Brasília"
          : "Horário de Brasília sincronizado com o servidor"
      }
      className="site-control-glass flex items-center gap-2.5 rounded-xl border border-foreground/35 px-3.5 py-2 shadow-none"
    >
      <Clock className="size-3.5 text-foreground/80" aria-hidden />
      <span className="text-sm tabular tracking-tight font-mono text-foreground/90">
        {now === null ? "--:--:--" : formatBrasiliaClock(now, format)}
      </span>
    </div>
  );
}
