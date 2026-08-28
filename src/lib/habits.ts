import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import {
  Weekday, WEEKDAYS, todayInManila, lastNDays, addDaysToDateStr,
  computeConsecutiveScheduledStreak, weekdayOfDateStr,
} from '@/lib/habitDate';
import { occurrenceFulfillment, occurrenceCompleted } from '@/lib/habitFulfillment';

export type HabitPriority = 'core' | 'normal' | 'optional';
export type HabitCategory = 'academic' | 'household' | 'health' | 'social' | 'organizational' | 'life goals';
export type HabitType = 'routine' | 'habit';
export type ScheduleMode = 'fixed' | 'flexible';
export type TrackingType = 'boolean' | 'numeric';
export type Pace = 'ahead' | 'on_pace' | 'behind';

export const PRIORITY_OPTIONS: HabitPriority[] = ['core', 'normal', 'optional'];
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
  priority: HabitPriority;
  task_category: HabitCategory;
  habit_type: HabitType;
  schedule_mode: ScheduleMode;
  tracking_type: TrackingType;
  target_value: number | null;
  minimum_value: number | null;
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
  week_expected: number;
  week_actual: number;
  pace: Pace;
  week_days_remaining: number;
}

export interface HabitInput {
  task_name: string;
  purpose: string;
  priority?: HabitPriority;
  task_category: HabitCategory;
  habit_type: HabitType;
  schedule_mode?: ScheduleMode;
  days_of_week?: Weekday[];
  weekly_target?: number;
  tracking_type?: TrackingType;
  target_value?: number | null;
  minimum_value?: number | null;
  unit_label?: string | null;
  step_value?: number | null;
}

interface HabitRow extends RowDataPacket {
  habit_id: number; user_id: number; task_name: string; purpose: string;
  priority: HabitPriority; task_category: HabitCategory; habit_type: HabitType;
  days_of_week: string; times_per_week: number; date_created: string;
  schedule_mode: ScheduleMode; tracking_type: TrackingType;
  target_value: string | number | null; minimum_value: string | number | null;
  unit_label: string | null; step_value: string | number | null;
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
  priority: HabitPriority;
  scheduleMode: ScheduleMode; trackingType: TrackingType;
  daysStr: string; weeklyTarget: number;
  targetValue: number | null; minimumValue: number | null; unitLabel: string | null; stepValue: number;
}

function validateInput(input: HabitInput): ValidatedHabitInput {
  if (!input.task_name?.trim()) throw new Error('Habit name is required.');
  if (!input.purpose?.trim()) throw new Error('Purpose is required.');
  const priority: HabitPriority = input.priority ?? 'normal';
  if (!PRIORITY_OPTIONS.includes(priority)) throw new Error('Invalid priority.');
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
    if (weeklyTarget > 7) throw new Error("Times per week can't be more than 7.");
  }

  const trackingType: TrackingType = input.tracking_type ?? 'boolean';
  if (!TRACKING_TYPE_OPTIONS.includes(trackingType)) throw new Error('Invalid tracking type.');

  let targetValue: number | null = null;
  let minimumValue: number | null = null;
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
    if (input.minimum_value != null) {
      minimumValue = Number(input.minimum_value);
      if (!minimumValue || minimumValue <= 0) throw new Error('Minimum must be greater than 0.');
      if (minimumValue > targetValue) throw new Error("Minimum can't be greater than the target.");
    }
  }

  return { priority, scheduleMode, trackingType, daysStr, weeklyTarget, targetValue, minimumValue, unitLabel, stepValue };
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

function habitCoreOf(habit: HabitRow) {
  return {
    tracking_type: habit.tracking_type,
    target_value: toNum(habit.target_value),
    minimum_value: toNum(habit.minimum_value),
  };
}

/** Recomputes and persists the fixed-schedule streak for a habit from its full check-in
 * history, anchored at `today`. Shared by checkin/undo/setAmount so all three agree. */
async function recomputeFixedStreak(userId: number, habitId: number, habit: HabitRow): Promise<{ current_streak: number; longest_streak: number }> {
  const { dateStr: today } = todayInManila();
  const scheduled = parseDays(habit.days_of_week);
  const [rows] = await pool.execute<CheckinRow[]>(
    `SELECT checkin_date, is_completed, amount FROM habit_checkins WHERE habit_id = ?`, [habitId]
  );
  const habitCore = habitCoreOf(habit);
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

/** Today's 1-based position within its Mon–Sun week (Monday -> 1, Sunday -> 7). */
function daysElapsedInWeek(dateStr: string): number {
  const weekStart = mondayOfWeek(dateStr);
  const [y1, m1, d1] = weekStart.split('-').map(Number);
  const [y2, m2, d2] = dateStr.split('-').map(Number);
  const start = Date.UTC(y1, m1 - 1, d1);
  const end = Date.UTC(y2, m2 - 1, d2);
  return Math.round((end - start) / 86400000) + 1;
}

function computePace(actual: number, expected: number): Pace {
  if (actual < expected - 0.5) return 'behind';
  if (actual > expected + 0.5) return 'ahead';
  return 'on_pace';
}

export async function getHabitsForUser(userId: number): Promise<HabitWithComputed[]> {
  const { dateStr: today, weekday: todayWeekday } = todayInManila();
  const days = lastNDays(today, 7);
  const weekStart = mondayOfWeek(today);
  const daysElapsed = daysElapsedInWeek(today);
  const weekDaysRemaining = 7 - daysElapsed;

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
    const habitCore = habitCoreOf(row);
    const scheduled = parseDays(row.days_of_week);
    const checkinsByDate = rowsByHabit.get(row.habit_id) ?? new Map();

    const base = {
      habit_id: row.habit_id,
      task_name: row.task_name,
      purpose: row.purpose,
      priority: row.priority,
      task_category: row.task_category,
      habit_type: row.habit_type,
      schedule_mode: row.schedule_mode,
      tracking_type: row.tracking_type,
      target_value: habitCore.target_value,
      minimum_value: habitCore.minimum_value,
      unit_label: row.unit_label,
      step_value: toNum(row.step_value) ?? 1,
      times_per_week: row.times_per_week,
      today_amount: row.tracking_type === 'numeric' ? (checkinsByDate.get(today)?.amount ?? null) : null,
      week_days_remaining: weekDaysRemaining,
    };

    if (row.schedule_mode === 'flexible') {
      let completedThisWeek = 0;
      for (const [date, r] of checkinsByDate) {
        if (date >= weekStart && date <= today && occurrenceCompleted(habitCore, r)) completedThisWeek++;
      }
      const target = Math.max(1, row.times_per_week);
      const week_expected = (daysElapsed / 7) * target;
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
        week_expected,
        week_actual: completedThisWeek,
        pace: computePace(completedThisWeek, week_expected),
      };
    }

    const streak = streakByHabit.get(row.habit_id);
    const current = streak?.current_streak_days ?? 0;
    const timesPerWeek = Math.max(1, row.times_per_week);
    const chain: ChainDay[] = days.map(date => {
      const weekday = weekdayOfDateStr(date);
      const r = checkinsByDate.get(date);
      const fulfillment = r ? occurrenceFulfillment(habitCore, r) : 0;
      const completed = r ? occurrenceCompleted(habitCore, r) : false;
      return { date, weekday, scheduled: scheduled.has(weekday), completed, fulfillment };
    });

    let weekExpectedCount = 0;
    let weekActualCount = 0;
    for (const day of chain) {
      if (day.date >= weekStart && day.date <= today && day.scheduled) {
        weekExpectedCount++;
        if (day.completed) weekActualCount++;
      }
    }

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
      week_expected: weekExpectedCount,
      week_actual: weekActualCount,
      pace: computePace(weekActualCount, weekExpectedCount),
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
  weekly_targets: { completed: number; target: number };
  at_risk: number;
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

  const weekly_targets = habits.reduce(
    (acc, h) => {
      const target = Math.max(1, h.times_per_week);
      return { completed: acc.completed + Math.min(h.week_actual, target), target: acc.target + target };
    },
    { completed: 0, target: 0 }
  );
  const at_risk = habits.filter(h => h.pace === 'behind').length;

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
    today_total, today_completed, longest_streak,
    weekly_targets, at_risk,
    weekly_rhythm, category_consistency, strongest, needs_attention,
  };
}

export async function getHabitHistory(userId: number, habitId: number, weeks: number = 12): Promise<HabitHistoryResponse> {
  const habit = await getOwnedHabitRow(habitId, userId);
  const { dateStr: today } = todayInManila();
  const habitCore = habitCoreOf(habit);

  const currentWeekStart = mondayOfWeek(today);
  const earliestPossibleWeekStart = mondayOfWeek(habit.date_created.slice(0, 10));
  const weekStarts: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDaysToDateStr(currentWeekStart, -7 * i);
    if (ws >= earliestPossibleWeekStart) weekStarts.push(ws);
  }
  const earliestDate = weekStarts[0];

  const [rows] = await pool.execute<CheckinRow[]>(
    `SELECT checkin_date, is_completed, amount FROM habit_checkins WHERE habit_id = ? AND checkin_date >= ? ORDER BY checkin_date ASC`,
    [habitId, earliestDate]
  );
  const perDate = new Map<string, { is_completed: number; amount: number | null }>();
  for (const r of rows) perDate.set(r.checkin_date, { is_completed: r.is_completed, amount: toNum(r.amount) });

  const scheduled = parseDays(habit.days_of_week);
  const weeklyTarget = Math.max(1, habit.times_per_week);

  const weeksData: HabitHistoryWeek[] = weekStarts.map(weekStart => {
    let completed = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDaysToDateStr(weekStart, i);
      if (date > today) break;
      if (habit.schedule_mode === 'fixed' && !scheduled.has(weekdayOfDateStr(date))) continue;
      const r = perDate.get(date);
      if (r && occurrenceCompleted(habitCore, r)) completed++;
    }
    const percent = weeklyTarget > 0 ? Math.min(100, Math.round((completed / weeklyTarget) * 100)) : 0;
    return { week_start: weekStart, completed, target: weeklyTarget, percent };
  });

  let best_week: HabitHistoryWeek | null = null;
  for (const w of weeksData) {
    if (w.completed > 0 && (!best_week || w.completed > best_week.completed)) best_week = w;
  }

  let weekly_streak: number | null = null;
  if (habit.schedule_mode === 'flexible') {
    let count = 0;
    const lastIndex = weeksData.length - 1;
    for (let i = lastIndex; i >= 0; i--) {
      const met = weeksData[i].completed >= weeksData[i].target;
      if (met) {
        count++;
      } else if (i === lastIndex) {
        continue; // in-progress week hasn't hit target yet — don't count it, but don't break the streak either
      } else {
        break;
      }
    }
    weekly_streak = count;
  }

  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM habit_checkins WHERE habit_id = ?`, [habitId]
  );
  const total_checkins = Number(countRows[0].cnt);

  const [recentRows] = await pool.execute<CheckinRow[]>(
    `SELECT checkin_date, is_completed, amount FROM habit_checkins WHERE habit_id = ? ORDER BY checkin_date DESC LIMIT 10`,
    [habitId]
  );
  const recent = recentRows.map(r => ({
    date: r.checkin_date,
    completed: occurrenceCompleted(habitCore, { is_completed: r.is_completed, amount: toNum(r.amount) }),
  }));

  return { weeks: weeksData, best_week, weekly_streak, total_checkins, started_at: habit.date_created, recent };
}

export interface HabitHistoryWeek { week_start: string; completed: number; target: number; percent: number }
export interface HabitHistoryResponse {
  weeks: HabitHistoryWeek[];
  best_week: HabitHistoryWeek | null;
  weekly_streak: number | null;
  total_checkins: number;
  started_at: string;
  recent: { date: string; completed: boolean }[];
}

/* ─────────────────────────── Writes ─────────────────────────── */

export async function createHabit(userId: number, input: HabitInput) {
  const v = validateInput(input);
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO habit_tasks
       (user_id, task_name, purpose, priority, task_category, habit_type,
        days_of_week, times_per_week, schedule_mode, tracking_type, target_value, minimum_value, unit_label, step_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, input.task_name.trim(), input.purpose.trim(), v.priority, input.task_category,
     input.habit_type, v.daysStr, v.weeklyTarget, v.scheduleMode, v.trackingType, v.targetValue, v.minimumValue, v.unitLabel, v.stepValue]
  );
  return res.insertId;
}

export async function updateHabit(userId: number, habitId: number, input: HabitInput) {
  const existingRow = await getOwnedHabitRow(habitId, userId);
  const v = validateInput(input);

  if (v.trackingType !== existingRow.tracking_type) {
    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as cnt FROM habit_checkins WHERE habit_id = ?`, [habitId]
    );
    if (Number(countRows[0].cnt) > 0) {
      throw new Error("Can't change how this ritual is tracked once it has check-in history. Delete it and create a new one instead.");
    }
  }

  await pool.execute(
    `UPDATE habit_tasks
     SET task_name=?, purpose=?, priority=?, task_category=?, habit_type=?, days_of_week=?, times_per_week=?,
         schedule_mode=?, tracking_type=?, target_value=?, minimum_value=?, unit_label=?, step_value=?
     WHERE habit_id=? AND user_id=?`,
    [input.task_name.trim(), input.purpose.trim(), v.priority, input.task_category,
     input.habit_type, v.daysStr, v.weeklyTarget, v.scheduleMode, v.trackingType, v.targetValue, v.minimumValue, v.unitLabel, v.stepValue,
     habitId, userId]
  );

  if (v.scheduleMode === 'fixed') {
    const updatedRow = await getOwnedHabitRow(habitId, userId);
    await recomputeFixedStreak(userId, habitId, updatedRow);
  }
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

  const habitCore = habitCoreOf(habit);
  const completed = occurrenceCompleted(habitCore, { amount });

  if (habit.schedule_mode === 'fixed') {
    await recomputeFixedStreak(userId, habitId, habit);
  }

  return { amount, completed };
}

export async function resetStreak(userId: number, habitId: number): Promise<void> {
  await getOwnedHabitRow(habitId, userId);
  await pool.execute(`DELETE FROM habit_streaks WHERE habit_id = ? AND user_id = ?`, [habitId, userId]);
}
