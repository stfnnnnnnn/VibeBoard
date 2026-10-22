import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { manilaToday, mondayOf, addDays, startOfMonth, endOfMonth } from '@/lib/finance/dates';

const TYPES = ['all', 'expense', 'allowance', 'savings'] as const;
const PERIODS = ['week', 'month', 'all'] as const;

function periodRange(period: typeof PERIODS[number], today: string) {
  if (period === 'week') { const start = mondayOf(today); return { start, end: addDays(start, 6) }; }
  if (period === 'month') return { start: startOfMonth(today), end: endOfMonth(today) };
  return { start: '2000-01-01', end: today };
}

/* GET /api/finance/feed — the Activity feed and Overview's Recent (spec §9.2, plan ruling R1).
   Read-only, paged, actual rows only. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const sp = req.nextUrl.searchParams;
  const type = (TYPES as readonly string[]).includes(sp.get('type') ?? '') ? sp.get('type') as typeof TYPES[number] : 'all';
  const period = (PERIODS as readonly string[]).includes(sp.get('period') ?? '') ? sp.get('period') as typeof PERIODS[number] : 'all';
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50') || 50));
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0') || 0);
  const { start, end } = periodRange(period, manilaToday());

  const parts: string[] = [];
  const args: (string | number)[] = [];
  if (type === 'all' || type === 'allowance') {
    parts.push(`SELECT allowance_id AS id, 'allowance' AS type, entry_date, allowance_amount AS amount, 'Allowance' AS label, NULL AS goal_id, recurring_rule_id
                FROM allowance WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?`);
    args.push(userId, start, end);
  }
  if (type === 'all' || type === 'expense') {
    parts.push(`SELECT expense_id AS id, 'expense' AS type, entry_date, expense_amount AS amount, category AS label, NULL AS goal_id, recurring_rule_id
                FROM expenses WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?`);
    args.push(userId, start, end);
  }
  if (type === 'all' || type === 'savings') {
    parts.push(`SELECT s.saving_id AS id, 'savings' AS type, s.entry_date, s.savings_amount AS amount, COALESCE(g.goal_name, 'Savings') AS label, s.goal_id, s.recurring_rule_id
                FROM savings_entries s LEFT JOIN savings_goals g ON g.goal_id = s.goal_id
                WHERE s.user_id = ? AND s.status = 'actual' AND s.entry_date BETWEEN ? AND ?`);
    args.push(userId, start, end);
  }
  // limit/offset are validated integers; inlined because mysql2 prepared LIMIT placeholders are unreliable.
  const sql = `${parts.join(' UNION ALL ')} ORDER BY entry_date DESC, id DESC, type ASC LIMIT ${limit + 1} OFFSET ${offset}`;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, args);

  const items = rows.slice(0, limit).map(r => ({
    id: Number(r.id),
    type: r.type as 'allowance' | 'expense' | 'savings',
    entry_date: String(r.entry_date),
    amount: Number(r.amount),
    label: String(r.label),
    goal_id: r.goal_id === null ? null : Number(r.goal_id),
    recurring: r.recurring_rule_id !== null,
  }));
  return Response.json({ items, has_more: rows.length > limit });
}
