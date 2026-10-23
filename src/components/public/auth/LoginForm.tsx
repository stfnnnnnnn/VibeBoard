'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Check, Mail } from 'lucide-react';
import Field from './Field';
import PasswordField from './PasswordField';
import GooglePersonalized from './GooglePersonalized';
import DaypartGreeting from './DaypartGreeting';
import FormAlert from './FormAlert';

const URL_ERRORS: Record<string, string> = {
  'google-unverified': "Google didn't confirm that email address. Try another Google account, or log in with email.",
  'google-conflict': 'That email is already linked to a different Google account. Use that Google account, or log in with email.',
  OAuthAccountNotLinked: 'That email is already linked to a different Google account.',
  AccessDenied: "Google sign-in didn't finish. Please try again.",
  Configuration: "Google sign-in isn't available right now. Log in with email instead.",
};
const INVALID = "That email and password don't match. Check for typos, or continue with Google if that's how you signed up.";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const urlError = params.get('e') ?? params.get('error');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(urlError ? URL_ERRORS[urlError] ?? URL_ERRORS.AccessDenied : null);
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({});
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [done, setDone] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => { setNow(Date.now()); if (Date.now() >= lockedUntil) setLockedUntil(null); }, 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const succeed = () => {
    setDone(true);
    setTimeout(() => { router.push('/dashboard'); router.refresh(); }, 400);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || googleBusy || lockedUntil) return;
    if (!email.trim()) { setFieldErr({ email: 'Enter your email.' }); emailRef.current?.focus(); return; }
    if (!password) { setFieldErr({ password: 'Enter your password.' }); pwRef.current?.focus(); return; }
    setFieldErr({});
    setBusy(true); setError(null);
    const r = await signIn('credentials', { email, password, redirect: false });
    setBusy(false);
    if (r?.ok && !r.error) return succeed();
    const code = r?.code ?? '';
    if (code.startsWith('locked:')) { setLockedUntil(Date.now() + Number(code.slice(7)) * 1000); setNow(Date.now()); return; }
    setError(INVALID);
    setPassword('');
    pwRef.current?.focus();
  }

  async function onGoogleCredential(credential: string) {
    if (googleBusy) return;
    setGoogleBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/google-onetap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; code?: string };
      if (data.status === 'new') { router.push('/signup/finish'); return; }
      if (data.status === 'existing') {
        const r = await signIn('google-idtoken', { credential, redirect: false });
        if (r?.ok && !r.error) { succeed(); return; }
      }
      setError(URL_ERRORS[data.code ?? ''] ?? URL_ERRORS.AccessDenied);
    } catch {
      setError(URL_ERRORS.AccessDenied);
    }
    setGoogleBusy(false);
  }

  const secsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  const mins = Math.ceil(secsLeft / 60);
  const lockText = secsLeft >= 60 ? `${mins} ${mins === 1 ? 'minute' : 'minutes'}` : `${secsLeft} ${secsLeft === 1 ? 'second' : 'seconds'}`;

  return (
    <>
      <DaypartGreeting page="login" />
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {lockedUntil && (
        <FormAlert tone="warn">
          <span className="pub-sr">Too many attempts. Try again in a few minutes, or continue with Google.</span>
          <span aria-hidden="true">Too many attempts. Try again in <b>{lockText}</b>, or continue with Google.</span>
        </FormAlert>
      )}

      <GooglePersonalized onCredential={onGoogleCredential} />
      <p className="auth-center"><UseAnother /></p>

      <div className="auth-or">or log in with email</div>
      <form onSubmit={onSubmit} noValidate>
        <Field id="email" label="Email" icon={Mail} type="email" value={email}
          onChange={v => { setEmail(v); if (fieldErr.email) setFieldErr({}); }} error={fieldErr.email} inputRef={emailRef}
          autoComplete="email" inputMode="email" placeholder="you@school.edu.ph" required />
        <PasswordField id="password" label="Password" value={password}
          onChange={v => { setPassword(v); if (fieldErr.password) setFieldErr({}); }} error={fieldErr.password}
          autoComplete="current-password" inputRef={pwRef}
          labelAside={
            <Link href="/forgot-password" className="auth-link"
              onClick={() => { try { sessionStorage.setItem('vb-forgot-email', email); } catch { /* storage blocked */ } }}>
              Forgot password?
            </Link>
          } />
        <button type="submit" className="auth-btn" disabled={busy || googleBusy || !!lockedUntil || done}>
          {done ? <><Check size={18} aria-hidden="true" /> Logged in</> : busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </>
  );
}

/* "Use another account": the OAuth chooser, so a shared PC never reuses the last Google session silently. */
function UseAnother() {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="auth-link auth-link--quiet" disabled={busy}
      onClick={() => { setBusy(true); void signIn('google', { redirectTo: '/dashboard' }, { prompt: 'select_account' }); }}>
      Use another account
    </button>
  );
}
