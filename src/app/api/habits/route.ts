import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema, ensureHabitTypeRemovedAndNoteRenamedSchema } from '@/lib/migrate';
import { getHabitsForUser, createHabit, type HabitInput } from '@/lib/habits';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();

  const habits = await getHabitsForUser(parseInt(session.user.id));
  return Response.json({ habits });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();

  try {
    const body = (await req.json()) as HabitInput;
    const habit_id = await createHabit(parseInt(session.user.id), body);
    return Response.json({ status: 'success', habit_id });
  } catch (err) {
    const message = err instanceof SyntaxError ? 'Invalid request body.' : (err as Error).message;
    return Response.json({ error: message }, { status: 400 });
  }
}
