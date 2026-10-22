import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { manilaToday, addDays, addMonthsClamped } from '@/lib/finance/dates';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const EXPENSE_CATEGORIES = ['transportation', 'grocery', 'food', 'academic', 'family', 'leisure', 'emergency', 'miscellaneous', 'healthcare', 'utilities', 'donation'];
const FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;
type Frequency = typeof FREQUENCIES[number];

/* Keep at least this many future planned occurrences materialized per rule;
   top up to this many whenever it drops below the floor. No cron needed —
   every dashboard load calls GET, which is exactly when it matters. */
const TOP_UP_FLOOR = 3;
const TOP_UP_TARGET = 6;

/* UTC string arithmetic: the old local-midnight + toISOString version stepped weekly rules
   6 days at a time on a UTC+8 machine (plan ruling R3). */
function addInterval(dateStr: string, frequency: Frequency): string {
  if (frequency === 'weekly') return addDays(dateStr, 7);
  if (frequency === 'biweekly') return addDays(dateStr, 14);
  return addMonthsClamped(dateStr, 1);
}

interface RuleRow extends RowDataPacket {
  rule_id: number; user_id: number; type: 'allowance' | 'expense' | 'savings';
  category: string | null; goal_id: number | null; amount: string; frequency: Frequency;
  start_date: string; end_date: string | null; next_run_date: string; is_active: number;
}

/* Inserts up to `count` occurrences starting at the rule's current
   next_run_date, then advances next_run_date past the last one generated —
   the rule table itself is the cursor, so this is safe to call repeatedly. */
async function materialize(userId: number, rule: RuleRow, count: number): Promise<number> {
  const today = manilaToday();
  const dates: string[] = [];
  let cursor = rule.next_run_date;
  for (let i = 0; i < count; i++) {
    if (rule.end_date && cursor > rule.end_date) break;
    dates.push(cursor);
    cursor = addInterval(cursor, rule.frequency);
  }
  if (!dates.length) return 0;

  for (const entryDate of dates) {
    const status = entryDate > today ? 'planned' : 'actual';
    if (rule.type === 'allowance') {
      await pool.execute(
        `INSERT INTO allowance (user_id, entry_date, allowance_amount, categories, status, recurring_rule_id) VALUES (?, ?, ?, 'initial allowance', ?, ?)`,
        [userId, entryDate, rule.amount, status, rule.rule_id]
      );
    } else if (rule.type === 'expense') {
      await pool.execute(
        `INSERT INTO expenses (user_id, category, expense_amount, entry_date, status, recurring_rule_id) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, rule.category, rule.amount, entryDate, status, rule.rule_id]
      );
    } else {
      await pool.execute(
        `INSERT INTO savings_entries (user_id, goal_id, savings_amount, entry_date, categories, status, recurring_rule_id) VALUES (?, ?, ?, ?, 'Recurring', ?, ?)`,
        [userId, rule.goal_id, rule.amount, entryDate, status, rule.rule_id]
      );
    }
  }

  await pool.execute(`UPDATE recurring_rules SET next_run_date = ? WHERE rule_id = ?`, [cursor, rule.rule_id]);
  return dates.length;
}

/* GET /api/finance/recurring-rules — list active rules, topping up any
   whose materialized horizon has run low before returning. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const today = manilaToday();

  const [rules] = await pool.execute<RuleRow[]>(
    `SELECT * FROM recurring_rules WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC`,
    [userId]
  );

  for (const rule of rules) {
    const table = rule.type === 'allowance' ? 'allowance' : rule.type === 'expense' ? 'expenses' : 'savings_entries';
    const [[{ pending }]] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS pending FROM ${table} WHERE recurring_rule_id = ? AND status = 'planned' AND entry_date >= ?`,
      [rule.rule_id, today]
    );
    if (Number(pending) < TOP_UP_FLOOR) {
      await materialize(userId, rule, TOP_UP_TARGET - Number(pending));
    }
  }

  return Response.json({
    rules: rules.map(r => ({
      rule_id: r.rule_id, type: r.type, category: r.category, goal_id: r.goal_id,
      amount: Number(r.amount), frequency: r.frequency, start_date: r.start_date,
      end_date: r.end_date, next_run_date: r.next_run_date,
    })),
  });
}

/* POST /api/finance/recurring-rules — action: 'save' | 'delete'. Save always
   creates (no edit — a rule already mid-generation is safer to replace than
   mutate); it also materializes the first batch immediately so Upcoming
   reflects the rule right away, not after the next page load. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const body = await req.json();
  const { action } = body;

  if (action === 'delete') {
    const ruleId = parseInt(body.rule_id);
    const today = manilaToday();
    // Drop not-yet-happened occurrences this rule generated — deleting a
    // recurring rule should clear its future entries, not orphan them.
    for (const table of ['allowance', 'expenses', 'savings_entries']) {
      await pool.execute(
        `DELETE FROM ${table} WHERE recurring_rule_id = ? AND user_id = ? AND status = 'planned' AND entry_date >= ?`,
        [ruleId, userId, today]
      );
    }
    await pool.execute(`DELETE FROM recurring_rules WHERE rule_id = ? AND user_id = ?`, [ruleId, userId]);
    return Response.json({ status: 'success' });
  }

  if (action === 'save') {
    const type = body.type as 'allowance' | 'expense' | 'savings';
    if (!['allowance', 'expense', 'savings'].includes(type)) {
      return Response.json({ error: 'Invalid type.' }, { status: 400 });
    }
    const amount = Number(body.amount);
    if (!amount || amount <= 0) {
      return Response.json({ error: 'Amount must be greater than 0.' }, { status: 400 });
    }
    const frequency = body.frequency as Frequency;
    if (!FREQUENCIES.includes(frequency)) {
      return Response.json({ error: 'Invalid frequency.' }, { status: 400 });
    }
    const startDate = String(body.start_date ?? '');
    if (!startDate || isNaN(Date.parse(startDate))) {
      return Response.json({ error: 'A valid start date is required.' }, { status: 400 });
    }
    const endDate = body.end_date ? String(body.end_date) : null;
    if (endDate && endDate < startDate) {
      return Response.json({ error: 'End date must be after the start date.' }, { status: 400 });
    }

    let category: string | null = null;
    let goalId: number | null = null;
    if (type === 'expense') {
      category = String(body.category ?? '');
      if (!EXPENSE_CATEGORIES.includes(category)) {
        return Response.json({ error: 'Invalid expense category.' }, { status: 400 });
      }
    } else if (type === 'savings') {
      goalId = parseInt(body.goal_id);
      if (!goalId) return Response.json({ error: 'Select a savings goal.' }, { status: 400 });
      const [goalRows] = await pool.execute<RowDataPacket[]>(
        `SELECT goal_id FROM savings_goals WHERE goal_id = ? AND user_id = ?`, [goalId, userId]
      );
      if (!goalRows.length) return Response.json({ error: 'Goal not found.' }, { status: 404 });
    }

    const startD = new Date(startDate + 'T00:00:00');
    const dayOfWeek = (startD.getDay() + 6) % 7;
    const dayOfMonth = startD.getDate();

    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO recurring_rules (user_id, type, category, goal_id, amount, frequency, day_of_week, day_of_month, start_date, end_date, next_run_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, type, category, goalId, amount, frequency, dayOfWeek, dayOfMonth, startDate, endDate, startDate]
    );

    const [[rule]] = await pool.execute<RuleRow[]>(`SELECT * FROM recurring_rules WHERE rule_id = ?`, [res.insertId]);
    const created = await materialize(userId, rule, TOP_UP_TARGET);

    return Response.json({ status: 'success', rule_id: res.insertId, created });
  }

  return Response.json({ error: 'Unknown action.' }, { status: 400 });
}
