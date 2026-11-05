import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Ícone de ajuda que abre um popover no clique/toque (funciona em mobile e desktop).
 * Substitui usos de Tooltip que só reagiam ao hover.
 */
export function HelpHint({
  children,
  side = "top",
  align = "center",
  className,
  iconClassName,
  label = "Ajuda",
}: {
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  iconClassName?: string;
  label?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "text-muted-foreground/70 hover:text-foreground transition-colors inline-flex items-center justify-center",
            className,
          )}
        >
          <HelpCircle className={cn("size-3.5", iconClassName)} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="max-w-[240px] text-center text-xs leading-relaxed p-3"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}