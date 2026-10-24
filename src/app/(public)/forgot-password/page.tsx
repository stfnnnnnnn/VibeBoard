import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import AuthShell from '@/components/public/auth/AuthShell';
import ForgotForm from '@/components/public/auth/ForgotForm';

export const metadata: Metadata = { title: 'Reset your password · VibeBoard' };

export default async function ForgotPage() {
  // DB-backed check (session_version): the edge middleware can't see revocations.
  if ((await auth())?.user) redirect('/dashboard');
  return (
    <AuthShell topRight={<Link href="/login" className="auth-switch">← <b>Back to log in</b></Link>}>
      <ForgotForm />
    </AuthShell>
  );
}
