import type { ComponentProps, HTMLInputTypeAttribute, JSX, ReactNode } from 'react';
import NextLink from 'next/link';

type ButtonVariant = 'primary' | 'secondary';
type ButtonSize = 'small' | 'medium' | 'large';

const buttonBase =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border font-medium no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-1000 disabled:cursor-not-allowed disabled:opacity-60';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'border-gray-1000 bg-gray-1000 text-white hover:bg-gray-900',
  secondary:
    'border-[var(--ds-gray-alpha-400)] bg-[var(--ds-background-100)] text-gray-1000 hover:bg-gray-100',
};
const buttonSizes: Record<ButtonSize, string> = {
  small: 'min-h-8 px-3 text-copy-13',
  medium: 'min-h-10 px-4 text-copy-14',
  large: 'min-h-12 px-5 text-copy-16',
};

function buttonClass(variant: ButtonVariant, size: ButtonSize, className = ''): string {
  return `${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`;
}

export function ButtonLink({
  href,
  children,
  suffix,
  variant = 'primary',
  size = 'medium',
  className,
}: {
  href: string;
  children: ReactNode;
  suffix?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}): JSX.Element {
  return (
    <NextLink href={href} className={buttonClass(variant, size, className)}>
      {children}
      {suffix}
    </NextLink>
  );
}

export function Button({
  children,
  variant = 'primary',
  size = 'medium',
  typeName = 'button',
  loading = false,
  className,
  disabled,
  ...props
}: Omit<ComponentProps<'button'>, 'type'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  typeName?: 'button' | 'submit' | 'reset';
  loading?: boolean;
}): JSX.Element {
  return (
    <button
      {...props}
      type={typeName}
      disabled={disabled || loading}
      aria-busy={loading}
      className={buttonClass(variant, size, className)}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}

const fieldClass =
  'w-full rounded-lg border border-[var(--ds-gray-alpha-400)] bg-[var(--ds-background-100)] px-3 py-2 text-copy-16 text-gray-1000 outline-none transition-colors placeholder:text-gray-700 hover:border-gray-700 focus-visible:border-gray-1000 focus-visible:ring-2 focus-visible:ring-gray-700/20 disabled:cursor-not-allowed disabled:bg-gray-100';

function FieldLabel({ id, children }: { id: string; children: ReactNode }): JSX.Element {
  return (
    <label htmlFor={id} className="mb-2 block text-copy-14 font-medium text-gray-1000">
      {children}
    </label>
  );
}

export function Input({
  id,
  label,
  typeName = 'text',
  size: _size,
  className = '',
  ...props
}: Omit<ComponentProps<'input'>, 'size' | 'type'> & {
  id: string;
  label: string;
  typeName?: HTMLInputTypeAttribute;
  size?: ButtonSize;
}): JSX.Element {
  return (
    <div>
      <FieldLabel id={id}>{label}</FieldLabel>
      <input
        {...props}
        id={id}
        type={typeName}
        className={`${fieldClass} h-12 ${className}`}
      />
    </div>
  );
}

export function Select({
  id,
  label,
  size: _size,
  className = '',
  children,
  ...props
}: Omit<ComponentProps<'select'>, 'size'> & {
  id: string;
  label: string;
  size?: ButtonSize;
}): JSX.Element {
  return (
    <div>
      <FieldLabel id={id}>{label}</FieldLabel>
      <div className="relative">
        <select
          {...props}
          id={id}
          className={`${fieldClass} h-12 appearance-none pr-10 ${className}`}
        >
          {children}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-gray-900"
        >
          <path d="m3.5 6 4.5 4.5L12.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

export function Textarea({
  id,
  label,
  className = '',
  ...props
}: ComponentProps<'textarea'> & { id: string; label: string }): JSX.Element {
  return (
    <div>
      <FieldLabel id={id}>{label}</FieldLabel>
      <textarea {...props} id={id} className={`${fieldClass} resize-y ${className}`} />
    </div>
  );
}

export function Note({
  variant,
  children,
}: {
  variant: 'success' | 'error';
  fill?: boolean;
  children: ReactNode;
}): JSX.Element {
  const colors = variant === 'success'
    ? 'border-blue-200 bg-blue-50 text-blue-900'
    : 'border-red-200 bg-red-50 text-red-900';
  return (
    <div role={variant === 'success' ? 'status' : undefined} className={`rounded-md border px-3 py-2 text-copy-14 ${colors}`}>
      {children}
    </div>
  );
}
