import { z } from 'zod';

// Shared browser/API limits keep the sales notification concise.
// The Slack formatter renders every accepted value without truncation.
export const CONTACT_LIMITS = { name: 60, company: 60, email: 320, message: 200 } as const;
export const TEAM_SIZES = ['1–10', '11–50', '51–200', '201–1,000', '1,000+'] as const;
export const BUDGETS = ['Under $10,000', '$10,000–$29,999', '$30,000–$50,000', 'Over $50,000', 'Not sure yet'] as const;

function singleLine(label: string, max: number) {
  return z.string().max(max, `${label} must be ${max} characters or fewer.`)
    .trim().min(1, `${label} is required.`)
    .regex(/^[^\r\n]+$/, `${label} must be on one line.`);
}

export const contactSubmissionSchema = z.object({
  name: singleLine('Full name', CONTACT_LIMITS.name),
  email: z.string().max(CONTACT_LIMITS.email, 'Email is too long.').trim()
    .pipe(z.email({ error: 'Enter a valid work email.' })),
  company: singleLine('Company', CONTACT_LIMITS.company),
  teamSize: z.enum(TEAM_SIZES, { error: 'Select a team size.' }),
  budget: z.enum(BUDGETS, { error: 'Select a budget.' }),
  message: z.string().max(CONTACT_LIMITS.message, 'Message must be 200 characters or fewer.')
    .trim().min(1, 'Tell us how we can help.'),
});

export type ContactSubmission = z.infer<typeof contactSubmissionSchema>;
