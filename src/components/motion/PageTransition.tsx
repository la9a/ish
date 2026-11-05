import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  return <div className="min-h-full">{children}</div>;
}