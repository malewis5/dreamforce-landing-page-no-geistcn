import type { JSX } from 'react';
import Link from 'next/link';

const FOOTER_COLUMNS = [
  {
    heading: 'Studio',
    links: [
      { label: 'About', href: '#about' },
      { label: 'Services', href: '#services' },
      { label: 'Commission', href: '#commission' },
    ],
  },
  {
    heading: 'Visit',
    links: [
      { label: 'Lower Manhattan', href: '#' },
      { label: 'New York, NY', href: '#' },
      { label: 'By appointment', href: '#' },
    ],
  },
  {
    heading: 'Connect',
    links: [
      { label: 'Start a project', href: '#contact' },
      { label: 'studio@framinganddisplay.com', href: '#contact' },
      { label: 'Instagram', href: '#' },
    ],
  },
] as const;

export function SiteFooter(): JSX.Element {
  return (
    <footer className="border-t border-[var(--ds-gray-alpha-400)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-12 px-5 py-14 sm:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="flex flex-col gap-3 lg:col-span-5">
            <span className="font-editorial text-heading-24 leading-none text-gray-1000">
              Framing &amp; Display
            </span>
            <p className="max-w-xs text-copy-14 text-gray-700 text-pretty">
              A New York studio for museum-grade custom framing and display,
              from concept to installation.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.heading} className="flex flex-col gap-3">
                <h4 className="label-eyebrow text-gray-700">{column.heading}</h4>
                {column.links.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="text-copy-14 no-underline hover:text-gray-1000"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-start justify-between gap-2 border-t border-[var(--ds-gray-alpha-400)] pt-6 sm:flex-row sm:items-center">
          <span className="text-copy-13 text-gray-700">
            © {new Date().getFullYear()} Framing &amp; Display, Inc.
          </span>
          <span className="label-eyebrow text-gray-700">
            Made in New York
          </span>
        </div>
      </div>
    </footer>
  );
}
