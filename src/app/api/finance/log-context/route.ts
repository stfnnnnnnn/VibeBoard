import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { manilaToday, addDays } from '@/lib/finance/dates';
import { topCategories, repeatsFrom, type LoggedRow } from '@/lib/finance/logContext';

/* GET /api/finance/log-context — the composer's category chips and the drawer's
   "Log again" tiles, from the last 60 days of actual entries (spec §7.2). Read-only. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const today = manilaToday();
  const since = addDays(today, -60);

  const [expenseRows] = await pool.execute<RowDataPacket[]>(
    `SELECT category, expense_amount AS amount, entry_date FROM expenses
     WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?`,
    [userId, since, today]);
  const [savingsRows] = await pool.execute<RowDataPacket[]>(
    `SELECT s.goal_id, g.goal_name, s.savings_amount AS amount, s.entry_date
     FROM savings_entries s JOIN savings_goals g ON g.goal_id = s.goal_id
     WHERE s.user_id = ? AND s.status = 'actual' AND s.entry_date BETWEEN ? AND ?`,
    [userId, since, today]);

  const rows: LoggedRow[] = [
    ...expenseRows.map(r => ({ type: 'expense' as const, category: String(r.category), goal_id: null, goal_name: null, amount: Number(r.amount), entry_date: String(r.entry_date) })),
    ...savingsRows.map(r => ({ type: 'savings' as const, category: null, goal_id: Number(r.goal_id), goal_name: String(r.goal_name), amount: Number(r.amount), entry_date: String(r.entry_date) })),
  ];
  return Response.json({ top_categories: topCategories(rows), repeats: repeatsFrom(rows) });
}
