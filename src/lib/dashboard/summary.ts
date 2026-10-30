/** Builds the dashboard (spec §4.1) from each module's own server code. Server-only: imports
 *  the pool. Every section is isolated — a failing module returns { ok: false }, never throws. */
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import {
  ensureCanvasSchema, ensureHabitPauseSchema, ensureHabitPriorityAndMinimumSchema,
  ensureHabitTrackingSchema, ensureHabitTypeRemovedAndNoteRenamedSchema,
  ensureWorkboardSchema, ensureWorkboardV4Schema,
} from '@/lib/migrate';
import { getHabitsForUser } from '@/lib/habits';
import { computeSafe, loadSpendBase } from '@/lib/finance/safeToSpendServer';
import { safeToSpendStatus } from '@/lib/finance/status';
import { getOverallGPA } from '@/lib/studypulse/gpaSummary';
import { getWorkItems } from '@/lib/workboard/workItems';
import { getWorkboardWeek } from '@/lib/workboard/aggregate';
import { addDays, mondayOf } from '@/lib/workboard/dates';
import { buildWorkboardDigest } from '@/lib/workboard/dashboardDigest';
import { section } from './section';
import { pickNextClass } from './nextClass';
import { dateLine, manilaClock, weekOfTerm } from './headerLine';
import type { DashboardSummary, FinanceTone, HeaderData } from './types';

const TONE: Record<'success' | 'warn' | 'danger', FinanceTone> = { success: 'on_track', warn: 'tight', danger: 'over' };

async function ensureWorkboard() {
  await ensureWorkboardSchema();
  await ensureWorkboardV4Schema();
}

export async function buildDashboardSummary(userId: number, now: Date = new Date()): Promise<DashboardSummary> {
  const clock = manilaClock(now);
  const weekStart = mondayOf(clock.date);

  const [nextClass, habits, finance, study, workboard] = await Promise.all([
    section('nextClass', async () => {
      await ensureWorkboard();
      const [a, b] = await Promise.all([
        getWorkboardWeek(userId, weekStart),
        getWorkboardWeek(userId, addDays(weekStart, 7)),
      ]);
      return pickNextClass([...a.class_occurrences, ...b.class_occurrences], clock.date, clock.hhmm);
    }),
    section('habits', async () => {
      await ensureHabitTrackingSchema();
      await ensureHabitPriorityAndMinimumSchema();
      await ensureHabitTypeRemovedAndNoteRenamedSchema();
      await ensureHabitPauseSchema();
      const list = (await getHabitsForUser(userId)).filter(h => h.task_status !== 'paused');
      if (!list.length) return null;
      const today = list.filter(h => h.is_today);
      return {
        done: today.filter(h => h.checked_in_today).length,
        total: today.length,
        bestStreak: list.reduce((m, h) => Math.max(m, h.current_streak ?? 0), 0),
      };
    }),
    section('finance', async () => {
      const base = await loadSpendBase(userId);
      if (base.currentBalance === 0 && base.upcomingRequired === 0 && base.upcomingSavings === 0) return null;
      const { safe } = computeSafe(base.currentBalance, base.upcomingRequired, base.upcomingSavings);
      // Same per-day rate as /api/finance/safe-to-spend.
      const days = base.daysUntilNextAllowance ?? 14;
      const perDay = days > 0 ? Math.round((safe / days) * 100) / 100 : safe;
      const { tone } = safeToSpendStatus({
        safe_to_spend: safe, upcoming_required: base.upcomingRequired, upcoming_savings: base.upcomingSavings,
        horizon_end: base.horizonEnd, shortfall: 0, shortfall_coverable_by: null, flexible_categories: [],
        current_balance: base.currentBalance,
      });
      return { perDay, safeTotal: safe, tone: TONE[tone] };
    }),
    section('study', async () => {
      const final = await getOverallGPA(userId, 'final');
      const gpa = final > 0 ? final : await getOverallGPA(userId, 'midterm');
      return gpa > 0 ? { gpa } : null;
    }),
    section('workboard', async () => {
      await ensureWorkboard();
      const payload = await getWorkItems(userId);
      return buildWorkboardDigest(payload.items, payload.generated_at, mondayOf(payload.generated_at));
    }),
  ]);

  return { nextClass, habits, finance, study, workboard };
}

const dateOf = (v: unknown) => (v ? String(v).slice(0, 10) : null);

export async function getHeaderData(userId: number, now: Date = new Date()): Promise<HeaderData> {
  const clock = manilaClock(now);
  let week: number | null = null;
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT start_date, end_date FROM trimesters WHERE user_id = ? ORDER BY trimester_id DESC LIMIT 1', [userId]);
    if (rows.length) week = weekOfTerm(dateOf(rows[0].start_date), dateOf(rows[0].end_date), clock.date);
  } catch { /* trimesters table not created yet: no week label */ }

  let canvasConnected = false;
  try {
    await ensureCanvasSchema();
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT 1 FROM canvas_connections WHERE user_id = ? AND status = 'active' LIMIT 1", [userId]);
    canvasConnected = rows.length > 0;
  } catch { /* shows as not connected */ }

  return { dateLine: dateLine(clock.date, clock.hour, week), weekOfTerm: week, canvasConnected };
}
