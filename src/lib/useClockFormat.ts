import { useSyncExternalStore } from "react";
import { clockPrefs } from "@/lib/storage";

/** Both clock widgets and the settings sheet react immediately to this preference. */
export function useClockFormat() {
  const format = useSyncExternalStore(
    clockPrefs.subscribe,
    clockPrefs.getFormat,
    () => "24h" as const,
  );
  return [format, clockPrefs.setFormat] as const;
}
