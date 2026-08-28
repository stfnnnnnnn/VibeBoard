# Habit Tracker v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add flexible (weekly-count) scheduling and boolean/numeric tracking to the Habit Tracker, with fulfillment-weighted Rhythm analytics, per the approved spec.

**Architecture:** Two new nullable/defaulted columns-sets on `habit_tasks`/`habit_checkins` (idempotent migration). A single `occurrenceFulfillment`/`occurrenceCompleted` helper pair becomes the one place completion is derived, so numeric habits never trust a stored `is_completed`. `src/lib/habits.ts` and `src/components/habits/HabitsDashboard.tsx` are each rewritten in full (the changes are too interleaved across shared types to land as safe incremental diffs) — every other file gets a small, targeted change.

**Tech Stack:** Next.js 15 App Router, TypeScript, mysql2/promise, no test framework installed (verification is `tsc --noEmit` + real local-DB calls via a locally-signed dev-secret session token, matching how v1 was verified — no browser-automation tool is available in this environment).

**Spec:** `docs/superpowers/specs/2026-08-28-habit-tracker-v2-design.md` — read it before Task 1; this plan assumes its full detail (data model rationale, the completion-derivation rule, target semantics, exact API/UI direction).

## Global Constraints

- `target_value` is always per-occurrence, never a weekly total (spec: "Target semantics").
- Numeric check-ins never write `is_completed`; every read derives completion from `amount >= target_value` at read time (spec: "completion-derivation rule").
- Flexible habits never write to `habit_streaks` in this pass (spec Non-goals).
- Existing fixed+boolean habits must be byte-identical in behavior after this change (defaults: `schedule_mode='fixed'`, `tracking_type='boolean'`).
- No new npm dependencies.

---

### Task 1: Schema migration

**Files:**
- Modify: `src/lib/migrate.ts` (add new function, following the exact pattern of `ensureCanvasSchema` already in this file)

**Interfaces:**
- Produces: `ensureHabitTrackingSchema(): Promise<void>` — idempotent, safe to call on every request.

- [ ] **Step 1: Add the migration function**

Add near the bottom of `src/lib/migrate.ts` (after `ensureCanvasSchema`, before its closing and outside it):

```ts
let _ranHabitsV2 = false;

/** Add flexible-scheduling / numeric-tracking columns to the habit tables if not already present. */
export async function ensureHabitTrackingSchema(): Promise<void> {
  if (_ranHabitsV2) return;

  const alterations: [string, string][] = [
    ['habit_tasks', `ADD COLUMN schedule_mode ENUM('fixed','flexible') NOT NULL DEFAULT 'fixed'`],
    ['habit_tasks', `ADD COLUMN tracking_type ENUM('boolean','numeric') NOT NULL DEFAULT 'boolean'`],
    ['habit_tasks', `ADD COLUMN target_value DECIMAL(6,1) NULL`],
    ['habit_tasks', `ADD COLUMN unit_label VARCHAR(24) NULL`],
    ['habit_tasks', `ADD COLUMN step_value DECIMAL(6,1) NULL DEFAULT 1`],
    ['habit_checkins', `ADD COLUMN amount DECIMAL(6,1) NULL`],
  ];

  for (const [table, clause] of alterations) {
    try {
      await pool.query(`ALTER TABLE \`${table}\` ${clause}`);
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
    }
  }

  _ranHabitsV2 = true;
}
```

Also add `let _ranHabitsV2 = false;` next to the other `_ran*` flags at the top of the file (module-level, alongside `_ranAc`, `_ranGs`, etc.) instead of inline if you prefer — either location works since it's still module-scoped; keeping it declared right above the function it gates (as shown) matches this file's existing per-flag proximity style closely enough. Pick one placement and be consistent.

- [ ] **Step 2: Verify against the real local dev DB**

Run (from the project root, Git Bash):
```bash
node -e "
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', database: 'vibeboard' });
  await conn.query(\"ALTER TABLE habit_tasks ADD COLUMN schedule_mode ENUM('fixed','flexible') NOT NULL DEFAULT 'fixed'\").catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') throw e; });
  await conn.query(\"ALTER TABLE habit_tasks ADD COLUMN tracking_type ENUM('boolean','numeric') NOT NULL DEFAULT 'boolean'\").catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') throw e; });
  await conn.query('ALTER TABLE habit_tasks ADD COLUMN target_value DECIMAL(6,1) NULL').catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') throw e; });
  await conn.query('ALTER TABLE habit_tasks ADD COLUMN unit_label VARCHAR(24) NULL').catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') throw e; });
  await conn.query('ALTER TABLE habit_tasks ADD COLUMN step_value DECIMAL(6,1) NULL DEFAULT 1').catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') throw e; });
  await conn.query('ALTER TABLE habit_checkins ADD COLUMN amount DECIMAL(6,1) NULL').catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') throw e; });
  const [rows] = await conn.query('SHOW COLUMNS FROM habit_tasks');
  console.log(rows.map(r => r.Field).join(', '));
  await conn.end();
})();
"
```
Expected: no errors, and the printed column list includes `schedule_mode, tracking_type, target_value, unit_label, step_value` alongside the original columns. (This step exercises the exact same idempotent ALTER statements the new function runs — running it here directly is faster feedback than starting the dev server, and running it a second time should also produce no errors, proving idempotency.)

Run it a second time immediately after — expected: identical output, no errors (proves `ER_DUP_FIELDNAME` handling works).

- [ ] **Step 3: Commit**

```bash
git add src/lib/migrate.ts
git commit -m "Add idempotent schema migration for flexible scheduling and numeric tracking"
```

---

### Task 2: Shared fulfillment helper

**Files:**
- Create: `src/lib/habitFulfillment.ts`

**Interfaces:**
- Produces: `occurrenceFulfillment(habit, row): number` (0–1), `occurrenceCompleted(habit, row): boolean`, exported types `FulfillmentHabit`, `FulfillmentRow`.
- Consumed by: Task 3 (`src/lib/habits.ts`).

- [ ] **Step 1: Write the file**

```ts
// The one place completion is derived for both tracking types. Numeric
// check-ins never store a trusted is_completed (see the spec's
// "completion-derivation rule") — amount is the only fact, and completion
// is recomputed here every time, against whatever target_value currently
// is. Boolean check-ins have no amount to derive from, so is_completed
// stays authoritative for them, and this function reduces to reading it.

export interface FulfillmentHabit {
  tracking_type: 'boolean' | 'numeric';
  target_value: number | null;
}

export interface FulfillmentRow {
  is_completed?: number | null;
  amount?: number | null;
}

export function occurrenceFulfillment(habit: FulfillmentHabit, row: FulfillmentRow): number {
  if (habit.tracking_type === 'boolean') return row.is_completed ? 1 : 0;
  if (row.amount == null || !habit.target_value) return 0;
  return Math.min(row.amount / habit.target_value, 1);
}

export function occurrenceCompleted(habit: FulfillmentHabit, row: FulfillmentRow): boolean {
  return occurrenceFulfillment(habit, row) >= 1;
}
```

- [ ] **Step 2: Verify with tsc**

```bash
npx tsc --noEmit
```
Expected: no new errors (this file has no external dependents yet, so it should compile standalone).

- [ ] **Step 3: Commit**

```bash
git add src/lib/habitFulfillment.ts
git commit -m "Add shared occurrence-fulfillment helper for boolean/numeric habits"
```

---

### Task 3: Rewrite `src/lib/habits.ts`

This is the core of the feature. One task, staged internally, committed once as a working whole — splitting it into separate commits would leave intermediate states that don't type-check, since types are shared across every function in this file.

**Files:**
- Modify: `src/lib/habits.ts` (full rewrite)

**Interfaces:**
- Consumes: `occurrenceFulfillment`, `occurrenceCompleted`, `FulfillmentHabit`, `FulfillmentRow` from `@/lib/habitFulfillment` (Task 2); `WEEKDAYS`, `Weekday`, `todayInManila`, `lastNDays`, `computeConsecutiveScheduledStreak`, `weekdayOfDateStr`, `URGENCY_RANK` from `@/lib/habitDate` (unchanged).
- Produces (new/changed exports consumed by Tasks 4–6):
  - `ScheduleMode = 'fixed' | 'flexible'`, `TrackingType = 'boolean' | 'numeric'`, `SCHEDULE_MODE_OPTIONS`, `TRACKING_TYPE_OPTIONS`
  - `WeekProgress { completed: number; target: number }`
  - `ChainDay { date; weekday; scheduled; completed; fulfillment }` (adds `fulfillment: number`)
  - `HabitWithComputed` (adds `schedule_mode`, `tracking_type`, `target_value`, `unit_label`, `step_value`, `today_amount`, `week_progress`; `current_streak`/`longest_streak`/`streak_percent`/`chain` become `| null`)
  - `HabitInput` (adds optional `schedule_mode`, `weekly_target`, `tracking_type`, `target_value`, `unit_label`, `step_value`)
  - `RankedHabit { habit_id; task_name; percent }`, `CategoryConsistency { category: HabitCategory | 'Overall'; percent: number }`
  - `HabitsSummary` (adds `strongest: RankedHabit | null`, `needs_attention: RankedHabit | null`; `category_consistency` items now `CategoryConsistency`, no longer carry `scheduled`/`completed`)
  - `StreakResult { current_streak: number | null; longest_streak: number | null }` (was non-nullable)
  - `setAmount(userId, habitId, amount, date?): Promise<{ amount: number; completed: boolean }>` (new)
  - `getHabitsForUser`, `getSummaryForUser`, `createHabit`, `updateHabit`, `deleteHabit`, `checkinHabit`, `undoCheckinHabit`, `resetStreak`, `HabitNotFoundError` — same names/shapes as before, updated bodies.

**Design decisions being encoded here (stated explicitly so the "why" isn't lost in the diff):**
- Flexible habits are always `is_today: true` — with no fixed weekdays, every day is a candidate day, so the existing "Today" filter should always surface them. This wasn't pinned down in the spec; it's the simplest reading consistent with "flexible = any day counts."
- `category_consistency` and `strongest`/`needs_attention` are now averaged **per habit** (each habit contributes one fulfillment-rate number), not pooled across occurrence-days as before. This is what makes a flexible habit's single "this week" ratio combine correctly with a fixed habit's per-day average — pooling raw day-counts across the two schedule modes wouldn't have a consistent unit.
- `weekly_rhythm` (the daily bars) stays occurrence-day-pooled, but only over **fixed** habits — a flexible habit has no fixed weekday to attribute a day-bucket to, so it can't contribute to "how did Tuesday go" in the same way.

- [ ] **Step 1: Replace the entire file**

```ts
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
```

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit
```
Expected: errors in `src/components/habits/HabitsDashboard.tsx` (it references the old shapes) — that's fine, Task 6 fixes it. Confirm there are **no errors in `src/lib/habits.ts` itself or in the API route files** (`src/app/api/habits/**`) at this point; those routes only pass `HabitInput`/results through generically and shouldn't break.

- [ ] **Step 3: Verify against the real local dev DB**

Use the same locally-signed session-token approach as the v1 verification (see `habittracker-log.md` for the exact `next-auth/jwt` `encode()` recipe — secret `vibeboard-dev-secret-replace-in-common` from `.env.local`'s `AUTH_SECRET`, salt `'authjs.session-token'`, cookie `authjs.session-token`). Start the dev server if it isn't already running (`npm run dev`), then:

1. Create a fixed+boolean habit (today's default shape) via `POST /api/habits` with no new fields — confirm `GET /api/habits` shows `schedule_mode: 'fixed', tracking_type: 'boolean'` and the existing chain/streak fields populate as before (regression check).
2. Create a flexible+boolean habit (`schedule_mode: 'flexible', weekly_target: 3`, no `days_of_week`) — confirm `GET /api/habits` returns `chain: null`, `week_progress: { completed: 0, target: 3 }`, `current_streak: null`.
3. Create a fixed+numeric habit (`tracking_type: 'numeric', target_value: 30, unit_label: 'min'`) — confirm it's created and the chain still populates (numeric habits keep the chain when fixed).
4. `POST /api/habits/{numeric_habit_id}/checkin` — expect `400` with the "log it instead of checking in" message.
5. Run this task's own verification script (a temporary Node script following the same pattern as Task 1 — query the DB directly to confirm the inserted rows have the right `schedule_mode`/`tracking_type`/`target_value`/`unit_label` values) rather than relying on the API alone, to be sure the write path is correct independent of any read-path bug.

- [ ] **Step 4: Commit**

```bash
git add src/lib/habits.ts
git commit -m "Rewrite habits.ts for flexible scheduling, numeric tracking, and fulfillment-weighted summaries"
```

---

### Task 4: New `PUT /api/habits/[id]/amount` route

**Files:**
- Create: `src/app/api/habits/[id]/amount/route.ts`
- Modify: `src/app/api/habits/route.ts`, `src/app/api/habits/[id]/route.ts`, `src/app/api/habits/[id]/checkin/route.ts`, `src/app/api/habits/summary/route.ts` (add the migration call — see Step 2)

**Interfaces:**
- Consumes: `setAmount`, `HabitNotFoundError` from `@/lib/habits` (Task 3); `ensureHabitTrackingSchema` from `@/lib/migrate` (Task 1).

- [ ] **Step 1: Create the amount route**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema } from '@/lib/migrate';
import { setAmount, HabitNotFoundError } from '@/lib/habits';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();

  const { id } = await params;
  const habitId = parseInt(id);
  const { amount, date } = await req.json();
  const numAmount = Number(amount);

  try {
    const result = await setAmount(parseInt(session.user.id), habitId, numAmount, date);
    return Response.json({ status: 'success', ...result });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
```

- [ ] **Step 2: Add `await ensureHabitTrackingSchema();` to the four existing route files**

In each file, add the import `import { ensureHabitTrackingSchema } from '@/lib/migrate';` and call `await ensureHabitTrackingSchema();` immediately after the `session?.user?.id` auth check in **every** exported handler, matching the existing convention used elsewhere in this codebase (e.g. `src/app/api/studypulse/entries/route.ts`'s `await ensureAccomplishedAt();` placement).

`src/app/api/habits/route.ts` — both `GET` and `POST` need the call:
```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema } from '@/lib/migrate';
import { getHabitsForUser, createHabit, type HabitInput } from '@/lib/habits';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();

  const habits = await getHabitsForUser(parseInt(session.user.id));
  return Response.json({ habits });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();

  const body = (await req.json()) as HabitInput;
  try {
    const habit_id = await createHabit(parseInt(session.user.id), body);
    return Response.json({ status: 'success', habit_id });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

`src/app/api/habits/[id]/route.ts` — both `PATCH` and `DELETE`:
```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema } from '@/lib/migrate';
import { updateHabit, deleteHabit, HabitNotFoundError, type HabitInput } from '@/lib/habits';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  const { id } = await params;
  const habitId = parseInt(id);

  const body = (await req.json()) as HabitInput;
  try {
    await updateHabit(parseInt(session.user.id), habitId, body);
    return Response.json({ status: 'success' });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  const { id } = await params;
  const habitId = parseInt(id);

  try {
    await deleteHabit(parseInt(session.user.id), habitId);
    return Response.json({ status: 'success' });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
```

`src/app/api/habits/[id]/checkin/route.ts` — both `POST` and `DELETE`:
```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema } from '@/lib/migrate';
import { checkinHabit, undoCheckinHabit, HabitNotFoundError } from '@/lib/habits';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  const { id } = await params;
  const habitId = parseInt(id);

  try {
    const result = await checkinHabit(parseInt(session.user.id), habitId);
    return Response.json({ status: 'success', ...result });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  const { id } = await params;
  const habitId = parseInt(id);

  try {
    const result = await undoCheckinHabit(parseInt(session.user.id), habitId);
    return Response.json({ status: 'success', ...result });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
```

`src/app/api/habits/summary/route.ts`:
```ts
import { auth } from '@/auth';
import { ensureHabitTrackingSchema } from '@/lib/migrate';
import { getSummaryForUser } from '@/lib/habits';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();

  const summary = await getSummaryForUser(parseInt(session.user.id));
  return Response.json(summary);
}
```

(The `[id]/streak/route.ts` file is untouched — resetting a streak doesn't depend on the new columns existing, and by the time any of the above handlers have run once, the migration has already applied for the whole process anyway.)

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```
Expected: same as Task 3 Step 2 — only `HabitsDashboard.tsx` errors remain.

- [ ] **Step 4: Verify the amount endpoint against the real local dev DB**

Using the same locally-signed session token:
1. `PUT /api/habits/{numeric_habit_id}/amount` with `{ "amount": 6 }` — expect `{ status: 'success', amount: 6, completed: false }` (target was 30).
2. `PUT` again with `{ "amount": 35 }` — expect `completed: true`.
3. `PUT` with `{ "amount": 0 }` — expect `{ status: 'success', amount: 0, completed: false }`, and confirm via `GET /api/habits` that `today_amount: 0` (not `null` — a row exists).
4. `PUT /api/habits/{boolean_habit_id}/amount` — expect `400` ("simple check-in, not an amount").
5. Cross-user isolation: sign a token for a different `user_id` and `PUT` against the first user's numeric habit — expect `404`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/habits
git commit -m "Add PUT /api/habits/[id]/amount and wire the schema migration into every habits route"
```

---

### Task 5: Rewrite `src/components/habits/HabitsDashboard.tsx`

**Files:**
- Modify: `src/components/habits/HabitsDashboard.tsx` (full rewrite)

**Interfaces:**
- Consumes: `HabitWithComputed`, `HabitsSummary`, `HabitCategory`, `HabitUrgency`, `HabitType`, `ScheduleMode`, `TrackingType`, `WeekProgress` (type-only) from `@/lib/habits` (Task 3).

- [ ] **Step 1: Replace the entire file**

```tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Home, Plus, Minus, Check, Undo2, Pencil, Trash2, Flame, Trophy,
  ListChecks, AlertTriangle, X, RotateCcw, Loader2, Sparkles,
} from 'lucide-react';
import type {
  HabitWithComputed, HabitsSummary, HabitCategory, HabitUrgency, HabitType,
  ScheduleMode, TrackingType, WeekProgress,
} from '@/lib/habits';

/* ─── Static vocab (mirrors the DB enums / SET column) ─── */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const WEEKDAY_SHORT: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

const CATEGORY_OPTIONS: HabitCategory[] = ['academic', 'household', 'health', 'social', 'organizational', 'life goals'];
const CATEGORY_COLORS: Record<HabitCategory, string> = {
  academic: '#6c8efb', health: '#42c38b', household: '#ffb46e',
  'life goals': '#f58fb1', organizational: '#51c4d3', social: '#f28585',
};
const CATEGORY_LABELS: Record<HabitCategory, string> = {
  academic: 'Academic', health: 'Health', household: 'Household',
  'life goals': 'Life Goals', organizational: 'Organizational', social: 'Social',
};

const URGENCY_OPTIONS: HabitUrgency[] = ['Urgent', 'Priority', 'Important', 'Not Important', 'Not Urgent'];
const URGENCY_STYLES: Record<HabitUrgency, { bg: string; fg: string }> = {
  Urgent: { bg: '#f75b67', fg: '#fff' },
  Priority: { bg: '#f79f24', fg: '#fff' },
  Important: { bg: '#f7d324', fg: '#3a3200' },
  'Not Important': { bg: '#91cfff', fg: '#003366' },
  'Not Urgent': { bg: '#b28eff', fg: '#fff' },
};

const TYPE_OPTIONS: HabitType[] = ['habit', 'routine'];

const ACTIVE_TOGGLE_STYLE = { background: '#74bcd9', color: '#fff', borderColor: '#74bcd9' };

type FilterValue = 'today' | 'all' | string; // 'category:x' | 'urgency:x' | 'day:x'

/* ─── Form state ─── */

interface FormState {
  habit_id: number | null;
  task_name: string;
  purpose: string;
  habit_urgency: HabitUrgency | '';
  task_category: HabitCategory | '';
  habit_type: HabitType | '';
  schedule_mode: ScheduleMode;
  days_of_week: string[];
  weekly_target: string;
  tracking_type: TrackingType;
  target_value: string;
  unit_label: string;
  step_value: string;
}
const EMPTY_FORM: FormState = {
  habit_id: null, task_name: '', purpose: '', habit_urgency: '', task_category: '', habit_type: '',
  schedule_mode: 'fixed', days_of_week: [], weekly_target: '3',
  tracking_type: 'boolean', target_value: '', unit_label: '', step_value: '1',
};

/* ─── Component ─── */

export default function HabitsDashboard({ firstName }: { firstName: string }) {
  const [habits, setHabits] = useState<HabitWithComputed[] | null>(null);
  const [summary, setSummary] = useState<HabitsSummary | null>(null);
  const [filter, setFilter] = useState<FilterValue>('today');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [hRes, sRes] = await Promise.all([fetch('/api/habits'), fetch('/api/habits/summary')]);
    const hData = await hRes.json();
    const sData = await sRes.json();
    setHabits(hData.habits ?? []);
    setSummary(sData);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Filtering (client-side, same shape of facets as the legacy dropdown) ── */
  const filtered = useMemo(() => {
    if (!habits) return [];
    if (filter === 'all') return habits;
    if (filter === 'today') return habits.filter(h => h.is_today);
    const [kind, value] = filter.split(':');
    if (kind === 'category') return habits.filter(h => h.task_category === value);
    if (kind === 'urgency') return habits.filter(h => h.habit_urgency === value);
    if (kind === 'day') return habits.filter(h => h.days_of_week.includes(value as typeof WEEKDAYS[number]));
    return habits;
  }, [habits, filter]);

  /* ── Modal ── */
  const openAdd = () => { setForm(EMPTY_FORM); setFormError(null); setModalOpen(true); };
  const openEdit = (h: HabitWithComputed) => {
    setForm({
      habit_id: h.habit_id, task_name: h.task_name, purpose: h.purpose,
      habit_urgency: h.habit_urgency, task_category: h.task_category, habit_type: h.habit_type,
      schedule_mode: h.schedule_mode, days_of_week: h.days_of_week, weekly_target: String(h.times_per_week),
      tracking_type: h.tracking_type,
      target_value: h.target_value != null ? String(h.target_value) : '',
      unit_label: h.unit_label ?? '',
      step_value: String(h.step_value ?? 1),
    });
    setFormError(null);
    setModalOpen(true);
  };
  const closeModal = () => { setModalOpen(false); setFormError(null); };
  const toggleDay = (day: string) => {
    setForm(f => ({
      ...f,
      days_of_week: f.days_of_week.includes(day) ? f.days_of_week.filter(d => d !== day) : [...f.days_of_week, day],
    }));
  };

  const submitForm = async () => {
    if (!form.task_name.trim() || !form.purpose.trim() || !form.habit_urgency || !form.task_category || !form.habit_type) {
      setFormError('Fill in every field before saving.');
      return;
    }
    if (form.schedule_mode === 'fixed' && form.days_of_week.length === 0) {
      setFormError('Pick at least one day.');
      return;
    }
    if (form.schedule_mode === 'flexible' && (!form.weekly_target || Number(form.weekly_target) < 1)) {
      setFormError('Set how many times per week.');
      return;
    }
    if (form.tracking_type === 'numeric' && (!form.target_value || Number(form.target_value) <= 0 || !form.unit_label.trim())) {
      setFormError('Set a target amount and a unit.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const body: Record<string, unknown> = {
      task_name: form.task_name, purpose: form.purpose, habit_urgency: form.habit_urgency,
      task_category: form.task_category, habit_type: form.habit_type,
      schedule_mode: form.schedule_mode, tracking_type: form.tracking_type,
    };
    if (form.schedule_mode === 'fixed') body.days_of_week = form.days_of_week;
    else body.weekly_target = Number(form.weekly_target);
    if (form.tracking_type === 'numeric') {
      body.target_value = Number(form.target_value);
      body.unit_label = form.unit_label.trim();
      body.step_value = form.step_value ? Number(form.step_value) : 1;
    }
    const res = await fetch(form.habit_id ? `/api/habits/${form.habit_id}` : '/api/habits', {
      method: form.habit_id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormError(data.error ?? 'Something went wrong. Try again.'); return; }
    setModalOpen(false);
    await load();
  };

  /* ── Row actions ── */
  const withBusy = async (id: number, fn: () => Promise<void>) => {
    setBusyId(id);
    try { await fn(); } finally { setBusyId(null); }
  };

  const doCheckin = (id: number) => withBusy(id, async () => {
    await fetch(`/api/habits/${id}/checkin`, { method: 'POST' });
    await load();
  });
  const doUndo = (id: number) => withBusy(id, async () => {
    await fetch(`/api/habits/${id}/checkin`, { method: 'DELETE' });
    await load();
  });
  const doDelete = (id: number) => withBusy(id, async () => {
    if (!confirm('Delete this ritual? This also clears its check-in history and streak.')) return;
    await fetch(`/api/habits/${id}`, { method: 'DELETE' });
    await load();
  });
  const doResetStreak = (id: number) => withBusy(id, async () => {
    if (!confirm('Reset the streak for this ritual back to zero?')) return;
    await fetch(`/api/habits/${id}/streak`, { method: 'DELETE' });
    await load();
    setModalOpen(false);
  });

  const loading = habits === null;

  return (
    <div
      className="vb-bg"
      style={{ minHeight: '100vh', padding: '48px 5% 64px', fontFamily: "'Inter','DM Sans','Segoe UI',sans-serif", color: '#333' }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 6 }}>
        <div>
          <h1 className="gradient-text" style={{ fontSize: 'clamp(1.9rem,4vw,2.75rem)', fontWeight: 800, margin: 0, lineHeight: 1.1 }}>
            {firstName}&apos;s Rituals
          </h1>
          {summary && (
            <p style={{ margin: '8px 0 0', fontSize: '0.95rem', color: '#555' }}>
              {summary.today_total === 0
                ? 'Nothing scheduled today.'
                : <><strong>{summary.today_completed} of {summary.today_total}</strong> today&apos;s rituals done.</>}
            </p>
          )}
        </div>
        <Link href="/dashboard" className="ht-home-btn" aria-label="Back to dashboard">
          <Home size={20} />
        </Link>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', margin: '22px 0 20px' }}>
        <select
          className="ht-select"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          aria-label="Filter rituals"
        >
          <optgroup label="View">
            <option value="today">Today</option>
            <option value="all">All rituals</option>
          </optgroup>
          <optgroup label="Category">
            {CATEGORY_OPTIONS.map(c => <option key={c} value={`category:${c}`}>{CATEGORY_LABELS[c]}</option>)}
          </optgroup>
          <optgroup label="Urgency">
            {URGENCY_OPTIONS.map(u => <option key={u} value={`urgency:${u}`}>{u}</option>)}
          </optgroup>
          <optgroup label="Day">
            {WEEKDAYS.map(d => <option key={d} value={`day:${d}`}>{d}</option>)}
          </optgroup>
        </select>

        <button className="vb-btn-pink" style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: 8 }} onClick={openAdd}>
          <Plus size={16} /> New Ritual
        </button>
      </div>

      {/* ── Habit grid ── */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><Loader2 className="ht-spin" size={28} /></div>
      ) : filtered.length === 0 ? (
        <div className="glass" style={{ borderRadius: 20, padding: '36px 28px', textAlign: 'center', color: '#555' }}>
          <Sparkles size={22} style={{ marginBottom: 8, opacity: 0.7 }} />
          <p style={{ margin: 0, fontWeight: 600 }}>No rituals match this filter.</p>
          <p style={{ margin: '4px 0 0', fontSize: '0.9rem' }}>Try &quot;Today&quot; or &quot;All rituals&quot;, or add a new one.</p>
        </div>
      ) : (
        <div className="ht-grid">
          {filtered.map(h => (
            <HabitCard
              key={h.habit_id}
              habit={h}
              busy={busyId === h.habit_id}
              onCheckin={() => doCheckin(h.habit_id)}
              onUndo={() => doUndo(h.habit_id)}
              onEdit={() => openEdit(h)}
              onDelete={() => doDelete(h.habit_id)}
              onAmountCommitted={load}
            />
          ))}
        </div>
      )}

      {/* ── Analytics ── */}
      {summary && summary.total_habits > 0 && (
        <div style={{ marginTop: 44 }}>
          <h2 className="gradient-text" style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 16px' }}>This Week&apos;s Rhythm</h2>

          {(summary.strongest || summary.needs_attention) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 0 16px' }}>
              {summary.strongest && (
                <p style={{ margin: 0, fontSize: '0.88rem', color: '#444' }}>
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#42c38b', marginRight: 8 }} />
                  Strongest: <strong>{summary.strongest.task_name}</strong> — {summary.strongest.percent}% of target
                </p>
              )}
              {summary.needs_attention && (
                <p style={{ margin: 0, fontSize: '0.88rem', color: '#444' }}>
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#f75b67', marginRight: 8 }} />
                  Needs attention: <strong>{summary.needs_attention.task_name}</strong> — {summary.needs_attention.percent}% of target
                </p>
              )}
            </div>
          )}

          <div className="ht-stat-rail">
            <StatTile icon={<ListChecks size={16} />} label="Total Rituals" value={String(summary.total_habits)} />
            <StatTile icon={<Check size={16} />} label="Done Today" value={`${summary.today_completed}/${summary.today_total}`} />
            <StatTile icon={<Trophy size={16} />} label="Longest Streak" value={`${summary.longest_streak}d`} />
            <StatTile
              icon={<AlertTriangle size={16} />}
              label="Most Urgent"
              value={summary.most_urgent ? summary.most_urgent.task_name : 'None'}
              accent={summary.most_urgent ? URGENCY_STYLES[summary.most_urgent.habit_urgency].bg : undefined}
            />
          </div>

          <div className="glass" style={{ borderRadius: 20, padding: '22px 24px', marginTop: 16 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 700, color: '#444' }}>Daily completion, last 7 days</h3>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 96 }}>
              {summary.weekly_rhythm.map(d => (
                <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#555', minHeight: 12 }}>
                    {d.scheduled > 0 ? `${d.percent}%` : ''}
                  </div>
                  <div
                    title={`${d.weekday} ${d.date}: ${d.scheduled > 0 ? `${d.percent}% fulfilled` : 'nothing scheduled'}`}
                    style={{
                      width: '100%', maxWidth: 34, height: Math.max(6, d.percent * 0.6),
                      borderRadius: 8,
                      background: d.scheduled > 0 ? 'linear-gradient(180deg, #f2a7c0, #74bcd9)' : 'rgba(0,0,0,0.08)',
                      boxShadow: d.scheduled > 0 ? '0 4px 10px rgba(116,188,217,0.35)' : 'none',
                    }}
                  />
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#777' }}>{WEEKDAY_SHORT[d.weekday]}</div>
                </div>
              ))}
            </div>
          </div>

          {summary.category_consistency.length > 0 && (
            <div className="glass" style={{ borderRadius: 20, padding: '22px 24px', marginTop: 16 }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 700, color: '#444' }}>Consistency by category</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {summary.category_consistency.map(c => (
                  <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 110, fontSize: '0.82rem', fontWeight: c.category === 'Overall' ? 800 : 600, color: '#444' }}>
                      {c.category === 'Overall' ? 'Overall' : CATEGORY_LABELS[c.category]}
                    </div>
                    <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                      <div style={{
                        width: `${c.percent}%`, height: '100%', borderRadius: 6,
                        background: c.category === 'Overall' ? 'linear-gradient(90deg,#f2a7c0,#74bcd9)' : CATEGORY_COLORS[c.category],
                      }} />
                    </div>
                    <div style={{ width: 40, textAlign: 'right', fontSize: '0.8rem', fontWeight: 700, color: '#444' }}>{c.percent}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Add/Edit modal ── */}
      {modalOpen && (
        <div className="ht-modal-backdrop" onClick={closeModal}>
          <div className="ht-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{form.habit_id ? 'Edit Ritual' : 'New Ritual'}</h3>
              <button className="ht-icon-btn" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </div>

            <label className="ht-label">Name</label>
            <input className="vb-input" value={form.task_name} onChange={e => setForm(f => ({ ...f, task_name: e.target.value }))} placeholder="e.g. Morning run" />

            <label className="ht-label">Purpose</label>
            <textarea className="vb-input" rows={2} style={{ resize: 'none' }} value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="Why does this matter to you?" />

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label className="ht-label">Urgency</label>
                <select className="vb-input" value={form.habit_urgency} onChange={e => setForm(f => ({ ...f, habit_urgency: e.target.value as HabitUrgency }))}>
                  <option value="" disabled>Choose</option>
                  {URGENCY_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="ht-label">Category</label>
                <select className="vb-input" value={form.task_category} onChange={e => setForm(f => ({ ...f, task_category: e.target.value as HabitCategory }))}>
                  <option value="" disabled>Choose</option>
                  {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </select>
              </div>
            </div>

            <label className="ht-label">Type</label>
            <select className="vb-input" value={form.habit_type} onChange={e => setForm(f => ({ ...f, habit_type: e.target.value as HabitType }))}>
              <option value="" disabled>Choose</option>
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>

            <label className="ht-label">Schedule</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="ht-toggle-btn" style={form.schedule_mode === 'fixed' ? ACTIVE_TOGGLE_STYLE : undefined}
                onClick={() => setForm(f => ({ ...f, schedule_mode: 'fixed' }))}>Fixed days</button>
              <button type="button" className="ht-toggle-btn" style={form.schedule_mode === 'flexible' ? ACTIVE_TOGGLE_STYLE : undefined}
                onClick={() => setForm(f => ({ ...f, schedule_mode: 'flexible' }))}>Flexible</button>
            </div>

            {form.schedule_mode === 'fixed' ? (
              <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
                {WEEKDAYS.map(d => (
                  <button
                    key={d} type="button"
                    onClick={() => toggleDay(d)}
                    className="ht-day-btn"
                    style={form.days_of_week.includes(d) ? ACTIVE_TOGGLE_STYLE : undefined}
                  >
                    {WEEKDAY_SHORT[d]}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <label className="ht-label">Times per week</label>
                <input type="number" min={1} max={7} className="vb-input" value={form.weekly_target}
                  onChange={e => setForm(f => ({ ...f, weekly_target: e.target.value }))} />
              </>
            )}

            <label className="ht-label">Tracking</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="ht-toggle-btn" style={form.tracking_type === 'boolean' ? ACTIVE_TOGGLE_STYLE : undefined}
                onClick={() => setForm(f => ({ ...f, tracking_type: 'boolean' }))}>Yes/No</button>
              <button type="button" className="ht-toggle-btn" style={form.tracking_type === 'numeric' ? ACTIVE_TOGGLE_STYLE : undefined}
                onClick={() => setForm(f => ({ ...f, tracking_type: 'numeric' }))}>Track an amount</button>
            </div>

            {form.tracking_type === 'numeric' && (
              <>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label className="ht-label">Target</label>
                    <input type="number" min={0} step="any" className="vb-input" value={form.target_value}
                      onChange={e => setForm(f => ({ ...f, target_value: e.target.value }))} placeholder="e.g. 30" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="ht-label">Unit</label>
                    <input className="vb-input" value={form.unit_label}
                      onChange={e => setForm(f => ({ ...f, unit_label: e.target.value }))} placeholder="e.g. minutes" />
                  </div>
                </div>
                <details style={{ marginTop: 8 }}>
                  <summary className="ht-disclosure">Increment</summary>
                  <input type="number" min={0} step="any" className="vb-input" style={{ marginTop: 8 }} value={form.step_value}
                    onChange={e => setForm(f => ({ ...f, step_value: e.target.value }))} placeholder="1" />
                </details>
              </>
            )}

            {formError && (
              <p style={{ color: '#c0392b', fontSize: '0.85rem', margin: '12px 0 0', fontWeight: 600 }}>{formError}</p>
            )}

            {form.habit_id && (
              <button
                type="button"
                onClick={() => doResetStreak(form.habit_id as number)}
                style={{ marginTop: 14, background: 'none', border: 'none', color: '#a35', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}
              >
                <RotateCcw size={13} /> Reset streak
              </button>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" onClick={closeModal} className="ht-btn-ghost">Cancel</button>
              <button type="button" onClick={submitForm} disabled={saving} className="vb-btn-pink" style={{ width: 'auto', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
                {saving && <Loader2 className="ht-spin" size={14} />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .ht-home-btn {
          display: flex; align-items: center; justify-content: center;
          width: 44px; height: 44px; border-radius: 14px;
          background: rgba(255,255,255,0.4); color: #74bcd9;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          transition: transform 0.2s ease;
        }
        .ht-home-btn:hover { transform: translateY(-2px); }

        .ht-select {
          padding: 0.65rem 2.2rem 0.65rem 1rem;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.5);
          background: rgba(255,255,255,0.55);
          font-size: 0.92rem; font-weight: 600; color: #333;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          cursor: pointer;
        }

        .ht-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
        }

        .ht-card {
          display: flex; flex-direction: column; gap: 10px;
          background: rgba(255,255,255,0.55);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          border-radius: 18px;
          padding: 18px 18px 16px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.08);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .ht-card:hover { transform: translateY(-3px); box-shadow: 0 10px 24px rgba(0,0,0,0.12); }

        .ht-btn {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 7px 8px; border: none; border-radius: 10px; cursor: pointer;
          font-size: 0.78rem; font-weight: 700;
          transition: transform 0.12s ease, filter 0.15s ease;
        }
        .ht-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .ht-btn-check { background: #42c38b; color: #fff; }
        .ht-btn-check.checked { background: #e7e7f2; color: #444; }
        .ht-btn-edit { background: rgba(0,0,0,0.06); color: #555; }
        .ht-btn-delete { background: rgba(247,91,103,0.12); color: #c0392b; }

        .ht-icon-btn {
          background: none; border: none; cursor: pointer; color: #777;
          display: flex; align-items: center; justify-content: center;
          padding: 4px; border-radius: 8px;
        }
        .ht-icon-btn:hover { background: rgba(0,0,0,0.06); }

        .ht-btn-ghost {
          padding: 10px 18px; border-radius: 12px; border: none;
          background: rgba(0,0,0,0.06); color: #444; font-weight: 700; font-size: 0.9rem;
          cursor: pointer;
        }

        .ht-stat-rail {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px;
        }
        .ht-stat-tile {
          background: rgba(255,255,255,0.5); border-radius: 16px; padding: 14px 16px;
          display: flex; flex-direction: column; gap: 6px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.06);
        }

        .ht-modal-backdrop {
          position: fixed; inset: 0; z-index: 999;
          background: rgba(0,0,0,0.42); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; padding: 20px;
        }
        .ht-modal {
          background: rgba(255,255,255,0.97);
          border-radius: 20px; padding: 26px 28px; width: 100%; max-width: 420px;
          max-height: 90vh; overflow-y: auto;
          box-shadow: 0 20px 50px rgba(0,0,0,0.3);
        }
        .ht-label {
          display: block; font-size: 0.78rem; font-weight: 700; color: #666;
          margin: 12px 0 6px;
        }
        .ht-day-btn {
          flex: 1; padding: 7px 0; font-size: 0.66rem; font-weight: 700;
          border-radius: 8px; border: 1px solid #ddd; background: #f4f4f6; color: #555;
          cursor: pointer; transition: background 0.15s ease;
        }
        .ht-toggle-btn {
          padding: 7px 16px; font-size: 0.78rem; font-weight: 700;
          border-radius: 10px; border: 1px solid #ddd; background: #f4f4f6; color: #555;
          cursor: pointer; transition: background 0.15s ease;
        }
        .ht-disclosure {
          font-size: 0.78rem; font-weight: 700; color: #74bcd9; cursor: pointer;
        }

        .ht-amount-wrap {
          display: flex; flex-direction: column; gap: 6px;
          padding: 8px 10px; border-radius: 12px; background: rgba(0,0,0,0.03);
        }
        .ht-amount-wrap.met { background: rgba(66,195,139,0.15); }
        .ht-step-btn {
          width: 26px; height: 26px; border-radius: 8px; border: 1px solid #ddd;
          background: #fff; color: #555; display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
        }
        .ht-amount-field {
          width: 56px; text-align: center; font-size: 0.9rem; font-weight: 700; color: #333;
          border: 1px solid #ddd; border-radius: 8px; padding: 4px 2px;
        }
        .ht-amount-bar {
          height: 6px; border-radius: 4px; background: rgba(0,0,0,0.08); overflow: hidden;
        }
        .ht-amount-fill {
          height: 100%; border-radius: 4px; background: #b7c3cc; transition: width 0.3s ease, background 0.3s ease;
        }
        .ht-amount-wrap.met .ht-amount-fill { background: linear-gradient(90deg,#f2a7c0,#74bcd9); }

        .ht-spin { animation: ht-spin 0.8s linear infinite; }
        @keyframes ht-spin { to { transform: rotate(360deg); } }

        @media (prefers-reduced-motion: reduce) {
          .ht-card, .ht-home-btn, .ht-btn { transition: none !important; }
          .ht-spin { animation-duration: 1.6s; }
        }
      `}</style>
    </div>
  );
}

/* ─── Habit card ─── */

function HabitCard({
  habit, busy, onCheckin, onUndo, onEdit, onDelete, onAmountCommitted,
}: {
  habit: HabitWithComputed; busy: boolean;
  onCheckin: () => void; onUndo: () => void; onEdit: () => void; onDelete: () => void;
  onAmountCommitted: () => void;
}) {
  const canAct = habit.is_today || habit.checked_in_today;
  const urgency = URGENCY_STYLES[habit.habit_urgency];
  const isFlexible = habit.schedule_mode === 'flexible';
  const isNumeric = habit.tracking_type === 'numeric';

  return (
    <div className="ht-card" style={{ borderTop: `4px solid ${CATEGORY_COLORS[habit.task_category]}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1.02rem', color: '#333' }}>{habit.task_name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: CATEGORY_COLORS[habit.task_category], display: 'inline-block' }} />
            <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#888' }}>
              {CATEGORY_LABELS[habit.task_category]}
            </span>
          </div>
        </div>
        <span style={{
          fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase',
          padding: '4px 9px', borderRadius: 999, background: urgency.bg, color: urgency.fg, whiteSpace: 'nowrap',
        }}>
          {habit.habit_urgency}
        </span>
      </div>

      <p style={{
        margin: 0, fontSize: '0.83rem', color: '#555', lineHeight: 1.4,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {habit.purpose}
      </p>

      <div style={{ fontSize: '0.74rem', color: '#888' }}>
        {habit.habit_type === 'habit' ? 'Habit' : 'Routine'} ·{' '}
        {isFlexible ? `${habit.times_per_week}× weekly` : habit.days_of_week.map(d => WEEKDAY_SHORT[d]).join(', ')}
        {isNumeric && habit.target_value != null && ` · ${habit.target_value} ${habit.unit_label} each`}
      </div>

      {isFlexible ? <WeekDots progress={habit.week_progress!} /> : <ChainRow chain={habit.chain!} />}

      {!isFlexible && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#555' }}>
          <Flame size={13} color="#e0679d" />
          <strong>{habit.current_streak}</strong>-day streak
          {habit.longest_streak != null && habit.current_streak != null && habit.longest_streak > habit.current_streak && (
            <span style={{ opacity: 0.6 }}>· best {habit.longest_streak}</span>
          )}
        </div>
      )}

      {isNumeric && (
        <AmountInput
          habitId={habit.habit_id}
          amount={habit.today_amount ?? 0}
          target={habit.target_value ?? 0}
          unit={habit.unit_label ?? ''}
          step={habit.step_value}
          onCommitted={onAmountCommitted}
        />
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {!isNumeric && (
          <button
            className={`ht-btn ht-btn-check${habit.checked_in_today ? ' checked' : ''}`}
            disabled={!canAct || busy}
            title={!canAct ? 'Not scheduled today' : undefined}
            onClick={habit.checked_in_today ? onUndo : onCheckin}
            style={{ opacity: canAct ? 1 : 0.45, cursor: canAct ? 'pointer' : 'not-allowed' }}
          >
            {busy ? <Loader2 className="ht-spin" size={13} /> : habit.checked_in_today ? <Undo2 size={13} /> : <Check size={13} />}
            {habit.checked_in_today ? 'Undo' : 'Done'}
          </button>
        )}
        <button className="ht-btn ht-btn-edit" onClick={onEdit}><Pencil size={13} /> Edit</button>
        <button className="ht-btn ht-btn-delete" onClick={onDelete}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

/* ─── The "chain" — signature streak visualization (fixed-schedule habits) ─── */
function ChainRow({ chain }: { chain: HabitWithComputed['chain'] }) {
  const days = chain!;
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '2px 0' }}>
      {days.map((day, i) => {
        const prev = days[i - 1];
        const linked = i > 0 && prev.scheduled && prev.completed && day.scheduled && day.completed;
        const isToday = i === days.length - 1;
        return (
          <div key={day.date} style={{ display: 'flex', alignItems: 'center', flex: i === days.length - 1 ? '0 0 auto' : 1 }}>
            {i > 0 && (
              <div style={{ flex: 1, height: 2, minWidth: 6, background: linked ? 'linear-gradient(90deg,#f2a7c0,#74bcd9)' : 'rgba(0,0,0,0.1)' }} />
            )}
            <div
              title={`${day.weekday} ${day.date}${!day.scheduled ? ' — not scheduled' : day.completed ? ' — done' : isToday ? ' — not done yet' : ' — missed'}`}
              style={{
                width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
                ...(!day.scheduled
                  ? { border: '1px solid rgba(0,0,0,0.15)', background: 'transparent', opacity: 0.5 }
                  : day.completed
                    ? { background: 'linear-gradient(135deg,#f2a7c0,#74bcd9)', boxShadow: '0 0 0 2px rgba(255,255,255,0.6)' }
                    : isToday
                      ? { border: '2px dashed #74bcd9', background: 'rgba(255,255,255,0.6)' }
                      : { border: '2px solid rgba(247,91,103,0.55)', background: 'transparent' }),
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ─── Week dots — flexible-schedule habits. Tightly grouped, centered, no
   connecting line: both the missing line and the different layout signal
   "this is a count, not a timeline," distinct from the chain above. ─── */
function WeekDots({ progress }: { progress: WeekProgress }) {
  const dots = Array.from({ length: progress.target }, (_, i) => i < progress.completed);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '2px 0' }}>
      {dots.map((done, i) => (
        <div
          key={i}
          title={done ? 'Done' : 'Remaining'}
          style={{
            width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
            ...(done
              ? { background: 'linear-gradient(135deg,#f2a7c0,#74bcd9)', boxShadow: '0 0 0 2px rgba(255,255,255,0.6)' }
              : { border: '1px solid rgba(0,0,0,0.15)', background: 'transparent', opacity: 0.5 }),
          }}
        />
      ))}
    </div>
  );
}

/* ─── Amount input — numeric-tracking habits. Auto-saves ~500ms after each
   change so rapid ± clicks don't spam the endpoint. ─── */
function AmountInput({
  habitId, amount, target, unit, step, onCommitted,
}: {
  habitId: number; amount: number; target: number; unit: string; step: number; onCommitted: () => void;
}) {
  const [value, setValue] = useState(amount);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setValue(amount), [amount]);

  const commit = (next: number) => {
    const clamped = Math.max(0, next);
    setValue(clamped);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      await fetch(`/api/habits/${habitId}/amount`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: clamped }),
      });
      onCommitted();
    }, 500);
  };

  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const met = target > 0 && value >= target;

  return (
    <div className={`ht-amount-wrap${met ? ' met' : ''}`}>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        Today
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="ht-step-btn" onClick={() => commit(value - step)} aria-label={`Decrease by ${step}`}>
          <Minus size={13} />
        </button>
        <input
          type="number"
          className="ht-amount-field"
          value={value}
          onChange={e => setValue(Number(e.target.value))}
          onBlur={() => commit(value)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        <span style={{ fontSize: '0.78rem', color: '#666', fontWeight: 600 }}>{unit}</span>
        <button type="button" className="ht-step-btn" onClick={() => commit(value + step)} aria-label={`Increase by ${step}`}>
          <Plus size={13} />
        </button>
      </div>
      <div className="ht-amount-bar"><div className="ht-amount-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function StatTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="ht-stat-tile">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: accent ?? '#74bcd9' }}>
        {icon}
        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#888' }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors, project-wide.

- [ ] **Step 3: Commit**

```bash
git add src/components/habits/HabitsDashboard.tsx
git commit -m "Update HabitsDashboard for flexible scheduling and numeric tracking UI"
```

---

### Task 6: Final end-to-end verification and docs

**Files:**
- Modify: `habittracker-log.md` (append a new section)

- [ ] **Step 1: Full regression + new-path pass against the real local dev DB**

Using the locally-signed session-token approach, walk through every item in the spec's "Testing / verification plan" section:
1. Regression: an existing fixed+boolean habit's create/checkin/undo/streak flow behaves identically to before this change (compare against the same habit tested during the v1 verification, if still present in the local DB).
2. Create one habit of each new combination: flexible+boolean, fixed+numeric, flexible+numeric.
3. For the fixed+numeric habit: `PUT .../amount` with values below, at, and above target on different simulated days (adjust `checkin_date` directly via a short-lived SQL `UPDATE` if needed to backfill a prior day for testing, then clean it up) — confirm `computeConsecutiveScheduledStreak` correctly derives completion from `amount` alone, never from a stored `is_completed` (spot-check via `SELECT is_completed, amount FROM habit_checkins WHERE habit_id = ?` that `is_completed` is `NULL` on every numeric row).
4. For the flexible habits: confirm `habit_streaks` never gains a row for them (`SELECT * FROM habit_streaks WHERE habit_id = ?` stays empty) even after several check-ins/amount logs.
5. `GET /api/habits/summary`: hand-compute the expected `category_consistency` and `weekly_rhythm` percentages for the test habits created above and confirm they match (a mixed boolean/numeric set, so the fulfillment averaging is actually exercised, not just the boolean-reduces-to-binary case).
6. Cross-user isolation on `PUT .../amount` (already covered in Task 4 Step 4 — re-run once everything is integrated, not in isolation).
7. Delete every habit created for this verification pass once done, leaving the local DB in the state it was in before testing.

- [ ] **Step 2: Update the migration log**

Append a new `## Habit Tracker v2 — flexible scheduling + numeric tracking` section to `habittracker-log.md`, following the existing file's format (see the v1 entries already there), summarizing: what shipped, the completion-derivation rule and why (linking to the spec file), and confirmation that regression testing passed.

- [ ] **Step 3: Commit**

```bash
git add habittracker-log.md
git commit -m "Document Habit Tracker v2 shipment in the migration log"
```
