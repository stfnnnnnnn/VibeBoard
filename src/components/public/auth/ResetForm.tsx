'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { LockKeyhole } from 'lucide-react';
import PasswordField from './PasswordField';
import { passwordError } from '@/lib/auth/validate';

export default function ResetForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [touched, setTouched] = useState(false);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const err = touched ? passwordError(pw) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (passwordError(pw)) return;
    setBusy(true);
    const r = await signIn('password-reset', { token, password: pw, redirect: false });
    if (r?.ok && !r.error) { router.push('/dashboard'); router.refresh(); return; }
    setBusy(false);
    if (r?.code === 'reset-invalid') setExpired(true);
  }

  if (expired) return <ExpiredLink email={email} />;
  return (
    <>
      <div className="auth-badge auth-badge--green"><LockKeyhole size={24} aria-hidden="true" /></div>
      <h1 className="auth-h1">Set a new password.</h1>
      <p className="auth-sub">For <b>{email}</b></p>
      <form onSubmit={onSubmit} noValidate>
        {/* Hidden username helps password managers save the new password against the right account. */}
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <PasswordField id="password" label="New password" value={pw} onChange={setPw} onBlur={() => setTouched(true)}
          autoComplete="new-password" meter error={err} placeholder="At least 8 characters" />
        <button type="submit" className="auth-btn" disabled={busy}>{busy ? 'Saving…' : 'Save and log in'}</button>
      </form>
    </>
  );
}

export function ExpiredLink({ email }: { email?: string }) {
  return (
    <>
      <div className="auth-badge auth-badge--pink"><LockKeyhole size={24} aria-hidden="true" /></div>
      <h1 className="auth-h1">This link has expired.</h1>
      <p className="auth-sub">Reset links work once and last 30 minutes. Get a fresh one. It only takes a second.</p>
      <Link href="/forgot-password" className="auth-btn"
        onClick={() => { try { if (email) sessionStorage.setItem('vb-forgot-email', email); } catch { /* storage blocked */ } }}>
        Send a new link
      </Link>
    </>
  );
}
