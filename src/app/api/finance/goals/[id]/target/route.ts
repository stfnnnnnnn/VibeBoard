import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';

/* POST /api/finance/goals/[id]/target — set or clear a goal's target date. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await params;
  const goalId = parseInt(id);

  const { target_date } = await req.json();
  const value: string | null = target_date || null;
  if (value !== null && isNaN(Date.parse(value))) {
    return Response.json({ error: 'Invalid date.' }, { status: 400 });
  }

  await pool.execute(
    `UPDATE savings_goals SET target_date = ? WHERE goal_id = ? AND user_id = ?`,
    [value, goalId, userId]
  );
  return Response.json({ status: 'success' });
}
