import { cn } from "@/lib/utils";

/** Name-based identity tile; no legacy generic-user SVG. */
export function ClientAvatar({
  name = "Cliente",
  className = "",
}: {
  name?: string;
  className?: string;
}) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (
    words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0]?.slice(0, 2) || "CL"
  ).toLocaleUpperCase("pt-BR");
  return (
    <span
      data-avatar="client"
      aria-hidden="true"
      className={cn(
        "sb-client-avatar relative inline-flex size-10 shrink-0 select-none items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-[#202124] text-xs font-semibold tracking-wide text-[#e8e5ee]",
        className,
      )}
    >
      <span>{initials}</span>
      <span className="absolute bottom-1 right-1 size-1 rounded-[1px] bg-[#a69cba]" />
    </span>
  );
}
export default ClientAvatar;
