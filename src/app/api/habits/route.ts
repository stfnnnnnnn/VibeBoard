import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema } from '@/lib/migrate';
import { getHabitsForUser, createHabit, type HabitInput } from '@/lib/habits';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();

  const habits = await getHabitsForUser(parseInt(session.user.id));
  return Response.json({ habits });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();

  const body = (await req.json()) as HabitInput;
  try {
    const habit_id = await createHabit(parseInt(session.user.id), body);
    return Response.json({ status: 'success', habit_id });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
