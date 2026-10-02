import './globals.css';
import type { JSX, ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Fraunces, Geist } from 'next/font/google';

const sans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

const editorial = Fraunces({
  subsets: ['latin'],
  variable: '--font-editorial',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Framing & Display — Custom framing and display for premium spaces',
  description:
    'A New York studio designing, fabricating, and installing museum-grade custom framing and display systems for premium offices, galleries, and retail flagships.',
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <html className={`${sans.variable} ${editorial.variable}`} lang="en">
      <body>{children}</body>
    </html>
  );
}
