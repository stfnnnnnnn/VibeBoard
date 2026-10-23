import Link from 'next/link';
import type { Metadata } from 'next';
import { MailCheck, MailX } from 'lucide-react';
import AuthShell from '@/components/public/auth/AuthShell';
import ResendVerify from '@/components/public/auth/ResendVerify';
import { auth } from '@/auth';
import { consumeVerifyToken } from '@/lib/auth/authTokens';

export const metadata: Metadata = { title: 'Confirm your email · VibeBoard', referrer: 'no-referrer' };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  const ok = (await consumeVerifyToken(token)) !== null;
  const signedIn = ok ? false : !!(await auth())?.user;
  return (
    <AuthShell topRight={null}>
      {ok ? (
        <>
          <div className="auth-badge auth-badge--green"><MailCheck size={24} aria-hidden="true" /></div>
          <h1 className="auth-h1">Email confirmed.</h1>
          <p className="auth-sub">You can always reset your password now.</p>
          <Link href="/dashboard" className="auth-btn">Open my board</Link>
        </>
      ) : signedIn ? (
        <>
          <div className="auth-badge auth-badge--pink"><MailX size={24} aria-hidden="true" /></div>
          <h1 className="auth-h1">This link has expired.</h1>
          <p className="auth-sub">Confirmation links last 24 hours and work once. We can send you a fresh one.</p>
          <ResendVerify />
          <Link href="/dashboard" className="auth-btn auth-btn--ghost">Open my board</Link>
        </>
      ) : (
        <>
          <div className="auth-badge auth-badge--pink"><MailX size={24} aria-hidden="true" /></div>
          <h1 className="auth-h1">This link has expired.</h1>
          <p className="auth-sub">Confirmation links last 24 hours and work once. Open your board and choose <b>Resend</b> on the banner to get a new one.</p>
          <Link href="/dashboard" className="auth-btn auth-btn--ghost">Open my board</Link>
        </>
      )}
    </AuthShell>
  );
}
