import { auth } from '@/auth';
import { ensureWorkboardV4Schema } from '@/lib/migrate';
import { getWorkItems } from '@/lib/workboard/workItems';
import { computeStats, computeWorkloadChart } from '@/lib/workboard/workStats';
import { mondayOf, todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  // v4 chains v3 and v2; getWorkItems reads the overlay's v4 blocked_reason/blocked_since.
  await ensureWorkboardV4Schema();

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
