import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema, ensureHabitTypeRemovedAndNoteRenamedSchema, ensureHabitPauseSchema } from '@/lib/migrate';
import { checkinHabit, undoCheckinHabit, HabitNotFoundError } from '@/lib/habits';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();
  await ensureHabitPauseSchema();
  const { id } = await params;
  const habitId = parseInt(id);

  try {
    const result = await checkinHabit(parseInt(session.user.id), habitId);
    return Response.json({ status: 'success', ...result });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();
  await ensureHabitPauseSchema();
  const { id } = await params;
  const habitId = parseInt(id);

  try {
    const result = await undoCheckinHabit(parseInt(session.user.id), habitId);
    return Response.json({ status: 'success', ...result });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
