# Habit Tracker v2 — Flexible Scheduling + Numeric Tracking — Design

**Status:** Approved for planning
**Date:** 2026-08-28
**Depends on:** the Habit Tracker Next.js port shipped earlier this session (`src/lib/habits.ts`, `src/lib/habitDate.ts`, `src/app/api/habits/**`, `src/components/habits/HabitsDashboard.tsx`). See `habittracker-module-audit.md` and `habittracker-log.md` for that migration's history.
**Origin:** product-direction document from an external AI auditor (pasted into this conversation, not authored by the user), refined through two rounds of critique — first by the assistant, then by a second auditor pass the user relayed. This spec is the reconciled result, not a transcription of either input.

## Problem

The habit tracker currently supports exactly one shape of habit: a boolean check-in against a fixed set of weekdays. Two real gaps:

1. **Everything has to be forced onto fixed weekdays.** "Study four times this week, whichever days" has no representation — the user has to pre-commit to specific days even when the actual intent is a weekly count.
2. **Everything has to be forced into did/didn't.** "8 glasses of water," "30 minutes of reading," "2 liters" collapse to a single tap, discarding the actual amount — which also means the analytics answer "did they hit it" instead of the more honest "how much of it did they get."

This also sets up the aggregate analytics section (`getSummaryForUser`) to make an unforced error later: if numeric habits are added but completion stays binary, a habit at 6/8 glasses reads identically to a habit at 0/8. That gets fixed here, before the Rhythm section has real numeric data to summarize.

## Goals

- A habit can be scheduled **fixed** (specific weekdays, existing behavior) or **flexible** (a weekly occurrence count, any day).
- A habit can be tracked as **boolean** (existing did/didn't) or **numeric** (an amount logged per occurrence against a per-occurrence target and unit).
- The two axes are independent — any combination of schedule × tracking is valid.
- Existing habits are unaffected: default to `fixed` + `boolean`, byte-identical behavior to what's live today.
- The Rhythm analytics section (daily bars, category consistency, Strongest/Needs-attention) reasons in **fulfillment** (a 0–1 ratio per occurrence), not raw completion counts, so partial numeric progress isn't thrown away.

## Non-goals (explicitly deferred)

- **Weekly consistency streaks for flexible habits** ("3 weeks in a row hit target"). The critique that shaped this spec explicitly framed this as "V1 doesn't calculate this" rather than "flexible habits can't have this" — nothing here should make it structurally harder to add later. Not designed in detail now.
- **Habit lifecycle status** (Active/Paused/Ended). A real "paused, don't count against me, keep my history" state is a good idea and explicitly not `task_status`'s old "scheduled today" meaning — but it's a separate concern from schedule/tracking mode and isn't needed to ship either of those. Not built.
- **Workboard integration of any kind.** No `related_workboard_contexts`, no task linkage, nothing. Workboard doesn't exist yet as a subsystem; designing a relationship to it now would shape this feature around assumptions that might not survive Workboard's own design pass.
- **Keeping habit categories "lightweight."** No change to categories in this pass — noted here only as a boundary for later: Workboard's future "context" concept (Personal/Academic/Organization, with real behavioral implications) should not be conflated with Habit Tracker's category (organizational/analytical only).

## Data model

Two migrations, both idempotent (`ALTER TABLE ... ADD COLUMN`, catching `ER_DUP_FIELDNAME`), following the existing pattern in `src/lib/migrate.ts` (see `ensureCanvasSchema`, `ensureGradeScale`, etc.):

```sql
ALTER TABLE habit_tasks
  ADD COLUMN schedule_mode ENUM('fixed','flexible') NOT NULL DEFAULT 'fixed',
  ADD COLUMN tracking_type ENUM('boolean','numeric') NOT NULL DEFAULT 'boolean',
  ADD COLUMN target_value  DECIMAL(6,1) NULL,   -- numeric only; per-occurrence target
  ADD COLUMN unit_label    VARCHAR(24)  NULL,   -- numeric only; e.g. "glasses", "min"
  ADD COLUMN step_value    DECIMAL(6,1) NULL DEFAULT 1;  -- numeric only; stepper increment

ALTER TABLE habit_checkins
  ADD COLUMN amount DECIMAL(6,1) NULL;   -- numeric only; ground truth
```

`times_per_week` (existing column) is reused, not replaced: for `schedule_mode='fixed'` it stays derived from `days_of_week.length` exactly as today; for `schedule_mode='flexible'` the user sets it directly (there are no days to derive it from) and `days_of_week` is unused/empty for that habit.

Every existing row defaults to `schedule_mode='fixed', tracking_type='boolean'` — zero behavior change for anything already in the database.

### The completion-derivation rule (the one piece of real design here)

This is the load-bearing decision the second critique round corrected:

- **Boolean check-ins**: `habit_checkins.is_completed` is written directly and is the authoritative fact, exactly as today. There is no `amount` to derive it from.
- **Numeric check-ins**: `habit_checkins.amount` is the *only* fact ever written. `is_completed` is left `NULL` and is **never trusted** for a numeric row — every read path derives completion fresh: `completed = amount != null && amount >= habit.target_value`.

Rejected alternative: compute `is_completed = amount >= target` once at write time and store it. This was the original proposal in this conversation; the critique correctly identified it creates a second fact that can silently disagree with `amount` the moment `target_value` is edited after check-ins already exist. Deriving on every read means there is structurally one source of truth, and editing a habit's target retroactively reinterprets history consistently (arguably a feature: "how am I doing against my *current* goal" rather than a frozen one) rather than a bug to guard against.

A single helper centralizes this so no call site re-implements the rule:

```ts
// src/lib/habitFulfillment.ts
function occurrenceFulfillment(habit: HabitCore, row: { is_completed?: number; amount?: number | null }): number {
  if (habit.tracking_type === 'boolean') return row.is_completed ? 1 : 0;
  if (row.amount == null || !habit.target_value) return 0;
  return Math.min(row.amount / habit.target_value, 1);
}
function occurrenceCompleted(habit: HabitCore, row: ...): boolean {
  return occurrenceFulfillment(habit, row) >= 1;
}
```

`computeConsecutiveScheduledStreak`'s `completedDates: Set<string>` (used for fixed-schedule streaks, boolean or numeric) is now built by filtering check-in rows through `occurrenceCompleted`, not by reading `is_completed` directly off the row for numeric habits. Boolean habits' behavior is bit-for-bit unchanged, since `occurrenceCompleted` reduces to `row.is_completed` for them.

## Target semantics: per-occurrence, not per-week

Called out explicitly because the original draft of this feature left it ambiguous: **`target_value` is always per-occurrence**, never a weekly total. "Exercise, 3×/week, 30 min each" is the only supported shape — not "30 minutes total across the week." Schedule frequency (`times_per_week` / fixed days) and the tracking target are fully independent numbers, and the UI states both explicitly ("3× weekly · 30 min each") so this is never left for the user to infer.

## API changes

**Existing, behavior unchanged for `tracking_type='boolean'`:**
- `POST /api/habits`, `PATCH /api/habits/[id]` — body gains four optional fields (`schedule_mode`, `tracking_type`, `target_value`, `unit_label`, `step_value`); omitted = today's fixed/boolean defaults.
- `POST /api/habits/[id]/checkin`, `DELETE /api/habits/[id]/checkin` — **boolean habits only** now (was implicitly all habits). Calling either against a numeric habit returns `400`.

**New:**
- `PUT /api/habits/[id]/amount` — body `{ amount: number, date?: string }` (date defaults to today, Asia/Manila). Upserts `habit_checkins.amount` for that day — **numeric habits only**. This is deliberately not a POST/DELETE pair: adjusting a number with ± isn't a toggle with an undo, it's one idempotent fact being set. `amount: 0` is a valid, meaningful value (stored, not treated as "delete the row") — "0 glasses today" is a fact like any other, and fulfillment math already handles it (`0/target = 0`) with no special-casing. There is no separate "clear this entry" delete endpoint for numeric habits — an unset day and a day explicitly logged at `amount: 0` are functionally identical to every downstream calculation (`occurrenceFulfillment` returns `0` either way), so a second endpoint would add an API surface without adding a distinguishable outcome.
- `GET /api/habits` — each habit gains `schedule_mode`, `tracking_type`, `target_value`, `unit_label`, `step_value`; for `schedule_mode='flexible'` habits, `chain` is replaced by `week_progress: { completed: number; target: number }` (no calendar days, no fixed nodes — see UI section); `current_streak`/`longest_streak` are omitted (not zero — genuinely absent, since v1 doesn't compute them for flexible habits, per Non-goals).
- `GET /api/habits/summary` — `weekly_rhythm[].percent` and `category_consistency[].percent` are now averaged **fulfillment**, not completion-count ratios (see below). `most_urgent` unchanged. New: `strongest` / `needs_attention` (see Rhythm section).

## Rhythm analytics — fulfillment-weighted, not count-weighted

Every place `getSummaryForUser` currently does `completed / scheduled * 100` changes to `sum(occurrenceFulfillment(...)) / scheduled * 100`. Concretely: a water habit logging 8/8, 6/8, 8/8, 4/8 across four scheduled days now contributes `(1 + 0.75 + 1 + 0.5) / 4 = 81.25%` to whatever aggregate it belongs to, instead of a binary `2/4 = 50%` that discards the two partial days entirely.

**Strongest / Needs-attention** (new): for each habit with at least one scheduled occurrence in the trailing 7-day window, compute its own mean fulfillment. Highest → "Strongest: {name} — {pct}% of target"; lowest → "Needs attention: {name} — {pct}% of target". Ranked by fulfillment rate, not raw completion count — a habit at 3/3 (100%) outranks one at 5/7 (71%) even though 5 > 3. Fewer than two eligible habits → section doesn't render (nothing to compare).

Per-card visuals (chain nodes, week-progress dots) stay **binary** (hit target or not) — the nuance lives in the aggregate math, not in redrawing every node as a partial-fill ring. This keeps the at-a-glance card legible while the analytics underneath are honest.

## UI

### Add/Edit modal — two new toggles, both defaulting to today's only options

- **Schedule:** Fixed days (existing Mon–Sun buttons) / Flexible (a single "times per week" number field replaces the day buttons).
- **Tracking:** Yes/No (nothing extra shown) / Track an amount (reveals Target, Unit, and — collapsed under an "Increment" disclosure, not upfront — Step, defaulting to 1).

### Card variants — two independent axes, four combinations, but only two visual swaps

| | Schedule visual | Tracking visual |
|---|---|---|
| Fixed | 7-day chain (unchanged) | — |
| Flexible | Dot cluster, tightly grouped and centered (not edge-to-edge like the chain), **no connecting line** — both the missing line and the different layout signal "this is a count, not a timeline" (a single missing line alone was flagged as insufficient differentiation on its own) | — |
| Boolean | — | Done/Undo button (unchanged) |
| Numeric | — | `AmountInput`: `[−] [amount] [+] unit` with a visible "Today" label (not placeholder-only), unit suffix, and a thin fill bar beneath that turns from neutral gray to the app gradient at ≥100%, with the same soft `#42c38b` tint the boolean Done state already uses once fulfilled — same success color language, different interaction |

`AmountInput` auto-saves to `PUT .../amount`: each ± tap updates the visible number immediately and fires the request debounced ~500ms (so rapid clicking doesn't spam the endpoint); typing directly into the number field commits on blur or Enter.

Numeric habits show the per-occurrence target explicitly in the card's meta line: "3× weekly · 30 min each" (schedule frequency and tracking target stated together, per the ambiguity fix above).

### Rhythm section additions

"Strongest: Exercise — 100% of target" / "Needs attention: Water — 69% of target" as plain sentences (bolded habit name, small category-color dot prefix) above the existing daily bars — not boxed as stat tiles, so they read as interpretation next to numbers, not a fifth/sixth stat. "Overall" becomes the first row of the existing category-consistency bar list.

## Migration & compatibility

- All new columns nullable-or-defaulted; existing rows need no backfill.
- Existing `GET /api/habits` consumers (i.e., `HabitsDashboard.tsx` itself) get new optional fields — TypeScript's structural typing means the component must be updated to branch on `schedule_mode`/`tracking_type`, but nothing breaks silently; this is done as part of the same implementation pass, not left dangling.
- `financetracker`-style parallel PHP pages don't exist for habits anymore (already fully retired in the earlier migration), so there is no second stack to keep in sync.

## Testing / verification plan

Same approach as the original Habit Tracker port (no browser-automation tool available in this environment): `tsc --noEmit`, then exercise the real local dev DB via a locally-signed dev-secret session token (no password data touched):
- Regression: existing fixed+boolean habit create/checkin/undo/streak flows unchanged.
- New: create flexible+boolean, fixed+numeric, flexible+numeric habits; log/adjust amounts via `PUT .../amount` including `amount: 0` and amounts crossing the target threshold in both directions; confirm `computeConsecutiveScheduledStreak` correctly derives completion for a fixed+numeric habit without ever reading a stored `is_completed` for those rows; confirm flexible habits never write to `habit_streaks`; confirm summary fulfillment math against hand-computed expected percentages for a mixed boolean/numeric habit set; cross-user isolation on the new `amount` endpoint.
