import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { manilaToday } from '@/lib/finance/dates';
import pool from '@/lib/db';
import type { ResultSetHeader } from 'mysql2';

const EXPENSE_CATEGORIES = ['transportation', 'grocery', 'food', 'academic', 'family', 'leisure', 'emergency', 'miscellaneous', 'healthcare', 'utilities', 'donation'];

/* POST /api/finance/transactions — create a row in whichever table matches
   the type. Whether it counts as "already happened" (actual) or "upcoming"
   (planned) is derived from the date itself, not a separate toggle — a
   future date always means it hasn't happened yet, so there's nothing for
   the caller to get out of sync. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { type, amount, entry_date, category, goal_id } = await req.json();

  if (!['allowance', 'expense', 'savings'].includes(type)) {
    return Response.json({ error: 'Invalid type.' }, { status: 400 });
  }
  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0) {
    return Response.json({ error: 'Amount must be greater than 0.' }, { status: 400 });
  }
  if (!entry_date || isNaN(Date.parse(entry_date))) {
    return Response.json({ error: 'A valid date is required.' }, { status: 400 });
  }
  const today = manilaToday();
  const entryStatus = entry_date > today ? 'planned' : 'actual';

  if (type === 'allowance') {
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO allowance (user_id, entry_date, allowance_amount, categories, status) VALUES (?, ?, ?, 'initial allowance', ?)`,
      [userId, entry_date, numAmount, entryStatus]
    );
    return Response.json({ status: 'success', id: res.insertId });
  }

  if (type === 'expense') {
    if (!EXPENSE_CATEGORIES.includes(category)) {
      return Response.json({ error: 'Invalid expense category.' }, { status: 400 });
    }
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO expenses (user_id, category, expense_amount, entry_date, status) VALUES (?, ?, ?, ?, ?)`,
      [userId, category, numAmount, entry_date, entryStatus]
    );
    return Response.json({ status: 'success', id: res.insertId });
  }

  // savings
  const goalId = parseInt(goal_id);
  if (!goalId) return Response.json({ error: 'Select a savings goal.' }, { status: 400 });

  const [goalRows] = await pool.execute<import('mysql2').RowDataPacket[]>(
    `SELECT goal_id FROM savings_goals WHERE goal_id = ? AND user_id = ?`, [goalId, userId]
  );
  if (!goalRows.length) return Response.json({ error: 'Goal not found.' }, { status: 404 });

  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO savings_entries (user_id, goal_id, savings_amount, entry_date, categories, status) VALUES (?, ?, ?, ?, 'Future Allocation', ?)`,
    [userId, goalId, numAmount, entry_date, entryStatus]
  );
  return Response.json({ status: 'success', id: res.insertId });
}

/* DELETE /api/finance/transactions — remove any entry the user owns, actual or planned. Body: { type, id } */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { type, id } = await req.json();
  const entryId = parseInt(id);
  if (!entryId) return Response.json({ error: 'Missing id.' }, { status: 400 });

  const table = type === 'allowance' ? 'allowance' : type === 'expense' ? 'expenses' : type === 'savings' ? 'savings_entries' : null;
  const pk = type === 'allowance' ? 'allowance_id' : type === 'expense' ? 'expense_id' : 'saving_id';
  if (!table) return Response.json({ error: 'Invalid type.' }, { status: 400 });

  await pool.execute(`DELETE FROM ${table} WHERE ${pk} = ? AND user_id = ?`, [entryId, userId]);
  return Response.json({ status: 'success' });
}
