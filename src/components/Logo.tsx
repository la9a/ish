/** Original Senha Baixa mark: a minimal cat, drawn for the new identity. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M7 18V8l10 6a20 20 0 0 1 6 0l10-6v10c2 3 3 6 2 9-2 6-8 9-15 9S7 33 5 27c-1-3 0-6 2-9Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="m12 23 4 1m8 0 4-1m-9 5 1 1 1-1m-1 1v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
