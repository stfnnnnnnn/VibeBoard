import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { loadSpendBase, computeSafe } from '@/lib/finance/safeToSpendServer';
import { paceStartFor } from '@/lib/finance/pace';
import { addDays } from '@/lib/finance/dates';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { today, currentBalance, horizonEnd, daysUntilNextAllowance, upcomingRequired, upcomingSavings } = await loadSpendBase(userId);
  const { buffer, rawSafe, safe: safeToSpend } = computeSafe(currentBalance, upcomingRequired, upcomingSavings);
  const daysForRate = daysUntilNextAllowance ?? 14;
  const perDay = daysForRate > 0 ? Math.round((safeToSpend / daysForRate) * 100) / 100 : safeToSpend;

  /* Tier-aware breakdown — only meaningful when the user has an active
     Spending Plan (allocation_templates.is_default), since priority_tier
     otherwise has nothing to classify categories by. Any category the plan
     doesn't mention (or no plan at all) defaults to 'flexible' — the safer
     assumption when trying to identify what's first to trim. */
  const [activeTemplateRows] = await pool.execute<RowDataPacket[]>(
    `SELECT template_id FROM allocation_templates WHERE user_id = ? AND is_default = 1 LIMIT 1`,
    [userId]
  );
  let tierBreakdown: { required: number; target: number; flexible: number } | null = null;
  let flexibleCategories: string[] = [];
  let shortfall = 0;
  let shortfallCoverableBy: 'flexible' | 'flexible_and_target' | 'none' | null = null;

  if (activeTemplateRows.length) {
    const [tierRows] = await pool.execute<RowDataPacket[]>(
      `SELECT category, priority_tier FROM allocation_template_items WHERE template_id = ? AND category != 'savings'`,
      [activeTemplateRows[0].template_id]
    );
    const tierByCategory = new Map<string, 'required' | 'target' | 'flexible'>();
    for (const r of tierRows) tierByCategory.set(String(r.category), r.priority_tier as 'required' | 'target' | 'flexible');

    const [byCategoryRows] = await pool.execute<RowDataPacket[]>(
      `SELECT category, COALESCE(SUM(expense_amount), 0) AS total FROM expenses WHERE user_id = ? AND status = 'planned' AND entry_date BETWEEN ? AND ? GROUP BY category`,
      [userId, today, horizonEnd]
    );
    const breakdown = { required: 0, target: 0, flexible: 0 };
    for (const r of byCategoryRows) {
      const category = String(r.category);
      const total = Number(r.total);
      const tier = tierByCategory.get(category) ?? 'flexible';
      breakdown[tier] += total;
      if (tier === 'flexible' && total > 0) flexibleCategories.push(category);
    }
    breakdown.target += upcomingSavings; // planned savings are a commitment, same class as a "target" allocation
    tierBreakdown = breakdown;

    shortfall = rawSafe < 0 ? Math.round(-rawSafe * 100) / 100 : 0;
    if (shortfall > 0) {
      if (breakdown.flexible >= shortfall) shortfallCoverableBy = 'flexible';
      else if (breakdown.flexible + breakdown.target >= shortfall) shortfallCoverableBy = 'flexible_and_target';
      else shortfallCoverableBy = 'none';
    }
  }

  /* Bounded by date instead of a small row cap, so the Activity "next 14 days" box and its total
     see every planned row in that window. The window runs to the safe-to-spend horizon, and at
     least 14 days so an allowance due sooner doesn't cut the box short. 'YYYY-MM-DD' strings
     compare in date order. */
  const fourteen = addDays(today, 14);
  const upcomingEnd = horizonEnd > fourteen ? horizonEnd : fourteen;
  const [upcomingRows] = await pool.execute<RowDataPacket[]>(
    `SELECT allowance_id AS id, entry_date, allowance_amount AS amount, 'allowance' AS type, 'Allowance' AS label
     FROM allowance WHERE user_id = ? AND status = 'planned' AND entry_date BETWEEN ? AND ?
     UNION ALL
     SELECT expense_id AS id, entry_date, expense_amount AS amount, 'expense' AS type, category AS label
     FROM expenses WHERE user_id = ? AND status = 'planned' AND entry_date BETWEEN ? AND ?
     UNION ALL
     SELECT s.saving_id AS id, s.entry_date, s.savings_amount AS amount, 'savings' AS type, COALESCE(g.goal_name, 'Savings') AS label
     FROM savings_entries s LEFT JOIN savings_goals g ON s.goal_id = g.goal_id
     WHERE s.user_id = ? AND s.status = 'planned' AND s.entry_date BETWEEN ? AND ?
     ORDER BY entry_date ASC
     LIMIT 100`,
    [userId, today, upcomingEnd, userId, today, upcomingEnd, userId, today, upcomingEnd]
  );

  const [lastAllowanceRows] = await pool.execute<RowDataPacket[]>(
    `SELECT MAX(entry_date) AS d FROM allowance WHERE user_id = ? AND status = 'actual' AND entry_date <= ?`,
    [userId, today]
  );
  const lastAllowance = lastAllowanceRows[0]?.d ? String(lastAllowanceRows[0].d) : null;
  const paceStart = paceStartFor(lastAllowance, today);
  const [dailyRows] = await pool.execute<RowDataPacket[]>(
    `SELECT entry_date, SUM(expense_amount) AS total FROM expenses
     WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?
     GROUP BY entry_date ORDER BY entry_date ASC`,
    [userId, paceStart, today]
  );

  return Response.json({
    current_balance: currentBalance,
    upcoming_required: upcomingRequired,
    upcoming_savings: upcomingSavings,
    buffer,
    safe_to_spend: safeToSpend,
    days_until_next_allowance: daysUntilNextAllowance,
    per_day: perDay,
    horizon_end: horizonEnd,
    tier_breakdown: tierBreakdown,
    shortfall,
    shortfall_coverable_by: shortfallCoverableBy,
    flexible_categories: flexibleCategories,
    pace_start: paceStart,
    daily_spend: dailyRows.map(r => ({ date: String(r.entry_date), amount: Number(r.total) })),
    upcoming: upcomingRows.map(r => ({
      id: Number(r.id),
      entry_date: String(r.entry_date),
      amount: Number(r.amount),
      type: r.type as string,
      label: r.label as string,
    })),
  });
}
