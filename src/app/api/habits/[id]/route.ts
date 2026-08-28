import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema } from '@/lib/migrate';
import { updateHabit, deleteHabit, HabitNotFoundError, type HabitInput } from '@/lib/habits';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  const { id } = await params;
  const habitId = parseInt(id);

  try {
    const body = (await req.json()) as HabitInput;
    await updateHabit(parseInt(session.user.id), habitId, body);
    return Response.json({ status: 'success' });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    const message = err instanceof SyntaxError ? 'Invalid request body.' : (err as Error).message;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  const { id } = await params;
  const habitId = parseInt(id);

  try {
    await deleteHabit(parseInt(session.user.id), habitId);
    return Response.json({ status: 'success' });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
