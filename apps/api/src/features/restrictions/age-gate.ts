import { AppError } from '../../lib/errors.js';

/** Media the source flags at or above this age is behind the confirmation gate, not the hard floor. */
export const ADULT_AGE = 18;

/** Sent with every request that touches 18+ media. Never stored, cached, queued or logged. */
export const BIRTHDATE_HEADER = 'x-birthdate';

const MIN_YEAR = 1900;

export interface Birthdate {
  year: number;
  month: number;
  day: number;
}

const utcParts = (now: Date) => ({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() });

/**
 * Strict `YYYY-MM-DD`: a real calendar date, not before 1900 and not after today (UTC).
 * Returns null for anything else, so a typo is never read as a different date.
 */
export function parseBirthdate(input: string, now: Date = new Date()): Birthdate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_YEAR) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  const today = utcParts(now);
  const afterToday =
    year > today.year ||
    (year === today.year && (month > today.month || (month === today.month && day > today.day)));
  return afterToday ? null : { year, month, day };
}

/** Whole years completed on `now` (UTC). A Feb 29 birthday counts as Mar 1 in a common year. */
export function ageOn(born: Birthdate, now: Date = new Date()): number {
  const today = utcParts(now);
  let age = today.year - born.year;
  if (today.month < born.month || (today.month === born.month && today.day < born.day)) age -= 1;
  return age;
}

/**
 * The per-request 18+ check. Media below 18 is never gated and the header is ignored. For 18+ media
 * the caller must send a birthdate every time; nothing remembers an earlier answer. Errors never
 * repeat the birthdate back.
 *
 * This is self-declared, not verified: it records what the user said, nothing more.
 */
export function assertAdultConfirmed(
  ageLimit: number,
  birthdate: string | null | undefined,
  now: Date = new Date(),
): void {
  if (ageLimit < ADULT_AGE) return;
  if (!birthdate) {
    throw new AppError(403, 'AGE_CONFIRMATION_REQUIRED', 'This media is for adults. Confirm your date of birth to continue.');
  }
  const born = parseBirthdate(birthdate, now);
  if (!born) {
    throw new AppError(400, 'INVALID_BIRTHDATE', 'Enter your date of birth as YYYY-MM-DD.');
  }
  if (ageOn(born, now) < ADULT_AGE) {
    throw new AppError(403, 'AGE_UNDER_18', 'You must be 18 or older to access this media.');
  }
}
