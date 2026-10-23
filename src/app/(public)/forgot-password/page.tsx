import Link from 'next/link';
import type { Metadata } from 'next';
import AuthShell from '@/components/public/auth/AuthShell';
import ForgotForm from '@/components/public/auth/ForgotForm';

export const metadata: Metadata = { title: 'Reset your password · VibeBoard' };

export default function ForgotPage() {
  return (
    <AuthShell topRight={<Link href="/login" className="auth-switch">← <b>Back to log in</b></Link>}>
      <ForgotForm />
    </AuthShell>
  );
}
