'use server';
import { consumeVerifyToken } from '@/lib/auth/authTokens';

export type ConfirmState = { status: 'idle' | 'ok' | 'expired' };

/* The verify token is consumed only by this POST (a server action), never on GET: mail link scanners
   open links, and a scanner confirming an attacker-created account would defeat D11 (linkGoogle trusts
   the password of a verified account). */
export async function confirmEmail(_prev: ConfirmState, form: FormData): Promise<ConfirmState> {
  const token = String(form.get('token') ?? '').slice(0, 200);
  return { status: (await consumeVerifyToken(token)) !== null ? 'ok' : 'expired' };
}
