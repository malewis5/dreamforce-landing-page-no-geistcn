import type { JSX } from 'react';
import { SiteHeader } from '@/components/site-header';
import { Hero } from '@/components/hero';
import { Pricing } from '@/components/pricing';
import { About } from '@/components/about';
import { Services } from '@/components/services';
import { Contact } from '@/components/contact';
import { SiteFooter } from '@/components/site-footer';

export default function Page(): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 sm:px-8">
        <Hero />
        <About />
        <Services />
        <Pricing />
        <Contact />
      </main>
      <SiteFooter />
    </div>
  );
}
