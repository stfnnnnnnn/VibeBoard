import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ensureWorkboardSchema, ensureWorkboardV2Schema } from '@/lib/migrate';
import { getWorkboardWeek, mondayOf, todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';
import { getWorkItems } from '@/lib/workboard/workItems';
import { computeStats, computeWorkloadChart } from '@/lib/workboard/workStats';
import WorkboardShell from '@/components/workboard/WorkboardShell';

export default async function WorkboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  await ensureWorkboardSchema();
  await ensureWorkboardV2Schema();

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
