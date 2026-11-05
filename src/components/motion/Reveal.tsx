import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  delay?: number;
  amount?: number;
};

export function Reveal({ delay: _delay, amount: _amount, children, ...rest }: Props) {
  return <div {...rest}>{children}</div>;
}