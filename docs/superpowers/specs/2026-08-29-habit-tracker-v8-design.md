# Habit Tracker v8 — Pause Lifecycle — Design

**Status:** Approved for planning
**Date:** 2026-08-29
**Depends on:** Habit Tracker v7 (drop Type, rename Purpose to Note), shipped and reviewed the same day.
**Origin:** user request, second of four sub-projects decomposed from a larger follow-up ask (data-model cleanup → **Pause lifecycle** → pace-wording fix → visual/motion round 2). Three behavioral decisions were made explicitly by the user before this spec was written: the streak freezes while paused (resuming continues from the same count, not reset); a paused habit is fully excluded from Today's Rituals and every weekly analytic while paused; a paused habit still appears under "All rituals" with a visible Paused indicator. A technical wrinkle discovered while designing this (below) was presented in chat and approved before writing this spec: making "freeze" genuinely correct — not just "leave the number alone for now" — requires the pause window itself to be permanently remembered and excluded from the streak's day-by-day recomputation, not just skipped in the moment.

## Problem

There is currently no way to temporarily step away from a ritual without either deleting it (losing all history) or letting it sit there accumulating missed days and a broken streak. "Pause" fills that gap: a deliberate, reversible off-switch.

The naive implementation — just flip a status flag and hide the habit — doesn't actually deliver "freeze," because of how this app's streaks work: `current_streak`/`longest_streak` are **stored** values (in `habit_streaks`), not computed live on every page load. They only change when `recomputeFixedStreak` runs, which happens on check-in, undo, amount-set, or an edit to a fixed-schedule habit — and that function recomputes the *entire* streak from the full check-in history, walking backward day by day from today, breaking on the first scheduled-but-not-completed day it finds. If a paused week's scheduled days are invisible to that walk only "for now," the very first check-in after resuming re-runs the full walk, sees those days as ordinary misses, and resets the streak anyway — precisely the outcome "freeze" is supposed to prevent. The fix has to live in the walk itself, permanently, for any date that ever fell inside a recorded pause window.

## Goals

- A habit can be paused and resumed, any number of times over its life, without losing history or its streak.
- While paused: the streak's stored value doesn't change; the habit disappears from "Today's Rituals" and every weekly analytic (Rhythm %, category consistency, on-pace/needs-attention, weekly rhythm, at-risk count); the habit still appears under "All rituals," visibly marked Paused; check-in/undo/amount actions are rejected server-side (not just hidden client-side).
- Every date that ever fell inside a pause window is permanently treated as "not scheduled" by the day-by-day streak walk and the per-card chain visualization — forever, not just while the pause is active — so a resumed habit's next check-in correctly continues its prior streak instead of resetting it.
- A minimal, functional UI surface for triggering Pause/Resume (a small overflow menu replacing the current three-button row) ships now; its visual polish is explicitly deferred to the separate visual/motion design pass already planned as this decomposition's fourth sub-project — this spec only needs the menu to work correctly, not to look distinctive yet.

## Non-goals

- **Flexible-schedule habits get simpler treatment, not the same machinery.** They have no day-by-day chain to protect. Pausing a flexible habit excludes it from analytics and Today's Rituals exactly like a fixed habit, and its `week_progress`/pace for any week touched by the pause is simply not computed (the habit contributes nothing to that week, same as a fixed habit's paused days contribute nothing to its chain) — but no historical pause-window table lookups are threaded through flexible-habit logic, since there's no per-day state to protect there.
- **The 12-week history detail view (`HabitDetailModal`/`getHabitHistory`) is explicitly NOT made pause-aware in this pass.** A week that was fully or partially paused will still show as low/zero in that chart, and `weekly_streak`/`best_week` won't account for pause windows. This is a known, accepted limitation of this pass, not an oversight — the history view is a secondary, less-frequently-opened deep-dive, and extending it correctly would mean re-deriving the same interval-exclusion logic for a structurally different (weekly-bucket) algorithm. Worth a follow-up if it turns out to matter in practice.
- No visual redesign of the pause/resume UI beyond making it functionally correct — the overflow menu's actual look (icon, spacing, animation) is explicitly sub-project 4's job, not this one's.
- No change to `habit_urgency`, `priority`, `note`, or any other existing column/behavior untouched by this spec.

## Design

### 1. Schema

**Reuse `task_status`.** `habit_tasks` already has a `task_status ENUM('active','archived') DEFAULT 'active'` column from the legacy PHP-era schema — confirmed unused anywhere in the current Next.js app (no read, no write, no filter). Extend it rather than adding a new column:
```sql
ALTER TABLE habit_tasks MODIFY task_status ENUM('active','archived','paused') NOT NULL DEFAULT 'active'
```
`MODIFY` on an enum is naturally idempotent (re-running the identical definition is always a safe no-op, unlike `ADD COLUMN`/`DROP COLUMN`, which need the error-code-catch idempotency pattern used elsewhere in this file) — no special guard needed. `'archived'` remains unused and untouched; this pass only ever writes `'active'` or `'paused'`.

**New table `habit_pauses`** — the permanent historical record every pause window needs for the streak walk to stay correct forever, not just "for now":
```sql
CREATE TABLE IF NOT EXISTS habit_pauses (
  pause_id INT NOT NULL AUTO_INCREMENT,
  habit_id INT NOT NULL,
  paused_at DATE NOT NULL,
  resumed_at DATE NULL,
  PRIMARY KEY (pause_id),
  KEY habit_id (habit_id),
  CONSTRAINT fk_pause_habit FOREIGN KEY (habit_id) REFERENCES habit_tasks (habit_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
```
`resumed_at IS NULL` means the pause is currently ongoing. A habit can have many rows over its life (paused/resumed repeatedly) — every one of them stays forever and permanently excludes its date range from that habit's streak/chain math, even long after the habit is resumed.

Both statements go in one new exported function in `src/lib/migrate.ts`, following this file's established pattern (module-level "ran" flag, called from all 6 `src/app/api/habits/**` route files alongside the existing migration calls — the same wiring v7 just added, extended with one more call):
```ts
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
Both statements (`MODIFY` on an enum, `CREATE TABLE IF NOT EXISTS`) are naturally idempotent on their own — no error-code-catch guard is needed here, unlike v7's `DROP COLUMN`/`CHANGE COLUMN` (which genuinely fail on a re-run without one). The module-level flag is still worth keeping, purely to avoid two redundant round-trips to the database on every request within an already-initialized process, matching this file's established style — not because either statement would break without it.

### 2. The pause-aware streak/chain primitive

`src/lib/habitDate.ts`'s `computeConsecutiveScheduledStreak` gains an optional 4th parameter:
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
  const CAP = 3650;
  for (let i = 0; i < CAP; i++) {
    const wd = weekdayOfDateStr(cursor);
    if (scheduledWeekdays.has(wd) && !isPaused(cursor)) {
      if (completedDates.has(cursor)) {
        length++;
        start = cursor;
        cursor = addDaysToDateStr(cursor, -1);
        continue;
      }
      break;
    }
    cursor = addDaysToDateStr(cursor, -1);
  }
  return { length, start };
}
```
A date inside a pause range is routed into the same branch as a genuinely-unscheduled weekday — skipped without breaking or extending the run. `end` is exclusive: a range `{ start: '2026-08-10', end: '2026-08-17' }` covers Aug 10 through Aug 16 (the day you resumed, Aug 17, counts as a normal day again). The default empty array means every existing caller of this function is unaffected — this is purely additive to the function's contract.

A new helper in `src/lib/habits.ts` builds that range list for one habit:
```ts
async function getPausedRangesForHabit(habitId: number): Promise<{ start: string; end: string }[]> {
  const { dateStr: today } = todayInManila();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT paused_at, resumed_at FROM habit_pauses WHERE habit_id = ?`, [habitId]
  );
  return rows.map(r => ({
    start: r.paused_at as string,
    end: (r.resumed_at as string | null) ?? addDaysToDateStr(today, 1),
  }));
}
```
An ongoing pause (`resumed_at IS NULL`) gets an exclusive end of "tomorrow," so it correctly covers every day up to and including today.

### 3. Backend logic (`src/lib/habits.ts`)

- `HabitRow` and `HabitWithComputed` both gain `task_status: 'active' | 'paused'` (the `'archived'` enum value is never produced by any code path in this app and is deliberately not modeled in the TypeScript surface, matching this file's existing practice of not representing DB states no code path can create).
- `recomputeFixedStreak`: fetch `getPausedRangesForHabit(habitId)` and pass it as `computeConsecutiveScheduledStreak`'s 4th argument.
- `getHabitsForUser`: for the fixed-schedule branch, fetch each habit's paused ranges (batchable: one query for all habit IDs at once, `WHERE habit_id IN (...)`, grouped client-side — mirroring how `checkinRows`/`streakRows` are already batched in this function) and use them when building each day's `ChainDay.scheduled`: `scheduled: scheduled.has(weekday) && !isPausedOnDate(habitId, date)`. Since `week_expected`/`week_actual` are already derived by iterating the chain and checking `day.scheduled`, this one change cascades correctly to both without any further edits. Add `task_status: row.task_status` to the shared `base` object. Force `is_today: false` whenever `row.task_status === 'paused'`, in both the flexible branch (which currently hardcodes `is_today: true`) and the fixed branch (`scheduled.has(todayWeekday)`) — this single override is what makes a paused habit invisible to the "Today's Rituals" filter and to `today_total`/`today_completed` with no other change needed anywhere else.
- `getSummaryForUser`: filter the habits array to exclude paused habits BEFORE any aggregation: `const habits = (await getHabitsForUser(userId)).filter(h => h.task_status !== 'paused');` as the very first line after the existing `getHabitsForUser` call. Every aggregate this function computes (`weekly_expected`, `category_consistency`, `on_pace`/`needs_attention`, `weekly_rhythm`, `at_risk`, `longest_streak`) already operates on whatever `habits` array is passed in, so this one filter point closes off every analytic at once.
- `checkinHabit`, `undoCheckinHabit`, `setAmount`: each already starts by fetching the owned habit row (`const habit = await getOwnedHabitRow(...)`). Add, immediately after that fetch in all three: `if (habit.task_status === 'paused') throw new Error('This ritual is paused — resume it before checking in.');` — a server-side guard independent of the UI hiding the action, since the API is directly callable.
- Two new exported functions:
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
Neither function calls `recomputeFixedStreak` — the stored streak value is left exactly as it was, which combined with the pause-range exclusion above is what makes the next real check-in correctly continue rather than reset it.

### 4. API

New route file `src/app/api/habits/[id]/pause/route.ts`, matching `checkin/route.ts`'s exact existing convention byte-for-byte (confirmed by reading that file directly): `NextRequest` imported but unused (`_req`), `params` as a destructured `Promise<{ id: string }>`, and `err instanceof HabitNotFoundError ? 404 : 400` for error status:
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

`ensureHabitPauseSchema` (the new migration function from §1) is also wired into the same 6 existing route files under `src/app/api/habits/**` that already call the other three habit-schema migrations, matching v7's exact wiring pattern.

### 5. Frontend (`src/components/habits/HabitsDashboard.tsx`)

- Import `task_status`'s type via `HabitWithComputed` (no new type import needed — it's a field, not a new exported type, aside from a small inline union or reusing the string literal directly).
- A small "Paused" badge, shown on `HabitCard` whenever `habit.task_status === 'paused'` — a muted gray pill, placed alongside the existing `PriorityBadge` in the card's top-right corner. Final visual treatment is sub-project 4's job; this pass just needs it present and legible.
- Replace the current three-button action row (`[✓ Done] [✎ Edit] [🗑]`) with `[✓ Done]` (unchanged, still the primary action, already correctly disabled by the existing `canAct` check once `is_today` is forced false for a paused habit — no new logic needed there) plus a small `[⋯]` overflow-menu button opening Edit / Pause-or-Resume / Delete. This requires:
  - New local state in `HabitCard`: `const [menuOpen, setMenuOpen] = useState(false);` and a click-outside-to-close handler (a `useEffect` adding a `document` `mousedown` listener that closes the menu when the click target is outside the menu's ref — the standard, minimal pattern for this, using a `useRef` on the menu's wrapper div).
  - The menu's three items call: `onEdit` (existing prop, unchanged), a new `onPauseToggle` prop that the parent wires to either `doPause`/`doResume` based on `habit.task_status`, and `onDelete` (existing prop, unchanged).
  - In the parent `HabitsDashboard` component: two new handlers, `doPause`/`doResume`, following the exact same `withBusy` wrapper pattern as `doCheckin`/`doUndo`/`doDelete` (`POST /api/habits/${id}/pause` and `DELETE /api/habits/${id}/pause` respectively, each followed by `await load()`).
- No change to `WeekDots` or `ChainRow` themselves — a paused fixed habit's chain days simply arrive with `scheduled: false` for every day inside the pause window (per §3), so they render exactly like any other unscheduled day (faint hollow ring) with zero new rendering logic.

## Migration & compatibility

Additive-only: `task_status`'s `MODIFY` widens an enum (no data loss, existing `'active'`/`'archived'` rows unaffected), and `habit_pauses` is a brand-new table. No existing column, endpoint, or behavior is removed or changed for a habit that's never been paused — `getPausedRangesForHabit` returns an empty array for such a habit, and an empty `pausedRanges` array is exactly this pass's default, byte-for-byte preserving today's behavior for every habit that never uses this feature.

## Testing / verification plan

Same standing approach as v1–v7 (no test framework in this repo): `tsc --noEmit`, then real calls against the local dev DB via a locally-signed session token —
- Pause a fixed-schedule habit with an existing streak; confirm it disappears from "Today's Rituals" (if scheduled today) and from every field of `GET /api/habits/summary` (weekly_expected, category_consistency, on_pace/needs_attention, at_risk, weekly_rhythm), while still appearing in the `GET /api/habits` response with `task_status: 'paused'` and its streak numbers unchanged from their pre-pause values.
- While paused, attempt `POST /api/habits/[id]/checkin` — confirm it's rejected with a clear error, not silently accepted.
- Let at least one scheduled day pass while paused (or simulate by pausing, waiting a day if testing across a real day boundary is feasible, or directly inserting a `habit_pauses` row with a `paused_at` a few days in the past for test purposes), then resume and check in — confirm `current_streak` continues from its pre-pause value rather than resetting to a small number reflecting the paused days as misses.
- Confirm the per-card chain shows the paused date range as unscheduled (faint hollow rings), not as missed (red rings).
- Pause a flexible-schedule habit mid-week; confirm its `week_progress`/pace stop being counted for the remainder of that week while paused, and confirm it's excluded from `today_total`/`today_completed` and all summary aggregates the same as a fixed habit.
- Resume a paused habit; confirm it reappears in "Today's Rituals" (if scheduled today) and in every summary aggregate immediately.
- Confirm a habit that has NEVER been paused behaves identically to before this pass (empty `pausedRanges`, no behavior change) — this is the regression-safety check for the whole plan.
- Confirm the new `[⋯]` overflow menu opens/closes correctly (including click-outside-to-close), and that Edit/Pause-or-Resume/Delete all still work exactly as before from within it.
