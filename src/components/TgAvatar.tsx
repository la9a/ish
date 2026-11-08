import { WorkspaceIcon } from "@/components/WorkspaceIcon";
import { cn } from "@/lib/utils";

/** A new geometric group tile for Telegram groups without a photo. */
export function TgAvatar({
  className = "",
}: {
  name?: string | null;
  className?: string;
  single?: boolean;
}) {
  return (
    <span
      data-avatar="group"
      aria-hidden="true"
      className={cn(
        "inline-flex size-10 shrink-0 select-none items-center justify-center rounded-xl border border-[#46434c] bg-[#222126] text-[#d6cfdf]",
        className,
      )}
    >
      <WorkspaceIcon variant="group" className="size-5" />
    </span>
  );
}
export default TgAvatar;
