import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronDown,
  CircleHelp,
  LoaderCircle,
  Network,
  Pencil,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
const dcLabel = (dc?: number | null) => (dc ? `DC ${dc}` : "Não informado");

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
    <section className="sb-panel overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-full border border-border bg-background text-base font-medium ${censorTitle ? "censor-text" : ""}`}
          aria-hidden
        >
          {title.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 basis-28">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Atendimento da cliente
          </p>
          <h3 className={`mt-1 truncate text-base font-medium ${censorTitle ? "censor-text" : ""}`}>
            {title}
          </h3>
        </div>
        <Button
          type="button"
          variant={editing ? "default" : "outline"}
          size="sm"
          disabled={disabled}
          onClick={onEditingChange}
          className="h-10 gap-2 text-xs"
          aria-pressed={editing}
        >
          <Pencil className="size-3.5" aria-hidden />
          {editing ? "Concluir edição" : "Editar grupos"}
        </Button>
      </header>
      {clientId && (
        <div className="border-b border-border bg-background/40 px-5 py-3">
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
                ? "Consultando conta no agente…"
                : unavailable
                  ? "Não foi possível consultar a conexão"
                  : active
                    ? "Conta disponível no agente nesta consulta"
                    : info?.ok
                      ? "Conta não localizada no agente. Verifique em Conexões."
                      : "Conexão ainda não consultada"}
            </span>
          </div>
          {active && (
            <details className="group mt-3">
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
                        className={`min-w-0 truncate text-muted-foreground ${censorTitle ? "censor-text" : ""}`}
                      >
                        {group.name}
                      </dt>
                      <dd className="flex shrink-0 items-center gap-2">
                        {dcLabel(data?.dc)}
                        {typeof data?.members === "number" && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Users className="size-3" aria-hidden />
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
      <div className="p-5">{children}</div>
    </section>
  );
}
