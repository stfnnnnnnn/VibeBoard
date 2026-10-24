import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import AuthShell from '@/components/public/auth/AuthShell';
import SignupForm from '@/components/public/auth/SignupForm';

export const metadata: Metadata = { title: 'Create your account · VibeBoard' };

export default async function SignupPage() {
  // DB-backed check (session_version): the edge middleware can't see revocations.
  if ((await auth())?.user) redirect('/dashboard');
  return (
    <AuthShell topRight={<Link href="/login" className="auth-switch">Have an account? <b>Log in</b></Link>}>
      <Suspense fallback={null}><SignupForm /></Suspense>
    </AuthShell>
  );
}
