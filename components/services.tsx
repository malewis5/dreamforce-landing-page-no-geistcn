import type { JSX } from 'react';
import Image from 'next/image';
import { ButtonLink } from './ui/controls';

const SERVICES = [
  {
    name: 'Custom framing',
    description:
      'Considered mouldings, conservation-grade materials, and precise craftsmanship for individual artworks or an entire collection.',
  },
  {
    name: 'Display design',
    description:
      'Layouts, materials, and display concepts shaped around your space, your objects, and the story you want to tell.',
  },
  {
    name: 'Custom fabrication',
    description:
      'Bespoke display cases, mounts, and frames built by hand in our New York workshop to bring the design to life.',
  },
  {
    name: 'On-site installation',
    description:
      'Careful placement and white-glove installation by our team, so every element feels at home in the finished space.',
  },
] as const;

export function Services(): JSX.Element {
  return (
    <section
      id="services"
      aria-labelledby="services-heading"
      className="relative scroll-mt-24 py-20 before:absolute before:-inset-x-5 before:top-0 before:border-t before:border-[var(--ds-gray-alpha-400)] before:content-[''] sm:py-28 sm:before:inset-x-0"
    >
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="flex flex-col gap-6 lg:col-span-6">
          <span className="label-eyebrow text-gray-700">Services</span>
          <h2
            id="services-heading"
            className="font-editorial max-w-xl text-heading-32 text-gray-1000 text-balance sm:text-[2.75rem] sm:leading-[1.05]"
          >
            From a single frame to a complete display
          </h2>
          <p className="max-w-xl text-copy-16 text-gray-900 text-pretty sm:text-copy-18">
            We do more than frame individual pieces. We design, build, and
            install complete displays for offices, galleries, and brands —
            bringing the whole project together, from concept to installation.
          </p>
          <div>
            <ButtonLink href="#contact" variant="primary">
              Discuss your project
            </ButtonLink>
          </div>
        </div>

        <figure className="flex flex-col lg:col-span-6">
          <div className="relative aspect-[4/3] w-full overflow-hidden border border-[var(--ds-gray-alpha-400)]">
            <Image
              src="/images/display-case.png"
              alt="Custom display case showcasing carefully arranged objects"
              fill
              sizes="(min-width: 1024px) 48vw, 100vw"
              className="object-cover"
            />
          </div>
          <figcaption className="font-editorial mt-4 text-copy-16 italic text-gray-900">
            Framing, fabrication, and display — considered as one complete project.
          </figcaption>
        </figure>
      </div>

      <ul className="mt-12 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {SERVICES.map((service) => (
          <li
            key={service.name}
            className="flex flex-col gap-3 border-t border-[var(--ds-gray-alpha-400)] py-8"
          >
            <h3 className="font-editorial text-heading-24 text-gray-1000">
              {service.name}
            </h3>
            <p className="max-w-xl text-copy-14 text-gray-900 text-pretty sm:text-copy-16">
              {service.description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
