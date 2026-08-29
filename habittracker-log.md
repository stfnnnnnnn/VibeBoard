# Habit Tracker — Migration Log

Companion to `habittracker-module-audit.md` (the pre-migration PHP audit). Covers the Next.js/React port: what was built, and the deliberate behavior changes made along the way, so they aren't mistaken for accidental drift from the legacy PHP.

## What got built

**Data layer** (server-only):
- `src/lib/habitDate.ts` — pure date-string helpers (UTC-based arithmetic, Asia/Manila "today" lookup, and the corrected streak-counting algorithm).
- `src/lib/habits.ts` — all DB reads/writes against the existing local `habit_tasks` / `habit_checkins` / `habit_streaks` tables (no schema changes; the local dev DB already had them from earlier PHP testing).

**API** (`src/app/api/habits/`): `GET/POST /api/habits`, `PATCH/DELETE /api/habits/[id]`, `POST/DELETE /api/habits/[id]/checkin`, `DELETE /api/habits/[id]/streak`, `GET /api/habits/summary`.

**Frontend:** `src/app/habits/page.tsx` (auth-gated server component, same pattern as `/finance`) + `src/components/habits/HabitsDashboard.tsx` (single client component — manage view and analytics view live on one page, in that order, rather than two separate PHP files).

**Dashboard tile:** `src/app/dashboard/page.tsx`'s Habit Tracker tile now points to `/habits` instead of the old absolute `alwaysdata.net` PHP URL — same fix already applied to the Finance tile.

## Deliberate behavior changes (not 1:1 ports — see audit §6 for why)

1. **Streak continuity now counts consecutive *scheduled* occurrences, not consecutive calendar days.** The legacy engine broke a habit's streak if the previous check-in wasn't literally "yesterday," even for a habit scheduled Mon/Wed/Fri (where Wed following Mon is not a gap). `computeConsecutiveScheduledStreak()` walks backward through a habit's own scheduled weekdays and only breaks on a scheduled-but-missed day, skipping unscheduled days without penalty. Applied consistently to both check-in and undo.
2. **One streak row per habit, always UPDATEd in place**, instead of the legacy pattern of inserting a new `habit_streaks` row every time a streak restarts. Simpler to reason about and matches the fact that every read already only ever looked at the latest row by `streak_id DESC`.
3. **`task_status` (active/archived) is gone.** It never meant "archived" in the legacy code — it was silently recomputed on every page load to mean "scheduled today," which the audit flagged as misleading. The Next.js version computes `is_today` on the fly per request and doesn't touch or read that column at all; the "Today" filter uses it directly. The DB column still exists (untouched) but nothing in the new module writes to it.
4. **Dropped the dead `undo_streak` action** (audit §3.3) — a second, differently-implemented undo path that no button in the legacy UI ever called, and that disagreed with the one that was actually wired up (`undo_checkin`).
5. **The two legacy pages (`habittracker.php` manage view, `habitdashboard.php` analytics view) are one page now.** The old dashboard's analytics half was fully dead code — every stat referenced a variable that was never assigned (audit §4) — so there was no working behavior to preserve there; the new "This Week's Rhythm" section is a fresh implementation built on data the manage view already fetches (no extra queries), rather than a separate route with its own fetches.
6. **No client-side "silently fall back to a different filter" behavior.** Legacy: picking a Category/Urgency/Day filter that matched nothing quietly re-applied the Active/Today filter with no explanation. New: an empty filter result shows a plain empty-state message instead.

## Design direction

Ran through the `frontend-design` skill (per `.agents/skills/design-guidelines`) before building, scoped narrowly since the app's base tokens (glass, gradient background, gradient text, pink/blue buttons) were already locked from the Study Pulse/Finance migrations. Two calls specific to this module:
- **Category and urgency stopped being two badge rows on every card.** Category became an ambient signal (a colored top edge on the card + a small dot-and-label, not a pill); urgency stayed the one loud badge, since "how urgent" is the one fact worth interrupting for.
- **The streak visualization is a "chain"** — 7 small nodes for the last 7 days, connected by a line that lights up only between two completed days — instead of a generic percent bar, deliberately referencing the "don't break the chain" habit-tracking method the feature is actually implementing.

## Verified before calling this done

- `tsc --noEmit` — zero errors.
- Full API surface exercised against the real local dev DB (via a locally-signed dev-secret session token, no password data touched): list, create, validation rejection, check-in, undo (streak correctly returns to 0 and the row is cleared when no history remains), delete, and cross-user isolation (a second account's session correctly gets `404 Habit not found` deleting someone else's habit).
- No visual browser pass was done in this session — there's no browser-automation tool available here. Everything above is functional/API-level verification against real data, not a rendered screenshot. Worth a manual look in an actual browser before considering the visual design finished.

## Habit Tracker v2 — flexible scheduling + numeric tracking

Full design at `docs/superpowers/specs/2026-08-28-habit-tracker-v2-design.md`. Builds on the port above without touching its data model's shape — two new independent axes on top of the existing `fixed`/`boolean` default.

### What shipped

- **Schedule mode**: a habit is `fixed` (specific weekdays, existing chain-of-7 card) or `flexible` (a weekly occurrence count, any day — dot-cluster card, no chain, no streak).
- **Tracking type**: a habit is `boolean` (existing did/didn't) or `numeric` (an `amount` logged per occurrence against a `target_value`/`unit_label`, adjustable in `step_value` increments).
- The two axes are fully independent — four combinations, all exercised in this pass.
- New endpoint `PUT /api/habits/[id]/amount` — upserts `habit_checkins.amount` for a day (numeric habits only); `POST/DELETE .../checkin` now reject non-boolean habits with `400`.
- `GET /api/habits/summary` gained `strongest`/`needs_attention` (highest/lowest mean-fulfillment habit over the trailing 7 days) and its existing `weekly_rhythm`/`category_consistency` percentages switched from completion-count ratios to fulfillment averages (below).
- Idempotent schema migration (`ensureHabitTrackingSchema`, wired into every habits route except `streak` — `resetStreak` touches no new columns, so it needed the migration least) adds `schedule_mode`, `tracking_type`, `target_value`, `unit_label`, `step_value` to `habit_tasks` and `amount` to `habit_checkins`. Every pre-existing row defaults to `fixed`/`boolean` — confirmed below. Note this isn't a strict "zero behavior change" claim: `category_consistency`/`strongest`/`needs_attention` average **per-habit** fulfillment rates rather than pooling raw occurrence-days (a deliberate deviation from the spec's literal "same pooling, new numerator" wording — pooling across fixed and flexible habits has no consistent unit), so an existing user's category percentages can shift slightly once flexible/numeric habits are mixed into a category. That shift is intentional and reasoned, not a regression.

### The completion-derivation rule

The one piece of real design in this pass, and the one place a naive implementation would silently drift: for numeric check-ins, `is_completed` is never trusted — `amount` is the only fact, and completion (`amount >= target_value`) is derived fresh on every read via `src/lib/habitFulfillment.ts`'s `occurrenceFulfillment`/`occurrenceCompleted`. Boolean check-ins are unaffected — `is_completed` stays authoritative and `occurrenceCompleted` reduces to reading it directly. Full rationale, including the rejected "store `is_completed` at write time" alternative, is in the spec's "The completion-derivation rule" section.

Fulfillment (a 0–1 ratio per occurrence, not just hit/miss) is also what the Rhythm analytics now average, so a numeric habit at 6/8 no longer reads identically to one at 0/8 in the aggregate stats — see the spec's "Rhythm analytics" section.

### Verification

No test framework in this repo; verified against the real local dev DB via a locally-signed dev-secret session token, then cleaned up (every habit created for this pass — plus its cascaded check-ins and streak rows — was deleted afterward; the DB was confirmed back to its pre-verification row counts). `tsc --noEmit` — zero errors.

- **Regression** (fixed+boolean): create → checkin → streak becomes 1 → undo → streak returns to 0 and the `habit_streaks` row is deleted, byte-for-byte the same as the v1 behavior recorded above. Validation rejection and cross-mode rejection (`POST checkin` against a numeric habit, `PUT amount` against a boolean habit) both correctly `400`.
- **Multi-day streak with a gap** (fixed+numeric, target 8): logged Mon 8, Tue 8 (streak building), Wed 4 — below target, breaks it — Thu 9, Fri(today) 8. Result: `current_streak: 2, longest_streak: 2`, chain shows Wed's occurrence as `completed: false, fulfillment: 0.5` sitting between two completed runs — confirms `computeConsecutiveScheduledStreak` correctly treats a below-target numeric day as a scheduled miss and starts a fresh run afterward, entirely from `amount`.
- **Flexible habits never write `habit_streaks`**: logged 3 boolean check-ins and 3 numeric amounts across different simulated days each (via SQL-backfilled `checkin_date`) for one flexible+boolean and one flexible+numeric habit — `SELECT * FROM habit_streaks WHERE habit_id = ?` stayed empty for both the entire time, and `week_progress` (`{completed, target}`) tracked correctly (3/3 and 1/4 respectively, matching hand counts).
- **Fulfillment math, hand-computed vs. API** (isolated user, one fixed+boolean health habit scheduled Mon/Wed/Fri completed on Mon+Fri only, one fixed+numeric academic habit target 10 logged 10/5/0/15/7 Mon–Fri): expected `category_consistency` — health 67% (2/3 scheduled days hit), academic 64% (mean of 1, .5, 0, 1, .7), Overall 65% (mean of the two habit rates). Expected `weekly_rhythm` per day — Mon 100%, Tue 50%, Wed 0%, Thu 100%, Fri 85%. The API returned exactly these values for every field, including `strongest`/`needs_attention` correctly picking the health habit (67%) over the academic one (64%).
- **Cross-user isolation**: a second session re-run against the fully integrated feature — `PUT .../amount`, `POST .../checkin`, and `DELETE` against another user's habit all correctly return `404 Habit not found`.

### Known, deferred minors (not bugs — documented open decisions)

Surfaced and consciously left as-is during the five implementation tasks' reviews:

1. `habit_checkins.is_completed` defaults to `0`, not `NULL`, on numeric rows (column default, not something the app writes) — confirmed inert: every numeric read path derives completion from `amount` alone and never looks at this column, verified above (`is_completed=0` sat alongside both completed and not-completed `amount` values with no effect).
2. `recomputeFixedStreak` only runs on a write action (checkin/undo/setAmount), not lazily on read — a fixed habit that misses a scheduled day and is never touched again shows its last-computed streak until the next check-in or amount log, rather than zeroing itself out the moment the missed day passes.
3. `AmountInput`'s ~500ms auto-save debounce closes over render-scoped state and isn't cleared on unmount — a rapid-fire then immediate-navigate-away sequence could theoretically fire a stale write after the component is gone. Both this and #2 are low-probability, inherited as-is from the approved spec rather than fixed here.

## Habit Tracker v3 — actionable dashboard, priority, minimum targets, history

Full design at `docs/superpowers/specs/2026-08-28-habit-tracker-v3-design.md`. Turns the v2 mechanism into a decision aid: a stat rail that describes the week instead of the instant, a three-state daily chart, per-card pacing, priority replacing urgency, optional minimum targets on numeric habits, and a read-only per-habit history view.

### What shipped

- **`priority` (`core`/`normal`/`optional`) replaces `habit_urgency` (5-tier) everywhere in the application layer.** The DB column `habit_urgency` is untouched and still exists (this project's additive-only migration convention — no `DROP COLUMN`) but is no longer read, written, or referenced by any TypeScript in `src/` (confirmed by a repo-wide grep: the only remaining hits are the table's original DDL and the one-time backfill query, both in `src/lib/migrate.ts`). Card badge, Add/Edit modal, and the filter dropdown all now speak `priority`.
- **Numeric habits may set an optional `minimum_value`** below `target_value` — a forgiving floor that preserves the streak/chain fill without satisfying the target milestone. Validated server-side (`> 0` and `<= target_value`) and mirrored client-side before submit.
- **The stat rail was replaced**: `Weekly Targets` (summed `week_actual`/target across every habit), `At Risk` (count of habits with `pace: 'behind'`), `Longest Streak` (unchanged), `Best Rhythm` (relabeled `strongest`, no new calculation). `most_urgent` is gone from the summary — meaningless once urgency left the model.
- **Every habit now carries `week_expected`/`week_actual`/`pace`**, computed once server-side in `getHabitsForUser` (`src/lib/habits.ts`). `week_expected`/`week_actual` are wire-only fields that exist purely to feed the server-side `pace` computation — nothing in the client reads them directly; the card UI derives its progress display from `week_progress` (a different, pre-existing field) and the stat rail's `Weekly Targets` tile is built from the separately pre-summed `weekly_targets` aggregate. Fixed habits get an exact scheduled-day count from Monday through today; flexible habits get a `(daysElapsed/7) * times_per_week` ramp. `pace` uses a half-occurrence tolerance band so an exactly-on-schedule fixed habit doesn't flicker to "behind" from rounding.
- **The daily completion chart now distinguishes three states** instead of two: nothing scheduled (a muted dash, no bar), scheduled-and-missed (a small fixed-height rose bar — visibly present, not indistinguishable from "nothing due" the way a near-zero-height bar was in v2), and scheduled-and-partially/fully-done (the existing proportional gradient bar).
- **Clicking a day in the chart opens an inline drill-down panel** listing every *fixed*-schedule habit scheduled that day with a ✓/○ status, built entirely client-side from data already on the page (`habit.chain[i]`) — no new endpoint.
- **New `GET /api/habits/[id]/history?weeks=12`** (`src/app/api/habits/[id]/history/route.ts` → `getHabitHistory` in `src/lib/habits.ts`): per-habit, read-only, fetched only when the new detail modal opens. Returns up to `weeks` weekly buckets (oldest first), `best_week`, a `weekly_streak` (flexible habits only — consecutive most-recent weeks meeting target, computed strictly over the fetched window, `null` for fixed habits which already have a daily streak), an all-time `total_checkins` count, `started_at`, and the last 10 check-ins.
- **New read-only habit detail modal**, opened by clicking anywhere on a card except its interactive controls: schedule summary, the same `ChainRow`/`WeekDots` the card already shows, a 12-week bar chart from the history endpoint, best week, a streak stat (fixed habits reuse `current_streak`/`longest_streak` already on the habit object; flexible habits show the new `weekly_streak` as "N successful weeks"), total check-ins, start date, and the last 10 check-ins. No editing surface — editing stays in the existing Add/Edit modal.
- Every interactive control inside a card (Done/Undo, Edit, Delete, the `AmountInput` stepper) calls `stopPropagation()` so using them doesn't also pop the detail modal open underneath.

### The completion-derivation rule, amended for minimum targets

v2 established `occurrenceCompleted(habit, row) ⟺ occurrenceFulfillment(habit, row) >= 1`. v3 breaks that equivalence on purpose whenever `minimum_value < target_value`: reaching the minimum now completes the occurrence (streak-preserving) without reaching full fulfillment. `src/lib/habitFulfillment.ts` keeps `occurrenceFulfillment` unchanged — always measured against `target_value`, capped at 1, still what the Rhythm analytics consume — and changes only `occurrenceCompleted`'s bar to `minimum_value ?? target_value`. Every existing call site (chain builder, `recomputeFixedStreak`, the flexible week-progress counter, `checked_in_today`, and now `week_actual`/`pace`) already called `occurrenceCompleted` for the streak/chain/"is this occurrence done" question and `occurrenceFulfillment` separately for the ratio, so no call site needed to change — only the two functions' bodies. A habit with no `minimum_value` behaves byte-identical to v2. Full rationale in the spec's "The completion-derivation rule, amended for minimum targets" section.

The cross-cutting consequence worth stating explicitly, since it's the one thing v2's rule didn't have to guarantee: **`pace`/`week_actual` and the chain/streak now necessarily agree with each other**, because both are derived from the same `occurrenceCompleted` boolean rather than one of them reading the continuous fulfillment ratio. A day where a numeric habit hits only its minimum counts as one full occurrence toward `week_actual`, not a fractional 0.67 — confirmed below.

### The priority backfill mapping

Run once, inside the same idempotent-migration pattern as every other schema change here (`ensureHabitPriorityAndMinimumSchema` in `src/lib/migrate.ts`), guarded to only fire in the branch where `ALTER TABLE ... ADD COLUMN priority` actually succeeds (not on the already-migrated `ER_DUP_FIELDNAME` path):

```sql
UPDATE habit_tasks SET priority = CASE
  WHEN habit_urgency IN ('Urgent','Priority') THEN 'core'
  WHEN habit_urgency = 'Important' THEN 'normal'
  ELSE 'optional'  -- 'Not Important', 'Not Urgent'
END;
```

Spot-checked against real pre-v3 rows (see verification below) — every mapping matched exactly, including the `Not Urgent → optional` and `Important → normal` edges. One superficially odd row was investigated and traced to a real portability gap, since fixed in the final whole-branch review pass: a habit created today (post-migration, `date_created` inside this session) showed `habit_urgency = 'Urgent'` despite never having that value written by any app code. `habit_urgency` was `NOT NULL` with no explicit `DEFAULT`, and the local MySQL instance isn't running in strict mode, so an `INSERT` that omits the column entirely (as `createHabit` correctly does, since `habit_urgency` is fully replaced by `priority`) was silently backfilled with the enum's first declared value (`'Urgent'`) instead of erroring. On stock strict-mode MySQL/MariaDB — the default on most fresh installs — the same `INSERT` would instead raise `ER_NO_DEFAULT_FOR_FIELD` and fail every habit creation. This was not just a MySQL quirk to note and move past: the column now has an explicit `DEFAULT 'Not Urgent'` (`CREATE TABLE` in `ensureHabitTablesExist()` plus a retroactive `ALTER TABLE ... MODIFY` in `ensureHabitPriorityAndMinimumSchema()`, both in `src/lib/migrate.ts`), so new rows get a sensible default on any MySQL strictness setting and the column stays dead-but-harmless as designed.

### The pacing model

`week_expected` and `week_actual` are computed once per request in `getHabitsForUser`, not duplicated client-side:
- **Fixed**: `week_expected` is an exact count of the habit's scheduled weekdays from this week's Monday through today inclusive (not a ramp — a fixed schedule is deterministic, so "expected by today" has an exact answer). `week_actual` is the count of those same days with `completed: true` in the chain.
- **Flexible**: `week_expected` is `(daysElapsed / 7) * times_per_week`, a linear ramp across the Mon–Sun week. `week_actual` is `week_progress.completed`, already computed for the dot-cluster.
- **`pace`**: `'behind'` when `week_actual < week_expected - 0.5`, `'ahead'` when `week_actual > week_expected + 0.5`, `'on_pace'` otherwise — the half-occurrence band exists so a fixed habit sitting exactly on its expected count doesn't flicker between labels from integer/float rounding.

### Verification

No test framework in this repo; verified against the real local dev DB via a locally-signed dev-secret session token (`sub: '2'`, plus `sub: '1'` for cross-user checks), then every test row cleaned up and row counts confirmed back to the pre-pass baseline (`habit_tasks: 21`, `habit_checkins: 8`, `habit_streaks: 7`, unchanged before/after). `tsc --noEmit` — zero errors, run once at the very end of this pass against the whole project.

- **Regression**: pre-v3 habits (`habit_id` 1–17, 33–35) spot-checked against their original `habit_urgency` — every mapping matched the backfill rule exactly (e.g. `Urgent`/`Priority` → `core`, `Important` → `normal`, `Not Urgent` → `optional`). No code path in `src/` reads or writes `habit_urgency` (grep-confirmed — see above). Cross-user isolation re-confirmed: a second session's `DELETE` against another user's habit correctly returned `404 Habit not found`.
- **Minimum-vs-target agreement (the main new cross-cutting scenario)**: created a fixed+numeric habit (`target_value: 30, minimum_value: 20`, scheduled its one weekly day = today). Logged `20`: chain showed `completed: true, fulfillment: 0.667` for today, `current_streak: 1`, and — the key check — `week_expected: 1, week_actual: 1, pace: 'on_pace'`. `week_actual` landed on the integer `1`, not the fractional `0.667` fulfillment ratio, proving `pace`/`week_actual` are built from the same `occurrenceCompleted` boolean the chain and streak use, not the continuous fulfillment number. Logged `30` (full target): chain updated to `fulfillment: 1`, `pace` stayed `on_pace`. Attempted `minimum_value: 50` against `target_value: 45` at creation — correctly rejected with `"Minimum can't be greater than the target."`.
- **Flexible weekly-streak build and break across real weeks**: created a flexible habit (weekly target 3), SQL-backfilled 3 check-ins in each of 3 consecutive weeks (this week plus the two prior, via direct `INSERT`s on `checkin_date`) — `GET .../history` returned `weekly_streak: 3`, `total_checkins: 9` (matching a direct `COUNT(*)`). Then deleted 2 of the 3 check-ins from the middle week (dropping it to 1/3) — `weekly_streak` recalculated to `1` (only the current, still-unbroken week counts; the walk backward from most-recent stops at the first failed week), `total_checkins` correctly dropped to `7`. Also confirmed the fix-round behavior for the `weeks` query param: `?weeks=abc` (non-numeric) returns the full default 12-week window rather than erroring — this is the intended, now-correct behavior, not an open issue.
- **Day-drill-down correctly excludes flexible habits**: created 2 fixed habits + reused the flexible habit above, all touching today. `GET /api/habits` confirmed the fixed habits carry `chain[today] = { scheduled: true, ... }` while the flexible habit carries `chain: null`. The client's day-panel code (`HabitsDashboard.tsx`) filters `habits.filter(h => h.schedule_mode === 'fixed')` before ever touching `.chain`, and further requires `day.scheduled` — doubly guaranteeing a flexible habit can never surface in a specific day's breakdown, consistent with the daily chart itself only pooling fixed habits.
- **Detail-view click-through**: source-inspected (no browser tool available in this environment, same constraint as v1/v2) — the card's root `<div>` carries `onClick={onOpenDetail}`, while the `AmountInput` wrapper and the Done/Undo/Edit/Delete button row are each wrapped in their own `onClick={e => e.stopPropagation()}` `<div>`, so none of those controls can bubble up to open the detail modal underneath them.
- **History endpoint fixed/flexible split**: confirmed `weekly_streak: null` for a fixed habit's history response and non-null for the flexible habit above, exactly matching the spec.

### Known, deferred minors (not bugs — documented open decisions)

Carried forward from earlier in this plan's review process, still genuinely open:

1. `AmountInput`'s displayed "remaining" text and fill bar reflect local debounced state, not the server-confirmed amount, for the ~500ms window before a pending edit commits — a fast-enough reader could see a value that hasn't actually saved yet.
2. (Already fixed, documented for context) an earlier round of this plan surfaced that the history endpoint's `weeks` query param would throw on a non-numeric value; it now falls back to the default of 12 instead, confirmed above (`?weeks=abc` → 12-week response). This is the intended, correct behavior going forward, not an open issue — noted here only so a future reader doesn't mistake the fallback for an oversight.

## Habit Tracker v4 — Rhythm as the centerpiece

Builds on v3 without touching the database schema: a window-consistency bug fix in `habitFulfillmentRate` (the fixed-habit branch was averaging fulfillment over a trailing 7-*calendar*-day window, which can span two different ISO weeks, while the flexible-habit branch already used the current ISO week — a genuine window mismatch, not an off-by-one; the fixed branch now filters to `d.scheduled && d.date >= weekStart`, matching the flexible branch's window exactly), shipping Rhythm as the hero stat, reselecting `on_pace`/`needs_attention` via a pace partition — habits are split into `pace === 'behind'` vs. everything else before ranking, `on_pace` is the highest-rate habit among non-behind habits and `needs_attention` is the lowest-rate habit among behind habits, so a habit that's numerically low but merely early in its week (not yet behind) can no longer be misidentified as needing attention — category consistency counts verified to no longer include an `'Overall'` row, the four-state glyph strip rendering correctly (unscheduled ○ muted, scheduled-and-missed ○ red, scheduled-and-partially-done ◐ blue, scheduled-and-fully-done ● blue), day-click drill-down panel opens showing only fixed-habits-scheduled-that-day, and the fixed-card status line showing exactly three states (done today in green, scheduled-but-not-done in orange, not-scheduled-today in gray).

### External auditor critique pass

A third-party review raised five points against v3:
1. Priority filtering in the filter dropdown — Already shipped in v3 and unchanged here
2. Three-state daily chart (unscheduled/missed/done) — Already shipped in v3 and unchanged here
3. Day-click drill-down showing only fixed habits — Already shipped in v3 and unchanged here
4. Per-card pace text and visual — Already shipped in v3 and unchanged here
5. The daily chart's visual density/compactness — genuinely v4 work: the glyph strip described above (replacing the old 7-bar chart) is one of this pass's own deliverables

Conclusion: points 1–4 confirmed the design direction was already present in shipped v3 code, not addressing missing features — no v4 work was required for those four. Point 5 is different: it's addressed by this pass's own glyph-strip work, not by anything already shipped.

### Verification

No test framework in this repo; verified by hand-computing expected summary values against real local dev DB state (user 2 with 3 active household habits, none with checkins this week), then cross-referencing against the calculation logic in `src/lib/habits.ts` and component rendering logic in `src/components/habits/HabitsDashboard.tsx`. `tsc --noEmit` — zero errors.

## Habit Tracker v5 — Rhythm-first hierarchy

Refactors the page layout to center the Rhythm analytics as the primary decision-aid, moves the daily-rhythm glyph strip to visual prominence, enriches the day-click drill-down with actionable details, and tightens the card typographic hierarchy to clarify fixed-vs-flexible positioning. No schema changes; `src/components/habits/HabitsDashboard.tsx` is a full-file rewrite of the component layout and rendering logic.

### What shipped

- **Page reorder**: the "This Week's Rhythm" analytics panel (daily completion glyphs, Rhythm percentage, category consistency counts) now renders at the top of the page directly above the toolbar and ritual-card grid, immediately visible without scrolling. A new "Today's Rituals · N scheduled" heading sits above the card grid to reintroduce context after the analytics panel.
- **Hero typography**: the Rhythm percentage (weekly completion rate) is enlarged to 2.4rem and rendered on its own line, making the "this week is X% done" statement the page's visual anchor.
- **Header and hero label disambiguation**: the header's daily figure is relabeled "Today: X/Y done" (previously "X of Y today's rituals done.") to clarify it counts completed vs. scheduled occurrences for today alone; the Rhythm hero is relabeled "This week: X/Y expected occurrences" (previously "X of Y expected occurrences this week") to clarify the denominator is the schedule's expected count (not necessarily 7, because flexible habits have per-habit `times_per_week` targets and fixed habits' expected count depends on which weekdays they're scheduled for).
- **Day-click drill-down enrichment**: clicking a day in the glyph strip opens an inline panel (existing v4 feature) that now includes each habit's category indicator (a colored dot and the category label, placed after the habit name) and a same-day "Check in" button when today is the selected day and the habit has not been checked in yet. The "Check in" button uses the card's own Done interaction (same endpoint, no duplicate logic).
- **Chain typography**: day-letter labels (`M`, `T`, `W`, …, `S`) on the per-card `ChainRow` are enlarged (0.6rem → 0.7rem), darkened (improved contrast), and styled with consistent weight. The "today" marker (the rightmost node, always visible whether completed or not) receives a persistent two-ring halo (inner ring lighter, outer ring darker) regardless of completion state, so a completed-today day visually stands apart from a completed-any-other-day, and an incomplete-today doesn't vanish into the background.
- **Card meta-line typographic clarification**: the one-word label on the card's meta-line (the low-contrast text below the card title and purpose paragraph) is changed from "Habit ·"/"Routine ·" (using the `habit_type` field's internal enum values) to "Fixed ·"/"Flexible ·" (using the `schedule_mode` field instead). The underlying database and TypeScript type `habit_type` is unchanged throughout the application — this is a display-string-only change on one line (`src/components/habits/HabitsDashboard.tsx`). The rationale: "Habit"/"Routine" were the raw `habit_type` enum words, inconsistent with the "Fixed"/"Flexible" schedule-mode language already used everywhere else on the page — the meta-line now matches that established language instead of speaking a different vocabulary.

### External auditor critique pass, continued

A fifth-point review was conducted against committed v4 code, evaluating several proposed UI enhancements:

1. **Priority badge on cards** ("Core"/"Normal"/"Optional") — confirmed already shipped in v3, not revisited in v4 or this pass. Removing it (a suggestion in the review) was determined to be out of scope, per the v4 plan's explicit decision to keep priority display untouched.
2. **Category-consistency count breakdown** (counts per category, not just Overall) — confirmed already shipped in v3 and unchanged in v4; no new work required.
3. **Three-state daily chart** (unscheduled/missed/done) — confirmed already shipped in v3 and unchanged in v4; no new work required.
4. **Per-card pace text and visual** ("on pace"/"behind"/"ahead") — confirmed already shipped in v3 and unchanged in v4; no new work required.
5. **Day-click drill-down with category details and same-day "Check in" button** — new work in this pass; see the "Day-click drill-down enrichment" bullet above.

Additional design choices presented and evaluated:

- **Expanding on-pace/needs-attention into a capped list** — offered and declined; the user chose to keep the current v4 behavior (strongest/needs_attention are single habits, not lists).
- **Converting the glyph-strip chain to a full calendar week with future-day states** (e.g., unscheduled days appearing as a different glyph rather than being absent) — offered and declined; the user chose to keep the current v4 behavior (glyph strip is 7 most-recent days, no future days, no unscheduled glyphs).
- **"Rest of this week" forecast panel** — declined as out of scope; the page's rhythm section already serves the week-at-a-glance use case.
- **Schedule-integration-dependent slot suggestion** (e.g., "next available time from your Calendar to do this habit") — declined as out of scope, consistent with the v2 plan's standing exclusion of Schedule integration.

### Verification

No test framework in this repo; verified by source-code inspection against the full-file rewrite in `src/components/habits/HabitsDashboard.tsx`. `tsc --noEmit` — zero errors.

- **Page layout**: the component renders the analytics block (Rhythm percentage, daily glyph strip, category consistency) inline at the top of the page, placed within a `<div style={{ marginTop: 28 }}>` wrapper directly inside the main component's return statement, before the toolbar and habit grid. The "Today's Rituals" heading renders immediately above the grid, introducing the card section after the analytics.
- **Hero typography**: the Rhythm percentage is rendered in a `<div style={{ fontSize: '2.4rem', fontWeight: 800, color: '#74bcd9', lineHeight: 1.1, marginBottom: 10 }}>` element using inline styles only (this file uses no Tailwind CSS classes anywhere in the component), displayed on its own line above the category consistency counts.
- **Labels**: the header renders `"Today: {summary.today_completed}/{summary.today_total} done"` (from the summary object passed in) and the Rhythm block renders `"This week: {summary.weekly_expected.actual}/{Math.max(..., Math.round(summary.weekly_expected.expected))} expected occurrences"` (similarly dynamic, derived from pre-computed aggregates already on the summary object).
- **Day-click panel enrichment**: the drill-down uses a `selectedDay` state (set via `useState<string | null>(null)` at line 99) and opens a filtered list of fixed-schedule habits (`habits.filter(h => h.schedule_mode === 'fixed')`) scheduled that day; each habit row includes a category indicator (an inline `<span style={{ ... }}>` element holding a small colored circle plus a label from `CATEGORY_LABELS[habit.task_category]`), and when `isToday && !day.completed`, a "Check in" button that calls `doCheckin(habit.habit_id)` (reusing the existing handler, already defined in the component).
- **Glyph typography**: the day-letter labels are rendered with inline `style={{ fontSize: '0.7rem', fontWeight: 700, color: '#777' }}` (0.7rem, weight 700) for the single-letter day labels (`M`, `T`, `W`, etc.) in the chain row. The "today" marker (rightmost node) receives a persistent two-ring halo via `boxShadow: '0 0 0 2px #fff, 0 0 0 4px rgba(116,188,217,0.55)'` (inline CSS property, not a Tailwind utility class), applied regardless of completion state.
- **Card meta-line**: confirmed the ternary at lines 770–772 reads `{isFlexible ? 'Flexible' : 'Fixed'}`, using `schedule_mode` to drive the label (not `habit_type`), and is the only render site for this label in the card component.

### Known, deferred minors (not bugs — documented open decisions)

Inherited from v4 and earlier; v5 adds no new deferred items:

1. `AmountInput`'s displayed "remaining" text and fill bar reflect local debounced state, not the server-confirmed amount, for the ~500ms window before a pending edit commits — a fast-enough reader could see a value that hasn't actually saved yet. (Inherited from v3.)
2. `recomputeFixedStreak` only runs on a write action, not lazily on read — a fixed habit that misses a scheduled day and is never touched again shows its last-computed streak until the next check-in, rather than zeroing itself out the moment the missed day passes. (Inherited from v2.)

## Habit Tracker v6 — Visual revamp: the Ritual Chain

A pure presentation pass: user-requested visual polish of the existing HabitsDashboard.tsx component, using the app's native design vocabulary (DM Sans/Inter, brand-color gradients, glass morphism) to tighten the type hierarchy, consolidate the color palette, and add purposeful motion. Zero data, API, schema, or component-interface changes anywhere.

### What shipped

**Design origin:** Ran through the `frontend-design` skill (per `.agents/skills/design-guidelines`) to derive visual direction before coding. The scan-first constraint — auditing the page for minimum-viable touch points rather than blanket redesign — led to scoping the entire pass inside `src/components/habits/HabitsDashboard.tsx` alone, leaving the app's shared `globals.css`, `layout.tsx`, and component primitives untouched.

**Typography unification (HEADING_FONT constant):** The app already uses DM Sans + Inter as its primary stack with `letterSpacing: '-0.01em'` on headings. This pass declares a `HEADING_FONT` constant and applies it to ten typographic anchors: the page h1 ("NAME's Rituals"), "This Week's Rhythm" section heading, the Rhythm percentage display (2.4rem, the visual anchor line), "Daily rhythm" subsection h3, "Consistency by category" subsection h3, "Today's Rituals" toolbar heading, both modal titles ("New Ritual"/"Edit Ritual"), the ritual card's own title (`habit.task_name`), the detail stat values in the habit-history modal, and the habit-history modal's own title (also `habit.task_name`).

**Color consolidation:** (a) Primary text `#333` is replaced with `#332b45` (a warmer "ink" tone, slightly less black, at 6 locations: the outer page wrapper's base color, the `.ht-select` dropdown's text color, the "Today's Rituals" toolbar heading, the ritual card's title, the `.ht-amount-field` input's text color, and the `DetailStat` value). (b) Two warm accent colors accumulated across v2–v4 — the streak-flame icon's `#e0679d` (rosy magenta) and the "fixed-card status text" / "minimum-zone fill" `#f79f24` (amber-orange) — are consolidated into a single `#d9714a` "ember" (at 3 locations: Flame icon color, "Scheduled today" status text, numeric-habit minimum-met background). The shared green (`#42c38b`), red (`#c0392b`), all six category colors, and the brand gradient (`#f2a7c0` ↔ `#74bcd9`) are unchanged.

**Hero layout restructuring (two-column grid):** The analytics panel's structure becomes a responsive two-column grid (`.ht-hero-grid`). Left column retains the existing "This Week's Rhythm" hierarchy (heading, percentage %, progress bar, caption, on-pace/at-risk counts). Right column is a new permanent fixture: a Trophy-icon "{N}-day best streak" line, and — only when at least one exists — an on-pace/needs-attention section (habit name, progress, remaining count) below a horizontal divider. Below 720px width, the grid collapses to a single column. This surfaces the streak context (previously buried near the card row) and the habit examples (previously at the same level as general page stats) into the hero without changing the overall page layout or the card grid.

**Card ambient category wash:** Each ritual card's background is overlaid with a low-opacity linear gradient using its own category color (`${categoryColor}1f` opacity, fading to the normal card glass over 160px). This tint is layered on top of the card's existing colored top border, creating an ambient signal that the category-color connection is spatial (the edge) and atmospheric (the wash), not badged.

**Motion (three coordinated micro-interactions, all respecting prefers-reduced-motion):** (a) **Chain nodes:** the `.ht-chain-node` class applies a `transition` on `background`, `box-shadow`, `border-color`, and `transform` (each timed ~0.3–0.35s ease). On completed-and-scheduled days, the node gains a `scale(1.05)` transform, creating a subtle "emphasis" on the chain. (b) **Progress bars:** the `.ht-progress-fill` class applies a cubic-bezier-timed `width` transition (0.6s, `cubic-bezier(0.16, 1, 0.3, 1)` for snappy ease-out on fill), present on both the hero's main rhythm bar and the category-consistency per-category bars. (c) **Drill-down panel:** the day-click detail panel (`.ht-fade-slide`) uses a `@keyframes ht-fade-slide` animation (fade from 0–1 opacity + slide down from -6px to 0 transform, 0.25s ease-out) on mount. The `@media (prefers-reduced-motion: reduce)` block was extended to cover all three additions (`transition: none` on `.ht-chain-node` and `.ht-progress-fill`, `animation: none` on `.ht-fade-slide`) plus the pre-existing `.ht-amount-fill` transition, which had never been covered by that block in prior passes.

### Verification

No test framework in this repo. Structural verification: `tsc --noEmit` — zero errors across the entire project. Visual verification: source-code inspection of color values, HEADING_FONT placements, and transition/animation definitions in `src/components/habits/HabitsDashboard.tsx` (lines 38, 241, 246, 268–269, 331, 371, 405, 452, 493, 628, 639–646, 660–672, 757–761, 742, 752, 792, 823, 842, 908, 1040, 1068).

No browser-rendering pass was performed in this session — there is no browser-automation tool available in this environment. The changes are purely CSS/DOM-level: inline styles on elements, global style block definitions, and no algorithmic or behavioral changes. Worth a manual look in a browser to confirm the visual result matches the direction, but the structural basis is complete and type-safe.

### Known, deferred minors (not bugs — documented open decisions)

Inherited from v5 and earlier; v6 adds no new deferred items.
