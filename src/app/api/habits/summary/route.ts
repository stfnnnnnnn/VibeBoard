import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema, ensureHabitTypeRemovedAndNoteRenamedSchema, ensureHabitPauseSchema } from '@/lib/migrate';
import { getSummaryForUser } from '@/lib/habits';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();
  await ensureHabitPauseSchema();

  const summary = await getSummaryForUser(parseInt(session.user.id));
  return Response.json(summary);
}
