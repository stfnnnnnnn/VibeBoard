import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { ResultSetHeader } from 'mysql2';

const VALID_WISHLIST_CATEGORIES = ['gadgets', 'travel', 'education', 'fashion', 'hobbies', 'emergency', 'gifts', 'others'];

/* POST /api/finance/goals — create a new savings goal, optionally with a target date. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { goal_name, wishlist_amount, wishlist_category, target_date } = await req.json();
  const name = String(goal_name ?? '').trim();
  const amount = Number(wishlist_amount);
  const category = VALID_WISHLIST_CATEGORIES.includes(wishlist_category) ? wishlist_category : 'others';
  const targetDate = target_date || null;

  if (!name) return Response.json({ error: 'Goal name is required.' }, { status: 400 });
  if (!amount || amount <= 0) return Response.json({ error: 'Target amount must be greater than 0.' }, { status: 400 });
  if (targetDate && isNaN(Date.parse(targetDate))) return Response.json({ error: 'Invalid target date.' }, { status: 400 });

  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO savings_goals (user_id, goal_name, wishlist_amount, wishlist_category, target_date) VALUES (?, ?, ?, ?, ?)`,
    [userId, name, amount, category, targetDate]
  );
  return Response.json({ status: 'success', goal_id: res.insertId });
}

/* DELETE /api/finance/goals — remove a goal. Fails gracefully if it still has transactions logged against it. */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { goal_id } = await req.json();
  const goalId = parseInt(goal_id);
  if (!goalId) return Response.json({ error: 'Missing goal id.' }, { status: 400 });

  try {
    await pool.execute(`DELETE FROM savings_goals WHERE goal_id = ? AND user_id = ?`, [goalId, userId]);
    return Response.json({ status: 'success' });
  } catch {
    return Response.json({ error: 'This goal has transactions logged against it — remove those first, or leave the goal in place.' }, { status: 409 });
  }
}
