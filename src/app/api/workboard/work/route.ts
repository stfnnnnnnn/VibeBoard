import { auth } from '@/auth';
import { ensureWorkboardV2Schema, ensureWorkboardV3Schema } from '@/lib/migrate';
import { getWorkItems } from '@/lib/workboard/workItems';
import { computeStats, computeWorkloadChart } from '@/lib/workboard/workStats';
import { mondayOf, todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();
  await ensureWorkboardV3Schema();

  const userId    = parseInt(session.user.id);
  const payload   = await getWorkItems(userId);
  const weekStart = mondayOf(todayInManilaAsUtcDate());

  return Response.json({
    ...payload,
    week_start: weekStart,
    stats:      computeStats(payload.items, payload.generated_at, weekStart),
    workload:   computeWorkloadChart(payload.items, weekStart),
  });
}
