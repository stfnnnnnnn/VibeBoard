import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/auth';
import AuthShell from '@/components/public/auth/AuthShell';
import FinishForm from '@/components/public/auth/FinishForm';
import { openTicket, TICKET_COOKIE } from '@/lib/auth/ticket';

export const metadata: Metadata = { title: 'Finish setting up · VibeBoard' };

export default async function FinishPage() {
  // DB-backed check (session_version): the edge middleware can't see revocations.
  if ((await auth())?.user) redirect('/dashboard');
  const ticket = await openTicket((await cookies()).get(TICKET_COOKIE)?.value);
  if (!ticket) redirect('/signup?e=ticket');
  return (
    <AuthShell topRight={null}>
      <FinishForm identity={{ email: ticket.email, given_name: ticket.given_name, family_name: ticket.family_name, picture: ticket.picture }} />
    </AuthShell>
  );
}
