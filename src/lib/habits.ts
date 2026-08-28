import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  Weekday, WEEKDAYS, todayInManila, lastNDays,
  computeConsecutiveScheduledStreak, URGENCY_RANK, weekdayOfDateStr,
} from '@/lib/habitDate';
import { occurrenceFulfillment, occurrenceCompleted } from '@/lib/habitFulfillment';

export type HabitUrgency = 'Urgent' | 'Priority' | 'Important' | 'Not Important' | 'Not Urgent';
export type HabitCategory = 'academic' | 'household' | 'health' | 'social' | 'organizational' | 'life goals';
export type HabitType = 'routine' | 'habit';
export type ScheduleMode = 'fixed' | 'flexible';
export type TrackingType = 'boolean' | 'numeric';

export const URGENCY_OPTIONS: HabitUrgency[] = ['Urgent', 'Priority', 'Important', 'Not Important', 'Not Urgent'];
export const CATEGORY_OPTIONS: HabitCategory[] = ['academic', 'household', 'health', 'social', 'organizational', 'life goals'];
export const TYPE_OPTIONS: HabitType[] = ['habit', 'routine'];
export const SCHEDULE_MODE_OPTIONS: ScheduleMode[] = ['fixed', 'flexible'];
export const TRACKING_TYPE_OPTIONS: TrackingType[] = ['boolean', 'numeric'];

export interface ChainDay { date: string; weekday: Weekday; scheduled: boolean; completed: boolean; fulfillment: number }
export interface WeekProgress { completed: number; target: number }

export interface HabitWithComputed {
  habit_id: number;
  task_name: string;
  purpose: string;
  habit_urgency: HabitUrgency;
  task_category: HabitCategory;
  habit_type: HabitType;
  schedule_mode: ScheduleMode;
  tracking_type: TrackingType;
  target_value: number | null;
  unit_label: string | null;
  step_value: number;
  days_of_week: Weekday[];
  times_per_week: number;
  is_today: boolean;
  checked_in_today: boolean;
  today_amount: number | null;
  current_streak: number | null;
  longest_streak: number | null;
  streak_percent: number | null;
  chain: ChainDay[] | null;
  week_progress: WeekProgress | null;
}

export interface HabitInput {
  task_name: string;
  purpose: string;
  habit_urgency: HabitUrgency;
  task_category: HabitCategory;
  habit_type: HabitType;
  schedule_mode?: ScheduleMode;
  days_of_week?: Weekday[];
  weekly_target?: number;
  tracking_type?: TrackingType;
  target_value?: number | null;
  unit_label?: string | null;
  step_value?: number | null;
}

interface HabitRow extends RowDataPacket {
  habit_id: number; user_id: number; task_name: string; purpose: string;
  habit_urgency: HabitUrgency; task_category: HabitCategory; habit_type: HabitType;
  days_of_week: string; times_per_week: number; date_created: string;
  schedule_mode: ScheduleMode; tracking_type: TrackingType;
  target_value: string | number | null; unit_label: string | null; step_value: string | number | null;
}
interface StreakRow extends RowDataPacket {
  streak_id: number; user_id: number; habit_id: number; streak_start: string;
  streak_end: string | null; current_streak_days: number; longest_streak: number;
}
interface CheckinRow extends RowDataPacket {
  habit_id: number; checkin_date: string; is_completed: number; amount: string | number | null;
}

export class HabitNotFoundError extends Error {}

function parseDays(raw: string): Set<Weekday> {
  return new Set(raw.split(',').map(d => d.trim()).filter(Boolean)) as Set<Weekday>;
}

function toNum(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface ValidatedHabitInput {
  scheduleMode: ScheduleMode; trackingType: TrackingType;
  daysStr: string; weeklyTarget: number;
  targetValue: number | null; unitLabel: string | null; stepValue: number;
}

function validateInput(input: HabitInput): ValidatedHabitInput {
  if (!input.task_name?.trim()) throw new Error('Habit name is required.');
  if (!input.purpose?.trim()) throw new Error('Purpose is required.');
  if (!URGENCY_OPTIONS.includes(input.habit_urgency)) throw new Error('Invalid urgency.');
  if (!CATEGORY_OPTIONS.includes(input.task_category)) throw new Error('Invalid category.');
  if (!TYPE_OPTIONS.includes(input.habit_type)) throw new Error('Invalid type.');

  const scheduleMode: ScheduleMode = input.schedule_mode ?? 'fixed';
  if (!SCHEDULE_MODE_OPTIONS.includes(scheduleMode)) throw new Error('Invalid schedule mode.');

  let daysStr = '';
  let weeklyTarget: number;
  if (scheduleMode === 'fixed') {
    if (!Array.isArray(input.days_of_week) || !input.days_of_week.length) throw new Error('Pick at least one day.');
    if (input.days_of_week.some(d => !WEEKDAYS.includes(d))) throw new Error('Invalid day of week.');
    daysStr = input.days_of_week.join(',');
    weeklyTarget = input.days_of_week.length;
  } else {
    weeklyTarget = Math.floor(Number(input.weekly_target));
    if (!weeklyTarget || weeklyTarget < 1) throw new Error('Set how many times per week.');
  }

  const trackingType: TrackingType = input.tracking_type ?? 'boolean';
  if (!TRACKING_TYPE_OPTIONS.includes(trackingType)) throw new Error('Invalid tracking type.');

  let targetValue: number | null = null;
  let unitLabel: string | null = null;
  let stepValue = 1;
  if (trackingType === 'numeric') {
    targetValue = Number(input.target_value);
    if (!targetValue || targetValue <= 0) throw new Error('Set a target amount greater than 0.');
    unitLabel = (input.unit_label ?? '').trim();
    if (!unitLabel) throw new Error('Set a unit (e.g. glasses, minutes).');
    if (input.step_value != null) {
      stepValue = Number(input.step_value);
      if (!stepValue || stepValue <= 0) throw new Error('Increment must be greater than 0.');
    }
  }

  return { scheduleMode, trackingType, daysStr, weeklyTarget, targetValue, unitLabel, stepValue };
}

async function getOwnedHabitRow(habitId: number, userId: number): Promise<HabitRow> {
  const [rows] = await pool.execute<HabitRow[]>(
    `SELECT * FROM habit_tasks WHERE habit_id = ? AND user_id = ?`, [habitId, userId]
  );
  if (!rows.length) throw new HabitNotFoundError('Habit not found.');
  return rows[0];
}

async function getLatestStreakRow(habitId: number, userId: number): Promise<StreakRow | null> {
  const [rows] = await pool.execute<StreakRow[]>(
    `SELECT * FROM habit_streaks WHERE habit_id = ? AND user_id = ? ORDER BY streak_id DESC LIMIT 1`,
    [habitId, userId]
  );
  return rows[0] ?? null;
}

/** Recomputes and persists the fixed-schedule streak for a habit from its full check-in
 * history, anchored at `today`. Shared by checkin/undo/setAmount so all three agree. */
async function recomputeFixedStreak(userId: number, habitId: number, habit: HabitRow): Promise<{ current_streak: number; longest_streak: number }> {
  const { dateStr: today } = todayInManila();
  const scheduled = parseDays(habit.days_of_week);
  const [rows] = await pool.execute<CheckinRow[]>(
    `SELECT checkin_date, is_completed, amount FROM habit_checkins WHERE habit_id = ?`, [habitId]
  );
  const habitCore = { tracking_type: habit.tracking_type, target_value: toNum(habit.target_value) };
  const completedDates = new Set(
    rows.filter(r => occurrenceCompleted(habitCore, { is_completed: r.is_completed, amount: toNum(r.amount) }))
        .map(r => r.checkin_date)
  );

  const existing = await getLatestStreakRow(habitId, userId);

  if (completedDates.size === 0) {
    await pool.execute(`DELETE FROM habit_streaks WHERE habit_id = ? AND user_id = ?`, [habitId, userId]);
    return { current_streak: 0, longest_streak: 0 };
  }

  const anchor = completedDates.has(today) ? today : [...completedDates].sort().at(-1)!;
  const { length, start } = computeConsecutiveScheduledStreak(scheduled, completedDates, anchor);
  const longest = Math.max(existing?.longest_streak ?? 0, length);
  const streakStart = start ?? anchor;

  if (existing) {
    await pool.execute(
      `UPDATE habit_streaks SET current_streak_days=?, longest_streak=?, streak_end=?, streak_start=? WHERE streak_id=?`,
      [length, longest, anchor, streakStart, existing.streak_id]
    );
  } else {
    await pool.execute(
      `INSERT INTO habit_streaks (user_id, habit_id, streak_start, streak_end, current_streak_days, longest_streak)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, habitId, streakStart, anchor, length, longest]
    );
  }

  return { current_streak: length, longest_streak: longest };
}

/* ─────────────────────────── Reads ─────────────────────────── */

function mondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sunday..6=Saturday
  const deltaToMonday = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + deltaToMonday);
  return dt.toISOString().slice(0, 10);
}

export async function getHabitsForUser(userId: number): Promise<HabitWithComputed[]> {
  const { dateStr: today, weekday: todayWeekday } = todayInManila();
  const days = lastNDays(today, 7);
  const weekStart = mondayOfWeek(today);

  const [taskRows] = await pool.execute<HabitRow[]>(
    `SELECT * FROM habit_tasks WHERE user_id = ? ORDER BY date_created DESC`, [userId]
  );
  if (!taskRows.length) return [];

  const habitIds = taskRows.map(r => r.habit_id);
  const placeholders = habitIds.map(() => '?').join(',');

  const [streakRows] = await pool.execute<StreakRow[]>(
    `SELECT * FROM habit_streaks WHERE user_id = ? AND habit_id IN (${placeholders}) ORDER BY streak_id DESC`,
    [userId, ...habitIds]
  );
  const streakByHabit = new Map<number, StreakRow>();
  for (const row of streakRows) if (!streakByHabit.has(row.habit_id)) streakByHabit.set(row.habit_id, row);

  const [checkinRows] = await pool.execute<CheckinRow[]>(
    `SELECT habit_id, checkin_date, is_completed, amount FROM habit_checkins
     WHERE habit_id IN (${placeholders}) AND checkin_date BETWEEN ? AND ?`,
    [...habitIds, days[0], days[days.length - 1]]
  );
  const rowsByHabit = new Map<number, Map<string, { is_completed: number; amount: number | null }>>();
  for (const row of checkinRows) {
    if (!rowsByHabit.has(row.habit_id)) rowsByHabit.set(row.habit_id, new Map());
    rowsByHabit.get(row.habit_id)!.set(row.checkin_date, { is_completed: row.is_completed, amount: toNum(row.amount) });
  }

  const result: HabitWithComputed[] = taskRows.map(row => {
    const habitCore = { tracking_type: row.tracking_type, target_value: toNum(row.target_value) };
    const scheduled = parseDays(row.days_of_week);
    const checkinsByDate = rowsByHabit.get(row.habit_id) ?? new Map();

    const base = {
      habit_id: row.habit_id,
      task_name: row.task_name,
      purpose: row.purpose,
      habit_urgency: row.habit_urgency,
      task_category: row.task_category,
      habit_type: row.habit_type,
      schedule_mode: row.schedule_mode,
      tracking_type: row.tracking_type,
      target_value: habitCore.target_value,
      unit_label: row.unit_label,
      step_value: toNum(row.step_value) ?? 1,
      times_per_week: row.times_per_week,
      today_amount: row.tracking_type === 'numeric' ? (checkinsByDate.get(today)?.amount ?? null) : null,
    };

    if (row.schedule_mode === 'flexible') {
      let completedThisWeek = 0;
      for (const [date, r] of checkinsByDate) {
        if (date >= weekStart && date <= today && occurrenceCompleted(habitCore, r)) completedThisWeek++;
      }
      const target = Math.max(1, row.times_per_week);
      return {
        ...base,
        days_of_week: [],
        is_today: true,
        checked_in_today: occurrenceCompleted(habitCore, checkinsByDate.get(today) ?? {}),
        current_streak: null,
        longest_streak: null,
        streak_percent: null,
        chain: null,
        week_progress: { completed: completedThisWeek, target },
      };
    }

    const streak = streakByHabit.get(row.habit_id);
    const current = streak?.current_streak_days ?? 0;
    const timesPerWeek = Math.max(1, row.times_per_week);
    const chain: ChainDay[] = days.map(date => {
      const weekday = weekdayOfDateStr(date);
      const r = checkinsByDate.get(date);
      const fulfillment = r ? occurrenceFulfillment(habitCore, r) : 0;
      return { date, weekday, scheduled: scheduled.has(weekday), completed: fulfillment >= 1, fulfillment };
    });

    return {
      ...base,
      days_of_week: WEEKDAYS.filter(d => scheduled.has(d)),
      is_today: scheduled.has(todayWeekday),
      checked_in_today: occurrenceCompleted(habitCore, checkinsByDate.get(today) ?? {}),
      current_streak: current,
      longest_streak: streak?.longest_streak ?? 0,
      streak_percent: Math.min(100, Math.round((current / timesPerWeek) * 100)),
      chain,
      week_progress: null,
    };
  });

  result.sort((a, b) => Number(b.is_today) - Number(a.is_today));
  return result;
}

export interface WeeklyRhythmDay { date: string; weekday: Weekday; percent: number; scheduled: number; completed: number }
export interface RankedHabit { habit_id: number; task_name: string; percent: number }
export interface CategoryConsistency { category: HabitCategory | 'Overall'; percent: number }

export interface HabitsSummary {
  total_habits: number;
  today_total: number;
  today_completed: number;
  longest_streak: number;
  most_urgent: { habit_id: number; task_name: string; habit_urgency: HabitUrgency } | null;
  weekly_rhythm: WeeklyRhythmDay[];
  category_consistency: CategoryConsistency[];
  strongest: RankedHabit | null;
  needs_attention: RankedHabit | null;
}

function habitFulfillmentRate(habit: HabitWithComputed): number | null {
  if (habit.schedule_mode === 'flexible') {
    if (!habit.week_progress) return null;
    return Math.min(habit.week_progress.completed / Math.max(1, habit.week_progress.target), 1);
  }
  if (!habit.chain) return null;
  const scheduledDays = habit.chain.filter(d => d.scheduled);
  if (!scheduledDays.length) return null;
  return scheduledDays.reduce((s, d) => s + d.fulfillment, 0) / scheduledDays.length;
}

export async function getSummaryForUser(userId: number): Promise<HabitsSummary> {
  const habits = await getHabitsForUser(userId);
  const { dateStr: today } = todayInManila();
  const days = lastNDays(today, 7);

  const today_total = habits.filter(h => h.is_today).length;
  const today_completed = habits.filter(h => h.is_today && h.checked_in_today).length;
  const longest_streak = habits.reduce((max, h) => Math.max(max, h.longest_streak ?? 0), 0);

  let most_urgent: HabitsSummary['most_urgent'] = null;
  for (const h of habits) {
    const rank = URGENCY_RANK[h.habit_urgency] ?? 0;
    const bestRank = most_urgent ? URGENCY_RANK[most_urgent.habit_urgency] ?? 0 : -1;
    if (rank > bestRank || (rank === bestRank && most_urgent && h.task_name < most_urgent.task_name)) {
      most_urgent = { habit_id: h.habit_id, task_name: h.task_name, habit_urgency: h.habit_urgency };
    }
  }

  const fixedHabits = habits.filter(h => h.schedule_mode === 'fixed' && h.chain !== null);
  const weekly_rhythm: WeeklyRhythmDay[] = days.map((date, i) => {
    let scheduled = 0, completed = 0, fulfillmentSum = 0;
    for (const h of fixedHabits) {
      const day = h.chain![i];
      if (!day?.scheduled) continue;
      scheduled++;
      fulfillmentSum += day.fulfillment;
      if (day.completed) completed++;
    }
    return {
      date, weekday: weekdayOfDateStr(date), scheduled, completed,
      percent: scheduled > 0 ? Math.round((fulfillmentSum / scheduled) * 100) : 0,
    };
  });

  const rates: { habit: HabitWithComputed; rate: number }[] = [];
  for (const h of habits) {
    const rate = habitFulfillmentRate(h);
    if (rate !== null) rates.push({ habit: h, rate });
  }

  const category_consistency: CategoryConsistency[] = [];
  if (rates.length > 0) {
    const overallPct = Math.round((rates.reduce((s, r) => s + r.rate, 0) / rates.length) * 100);
    category_consistency.push({ category: 'Overall', percent: overallPct });
  }
  const byCategory = new Map<HabitCategory, number[]>();
  for (const { habit, rate } of rates) {
    if (!byCategory.has(habit.task_category)) byCategory.set(habit.task_category, []);
    byCategory.get(habit.task_category)!.push(rate);
  }
  for (const [category, list] of byCategory) {
    category_consistency.push({ category, percent: Math.round((list.reduce((s, r) => s + r, 0) / list.length) * 100) });
  }
  category_consistency.sort((a, b) => {
    if (a.category === 'Overall') return -1;
    if (b.category === 'Overall') return 1;
    return b.percent - a.percent;
  });

  let strongest: RankedHabit | null = null;
  let needs_attention: RankedHabit | null = null;
  if (rates.length >= 2) {
    const sorted = [...rates].sort((a, b) => b.rate - a.rate);
    const top = sorted[0], bottom = sorted[sorted.length - 1];
    strongest = { habit_id: top.habit.habit_id, task_name: top.habit.task_name, percent: Math.round(top.rate * 100) };
    needs_attention = { habit_id: bottom.habit.habit_id, task_name: bottom.habit.task_name, percent: Math.round(bottom.rate * 100) };
  }

  return {
    total_habits: habits.length,
    today_total, today_completed, longest_streak, most_urgent,
    weekly_rhythm, category_consistency, strongest, needs_attention,
  };
}

/* ─────────────────────────── Writes ─────────────────────────── */

export async function createHabit(userId: number, input: HabitInput) {
  const v = validateInput(input);
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO habit_tasks
       (user_id, task_name, purpose, habit_urgency, task_category, habit_type,
        days_of_week, times_per_week, schedule_mode, tracking_type, target_value, unit_label, step_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, input.task_name.trim(), input.purpose.trim(), input.habit_urgency, input.task_category,
     input.habit_type, v.daysStr, v.weeklyTarget, v.scheduleMode, v.trackingType, v.targetValue, v.unitLabel, v.stepValue]
  );
  return res.insertId;
}

export async function updateHabit(userId: number, habitId: number, input: HabitInput) {
  const v = validateInput(input);
  await getOwnedHabitRow(habitId, userId);
  await pool.execute(
    `UPDATE habit_tasks
     SET task_name=?, purpose=?, habit_urgency=?, task_category=?, habit_type=?, days_of_week=?, times_per_week=?,
         schedule_mode=?, tracking_type=?, target_value=?, unit_label=?, step_value=?
     WHERE habit_id=? AND user_id=?`,
    [input.task_name.trim(), input.purpose.trim(), input.habit_urgency, input.task_category,
     input.habit_type, v.daysStr, v.weeklyTarget, v.scheduleMode, v.trackingType, v.targetValue, v.unitLabel, v.stepValue,
     habitId, userId]
  );
}

export async function deleteHabit(userId: number, habitId: number) {
  const [res] = await pool.execute<ResultSetHeader>(
    `DELETE FROM habit_tasks WHERE habit_id = ? AND user_id = ?`, [habitId, userId]
  );
  if (res.affectedRows === 0) throw new HabitNotFoundError('Habit not found.');
}

export interface StreakResult { current_streak: number | null; longest_streak: number | null }

export async function checkinHabit(userId: number, habitId: number): Promise<StreakResult> {
  const habit = await getOwnedHabitRow(habitId, userId);
  if (habit.tracking_type !== 'boolean') throw new Error('This ritual tracks an amount — log it instead of checking in.');
  const { dateStr: today } = todayInManila();

  await pool.execute(
    `INSERT INTO habit_checkins (habit_id, checkin_date, is_completed) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE is_completed = 1`,
    [habitId, today]
  );

  if (habit.schedule_mode === 'flexible') return { current_streak: null, longest_streak: null };
  return recomputeFixedStreak(userId, habitId, habit);
}

export async function undoCheckinHabit(userId: number, habitId: number): Promise<StreakResult> {
  const habit = await getOwnedHabitRow(habitId, userId);
  if (habit.tracking_type !== 'boolean') throw new Error('This ritual tracks an amount — log it instead of checking in.');
  const { dateStr: today } = todayInManila();

  await pool.execute(`DELETE FROM habit_checkins WHERE habit_id = ? AND checkin_date = ?`, [habitId, today]);

  if (habit.schedule_mode === 'flexible') return { current_streak: null, longest_streak: null };
  return recomputeFixedStreak(userId, habitId, habit);
}

export async function setAmount(userId: number, habitId: number, amount: number, date?: string): Promise<{ amount: number; completed: boolean }> {
  const habit = await getOwnedHabitRow(habitId, userId);
  if (habit.tracking_type !== 'numeric') throw new Error('This ritual is a simple check-in, not an amount.');
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Amount must be zero or a positive number.');

  const targetDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayInManila().dateStr;

  await pool.execute(
    `INSERT INTO habit_checkins (habit_id, checkin_date, amount) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE amount = VALUES(amount)`,
    [habitId, targetDate, amount]
  );

  const targetValue = toNum(habit.target_value);
  const completed = targetValue != null && amount >= targetValue;

  if (habit.schedule_mode === 'fixed') {
    await recomputeFixedStreak(userId, habitId, habit);
  }

  return { amount, completed };
}

export async function resetStreak(userId: number, habitId: number): Promise<void> {
  await getOwnedHabitRow(habitId, userId);
  await pool.execute(`DELETE FROM habit_streaks WHERE habit_id = ? AND user_id = ?`, [habitId, userId]);
}
