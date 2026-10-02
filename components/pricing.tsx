import type { JSX } from 'react';
import { ButtonLink } from './ui/controls';

interface Phase {
  index: string;
  name: string;
  description: string;
}

const PHASES: Phase[] = [
  {
    index: '01',
    name: 'Consultation',
    description:
      'We visit the space, study the light and sightlines, and talk through the collection, the brand, and the story you want the walls to tell.',
  },
  {
    index: '02',
    name: 'Design & proposal',
    description:
      'You receive a considered layout, material and moulding recommendations, and a transparent, itemized quote — no templates, no guesswork.',
  },
  {
    index: '03',
    name: 'Fabrication',
    description:
      'Every frame and display is built by hand in our New York workshop using conservation-grade materials, glazing, and mounts.',
  },
  {
    index: '04',
    name: 'Installation',
    description:
      'Our team installs on-site with white-glove care, leaving the space finished, level, and ready to be seen.',
  },
];

export function Pricing(): JSX.Element {
  return (
    <section
      id="commission"
      className="relative scroll-mt-24 py-20 before:absolute before:-inset-x-5 before:top-0 before:border-t before:border-[var(--ds-gray-alpha-400)] before:content-[''] sm:py-28 sm:before:inset-x-0"
    >
      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
          <span className="label-eyebrow text-gray-700">The Commission</span>
          <h2 className="font-editorial text-heading-32 text-gray-1000 text-balance sm:text-[2.75rem] sm:leading-[1.05]">
            How a project comes together
          </h2>
          <p className="text-copy-16 text-gray-900 text-pretty sm:text-copy-18">
            Every engagement is bespoke. We don&apos;t sell packages — we take on
            a limited number of commissions and shape each one around the space,
            the work, and the people who will live with it.
          </p>
          <div className="mt-2">
            <ButtonLink href="#contact" variant="primary">
              Begin a commission
            </ButtonLink>
          </div>
        </div>

        <ol className="flex flex-col border-t border-[var(--ds-gray-alpha-400)]">
          {PHASES.map((phase) => (
            <li
              key={phase.index}
              className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-b border-[var(--ds-gray-alpha-400)] py-8"
            >
              <span className="font-editorial text-heading-24 text-gray-700 tabular-nums sm:text-heading-32">
                {phase.index}
              </span>
              <div className="flex flex-col gap-2">
                <h3 className="font-editorial text-heading-24 text-gray-1000">
                  {phase.name}
                </h3>
                <p className="max-w-xl text-copy-14 text-gray-900 text-pretty sm:text-copy-16">
                  {phase.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-12 flex flex-col gap-2 border-t border-[var(--ds-gray-alpha-400)] pt-6 sm:flex-row sm:items-baseline sm:justify-between">
        <span className="label-eyebrow text-gray-700">Investment</span>
        <p className="max-w-xl text-copy-14 text-gray-900 text-pretty sm:text-right sm:text-copy-16">
          Single-space commissions typically begin at{' '}
          <span className="text-gray-1000">$5,000</span>. Full framing and
          display programs generally range from{' '}
          <span className="text-gray-1000">$30,000 to $50,000</span>, quoted in
          full after the consultation.
        </p>
      </div>
    </section>
  );
}
