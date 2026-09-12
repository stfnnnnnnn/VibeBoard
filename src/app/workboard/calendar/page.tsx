import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { auth } from '@/auth';
import { ensureWorkboardSchema, ensureWorkboardV3Schema } from '@/lib/migrate';
import { getWorkboardWeek, mondayOf, todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';
import WorkboardWeekView from '@/components/workboard/WorkboardWeekView';

/** Addendum §21: the week calendar's own route. §21 takes Calendar out of the Workboard's
 *  primary view selector because it overlaps Schedule, but v1's conflict warnings, workload
 *  heatmap and the Canvas announcement → `schedule_overrides` flow are rendered *only* by
 *  `WorkboardWeekView`, so removing the tab without this route would delete them from the
 *  product. The component is reused verbatim (same props, same data function) — this page is
 *  a second door onto the same room, not a second implementation of it. */
export default async function WorkboardCalendarPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  // The same pair, in the same order, as `/workboard`'s own page. This route's single query
  // (`getWorkboardWeek`) is v1-only, but the v3 ensure chains v2 and v1 internally and is
  // idempotent, so mirroring the sibling page costs nothing and keeps the two from drifting
  // into different schema guarantees on a fresh database.
  await ensureWorkboardSchema();
  await ensureWorkboardV3Schema();

  const userId    = parseInt(session.user.id);
  const weekStart = mondayOf(todayInManilaAsUtcDate());
  const week      = await getWorkboardWeek(userId, weekStart);

  return (
    <div className="vb-bg min-h-screen pb-10" style={{ padding: '40px 5%', fontFamily: "'Inter','DM Sans','Segoe UI',sans-serif" }}>
      <Link href="/workboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#5c6b80', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none', marginBottom: '14px' }}>
        <ArrowLeft size={15} /> Workboard
      </Link>

      {/* Deliberately a minimal shell: no stat cards, no context filter, no view selector. The
          page has exactly one thing in it, and repeating the Workboard's chrome here would
          re-raise the calendar to the peer-view status §21 is removing. */}
      <div style={{ marginBottom: '22px' }}>
        <h1 className="gradient-text" style={{ fontSize: '2.2rem', fontWeight: 700, margin: '0 0 4px' }}>Week Calendar</h1>
        <p style={{ margin: 0, color: '#5c6b80', fontSize: '0.95rem' }}>Classes, events, and deadlines for the week.</p>
      </div>

      <WorkboardWeekView initialWeek={week} />
    </div>
  );
}
