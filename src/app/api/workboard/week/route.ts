import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardSchema } from '@/lib/migrate';
import { getWorkboardWeek, mondayOf } from '@/lib/workboard/aggregate';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardSchema();

  const userId = parseInt(session.user.id);
  const startParam = req.nextUrl.searchParams.get('start');
  const isValidDate = startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam) && !Number.isNaN(new Date(startParam).getTime());
  const weekStart = mondayOf(isValidDate ? new Date(`${startParam}T00:00:00Z`) : new Date());

  const week = await getWorkboardWeek(userId, weekStart);
  return Response.json(week);
}
