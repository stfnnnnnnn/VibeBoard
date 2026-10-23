import type { Metadata } from 'next';
import AuthShell from '@/components/public/auth/AuthShell';
import ResetForm, { ExpiredLink } from '@/components/public/auth/ResetForm';
import { peekToken } from '@/lib/auth/authTokens';

export const metadata: Metadata = { title: 'Set a new password · VibeBoard', referrer: 'no-referrer' };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const rec = await peekToken(token, 'reset');
  return (
    <AuthShell topRight={null}>
      {rec ? <ResetForm token={token} email={rec.email} /> : <ExpiredLink />}
    </AuthShell>
  );
}
