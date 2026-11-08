import { useId } from "react";
import { Bell, CircleStop, Clock, Play, SlidersHorizontal, Volume2 } from "lucide-react";
import { playSound, START_SOUND_OPTIONS, STOP_SOUND_OPTIONS } from "@/lib/beep";
import type { MonitorSettings } from "@/lib/storage";
import { useClockFormat } from "@/lib/useClockFormat";
import type { ClockFormat } from "@/lib/clockFormat";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {title}
        </label>
        <p id={`${id}-description`} className="mt-1.5 text-xs leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-describedby={`${id}-description`}
        className="mt-1"
      />
    </div>
  );
}

export function MonitorSettingsPanel({ open, onOpenChange, settings, onChange }: Props) {
  const [clockFormat, setClockFormat] = useClockFormat();
  const clockFormatId = useId();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[440px]">
        <SheetHeader className="border-b border-border px-6 pb-6 pt-8 text-left">
          <span className="mb-4 grid size-11 place-items-center rounded-xl border border-border bg-card">
            <SlidersHorizontal className="size-5" strokeWidth={1.5} aria-hidden />
          </span>
          <SheetTitle className="text-xl font-medium tracking-tight">
            Opções do atendimento
          </SheetTitle>
          <SheetDescription className="text-xs leading-6">
            Ajuste a parada automática, os avisos sonoros e a exibição dos horários.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-6 py-6">
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
              <CircleStop className="size-4 text-muted-foreground" aria-hidden />
              <h3 className="text-xs font-medium">Ao concluir os envios</h3>
            </div>
            <div className="p-5">
              <SettingsRow
                title="Parar automaticamente"
                description="Encerra o monitoramento depois que todos os grupos ativos tiverem seus envios confirmados."
                checked={settings.autoStop}
                onCheckedChange={(value) => onChange({ autoStop: value })}
              />
            </div>
          </section>
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
              <Bell className="size-4 text-muted-foreground" aria-hidden />
              <h3 className="text-xs font-medium">Avisos sonoros</h3>
            </div>
            <div className="space-y-4 p-5">
              <SettingsRow
                title="Som ao iniciar"
                description="Toca um aviso quando o monitoramento começa."
                checked={settings.soundStart}
                onCheckedChange={(value) => onChange({ soundStart: value })}
              />
              {settings.soundStart && (
                <div className="border-l-2 border-border pl-4">
                  <label
                    className="mb-2 block text-[11px] text-muted-foreground"
                    htmlFor="monitor-start-sound"
                  >
                    Som de início
                  </label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={settings.soundStartName}
                      onValueChange={(value) => {
                        onChange({ soundStartName: value });
                        playSound(value);
                      }}
                    >
                      <SelectTrigger id="monitor-start-sound" className="h-10 text-xs">
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
                    <button
                      type="button"
                      className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-background hover:bg-muted"
                      aria-label="Ouvir som de início"
                      onClick={() => playSound(settings.soundStartName)}
                    >
                      <Play className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-4 border-t border-border p-5">
              <SettingsRow
                title="Som ao parar"
                description="Toca um aviso quando o monitoramento é encerrado."
                checked={settings.soundStop}
                onCheckedChange={(value) => onChange({ soundStop: value })}
              />
              {settings.soundStop && (
                <div className="border-l-2 border-border pl-4">
                  <label
                    className="mb-2 block text-[11px] text-muted-foreground"
                    htmlFor="monitor-stop-sound"
                  >
                    Som de encerramento
                  </label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={settings.soundStopName}
                      onValueChange={(value) => {
                        onChange({ soundStopName: value });
                        playSound(value);
                      }}
                    >
                      <SelectTrigger id="monitor-stop-sound" className="h-10 text-xs">
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
                    <button
                      type="button"
                      className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-background hover:bg-muted"
                      aria-label="Ouvir som de encerramento"
                      onClick={() => playSound(settings.soundStopName)}
                    >
                      <Play className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
              <Clock className="size-4 text-muted-foreground" aria-hidden />
              <h3 className="text-xs font-medium">Formato de horário</h3>
            </div>
            <div className="space-y-3 p-5">
              <label htmlFor={clockFormatId} className="block text-xs font-medium">
                Exibição do relógio
              </label>
              <Select
                value={clockFormat}
                onValueChange={(value) => setClockFormat(value as ClockFormat)}
              >
                <SelectTrigger
                  id={clockFormatId}
                  className="h-10 text-xs"
                  aria-describedby={`${clockFormatId}-help`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">24 horas · 17:59:36</SelectItem>
                  <SelectItem value="12h">12 horas · 5:59:36 PM</SelectItem>
                </SelectContent>
              </Select>
              <p
                id={`${clockFormatId}-help`}
                className="text-[11px] leading-6 text-muted-foreground"
              >
                O relógio e o horário de envio continuam no fuso de Brasília, sincronizados com o
                servidor. AM indica antes do meio-dia; PM, a partir do meio-dia.
              </p>
            </div>
          </section>
          <p className="flex items-start gap-2 text-[11px] leading-6 text-muted-foreground">
            <Volume2 className="mt-1 size-3.5 shrink-0" aria-hidden />O volume e o modo silencioso
            do seu dispositivo também afetam os avisos.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
