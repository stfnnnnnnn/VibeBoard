import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { cycleUsed, instantiateCycle } from '@/lib/finance/cycleServer';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

const VALID_CATEGORIES = ['transportation', 'grocery', 'food', 'academic', 'family', 'leisure', 'emergency', 'miscellaneous', 'healthcare', 'utilities', 'donation', 'savings'];
const VALID_TIERS = ['required', 'target', 'flexible'];

interface TemplateItemInput {
  category: string;
  priority_tier: string;
  allocation_type: 'fixed' | 'percent';
  value: number;
}

/* Same definition Safe-to-Spend uses for "money you actually have" — the
   ceiling on how much of an allowance a plan's cycle can be instantiated
   against. Inlined rather than calling the other route so this stays one
   query inside the same DB transaction as the template save. */
async function currentBalance(userId: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       (SELECT COALESCE(SUM(allowance_amount), 0) FROM allowance WHERE user_id = ? AND status = 'actual') -
       (SELECT COALESCE(SUM(expense_amount), 0) FROM expenses WHERE user_id = ? AND status = 'actual') -
       (SELECT COALESCE(SUM(savings_amount), 0) FROM savings_entries WHERE user_id = ? AND status = 'actual') AS balance`,
    [userId, userId, userId]
  );
  return Math.round(Number(rows[0].balance) * 100) / 100;
}

/* Decision D2: the ceiling on a cycle's allowance. Money already spent (or saved) in the
   current cycle was part of that cycle's allowance, so re-saving the cycle that is running
   (same template, same period_start as its stored last_period_start) may assign
   current balance + what this cycle has already used (cycleUsed: through LEAST(today, its
   stored end)). Any other save — a new plan, or a new
   period — can only assign the money you have now. */
async function allowanceCeiling(userId: number, templateId: number | undefined, periodStart: string): Promise<number> {
  const balance = await currentBalance(userId);
  if (!templateId) return balance;
  const [tpl] = await pool.execute<RowDataPacket[]>(
    `SELECT last_period_start, last_period_end FROM allocation_templates WHERE template_id = ? AND user_id = ?`, [templateId, userId]
  );
  if (!tpl.length || !tpl[0].last_period_start || String(tpl[0].last_period_start) !== periodStart) return balance;
  const used = await cycleUsed(pool, userId, periodStart, tpl[0].last_period_end ? String(tpl[0].last_period_end) : null);
  return Math.round((balance + used) * 100) / 100;
}

/* GET /api/finance/allocation-templates — list every template with its items. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const [templates] = await pool.execute<RowDataPacket[]>(
    `SELECT template_id, name, is_default, last_allowance_amount, last_period_start, last_period_end FROM allocation_templates WHERE user_id = ? ORDER BY created_at ASC`,
    [userId]
  );

  const result = await Promise.all(templates.map(async (t) => {
    const [items] = await pool.execute<RowDataPacket[]>(
      `SELECT item_id, category, priority_tier, allocation_type, amount, percent, sort_order FROM allocation_template_items WHERE template_id = ? ORDER BY sort_order ASC`,
      [t.template_id]
    );
    /* Decision D2: what the active plan's running cycle has already used, so the editor's
       ceiling matches the save check exactly. Additive; null for every other template. */
    const cycle_used = t.is_default && t.last_period_start && t.last_period_end
      ? await cycleUsed(pool, userId, String(t.last_period_start), String(t.last_period_end))
      : null;
    return { ...t, items, cycle_used };
  }));

  return Response.json({ templates: result });
}

/* POST /api/finance/allocation-templates — action: 'save' | 'delete' */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const body = await req.json();
  const { action } = body;

  /* Deleting the active plan must not leave the account with no active plan
     at all — that's what made Budget Progress and Allocate go blank even
     though other templates still existed. If the deleted template was
     is_default, promote the oldest remaining one automatically. */
  if (action === 'delete') {
    const templateId = parseInt(body.template_id);
    const conn: PoolConnection = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [check] = await conn.execute<RowDataPacket[]>(
        `SELECT is_default FROM allocation_templates WHERE template_id = ? AND user_id = ?`, [templateId, userId]
      );
      await conn.execute(`DELETE FROM allocation_templates WHERE template_id = ? AND user_id = ?`, [templateId, userId]);
      if (check.length && check[0].is_default) {
        const [remaining] = await conn.execute<RowDataPacket[]>(
          `SELECT template_id FROM allocation_templates WHERE user_id = ? ORDER BY created_at ASC LIMIT 1`, [userId]
        );
        if (remaining.length) {
          await conn.execute(`UPDATE allocation_templates SET is_default = 1 WHERE template_id = ?`, [remaining[0].template_id]);
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: msg }, { status: 500 });
    } finally {
      conn.release();
    }
    return Response.json({ status: 'success' });
  }

  /* Marks one template "Active" — the plan Spending Plan shows by default and
     the one a new allowance is split against unless the user picks another. */
  if (action === 'set_default') {
    const templateId = parseInt(body.template_id);
    const [check] = await pool.execute<RowDataPacket[]>(
      `SELECT template_id FROM allocation_templates WHERE template_id = ? AND user_id = ?`, [templateId, userId]
    );
    if (!check.length) return Response.json({ error: 'Template not found.' }, { status: 404 });
    await pool.execute(`UPDATE allocation_templates SET is_default = 0 WHERE user_id = ?`, [userId]);
    await pool.execute(`UPDATE allocation_templates SET is_default = 1 WHERE template_id = ?`, [templateId]);
    return Response.json({ status: 'success' });
  }

  if (action === 'save') {
    const templateIdIn: number | undefined = body.template_id ? parseInt(body.template_id) : undefined;
    const name = String(body.name ?? '').trim();
    const items: TemplateItemInput[] = body.items ?? [];

    if (!name) return Response.json({ error: 'Template name is required.' }, { status: 400 });
    if (!items.length) return Response.json({ error: 'Add at least one category to the template.' }, { status: 400 });
    for (const it of items) {
      if (!VALID_CATEGORIES.includes(it.category)) return Response.json({ error: 'Invalid category in template.' }, { status: 400 });
      if (!VALID_TIERS.includes(it.priority_tier)) return Response.json({ error: 'Invalid priority tier in template.' }, { status: 400 });
      if (!['fixed', 'percent'].includes(it.allocation_type)) return Response.json({ error: 'Invalid allocation type in template.' }, { status: 400 });
    }

    // Optional: instantiate this save as a real cycle — a concrete allowance
    // amount over an explicit date range, which computes real peso caps for
    // Budget Progress immediately instead of waiting for a Transactions
    // allowance event to apply the plan. Entirely additive: omit these and
    // saving behaves exactly as before (percentages only, no budget rows).
    const allowanceAmount: number | null = body.allowance_amount ? Number(body.allowance_amount) : null;
    const periodStart: string | null = body.period_start ? String(body.period_start) : null;
    const periodEnd: string | null = body.period_end ? String(body.period_end) : null;

    if (allowanceAmount !== null) {
      if (allowanceAmount <= 0) return Response.json({ error: 'Allowance amount must be greater than 0.' }, { status: 400 });
      if (!periodStart || isNaN(Date.parse(periodStart)) || !periodEnd || isNaN(Date.parse(periodEnd))) {
        return Response.json({ error: 'A valid start and end date are required for the allowance period.' }, { status: 400 });
      }
      if (periodEnd < periodStart) {
        return Response.json({ error: 'The period end date must be after the start date.' }, { status: 400 });
      }
      const ceiling = await allowanceCeiling(userId, templateIdIn, periodStart);
      if (allowanceAmount > ceiling) {
        return Response.json({ error: `That's more than your remaining allowance of ₱${ceiling.toFixed(2)}.` }, { status: 400 });
      }
    }

    const conn: PoolConnection = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let templateId = templateIdIn;

      if (templateId) {
        const [check] = await conn.execute<RowDataPacket[]>(
          `SELECT template_id FROM allocation_templates WHERE template_id = ? AND user_id = ?`, [templateId, userId]
        );
        if (!check.length) throw new Error('Template not found.');
        await conn.execute(`UPDATE allocation_templates SET name = ? WHERE template_id = ?`, [name, templateId]);
        await conn.execute(`DELETE FROM allocation_template_items WHERE template_id = ?`, [templateId]);
      } else {
        const [res] = await conn.execute<ResultSetHeader>(
          `INSERT INTO allocation_templates (user_id, name) VALUES (?, ?)`, [userId, name]
        );
        templateId = res.insertId;
        // The first template a user creates becomes the active plan automatically — there's
        // otherwise no "Active Plan" to show in Spending Plan until one is explicitly chosen.
        const [[{ count }]] = await conn.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS count FROM allocation_templates WHERE user_id = ?`, [userId]
        );
        if (Number(count) === 1) {
          await conn.execute(`UPDATE allocation_templates SET is_default = 1 WHERE template_id = ?`, [templateId]);
        }
      }

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const amount = it.allocation_type === 'fixed' ? it.value : null;
        const percent = it.allocation_type === 'percent' ? it.value : null;
        await conn.execute(
          `INSERT INTO allocation_template_items (template_id, category, priority_tier, allocation_type, amount, percent, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [templateId, it.category, it.priority_tier, it.allocation_type, amount, percent, i]
        );
      }

      if (allowanceAmount !== null && periodStart && periodEnd) {
        // Giving a plan a concrete cycle amount is effectively activating it.
        await conn.execute(`UPDATE allocation_templates SET is_default = 0 WHERE user_id = ?`, [userId]);
        await conn.execute(`UPDATE allocation_templates SET is_default = 1 WHERE template_id = ?`, [templateId]);
        // Writes the cycle onto the template and upserts its template-scoped budget rows
        // (expense + savings). Saving always resets overrides, as it always has.
        await instantiateCycle(conn, userId, templateId!, allowanceAmount, periodStart, periodEnd);
      }

      await conn.commit();
      return Response.json({ status: 'success', template_id: templateId });
    } catch (err) {
      await conn.rollback();
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: msg }, { status: 500 });
    } finally {
      conn.release();
    }
  }

  return Response.json({ error: 'Unknown action.' }, { status: 400 });
}
