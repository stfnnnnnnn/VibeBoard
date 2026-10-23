import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import AuthShell from '@/components/public/auth/AuthShell';
import SignupForm from '@/components/public/auth/SignupForm';

export const metadata: Metadata = { title: 'Create your account · VibeBoard' };

export default function SignupPage() {
  return (
    <AuthShell topRight={<Link href="/login" className="auth-switch">Have an account? <b>Log in</b></Link>}>
      <Suspense fallback={null}><SignupForm /></Suspense>
    </AuthShell>
  );
}
