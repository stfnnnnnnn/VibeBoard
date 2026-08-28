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
