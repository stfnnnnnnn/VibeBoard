/* One rule for every Google entry point (OAuth redirect, GIS button, finish page). Spec §4.2. */
import { findByEmail, findByGoogleSub, findById, linkGoogle, type AuthUser } from '@/lib/auth/users';
import type { GoogleIdentity } from '@/lib/auth/googleIdToken';
import type { SignupTicket } from '@/lib/auth/ticket';

export type GoogleOutcome =
  | { kind: 'user'; user: AuthUser }
  | { kind: 'new'; ticket: SignupTicket }
  | { kind: 'unverified' }
  | { kind: 'conflict' };

export async function resolveGoogle(id: GoogleIdentity): Promise<GoogleOutcome> {
  if (!id.email_verified) return { kind: 'unverified' };
  const bySub = await findByGoogleSub(id.sub);
  if (bySub) return { kind: 'user', user: bySub };
  const byEmail = await findByEmail(id.email);
  if (byEmail) {
    // The email is already linked to a different Google account: refuse rather than silently re-link.
    if (byEmail.google_sub && byEmail.google_sub !== id.sub) return { kind: 'conflict' };
    await linkGoogle(byEmail, id.sub);
    const linked = await findById(byEmail.user_id);
    return linked ? { kind: 'user', user: linked } : { kind: 'unverified' };
  }
  return {
    kind: 'new',
    ticket: { sub: id.sub, email: id.email, given_name: id.given_name, family_name: id.family_name, picture: id.picture },
  };
}
