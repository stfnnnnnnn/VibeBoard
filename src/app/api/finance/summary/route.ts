import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { manilaToday, addDays, addMonthsClamped, mondayOf, startOfMonth, endOfMonth } from '@/lib/finance/dates';
import type { RowDataPacket } from 'mysql2';

/* Consolidates the old load_summary_totals.php + summaries.php into one
   endpoint with one unambiguous range parameter, instead of two backends
   that both used 'month'/'year'/'all' to mean different date ranges. */
type Range = 'week' | 'month' | 'all';

function rangeToDates(range: Range, today: string): { start: string; end: string } {
  if (range === 'week') { const start = mondayOf(today); return { start, end: addDays(start, 6) }; }
  if (range === 'month') return { start: startOfMonth(today), end: endOfMonth(today) };
  return { start: '2000-01-01', end: today };
}

/* The equivalent prior period, for week-over-week / month-over-month deltas.
   No meaningful "previous" for 'all'. */
function previousRangeToDates(range: Range, today: string): { start: string; end: string } | null {
  if (range === 'all') return null;
  if (range === 'week') { const start = addDays(mondayOf(today), -7); return { start, end: addDays(start, 6) }; }
  const prev = addMonthsClamped(startOfMonth(today), -1);
  return { start: prev, end: endOfMonth(prev) };
}

async function rangeTotal(userId: number, table: string, column: string, start: string, end: string): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(${column}), 0) AS total FROM ${table} WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?`,
    [userId, start, end]
  );
  return Number(rows[0].total);
}

/* Bucket an entry_date into a chart index — 7 daily buckets for 'week',
   4 week-buckets within the month for 'month', 12 month-buckets for 'all'. */
function bucketIndex(entryDate: string, range: Range): number {
  const d = new Date(entryDate + 'T00:00:00');
  if (range === 'all') return d.getMonth(); // 0..11
  if (range === 'week') return (d.getDay() + 6) % 7; // Mon=0..Sun=6
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const firstDow = firstOfMonth.getDay() === 0 ? 7 : firstOfMonth.getDay(); // 1=Mon..7=Sun
  const daysSinceFirstMonday = d.getDate() + firstDow - 2;
  return Math.max(0, Math.min(3, Math.floor(daysSinceFirstMonday / 7)));
}

interface GoalRow extends RowDataPacket {
  goal_id: number;
  goal_name: string;
  wishlist_amount: string;
  target_date: string | null;
  total_saved: string;
  first_entry_date: string | null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const range = (req.nextUrl.searchParams.get('range') ?? 'week') as Range;
  if (!['week', 'month', 'all'].includes(range)) {
    return Response.json({ error: 'Invalid range' }, { status: 400 });
  }

  const today = manilaToday();
  const { start, end } = rangeToDates(range, today);

  const [allowanceRows] = await pool.execute<RowDataPacket[]>(
    `SELECT allowance_id AS id, entry_date, allowance_amount FROM allowance WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?`,
    [userId, start, end]
  );
  const [expenseRows] = await pool.execute<RowDataPacket[]>(
    `SELECT expense_id AS id, entry_date, category, expense_amount FROM expenses WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?`,
    [userId, start, end]
  );
  const [savingsRows] = await pool.execute<RowDataPacket[]>(
    `SELECT s.saving_id AS id, s.entry_date, g.goal_name, s.savings_amount
     FROM savings_entries s LEFT JOIN savings_goals g ON s.goal_id = g.goal_id
     WHERE s.user_id = ? AND s.status = 'actual' AND s.entry_date BETWEEN ? AND ?`,
    [userId, start, end]
  );

  const recent = [
    ...allowanceRows.map(r => ({ id: Number(r.id), type: 'allowance' as const, entry_date: String(r.entry_date), amount: Number(r.allowance_amount), label: 'Allowance' })),
    ...expenseRows.map(r => ({ id: Number(r.id), type: 'expense' as const, entry_date: String(r.entry_date), amount: Number(r.expense_amount), label: String(r.category) })),
    ...savingsRows.map(r => ({ id: Number(r.id), type: 'savings' as const, entry_date: String(r.entry_date), amount: Number(r.savings_amount), label: String(r.goal_name ?? 'Savings') })),
  ].sort((a, b) => b.entry_date.localeCompare(a.entry_date)).slice(0, 15);

  const bucketCount = range === 'all' ? 12 : range === 'week' ? 7 : 4;
  const labels = range === 'all'
    ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    : range === 'week'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['W1', 'W2', 'W3', 'W4'];

  const allowanceByBucket = new Array(bucketCount).fill(0);
  let totalAllowance = 0;
  for (const r of allowanceRows) {
    const idx = bucketIndex(String(r.entry_date), range);
    const amt = Number(r.allowance_amount);
    allowanceByBucket[idx] += amt;
    totalAllowance += amt;
  }

  const expensesByBucket: Record<string, number>[] = Array.from({ length: bucketCount }, () => ({}));
  let totalExpense = 0;
  for (const r of expenseRows) {
    const idx = bucketIndex(String(r.entry_date), range);
    const cat = String(r.category);
    const amt = Number(r.expense_amount);
    expensesByBucket[idx][cat] = (expensesByBucket[idx][cat] ?? 0) + amt;
    totalExpense += amt;
  }
  const expensesTotal = expensesByBucket.map(b => Object.values(b).reduce((s, v) => s + v, 0));

  const savingsByBucket: Record<string, number>[] = Array.from({ length: bucketCount }, () => ({}));
  let totalSavings = 0;
  for (const r of savingsRows) {
    const idx = bucketIndex(String(r.entry_date), range);
    const cat = String(r.goal_name ?? 'Uncategorized');
    const amt = Number(r.savings_amount);
    savingsByBucket[idx][cat] = (savingsByBucket[idx][cat] ?? 0) + amt;
    totalSavings += amt;
  }
  const savingsTotal = savingsByBucket.map(b => Object.values(b).reduce((s, v) => s + v, 0));

  // Opening balance — every actual transaction before this range's start —
  // so the balance trend below reflects real absolute balance, not just net
  // change within the window.
  const [openingAllowance, openingExpense, openingSavings] = await Promise.all([
    rangeTotal(userId, 'allowance', 'allowance_amount', '2000-01-01', start),
    rangeTotal(userId, 'expenses', 'expense_amount', '2000-01-01', start),
    rangeTotal(userId, 'savings_entries', 'savings_amount', '2000-01-01', start),
  ]);
  const openingBalance = openingAllowance - openingExpense - openingSavings;

  const balanceOverTime: number[] = [];
  let runningBalance = openingBalance;
  for (let i = 0; i < bucketCount; i++) {
    runningBalance += (allowanceByBucket[i] ?? 0) - (expensesTotal[i] ?? 0) - (savingsTotal[i] ?? 0);
    balanceOverTime.push(Math.round(runningBalance * 100) / 100);
  }

  // Previous-period totals, for week-over-week / month-over-month deltas.
  const prevRange = previousRangeToDates(range, today);
  let previousTotals = null;
  if (prevRange) {
    const [pAllowance, pExpense, pSavings] = await Promise.all([
      rangeTotal(userId, 'allowance', 'allowance_amount', prevRange.start, prevRange.end),
      rangeTotal(userId, 'expenses', 'expense_amount', prevRange.start, prevRange.end),
      rangeTotal(userId, 'savings_entries', 'savings_amount', prevRange.start, prevRange.end),
    ]);
    previousTotals = {
      allowance: pAllowance,
      expense: pExpense,
      savings: pSavings,
      remaining: pAllowance - (pExpense + pSavings),
    };
  }

  // Goals — always lifetime (not range-scoped) with pace projection.
  const [goalRows] = await pool.execute<GoalRow[]>(
    `SELECT g.goal_id, g.goal_name, g.wishlist_amount, g.target_date,
            COALESCE(SUM(CASE WHEN s.status = 'actual' THEN s.savings_amount ELSE 0 END), 0) AS total_saved,
            MIN(CASE WHEN s.status = 'actual' THEN s.entry_date END) AS first_entry_date
     FROM savings_goals g
     LEFT JOIN savings_entries s ON g.goal_id = s.goal_id
     WHERE g.user_id = ?
     GROUP BY g.goal_id`,
    [userId]
  );

  const todayTs = Date.now();
  const goals = goalRows.map(row => {
    const targetAmount = Number(row.wishlist_amount);
    const totalSaved = Number(row.total_saved);
    const remaining = Math.max(0, targetAmount - totalSaved);
    const progress = targetAmount > 0 ? Math.round((totalSaved / targetAmount) * 10000) / 100 : 0;

    let avgPerWeek = 0;
    if (row.first_entry_date && totalSaved > 0) {
      const daysActive = Math.max(1, Math.floor((todayTs - new Date(row.first_entry_date).getTime()) / 86400000));
      avgPerWeek = Math.round((totalSaved / Math.max(1, daysActive / 7)) * 100) / 100;
    }

    let requiredPerWeek: number | null = null;
    let daysRemaining: number | null = null;
    if (row.target_date) {
      daysRemaining = Math.floor((new Date(row.target_date).getTime() - todayTs) / 86400000);
      const weeksRemaining = Math.max(1, daysRemaining / 7);
      requiredPerWeek = remaining > 0 ? Math.round((remaining / weeksRemaining) * 100) / 100 : 0;
    }

    let projectedDate: string | null = null;
    if (remaining <= 0) {
      projectedDate = today;
    } else if (avgPerWeek > 0) {
      const weeksNeeded = remaining / avgPerWeek;
      projectedDate = addDays(today, Math.ceil(weeksNeeded * 7));
    }

    let paceStatus: 'ahead' | 'on_pace' | 'behind' | null = null;
    let weeksOffPace: number | null = null;
    if (row.target_date && projectedDate) {
      if (remaining <= 0) {
        paceStatus = 'ahead';
        weeksOffPace = 0;
      } else {
        const diffDays = Math.floor((new Date(projectedDate).getTime() - new Date(row.target_date).getTime()) / 86400000);
        weeksOffPace = Math.round(Math.abs(diffDays) / 7);
        paceStatus = diffDays <= 0 ? (diffDays === 0 ? 'on_pace' : 'ahead') : 'behind';
      }
    }

    return {
      goal_id: row.goal_id,
      goal_name: row.goal_name,
      target_amount: targetAmount,
      saved: totalSaved,
      progress_percent: progress,
      target_date: row.target_date,
      days_remaining: daysRemaining,
      avg_per_week: avgPerWeek,
      required_per_week: requiredPerWeek,
      projected_date: projectedDate,
      pace_status: paceStatus,
      weeks_off_pace: weeksOffPace,
    };
  });

  return Response.json({
    range,
    date_range: [start, end],
    recent,
    totals: {
      allowance: totalAllowance,
      expense: totalExpense,
      savings: totalSavings,
      remaining: totalAllowance - (totalExpense + totalSavings),
    },
    previous_totals: previousTotals,
    breakdown: {
      labels,
      allowance: allowanceByBucket,
      expenses_total: expensesTotal,
      expenses_by_category: expensesByBucket,
      savings_total: savingsTotal,
      savings_by_goal: savingsByBucket,
      balance_over_time: balanceOverTime,
      opening_balance: Math.round(openingBalance * 100) / 100,
    },
    goals,
  });
}
