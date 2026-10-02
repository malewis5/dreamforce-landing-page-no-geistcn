import type { HTMLAttributes, JSX } from 'react';

/** A simple surface container using the page's local design tokens. */
export function Card({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={`rounded-lg border border-[var(--ds-gray-alpha-400)] bg-[var(--ds-background-100)] ${className}`}
      {...props}
    />
  );
}
