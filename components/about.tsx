import type { JSX } from 'react';
import Image from 'next/image';

const STATS = [
  { value: '12k+', label: 'Pieces framed' },
  { value: '25+', label: 'Years of craft' },
  { value: '48h', label: 'Avg. quote turnaround' },
] as const;

export function About(): JSX.Element {
  return (
    <section
      id="about"
      className="relative grid scroll-mt-24 grid-cols-1 gap-10 py-20 before:absolute before:-inset-x-5 before:top-0 before:border-t before:border-[var(--ds-gray-alpha-400)] before:content-[''] sm:py-28 sm:before:inset-x-0 lg:grid-cols-12 lg:gap-12"
    >
      <div className="flex flex-col gap-6 lg:col-span-6">
        <span className="label-eyebrow text-gray-700">The Studio</span>
        <h2 className="font-editorial max-w-xl text-heading-32 text-gray-1000 text-balance sm:text-[2.75rem] sm:leading-[1.05]">
          A New York studio obsessed with how your work is seen
        </h2>
        <p className="max-w-xl text-copy-16 text-gray-900 text-pretty sm:text-copy-18">
          Framing &amp; Display pairs master framers and fabricators with
          designers and architects. We help premium offices, galleries, and
          brands present art, product, and story with precision — and clients
          trust us because we own every step, from concept to installation.
        </p>

        <dl className="mt-2 flex flex-col">
          {STATS.map((stat, index) => (
            <div
              key={stat.label}
              className={`flex items-baseline justify-between gap-4 py-4 ${
                index > 0 ? 'border-t border-[var(--ds-gray-alpha-400)]' : ''
              }`}
            >
              <dt className="label-eyebrow text-gray-700">{stat.label}</dt>
              <dd className="font-editorial text-heading-32 text-gray-1000 tabular-nums">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="lg:col-span-6">
        <figure className="flex flex-col">
          <div className="relative aspect-[4/3] w-full overflow-hidden border border-[var(--ds-gray-alpha-400)]">
            <Image
              src="/images/studio-workshop.png"
              alt="Master framer's workbench with precision tools and premium moulding samples in a New York framing workshop"
              fill
              sizes="(min-width: 1024px) 48vw, 100vw"
              className="object-cover"
            />
          </div>
          <figcaption className="font-editorial mt-4 text-copy-16 italic text-gray-900">
            Our workshop, Lower Manhattan — every piece is built by hand and
            checked by eye.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
