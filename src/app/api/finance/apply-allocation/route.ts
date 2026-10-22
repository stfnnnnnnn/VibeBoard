import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { manilaToday, addDays, daysBetween } from '@/lib/finance/dates';
import { instantiateCycle } from '@/lib/finance/cycleServer';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

const DEFAULT_CYCLE_DAYS = 30;

/* POST /api/finance/apply-allocation — budget an allowance across a template's categories
   (decision D4: envelope budgeting). Allocating money to categories is budgeting, not
   spending, so no expense rows are written: the plan's cycle is instantiated instead
   (template-scoped category_budgets rows for entry_date … entry_date + cycle length − 1).
   The savings slice is the one real money movement — a transfer into the chosen goal —
   so it is still recorded as a savings entry. Which goal receives it is chosen here, not
   baked into the template. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { template_id, amount, entry_date, goal_id } = await req.json();
  const templateId = parseInt(template_id);
  const totalAmount = Number(amount);
  const goalId = goal_id ? parseInt(goal_id) : null;

  if (!templateId || !totalAmount || totalAmount <= 0 || !entry_date || isNaN(Date.parse(entry_date))) {
    return Response.json({ error: 'A template, a positive amount, and a valid date are required.' }, { status: 400 });
  }
  const today = manilaToday();
  const entryStatus = entry_date > today ? 'planned' : 'actual';

  const [templateRows] = await pool.execute<RowDataPacket[]>(
    `SELECT template_id, last_period_start, last_period_end FROM allocation_templates WHERE template_id = ? AND user_id = ?`, [templateId, userId]
  );
  if (!templateRows.length) return Response.json({ error: 'Template not found.' }, { status: 404 });
  const tpl = templateRows[0];
  const periodStart = String(entry_date).slice(0, 10);
  // Same length as the plan's previous cycle when it has one; otherwise 30 days.
  const cycleDays = tpl.last_period_start && tpl.last_period_end
    ? daysBetween(String(tpl.last_period_start), String(tpl.last_period_end)) + 1
    : DEFAULT_CYCLE_DAYS;
  const periodEnd = addDays(periodStart, Math.max(1, cycleDays) - 1);

  const [items] = await pool.execute<RowDataPacket[]>(
    `SELECT category, priority_tier, allocation_type, amount, percent FROM allocation_template_items WHERE template_id = ? ORDER BY sort_order ASC`,
    [templateId]
  );
  if (!items.length) return Response.json({ error: 'This template has no categories to apply.' }, { status: 400 });

  const hasSavingsItem = items.some(it => it.category === 'savings');
  if (hasSavingsItem && !goalId) {
    return Response.json({ error: 'This template includes a savings slice — choose which goal it should go to.' }, { status: 400 });
  }
  if (goalId) {
    const [goalRows] = await pool.execute<RowDataPacket[]>(
      `SELECT goal_id FROM savings_goals WHERE goal_id = ? AND user_id = ?`, [goalId, userId]
    );
    if (!goalRows.length) return Response.json({ error: 'Goal not found.' }, { status: 404 });
  }

  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const created: { category: string; amount: number }[] = [];

    // Applying a plan makes it the active one.
    await conn.execute(`UPDATE allocation_templates SET is_default = 0 WHERE user_id = ?`, [userId]);
    await conn.execute(`UPDATE allocation_templates SET is_default = 1 WHERE template_id = ?`, [templateId]);

    // Budget every slice for this cycle. Overrides the user made for this same cycle survive a
    // re-apply; a new cycle starts from the plan.
    const slices = await instantiateCycle(conn, userId, templateId, totalAmount, periodStart, periodEnd, { keepOverrides: true });
    const positive = slices.filter(sl => sl.amount > 0);
    const allocatedTotal = positive.reduce((sum, sl) => sum + sl.amount, 0);

    // The savings share really moves: record it as a transfer into the goal.
    const savingsSlice = positive.find(sl => sl.type === 'savings');
    if (savingsSlice) {
      await conn.execute(
        `INSERT INTO savings_entries (user_id, goal_id, savings_amount, entry_date, categories, status) VALUES (?, ?, ?, ?, 'Future Allocation', ?)`,
        [userId, goalId, savingsSlice.amount, entry_date, entryStatus]
      );
      created.push({ category: 'savings', amount: savingsSlice.amount });
    }
    const budgeted = positive.filter(sl => sl.type === 'expense').map(sl => ({ category: sl.category, amount: sl.amount }));

    await conn.commit();
    return Response.json({
      status: 'success',
      created,
      budgeted,
      allocated_total: Math.round(allocatedTotal * 100) / 100,
      unallocated: Math.round((totalAmount - allocatedTotal) * 100) / 100,
    });
  } catch (err) {
    await conn.rollback();
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    conn.release();
  }
}
