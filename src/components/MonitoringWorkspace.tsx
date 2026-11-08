import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

interface MonitoringWorkspaceProps {
  clientCount: number;
  eventCount: number;
  clientHeading?: string;
  clients: ReactNode;
  events: ReactNode;
}

/** Both views keep the same mounted panels, including unsaved group edits. */
export function MonitoringWorkspace({
  clientCount,
  eventCount,
  clientHeading = "Clientes e rascunhos",
  clients,
  events,
}: MonitoringWorkspaceProps) {
  const id = useId();
  const [active, setActive] = useState<"clients" | "events">("clients");
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 1
          : event.key === "ArrowRight" || event.key === "ArrowLeft"
            ? 1 - index
            : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next === 0 ? "clients" : "events");
    buttons.current[next]?.focus();
  }

  return (
    <div className="min-w-0">
      <div
        role="tablist"
        aria-label="Painéis do monitoramento"
        className="mb-4 grid grid-cols-[1.4fr_1fr] gap-1 rounded-xl border border-border bg-card p-1 min-[900px]:hidden"
      >
        {(
          [
            ["clients", "Clientes e rascunhos", clientCount],
            ["events", "Eventos", eventCount],
          ] as const
        ).map(([key, label, count], index) => (
          <button
            key={key}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            id={`${id}-${key}-tab`}
            role="tab"
            type="button"
            aria-selected={active === key}
            aria-controls={`${id}-${key}`}
            tabIndex={active === key ? 0 : -1}
            onKeyDown={(event) => moveTab(event, index)}
            onClick={() => setActive(key)}
            className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
          >
            <span>{label}</span>
            <span className="text-[10px] tabular-nums opacity-70">{count}</span>
          </button>
        ))}
      </div>
      <div className="grid min-w-0 items-start gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <section
          id={`${id}-clients`}
          role="tabpanel"
          aria-labelledby={`${id}-clients-tab`}
          className={`min-w-0 ${active === "clients" ? "block" : "hidden"} min-[900px]:block`}
        >
          <div className="mb-3 hidden min-h-10 items-center justify-between gap-3 min-[900px]:flex">
            <h2 className="text-sm font-medium">{clientHeading}</h2>
            <span className="text-[11px] text-muted-foreground">
              {clientCount} {clientCount === 1 ? "cliente" : "clientes"}
            </span>
          </div>
          <div className="space-y-3">{clients}</div>
        </section>
        <section
          id={`${id}-events`}
          role="tabpanel"
          aria-labelledby={`${id}-events-tab`}
          className={`min-w-0 ${active === "events" ? "block" : "hidden"} min-[900px]:block`}
        >
          {events}
        </section>
      </div>
    </div>
  );
}
