import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import AuthShell from '@/components/public/auth/AuthShell';
import LoginForm from '@/components/public/auth/LoginForm';

export const metadata: Metadata = { title: 'Log in · VibeBoard' };

export default function LoginPage() {
  return (
    <AuthShell topRight={<Link href="/signup" className="auth-switch">New here? <b>Sign up</b></Link>}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
