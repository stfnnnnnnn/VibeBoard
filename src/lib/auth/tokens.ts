import { randomBytes, createHash } from 'node:crypto';

export { RESET_TTL_MIN, VERIFY_TTL_MIN, RESEND_COOLDOWN_SEC } from './limits';

/** 32 random bytes, base64url (43 chars). Only ever emailed; the DB stores hashToken(t). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}
