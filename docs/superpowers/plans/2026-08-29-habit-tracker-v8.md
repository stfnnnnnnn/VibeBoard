# Habit Tracker v8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pause/Resume lifecycle to rituals: pausing freezes a habit's streak (permanently, via a recorded pause-window history, so the freeze survives forever — not just "for now"), excludes it from Today's Rituals and every weekly analytic, and still shows it under "All rituals" with a Paused badge. Ships with a minimal, functional `[⋯]` overflow menu (Edit / Pause-or-Resume / Delete) replacing the current three-button card action row.

**Architecture:** A schema migration (reuse the already-present-but-unused `task_status` column, add a new `habit_pauses` history table) in `src/lib/migrate.ts`; a pause-aware extension to the shared streak-walk primitive in `src/lib/habitDate.ts`; backend logic in `src/lib/habits.ts` (two new actions, threading pause-window exclusion through the existing chain-building and streak-recompute code, and a top-level analytics filter); a new API route; a frontend update to `HabitsDashboard.tsx`.

**Tech Stack:** Next.js 15 App Router, TypeScript, mysql2/promise, no test framework installed (verification is `tsc --noEmit` plus real API/DB calls via a locally-signed session token).

**Spec:** `docs/superpowers/specs/2026-08-29-habit-tracker-v8-design.md` — read it before Task 1.

## Global Constraints

- Flexible-schedule habits get simpler treatment than fixed ones: excluded from analytics/Today while paused, but no `habit_pauses`-driven day-by-day exclusion machinery — they have no chain to protect.
- The 12-week history detail view (`getHabitHistory`/`HabitDetailModal`) is explicitly NOT made pause-aware in this pass — a known, accepted limitation, not a bug to fix here.
- `pauseHabit`/`resumeHabit` never call `recomputeFixedStreak` — the stored streak value must be left exactly as it was; the freeze depends on this plus the pause-window exclusion in the streak walk, not on any special-casing at the pause/resume call sites.
- No change to `HabitInput`, `validateInput`, `createHabit`, or `updateHabit`'s SQL column list — `task_status` is managed exclusively through the new pause/resume actions, never through the general create/edit form.
- Every existing caller of `computeConsecutiveScheduledStreak` must be unaffected by its new 4th parameter — it has a default of `[]`, so behavior for any habit that has never been paused is byte-for-byte unchanged.

---

### Task 1: Schema, pause-aware streak primitive, backend logic, and API

**Files:**
- Modify: `src/lib/habitDate.ts`
- Modify: `src/lib/migrate.ts`
- Modify: `src/lib/habits.ts`
- Create: `src/app/api/habits/[id]/pause/route.ts`
- Modify: `src/app/api/habits/route.ts`
- Modify: `src/app/api/habits/[id]/route.ts`
- Modify: `src/app/api/habits/[id]/amount/route.ts`
- Modify: `src/app/api/habits/[id]/history/route.ts`
- Modify: `src/app/api/habits/[id]/checkin/route.ts`
- Modify: `src/app/api/habits/summary/route.ts`

**Interfaces:**
- Produces (consumed by Task 2): `HabitWithComputed` gains `task_status: 'active' | 'paused'`. Two new client-callable endpoints: `POST /api/habits/[id]/pause` (pause) and `DELETE /api/habits/[id]/pause` (resume), both returning `{ status: 'success' }` on success or `{ error: string }` with a 400/404 status on failure, matching every other habit-action route's existing response shape.

- [ ] **Step 1: Extend `computeConsecutiveScheduledStreak` in `src/lib/habitDate.ts`**

Find:
```ts
export function computeConsecutiveScheduledStreak(
  scheduledWeekdays: ReadonlySet<Weekday>,
  completedDates: ReadonlySet<string>,
  asOfDateStr: string,
): { length: number; start: string | null } {
  let length = 0;
  let start: string | null = null;
  let cursor = asOfDateStr;
  const CAP = 3650; // ~10 years safety bound

  for (let i = 0; i < CAP; i++) {
    const wd = weekdayOfDateStr(cursor);
    if (scheduledWeekdays.has(wd)) {
      if (completedDates.has(cursor)) {
        length++;
        start = cursor;
        cursor = addDaysToDateStr(cursor, -1);
        continue;
      }
      break; // scheduled day, not completed -> the run ends here
    }
    cursor = addDaysToDateStr(cursor, -1); // unscheduled day, doesn't break the run
  }

  return { length, start };
}
```
Replace with:
```ts
export function computeConsecutiveScheduledStreak(
  scheduledWeekdays: ReadonlySet<Weekday>,
  completedDates: ReadonlySet<string>,
  asOfDateStr: string,
  pausedRanges: ReadonlyArray<{ start: string; end: string }> = [],
): { length: number; start: string | null } {
  const isPaused = (d: string) => pausedRanges.some(r => d >= r.start && d < r.end);
  let length = 0;
  let start: string | null = null;
  let cursor = asOfDateStr;
  const CAP = 3650; // ~10 years safety bound

  for (let i = 0; i < CAP; i++) {
    const wd = weekdayOfDateStr(cursor);
    if (scheduledWeekdays.has(wd) && !isPaused(cursor)) {
      if (completedDates.has(cursor)) {
        length++;
        start = cursor;
        cursor = addDaysToDateStr(cursor, -1);
        continue;
      }
      break; // scheduled day, not completed -> the run ends here
    }
    cursor = addDaysToDateStr(cursor, -1); // unscheduled (or paused) day, doesn't break the run
  }

  return { length, start };
}
```
(`end` is exclusive: a range `{ start: '2026-08-10', end: '2026-08-17' }` covers Aug 10 through Aug 16 — the resume date itself is a normal day again. The new parameter defaults to `[]`, so every existing call site is unaffected until Task 1's later steps explicitly pass real ranges.)

- [ ] **Step 2: Add the pause schema migration to `src/lib/migrate.ts`**

Find:
```ts
let _ranHabitsV2 = false;
let _ranHabitsV3 = false;
let _ranHabitsV7 = false;
```
Replace with:
```ts
let _ranHabitsV2 = false;
let _ranHabitsV3 = false;
let _ranHabitsV7 = false;
let _ranHabitsV8 = false;
```

Find the end of `ensureHabitTypeRemovedAndNoteRenamedSchema` (the function ends with `_ranHabitsV7 = true; }`). Immediately after it, add:
```ts

/** Add the 'paused' status value (reusing the pre-existing, previously-unused
 * task_status column from the legacy schema) and a habit_pauses history table
 * recording every pause/resume cycle permanently — the streak walk in habits.ts
 * needs that permanent record to correctly skip paused date ranges forever,
 * not just while a pause is currently active. Both statements are naturally
 * idempotent on their own (MODIFY on an identical enum, and CREATE TABLE IF NOT
 * EXISTS) — no error-code-catch guard is needed here. */
export async function ensureHabitPauseSchema(): Promise<void> {
  if (_ranHabitsV8) return;

  await pool.query(`ALTER TABLE habit_tasks MODIFY task_status ENUM('active','archived','paused') NOT NULL DEFAULT 'active'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS habit_pauses (
      pause_id INT NOT NULL AUTO_INCREMENT,
      habit_id INT NOT NULL,
      paused_at DATE NOT NULL,
      resumed_at DATE NULL,
      PRIMARY KEY (pause_id),
      KEY habit_id (habit_id),
      CONSTRAINT fk_pause_habit FOREIGN KEY (habit_id) REFERENCES habit_tasks (habit_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  _ranHabitsV8 = true;
}
```

- [ ] **Step 3: Update `src/lib/habits.ts` — types**

Find:
```ts
interface HabitRow extends RowDataPacket {
  habit_id: number; user_id: number; task_name: string; note: string | null;
  priority: HabitPriority; task_category: HabitCategory;
  days_of_week: string; times_per_week: number; date_created: string;
  schedule_mode: ScheduleMode; tracking_type: TrackingType;
  target_value: string | number | null; minimum_value: string | number | null;
  unit_label: string | null; step_value: string | number | null;
}
```
Replace with:
```ts
interface HabitRow extends RowDataPacket {
  habit_id: number; user_id: number; task_name: string; note: string | null;
  priority: HabitPriority; task_category: HabitCategory;
  days_of_week: string; times_per_week: number; date_created: string;
  schedule_mode: ScheduleMode; tracking_type: TrackingType;
  target_value: string | number | null; minimum_value: string | number | null;
  unit_label: string | null; step_value: string | number | null;
  task_status: 'active' | 'archived' | 'paused';
}
```
(`HabitRow` keeps `'archived'` in its type since that's a value the DB column can genuinely hold, even though no code path in this app ever writes it — this interface describes what a raw DB row can contain, not what the app produces.)

Find:
```ts
export interface HabitWithComputed {
  habit_id: number;
  task_name: string;
  note: string | null;
  priority: HabitPriority;
  task_category: HabitCategory;
  schedule_mode: ScheduleMode;
```
Replace with:
```ts
export interface HabitWithComputed {
  habit_id: number;
  task_name: string;
  note: string | null;
  priority: HabitPriority;
  task_category: HabitCategory;
  task_status: 'active' | 'paused';
  schedule_mode: ScheduleMode;
```
(`HabitWithComputed` narrows to `'active' | 'paused'` since no habit this app ever returns to the client can be `'archived'` — nothing writes that value.)

Add a new interface right after `interface CheckinRow extends RowDataPacket { ... }` (which currently ends the small block of row interfaces before `export class HabitNotFoundError`):
```ts
interface PauseRow extends RowDataPacket {
  habit_id: number; paused_at: string; resumed_at: string | null;
}
```

- [ ] **Step 4: Add the single-habit paused-ranges helper**

Find the end of `habitCoreOf`:
```ts
function habitCoreOf(habit: HabitRow) {
  return {
    tracking_type: habit.tracking_type,
    target_value: toNum(habit.target_value),
    minimum_value: toNum(habit.minimum_value),
  };
}
```
Immediately after it, add:
```ts

/** Every pause window ever recorded for one habit, as exclusive-end date ranges
 * ready for `computeConsecutiveScheduledStreak`. An ongoing pause (no resumed_at
 * yet) gets an exclusive end of "tomorrow," so it correctly covers every day up
 * to and including today. */
async function getPausedRangesForHabit(habitId: number): Promise<{ start: string; end: string }[]> {
  const { dateStr: today } = todayInManila();
  const [rows] = await pool.execute<PauseRow[]>(
    `SELECT habit_id, paused_at, resumed_at FROM habit_pauses WHERE habit_id = ?`, [habitId]
  );
  return rows.map(r => ({ start: r.paused_at, end: r.resumed_at ?? addDaysToDateStr(today, 1) }));
}
```

- [ ] **Step 5: Thread pause-awareness into `recomputeFixedStreak`**

Find:
```ts
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
```
Replace with:
```ts
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

  const pausedRanges = await getPausedRangesForHabit(habitId);
  const anchor = completedDates.has(today) ? today : [...completedDates].sort().at(-1)!;
  const { length, start } = computeConsecutiveScheduledStreak(scheduled, completedDates, anchor, pausedRanges);
```
(Every other line of this function — the `longest`/`streakStart` computation, the `INSERT`/`UPDATE` into `habit_streaks`, the return — is unchanged.)

- [ ] **Step 6: Thread pause-awareness and `task_status` into `getHabitsForUser`**

Find:
```ts
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
```
Replace with:
```ts
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

  const [pauseRows] = await pool.execute<PauseRow[]>(
    `SELECT habit_id, paused_at, resumed_at FROM habit_pauses WHERE habit_id IN (${placeholders})`,
    habitIds
  );
  const pausedRangesByHabit = new Map<number, { start: string; end: string }[]>();
  for (const row of pauseRows) {
    const list = pausedRangesByHabit.get(row.habit_id) ?? [];
    list.push({ start: row.paused_at, end: row.resumed_at ?? addDaysToDateStr(today, 1) });
    pausedRangesByHabit.set(row.habit_id, list);
  }
```

Find:
```ts
  const result: HabitWithComputed[] = taskRows.map(row => {
    const habitCore = habitCoreOf(row);
    const scheduled = parseDays(row.days_of_week);
    const checkinsByDate = rowsByHabit.get(row.habit_id) ?? new Map();

    const base = {
      habit_id: row.habit_id,
      task_name: row.task_name,
      note: row.note,
      priority: row.priority,
      task_category: row.task_category,
      schedule_mode: row.schedule_mode,
```
Replace with:
```ts
  const result: HabitWithComputed[] = taskRows.map(row => {
    const habitCore = habitCoreOf(row);
    const scheduled = parseDays(row.days_of_week);
    const checkinsByDate = rowsByHabit.get(row.habit_id) ?? new Map();
    const pausedRanges = pausedRangesByHabit.get(row.habit_id) ?? [];
    const isPausedOnDate = (date: string) => pausedRanges.some(r => date >= r.start && date < r.end);
    const isPaused = row.task_status === 'paused';

    const base = {
      habit_id: row.habit_id,
      task_name: row.task_name,
      note: row.note,
      priority: row.priority,
      task_category: row.task_category,
      task_status: isPaused ? ('paused' as const) : ('active' as const),
      schedule_mode: row.schedule_mode,
```

Find (the flexible branch's `is_today: true`):
```ts
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
```
Replace with:
```ts
      return {
        ...base,
        days_of_week: [],
        is_today: !isPaused,
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
```

Find (the fixed branch's chain building):
```ts
    const chain: ChainDay[] = days.map(date => {
      const weekday = weekdayOfDateStr(date);
      const r = checkinsByDate.get(date);
      const fulfillment = r ? occurrenceFulfillment(habitCore, r) : 0;
      const completed = r ? occurrenceCompleted(habitCore, r) : false;
      return { date, weekday, scheduled: scheduled.has(weekday), completed, fulfillment };
    });
```
Replace with:
```ts
    const chain: ChainDay[] = days.map(date => {
      const weekday = weekdayOfDateStr(date);
      const r = checkinsByDate.get(date);
      const fulfillment = r ? occurrenceFulfillment(habitCore, r) : 0;
      const completed = r ? occurrenceCompleted(habitCore, r) : false;
      return { date, weekday, scheduled: scheduled.has(weekday) && !isPausedOnDate(date), completed, fulfillment };
    });
```

Find (the fixed branch's return, `is_today: scheduled.has(todayWeekday)`):
```ts
    return {
      ...base,
      days_of_week: WEEKDAYS.filter(d => scheduled.has(d)),
      is_today: scheduled.has(todayWeekday),
      checked_in_today: occurrenceCompleted(habitCore, checkinsByDate.get(today) ?? {}),
```
Replace with:
```ts
    return {
      ...base,
      days_of_week: WEEKDAYS.filter(d => scheduled.has(d)),
      is_today: scheduled.has(todayWeekday) && !isPaused,
      checked_in_today: occurrenceCompleted(habitCore, checkinsByDate.get(today) ?? {}),
```

- [ ] **Step 7: Exclude paused habits from `getSummaryForUser`'s aggregation**

Find:
```ts
export async function getSummaryForUser(userId: number): Promise<HabitsSummary> {
  const habits = await getHabitsForUser(userId);
  const { dateStr: today } = todayInManila();
```
Replace with:
```ts
export async function getSummaryForUser(userId: number): Promise<HabitsSummary> {
  const habits = (await getHabitsForUser(userId)).filter(h => h.task_status !== 'paused');
  const { dateStr: today } = todayInManila();
```
(Every aggregate in this function — `today_total`/`today_completed`, `weekly_targets`, `weekly_expected`, `at_risk`, `weekly_rhythm`, `category_consistency`, `on_pace`/`needs_attention`, `longest_streak` — already operates on whatever `habits` array is passed in, so this one filter closes off all of them at once. `total_habits` in the returned object also now reflects the active-only count, which is correct: a paused habit shouldn't inflate "how many rituals am I tracking this week.")

- [ ] **Step 8: Reject check-in/undo/amount actions on a paused habit**

Find:
```ts
export async function checkinHabit(userId: number, habitId: number): Promise<StreakResult> {
  const habit = await getOwnedHabitRow(habitId, userId);
  if (habit.tracking_type !== 'boolean') throw new Error('This ritual tracks an amount — log it instead of checking in.');
```
Replace with:
```ts
export async function checkinHabit(userId: number, habitId: number): Promise<StreakResult> {
  const habit = await getOwnedHabitRow(habitId, userId);
  if (habit.task_status === 'paused') throw new Error('This ritual is paused — resume it before checking in.');
  if (habit.tracking_type !== 'boolean') throw new Error('This ritual tracks an amount — log it instead of checking in.');
```

Find:
```ts
export async function undoCheckinHabit(userId: number, habitId: number): Promise<StreakResult> {
  const habit = await getOwnedHabitRow(habitId, userId);
  if (habit.tracking_type !== 'boolean') throw new Error('This ritual tracks an amount — log it instead of checking in.');
```
Replace with:
```ts
export async function undoCheckinHabit(userId: number, habitId: number): Promise<StreakResult> {
  const habit = await getOwnedHabitRow(habitId, userId);
  if (habit.task_status === 'paused') throw new Error('This ritual is paused — resume it before checking in.');
  if (habit.tracking_type !== 'boolean') throw new Error('This ritual tracks an amount — log it instead of checking in.');
```

Find:
```ts
export async function setAmount(userId: number, habitId: number, amount: number, date?: string): Promise<{ amount: number; completed: boolean }> {
  const habit = await getOwnedHabitRow(habitId, userId);
  if (habit.tracking_type !== 'numeric') throw new Error('This ritual is a simple check-in, not an amount.');
```
Replace with:
```ts
export async function setAmount(userId: number, habitId: number, amount: number, date?: string): Promise<{ amount: number; completed: boolean }> {
  const habit = await getOwnedHabitRow(habitId, userId);
  if (habit.task_status === 'paused') throw new Error('This ritual is paused — resume it before checking in.');
  if (habit.tracking_type !== 'numeric') throw new Error('This ritual is a simple check-in, not an amount.');
```

- [ ] **Step 9: Add `pauseHabit`/`resumeHabit`**

Find the end of the file:
```ts
export async function resetStreak(userId: number, habitId: number): Promise<void> {
  await getOwnedHabitRow(habitId, userId);
  await pool.execute(`DELETE FROM habit_streaks WHERE habit_id = ? AND user_id = ?`, [habitId, userId]);
}
```
Immediately after it, add:
```ts

export async function pauseHabit(userId: number, habitId: number): Promise<void> {
  const habit = await getOwnedHabitRow(habitId, userId);
  if (habit.task_status === 'paused') throw new Error('This ritual is already paused.');
  const { dateStr: today } = todayInManila();
  await pool.execute(`UPDATE habit_tasks SET task_status='paused' WHERE habit_id=? AND user_id=?`, [habitId, userId]);
  await pool.execute(`INSERT INTO habit_pauses (habit_id, paused_at, resumed_at) VALUES (?, ?, NULL)`, [habitId, today]);
}

export async function resumeHabit(userId: number, habitId: number): Promise<void> {
  const habit = await getOwnedHabitRow(habitId, userId);
  if (habit.task_status !== 'paused') throw new Error('This ritual is not paused.');
  const { dateStr: today } = todayInManila();
  await pool.execute(`UPDATE habit_tasks SET task_status='active' WHERE habit_id=? AND user_id=?`, [habitId, userId]);
  await pool.execute(
    `UPDATE habit_pauses SET resumed_at=? WHERE habit_id=? AND resumed_at IS NULL ORDER BY pause_id DESC LIMIT 1`,
    [today, habitId]
  );
}
```

- [ ] **Step 10: Create the pause/resume API route**

Create `src/app/api/habits/[id]/pause/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema, ensureHabitTypeRemovedAndNoteRenamedSchema, ensureHabitPauseSchema } from '@/lib/migrate';
import { pauseHabit, resumeHabit, HabitNotFoundError } from '@/lib/habits';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();
  await ensureHabitPauseSchema();
  const { id } = await params;
  const habitId = parseInt(id);

  try {
    await pauseHabit(parseInt(session.user.id), habitId);
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
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();
  await ensureHabitPauseSchema();
  const { id } = await params;
  const habitId = parseInt(id);

  try {
    await resumeHabit(parseInt(session.user.id), habitId);
    return Response.json({ status: 'success' });
  } catch (err) {
    const status = err instanceof HabitNotFoundError ? 404 : 400;
    return Response.json({ error: (err as Error).message }, { status });
  }
}
```

- [ ] **Step 11: Wire `ensureHabitPauseSchema` into all 6 existing route files**

In each of `src/app/api/habits/route.ts`, `src/app/api/habits/[id]/route.ts`, `src/app/api/habits/[id]/amount/route.ts`, `src/app/api/habits/[id]/history/route.ts`, `src/app/api/habits/[id]/checkin/route.ts`, `src/app/api/habits/summary/route.ts`: add `ensureHabitPauseSchema` to the existing `import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema, ensureHabitTypeRemovedAndNoteRenamedSchema } from '@/lib/migrate';` line, and add `await ensureHabitPauseSchema();` immediately after every existing `await ensureHabitTypeRemovedAndNoteRenamedSchema();` call in that file (same call-site counts as v7 wired: route.ts 2, [id]/route.ts 2, amount/route.ts 1, history/route.ts 1, checkin/route.ts 2, summary/route.ts 1 — 9 total).

Example (from `src/app/api/habits/summary/route.ts`):
```ts
// before
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema, ensureHabitTypeRemovedAndNoteRenamedSchema } from '@/lib/migrate';
import { getSummaryForUser } from '@/lib/habits';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();

  const summary = await getSummaryForUser(parseInt(session.user.id));
  return Response.json(summary);
}
```
```ts
// after
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema, ensureHabitTypeRemovedAndNoteRenamedSchema, ensureHabitPauseSchema } from '@/lib/migrate';
import { getSummaryForUser } from '@/lib/habits';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();
  await ensureHabitPauseSchema();

  const summary = await getSummaryForUser(parseInt(session.user.id));
  return Response.json(summary);
}
```
Apply the same shape of edit (import line + one new `await` line after each existing `ensureHabitTypeRemovedAndNoteRenamedSchema()` call) to the other 5 files.

- [ ] **Step 12: Run tsc**

```bash
npx tsc --noEmit
```
Expected: **zero errors project-wide**, including in `src/components/habits/HabitsDashboard.tsx`. `HabitWithComputed` gaining a new field is additive from that file's perspective — it only ever reads fields off habit objects it receives from the API, never constructs one itself, so a new field on the interface doesn't break it. (Task 2 doesn't fix a compile error here; it adds new UI that consumes the new field.)

- [ ] **Step 13: Verify against the real local dev DB**

Using a locally-signed session token (recipe: `next-auth/jwt`'s `encode({ token: { sub: '<user_id>', name }, secret: 'vibeboard-dev-secret-replace-in-production', salt: 'authjs.session-token' })`, cookie `authjs.session-token`; `user_id` 2 owns real habit data locally; ensure XAMPP's MySQL service is running; make sure the dev server binds to port 3000 to match `.env.local`'s `AUTH_URL`):
1. Confirm the migration ran: inspect `habit_tasks`'s `task_status` enum now includes `'paused'`, and `habit_pauses` exists.
2. Pick a fixed-schedule habit with an existing streak. `POST /api/habits/[id]/pause`. Confirm: `GET /api/habits` shows it with `task_status: 'paused'`, `is_today: false`, and its `current_streak`/`longest_streak` unchanged from before pausing. Confirm `GET /api/habits/summary` no longer counts it anywhere (weekly_expected, category_consistency, at_risk, weekly_rhythm, on_pace/needs_attention all recompute as if it doesn't exist; `total_habits` drops by one).
3. While paused, `POST /api/habits/[id]/checkin` — confirm it's rejected with a clear error (not a 500, not a silent success).
4. To actually exercise the streak-freeze end to end without waiting real days: directly insert a `habit_pauses` row with `paused_at` a few days in the past and `resumed_at` a day or two ago (simulating a completed pause window), for a test habit with a streak, then trigger a check-in today and confirm `recomputeFixedStreak`'s resulting `current_streak` treats the simulated paused dates as skipped (not as misses) — i.e., the streak isn't reset to a small number reflecting those dates as breaks.
5. `POST /api/habits/[id]/pause` on an already-paused habit — confirm a clear 400 error, not a silent no-op or a 500.
6. `DELETE /api/habits/[id]/pause` (resume) — confirm `task_status` returns to `'active'`, `is_today` recovers correctly if scheduled today, and the habit reappears in every summary aggregate.
7. `DELETE /api/habits/[id]/pause` on an already-active habit — confirm a clear 400 error.
8. Repeat a quick pause+resume check for a flexible-schedule habit — confirm it's excluded from `week_progress`/pace and every summary field while paused, with no `habit_pauses`-specific machinery needed to verify beyond the `task_status`/`is_today` exclusion itself.
9. Clean up any test habits/pause rows created during this pass.

- [ ] **Step 14: Commit**

```bash
git add src/lib/habitDate.ts src/lib/migrate.ts src/lib/habits.ts "src/app/api/habits/[id]/pause/route.ts" src/app/api/habits/route.ts "src/app/api/habits/[id]/route.ts" "src/app/api/habits/[id]/amount/route.ts" "src/app/api/habits/[id]/history/route.ts" "src/app/api/habits/[id]/checkin/route.ts" src/app/api/habits/summary/route.ts
git commit -m "Add Pause lifecycle: task_status + habit_pauses history, pause-aware streak walk, pause/resume actions and route" -- src/lib/habitDate.ts src/lib/migrate.ts src/lib/habits.ts "src/app/api/habits/[id]/pause/route.ts" src/app/api/habits/route.ts "src/app/api/habits/[id]/route.ts" "src/app/api/habits/[id]/amount/route.ts" "src/app/api/habits/[id]/history/route.ts" "src/app/api/habits/[id]/checkin/route.ts" src/app/api/habits/summary/route.ts
```

---

### Task 2: Frontend — Paused badge and the `[⋯]` overflow menu

**Files:**
- Modify: `src/components/habits/HabitsDashboard.tsx`

**Interfaces:**
- Consumes: `HabitWithComputed.task_status: 'active' | 'paused'` (Task 1's new field), `POST`/`DELETE /api/habits/[id]/pause` (Task 1's new endpoints).

- [ ] **Step 1: Add `doPause`/`doResume` handlers**

Find:
```ts
  const doResetStreak = (id: number) => withBusy(id, async () => {
    if (!confirm('Reset the streak for this ritual back to zero?')) return;
    await fetch(`/api/habits/${id}/streak`, { method: 'DELETE' });
    await load();
    setModalOpen(false);
  });
```
Immediately after it, add:
```ts
  const doPause = (id: number) => withBusy(id, async () => {
    await fetch(`/api/habits/${id}/pause`, { method: 'POST' });
    await load();
  });
  const doResume = (id: number) => withBusy(id, async () => {
    await fetch(`/api/habits/${id}/pause`, { method: 'DELETE' });
    await load();
  });
```

- [ ] **Step 2: Wire the new handlers into `HabitCard`**

Find:
```tsx
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
```
Replace with:
```tsx
            <HabitCard
              key={h.habit_id}
              habit={h}
              busy={busyId === h.habit_id}
              onCheckin={() => doCheckin(h.habit_id)}
              onUndo={() => doUndo(h.habit_id)}
              onEdit={() => openEdit(h)}
              onDelete={() => doDelete(h.habit_id)}
              onPauseToggle={() => (h.task_status === 'paused' ? doResume(h.habit_id) : doPause(h.habit_id))}
              onAmountCommitted={load}
              onOpenDetail={() => setDetailHabit(h)}
            />
```

- [ ] **Step 3: Update `HabitCard`'s props, add the Paused badge, add the overflow menu**

Find:
```tsx
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
  const categoryColor = CATEGORY_COLORS[habit.task_category];

  return (
```
Replace with:
```tsx
function HabitCard({
  habit, busy, onCheckin, onUndo, onEdit, onDelete, onPauseToggle, onAmountCommitted, onOpenDetail,
}: {
  habit: HabitWithComputed; busy: boolean;
  onCheckin: () => void; onUndo: () => void; onEdit: () => void; onDelete: () => void; onPauseToggle: () => void;
  onAmountCommitted: () => void; onOpenDetail: () => void;
}) {
  const canAct = habit.is_today || habit.checked_in_today;
  const isFlexible = habit.schedule_mode === 'flexible';
  const isNumeric = habit.tracking_type === 'numeric';
  const isPaused = habit.task_status === 'paused';
  const categoryColor = CATEGORY_COLORS[habit.task_category];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
```

Find:
```tsx
        <PriorityBadge priority={habit.priority} />
      </div>
```
Replace with:
```tsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isPaused && (
            <span style={{
              fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase',
              padding: '3px 8px', borderRadius: 999, background: 'rgba(0,0,0,0.08)', color: '#777', whiteSpace: 'nowrap',
            }}>
              Paused
            </span>
          )}
          <PriorityBadge priority={habit.priority} />
        </div>
      </div>
```

Find:
```tsx
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
```
Replace with:
```tsx
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
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="ht-icon-btn"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="More actions"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="ht-card-menu">
              <button type="button" onClick={() => { setMenuOpen(false); onEdit(); }}>Edit</button>
              <button type="button" onClick={() => { setMenuOpen(false); onPauseToggle(); }}>{isPaused ? 'Resume' : 'Pause'}</button>
              <button type="button" onClick={() => { setMenuOpen(false); onDelete(); }}>Delete</button>
            </div>
          )}
        </div>
      </div>
```

- [ ] **Step 4: Update the icon import — add `MoreHorizontal`, remove now-unused `Pencil`/`Trash2`**

The menu items added in Step 3 are plain text buttons ("Edit", "Pause"/"Resume", "Delete"), not icon buttons — so `Pencil` and `Trash2` (previously used only by the two buttons this task just replaced) are no longer referenced anywhere in the file. Confirm this yourself by checking for any other `<Pencil`/`<Trash2` usage before removing — there is none outside the block Step 3 just replaced.

Find:
```ts
import {
  Home, Plus, Minus, Check, Undo2, Pencil, Trash2, Flame, Trophy,
  AlertTriangle, X, RotateCcw, Loader2, Sparkles,
} from 'lucide-react';
```
Replace with:
```ts
import {
  Home, Plus, Minus, Check, Undo2, Flame, Trophy,
  AlertTriangle, X, RotateCcw, Loader2, Sparkles, MoreHorizontal,
} from 'lucide-react';
```

- [ ] **Step 5: Add the `.ht-card-menu` CSS**

Find:
```css
        .ht-icon-btn {
          background: none; border: none; cursor: pointer; color: #777;
          display: flex; align-items: center; justify-content: center;
          padding: 4px; border-radius: 8px;
        }
        .ht-icon-btn:hover { background: rgba(0,0,0,0.06); }
```
Immediately after it, add:
```css

        .ht-card-menu {
          position: absolute; right: 0; top: calc(100% + 4px); z-index: 20;
          background: #fff; border-radius: 10px; box-shadow: 0 6px 18px rgba(0,0,0,0.15);
          display: flex; flex-direction: column; min-width: 110px; overflow: hidden;
        }
        .ht-card-menu button {
          padding: 8px 12px; text-align: left; border: none; background: none; cursor: pointer;
          font-size: 0.8rem; font-weight: 600; color: #444;
        }
        .ht-card-menu button:hover { background: rgba(0,0,0,0.05); }
```
(Minimal, functional styling only — the visual treatment of this menu is explicitly deferred to the separate visual/motion design pass; this task only needs it legible and usable.)

- [ ] **Step 6: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors, project-wide.

- [ ] **Step 7: Verify by reading**

1. Confirm `HabitCard`'s `[⋯]` button and its menu are inside the same `onClick={e => e.stopPropagation()}` wrapper as the Done button, so clicking them doesn't also trigger the card's `onOpenDetail`.
2. Confirm the Paused badge only renders when `habit.task_status === 'paused'`, sitting alongside (not replacing) `PriorityBadge`.
3. Confirm `Pencil`/`Trash2` are no longer imported and nothing else in the file references them (a stray reference would be a `tsc` error anyway, but confirm by reading).
4. Confirm the click-outside handler only attaches its `document` listener while `menuOpen` is true (not permanently on every card, which would be wasteful with many cards on screen), and correctly removes it on unmount/close.

- [ ] **Step 8: Verify against the real local dev DB**

Using the same session-token approach as Task 1: load the dashboard, confirm a paused habit (created via a direct `POST /api/habits/[id]/pause` call, or via the new menu) shows the Paused badge under "All rituals" and is absent from the "Today" filter view even if scheduled today; confirm the `[⋯]` menu opens, shows "Resume" instead of "Pause" for an already-paused habit, and that clicking outside the menu closes it.

- [ ] **Step 9: Commit**

```bash
git add src/components/habits/HabitsDashboard.tsx
git commit -m "Add Paused badge and a functional overflow menu (Edit/Pause-Resume/Delete) to ritual cards" -- src/components/habits/HabitsDashboard.tsx
```

---

### Task 3: Update the migration log

**Files:**
- Modify: `habittracker-log.md`

- [ ] **Step 1: Append a new section**

Read the current file first to match its exact heading/tone/detail-level conventions. Append a new `## Habit Tracker v8 — Pause lifecycle` section covering: the reuse of the pre-existing-but-unused `task_status` column and the new `habit_pauses` history table; why a naive "just flip a flag" implementation wouldn't have actually frozen the streak (the shared streak-walk primitive recomputes from full history on every check-in, so a past pause window has to be permanently remembered and excluded from that walk, not just skipped "for now"); the exclusion of paused habits from Today's Rituals and every weekly analytic while still showing them under "All rituals" with a Paused badge; the server-side rejection of check-in/undo/amount actions on a paused habit; the explicit non-goals (flexible habits get simpler treatment with no per-day history machinery; the 12-week history detail view is not made pause-aware); and the new `[⋯]` overflow menu replacing the three-button action row, explicitly noting its visual treatment is minimal/functional by design, deferred to a separate planned visual/motion pass. Note this was verified by real API/DB calls against the local dev database, including directly testing the streak-freeze behavior via a simulated past pause window (not just the "excluded while currently paused" surface behavior).

- [ ] **Step 2: Commit**

```bash
git add habittracker-log.md
git commit -m "Document Habit Tracker v8 shipment in the migration log" -- habittracker-log.md
```
