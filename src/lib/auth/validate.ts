/* Shared client + server validation for the auth forms (spec §3.3). Messages are user-facing copy. */
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} '.\-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MIN_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt ignores everything after 72 bytes

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
}

export function nameError(v: string, label: string): string | null {
  if (!v) return `Enter your ${label}.`;
  if (v.length > 100) return `${cap(label)} is too long.`;
  if (!NAME_RE.test(v)) return `${cap(label)} can only use letters, spaces, apostrophes, periods and hyphens.`;
  return null;
}

export function cleanEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

export function emailError(v: string): string | null {
  if (!v) return 'Enter your email.';
  if (v.length > 100) return 'That email is too long.';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email, like you@school.edu.ph.';
  return null;
}

export function passwordError(v: string): string | null {
  if (!v) return 'Enter a password.';
  if (v.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (new TextEncoder().encode(v).length > MAX_PASSWORD_BYTES) return 'Use 72 bytes or fewer (about 72 letters).';
  return null;
}

export const YEAR_OPTIONS = ['1st', '2nd', '3rd', '4th', '5th+'] as const;
export type YearOption = (typeof YEAR_OPTIONS)[number];

/** Maps the finish-page picker value to the user_login.year_level enum ('5th+' → '5th Year'). */
export function yearLevelFor(v: unknown): string | null {
  switch (v) {
    case '1st': return '1st Year';
    case '2nd': return '2nd Year';
    case '3rd': return '3rd Year';
    case '4th': return '4th Year';
    case '5th+': return '5th Year';
    default: return null;
  }
}
