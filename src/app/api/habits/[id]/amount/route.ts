import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema } from '@/lib/migrate';
import { setAmount, HabitNotFoundError } from '@/lib/habits';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();

  const { id } = await params;
  const habitId = parseInt(id);
  const { amount, date } = await req.json();
  const numAmount = Number(amount);

  try {
    const result = await setAmount(parseInt(session.user.id), habitId, numAmount, date);
    return Response.json({ status: 'success', ...result });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
