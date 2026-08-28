import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { resetStreak, HabitNotFoundError } from '@/lib/habits';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const habitId = parseInt(id);

  try {
    await resetStreak(parseInt(session.user.id), habitId);
    return Response.json({ status: 'success' });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
