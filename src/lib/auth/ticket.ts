/* The sign-up ticket (spec D12): Google's verified identity, sealed with Auth.js's JWE encode (AUTH_SECRET,
   own salt), lives 15 minutes in an httpOnly cookie. Only our route handlers set or clear the cookie. */
import { encode, decode } from 'next-auth/jwt';

export interface SignupTicket { sub: string; email: string; given_name: string; family_name: string; picture: string | null }

export const TICKET_COOKIE = 'vb_signup_ticket';
export const TICKET_MAX_AGE = 900;
const SALT = 'vb-signup-ticket';

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

export function sealTicket(t: SignupTicket): Promise<string> {
  return encode({ token: { ...t }, secret: secret(), salt: SALT, maxAge: TICKET_MAX_AGE });
}

export async function openTicket(value: string | null | undefined): Promise<SignupTicket | null> {
  if (!value) return null;
  try {
    const p = await decode({ token: value, secret: secret(), salt: SALT });
    if (!p || typeof p.sub !== 'string' || typeof p.email !== 'string') return null;
    return {
      sub: p.sub,
      email: p.email,
      given_name: typeof p.given_name === 'string' ? p.given_name : '',
      family_name: typeof p.family_name === 'string' ? p.family_name : '',
      picture: typeof p.picture === 'string' ? p.picture : null,
    };
  } catch {
    return null; // expired, tampered, or wrong secret
  }
}

export const ticketCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: TICKET_MAX_AGE,
};

/** Reads the ticket cookie from a raw Cookie header (Auth.js authorize() receives the Request). */
export function ticketFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === TICKET_COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}
