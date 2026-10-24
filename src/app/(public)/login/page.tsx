import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import AuthShell from '@/components/public/auth/AuthShell';
import LoginForm from '@/components/public/auth/LoginForm';

export const metadata: Metadata = { title: 'Log in · VibeBoard' };

export default async function LoginPage() {
  // DB-backed check (session_version): the edge middleware can't see revocations.
  if ((await auth())?.user) redirect('/dashboard');
  return (
    <AuthShell topRight={<Link href="/signup" className="auth-switch">New here? <b>Sign up</b></Link>}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
