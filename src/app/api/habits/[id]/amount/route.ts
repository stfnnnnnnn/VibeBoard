import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema, ensureHabitTypeRemovedAndNoteRenamedSchema } from '@/lib/migrate';
import { setAmount, HabitNotFoundError } from '@/lib/habits';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();

  const { id } = await params;
  const habitId = parseInt(id);

  try {
    const { amount, date } = await req.json();
    const numAmount = Number(amount);
    const result = await setAmount(parseInt(session.user.id), habitId, numAmount, date);
    return Response.json({ status: 'success', ...result });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    const message = err instanceof SyntaxError ? 'Invalid request body.' : (err as Error).message;
    return Response.json({ error: message }, { status });
  }
}
