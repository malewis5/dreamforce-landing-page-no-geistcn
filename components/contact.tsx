'use client';

import { useId, useState, type FormEvent, type JSX } from 'react';
import { Button, Input, Textarea, Select, Note } from './ui/controls';
import { BUDGETS, CONTACT_LIMITS, TEAM_SIZES, contactSubmissionSchema } from '../lib/contact';

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function Contact(): JSX.Element {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const nameId = useId();
  const emailId = useId();
  const companyId = useId();
  const sizeId = useId();
  const budgetId = useId();
  const messageId = useId();

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (status === 'submitting') return;

    const submission = contactSubmissionSchema.safeParse(
      Object.fromEntries(new FormData(e.currentTarget)),
    );
    if (!submission.success) {
      setErrorMessage(submission.error.issues[0]?.message ?? 'Check the form fields.');
      setStatus('error');
      return;
    }

    setErrorMessage('');
    setStatus('submitting');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission.data),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setErrorMessage(typeof result?.error === 'string'
          ? result.error : 'Unable to send your message. Please try again.');
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch {
      setErrorMessage('Unable to send your message. Please try again.');
      setStatus('error');
    }
  }

  return (
    <section
      id="contact"
      className="relative grid scroll-mt-24 grid-cols-1 gap-10 py-20 before:absolute before:-inset-x-5 before:top-0 before:border-t before:border-[var(--ds-gray-alpha-400)] before:content-[''] sm:py-28 sm:before:inset-x-0 lg:grid-cols-12"
    >
      <div className="flex flex-col gap-6 lg:col-span-5">
        <span className="label-eyebrow text-gray-700">Start a Project</span>
        <h2 className="font-editorial text-heading-32 text-gray-1000 text-balance sm:text-[2.75rem] sm:leading-[1.05]">
          Tell us about the space
        </h2>
        <p className="max-w-sm text-copy-16 text-gray-900 text-pretty sm:text-copy-18">
          Share a few details and we&apos;ll be in touch within one business
          day to schedule an on-site consultation.
        </p>

        <dl className="mt-2 flex flex-col border-t border-[var(--ds-gray-alpha-400)]">
          <div className="flex items-baseline justify-between gap-4 border-b border-[var(--ds-gray-alpha-400)] py-3">
            <dt className="label-eyebrow text-gray-700">Studio</dt>
            <dd className="text-copy-14 text-gray-1000">Lower Manhattan, NYC</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-b border-[var(--ds-gray-alpha-400)] py-3">
            <dt className="label-eyebrow text-gray-700">Email</dt>
            <dd className="text-copy-14 text-gray-1000">studio@framinganddisplay.com</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="label-eyebrow text-gray-700">Hours</dt>
            <dd className="text-copy-14 text-gray-1000">Mon–Fri, by appointment</dd>
          </div>
        </dl>
      </div>

      <div className="lg:col-span-7">
        {status === 'success' ? (
          <Note variant="success" fill>
            Thanks for reaching out. A member of our team will contact you
            shortly.
          </Note>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {status === 'error' && (
              <div role="alert">
                <Note variant="error" fill>
                  {errorMessage}
                </Note>
              </div>
            )}
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex-1">
                <Input
                  id={nameId}
                  name="name"
                  maxLength={CONTACT_LIMITS.name}
                  label="Full name"
                  placeholder="Jane Doe"
                  size="large"
                  required
                />
              </div>
              <div className="flex-1">
                <Input
                  id={emailId}
                  name="email"
                  maxLength={CONTACT_LIMITS.email}
                  typeName="email"
                  label="Work email"
                  placeholder="jane@company.com"
                  size="large"
                  required
                />
              </div>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex-1">
                <Input
                  id={companyId}
                  name="company"
                  maxLength={CONTACT_LIMITS.company}
                  label="Company"
                  placeholder="Company, Inc."
                  size="large"
                  required
                />
              </div>
              <div className="flex-1">
                <Select
                  id={sizeId}
                  name="teamSize"
                  label="Team size"
                  defaultValue=""
                  size="large"
                  required
                >
                  <option value="" disabled>
                    Select team size
                  </option>
                  {TEAM_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Select
              id={budgetId}
              name="budget"
              label="Framing & display budget (USD)"
              defaultValue=""
              size="large"
              required
            >
              <option value="" disabled>
                Select budget
              </option>
              {BUDGETS.map((budget) => (
                <option key={budget} value={budget}>
                  {budget}
                </option>
              ))}
            </Select>
            <Textarea
              id={messageId}
              name="message"
              maxLength={CONTACT_LIMITS.message}
              aria-describedby={`${messageId}-hint`}
              label="How can we help?"
              required
              placeholder="Share a bit about what you're looking to solve."
              rows={4}
            />
            <p id={`${messageId}-hint`} className="text-copy-14 text-gray-900">
              Up to {CONTACT_LIMITS.message} characters.
            </p>
            <div className="pt-1">
              <Button
                typeName="submit"
                size="large"
                loading={status === 'submitting'}
              >
                Send message
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
