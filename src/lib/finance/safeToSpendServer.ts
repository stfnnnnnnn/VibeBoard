// src/lib/finance/safeToSpendServer.ts
/* Shared by /safe-to-spend, /what-if and /wishlist so the three can never disagree (spec §4.4).
   Server-only: imports the pool. */
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { manilaToday, addDays, daysBetween } from './dates';

async function actualTotal(userId: number, table: string, column: string): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(${column}), 0) AS total FROM ${table} WHERE user_id = ? AND status = 'actual'`, [userId]);
  return Number(rows[0].total);
}

async function plannedTotal(userId: number, table: string, column: string, start: string, end: string): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(${column}), 0) AS total FROM ${table} WHERE user_id = ? AND status = 'planned' AND entry_date BETWEEN ? AND ?`,
    [userId, start, end]);
  return Number(rows[0].total);
}

export function computeSafe(balance: number, upcomingRequired: number, upcomingSavings: number) {
  const buffer = balance > 0 ? Math.round(balance * 0.10 * 100) / 100 : 0;
  const rawSafe = balance - upcomingRequired - upcomingSavings - buffer;
  return { buffer, rawSafe, safe: Math.max(0, rawSafe) };
}

export async function loadSpendBase(userId: number) {
  const today = manilaToday();
  const [allowance, expense, savings] = await Promise.all([
    actualTotal(userId, 'allowance', 'allowance_amount'),
    actualTotal(userId, 'expenses', 'expense_amount'),
    actualTotal(userId, 'savings_entries', 'savings_amount'),
  ]);
  const [nextRows] = await pool.execute<RowDataPacket[]>(
    `SELECT entry_date FROM allowance WHERE user_id = ? AND status = 'planned' AND entry_date >= ? ORDER BY entry_date ASC LIMIT 1`,
    [userId, today]);
  const horizonEnd = nextRows.length ? String(nextRows[0].entry_date) : addDays(today, 14);
  const daysUntilNextAllowance = nextRows.length ? daysBetween(today, horizonEnd) : null;
  const [upcomingRequired, upcomingSavings] = await Promise.all([
    plannedTotal(userId, 'expenses', 'expense_amount', today, horizonEnd),
    plannedTotal(userId, 'savings_entries', 'savings_amount', today, horizonEnd),
  ]);
  /* Rounded to cents: summing DECIMAL strings as floats leaves noise (e.g. 1.4e-14) that would
     read as a non-zero balance. */
  return { today, currentBalance: Math.round((allowance - expense - savings) * 100) / 100, horizonEnd, daysUntilNextAllowance, upcomingRequired, upcomingSavings };
}
