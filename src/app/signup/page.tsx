'use client';

import { Suspense, useState, useEffect, FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, CheckCircle } from 'lucide-react';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="shrink-0">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

/* ── Static data ───────────────────────────────────────────── */

const PROGRAMS = [
  {
    group: 'College of Computer Science',
    options: [{ value: 'BSCS', label: 'BS Computer Science' }],
  },
  {
    group: 'College of Information Technology',
    options: [{ value: 'BSIT', label: 'BS Information Technology' }],
  },
  {
    group: 'College of Multimedia Arts',
    options: [{ value: 'BMMA', label: 'BS Multimedia Arts' }],
  },
  {
    group: 'College of Cybersecurity',
    options: [{ value: 'BSCyber', label: 'BS Cybersecurity' }],
  },
  {
    group: 'College of Digital Marketing',
    options: [{ value: 'BSDMM', label: 'BS Digital Marketing and Management' }],
  },
  {
    group: 'College of Financial Technology',
    options: [{ value: 'BSFTE', label: 'BS Financial Technology Engineering' }],
  },
  {
    group: 'College of Rehabilitation Sciences',
    options: [{ value: 'BSPT', label: 'BS Physical Therapy' }],
  },
  {
    group: 'School of Dentistry',
    options: [
      { value: 'DMD-General',       label: 'DMD – General Dentistry' },
      { value: 'DMD-Orthodontics',  label: 'DMD – Orthodontics' },
      { value: 'DMD-Prosthodontics',label: 'DMD – Prosthodontics' },
      { value: 'DMD-Endodontics',   label: 'DMD – Endodontics' },
      { value: 'DMD-Periodontics',  label: 'DMD – Periodontics' },
      { value: 'DMD-Pediatric',     label: 'DMD – Pediatric Dentistry' },
      { value: 'DMD-OralSurgery',   label: 'DMD – Oral Surgery' },
      { value: 'DMD-Pathology',     label: 'DMD – Oral Pathology' },
      { value: 'DMD-PublicHealth',  label: 'DMD – Public Health Dentistry' },
      { value: 'DMD-Radiology',     label: 'DMD – Oral & Maxillofacial Radiology' },
    ],
  },
  {
    group: 'College of Medical Technology',
    options: [{ value: 'BSMT', label: 'BS Medical Technology' }],
  },
  {
    group: 'College of Optometry',
    options: [{ value: 'DO', label: 'Doctor of Optometry' }],
  },
  {
    group: 'Institute of Health Sciences & Nursing',
    options: [{ value: 'BSN', label: 'BS Nursing' }],
  },
];

const PROGRAM_SPECS: Record<string, string[]> = {
  BSCS:               ['Artificial Intelligence', 'Data Science', 'Software Engineering'],
  BSIT:               ['Cybersecurity', 'Web and Mobile Application', 'Animation and Game Development', 'Business Analytics'],
  BMMA:               ['No Specialization'],
  BSCyber:            ['No Specialization'],
  BSDMM:             ['No Specialization'],
  BSFTE:              ['No Specialization'],
  BSPT:               ['No Specialization'],
  'DMD-General':       ['No Specialization'],
  'DMD-Orthodontics':  ['No Specialization'],
  'DMD-Prosthodontics':['No Specialization'],
  'DMD-Endodontics':   ['No Specialization'],
  'DMD-Periodontics':  ['No Specialization'],
  'DMD-Pediatric':     ['No Specialization'],
  'DMD-OralSurgery':   ['No Specialization'],
  'DMD-Pathology':     ['No Specialization'],
  'DMD-PublicHealth':  ['No Specialization'],
  'DMD-Radiology':     ['No Specialization'],
  BSMT:               ['No Specialization'],
  DO:                 ['No Specialization'],
  BSN:                ['No Specialization'],
};

/* ── Component ─────────────────────────────────────────────── */

type Fields = {
  first_name: string; middle_name: string; surname: string;
  dateofbirth: string; email: string;
  year_level: string; status: string; program: string; specialization: string;
  password: string; confirm: string;
};

const EMPTY: Fields = {
  first_name: '', middle_name: '', surname: '', dateofbirth: '',
  email: '', year_level: '', status: '', program: '', specialization: '',
  password: '', confirm: '',
};

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="vb-bg min-h-screen" />}>
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  // Arrived here because "Continue with Google" found no matching account —
  // pre-fill what Google already told us and collect the rest below.
  const isGoogleFlow = searchParams.get('google') === '1';
  const googleEmail  = searchParams.get('email') ?? '';
  const googleName   = searchParams.get('name') ?? '';

  const [form,        setForm]       = useState<Fields>(() => {
    if (!isGoogleFlow) return EMPTY;
    const parts = googleName.trim().split(/\s+/).filter(Boolean);
    return {
      ...EMPTY,
      email:      googleEmail,
      first_name: parts[0] ?? '',
      surname:    parts.slice(1).join(' '),
    };
  });
  const [specs,       setSpecs]      = useState<string[]>([]);
  const [showPwd,     setShowPwd]    = useState(false);
  const [showConfirm, setShowConf]   = useState(false);
  const [loading,     setLoading]    = useState(false);
  const [error,       setError]      = useState('');
  const [success,     setSuccess]    = useState(false);

  // Update specializations when program changes
  useEffect(() => {
    const newSpecs = PROGRAM_SPECS[form.program] ?? [];
    setSpecs(newSpecs);
    const auto = newSpecs.length === 1 && newSpecs[0] === 'No Specialization'
      ? 'No Specialization' : '';
    setForm((f) => ({ ...f, specialization: auto }));
  }, [form.program]);

  function handle(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isGoogleFlow && form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');

    const res  = await fetch('/api/auth/signup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...form, google: isGoogleFlow }),
    });
    const data = await res.json();

    if (!res.ok) {
      setLoading(false);
      setError(data.error || 'Something went wrong. Please try again.');
      return;
    }

    setSuccess(true);

    if (isGoogleFlow) {
      // Account now exists — finish the Google sign-in that brought them here.
      signIn('google', { callbackUrl: '/dashboard' });
    } else {
      setLoading(false);
      setTimeout(() => router.push('/login'), 3000);
    }
  }

  if (success) {
    return (
      <div className="vb-bg min-h-screen flex items-center justify-center px-4">
        <div className="glass-strong rounded-3xl shadow-2xl p-12 text-center max-w-sm w-full animate-fade-in-up">
          <CheckCircle size={56} className="text-vb-pink-400 mx-auto mb-4" strokeWidth={1.5} />
          <h2 className="font-dm-sans font-bold text-2xl gradient-text mb-2">Account Created!</h2>
          <p className="text-gray-500 text-sm">
            {isGoogleFlow ? 'Signing you in with Google…' : 'Redirecting you to login…'}
          </p>
        </div>
      </div>
    );
  }

  const label = (text: string, required = true) => (
    <span className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
      {text}{required && <span className="text-vb-pink-400 ml-0.5">*</span>}
    </span>
  );

  return (
    <div className="vb-bg min-h-screen flex items-center justify-center px-4 py-14">
      <div className="glass-strong rounded-3xl shadow-2xl w-full max-w-lg p-10 animate-fade-in-up">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="font-dm-sans font-bold text-4xl mb-2 select-none">
            <span className="text-vb-pink-400">Vibe</span>
            <span className="text-vb-blue-400">Board</span>
          </div>
          <p className="text-gray-500 text-sm font-medium">
            {isGoogleFlow ? 'Finish Setting Up Your Account' : 'Create Your Account'}
          </p>
        </div>

        {isGoogleFlow ? (
          <div className="mb-6 p-4 rounded-2xl bg-vb-blue-50/70 border border-vb-blue-200/70 flex items-start gap-3">
            <div className="shrink-0 w-9 h-9 rounded-full bg-white flex items-center justify-center shadow-sm">
              <GoogleIcon />
            </div>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-semibold text-gray-700">No account found</p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                <span className="font-medium text-gray-600">{googleEmail}</span> isn&apos;t registered
                yet — finish a few details below to create your account.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Google sign-up */}
            <button
              type="button"
              onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
              className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl
                         glass border border-white/40 font-semibold text-sm text-gray-700
                         hover:bg-white/50 transition-colors mb-5"
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="flex-1 h-px bg-gray-300/60" />
              <span className="text-xs text-gray-400 font-medium">or fill in the form</span>
              <div className="flex-1 h-px bg-gray-300/60" />
            </div>
          </>
        )}

        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-red-50/80 border border-red-200 text-red-600 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              {label('First Name')}
              <input name="first_name" type="text" required value={form.first_name}
                onChange={handle} placeholder="Juan" className="vb-input" />
            </div>
            <div>
              {label('Surname')}
              <input name="surname" type="text" required value={form.surname}
                onChange={handle} placeholder="Dela Cruz" className="vb-input" />
            </div>
          </div>

          {/* Middle name + DOB */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              {label('Middle Name', false)}
              <input name="middle_name" type="text" value={form.middle_name}
                onChange={handle} placeholder="Optional" className="vb-input" />
            </div>
            <div>
              {label('Date of Birth')}
              <input name="dateofbirth" type="date" required value={form.dateofbirth}
                onChange={handle} className="vb-input" />
            </div>
          </div>

          {/* Email */}
          <div>
            {label('University Email')}
            <input name="email" type="email" required value={form.email}
              onChange={handle} placeholder="yourname@fit.edu.ph" className="vb-input"
              readOnly={isGoogleFlow}
              disabled={isGoogleFlow}
              title={isGoogleFlow ? 'Locked to your Google account email' : undefined} />
          </div>

          {/* Year level + status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              {label('Year Level')}
              <select name="year_level" required value={form.year_level} onChange={handle} className="vb-input">
                <option value="" disabled>Select</option>
                {['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', '6th Year'].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              {label('Status')}
              <select name="status" required value={form.status} onChange={handle} className="vb-input">
                <option value="" disabled>Select</option>
                {['Regular', 'Irregular'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Program */}
          <div>
            {label('Program')}
            <select name="program" required value={form.program} onChange={handle} className="vb-input">
              <option value="" disabled>Select your program</option>
              {PROGRAMS.map(({ group, options }) => (
                <optgroup key={group} label={group}>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Specialization */}
          {specs.length > 0 && (
            <div>
              {label('Specialization')}
              <select name="specialization" required value={form.specialization} onChange={handle} className="vb-input"
                disabled={specs.length === 1 && specs[0] === 'No Specialization'}>
                <option value="" disabled>Select specialization</option>
                {specs.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}

          {/* Password — not needed for Google sign-ups, which authenticate via Google */}
          {!isGoogleFlow && (
            <>
              <div>
                {label('Password')}
                <div className="relative">
                  <input name="password" type={showPwd ? 'text' : 'password'} required minLength={8}
                    value={form.password} onChange={handle} placeholder="Min. 8 characters" className="vb-input pr-11" />
                  <button type="button" onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={showPwd ? 'Hide' : 'Show'}>
                    {showPwd ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              {/* Confirm */}
              <div>
                {label('Confirm Password')}
                <div className="relative">
                  <input name="confirm" type={showConfirm ? 'text' : 'password'} required
                    value={form.confirm} onChange={handle} placeholder="Repeat password" className="vb-input pr-11" />
                  <button type="button" onClick={() => setShowConf(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={showConfirm ? 'Hide' : 'Show'}>
                    {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>
            </>
          )}

          <button type="submit" disabled={loading} className="vb-btn-pink mt-2">
            {loading
              ? (isGoogleFlow ? 'Setting up…' : 'Creating account…')
              : (isGoogleFlow ? 'Finish with Google' : 'Create Account')}
          </button>
        </form>

        {!isGoogleFlow && (
          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link href="/login" className="text-vb-blue-500 font-semibold hover:underline">
              Log in here
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
