import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, CircleHelp, LoaderCircle, Network, Pencil, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientAvatar } from "@/components/ClientAvatar";
import { WorkspaceIcon } from "@/components/WorkspaceIcon";
import { miamiAccountInfo } from "@/lib/miamiAgent.functions";

interface MonitorClientCardProps {
  title: string;
  censorTitle: boolean;
  editing: boolean;
  disabled: boolean;
  onEditingChange: () => void;
  children: ReactNode;
  clientId?: string;
  groups?: { id: string; name: string }[];
}

type Info = Awaited<ReturnType<typeof miamiAccountInfo>>;
const DC_CITY: Record<number, string> = { 1: "Miami", 2: "Amsterdã", 3: "Miami", 4: "Amsterdã", 5: "Singapura" };
const dcLabel = (dc?: number | null) => (dc ? `DC${dc} - ${DC_CITY[dc] ?? "?"}` : "Não informado");

export function MonitorClientCard({
  title,
  censorTitle,
  editing,
  disabled,
  onEditingChange,
  children,
  clientId,
  groups = [],
}: MonitorClientCardProps) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const groupKey = groups.map((group) => group.id).join(",");

  useEffect(() => {
    setInfo(null);
    setUnavailable(false);
    if (!clientId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    miamiAccountInfo({ data: { clientId, groups: groups.slice(0, 12).map((group) => group.id) } })
      .then((result) => {
        if (!cancelled) {
          setInfo(result);
          setUnavailable(!result.ok);
        }
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Group names do not change the account/network query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, groupKey]);

  const active = info?.ok && info.active;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-start gap-2.5 border-b border-border p-3 sm:px-4 sm:py-3.5">
        <ClientAvatar
          name={title}
          className={`size-10 shrink-0 ${censorTitle ? "censor-text" : ""}`}
        />
        <div className="min-w-0 flex-1 basis-28">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cliente</p>
          <h3
            data-client-title="monitor"
            className={`mt-1 whitespace-normal break-words [overflow-wrap:anywhere] text-base font-medium leading-6 ${censorTitle ? "censor-text" : ""}`}
          >
            {title}
          </h3>
        </div>
        <Button
          type="button"
          variant={editing ? "default" : "outline"}
          size="sm"
          disabled={disabled}
          onClick={onEditingChange}
          className="h-10 shrink-0 gap-1.5 px-3 text-xs"
          aria-pressed={editing}
        >
          <Pencil className="size-3.5" aria-hidden />
          {editing ? "Concluir edição" : "Editar grupos"}
        </Button>
      </header>
      {clientId && (
        <div className="border-b border-border bg-background/25 px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-2 text-[11px]" role="status">
            {loading ? (
              <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
            ) : active ? (
              <ShieldCheck className="size-3.5 text-success" aria-hidden />
            ) : (
              <CircleHelp className="size-3.5 text-warning" aria-hidden />
            )}
            <span className={active ? "text-foreground/85" : "text-muted-foreground"}>
              {loading
                ? "Consultando conexão…"
                : unavailable
                  ? "Não foi possível consultar a conexão"
                  : active
                    ? "Conexão disponível nesta consulta"
                    : info?.ok
                      ? "Conta não localizada no agente. Verifique em Conexões."
                      : "Conexão ainda não consultada"}
            </span>
          </div>
          {active && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] text-muted-foreground">
                <Network className="size-3" aria-hidden />
                Detalhes da conexão
                <ChevronDown
                  className="ml-auto size-3 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <dl className="mt-3 grid gap-x-4 gap-y-2 border-t border-border pt-3 text-[11px] sm:grid-cols-2">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Datacenter da conta</dt>
                  <dd>{dcLabel(info.accountDc)}</dd>
                </div>
                {typeof info.rtt === "number" && Number.isFinite(info.rtt) && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Resposta da consulta</dt>
                    <dd className="tabular-nums">{Math.round(info.rtt)} ms</dd>
                  </div>
                )}
                {groups.slice(0, 12).map((group) => {
                  const data = info.groups?.[group.id];
                  return (
                    <div
                      key={group.id}
                      className="flex min-w-0 items-start justify-between gap-3 sm:col-span-2"
                    >
                      <dt
                        className={`min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] text-muted-foreground ${censorTitle ? "censor-text" : ""}`}
                      >
                        {group.name}
                      </dt>
                      <dd className="flex shrink-0 items-center gap-2">
                        {dcLabel(data?.dc)}
                        {typeof data?.members === "number" && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <WorkspaceIcon variant="group" className="size-3" />
                            {data.members.toLocaleString("pt-BR")} membros
                          </span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
                O tempo de resposta da consulta não representa a velocidade de envio de mensagens.
              </p>
            </details>
          )}
        </div>
      )}
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}
