import type { ReactNode } from "react";

export type WorkspaceIconVariant =
  | "overview"
  | "clients"
  | "single"
  | "multi"
  | "connections"
  | "person"
  | "group"
  | "identity"
  | "authorization"
  | "confirmation";

type Props = {
  variant: WorkspaceIconVariant;
  className?: string;
};

/** Original angular workspace glyphs, sharing a 24-unit optical grid. */
export function WorkspaceIcon({ variant, className = "size-5" }: Props) {
  const drawings: Record<WorkspaceIconVariant, ReactNode> = {
    overview: (
      <>
        <path d="M3.5 3.5h7v7h-7zm10 0h7v4h-7zm0 7h7v10h-7zm-10 3h7v7h-7z" />
      </>
    ),
    clients: (
      <>
        <path d="M5 3.5h13a2 2 0 0 1 2 2V20H5a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Zm1 0V20M3 8h3M3 15h3" />
        <path d="M10 7.5h6M10 11.5h6M10 15.5h3" />
      </>
    ),
    single: (
      <>
        <path d="M7 3.5h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7M4 7.5h3M4 12h3M4 16.5h3" />
        <path d="M11 7.5h4v4h-4zM9.5 17v-1.5A1.5 1.5 0 0 1 11 14h4a1.5 1.5 0 0 1 1.5 1.5V17" />
      </>
    ),
    multi: (
      <>
        <path d="M3.5 9.5h4v11h-4zm6.5-6h4v17h-4zm6.5 3h4v14h-4zM3.5 6.5h4M16.5 3.5h4" />
      </>
    ),
    connections: (
      <>
        <path d="M3.5 3.5h7v7h-7zm10 10h7v7h-7zM7 10.5V17h6.5M17 13.5V7h-6.5" />
        <path d="m14.5 5 2.5 2-2.5 2M9.5 15l-2.5 2 2.5 2" />
      </>
    ),
    person: (
      <>
        <path d="M8.5 3.5h7v7h-7zM5 20.5v-4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M3.5 20.5h17" />
      </>
    ),
    group: (
      <>
        <path d="M8.5 3.5h6v6h-6zM5.5 20.5v-5a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v5M18 5.5h3v5h-3M20 14h1v6.5M5 5.5H2v5h3M3 14H2v6.5" />
      </>
    ),
    identity: (
      <>
        <path d="M5 5.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2ZM8 3.5v4M16 3.5v4" />
        <path d="M7 11h4v4H7zm0 7h4M15 11h3M15 15h3M15 18h3" />
      </>
    ),
    authorization: (
      <>
        <path d="m10.5 3.5 5 5-5 5-5-5 5-5ZM14 12l6.5 6.5M17 15l-2 2M19.5 17.5l-2 2" />
        <path d="m9.5 7.5 2 2" />
      </>
    ),
    confirmation: (
      <>
        <path d="M20.5 11.5v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h10" />
        <path d="m8 11.5 3.5 3.5L21 5.5" />
      </>
    ),
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {drawings[variant]}
    </svg>
  );
}
