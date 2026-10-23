'use client';
import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Mail, User } from 'lucide-react';
import Field from './Field';
import PasswordField from './PasswordField';
import GoogleButton from './GoogleButton';
import FormAlert from './FormAlert';
import { cleanEmail, cleanName, emailError, nameError, passwordError } from '@/lib/auth/validate';
import { suggestEmail } from '@/lib/auth/emailTypo';

type Key = 'first_name' | 'last_name' | 'email' | 'password';

export default function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [v, setV] = useState({ first_name: '', last_name: '', email: '', password: '' });
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [serverErr, setServerErr] = useState<Partial<Record<Key, React.ReactNode>>>({});
  const [formErr, setFormErr] = useState<string | null>(params.get('e') === 'ticket' ? 'Your Google sign-in timed out. Please continue with Google again.' : null);
  const [taken, setTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const refs = { first_name: useRef<HTMLInputElement>(null), last_name: useRef<HTMLInputElement>(null), email: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null) };

  const clientErr = (k: Key): string | null => {
    if (k === 'first_name') return nameError(cleanName(v.first_name), 'first name');
    if (k === 'last_name') return nameError(cleanName(v.last_name), 'last name');
    if (k === 'email') return emailError(cleanEmail(v.email));
    return passwordError(v.password);
  };
  const shown = (k: Key) => serverErr[k] ?? (touched[k] ? clientErr(k) : null);
  const set = (k: Key) => (val: string) => { setV(p => ({ ...p, [k]: val })); setServerErr(p => ({ ...p, [k]: undefined })); if (k === 'email') setTaken(false); };
  const blur = (k: Key) => () => setTouched(p => ({ ...p, [k]: true }));
  const suggestion = touched.email && !emailError(cleanEmail(v.email)) ? suggestEmail(v.email.trim()) : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const keys: Key[] = ['first_name', 'last_name', 'email', 'password'];
    setTouched({ first_name: true, last_name: true, email: true, password: true });
    const firstBad = keys.find(k => clientErr(k));
    if (firstBad) { refs[firstBad].current?.focus(); return; }
    setBusy(true); setFormErr(null);
    let res: Response;
    try {
      res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
    } catch {
      setBusy(false); setFormErr('Something went wrong on our side. Please try again.');
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { errors?: Partial<Record<Key, string>>; code?: string; error?: string };
    if (res.status === 409 && data.code === 'email-taken') {
      setBusy(false); setTaken(true);
      setServerErr({ email: <>This email already has an account. <Link href="/login">Log in instead</Link> or <Link href="/forgot-password" onClick={() => { try { sessionStorage.setItem('vb-forgot-email', cleanEmail(v.email)); } catch { /* storage blocked */ } }}>reset your password</Link>.</> });
      refs.email.current?.focus();
      return;
    }
    if (!res.ok) {
      setBusy(false);
      if (data.errors) { setServerErr(data.errors); const k = keys.find(x => data.errors?.[x]); if (k) refs[k].current?.focus(); }
      else setFormErr(data.error ?? 'Something went wrong on our side. Please try again.');
      return;
    }
    // The account exists now; if the auto login fails for any reason, the login page is the way in.
    const r = await signIn('credentials', { email: cleanEmail(v.email), password: v.password, redirect: false }).catch(() => null);
    if (r?.ok && !r.error) { router.push('/dashboard'); router.refresh(); return; }
    router.push('/login');
  }

  return (
    <>
      <h1 className="auth-h1">Create your <em>board.</em></h1>
      <p className="auth-sub">Free for students. Takes under a minute.</p>
      {formErr && <FormAlert tone="error">{formErr}</FormAlert>}
      <GoogleButton />
      <div className="auth-or">or sign up with email</div>
      <form onSubmit={onSubmit} noValidate>
        <div className="auth-row2">
          <Field id="first_name" label="First name" icon={User} value={v.first_name} onChange={set('first_name')} onBlur={blur('first_name')}
            autoComplete="given-name" error={shown('first_name')} valid={touched.first_name && !shown('first_name')} inputRef={refs.first_name} required />
          <Field id="last_name" label="Last name" value={v.last_name} onChange={set('last_name')} onBlur={blur('last_name')}
            autoComplete="family-name" error={shown('last_name')} valid={touched.last_name && !shown('last_name')} inputRef={refs.last_name} required />
        </div>
        <Field id="email" label="Email" icon={Mail} type="email" value={v.email} onChange={set('email')} onBlur={blur('email')}
          autoComplete="email" inputMode="email" placeholder="you@school.edu.ph" inputRef={refs.email} required
          error={shown('email')} warn={!!suggestion && !taken} valid={touched.email && !shown('email') && !suggestion}
          hint={suggestion ? <>Did you mean <button type="button" onClick={() => setV(p => ({ ...p, email: suggestion }))}>{suggestion}</button>?</> : undefined} />
        <PasswordField id="password" label="Password" value={v.password} onChange={set('password')} onBlur={blur('password')}
          autoComplete="new-password" meter error={shown('password')} inputRef={refs.password} placeholder="At least 8 characters" />
        <button type="submit" className="auth-btn" disabled={busy}>{busy ? 'Creating your board…' : 'Create account'}</button>
      </form>
      <p className="auth-fine">By continuing you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
    </>
  );
}
