'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Mail, MailCheck } from 'lucide-react';
import Field from './Field';
import FormAlert from './FormAlert';
import { cleanEmail, emailError } from '@/lib/auth/validate';
import { RESEND_COOLDOWN_SEC } from '@/lib/auth/limits';

export default function ForgotForm() {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => { try { const s = sessionStorage.getItem('vb-forgot-email'); if (s) setEmail(s); } catch { /* storage blocked */ } }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const err = touched ? emailError(cleanEmail(email)) : null;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setTouched(true);
    const clean = cleanEmail(email);
    if (emailError(clean)) return;
    setBusy(true); setFailed(false);
    try {
      await fetch('/api/auth/password/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: clean }) });
    } catch {
      // Network failure: never claim a link was sent. Return to (or stay on) the form with an error.
      setBusy(false); setSentTo(null); setCooldown(0); setFailed(true);
      return;
    }
    setBusy(false); setSentTo(clean); setCooldown(RESEND_COOLDOWN_SEC);
  }

  if (sentTo) {
    const m = Math.floor(cooldown / 60), s = String(cooldown % 60).padStart(2, '0');
    return (
      <>
        <div className="auth-badge auth-badge--blue"><MailCheck size={24} aria-hidden="true" /></div>
        <h1 className="auth-h1">Check your email.</h1>
        <p className="auth-sub" role="status">If an account exists for <b>{sentTo}</b>, a reset link is on its way. It works once and expires in <b>30 minutes</b>.</p>
        <button type="button" className="auth-btn auth-btn--ghost" disabled={cooldown > 0 || busy} onClick={() => send()}>
          {cooldown > 0 ? `Resend in ${m}:${s}` : busy ? 'Sending…' : 'Resend link'}
        </button>
        <p className="auth-fine">Not seeing it? Check spam, or <button type="button" className="auth-link" onClick={() => { setSentTo(null); setCooldown(0); }}>use a different email</button>.</p>
      </>
    );
  }
  return (
    <>
      <div className="auth-badge auth-badge--pink"><KeyRound size={24} aria-hidden="true" /></div>
      <h1 className="auth-h1">Forgot your password?</h1>
      <p className="auth-sub">Enter your email and we&apos;ll send you a link to set a new one.</p>
      {failed && <FormAlert tone="error">We couldn&apos;t reach the server. Check your connection and try again.</FormAlert>}
      <form onSubmit={send} noValidate>
        <Field id="email" label="Email" icon={Mail} type="email" value={email} onChange={setEmail} onBlur={() => setTouched(true)}
          autoComplete="email" inputMode="email" placeholder="you@school.edu.ph" error={err} required />
        <button type="submit" className="auth-btn" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <p className="auth-fine">Signed up with Google? Just use <b>Continue with Google</b> on the login page.</p>
    </>
  );
}
