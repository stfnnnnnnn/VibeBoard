import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { loadSpendBase, computeSafe } from '@/lib/finance/safeToSpendServer';

/* POST /api/finance/what-if — pure preview, nothing is ever written to the database. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const { type, amount, goal_id } = await req.json();
  if (!['expense', 'savings'].includes(type)) {
    return Response.json({ error: 'Invalid type.' }, { status: 400 });
  }
  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0) {
    return Response.json({ error: 'Enter an amount greater than 0.' }, { status: 400 });
  }
  const goalId = goal_id ? parseInt(goal_id) : null;

  const { currentBalance, daysUntilNextAllowance, upcomingRequired, upcomingSavings } = await loadSpendBase(userId);
  const daysForRate = daysUntilNextAllowance ?? 14;
  const perDayOf = (safe: number) => daysForRate > 0 ? Math.round((safe / daysForRate) * 100) / 100 : safe;
  const beforeSafe = computeSafe(currentBalance, upcomingRequired, upcomingSavings).safe;
  const beforePerDay = perDayOf(beforeSafe);
  const afterBalance = currentBalance - numAmount;
  const afterSafe = computeSafe(afterBalance, upcomingRequired, upcomingSavings).safe;
  const afterPerDay = perDayOf(afterSafe);

  const response: Record<string, unknown> = {
    type, amount: numAmount,
    before: { balance: currentBalance, safe_to_spend: beforeSafe, per_day: beforePerDay },
    after: { balance: afterBalance, safe_to_spend: afterSafe, per_day: afterPerDay },
    days_until_next_allowance: daysUntilNextAllowance,
  };

  if (type === 'savings' && goalId) {
    const [goalRows] = await pool.execute<RowDataPacket[]>(
      `SELECT g.goal_name, g.wishlist_amount,
              COALESCE(SUM(CASE WHEN s.status = 'actual' THEN s.savings_amount ELSE 0 END), 0) AS total_saved
       FROM savings_goals g LEFT JOIN savings_entries s ON g.goal_id = s.goal_id
       WHERE g.goal_id = ? AND g.user_id = ? GROUP BY g.goal_id`,
      [goalId, userId]
    );
    if (goalRows.length) {
      const target = Number(goalRows[0].wishlist_amount);
      const saved = Number(goalRows[0].total_saved);
      response.goal = {
        goal_name: goalRows[0].goal_name,
        before_progress: target > 0 ? Math.round((saved / target) * 10000) / 100 : 0,
        after_progress: target > 0 ? Math.min(100, Math.round(((saved + numAmount) / target) * 10000) / 100) : 0,
      };
    }
  }

  if (afterBalance < 0) {
    response.warning = "This is more than your current balance — you'd be spending money you don't have yet.";
  } else if (afterSafe <= 0 && beforeSafe > 0) {
    response.warning = 'This would use up your entire safe-to-spend buffer for the period.';
  } else if (beforePerDay > 0 && afterPerDay < beforePerDay * 0.5) {
    response.warning = 'Your daily discretionary budget would drop by more than half.';
  }

  return Response.json(response);
}
