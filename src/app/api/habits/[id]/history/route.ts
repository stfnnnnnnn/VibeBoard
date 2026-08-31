import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema, ensureHabitTypeRemovedAndNoteRenamedSchema } from '@/lib/migrate';
import { getHabitHistory, HabitNotFoundError } from '@/lib/habits';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();

  const { id } = await params;
  const habitId = parseInt(id);
  const weeksParam = req.nextUrl.searchParams.get('weeks');
  const parsedWeeks = weeksParam ? parseInt(weeksParam) : NaN;
  const weeks = Number.isNaN(parsedWeeks) ? 12 : Math.min(52, Math.max(1, parsedWeeks));

  try {
    const history = await getHabitHistory(parseInt(session.user.id), habitId, weeks);
    return Response.json(history);
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
