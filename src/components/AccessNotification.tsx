import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** The same notification surface for access, registration errors and success. */
export function AccessNotification({ open, title, children }: { open: boolean; title: string; children?: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 top-4 z-[70] w-[min(300px,calc(100vw-2rem))]">
      <AnimatePresence>
        {open && (
          <motion.div
            key={title}
            initial={{ opacity: 0, x: reduced ? 0 : 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduced ? 0 : 24 }}
            transition={{ duration: reduced ? 0 : 0.3 }}
            className="access-notification tui-window border-foreground/20 bg-transparent px-4 py-3 backdrop-blur-[3px]"
          >
            <p className="text-sm font-medium text-foreground [text-shadow:0_1px_5px_var(--background)]">{title}</p>
            {children && <div className="mt-1 text-sm tabular-nums text-foreground/75 [text-shadow:0_1px_5px_var(--background)]">{children}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}