'use client';

import { useState, FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';

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

export default function LoginPage() {
  const router = useRouter();

  const [email,        setEmail]   = useState('');
  const [password,     setPassword] = useState('');
  const [showPassword, setShowPwd]  = useState(false);
  const [loading,      setLoading]  = useState(false);
  const [googleLoading, setGLoading] = useState(false);
  const [error,        setError]    = useState('');

  async function handleCredentials(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn('credentials', { email, password, redirect: false });
    setLoading(false);

    if (result?.error) {
      setError(
        result.error === 'CredentialsSignin'
          ? 'Incorrect email or password. Too many failed attempts lock the account for 10 minutes.'
          : 'Login failed. Please try again.',
      );
    } else {
      router.push('/dashboard');
    }
  }

  async function handleGoogle() {
    setGLoading(true);
    setError('');
    await signIn('google', { callbackUrl: '/dashboard' });
    // signIn with redirect=true (default) — page navigates away
  }

  return (
    <div className="vb-bg min-h-screen flex items-center justify-center px-4 py-12">
      <div className="glass-strong rounded-3xl shadow-2xl w-full max-w-md p-10 animate-fade-in-up">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="font-dm-sans font-bold text-4xl mb-2 select-none">
            <span className="text-vb-pink-400">Vibe</span>
            <span className="text-vb-blue-400">Board</span>
          </div>
          <p className="text-gray-500 text-sm font-medium">Access Your Account</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-red-50/80 border border-red-200 text-red-600 text-sm text-center">
            {error}
          </div>
        )}

        {/* Google */}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={googleLoading || loading}
          className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl
                     glass border border-white/40 font-semibold text-sm text-gray-700
                     hover:bg-white/50 active:bg-white/60 transition-colors
                     disabled:opacity-60 disabled:cursor-not-allowed mb-5"
        >
          <GoogleIcon />
          {googleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-gray-300/60" />
          <span className="text-xs text-gray-400 font-medium">or</span>
          <div className="flex-1 h-px bg-gray-300/60" />
        </div>

        {/* Credentials form */}
        <form onSubmit={handleCredentials} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
              University Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="yourname@fit.edu.ph"
              className="vb-input"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="vb-input pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading || googleLoading} className="vb-btn-pink mt-2">
            {loading ? 'Logging in…' : 'Log In with Email'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-vb-pink-500 font-semibold hover:underline">
            Sign up here
          </Link>
        </p>
      </div>
    </div>
  );
}
