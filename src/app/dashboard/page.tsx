import './dashboard.css';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { findById } from '@/lib/auth/users';
import { buildDashboardSummary, getHeaderData } from '@/lib/dashboard/summary';
import VerifyEmailBanner from '@/components/dashboard/VerifyEmailBanner';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import DashboardBody from '@/components/dashboard/DashboardBody';

/* Entrance motion plays once per session: repeat views get data-db-seen on <html> before paint
   (same pre-hydration pattern as (public)/layout's data-daypart; <html> has suppressHydrationWarning). */
const SEEN_SCRIPT = "try{if(sessionStorage.getItem('db-seen'))document.documentElement.setAttribute('data-db-seen','');else sessionStorage.setItem('db-seen','1')}catch(e){document.documentElement.setAttribute('data-db-seen','')}";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const userId = Number(session.user.id);

  // Not awaited: DashboardBody streams each live slot as this resolves. It never rejects.
  const summary = buildDashboardSummary(userId);
  // Fails open: if the lookup errors, the dashboard still renders (just without the verify banner).
  const [me, header] = await Promise.all([findById(userId).catch(() => null), getHeaderData(userId)]);
  const name = session.user.name ?? me?.first_name ?? 'Student';

  async function handleSignOut() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <div className="vb-bg">
      <script dangerouslySetInnerHTML={{ __html: SEEN_SCRIPT }} />
      <main className="db-page">
        {me && !me.email_verified_at && <VerifyEmailBanner />}
        <DashboardHeader
          firstName={name.split(' ')[0]}
          dateLine={header.dateLine}
          signOut={handleSignOut}
          profile={{
            name: me ? `${me.first_name} ${me.surname}`.trim() : name,
            email: me?.email ?? session.user.email ?? '',
            verified: Boolean(me?.email_verified_at),
            googleLinked: Boolean(me?.google_sub),
            canvasConnected: header.canvasConnected,
          }}
        />
        <DashboardBody summary={summary} />
      </main>
    </div>
  );
}
