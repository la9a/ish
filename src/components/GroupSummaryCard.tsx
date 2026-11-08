import { FileText, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TgAvatar } from "@/components/TgAvatar";
import type { MonitoredGroup } from "@/lib/storage";

interface GroupSummaryCardProps {
  group: MonitoredGroup;
  showIcon: boolean;
  censorPhoto: boolean;
  censorName: boolean;
  censorDraft: boolean;
  editing?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}

export function GroupSummaryCard({
  group,
  showIcon,
  censorPhoto,
  censorName,
  censorDraft,
  editing = false,
  disabled = false,
  onToggle,
  onEdit,
  onRemove,
}: GroupSummaryCardProps) {
  const label = censorName ? "este grupo" : group.name;
  return (
    <article
      className={`overflow-hidden rounded-lg border border-border bg-background/60 ${group.active ? "" : "opacity-70"}`}
    >
      <div className="flex flex-wrap items-center gap-2.5 px-3 py-3 sm:px-4">
        {showIcon &&
          (group.photoUrl ? (
            <img
              src={group.photoUrl}
              alt=""
              className={`size-9 shrink-0 rounded-full object-cover ${censorPhoto ? "censor-text" : ""}`}
            />
          ) : (
            <TgAvatar
              name={group.name}
              single
              className={`size-9 shrink-0 rounded-full text-xs ${censorPhoto ? "censor-text" : ""}`}
            />
          ))}
        <div className="min-w-0 flex-1 basis-28">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Grupo
          </span>
          <h4 className={`mt-1 truncate text-sm font-medium ${censorName ? "censor-text" : ""}`}>
            {group.name}
          </h4>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span
            className={`size-1.5 rounded-full ${group.active ? "bg-foreground" : "bg-muted-foreground/50"}`}
            aria-hidden
          />
          {group.active ? "Envio ativo" : "Envio desativado"}
        </span>
      </div>
      <div className="border-t border-border px-3 py-3 sm:px-4">
        <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          <FileText className="size-3" aria-hidden /> Rascunho
        </p>
        <p
          className={`mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-5 ${censorDraft ? "censor-text" : ""} ${group.message.trim() ? "text-foreground/85" : "text-muted-foreground"}`}
        >
          {group.message.trim() ? group.message : "Nenhum rascunho cadastrado."}
        </p>
      </div>
      {editing && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5 sm:px-4">
          <label className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <Switch
              checked={group.active}
              onCheckedChange={onToggle}
              disabled={disabled}
              aria-label={`Habilitar envio para ${label}`}
            />
            Enviar neste grupo
          </label>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              disabled={disabled}
              className="h-9 gap-1.5 text-xs"
              aria-label={`Editar grupo e rascunho de ${label}`}
            >
              <Pencil className="size-3.5" aria-hidden />
              Editar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              disabled={disabled}
              className="h-9 gap-1.5 text-xs text-danger"
              aria-label={`Remover ${label}`}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Remover
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
