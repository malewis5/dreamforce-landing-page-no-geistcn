import type { JSX } from 'react';
import Link from 'next/link';
import { ButtonLink } from './ui/controls';

const NAV_LINKS = [
  { label: 'Studio', href: '#about' },
  { label: 'Commission', href: '#commission' },
  { label: 'Contact', href: '#contact' },
] as const;

export function SiteHeader(): JSX.Element {
  return (
    <header className="sticky top-0 z-10 border-b border-[var(--ds-gray-alpha-400)] bg-[var(--ds-background-100)]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link
          href="/"
          aria-label="Framing & Display — home"
          className="flex flex-col text-gray-1000 no-underline"
        >
          <span className="font-editorial text-heading-20 leading-none text-gray-1000">
            Framing &amp; Display
          </span>
          <span className="label-eyebrow mt-1 text-gray-700">
            Studio · New York
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-8 md:flex"
        >
          {NAV_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="label-eyebrow text-gray-900 no-underline hover:text-gray-1000"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <ButtonLink href="#contact" variant="secondary" size="small">
          Start a Project
        </ButtonLink>
      </div>
    </header>
  );
}
