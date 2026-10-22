import './workboard.css';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ensureWorkboardSchema, ensureWorkboardV4Schema } from '@/lib/migrate';
import { getWorkboardWeek, mondayOf, todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';
import { getWorkItems } from '@/lib/workboard/workItems';
import { computeStats, computeWorkloadChart } from '@/lib/workboard/workStats';
import WorkboardShell from '@/components/workboard/WorkboardShell';

export default async function WorkboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  await ensureWorkboardSchema();
  // v4 chains v3, which chains v2. getWorkItems below reads v3 columns and tables
  // (work_stage, deadline_time, life_area, organization_id, and the link/subtask
  // counts) plus v4's overlay blocked_reason/blocked_since, so anything older would
  // 500 this page on a fresh database.
  await ensureWorkboardV4Schema();

  const userId    = parseInt(session.user.id);
  const weekStart = mondayOf(todayInManilaAsUtcDate());
  const week      = await getWorkboardWeek(userId, weekStart);
  const payload   = await getWorkItems(userId);

  return (
    <WorkboardShell
      initialWeek={week}
      initialWork={{
        ...payload,
        week_start: weekStart,
        stats:    computeStats(payload.items, payload.generated_at, weekStart),
        workload: computeWorkloadChart(payload.items, weekStart),
      }}
    />
  );
}
