import { timingSafeEqual } from 'node:crypto';

export function validCmsAuthorization(header: string | null, password: string): boolean {
  if (!password || !header?.startsWith('Basic ') || header.length > 1024) return false;
  let credentials: string;
  try {
    credentials = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const [user, supplied, extra] = credentials.split(':');
  if (user !== 'editor' || supplied === undefined || extra !== undefined) return false;
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(password);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
