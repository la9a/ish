import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { easeClaude } from "@/lib/motion";

function easeFn(t: number) {
  const [, y1, , y2] = easeClaude as unknown as number[];
  // Aproximação cúbica; suficiente pra ease-out perceptualmente
  return 1 - Math.pow(1 - t, 3) * (1 - (y1 + y2) / 4);
}

export function CountUp({
  value,
  duration = 900,
  className,
  format = (n) => Math.round(n).toString(),
}: {
  value: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (!inView || reduce) {
      setDisplay(value);
      prevValueRef.current = value;
      return;
    }

    const from = prevValueRef.current;
    const to = value;
    prevValueRef.current = value;

    if (from === to) {
      setDisplay(value);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + (to - from) * easeFn(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduce]);

  return (
    <span ref={ref} className={className}>
      {format(display)}
    </span>
  );
}