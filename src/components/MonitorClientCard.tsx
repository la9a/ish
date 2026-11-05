import { useEffect, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientAvatar } from "@/components/ClientAvatar";
import { miamiAccountInfo } from "@/lib/miamiAgent.functions";

interface MonitorClientCardProps {
  title: string;
  censorTitle: boolean;
  editing: boolean;
  disabled: boolean;
  onEditingChange: () => void;
  children: ReactNode;
  /** Quando informado, mostra DC da conta/grupos e tempo de resposta. */
  clientId?: string;
  groups?: { id: string; name: string }[];
}

type Info = Awaited<ReturnType<typeof miamiAccountInfo>>;

const DC_CITY: Record<number, string> = { 1: "Miami", 2: "Amsterdã", 3: "Miami", 4: "Amsterdã", 5: "Singapura" };
const dcLabel = (dc?: number | null) => (dc ? `DC${dc} - ${DC_CITY[dc] ?? "?"}` : "DC ?");

const SENHA_PREFIX = /^\s*grupo\s*(?:da\s+|de\s+)?senha[\s:.,\-]*/i;

/** A linha já começa com "Grupo:", então "Grupo da senha X" vira só "X". */
function groupShortName(name: string) {
  let acc = "";
  let consumed = 0;
  for (const ch of name) {
    acc += ch.normalize("NFKC").toLowerCase();
    consumed += ch.length;
    const m = SENHA_PREFIX.exec(acc);
    if (m && m[0].length === acc.length) {
      const rest = name.slice(consumed).trim();
      return rest || name;
    }
  }
  return name;
}

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
  const groupKey = groups.map((g) => g.id).join(",");

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    miamiAccountInfo({ data: { clientId, groups: groups.slice(0, 12).map((g) => g.id) } })
      .then((r) => { if (!cancelled) setInfo(r); })
      .catch(() => { /* indicador é opcional */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, groupKey]);

  const ok = info?.ok && info.active;
  const accDc = ok ? info.accountDc : null;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-none">
      <div className="mb-2 text-xs font-sans text-readable-muted">Cliente</div>
      <div className="mb-4 flex items-center gap-3">
        <ClientAvatar name={title} />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-lg font-medium leading-tight tracking-tight ${censorTitle ? "censor-text" : ""}`}>
            {title}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onEditingChange}
          className="h-8 gap-1.5 rounded-lg"
          title="Editar grupo e rascunho"
        >
          <Pencil className="size-3" /> {editing ? "Fechar" : "Editar"}
        </Button>
      </div>

      {clientId && info?.ok && (
        <div className="mb-4 flex flex-wrap gap-1.5 text-[11px] font-mono text-readable-muted" aria-label="Informações de rede">
          {ok ? (
            <>
              <span className="flex items-center gap-3 rounded-md border border-border px-2 py-0.5">
                <span>Cliente: {dcLabel(accDc)}</span>
                {typeof info.rtt === "number" && <span>Ping: {Math.round(info.rtt)} ms</span>}
              </span>
              {groups.slice(0, 12).map((g) => {
                const gi = info.groups?.[g.id];
                const same = gi?.dc && accDc && gi.dc === accDc;
                return (
                  <span
                    key={g.id}
                    className="max-w-full truncate rounded-md border border-border px-2 py-0.5"
                    title={same ? "Mesmo DC da conta: rota direta" : gi?.dc ? "DC diferente da conta" : "DC do grupo indisponível"}
                  >
                    Grupo: <span className={censorTitle ? "censor-text" : ""}>{groupShortName(g.name)}</span>: {dcLabel(gi?.dc)}
                    {gi?.members ? ` · ${gi.members.toLocaleString("pt-BR")} membros` : ""}
                  </span>
                );
              })}
            </>
          ) : (
            <span className="rounded-md border border-border px-2 py-0.5 text-danger">Conta fora do robô — reconecte em Conexões</span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
