# Habit Tracker v4 — Rhythm as the Centerpiece — Design

**Status:** Approved for planning
**Date:** 2026-08-28
**Depends on:** Habit Tracker v3 (`docs/superpowers/specs/2026-08-28-habit-tracker-v3-design.md`), shipped and reviewed this session.
**Origin:** a third external-AI-auditor critique of the dashboard. Evaluated against the actual shipped v3 code before acting on it — several of the critique's points (priority replacing urgency, the three-state daily chart, day-click drill-down, per-card remaining/pace text for flexible habits, the numeric stepper's minimum zone) are already shipped and describe a stale screenshot; this spec covers only what's genuinely still missing.

## Problem

v3 made the dashboard more actionable, but the analytics section still reads as bolted-on statistics rather than a coherent story, for one structural reason: **the numbers don't share a consistent time window**, and nothing states what window or denominator a given percentage means.

Concretely, traced to an actual bug, not just a presentation gap: `habitFulfillmentRate` (which feeds both `category_consistency` and `strongest`/`needs_attention`) averages a **fixed**-schedule habit's fulfillment over its trailing 7-*calendar*-day chain, but a **flexible** habit's fulfillment over the current *ISO week*. Those are different windows. A user who completed everything scheduled today sees "100%" in one place and an unrelated blended number elsewhere with no explanation — not a rounding quirk, a genuine window mismatch.

Three more real gaps, evaluated on their own merit rather than taken wholesale from the critique:
1. `strongest`/`needs_attention` rank by raw fulfillment percentage with no awareness of `pace` (already computed in v3, but not used here) — so a habit that's early in its week and hasn't caught up yet reads identically to one that's genuinely behind.
2. `week_expected`/`week_actual` (added in v3 specifically to drive `pace`) are, per the v3 final review's own finding, wire-only — never actually shown to the user anywhere. There's a real, already-built number sitting unused that would directly answer "how am I doing this week, adjusted for what day it is."
3. Category consistency shows a percentage with no counts and no window label, and its synthetic "Overall" row will become redundant once the analytics section has one clear headline number.

## Goals

- One consistent "this week" window for every rate-based analytic (`habitFulfillmentRate`, and therefore `category_consistency` and `strongest`/`needs_attention`) — fixed and flexible habits use the same Monday-through-today window. The "Daily completion" trailing-7-day chart is a *different, legitimately distinct* visualization (a daily trend line, not a cumulative weekly figure) and keeps its own window, already correctly labeled.
- A single "This Week's Rhythm" hero replaces the 4-tile stat grid: an expected-occurrence-aware percentage (`Σweek_actual / Σweek_expected`, finally putting those v3 fields to use), a progress bar, the raw "X of Y expected occurrences" line, and on-pace/needs-attention counts.
- `strongest`/`needs_attention` (renamed `on_pace`/`needs_attention` for clarity, since the selection logic is changing) partition by `pace` first — one example habit that's on pace or ahead, one that's genuinely behind — each shown with "X/Y this week · Z remaining," not a bare percentage.
- Category consistency gains per-category counts (`completed/scheduled`) alongside its percentage, an explicit "This Week" window label, and drops its now-redundant synthetic "Overall" row.
- The daily chart becomes a compact glyph strip (○ ◐ ◕ ●) instead of seven tall bars, keeping its already-correct three-state semantics (nothing scheduled / scheduled-and-missed / scheduled-and-done) and its day-click drill-down exactly as they are.
- Fixed-schedule cards gain an explicit status line ("Done today ✓" / "Scheduled today — not yet done" / "Not scheduled today"), matching the status line flexible cards already have, for consistency between the two card types.

## Non-goals (explicitly out of scope)

- Nothing about Priority/Core-Normal-Optional changes — already shipped in v3, not revisited here (per explicit instruction).
- No numeric-habit-specific week-progress glyph (the critique's forward-looking "● ● ◐ ○ ○" mini-strip for numeric rituals) — speculative, not concretely requested, and numeric tracking's existing stepper + minimum-zone bar already covers "what should I do next" for that card type.
- No change to the three-state daily-chart *semantics* or the day-click drill-down *behavior* — both already correct from v3; only the chart's visual density changes.
- No schema changes. Everything here is presentation logic and aggregation using columns/fields that already exist.

## The window-consistency fix

`src/lib/habits.ts`'s `habitFulfillmentRate(habit)` currently:
```ts
function habitFulfillmentRate(habit: HabitWithComputed): number | null {
  if (habit.schedule_mode === 'flexible') {
    if (!habit.week_progress) return null;
    return Math.min(habit.week_progress.completed / Math.max(1, habit.week_progress.target), 1);
  }
  if (!habit.chain) return null;
  const scheduledDays = habit.chain.filter(d => d.scheduled);          // <- all 7 trailing days
  if (!scheduledDays.length) return null;
  return scheduledDays.reduce((s, d) => s + d.fulfillment, 0) / scheduledDays.length;
}
```
changes to restrict the fixed-habit branch to the current week only, taking a `weekStart` string (already computed once per request in `getSummaryForUser`, via the same `mondayOfWeek()` helper `getHabitsForUser` already uses) as a parameter:
```ts
function habitFulfillmentRate(habit: HabitWithComputed, weekStart: string): number | null {
  if (habit.schedule_mode === 'flexible') {
    if (!habit.week_progress) return null;
    return Math.min(habit.week_progress.completed / Math.max(1, habit.week_progress.target), 1);
  }
  if (!habit.chain) return null;
  const scheduledDaysThisWeek = habit.chain.filter(d => d.scheduled && d.date >= weekStart);
  if (!scheduledDaysThisWeek.length) return null;
  return scheduledDaysThisWeek.reduce((s, d) => s + d.fulfillment, 0) / scheduledDaysThisWeek.length;
}
```
Every call site (`category_consistency`'s aggregation loop, `strongest`/`needs_attention`'s ranking) already goes through this one function, so the fix is centralized. A habit with zero scheduled days so far this week (e.g. a Mon/Wed/Fri habit checked on a Sunday) is correctly excluded (`null`), same as today.

## API changes

**`HabitsSummary`** (`src/lib/habits.ts`):
- Gains `weekly_expected: { actual: number; expected: number }` — `Σ week_actual` and `Σ week_expected` (rounded for display) across every habit. This is the number the Rhythm hero's percentage and "X of Y expected occurrences" line are built from.
- `category_consistency` entries gain `scheduled: number; completed: number` — raw pooled counts for the same "this week" window `habitFulfillmentRate` now uses (fixed: count of this-week scheduled/completed chain days; flexible: `week_progress.target`/`.completed`). The synthetic `{ category: 'Overall', percent }` first row is **removed** — the Rhythm hero is now the one unambiguous "overall, this week" figure; category consistency shows only real categories, updated to "This Week" and armed with counts, exactly what the critique means by "tertiary."
- `strongest` is renamed **`on_pace`** (same `RankedHabit`-shaped value) and its selection logic changes: partition habits with a non-null `habitFulfillmentRate` into `pace === 'behind'` and everything else; `on_pace` = the highest-rate habit among the non-behind group (`null` if every eligible habit is behind); `needs_attention` = the lowest-rate habit among the behind group (`null` if none are behind — a genuinely good state, not an absence of data). `RankedHabit` gains `week_actual: number; week_target: number` (both already computed per-habit — `week_target` is `Math.max(1, times_per_week)`, uniform across schedule modes) so the UI can render "X/Y this week" without a second lookup.
- `at_risk` (habits with `pace === 'behind'`) is unchanged, still used as a count.
- `most_urgent` was already removed in v3; no change here.

## UI changes

### Stat rail → Rhythm hero (replaces the 4-tile grid entirely)

```
THIS WEEK'S RHYTHM                                    68%
████████████████████░░░░░░░░░░
8 of 12 expected occurrences this week

✓ 3 rituals on pace          ⚠ 1 ritual needs attention
```
(`68%` = `round(weekly_expected.actual / weekly_expected.expected * 100)`, guarded against a zero denominator; the two counts are `total_habits - at_risk` and `at_risk` respectively — no new backend field needed for either, both derivable client-side from existing summary fields. Omit the "needs attention" half of that line entirely when `at_risk === 0`, rather than showing "0 rituals need attention" as a small victory lap that reads oddly.)

`Longest Streak` is kept as a small secondary line beneath the hero (e.g. "🏆 7-day best streak"), not folded into the headline — it's a different, genuinely distinct signal (an achievement record, not a this-week rhythm figure) and was never part of the semantic-inconsistency problem this pass is fixing.

### On-pace / Needs-attention sentences (below the hero, replacing the old "% of target" phrasing)

```
✓ On pace: Running — 2/3 this week · 1 remaining
⚠ Needs attention: Cooking — 0/2 this week · 3 days remaining
```
Reuses `on_pace`/`needs_attention`'s new `week_actual`/`week_target` fields plus each habit's own `week_days_remaining` (already on `HabitWithComputed` since v3) for the "remaining" clause. Render nothing when a slot is `null` (don't show a placeholder "no data" sentence — just omit that line, same as v3's existing behavior when `strongest`/`needs_attention` were both absent).

### Daily chart → compact glyph strip

Replaces the seven tall bars with a single tighter row: for each of the 7 days, a percent label (or nothing, for an unscheduled day) above a single glyph character sized larger than body text (≈20–24px) — `○` (nothing scheduled, muted gray), a red-tinted `○` outline (scheduled, 0% — keeps the v3 "missed is visible, not blank" principle in glyph form), `◐` (scheduled, >0% and <100%), `●` (scheduled, 100%) — filled/colored in the app's signature gradient tone for the two "did something" states, muted for the two "nothing to show" states. The day-click behavior (toggling the fixed-habits-only breakdown panel beneath the strip) is unchanged — same click handler, same panel, just attached to the new compact glyph cell instead of the old tall bar.

### Category consistency

Heading becomes "Consistency by category — this week". Each row gains a `completed/scheduled` count next to its percentage: `Household  ██░░░░░░░░░░░░░░░░  7%  1/14`. No "Overall" row (removed per the API change above).

### Fixed-schedule card status line

Beneath the existing streak line (not replacing it), one short line matching the pattern flexible cards already have:
- `checked_in_today` → `"Done today ✓"`
- `is_today && !checked_in_today` → `"Scheduled today — not yet done"`
- `!is_today` → `"Not scheduled today"`

## Migration & compatibility

Purely additive/renaming at the API boundary (`strongest` → `on_pace`, new fields on `HabitsSummary`/`RankedHabit`/`CategoryConsistency`) — no schema change, no migration to write or run. The rename is safe because the only consumer of this API is the same component being rewritten in the same pass.

## Testing / verification plan

Same approach as v1–v3 (no test framework in this repo; no browser-automation tool in this environment): `tsc --noEmit`, then real calls against the local dev DB via a locally-signed session token —
- Window consistency: for a mixed fixed+flexible habit set, hand-compute `habitFulfillmentRate` for one fixed habit under the OLD (7-day) and NEW (this-week) windows where they'd actually differ (i.e. today is not Sunday, so the trailing-7-day window spans two ISO weeks) and confirm the API now returns the this-week-only figure.
- `weekly_expected`: hand-compute `Σweek_actual`/`Σweek_expected` against the API's actual response for a known mixed habit set.
- `on_pace`/`needs_attention`: construct a scenario with one habit that's numerically low but `pace: 'on_pace'` (e.g. Monday, 1/3) and one that's `pace: 'behind'` — confirm the low-but-on-pace habit is never selected as `needs_attention`, and confirm both fields correctly return `null` in their respective "nothing qualifies" cases (no behind habits at all; all habits behind).
- Category consistency: confirm counts sum correctly against a hand-tally, confirm no `'Overall'` entry appears in the response.
- Fixed-card status line: confirm all three states render for habits in each state.
