import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureFinanceWishlistSchema } from '@/lib/migrate';
import { isExpenseCategory } from '@/lib/finance/categories';

const toItem = (r: RowDataPacket) => ({
  wish_id: Number(r.wish_id), name: String(r.name), amount: Number(r.amount), category: String(r.category),
  status: r.status as 'open' | 'bought' | 'goal', goal_id: r.goal_id === null ? null : Number(r.goal_id),
  expense_id: r.expense_id === null ? null : Number(r.expense_id), created_at: String(r.created_at),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureFinanceWishlistSchema();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM finance_wishlist WHERE user_id = ? ORDER BY status = 'open' DESC, created_at DESC, wish_id DESC`,
    [parseInt(session.user.id)]);
  return Response.json({ items: rows.map(toItem) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureFinanceWishlistSchema();
  const { name, amount, category } = await req.json();
  const cleanName = String(name ?? '').trim().slice(0, 120);
  const numAmount = Number(amount);
  if (!cleanName) return Response.json({ error: 'What do you want to buy?' }, { status: 400 });
  if (!Number.isFinite(numAmount) || numAmount <= 0) return Response.json({ error: 'Amount must be greater than 0.' }, { status: 400 });
  if (numAmount >= 1e10) return Response.json({ error: 'That amount is too large.' }, { status: 400 });
  const cat = isExpenseCategory(String(category ?? '')) ? String(category) : 'leisure';
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO finance_wishlist (user_id, name, amount, category) VALUES (?, ?, ?, ?)`,
    [parseInt(session.user.id), cleanName, numAmount, cat]);
  return Response.json({ wish_id: res.insertId });
}
