import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema } from '@/lib/migrate';
import { getHabitHistory, HabitNotFoundError } from '@/lib/habits';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();

  const { id } = await params;
  const habitId = parseInt(id);
  const weeksParam = req.nextUrl.searchParams.get('weeks');
  const weeks = weeksParam ? Math.min(52, Math.max(1, parseInt(weeksParam))) : 12;

  try {
    const history = await getHabitHistory(parseInt(session.user.id), habitId, weeks);
    return Response.json(history);
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
