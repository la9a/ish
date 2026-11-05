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
  return (
    <div className="hairline flex min-h-[66px] items-center gap-3 rounded-xl p-3">
      {showIcon && (
        group.photoUrl ? (
          <img
            src={group.photoUrl}
            alt={group.name}
            className={`size-10 shrink-0 rounded-lg object-cover hairline ${censorPhoto ? "censor-text" : ""}`}
          />
        ) : (
          <TgAvatar name={group.name} single className={`size-10 shrink-0 rounded-lg text-sm ${censorPhoto ? "censor-text" : ""}`} />
        )
      )}
      <div className="min-w-0 flex-1 self-center">
        <div className={`truncate text-sm font-medium ${censorName ? "censor-text" : ""}`}>{group.name}</div>
        <div className={`truncate font-mono text-[12px] text-readable-muted ${censorDraft ? "censor-text" : ""}`}>
          "{group.message.slice(0, 80)}{group.message.length > 80 ? "…" : ""}"
        </div>
      </div>
      {editing && (
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <Switch checked={group.active} onCheckedChange={onToggle} disabled={disabled} />
          <Button variant="ghost" size="sm" onClick={onEdit} disabled={disabled}>Editar</Button>
          <Button variant="ghost" size="sm" onClick={onRemove} disabled={disabled}>Remover</Button>
        </div>
      )}
    </div>
  );
}