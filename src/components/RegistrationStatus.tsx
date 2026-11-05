import { useEffect, useState } from "react";

export function RegistrationStatus({ text }: { text: string }) {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    setDots(1);
    const timer = setInterval(() => setDots((value) => value % 3 + 1), 300);
    return () => clearInterval(timer);
  }, [text]);
  return (
    <div role="status" aria-label={`${text}...`} className="flex min-h-44 items-center justify-center py-8 text-center">
      <p aria-hidden="true" className="text-base font-medium text-foreground">
        {text}<span className="inline-block w-[3ch] text-left">{".".repeat(dots)}</span>
      </p>
    </div>
  );
}