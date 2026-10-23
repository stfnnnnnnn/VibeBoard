'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { ArrowRight, User } from 'lucide-react';
import Field from './Field';
import YearPicker from './YearPicker';
import FormAlert from './FormAlert';
import { cleanName, nameError, type YearOption } from '@/lib/auth/validate';

export interface FinishIdentity { email: string; given_name: string; family_name: string; picture: string | null }

export default function FinishForm({ identity }: { identity: FinishIdentity }) {
  const router = useRouter();
  const [first, setFirst] = useState(identity.given_name);
  const [last, setLast] = useState(identity.family_name);
  const [year, setYear] = useState<YearOption | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fErr = touched ? nameError(cleanName(first), 'first name') : null;
  const lErr = touched ? nameError(cleanName(last), 'last name') : null;
  const hello = cleanName(first) || 'there';

  async function cancel() {
    await fetch('/api/auth/signup-ticket', { method: 'DELETE' });
    router.push('/login');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (nameError(cleanName(first), 'first name') || nameError(cleanName(last), 'last name')) return;
    setBusy(true); setError(null);
    const r = await signIn('google-finish', { first_name: first, last_name: last, year: year ?? '', redirect: false });
    if (r?.ok && !r.error) {
      await fetch('/api/auth/signup-ticket', { method: 'DELETE' });
      router.push('/dashboard'); router.refresh();
      return;
    }
    setBusy(false);
    if (r?.code === 'ticket') { router.push('/signup?e=ticket'); return; }
    setError(r?.code === 'name' ? 'Check your name. Letters, spaces, apostrophes, periods and hyphens only.' : 'Something went wrong. Please try again.');
  }

  return (
    <>
      <div className="auth-steps" aria-hidden="true"><i className="on" /><i className="on" /></div>
      <h1 className="auth-h1">Nice to meet you, <em>{hello}.</em></h1>
      <p className="auth-sub">Check these details and you&apos;re in.</p>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <div className="auth-ident">
        {identity.picture
          // eslint-disable-next-line @next/next/no-img-element -- Google avatar host isn't in next/image config; tiny, decorative.
          ? <img src={identity.picture} alt="" referrerPolicy="no-referrer" />
          : <span className="auth-avatar" aria-hidden="true">{identity.email.charAt(0).toUpperCase()}</span>}
        <div className="who"><b>{identity.email}</b><span>✓ Verified by Google</span></div>
        <button type="button" className="auth-link auth-link--quiet" onClick={cancel}>Not you?</button>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <div className="auth-row2">
          <Field id="first_name" label="First name" icon={User} value={first} onChange={setFirst} onBlur={() => setTouched(true)} autoComplete="given-name" error={fErr} required />
          <Field id="last_name" label="Last name" value={last} onChange={setLast} onBlur={() => setTouched(true)} autoComplete="family-name" error={lErr} required />
        </div>
        <div className="auth-field">
          <p className="auth-label" id="year-label"><span>What year are you in?</span><span className="opt">Optional</span></p>
          <YearPicker value={year} onChange={setYear} />
          <p className="auth-hint">We&apos;ll pre-fill it when you add subjects.</p>
        </div>
        <button type="submit" className="auth-btn" disabled={busy}>{busy ? 'Opening your board…' : <>Open my board <ArrowRight size={18} aria-hidden="true" /></>}</button>
      </form>
      <p className="auth-fine">By continuing you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
    </>
  );
}
