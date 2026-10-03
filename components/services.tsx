import type { JSX } from 'react';
import Image from 'next/image';

const SERVICES = [
  {
    name: 'Custom framing',
    description:
      'Considered frames, mounts, and glazing for individual artworks or entire collections, crafted to complement the work and the space.',
  },
  {
    name: 'Display design',
    description:
      'From gallery walls to bespoke display cases, we plan how art, objects, and products are presented — with materials and layouts that tell your story.',
  },
  {
    name: 'Fabrication',
    description:
      'Our workshop builds custom frames, cases, and display elements, bringing the design together with precise detailing and careful craftsmanship.',
  },
  {
    name: 'Installation',
    description:
      'We complete the project on-site, positioning and installing each piece with care so the whole display is ready to be seen.',
  },
] as const;

export function Services(): JSX.Element {
  return (
    <section
      id="services"
      aria-labelledby="services-heading"
      className="relative scroll-mt-24 py-20 before:absolute before:-inset-x-5 before:top-0 before:border-t before:border-[var(--ds-gray-alpha-400)] before:content-[''] sm:py-28 sm:before:inset-x-0"
    >
      <div className="mb-10 flex max-w-2xl flex-col gap-4">
        <span className="label-eyebrow text-gray-700">Services</span>
        <h2
          id="services-heading"
          className="font-editorial text-heading-32 text-gray-1000 text-balance sm:text-[2.75rem] sm:leading-[1.05]"
        >
          From a single frame to a complete display
        </h2>
        <p className="text-copy-16 text-gray-900 text-pretty sm:text-copy-18">
          Bring us one piece or the vision for an entire space. We design, build,
          and install framing and display projects — with one studio guiding
          every detail from concept to completion.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
        <figure className="flex flex-col lg:col-span-6">
          <div className="relative aspect-[4/3] w-full overflow-hidden border border-[var(--ds-gray-alpha-400)]">
            <Image
              src="/images/display-case.png"
              alt="Custom display case presenting objects in a carefully designed setting"
              fill
              sizes="(min-width: 1024px) 480px, 100vw"
              className="object-cover"
            />
          </div>
          <figcaption className="font-editorial mt-4 text-copy-16 italic text-gray-900">
            Framing, cases, and complete displays — considered as a whole.
          </figcaption>
        </figure>

        <ul className="flex flex-col border-t border-[var(--ds-gray-alpha-400)] lg:col-span-6">
          {SERVICES.map((service) => (
            <li
              key={service.name}
              className="flex flex-col gap-2 border-b border-[var(--ds-gray-alpha-400)] py-6"
            >
              <h3 className="font-editorial text-heading-24 text-gray-1000">
                {service.name}
              </h3>
              <p className="text-copy-14 text-gray-900 text-pretty sm:text-copy-16">
                {service.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
