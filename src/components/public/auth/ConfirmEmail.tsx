'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { MailCheck, MailX } from 'lucide-react';
import ResendVerify from '@/components/public/auth/ResendVerify';
import { confirmEmail, type ConfirmState } from '@/app/(public)/verify-email/actions';

/* /verify-email states (spec §4.7). Opening the link only shows the button; the POST confirms. */
export default function ConfirmEmail({ token, email, signedIn }: { token: string; email: string; signedIn: boolean }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmEmail, { status: 'idle' });
  if (state.status === 'ok') return <EmailConfirmed />;
  if (state.status === 'expired') return <EmailExpired signedIn={signedIn} />;
  return (
    <>
      <div className="auth-badge auth-badge--green"><MailCheck size={24} aria-hidden="true" /></div>
      <h1 className="auth-h1">Confirm your email.</h1>
      <p className="auth-sub">For <b>{email}</b></p>
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="auth-btn" disabled={pending}>{pending ? 'Confirming…' : 'Confirm my email'}</button>
      </form>
    </>
  );
}

export function EmailConfirmed() {
  return (
    <>
      <div className="auth-badge auth-badge--green"><MailCheck size={24} aria-hidden="true" /></div>
      <h1 className="auth-h1">Email confirmed.</h1>
      <p className="auth-sub">You can always reset your password now.</p>
      <Link href="/dashboard" className="auth-btn">Open my board</Link>
    </>
  );
}

export function EmailExpired({ signedIn }: { signedIn: boolean }) {
  return signedIn ? (
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
  );
}
