# Habit Tracker v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Habit Tracker dashboard from a stats page into a decision aid — an actionable stat rail, a three-state daily chart with day drill-down, per-card pacing, priority replacing urgency, optional minimum targets on numeric habits, and a read-only 12-week history view per habit.

**Architecture:** Two small additive schema columns (`priority`, `minimum_value`). One amended shared helper (`occurrenceCompleted` becomes minimum-aware). `src/lib/habits.ts` and `src/components/habits/HabitsDashboard.tsx` are each rewritten in full again (as in v2 — the changes are too interleaved across shared types for safe incremental diffs). A new read-only history endpoint, called only when a habit's detail view opens.

**Tech Stack:** Next.js 15 App Router, TypeScript, mysql2/promise, no test framework installed (verification is `tsc --noEmit` + real local-DB calls via a locally-signed dev-secret session token — no browser-automation tool is available in this environment).

**Spec:** `docs/superpowers/specs/2026-08-28-habit-tracker-v3-design.md` — read it before Task 1. This plan assumes its full detail (the amended completion-derivation rule, exact API shapes, the pacing model, and the priority backfill mapping).

## Global Constraints

- `habit_urgency` is never dropped from the database — additive-only migrations, no `DROP COLUMN`. It is removed entirely from the TypeScript/API/UI layers.
- A habit with no `minimum_value` set must behave byte-identical to v2 (`occurrenceCompleted`'s `bar` reduces to `target_value`).
- The daily chart and its day-click drill-down only ever cover **fixed**-schedule habits (flexible habits have no per-day "scheduled" concept — this was already true of `weekly_rhythm` in v2, unchanged here).
- No new npm dependencies.
- No Schedule integration of any kind (out of scope, Schedule doesn't exist as a module).

---

### Task 1: Schema migration v3

**Files:**
- Modify: `src/lib/migrate.ts`

**Interfaces:**
- Produces: `ensureHabitPriorityAndMinimumSchema(): Promise<void>` — idempotent, safe to call every request. Consumed by Task 4 (route wiring).

- [ ] **Step 1: Add the migration function**

Add near the bottom of `src/lib/migrate.ts`, after `ensureHabitTrackingSchema`:

```ts
let _ranHabitsV3 = false;

/** Add priority + minimum_value columns to habit_tasks if not already present,
 * backfilling priority from the legacy habit_urgency values exactly once
 * (only on the run that actually adds the column, never on a later no-op call). */
export async function ensureHabitPriorityAndMinimumSchema(): Promise<void> {
  if (_ranHabitsV3) return;

  let priorityColumnAdded = false;
  try {
    await pool.query(`ALTER TABLE habit_tasks ADD COLUMN priority ENUM('core','normal','optional') NOT NULL DEFAULT 'normal'`);
    priorityColumnAdded = true;
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }

  try {
    await pool.query(`ALTER TABLE habit_tasks ADD COLUMN minimum_value DECIMAL(6,1) NULL`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }

  if (priorityColumnAdded) {
    await pool.query(`
      UPDATE habit_tasks SET priority = CASE
        WHEN habit_urgency IN ('Urgent','Priority') THEN 'core'
        WHEN habit_urgency = 'Important' THEN 'normal'
        ELSE 'optional'
      END
    `);
  }

  _ranHabitsV3 = true;
}
```

Add `let _ranHabitsV3 = false;` next to the other `_ran*` flags at the top of the file, or right above this function (match whichever placement style the file already leans toward for its most recent addition — consistency with the immediately-preceding `ensureHabitTrackingSchema`/`_ranHabitsV2` pair is what matters).

- [ ] **Step 2: Verify against the real local dev DB**

Run this from the project root (Git Bash), against the live local database — this exercises the exact ALTER + backfill logic the function runs, and proves the backfill only fires once:

```bash
"/c/xampp/mysql/bin/mysql.exe" -u root vibeboard -e "SELECT habit_id, habit_urgency, priority FROM habit_tasks LIMIT 5;" 2>&1
```
Expected: `ER_BAD_FIELD_ERROR` (no `priority` column yet) — confirms starting state.

```bash
node -e "
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', database: 'vibeboard' });
  let added = false;
  try {
    await conn.query(\"ALTER TABLE habit_tasks ADD COLUMN priority ENUM('core','normal','optional') NOT NULL DEFAULT 'normal'\");
    added = true;
  } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
  try {
    await conn.query('ALTER TABLE habit_tasks ADD COLUMN minimum_value DECIMAL(6,1) NULL');
  } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
  if (added) {
    await conn.query(\"UPDATE habit_tasks SET priority = CASE WHEN habit_urgency IN ('Urgent','Priority') THEN 'core' WHEN habit_urgency = 'Important' THEN 'normal' ELSE 'optional' END\");
  }
  const [rows] = await conn.query('SELECT habit_id, habit_urgency, priority, minimum_value FROM habit_tasks');
  console.log(rows);
  await conn.end();
})();
"
```
Expected: every row's `priority` correctly maps from its `habit_urgency` per the CASE statement (spot-check a few rows by eye), `minimum_value` is `null` for all. Run the same script a second time immediately after — expected: identical output, no errors, `priority` values unchanged (proves the backfill doesn't re-run and doesn't clobber anything on the no-op path).

- [ ] **Step 3: Commit**

```bash
git add src/lib/migrate.ts
git commit -m "Add schema migration for habit priority tiers and numeric minimum targets" -- src/lib/migrate.ts
```

---

### Task 2: Amend the fulfillment helper for minimum targets

**Files:**
- Modify: `src/lib/habitFulfillment.ts`

**Interfaces:**
- Produces (changed): `FulfillmentHabit` gains optional `minimum_value?: number | null`. `occurrenceCompleted(habit, row): boolean` — behavior changes: for numeric habits, checks `amount >= (minimum_value ?? target_value)` instead of delegating to `occurrenceFulfillment(...) >= 1`.
- `occurrenceFulfillment` is UNCHANGED — still always measured against `target_value`.
- Consumed by: Task 3 (`src/lib/habits.ts`).

- [ ] **Step 1: Replace the file's contents**

```ts
// The one place completion is derived for both tracking types. Numeric
// check-ins never store a trusted is_completed (see the spec's
// "completion-derivation rule") — amount is the only fact, and completion
// is recomputed here every time, against whatever target_value (and, since
// v3, minimum_value) currently is. Boolean check-ins have no amount to
// derive from, so is_completed stays authoritative for them.
//
// v3 note: occurrenceCompleted and occurrenceFulfillment are no longer the
// same threshold. occurrenceFulfillment always measures progress toward the
// TARGET (the "how much of your goal" number Rhythm analytics consume).
// occurrenceCompleted measures against the MINIMUM when one is set (the
// lower, streak-preserving bar) — reaching only the minimum keeps the chain
// filled and the streak alive without counting as full fulfillment. A habit
// with no minimum_value behaves exactly as v2: the bar reduces to
// target_value, so occurrenceCompleted and "fulfillment >= 1" agree again.

export interface FulfillmentHabit {
  tracking_type: 'boolean' | 'numeric';
  target_value: number | null;
  minimum_value?: number | null;
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
  if (habit.tracking_type === 'boolean') return !!row.is_completed;
  if (row.amount == null) return false;
  const bar = habit.minimum_value ?? habit.target_value;
  if (!bar) return false;
  return row.amount >= bar;
}
```

- [ ] **Step 2: Verify with tsc**

```bash
npx tsc --noEmit
```
Expected: errors will appear in `src/lib/habits.ts` (it calls `occurrenceCompleted`/builds `habitCore` objects that don't yet include `minimum_value` — harmless, since the field is optional on `FulfillmentHabit`, so this should actually still compile clean). Confirm there are **zero errors** at this point — if `habits.ts` shows errors, something is wrong with this task's types, not a change deferred to Task 3 (Task 3 only *uses* `minimum_value`, it isn't required to compile against this file).

- [ ] **Step 3: Commit**

```bash
git add src/lib/habitFulfillment.ts
git commit -m "Amend occurrenceCompleted to be minimum-aware for numeric habits" -- src/lib/habitFulfillment.ts
```

---

### Task 3: Rewrite `src/lib/habits.ts`

The core of this plan. One task, committed once — the changes touch every exported type and every function in the file.

**Files:**
- Modify: `src/lib/habits.ts` (full rewrite)

**Interfaces:**
- Consumes: `occurrenceFulfillment`, `occurrenceCompleted`, `FulfillmentHabit`, `FulfillmentRow` from `@/lib/habitFulfillment` (Task 2, minimum-aware); `WEEKDAYS`, `Weekday`, `todayInManila`, `lastNDays`, `addDaysToDateStr`, `computeConsecutiveScheduledStreak`, `weekdayOfDateStr` from `@/lib/habitDate` (note: `URGENCY_RANK` is **no longer imported** — it's dead once `most_urgent` is removed; `addDaysToDateStr` is **newly imported** — needed by `getHabitHistory`).
- Produces (new/changed exports consumed by Tasks 4–5):
  - `HabitPriority = 'core' | 'normal' | 'optional'`, `PRIORITY_OPTIONS`. **`HabitUrgency` and `URGENCY_OPTIONS` are removed entirely.**
  - `Pace = 'ahead' | 'on_pace' | 'behind'`
  - `HabitWithComputed`: `habit_urgency` → `priority: HabitPriority`; gains `minimum_value: number | null`, `week_expected: number`, `week_actual: number`, `pace: Pace`, `week_days_remaining: number`.
  - `HabitInput`: `habit_urgency` (required) removed; gains `priority?: HabitPriority`, `minimum_value?: number | null`.
  - `HabitsSummary`: **`most_urgent` removed**; gains `weekly_targets: { completed: number; target: number }`, `at_risk: number`.
  - New: `HabitHistoryWeek { week_start: string; completed: number; target: number; percent: number }`, `HabitHistoryResponse { weeks: HabitHistoryWeek[]; best_week: HabitHistoryWeek | null; weekly_streak: number | null; total_checkins: number; started_at: string; recent: { date: string; completed: boolean }[] }`.
  - New: `getHabitHistory(userId: number, habitId: number, weeks?: number): Promise<HabitHistoryResponse>`.
  - Same names otherwise: `getHabitsForUser`, `getSummaryForUser`, `createHabit`, `updateHabit`, `deleteHabit`, `checkinHabit`, `undoCheckinHabit`, `setAmount`, `resetStreak`, `HabitNotFoundError` — updated bodies.

- [ ] **Step 1: Replace the entire file**

```ts
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
    (acc, h) => ({ completed: acc.completed + h.week_actual, target: acc.target + Math.max(1, h.times_per_week) }),
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
  const weekStarts: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) weekStarts.push(addDaysToDateStr(currentWeekStart, -7 * i));
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
  for (const w of weeksData) if (!best_week || w.completed > best_week.completed) best_week = w;

  let weekly_streak: number | null = null;
  if (habit.schedule_mode === 'flexible') {
    let count = 0;
    for (let i = weeksData.length - 1; i >= 0; i--) {
      if (weeksData[i].completed >= weeksData[i].target) count++;
      else break;
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
```

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit
```
Expected: errors ONLY in `src/components/habits/HabitsDashboard.tsx` (Task 5 rewrites it — it still references `habit_urgency`/`HabitUrgency`/`URGENCY_OPTIONS`, all now removed) and possibly in `src/app/api/habits/[id]/history/route.ts` if it doesn't exist yet (it doesn't — Task 4 creates it; if you see an import error for a nonexistent file, that's expected and not yours to fix). Confirm **zero errors** in `src/lib/habits.ts` itself and in the five *existing* route files under `src/app/api/habits/**` (they only pass `HabitInput` through generically — `priority` optional, `habit_urgency` no longer required, so nothing there should break).

- [ ] **Step 3: Verify against the real local dev DB**

Using a locally-signed session token (same recipe as v2 — `next-auth/jwt`'s `encode()`, secret `vibeboard-dev-secret-replace-in-production` from `.env.local`, salt `'authjs.session-token'`, cookie `authjs.session-token`, `user_id` 2 already owns habit data locally):
1. Create a fixed+boolean habit with no `priority` in the body — confirm it defaults to `'normal'`.
2. Create a numeric habit with `target_value: 30, minimum_value: 20, unit_label: 'min'` — log an amount of `20` via `setAmount` (or directly test the exported function/endpoint if Task 4 isn't done yet, otherwise via the API) and confirm the habit reads as completed (chain/streak-preserving) while its `occurrenceFulfillment`-derived percentage is `< 100%` (20/30 ≈ 67%, not 100%).
3. Attempt to create a numeric habit with `minimum_value` greater than `target_value` — confirm it's rejected with the "Minimum can't be greater than the target" message.
4. For a fixed habit with 3 scheduled days this week where today is mid-week and 1 has been completed so far: hand-compute `week_expected` (count of scheduled days from Monday through today) and confirm `GET /api/habits` returns the same number, and that `pace` matches (`'behind'` if `1 < week_expected - 0.5`, etc.).
5. Confirm `GET /api/habits/summary` no longer has a `most_urgent` field and does have `weekly_targets`/`at_risk` with sane values against your test habits.

- [ ] **Step 4: Commit**

```bash
git add src/lib/habits.ts
git commit -m "Rewrite habits.ts: priority replaces urgency, minimum targets, pacing, and habit history" -- src/lib/habits.ts
```

---

### Task 4: New history endpoint + wire the v3 migration into every route

**Files:**
- Create: `src/app/api/habits/[id]/history/route.ts`
- Modify: `src/app/api/habits/route.ts`, `src/app/api/habits/[id]/route.ts`, `src/app/api/habits/[id]/checkin/route.ts`, `src/app/api/habits/[id]/amount/route.ts`, `src/app/api/habits/summary/route.ts` (add the `ensureHabitPriorityAndMinimumSchema()` call)

**Interfaces:**
- Consumes: `getHabitHistory`, `HabitNotFoundError` from `@/lib/habits` (Task 3); `ensureHabitPriorityAndMinimumSchema` from `@/lib/migrate` (Task 1).

- [ ] **Step 1: Create the history route**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema } from '@/lib/migrate';
import { getHabitHistory, HabitNotFoundError } from '@/lib/habits';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();

  const { id } = await params;
  const habitId = parseInt(id);
  const weeksParam = req.nextUrl.searchParams.get('weeks');
  const weeks = weeksParam ? Math.min(52, Math.max(1, parseInt(weeksParam))) : 12;

  try {
    const history = await getHabitHistory(parseInt(session.user.id), habitId, weeks);
    return Response.json(history);
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
```

- [ ] **Step 2: Add the v3 migration call to the five existing route files**

In each file, add `ensureHabitPriorityAndMinimumSchema` to the existing `@/lib/migrate` import and call it right after the existing `ensureHabitTrackingSchema()` call, in every exported handler.

`src/app/api/habits/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema } from '@/lib/migrate';
import { getHabitsForUser, createHabit, type HabitInput } from '@/lib/habits';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();

  const habits = await getHabitsForUser(parseInt(session.user.id));
  return Response.json({ habits });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();

  try {
    const body = (await req.json()) as HabitInput;
    const habit_id = await createHabit(parseInt(session.user.id), body);
    return Response.json({ status: 'success', habit_id });
  } catch (err) {
    const message = err instanceof SyntaxError ? 'Invalid request body.' : (err as Error).message;
    return Response.json({ error: message }, { status: 400 });
  }
}
```

`src/app/api/habits/[id]/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema } from '@/lib/migrate';
import { updateHabit, deleteHabit, HabitNotFoundError, type HabitInput } from '@/lib/habits';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  const { id } = await params;
  const habitId = parseInt(id);

  try {
    const body = (await req.json()) as HabitInput;
    await updateHabit(parseInt(session.user.id), habitId, body);
    return Response.json({ status: 'success' });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    const message = err instanceof SyntaxError ? 'Invalid request body.' : (err as Error).message;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
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

`src/app/api/habits/[id]/checkin/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema } from '@/lib/migrate';
import { checkinHabit, undoCheckinHabit, HabitNotFoundError } from '@/lib/habits';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
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
  await ensureHabitPriorityAndMinimumSchema();
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

`src/app/api/habits/[id]/amount/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema } from '@/lib/migrate';
import { setAmount, HabitNotFoundError } from '@/lib/habits';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();

  const { id } = await params;
  const habitId = parseInt(id);

  try {
    const { amount, date } = await req.json();
    const numAmount = Number(amount);
    const result = await setAmount(parseInt(session.user.id), habitId, numAmount, date);
    return Response.json({ status: 'success', ...result });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    const message = err instanceof SyntaxError ? 'Invalid request body.' : (err as Error).message;
    return Response.json({ error: message }, { status });
  }
}
```

`src/app/api/habits/summary/route.ts`:
```ts
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema } from '@/lib/migrate';
import { getSummaryForUser } from '@/lib/habits';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();

  const summary = await getSummaryForUser(parseInt(session.user.id));
  return Response.json(summary);
}
```

(`src/app/api/habits/[id]/streak/route.ts` is untouched — same reasoning as v2: `resetStreak` doesn't read any new column.)

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```
Expected: only `src/components/habits/HabitsDashboard.tsx` errors remain (Task 5's job).

- [ ] **Step 4: Verify the history endpoint against the real local dev DB**

Using the same locally-signed session token:
1. `GET /api/habits/{fixed_habit_id}/history?weeks=12` — confirm `weeks` has up to 12 entries, `weekly_streak: null` (fixed habit), `total_checkins` matches a direct `SELECT COUNT(*)` query, `started_at` matches the habit's `date_created`.
2. `GET /api/habits/{flexible_habit_id}/history` — confirm `weekly_streak` is a number (possibly `0`), not `null`.
3. Log check-ins for a flexible habit across 3 consecutive simulated weeks meeting its target each time (backfill via direct SQL `UPDATE`/`INSERT` on `checkin_date` for prior weeks, then clean up) — confirm `weekly_streak: 3`.
4. Cross-user isolation: a different user's session gets `404` for someone else's habit's history.
5. `weeks=999` in the query string — confirm it's clamped to `52`, not accepted literally (guards against an unreasonably large history query).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/habits
git commit -m "Add habit history endpoint and wire the v3 schema migration into every habits route" -- src/app/api/habits
```

---

### Task 5: Rewrite `src/components/habits/HabitsDashboard.tsx`

**Files:**
- Modify: `src/components/habits/HabitsDashboard.tsx` (full rewrite)

**Interfaces:**
- Consumes: `HabitWithComputed`, `HabitsSummary`, `HabitCategory`, `HabitPriority`, `HabitType`, `ScheduleMode`, `TrackingType`, `WeekProgress`, `HabitHistoryResponse`, `HabitHistoryWeek` (type-only) from `@/lib/habits` (Task 3).

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
  HabitWithComputed, HabitsSummary, HabitCategory, HabitPriority, HabitType,
  ScheduleMode, TrackingType, WeekProgress, HabitHistoryResponse, HabitHistoryWeek,
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

const PRIORITY_OPTIONS: HabitPriority[] = ['core', 'normal', 'optional'];
const PRIORITY_LABELS: Record<HabitPriority, string> = { core: 'Core', normal: 'Normal', optional: 'Optional' };

const TYPE_OPTIONS: HabitType[] = ['habit', 'routine'];

const ACTIVE_TOGGLE_STYLE = { background: '#74bcd9', color: '#fff', borderColor: '#74bcd9' };

type FilterValue = 'today' | 'all' | string; // 'category:x' | 'priority:x' | 'day:x'

/* ─── Priority badge — three tiers of visual weight, not one loud badge for all ─── */
function PriorityBadge({ priority }: { priority: HabitPriority }) {
  if (priority === 'core') {
    return (
      <span style={{
        fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase',
        padding: '4px 9px', borderRadius: 999, background: '#74bcd9', color: '#fff', whiteSpace: 'nowrap',
      }}>
        Core
      </span>
    );
  }
  if (priority === 'normal') {
    return (
      <span style={{
        fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase',
        padding: '3px 8px', borderRadius: 999, border: '1px solid rgba(0,0,0,0.15)', color: '#777', whiteSpace: 'nowrap',
      }}>
        Normal
      </span>
    );
  }
  return (
    <span style={{ fontSize: '0.64rem', fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#aaa', whiteSpace: 'nowrap' }}>
      Optional
    </span>
  );
}

/* ─── Form state ─── */

interface FormState {
  habit_id: number | null;
  task_name: string;
  purpose: string;
  priority: HabitPriority;
  task_category: HabitCategory | '';
  habit_type: HabitType | '';
  schedule_mode: ScheduleMode;
  days_of_week: string[];
  weekly_target: string;
  tracking_type: TrackingType;
  target_value: string;
  minimum_value: string;
  unit_label: string;
  step_value: string;
}
const EMPTY_FORM: FormState = {
  habit_id: null, task_name: '', purpose: '', priority: 'normal', task_category: '', habit_type: '',
  schedule_mode: 'fixed', days_of_week: [], weekly_target: '3',
  tracking_type: 'boolean', target_value: '', minimum_value: '', unit_label: '', step_value: '1',
};

/* ─── Component ─── */

export default function HabitsDashboard({ firstName }: { firstName: string }) {
  const [habits, setHabits] = useState<HabitWithComputed[] | null>(null);
  const [summary, setSummary] = useState<HabitsSummary | null>(null);
  const [filter, setFilter] = useState<FilterValue>('today');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [detailHabit, setDetailHabit] = useState<HabitWithComputed | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    const [hRes, sRes] = await Promise.all([fetch('/api/habits'), fetch('/api/habits/summary')]);
    if (!hRes.ok || !sRes.ok) {
      setLoadError(true);
      return;
    }
    const hData = await hRes.json();
    const sData = await sRes.json();
    setLoadError(false);
    setHabits(hData.habits ?? []);
    setSummary(sData);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Filtering (client-side) ── */
  const filtered = useMemo(() => {
    if (!habits) return [];
    if (filter === 'all') return habits;
    if (filter === 'today') return habits.filter(h => h.is_today);
    const [kind, value] = filter.split(':');
    if (kind === 'category') return habits.filter(h => h.task_category === value);
    if (kind === 'priority') return habits.filter(h => h.priority === value);
    if (kind === 'day') return habits.filter(h => h.days_of_week.includes(value as typeof WEEKDAYS[number]));
    return habits;
  }, [habits, filter]);

  /* ── Modal ── */
  const openAdd = () => { setForm(EMPTY_FORM); setFormError(null); setModalOpen(true); };
  const openEdit = (h: HabitWithComputed) => {
    setForm({
      habit_id: h.habit_id, task_name: h.task_name, purpose: h.purpose,
      priority: h.priority, task_category: h.task_category, habit_type: h.habit_type,
      schedule_mode: h.schedule_mode, days_of_week: h.days_of_week, weekly_target: String(h.times_per_week),
      tracking_type: h.tracking_type,
      target_value: h.target_value != null ? String(h.target_value) : '',
      minimum_value: h.minimum_value != null ? String(h.minimum_value) : '',
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
    if (!form.task_name.trim() || !form.purpose.trim() || !form.task_category || !form.habit_type) {
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
    if (form.tracking_type === 'numeric' && form.minimum_value && Number(form.minimum_value) > Number(form.target_value)) {
      setFormError("Minimum can't be greater than the target.");
      return;
    }
    setSaving(true);
    setFormError(null);
    const body: Record<string, unknown> = {
      task_name: form.task_name, purpose: form.purpose, priority: form.priority,
      task_category: form.task_category, habit_type: form.habit_type,
      schedule_mode: form.schedule_mode, tracking_type: form.tracking_type,
    };
    if (form.schedule_mode === 'fixed') body.days_of_week = form.days_of_week;
    else body.weekly_target = Number(form.weekly_target);
    if (form.tracking_type === 'numeric') {
      body.target_value = Number(form.target_value);
      body.unit_label = form.unit_label.trim();
      body.step_value = form.step_value ? Number(form.step_value) : 1;
      if (form.minimum_value) body.minimum_value = Number(form.minimum_value);
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
          <optgroup label="Priority">
            {PRIORITY_OPTIONS.map(p => <option key={p} value={`priority:${p}`}>{PRIORITY_LABELS[p]}</option>)}
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
      {loadError ? (
        <div className="glass" style={{ borderRadius: 20, padding: '36px 28px', textAlign: 'center', color: '#555' }}>
          <AlertTriangle size={22} style={{ marginBottom: 8, opacity: 0.7 }} />
          <p style={{ margin: 0, fontWeight: 600 }}>Couldn&apos;t load your rituals. Try refreshing.</p>
        </div>
      ) : loading ? (
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
              onOpenDetail={() => setDetailHabit(h)}
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
            <StatTile icon={<ListChecks size={16} />} label="Weekly Targets" value={`${summary.weekly_targets.completed}/${summary.weekly_targets.target}`} />
            <StatTile
              icon={<AlertTriangle size={16} />}
              label="At Risk"
              value={summary.at_risk > 0 ? String(summary.at_risk) : 'None'}
              accent={summary.at_risk > 0 ? '#f75b67' : undefined}
            />
            <StatTile icon={<Trophy size={16} />} label="Longest Streak" value={`${summary.longest_streak}d`} />
            <StatTile
              icon={<Check size={16} />}
              label="Best Rhythm"
              value={summary.strongest ? `${summary.strongest.task_name} · ${summary.strongest.percent}%` : 'None yet'}
            />
          </div>

          <div className="glass" style={{ borderRadius: 20, padding: '22px 24px', marginTop: 16 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 700, color: '#444' }}>Daily completion, last 7 days</h3>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 96 }}>
              {summary.weekly_rhythm.map(d => (
                <div
                  key={d.date}
                  onClick={() => setSelectedDay(prev => prev === d.date ? null : d.date)}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end', cursor: 'pointer' }}
                >
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#555', minHeight: 12 }}>
                    {d.scheduled > 0 ? `${d.percent}%` : ''}
                  </div>
                  {d.scheduled === 0 ? (
                    <div
                      title={`${d.weekday} ${d.date}: Nothing scheduled`}
                      style={{ width: '100%', maxWidth: 34, height: 3, borderRadius: 2, background: 'rgba(0,0,0,0.15)', marginBottom: 3 }}
                    />
                  ) : (
                    <div
                      title={`${d.weekday} ${d.date}: ${d.percent}% fulfilled`}
                      style={{
                        width: '100%', maxWidth: 34,
                        height: Math.max(d.percent > 0 ? d.percent * 0.6 : 8, 8),
                        borderRadius: 8,
                        background: d.percent > 0 ? 'linear-gradient(180deg, #f2a7c0, #74bcd9)' : 'rgba(247,91,103,0.55)',
                        boxShadow: d.percent > 0 ? '0 4px 10px rgba(116,188,217,0.35)' : 'none',
                      }}
                    />
                  )}
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#777' }}>{WEEKDAY_SHORT[d.weekday]}</div>
                </div>
              ))}
            </div>

            {selectedDay && habits && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 8 }}>
                  {new Date(selectedDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                </div>
                {(() => {
                  const dayHabits = habits
                    .filter(h => h.schedule_mode === 'fixed')
                    .map(h => ({ habit: h, day: h.chain?.find(c => c.date === selectedDay) }))
                    .filter((x): x is { habit: HabitWithComputed; day: NonNullable<HabitWithComputed['chain']>[number] } => !!x.day?.scheduled);
                  if (!dayHabits.length) return <div style={{ fontSize: '0.82rem', color: '#888' }}>Nothing scheduled this day.</div>;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {dayHabits.map(({ habit, day }) => (
                        <div key={habit.habit_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                          <span style={{ color: day.completed ? '#42c38b' : '#c0392b' }}>{day.completed ? '✓' : '○'}</span>
                          <span>{habit.task_name}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
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
                <label className="ht-label">Priority</label>
                <select className="vb-input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as HabitPriority }))}>
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
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
                <label className="ht-label">Minimum (optional)</label>
                <input type="number" min={0} step="any" className="vb-input" value={form.minimum_value}
                  onChange={e => setForm(f => ({ ...f, minimum_value: e.target.value }))} placeholder="A lower, forgiving bar" />
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

      {detailHabit && <HabitDetailModal habit={detailHabit} onClose={() => setDetailHabit(null)} />}

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
          cursor: pointer;
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
          cursor: default;
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
          cursor: default;
        }
        .ht-amount-wrap.met { background: rgba(66,195,139,0.15); }
        .ht-amount-wrap.minimum-met { background: rgba(247,159,36,0.12); }
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
        .ht-amount-wrap.minimum-met .ht-amount-fill { background: #f79f24; }

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
  habit, busy, onCheckin, onUndo, onEdit, onDelete, onAmountCommitted, onOpenDetail,
}: {
  habit: HabitWithComputed; busy: boolean;
  onCheckin: () => void; onUndo: () => void; onEdit: () => void; onDelete: () => void;
  onAmountCommitted: () => void; onOpenDetail: () => void;
}) {
  const canAct = habit.is_today || habit.checked_in_today;
  const isFlexible = habit.schedule_mode === 'flexible';
  const isNumeric = habit.tracking_type === 'numeric';

  return (
    <div className="ht-card" style={{ borderTop: `4px solid ${CATEGORY_COLORS[habit.task_category]}` }} onClick={onOpenDetail}>
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
        <PriorityBadge priority={habit.priority} />
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
        {isNumeric && habit.target_value != null && (
          habit.minimum_value != null
            ? ` · Target ${habit.target_value} ${habit.unit_label} · Minimum ${habit.minimum_value} ${habit.unit_label}`
            : ` · ${habit.target_value} ${habit.unit_label} each`
        )}
      </div>

      {isFlexible ? <WeekDots progress={habit.week_progress!} /> : <ChainRow chain={habit.chain!} />}

      {isFlexible && (
        <div style={{ fontSize: '0.74rem', color: '#666' }}>
          {Math.max(0, habit.week_progress!.target - habit.week_progress!.completed)} remaining · {habit.week_days_remaining} day{habit.week_days_remaining === 1 ? '' : 's'} left this week
          {habit.week_progress!.completed < habit.week_progress!.target && habit.pace === 'behind' && (
            <span style={{ color: '#c0392b', fontWeight: 700, marginLeft: 6 }}>⚠ Behind pace</span>
          )}
          {habit.week_progress!.completed < habit.week_progress!.target && habit.pace === 'ahead' && (
            <span style={{ color: '#42c38b', fontWeight: 700, marginLeft: 6 }}>Ahead of pace</span>
          )}
        </div>
      )}

      {!isFlexible && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#555' }}>
          <Flame size={13} color="#e0679d" />
          <strong>{habit.current_streak}</strong>-day streak
          {habit.longest_streak != null && habit.current_streak != null && habit.longest_streak > habit.current_streak && (
            <span style={{ opacity: 0.6 }}>· best {habit.longest_streak}</span>
          )}
        </div>
      )}

      {isNumeric && canAct && (
        <div onClick={e => e.stopPropagation()}>
          <AmountInput
            habitId={habit.habit_id}
            amount={habit.today_amount ?? 0}
            target={habit.target_value ?? 0}
            minimum={habit.minimum_value}
            unit={habit.unit_label ?? ''}
            step={habit.step_value}
            onCommitted={onAmountCommitted}
          />
        </div>
      )}
      {isNumeric && !canAct && (
        <div style={{ fontSize: '0.74rem', color: '#999', fontStyle: 'italic' }}>Not scheduled today</div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 4 }} onClick={e => e.stopPropagation()}>
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
    <div>
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
      <div style={{ display: 'flex', marginTop: 2 }}>
        {days.map((day, i) => (
          <div key={day.date} style={{ flex: i === days.length - 1 ? '0 0 15px' : 1, textAlign: 'center', fontSize: '0.6rem', color: '#999', fontWeight: 700 }}>
            {day.weekday[0]}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Week dots — flexible-schedule habits ─── */
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

/* ─── Amount input — numeric-tracking habits, with an optional minimum
   giving the fill bar a third zone (below-minimum / at-minimum / at-target). ─── */
function AmountInput({
  habitId, amount, target, minimum, unit, step, onCommitted,
}: {
  habitId: number; amount: number; target: number; minimum: number | null; unit: string; step: number; onCommitted: () => void;
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
  const minimumMet = !met && minimum != null && value >= minimum;
  const remaining = Math.max(0, target - value);

  return (
    <div className={`ht-amount-wrap${met ? ' met' : minimumMet ? ' minimum-met' : ''}`}>
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
      <div style={{ fontSize: '0.72rem', color: '#777' }}>
        {met ? 'Target reached ✓' : `${remaining} ${unit} remaining`}
      </div>
    </div>
  );
}

/* ─── History mini chart — 12 weeks, one bar per week ─── */
function HistoryChart({ weeks }: { weeks: HabitHistoryWeek[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 70 }}>
      {weeks.map(w => (
        <div key={w.week_start} title={`Week of ${w.week_start}: ${w.completed}/${w.target}`} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{
            width: '100%', height: `${Math.max(4, w.percent)}%`, borderRadius: 3,
            background: w.percent >= 100 ? 'linear-gradient(180deg,#f2a7c0,#74bcd9)' : 'rgba(116,188,217,0.4)',
          }} />
        </div>
      ))}
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.03)', borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#999', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#333' }}>{value}</div>
    </div>
  );
}

/* ─── Read-only habit detail view — 12-week history, best week, streak,
   total check-ins, start date, recent check-ins. No editing surface. ─── */
function HabitDetailModal({ habit, onClose }: { habit: HabitWithComputed; onClose: () => void }) {
  const [history, setHistory] = useState<HabitHistoryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/habits/${habit.habit_id}/history?weeks=12`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled) setHistory(data); });
    return () => { cancelled = true; };
  }, [habit.habit_id]);

  return (
    <div className="ht-modal-backdrop" onClick={onClose}>
      <div className="ht-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{habit.task_name}</h3>
            <div style={{ fontSize: '0.78rem', color: '#888', marginTop: 2 }}>
              {CATEGORY_LABELS[habit.task_category]} · {habit.schedule_mode === 'flexible' ? `${habit.times_per_week}× weekly` : 'Fixed days'}
            </div>
          </div>
          <button className="ht-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div style={{ marginBottom: 16 }}>
          {habit.schedule_mode === 'flexible' ? <WeekDots progress={habit.week_progress!} /> : <ChainRow chain={habit.chain!} />}
        </div>

        {!history ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '30px 0' }}><Loader2 className="ht-spin" size={22} /></div>
        ) : (
          <>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#666', margin: '0 0 8px' }}>Last 12 weeks</div>
            <HistoryChart weeks={history.weeks} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '16px 0' }}>
              <DetailStat label="Best week" value={history.best_week ? `${history.best_week.completed}/${history.best_week.target}` : '—'} />
              <DetailStat
                label={habit.schedule_mode === 'flexible' ? 'Current streak' : 'Streak'}
                value={habit.schedule_mode === 'flexible'
                  ? `${history.weekly_streak ?? 0} week${history.weekly_streak === 1 ? '' : 's'}`
                  : `${habit.current_streak ?? 0} day${habit.current_streak === 1 ? '' : 's'}`}
              />
              <DetailStat label="Total check-ins" value={String(history.total_checkins)} />
              <DetailStat label="Started" value={new Date(history.started_at).toLocaleDateString()} />
            </div>

            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#666', margin: '0 0 8px' }}>Recent check-ins</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {history.recent.length === 0 ? (
                <div style={{ fontSize: '0.82rem', color: '#999' }}>No check-ins yet.</div>
              ) : history.recent.map(r => (
                <div key={r.date} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#555' }}>
                  <span>{r.date}</span>
                  <span>{r.completed ? '✓' : '○'}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
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
git commit -m "Update HabitsDashboard for priority, minimum targets, pacing, day drill-down, and habit history" -- src/components/habits/HabitsDashboard.tsx
```

---

### Task 6: Final end-to-end verification and docs

**Files:**
- Modify: `habittracker-log.md` (append a new section)

- [ ] **Step 1: Full regression + new-path pass against the real local dev DB**

Using the locally-signed session-token approach, walk through the spec's full testing plan:
1. Regression: spot-check that a habit created before this migration shows a sensible `priority` (matching the backfill mapping from its original `habit_urgency`), and that its card/streak/checkin behavior is otherwise unchanged from v2.
2. Minimum targets: create a numeric habit with `target_value: 45, minimum_value: 20`. Log `20` — confirm `occurrenceCompleted`-driven state (chain fill if fixed, or `checked_in_today` if flexible) shows completed, while the amount-bar's fill percent is `20/45 ≈ 44%` (not "met"). Log `45` — confirm both the completion state and the "Target reached ✓" text agree. Attempt `minimum_value: 50` against `target_value: 45` at creation — confirm rejection.
3. Pace: for a fixed habit partway through its scheduled week, hand-compute `week_expected` (exact count of scheduled days from Monday through today) and `week_actual`, and confirm the API's `pace` field matches your hand computation exactly (test at least one `'behind'` and one `'on_pace'` or `'ahead'` case).
4. Priority filter: confirm `GET /api/habits` habits filter correctly by the new `priority` field via the dropdown's equivalent query, and that no code path anywhere still reads or expects `habit_urgency`.
5. History endpoint: for a flexible habit, backfill three consecutive weeks of check-ins meeting target (via direct SQL on `checkin_date`), confirm `weekly_streak: 3`; then break the streak two weeks back and confirm it drops to the correct shorter count from the most recent unbroken run. Confirm `total_checkins` matches a direct `COUNT(*)`.
6. Day-click panel: confirm it only ever lists fixed-schedule habits (flexible habits correctly never appear in a specific day's breakdown, consistent with the daily chart itself only pooling fixed habits).
7. Detail-view click-through: confirm clicking Edit/Delete/Done/the amount stepper does NOT also open the detail modal underneath (event propagation correctly stopped).
8. Clean up every test habit/row created during this pass — leave the local DB in the state it was in before testing (verify via row counts before/after).

- [ ] **Step 2: Update the migration log**

Append a new `## Habit Tracker v3 — actionable dashboard, priority, minimum targets, history` section to `habittracker-log.md`, matching the file's existing style: summarize what shipped, the amended completion-derivation rule (link to the v3 spec), the priority backfill decision, and confirmation that regression + new-path testing passed.

- [ ] **Step 3: Commit**

```bash
git add habittracker-log.md
git commit -m "Document Habit Tracker v3 shipment in the migration log" -- habittracker-log.md
```
