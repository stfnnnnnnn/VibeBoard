import type { Metadata } from 'next';
import AuthShell from '@/components/public/auth/AuthShell';
import ConfirmEmail, { EmailConfirmed, EmailExpired } from '@/components/public/auth/ConfirmEmail';
import { auth } from '@/auth';
import { peekToken } from '@/lib/auth/authTokens';
import { findById } from '@/lib/auth/users';

export const metadata: Metadata = { title: 'Confirm your email · VibeBoard', referrer: 'no-referrer' };

/* GET only peeks at the token; ConfirmEmail's button POSTs to consume it (see ./actions.ts). */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const rec = await peekToken(token, 'verify');
  const user = (await auth())?.user;
  const me = user?.id ? await findById(Number(user.id)).catch(() => null) : null;
  // The signed-in visitor is already confirmed and the link is theirs (or stale: used, or superseded by a resend): a success.
  const alreadyMine = !!me?.email_verified_at && (!rec || rec.user_id === me.user_id);
  return (
    <AuthShell topRight={null}>
      {alreadyMine ? <EmailConfirmed />
        : rec ? <ConfirmEmail token={token} email={rec.email} signedIn={!!user} />
        : <EmailExpired signedIn={!!user} />}
    </AuthShell>
  );
}
