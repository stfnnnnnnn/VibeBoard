# Habit Tracker v3 — Actionable Dashboard, Priority, Minimum Targets, History — Design

**Status:** Approved for planning
**Date:** 2026-08-28
**Depends on:** Habit Tracker v2 (`docs/superpowers/specs/2026-08-28-habit-tracker-v2-design.md`), shipped and reviewed this session.
**Origin:** a second external-AI-auditor critique of the shipped v2 dashboard, evaluated and reconciled with the user (see conversation) — explicitly excludes Schedule integration (Schedule doesn't exist as a module yet) and folds in a user-confirmed ruling on minimum-target streak semantics.

## Problem

v2 shipped the *mechanism* (flexible scheduling, numeric tracking, fulfillment-weighted analytics) but the dashboard built on top of it is still closer to a stats page than a decision aid. Four concrete gaps, evaluated on their merits rather than taken wholesale from the critique:

1. **The stat rail doesn't help anyone decide anything.** "Total Rituals: 3" and "Done Today: 2/2" (which already duplicates the header line above it) aren't actionable.
2. **The daily-completion chart reintroduces the exact bug the streak algorithm was built to fix.** A day with nothing scheduled and a day that was scheduled-but-missed currently render as the same near-invisible sliver — "did I fail every day this week?" instead of "half these days had nothing due."
3. **Cards answer "what happened" but not "what now."** A flexible habit shows dots; it doesn't say how many are left, how many days remain to get them, or whether the user is behind pace for a Monday-vs-Friday-appropriate reading of "33% done."
4. **Urgency doesn't fit habits.** Deadline urgency belongs to Workboard (a task with a due date). A recurring behavior isn't "urgent" — it has a priority tier at most.

Two more items from the critique are approved but larger: numeric habits gaining an optional **minimum** (a forgiving floor distinct from the target), and a **read-only history detail view** per habit (12-week trend, best week, total check-ins). Schedule integration (suggested time windows, "Next: Thu 4:30 PM") is explicitly out — Schedule isn't a module yet.

## Goals

- Replace the stat rail with numbers that describe the *week*, not the *instant*, and that don't duplicate the header.
- Daily completion chart distinguishes three states: nothing scheduled, scheduled-and-missed, scheduled-and-partially/fully-done.
- Every card states its own remaining work and, for the current week, whether it's ahead of, on, or behind pace — using a "expected progress by today" model, not a flat percentage.
- Clicking a day in the weekly chart shows exactly which habits were done/not that day, using data already on the page (no new endpoint).
- `habit_urgency` (5-tier, deadline-flavored) is replaced by `priority` (3-tier: `core` / `normal` / `optional`), visually de-emphasized relative to how urgency was styled.
- Numeric habits may optionally set a `minimum_value` below `target_value`. Per the confirmed ruling: **reaching the minimum preserves the streak/chain fill; the target remains a separate, higher milestone shown on the card but does not gate completion.**
- A read-only per-habit detail view: 12-week trend, best week, a *newly computed* weekly-consistency streak for flexible habits (this was explicitly deferred in the v2 spec's Non-goals — building the detail view naturally requires it, computed on-demand in the new endpoint only, not added to the hot dashboard path), total check-ins, start date, recent check-ins.

## Non-goals (explicitly deferred, unchanged from before)

- **Schedule integration** — suggested time windows, "next planned" times, calendar placement. Schedule doesn't exist as a module.
- **Editing from inside the detail view.** It's read-only; editing stays in the existing Add/Edit modal.
- **An all-time weekly-consistency streak.** The detail view's weekly streak is computed only over the same 12-week window already being fetched for the chart — good enough for "3 successful weeks," not a true unbounded historical record.

## Data model

Two migrations, both idempotent, added to the existing `ensureHabitTrackingSchema()` pattern in `src/lib/migrate.ts` (or a new sibling function following the identical style — implementer's call, matching whichever reads more naturally alongside the existing v2 function):

```sql
ALTER TABLE habit_tasks
  ADD COLUMN priority ENUM('core','normal','optional') NOT NULL DEFAULT 'normal',
  ADD COLUMN minimum_value DECIMAL(6,1) NULL;   -- numeric-tracking only; NULL = no minimum (today's behavior)
```

`habit_urgency` is **not dropped** — it stays in the schema, untouched, unread, unwritten by the app going forward (consistent with this project's convention of additive-only migrations; no destructive `DROP COLUMN`). The application layer (TypeScript types, validation, UI) removes it entirely rather than keeping a dead field around in code.

**One-time backfill**, run inside the same migration function immediately after `priority` is successfully added (guarded so it only ever runs once, the same way the column-add itself is guarded — e.g. only execute the backfill in the branch where the `ALTER TABLE ADD COLUMN priority` call actually succeeded, not on the `ER_DUP_FIELDNAME` path):

```sql
UPDATE habit_tasks SET priority = CASE
  WHEN habit_urgency IN ('Urgent','Priority') THEN 'core'
  WHEN habit_urgency = 'Important' THEN 'normal'
  ELSE 'optional'  -- 'Not Important', 'Not Urgent'
END;
```

## The completion-derivation rule, amended for minimum targets

This changes an invariant v2 established: previously, `occurrenceCompleted(habit, row) ⟺ occurrenceFulfillment(habit, row) >= 1`. With a minimum, that's no longer true whenever `minimum_value < target_value` — reaching the minimum completes the occurrence (streak-preserving) without reaching `fulfillment >= 1`.

`src/lib/habitFulfillment.ts` changes:

```ts
export interface FulfillmentHabit {
  tracking_type: 'boolean' | 'numeric';
  target_value: number | null;
  minimum_value?: number | null;   // new, optional — omit/undefined behaves exactly as v2 (no minimum)
}

export function occurrenceFulfillment(habit: FulfillmentHabit, row: FulfillmentRow): number {
  // UNCHANGED from v2 — always measured against target_value, capped at 1.
  // This is the number Rhythm analytics consume; a minimum does not change
  // what "how much of your goal" means, only what counts as "done" below.
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

Every existing call site (the chain builder, `recomputeFixedStreak`, the flexible week-progress counter, `checked_in_today`) already calls `occurrenceCompleted` for the streak/chain/"is this occurrence done" question and `occurrenceFulfillment` separately for the analytics ratio — no call site needs to change, only the two functions' bodies. A habit with no `minimum_value` set behaves byte-identical to v2 (`bar` reduces to `target_value`, same as before).

## API changes

**`HabitInput`** (`src/lib/habits.ts`): drops `habit_urgency` entirely (no longer accepted or required); gains `priority?: 'core'|'normal'|'optional'` (default `'normal'`) and, for numeric habits, `minimum_value?: number | null` (must be `> 0` and `<= target_value` when provided — reject in `validateInput` otherwise with a clear message).

**`HabitWithComputed`**: `habit_urgency` → `priority`; gains `minimum_value: number | null`.

**`GET /api/habits`**: each habit gains, computed server-side (shared by the stat rail, per-card "what now" state, and the day-click interaction — computed once in `getHabitsForUser`, not duplicated client-side):
- `week_expected: number` — for `flexible`: `(daysElapsed / 7) * times_per_week`, where `daysElapsed` is today's 1-based position in the Mon–Sun week (Monday → 1, Sunday → 7 — the same `mondayOfWeek()` helper v2 already has gives the week start; `daysElapsed` is just the day-count from that date through today inclusive). For `fixed`: exact count of this habit's scheduled weekdays from Monday through today inclusive (not a ramp — fixed habits have a deterministic schedule, so "expected by today" is exact, not approximated).
- `week_actual: number` — count of this week's completed occurrences so far (fixed: count of `chain` days from Monday through today with `completed: true`; flexible: `week_progress.completed`, already computed in v2).
- `pace: 'ahead' | 'on_pace' | 'behind'` — `'behind'` when `week_actual < week_expected - 0.5` (half-occurrence tolerance so a fixed habit exactly on schedule doesn't flicker to "behind" from rounding); `'ahead'` when `week_actual > week_expected + 0.5`; `'on_pace'` otherwise.

**`GET /api/habits/summary`**: `HabitsSummary` gains:
- `weekly_targets: { completed: number; target: number }` — summed `week_actual`/target across every habit with a weekly target concept (all fixed + flexible habits; a fixed habit's "target" here is its `times_per_week`).
- `at_risk: number` — count of habits with `pace === 'behind'`.
- Drops `most_urgent` (no longer meaningful once urgency is gone from habits).

**New: `GET /api/habits/[id]/history?weeks=12`** — read-only, per-habit, called only when the detail view opens (never from the main dashboard load):
```ts
interface HabitHistoryWeek { week_start: string; completed: number; target: number; percent: number }
interface HabitHistoryResponse {
  weeks: HabitHistoryWeek[];        // oldest first, up to 12 entries (fewer if the habit is newer than 12 weeks)
  best_week: HabitHistoryWeek | null;
  weekly_streak: number | null;     // flexible habits only — consecutive most-recent weeks with completed >= target, computed over just the fetched window; null for fixed habits (they already have a daily streak, shown from the existing habit data, not duplicated here)
  total_checkins: number;           // all-time COUNT(*), cheap aggregate query — the one place this feature touches unbounded history, and only as a count, never as materialized rows
  started_at: string;               // habit_tasks.date_created
  recent: { date: string; completed: boolean }[];  // last 10 check-ins, most recent first
}
```

## UI

### Stat rail (replaces the 4 existing tiles)

`Weekly Targets` (`{sum week_actual} / {sum target}`) · `At Risk` (`{count}`, or "None" styled quietly when 0) · `Longest Streak` (unchanged) · `Best Rhythm` (reuses the existing `strongest` computation's name + percent — no new calculation, just a relabeled tile).

### Daily completion chart — three visual states

- **Nothing scheduled** (`scheduled: 0`): no bar. A short muted horizontal dash (`—`) at the chart's baseline, no height, `title="Nothing scheduled"`.
- **Scheduled, 0% fulfilled**: a small fixed-height bar (not scaling to zero) in a muted red/rose tone (reuse the existing "missed" red already used in `ChainRow`, `rgba(247,91,103,0.55)`-family), so a miss is visibly *present*, not indistinguishable from "nothing due."
- **Scheduled, >0% fulfilled**: unchanged from v2 — the existing gradient bar, height proportional to `percent`.

### Per-card "what now" additions

- **Flexible**: below `WeekDots`, one line: `"{target - completed} remaining · {daysLeftInWeek} day{s} left this week"`, plus a small pace tag (`⚠ Behind pace` / `On pace` / `Ahead of pace`, only rendered when it's informative — e.g. skip the tag entirely once the week's target is already met, since "ahead of pace" stops being useful information at that point).
- **Fixed**: add weekday-letter labels (`M T W T F S S`) beneath the existing 7-node chain, so the nodes stop requiring the user to infer which day is which. No new redundant status text — the existing Done/Undo button and streak line already state "what now" clearly enough; don't add a third overlapping sentence.
- **Numeric**: below the existing stepper+bar, one line: `"{target - amount} {unit} remaining"` (or `"Target reached ✓"` once `amount >= target`); when a `minimum_value` is set, the fill bar gains a third visual zone (see below) and the meta line reads `"Target {target} {unit} · Minimum {minimum} {unit}"` instead of the current `"{target} {unit} each"`.

### Minimum-target fill bar (numeric habits with `minimum_value` set)

Three zones instead of two: below-minimum (muted gray, as today's below-target look), at-or-above-minimum-but-below-target (a distinct amber/soft tone — "you showed up"), at-or-above-target (the existing full app-gradient "done" look). This is local to `AmountInput`'s own progress bar; it does not change the chain/week-dots, which stay binary per the confirmed ruling (a filled dot = `occurrenceCompleted`, which is now minimum-or-target depending on whether a minimum is set — one binary state either way, just a different threshold).

### Day-click interaction (daily completion chart)

Clicking a day's bar/dash toggles a small inline panel beneath the chart listing every habit scheduled that day with its status (`✓`/`○` + name), computed entirely client-side from the `habits` array already on the page (each habit's `chain[i]` already carries `scheduled`/`completed` for that date — no new fetch). Clicking the same day again, or a different day, toggles/replaces the panel. No new endpoint.

### Priority (replaces urgency everywhere in the UI)

- Card badge: same position as the old urgency pill, but restyled to read as lower-stakes — `core` gets a solid small badge (app blue), `normal` a light outline pill, `optional` plain muted text with no pill background at all (three tiers of visual weight matching three tiers of actual stakes, rather than one loud badge style for all of them).
- Add/Edit modal: the "Urgency" select becomes a "Priority" select with exactly `Core` / `Normal` / `Optional`.
- Filter dropdown: "Filter by Urgency" optgroup becomes "Filter by Priority" with the same 3 options.
- Numeric tracking fields in the modal gain an optional "Minimum" input, validated client-side (`<= target`) before submit, mirroring the server-side check.

### Habit detail view (new)

Clicking anywhere on a card **except** its interactive controls (Done/Undo, Edit, Delete, the `AmountInput` stepper/field) opens a read-only modal reusing the existing `.ht-modal`/`.ht-modal-backdrop` styling. Contents: habit name/category/schedule summary; the same `WeekDots`/`ChainRow` component already used on the card (current week at a glance); a new small 12-week bar chart (one bar per `HabitHistoryWeek`, height by `percent`); `Best week`; a streak stat row whose source differs by schedule mode — **fixed** habits show their existing `current_streak`/`longest_streak` (already present on the `habit` object passed into the modal, no need to refetch), **flexible** habits show `weekly_streak` from the new history endpoint instead (labeled "Current streak: N successful weeks"); `Total check-ins`; `Started {date}`; a `Recent check-ins` list (last 10, ✓/date). A close control; no editing surface inside.

Interactive controls inside a card must call `stopPropagation()` on their click handlers so clicking "Edit" doesn't also open the detail view underneath it.

## Migration & compatibility

- `priority`/`minimum_value` additive, defaulted/nullable — no existing behavior breaks. The urgency→priority backfill runs once, deterministically, from existing data.
- Dropping `habit_urgency` from the TypeScript/API/UI layers (while leaving the DB column alone) means any client still sending `habit_urgency` in a request body simply has that field ignored — `validateInput` no longer reads it.
- The new history endpoint is additive; nothing existing calls it.

## Testing / verification plan

Same approach as v1/v2 (no test framework in this repo; no browser-automation tool in this environment): `tsc --noEmit`, then real calls against the local dev DB via a locally-signed session token —
- Regression: an existing habit's card renders correctly with `priority` populated from the urgency backfill (spot-check the mapping against a few pre-v3 habits' original `habit_urgency` values).
- New: create a numeric habit with a minimum below target; log an amount at the minimum (confirm streak/chain shows completed, `occurrenceFulfillment` is still `< 1`); log above target (confirm both bars filled); attempt `minimum_value > target_value` (confirm rejected).
- Pace: hand-compute `week_expected`/`week_actual`/`pace` for a fixed and a flexible habit at a known point in the week and confirm the API matches.
- Chart states: confirm a day with `scheduled: 0` renders distinctly from a day with `scheduled > 0, percent: 0` in the actual DOM output (inspect the rendered style attributes, since no visual/browser check is available).
- History endpoint: confirm `weekly_streak` is only populated for flexible habits, `null` for fixed; confirm it only walks the fetched 12-week window, not full history; confirm `total_checkins` matches a direct `COUNT(*)` query.
- Detail-view click-through: confirm clicking a card's action buttons does not also open the detail modal (event propagation correctly stopped).
