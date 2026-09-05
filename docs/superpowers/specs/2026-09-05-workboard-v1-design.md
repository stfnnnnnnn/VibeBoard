# Workboard v1 — Unified Academic Calendar — Design

**Status:** Approved for planning
**Date:** 2026-09-05
**Depends on:** the existing Study Pulse Next.js modules — Canvas integration (`src/lib/canvas/**`, `canvas_activity_bank`, `canvas_announcement_bank`), Schedule (`schedule_blocks`, `src/components/studypulse/ScheduleMaker.tsx`), and the legacy-mode grade tables (`activities`, `quizzes`, `exams`) plus custom-mode `grade_entries`.
**Origin:** a product-direction essay (pasted into this conversation, not authored by the user) proposing 13 integration points across Schedule/Canvas/Study Pulse/Finance/Habits. Scoped down through brainstorming to a single coherent sub-project; the rest is explicitly deferred (see Non-goals).

## Problem

VibeBoard's academic-planning pieces — class schedule, Canvas assignment ingestion (Activity Bank), Canvas announcement ingestion, and per-subject grade tracking — exist as separate, mutually unaware pages. A Canvas assignment that gets "Included" becomes a grade-tracked task, but nothing connects it to the day it's due on the schedule. An announcement can only become a graded task (Activity/Quiz/Exam); there's no way to record "class is async Thursday" or "consultation Friday 3pm" even though the announcement bank already ingests exactly the text that says so. Nothing ever surfaces "you have three things due within four hours" or "this event overlaps a class."

**Workboard** is a new top-level module that closes this loop: one page presenting classes, deadlines, and one-off events together for a given week, backed by smarter announcement ingestion and deterministic conflict/workload surfacing.

## Goals

- A weekly view combining recurring class blocks, Canvas-sourced deadlines, and manually/announcement-created events, with deadlines visually distinct from time-blocks (a deadline doesn't occupy grid space just because it's due at 11:59 PM).
- Canvas announcements can be routed to more than "task": Task, Event, Reminder, and Schedule Change are all valid destinations, suggested (not forced) by keyword rules, multi-select.
- A Schedule Change destination lets an announcement record a one-off exception to a recurring class ("Thursday's CS0061 is asynchronous") without editing the permanent weekly template.
- Deterministic conflict detection (event/class time overlaps) and deadline clustering (several deadlines close together), computed from the same merged data — no AI involved.
- A simple 7-day workload heatmap as a v1-heuristic, easily retuned later.
- A new dashboard tile linking to `/workboard`.

## Non-goals (explicitly deferred)

- **Target Planner / AI Study Advisor rewiring** (essay §5–§6): feeding the existing `target-analysis` prompt schedule/free-time context, and the deterministic free-time calculator that would back it. This is a distinct feature touching an already-shipped page; a clean follow-up once Workboard's data model has proven itself. Explicitly decided with the user before this spec was written.
- **Effort estimation** (essay §10) on included Canvas items — depends on the free-time engine above, not built.
- **Canvas submission-status closing the loop** (essay §11) — auto-resolving workload when Canvas reports a submission. Not built; Activity Bank's existing sync already tracks `submission_status`/`submission_score` on `canvas_activity_bank`, but nothing in Workboard reacts to it yet.
- **Finance × Schedule** and **Habits × Schedule** forecasting (essay §12–§13) — noted by the essay itself as later-phase ideas, not built.
- **Full unified `academic_calendar_items` table** (essay's literal §7 proposal) — rejected in favor of live aggregation (see Approach below); existing tables are not migrated or dual-written.
- Any relationship between Workboard and Habit Tracker — per existing project memory, that's explicitly deferred until Workboard has its own design pass, which this now is; a future spec can revisit it.

## Architecture: live aggregation, not a unified table

Considered three approaches (recorded here for anyone revisiting this decision):

1. **Live aggregation (chosen).** Two small new tables hold only the item types that have no existing home (`workboard_items` for events/reminders, `schedule_overrides` for date-specific class exceptions). A server-side service queries these plus the existing `schedule_blocks`/`activities`/`quizzes`/`exams`/`grade_entries` live and merges them per request. No dual-writes, no backfill migration, no changes to any existing read/write path.
2. **Full unified table.** One `academic_calendar_items` table becomes the single source of truth; every existing write path (grade entry creation, Canvas include routes, schedule creation) must dual-write into it, plus a backfill migration for existing data. More "architecturally pure" per the original essay, but touches every existing write path in Study Pulse and risks the copy drifting from the original. Rejected as overkill for v1.
3. **Client-side merge.** Keep separate endpoints per source, merge in the browser. Avoids new SQL joins, but conflict detection and the heatmap need the merged view too, so the logic would end up duplicated or awkwardly lifted into a shared client module anyway. Rejected.

## Data model

Two new tables, both additive (new `ensureWorkboardSchema()` in `src/lib/migrate.ts`, following the existing idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN` catching `ER_DUP_FIELDNAME` pattern):

```sql
CREATE TABLE IF NOT EXISTS workboard_items (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  user_id                  INT NOT NULL,
  user_subject_id          INT NULL,
  item_type                ENUM('event','reminder') NOT NULL,
  title                    VARCHAR(255) NOT NULL,
  location                 VARCHAR(255) NULL,
  starts_at                DATETIME NULL,   -- events: required at the API layer; reminders: unused
  ends_at                  DATETIME NULL,   -- events only
  remind_at                DATETIME NULL,   -- reminders: required at the API layer; events: unused
  note                     TEXT NULL,
  source_type              ENUM('manual','canvas_announcement') NOT NULL DEFAULT 'manual',
  source_announcement_id   INT NULL,
  status                   ENUM('active','dismissed','done') NOT NULL DEFAULT 'active',
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
  FOREIGN KEY (user_subject_id) REFERENCES user_subjects(user_subject_id) ON DELETE SET NULL,
  FOREIGN KEY (source_announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS schedule_overrides (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  block_id                 INT NOT NULL,
  override_date            DATE NOT NULL,
  modality                 ENUM('online','cancelled') NULL,  -- NULL = note-only, no modality change
  note                     TEXT NULL,
  source_type              ENUM('manual','canvas_announcement') NOT NULL DEFAULT 'manual',
  source_announcement_id   INT NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_block_date (block_id, override_date),
  FOREIGN KEY (block_id) REFERENCES schedule_blocks(block_id) ON DELETE CASCADE,
  FOREIGN KEY (source_announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE SET NULL
);
```

`canvas_announcement_links` is extended rather than replaced. Today it enforces exactly one destination per announcement (`UNIQUE KEY uniq_announcement`, `CHECK (... = 1)`). Workboard needs one announcement to fan out into multiple destinations (e.g. a Task *and* a Schedule Change), so:

```sql
ALTER TABLE canvas_announcement_links
  ADD COLUMN workboard_item_id INT NULL,
  ADD COLUMN schedule_override_id INT NULL,
  ADD FOREIGN KEY (workboard_item_id) REFERENCES workboard_items(id) ON DELETE CASCADE,
  ADD FOREIGN KEY (schedule_override_id) REFERENCES schedule_overrides(id) ON DELETE CASCADE,
  DROP INDEX uniq_announcement,
  ADD CONSTRAINT chk_one_destination CHECK (
    (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) + (exam_id IS NOT NULL) +
    (grade_entry_id IS NOT NULL) + (workboard_item_id IS NOT NULL) + (schedule_override_id IS NOT NULL) = 1
  );
```

Each row still names exactly one destination; multiple destinations for one announcement become multiple rows (`announcement_id` is no longer unique). The original CHECK constraint in `canvas_entry_links`'s `CREATE TABLE` was unnamed, so MySQL auto-assigned it a name (typically `canvas_announcement_links_chk_1` under MySQL 8, but not guaranteed) — the implementer must confirm the actual name via `SHOW CREATE TABLE canvas_announcement_links` on the live dev DB and drop that specific constraint before adding the replacement above, since `ADD CONSTRAINT chk_one_destination CHECK (...)` alone would leave the old, now-incompatible constraint in place.

Everything else is read, never duplicated:
- **Classes**: `schedule_blocks` (recurring, day-of-week 0=Mon..5=Sat), expanded onto concrete dates for the requested week, with any matching `schedule_overrides` row applied (async/cancelled + note) for that specific date.
- **Deadlines**: `activities.deadline` / `quizzes.deadline` / `exams.deadline` / `grade_entries.deadline`, filtered to the requested week's date range and `status != 'accomplished'` (or the equivalent not-done value already used by each table — confirm exact enum values in `studypulseEntries.ts` during implementation).

## Aggregation service

New pure-ish module `src/lib/workboard/aggregate.ts`:

```ts
export interface WorkboardWeek {
  weekStart: string;        // Monday, YYYY-MM-DD
  classOccurrences: ClassOccurrence[];  // schedule_blocks expanded + overrides applied
  deadlines: DeadlineItem[];
  events: WorkboardItem[];
  reminders: WorkboardItem[];
  conflicts: ConflictWarning[];
  heatmap: DayLoad[];        // 6 entries, Mon..Sat
}

export async function getWorkboardWeek(userId: number, weekStart: Date): Promise<WorkboardWeek>
```

`conflicts` and `heatmap` are computed by pure functions taking the already-fetched arrays, so they're unit-testable without a database:

```ts
export function detectConflicts(classOccurrences, events): ConflictWarning[]
export function detectDeadlineClusters(deadlines): ConflictWarning[]
export function computeHeatmap(classOccurrences, deadlines, events): DayLoad[]
```

- **Overlap conflicts**: any two time-ranged items (class occurrence vs. event, event vs. event) on the same date whose `[starts_at, ends_at)` ranges intersect.
- **Deadline clusters**: v1 groups by calendar day — 3 or more deadlines on the same date is a cluster. (The essay's tighter "within a 4-hour window" variant is a pure-function refinement for later, not a schema change.)
- **Heatmap**: `load = classHours + deadlineCount × 1.5 + eventCount`, bucketed into low/med/high. Documented in-code as a v1 heuristic.

## API surface

Mirroring the existing `studypulse/schedule` route's shape (session auth via `auth()`, `parseInt(session.user.id)`, `pool.execute`):

- `GET /api/workboard/week?start=YYYY-MM-DD` — returns `WorkboardWeek` for the Mon–Sat week containing `start` (defaults to the current week if `start` is missing or unparseable).
- `POST /api/workboard/items` — create a manual event or reminder.
- `PATCH /api/workboard/items/[id]` — edit fields or change `status` (dismiss/done).
- `DELETE /api/workboard/items/[id]`
- `POST /api/workboard/schedule-overrides` — create a manual override for a specific class date.
- `DELETE /api/workboard/schedule-overrides/[id]`

All mutating routes verify the target row's `user_id` matches the session before acting (existing codebase pattern).

## Announcement routing upgrade

`src/lib/canvas/classify.ts` gains a new deterministic function alongside the existing legacy/custom category suggesters:

```ts
export type WorkboardDestination = 'task' | 'event' | 'reminder' | 'schedule_change';
export function suggestDestinations(text: string): Set<WorkboardDestination>
```

Keyword rule sets (same style as the existing `EXAM_KEYWORDS`/`QUIZ_KEYWORDS`/`ACTIVITY_KEYWORDS`):
- `SCHEDULE_CHANGE_KEYWORDS`: "asynchronous", "async session", "no class", "class is cancelled", "class is suspended", "moved online", "postponed", "reschedule"
- `EVENT_KEYWORDS`: "consultation", "meeting", "orientation", "seminar", "session will be held"
- `task` is suggested whenever the existing `suggestLegacyCategory`/`suggestCustomCategory` logic returns a non-`'general'` result.
- `reminder` is never auto-suggested (no reliable keyword signal) — always an opt-in checkbox.

`CanvasAnnouncementBank.tsx`'s Include modal changes from a single category picker to a multi-select checkbox row (`Task / Event / Reminder / Schedule Change`), pre-checked per `suggestDestinations` but always user-toggleable. Checking a box reveals its sub-form:

| Destination | Sub-form fields |
|---|---|
| Task | Existing category picker (legacy Activity/Quiz/Exam or custom category) — unchanged |
| Event | Title (defaults to announcement title), date, start/end time, location, linked subject |
| Reminder | Title, remind-at date/time |
| Schedule Change | Which class meeting (dropdown of the linked subject's `schedule_blocks`), date, async/cancelled, note |

On submit, the existing `POST /api/canvas/announcements/[id]/include` route is extended to accept an array of destinations (`{ destinations: [{ type: 'task', ... }, { type: 'schedule_change', ... }] }`) instead of a single category — one route, fanning out internally, rather than one endpoint per destination type:
1. Open a transaction.
2. For each checked destination, create the underlying row (existing `insertActivityEntry`/`insertQuizEntry`/`insertExamEntry`/grade-entry insert for Task; new `workboard_items` insert for Event/Reminder; new `schedule_overrides` insert for Schedule Change) and a corresponding `canvas_announcement_links` row.
3. Mark `canvas_announcement_bank.bank_status = 'included'`.
4. Commit. A failure on any destination rolls back the whole transaction — the announcement is never left half-included.

## Workboard page

`src/app/workboard/page.tsx` (server component, session-gated like every other module) plus a client component for the interactive week view:

- **Week grid**, Mon–Sat (matching `ScheduleMaker`'s existing convention), defaulting to the current week with prev/next navigation.
- Each day column: class blocks and events render as **time-blocks** (visually distinguished from each other by color/style); a class with an active `schedule_overrides` row for that date shows its async/cancelled state instead of the normal block.
- Deadlines render as a **compact dot-list strip** at the bottom of their day column — never consuming grid height regardless of due time.
- **Conflict banners** above the grid: "⚠ Schedule Conflict" and "⚠ Deadline Cluster" cards from `WorkboardWeek.conflicts`.
- **Workload heatmap** strip (Mon–Sat) from `WorkboardWeek.heatmap`.
- **Reminders** in a small sidebar list (undated or upcoming `remind_at`).
- Visual design (glass tokens, gradient accents, spacing, iconography) is built following `.agents/skills/design-guidelines/SKILL.md`'s SCAN→DIRECT→SYSTEMIZE→BUILD→CRITIQUE→POLISH process during implementation — not fully specified here.

## Dashboard entry

`src/app/dashboard/page.tsx`'s `MODULES` array gains a fourth entry pointing at `/workboard`. The other three tiles use custom PNG hero art (`studypulse.png`, `financetracker.png`, `habittracker.png`); commissioning matching artwork is a separate design effort this spec doesn't block on. v1 uses an icon-based tile (a `lucide-react` icon on the same gradient/glass card treatment) instead — swapping in real artwork later is a trivial follow-up, not a rework.

## Error handling

- `GET /api/workboard/week` with a missing or unparseable `start` falls back to the current week rather than erroring.
- A `schedule_overrides` row referencing a deleted `schedule_blocks` row cascades via `ON DELETE CASCADE`.
- A `workboard_items`/`schedule_overrides` row referencing a deleted announcement has `source_announcement_id` set `NULL` (`ON DELETE SET NULL`) rather than being deleted — the manually-relevant event/override survives even if its originating announcement is later removed from the bank.
- Announcement fan-out (multiple destinations) runs in one transaction, as above — no partial-include state.

## Testing / verification plan

No browser-automation tool available in this environment (same constraint as prior migrations):
- `tsc --noEmit` across the new/changed files.
- Unit tests (no DB needed) for `suggestDestinations`, `detectConflicts`, `detectDeadlineClusters`, `computeHeatmap` — pure functions, straightforward table-driven cases including edge cases (zero items, exactly-touching but non-overlapping ranges, exactly 3 same-day deadlines).
- Manual verification via the real local dev DB with a locally-signed dev-secret session token:
  - Create a class block and a manually-created event that overlaps it; confirm the conflict banner appears.
  - Create three deadlines on the same date across different subjects; confirm the cluster banner appears.
  - Include an announcement containing schedule-change language (e.g. "class will be asynchronous tomorrow"); confirm the Schedule Change checkbox is pre-checked, and that applying it shows the override on the Workboard grid for that date without altering the permanent weekly schedule.
  - Include an announcement with both task-like and event-like language; confirm both checkboxes pre-check and both destinations get created from one Include action.
  - Render a full week with classes, deadlines, and events together; confirm deadlines never occupy grid height.
  - Cross-user isolation on all new mutating routes.
