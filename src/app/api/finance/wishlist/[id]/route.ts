import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureFinanceWishlistSchema } from '@/lib/migrate';
import { manilaToday } from '@/lib/finance/dates';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH { action: 'buy' | 'save' | 'reopen' } (spec §10.2). Each action runs in one
   transaction so the wish and the expense/goal it creates can't disagree. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureFinanceWishlistSchema();
  const userId = parseInt(session.user.id);
  const wishId = parseInt((await params).id);
  const { action } = await req.json();
  if (!['buy', 'save', 'reopen'].includes(action)) return Response.json({ error: 'Invalid action.' }, { status: 400 });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(`SELECT * FROM finance_wishlist WHERE wish_id = ? AND user_id = ? FOR UPDATE`, [wishId, userId]);
    if (!rows.length) { await conn.rollback(); return Response.json({ error: 'Not found.' }, { status: 404 }); }
    const wish = rows[0];

    if (action === 'buy') {
      if (wish.status !== 'open') { await conn.rollback(); return Response.json({ error: 'Already handled.' }, { status: 409 }); }
      const [res] = await conn.execute<ResultSetHeader>(
        `INSERT INTO expenses (user_id, category, expense_amount, entry_date, status) VALUES (?, ?, ?, ?, 'actual')`,
        [userId, wish.category, wish.amount, manilaToday()]);
      await conn.execute(`UPDATE finance_wishlist SET status = 'bought', expense_id = ? WHERE wish_id = ?`, [res.insertId, wishId]);
      await conn.commit();
      return Response.json({ expense_id: res.insertId });
    }

    if (action === 'save') {
      if (wish.status !== 'open') { await conn.rollback(); return Response.json({ error: 'Already handled.' }, { status: 409 }); }
      const [res] = await conn.execute<ResultSetHeader>(
        `INSERT INTO savings_goals (user_id, goal_name, wishlist_amount, wishlist_category, target_date) VALUES (?, ?, ?, 'others', NULL)`,
        [userId, wish.name, wish.amount]);
      await conn.execute(`UPDATE finance_wishlist SET status = 'goal', goal_id = ? WHERE wish_id = ?`, [res.insertId, wishId]);
      await conn.commit();
      return Response.json({ goal_id: res.insertId });
    }

    // reopen: undo a buy or a save
    if (wish.expense_id) await conn.execute(`DELETE FROM expenses WHERE expense_id = ? AND user_id = ?`, [wish.expense_id, userId]);
    if (wish.goal_id) {
      const [entries] = await conn.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM savings_entries WHERE goal_id = ?`, [wish.goal_id]);
      if (Number(entries[0].n) > 0) { await conn.rollback(); return Response.json({ error: 'That goal already has savings logged, so it stays.' }, { status: 409 }); }
      await conn.execute(`DELETE FROM savings_goals WHERE goal_id = ? AND user_id = ?`, [wish.goal_id, userId]);
    }
    await conn.execute(`UPDATE finance_wishlist SET status = 'open', expense_id = NULL, goal_id = NULL WHERE wish_id = ?`, [wishId]);
    await conn.commit();
    return Response.json({ status: 'success' });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureFinanceWishlistSchema();
  await pool.execute(`DELETE FROM finance_wishlist WHERE wish_id = ? AND user_id = ?`, [parseInt((await params).id), parseInt(session.user.id)]);
  return Response.json({ status: 'success' });
}
