import { SlidersHorizontal } from "lucide-react";
import { playSound, START_SOUND_OPTIONS, STOP_SOUND_OPTIONS } from "@/lib/beep";
import type { MonitorSettings } from "@/lib/storage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: MonitorSettings;
  onChange: (patch: Partial<MonitorSettings>) => void;
};

function SettingsRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-xs text-readable-muted">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function MonitorSettingsPanel({ open, onOpenChange, settings, onChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="inline-flex items-center gap-2 font-serif text-2xl tracking-tight">
            <SlidersHorizontal className="size-7 text-primary" strokeWidth={1.5} aria-hidden />
            Opções de envio
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <section>
            <div className="mb-2 text-xs font-medium text-readable-muted">Geral</div>
            <SettingsRow
              title="Parar automaticamente"
              description="Encerra o monitoramento quando todos os grupos ativos forem enviados."
              checked={settings.autoStop}
              onCheckedChange={(value) => onChange({ autoStop: value })}
            />
          </section>

          <section>
            <div className="mb-2 text-xs font-medium text-readable-muted">Sons</div>
            <div className="space-y-1">
              <SettingsRow
                title="Som ao iniciar"
                description="Bip curto quando o monitoramento começa."
                checked={settings.soundStart}
                onCheckedChange={(value) => onChange({ soundStart: value })}
              />
              {settings.soundStart && (
                <div className="px-3 pb-2">
                  <Select
                    value={settings.soundStartName}
                    onValueChange={(value) => {
                      onChange({ soundStartName: value });
                      playSound(value);
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Escolher som" />
                    </SelectTrigger>
                    <SelectContent>
                      {START_SOUND_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <SettingsRow
                title="Som ao parar"
                description="Bip curto quando o monitoramento para."
                checked={settings.soundStop}
                onCheckedChange={(value) => onChange({ soundStop: value })}
              />
              {settings.soundStop && (
                <div className="px-3 pb-2">
                  <Select
                    value={settings.soundStopName}
                    onValueChange={(value) => {
                      onChange({ soundStopName: value });
                      playSound(value);
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Escolher som" />
                    </SelectTrigger>
                    <SelectContent>
                      {STOP_SOUND_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
