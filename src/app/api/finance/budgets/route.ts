import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { manilaToday, addDays, mondayOf, startOfMonth, endOfMonth } from '@/lib/finance/dates';
import type { RowDataPacket } from 'mysql2';

const EXPENSE_CATEGORIES = ['transportation', 'grocery', 'food', 'academic', 'family', 'leisure', 'emergency', 'miscellaneous', 'healthcare', 'utilities', 'donation'];

function currentPeriodRange(period: 'weekly' | 'monthly'): { start: string; end: string } {
  const today = manilaToday();
  if (period === 'weekly') { const start = mondayOf(today); return { start, end: addDays(start, 6) }; }
  return { start: startOfMonth(today), end: endOfMonth(today) };
}

/* GET /api/finance/budgets — Budget Progress no longer has its own
   independent list of categories. Which categories appear, and what tier
   each is in, comes straight from the active plan's items every time —
   never from category_budgets alone — so it can't drift out of sync with
   Spending Plan the way a separately-maintained list could. A category a
   plan mentions but that's never been through an actual cycle still shows
   up, with spent computed fresh from real transactions and cap_amount left
   null (nothing to cap it at yet). Categories with no matching plan item
   simply don't come back anymore; the row itself is left alone in the
   table, only unreachable from here. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const [activeTemplateRows] = await pool.execute<RowDataPacket[]>(
    `SELECT template_id, last_allowance_amount, last_period_start, last_period_end FROM allocation_templates WHERE user_id = ? AND is_default = 1 LIMIT 1`,
    [userId]
  );
  if (!activeTemplateRows.length) return Response.json({ budgets: [], remaining_allowance: null, savings: null });
  const activeTemplate = activeTemplateRows[0];

  const [planItems] = await pool.execute<RowDataPacket[]>(
    `SELECT category, priority_tier FROM allocation_template_items WHERE template_id = ? AND category != 'savings' ORDER BY sort_order ASC`,
    [activeTemplate.template_id]
  );

  // Scoped to this exact template — a budget row another plan wrote for the
  // same category name must never surface here just because the category
  // matches; only this plan's own cycle counts. Both types come back in one
  // query: expense rows feed the list below, the savings row (if any) is
  // pulled out separately further down.
  const [existingRows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM category_budgets WHERE user_id = ? AND template_id = ? AND is_active = 1`,
    [userId, activeTemplate.template_id]
  );
  const existingByCategory = new Map(existingRows.filter(r => r.type === 'expense').map(r => [String(r.category), r]));
  const savingsRow = existingRows.find(r => r.type === 'savings') ?? null;

  const result = await Promise.all(planItems.map(async (item) => {
    const category = String(item.category);
    const existing = existingByCategory.get(category);

    let start: string, end: string;
    if (existing?.period_start && existing?.period_end) {
      start = String(existing.period_start);
      end = String(existing.period_end);
    } else {
      const period: 'weekly' | 'monthly' = existing?.period === 'weekly' ? 'weekly' : 'monthly';
      ({ start, end } = currentPeriodRange(period));
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(expense_amount), 0) AS total FROM expenses WHERE user_id = ? AND status = 'actual' AND category = ? AND entry_date BETWEEN ? AND ?`,
      [userId, category, start, end]
    );
    const spent = Number(rows[0].total);
    const capAmount = existing ? Number(existing.cap_amount) : null;

    return {
      budget_id: existing ? Number(existing.budget_id) : null,
      category,
      type: 'expense',
      period: existing?.period === 'weekly' ? 'weekly' : 'monthly',
      cap_amount: capAmount,
      plan_amount: existing && existing.plan_amount !== null ? Number(existing.plan_amount) : null,
      is_override: existing ? !!existing.is_override : false,
      override_reason: existing ? existing.override_reason : null,
      tier: item.priority_tier,
      spent,
      remaining: capAmount !== null ? Math.max(0, capAmount - spent) : null,
      pct: capAmount ? Math.round((spent / capAmount) * 10000) / 100 : 0,
      period_start: existing?.period_start ? start : null,
      period_end: existing?.period_end ? end : null,
    };
  }));

  /* Savings isn't "spent," so it never belonged in the expense list above —
     it's tracked separately as how much of its own slice has actually been
     funded this cycle. Its cap now comes from its own category_budgets row
     (type='savings', written alongside every expense row when a cycle is
     instantiated — see the allocation-templates 'save' action), the same
     way any expense category's cap does, so it can be overridden the same
     way too. Only "funded" is computed fresh each time, from real savings
     entries — those are always goal-scoped, so this sums across every goal
     within the cycle's period rather than filtering to one. */
  let savings = null;
  if (savingsRow) {
    const [fundedRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(savings_amount), 0) AS total FROM savings_entries WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?`,
      [userId, savingsRow.period_start, savingsRow.period_end]
    );
    savings = {
      budget_id: Number(savingsRow.budget_id),
      cap_amount: Number(savingsRow.cap_amount),
      plan_amount: savingsRow.plan_amount !== null ? Number(savingsRow.plan_amount) : null,
      is_override: !!savingsRow.is_override,
      override_reason: savingsRow.override_reason,
      funded: Number(fundedRows[0].total),
      tier: savingsRow.tier,
      period_start: savingsRow.period_start,
      period_end: savingsRow.period_end,
    };
  }

  /* The cycle's total pie — what the plan was actually instantiated with —
     minus what's currently assigned across every row, expense AND savings,
     which does reflect overrides on either side. Using last_allowance_amount
     directly (rather than re-summing plan_amount) means it stays the true
     original total regardless of how caps get redistributed afterward. */
  const totalPlanAllowance = activeTemplate.last_allowance_amount !== null ? Number(activeTemplate.last_allowance_amount) : 0;
  const totalAssigned = result.reduce((s, b) => s + (b.cap_amount ?? 0), 0) + (savings?.cap_amount ?? 0);
  const remainingAllowance = totalPlanAllowance > 0 ? Math.round((totalPlanAllowance - totalAssigned) * 100) / 100 : null;

  return Response.json({ budgets: result, remaining_allowance: remainingAllowance, savings });
}

/* POST /api/finance/budgets — action: 'override' | 'reset'. Creating and
   deleting a budget independent of a plan is gone — a category's budget
   now only ever comes from being in the active plan (see GET above);
   "override" is the one mechanism left, and it upserts by category rather
   than requiring an existing budget_id, since a plan category might not
   have a row yet (never applied) the first time someone overrides it. An
   override can't push the cycle's total assigned past what the plan
   originally allocated in total — the pie doesn't get bigger just because
   one slice grows. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const body = await req.json();
  const { action } = body;

  if (action === 'override') {
    const category = String(body.category ?? '');
    const amount = Number(body.amount);
    const reason = body.reason ? String(body.reason).trim().slice(0, 255) : null;

    if (!EXPENSE_CATEGORIES.includes(category) && category !== 'savings') {
      return Response.json({ error: 'Invalid category.' }, { status: 400 });
    }
    if (!amount || amount <= 0) {
      return Response.json({ error: 'Override amount must be greater than 0.' }, { status: 400 });
    }

    const [activeTemplateRows] = await pool.execute<RowDataPacket[]>(
      `SELECT template_id, last_allowance_amount FROM allocation_templates WHERE user_id = ? AND is_default = 1 LIMIT 1`,
      [userId]
    );
    if (!activeTemplateRows.length) return Response.json({ error: 'No active plan to override against.' }, { status: 400 });
    const activeTemplateId = activeTemplateRows[0].template_id;
    // Only rows for categories still in the active plan count (savings included) — a row left
    // active for a category since removed from the plan isn't shown by GET and mustn't eat into
    // the cycle's total here either.
    const [planItemRows] = await pool.execute<RowDataPacket[]>(
      `SELECT category FROM allocation_template_items WHERE template_id = ?`,
      [activeTemplateId]
    );
    const planCategories = new Set(planItemRows.map(r => String(r.category)));
    // GET only lists the active plan's categories, so an override for any other category would
    // write a row nothing shows (and that no plan apply would ever reset).
    if (!planCategories.has(category)) {
      return Response.json({ error: "That category isn't in the active plan." }, { status: 400 });
    }

    // Scoped to the active plan, both types together — savings' cap shares
    // the same total pie as every expense category, so it has to be in the
    // same pool for the "don't exceed the cycle's total" check below.
    const [activeBudgetRows] = await pool.execute<RowDataPacket[]>(
      `SELECT budget_id, category, type, cap_amount, plan_amount, period_start, period_end FROM category_budgets WHERE user_id = ? AND template_id = ? AND is_active = 1`,
      [userId, activeTemplateId]
    );
    const allBudgets = activeBudgetRows.filter(b => planCategories.has(String(b.category)));
    // Same total GET uses for remaining_allowance; plan_amount sum only when the plan has no cycle amount.
    const lastAllowance = activeTemplateRows[0].last_allowance_amount;
    const totalPlanAllowance = lastAllowance !== null
      ? Number(lastAllowance)
      : allBudgets.reduce((s, b) => s + (b.plan_amount !== null ? Number(b.plan_amount) : 0), 0);
    if (totalPlanAllowance > 0) {
      const sumOthers = allBudgets
        .filter(b => b.category !== category)
        .reduce((s, b) => s + Number(b.cap_amount), 0);
      const maxAllowed = Math.round((totalPlanAllowance - sumOthers) * 100) / 100;
      if (amount > maxAllowed + 0.01) {
        return Response.json({ error: `That would put the cycle ₱${(amount - maxAllowed).toFixed(2)} over its total allowance of ₱${totalPlanAllowance.toFixed(2)}.` }, { status: 400 });
      }
    }

    const existing = allBudgets.find(b => b.category === category);
    if (existing) {
      await pool.execute(
        `UPDATE category_budgets SET cap_amount = ?, is_override = 1, override_reason = ?, is_active = 1 WHERE budget_id = ?`,
        [amount, reason, existing.budget_id]
      );
    } else {
      // No row for this category yet — inherit the cycle's dates from any
      // sibling budget that already has them, so a first-time override
      // still lines up with the rest of the active cycle.
      const sibling = allBudgets.find(b => b.period_start && b.period_end);
      const type = category === 'savings' ? 'savings' : 'expense';
      await pool.execute(
        `INSERT INTO category_budgets (user_id, template_id, category, type, period, period_start, period_end, cap_amount, is_override, override_reason) VALUES (?, ?, ?, ?, 'monthly', ?, ?, ?, 1, ?)`,
        [userId, activeTemplateId, category, type, sibling?.period_start ?? null, sibling?.period_end ?? null, amount, reason]
      );
    }
    return Response.json({ status: 'success' });
  }

  /* Reverts an override back to whatever the active plan currently allocates. */
  if (action === 'reset') {
    const budgetId = parseInt(body.budget_id);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT plan_amount FROM category_budgets WHERE budget_id = ? AND user_id = ?`, [budgetId, userId]
    );
    if (!rows.length) return Response.json({ error: 'Budget not found.' }, { status: 404 });
    if (rows[0].plan_amount === null) {
      return Response.json({ error: 'This budget has no plan allocation to reset to.' }, { status: 400 });
    }
    await pool.execute(
      `UPDATE category_budgets SET cap_amount = plan_amount, is_override = 0, override_reason = NULL WHERE budget_id = ?`,
      [budgetId]
    );
    return Response.json({ status: 'success' });
  }

  return Response.json({ error: 'Unknown action.' }, { status: 400 });
}
