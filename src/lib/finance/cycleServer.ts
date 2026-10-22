// src/lib/finance/cycleServer.ts
/* Instantiates one cycle of a plan (decision D4): turns the template's items into
   template-scoped `category_budgets` rows (expense categories and the savings slice) for an
   explicit period, and records the cycle on the template. Shared by the allocation-templates
   `save` action and by apply-allocation, so "start a cycle" means the same thing in both.
   Server-only: runs on a caller-owned connection inside the caller's transaction. It never
   inserts expense or savings rows — budgeting money is not spending it. */
import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { manilaToday } from './dates';

const r2 = (n: number) => Math.round(n * 100) / 100;

/* Anything that can run a query: the pool or a connection inside a transaction. */
type Queryable = { execute: PoolConnection['execute'] };

/* Decision D2 (one definition for the server ceiling and the client's `cycle_used`): money a
   cycle has already used = actual expenses + actual savings (any category, user-scoped) from
   periodStart through LEAST(today, periodEnd), so spending after a lapsed cycle ended is not
   counted. A cycle that starts in the future has used nothing. */
export async function cycleUsed(db: Queryable, userId: number, periodStart: string, periodEnd: string | null): Promise<number> {
  const today = manilaToday();
  const upTo = periodEnd && periodEnd < today ? periodEnd : today;
  if (upTo < periodStart) return 0;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       (SELECT COALESCE(SUM(expense_amount), 0) FROM expenses WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?) +
       (SELECT COALESCE(SUM(savings_amount), 0) FROM savings_entries WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?) AS used`,
    [userId, periodStart, upTo, userId, periodStart, upTo]
  );
  return r2(Number(rows[0].used));
}

export interface BudgetedSlice { category: string; type: 'expense' | 'savings'; amount: number }

export async function instantiateCycle(
  conn: PoolConnection,
  userId: number,
  templateId: number,
  allowanceAmount: number,
  periodStart: string,
  periodEnd: string,
  /* true: a row the user overrode for this same cycle (same period_start) keeps its cap and
     reason; only plan_amount follows the plan. false (the save action): the plan resets every
     row, exactly as saving a plan always has. Overrides never carry into a different cycle. */
  opts: { keepOverrides?: boolean } = {},
): Promise<BudgetedSlice[]> {
  await conn.execute(
    `UPDATE allocation_templates SET last_allowance_amount = ?, last_period_start = ?, last_period_end = ? WHERE template_id = ? AND user_id = ?`,
    [allowanceAmount, periodStart, periodEnd, templateId, userId]
  );

  // Read through the same connection so items written earlier in this transaction are seen.
  const [items] = await conn.execute<RowDataPacket[]>(
    `SELECT category, priority_tier, allocation_type, amount, percent FROM allocation_template_items WHERE template_id = ? ORDER BY sort_order ASC`,
    [templateId]
  );

  const budgeted: BudgetedSlice[] = [];
  for (const it of items) {
    const category = String(it.category);
    const peso = it.allocation_type === 'fixed'
      ? Number(it.amount ?? 0)
      : r2(allowanceAmount * (Number(it.percent ?? 0) / 100));
    // Savings has its own budget row (type='savings') — a commitment target tracked against
    // money actually saved, overridable the same way as any expense category.
    const type: BudgetedSlice['type'] = category === 'savings' ? 'savings' : 'expense';

    // Scoped by template_id, not just category: two plans sharing a category must never
    // share one row, or reapplying one plan would silently overwrite the other's cycle.
    const [existing] = await conn.execute<RowDataPacket[]>(
      `SELECT budget_id, is_override, period_start FROM category_budgets WHERE user_id = ? AND template_id = ? AND category = ? AND type = ?`,
      [userId, templateId, category, type]
    );
    if (existing.length) {
      const row = existing[0];
      const keep = !!opts.keepOverrides && !!row.is_override && String(row.period_start ?? '') === periodStart;
      if (keep) {
        await conn.execute(
          `UPDATE category_budgets SET plan_amount = ?, tier = ?, period_start = ?, period_end = ?, is_active = 1 WHERE budget_id = ?`,
          [peso, it.priority_tier, periodStart, periodEnd, row.budget_id]
        );
      } else {
        await conn.execute(
          `UPDATE category_budgets SET cap_amount = ?, plan_amount = ?, tier = ?, period_start = ?, period_end = ?, is_override = 0, override_reason = NULL, is_active = 1 WHERE budget_id = ?`,
          [peso, peso, it.priority_tier, periodStart, periodEnd, row.budget_id]
        );
      }
    } else {
      await conn.execute(
        `INSERT INTO category_budgets (user_id, template_id, category, type, period, period_start, period_end, cap_amount, plan_amount, tier) VALUES (?, ?, ?, ?, 'monthly', ?, ?, ?, ?, ?)`,
        [userId, templateId, category, type, periodStart, periodEnd, peso, peso, it.priority_tier]
      );
    }
    budgeted.push({ category, type, amount: peso });
  }
  return budgeted;
}
