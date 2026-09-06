# Workboard v2 — Unified Work Manager — Design

**Status:** Approved for planning
**Date:** 2026-09-05
**Depends on:** Workboard v1 (shipped earlier the same day, commits `7c7c2de..29c12ee`) — `src/lib/workboard/aggregate.ts`, `src/lib/workboard/items.ts`, `src/app/api/workboard/**`, `src/app/workboard/page.tsx`, `src/components/workboard/WorkboardWeekView.tsx`. Also depends on the pre-existing Study Pulse entry tables (`activities`, `quizzes`, `exams`, `grade_entries`) and their `user_subjects`/`subjects` ownership chain. See `docs/superpowers/specs/2026-09-05-workboard-v1-design.md`.
**Origin:** a UI mockup the user supplied showing "Workboard" as a general-purpose work manager (Today/Upcoming/Later list, List/Board/Timeline views, Academic/Projects/Organization/Life categories, stat cards, weekly workload chart, upcoming deadlines rail). Refined through three rounds of scoping questions. The mockup's left sidebar is explicitly **out** — VibeBoard has no sidebar anywhere, and the user asked for the design without it.

## Problem

Workboard v1 is a weekly academic *calendar*: class blocks, Canvas-sourced deadlines, and one-off events on a time grid, with conflict detection and a workload heatmap. It answers "when am I occupied this week?"

It does not answer "what do I actually need to do?" — the question a student asks most. And it covers only academic life: a class deadline shows up, but "renew driver's license," "plan the org meeting agenda," and "implement authentication for my side project" have nowhere to live in VibeBoard at all. Study Pulse owns academic work, Habit Tracker owns recurring rituals, and everything else is unmanaged.

Workboard v2 makes Workboard the place where **all** work lives, across four life areas, while leaving each existing module the owner of what it already owns.

## Goals

- One work list spanning **Academic, Projects, Organization, and Life**, grouped Today / Upcoming / Later.
- Academic items are **read live from Study Pulse** (no duplication, Canvas sync keeps working), with **write-back** so ticking one off in Workboard marks it done in Study Pulse.
- Four views over the same data: **List**, **Board** (kanban), **Timeline**, and **Calendar** (v1's week grid, preserved).
- **Projects are first-class** — named, assignable, filterable.
- Per-item **effort estimates** on every item, academic ones included.
- Derived-not-stored stats: active/due-soon/overdue counts, weekly estimated hours, a 7-day workload chart, and an upcoming-deadlines rail.
- Client-side search across the loaded work list.
- No sidebar. Navigation stays exactly as it is today (dashboard tile → module page → back link).

## Non-goals (explicitly deferred)

- **Recurring work items.** Habit Tracker already owns rituals/recurrence; duplicating that here would create two competing answers to "what do I do regularly."
- **Sub-tasks / checklists inside an item.** Not in the mockup, not needed to make the list useful.
- **Notifications / push reminders.** v1's `workboard_items` reminder type exists and is unchanged, but nothing in this pass delivers a notification.
- **Per-project progress rollups.** Projects are first-class enough to name, assign, and filter by. Burndown/percentage rollups are a later question.
- **The mockup's Notes, Goals, and Rituals sidebar modules.** Out of scope entirely — and the sidebar itself is out.
- **Collaboration / sharing.** Single-user, like every other VibeBoard module.
- **Changing Study Pulse's schema.** Every Workboard-only fact about an academic item lives on Workboard's side (see the overlay table below).

## Architecture: separate work-items table, plus a thin overlay

Considered and rejected: extending v1's existing `workboard_items` table with a `'task'` item_type. That table carries `location`/`starts_at`/`ends_at`/`remind_at` for calendar events and reminders; work items need `priority`/`work_status`/`due_at`/`estimated_hours`/`project_id`. Merging them produces a table where roughly half the columns are always null depending on the row's type. v1's aggregation layer already unions six sources cleanly; a seventh source is the established pattern, not new complexity.

Also rejected: a single `work_items` table as the source of truth for all four categories, with academic items imported into it. This was put to the user directly and declined — it duplicates Study Pulse data and lets the copy drift from the original after a Canvas sync.

**Chosen:** Workboard owns `workboard_work_items` for Project/Organization/Life work (and manually-created Academic work); Study Pulse remains the source of truth for Canvas- and Study-Pulse-originated academic entries; a small `workboard_entry_meta` overlay holds the three Workboard-only facts that have nowhere to live in Study Pulse's schema.

## Data model

Three new tables, created by a new `ensureWorkboardV2Schema()` in `src/lib/migrate.ts` following the existing idempotent pattern (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` catching `ER_DUP_FIELDNAME`, `information_schema` checks before any index/constraint drop — the pattern v1's `ensureWorkboardSchema()` settled on).

```sql
CREATE TABLE IF NOT EXISTS workboard_projects (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  name        VARCHAR(120) NOT NULL,
  color       VARCHAR(16) NULL,          -- optional chip tint; NULL = derived from name hash
  status      ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_project_name (user_id, name),
  FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workboard_work_items (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT NOT NULL,
  category         ENUM('academic','project','organization','life') NOT NULL,
  project_id       INT NULL,             -- project chip; assignable from any category, not enforced to 'project'
  user_subject_id  INT NULL,             -- course chip; only for manually-created academic items
  title            VARCHAR(255) NOT NULL,
  note             TEXT NULL,
  priority         ENUM('high','normal','low') NOT NULL DEFAULT 'normal',
  work_status      ENUM('todo','in_progress','done') NOT NULL DEFAULT 'todo',
  due_at           DATETIME NULL,
  start_date       DATE NULL,            -- optional; presence turns a Timeline marker into a bar
  estimated_hours  DECIMAL(5,2) NULL,
  completed_at     DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES workboard_projects(id) ON DELETE SET NULL,
  FOREIGN KEY (user_subject_id) REFERENCES user_subjects(user_subject_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workboard_entry_meta (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT NOT NULL,
  activity_id      INT NULL,
  quiz_id          INT NULL,
  exam_id          INT NULL,
  grade_entry_id   INT NULL,
  in_progress      TINYINT(1) NOT NULL DEFAULT 0,
  estimated_hours  DECIMAL(5,2) NULL,
  start_date       DATE NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_activity (activity_id),
  UNIQUE KEY uniq_quiz (quiz_id),
  UNIQUE KEY uniq_exam (exam_id),
  UNIQUE KEY uniq_grade_entry (grade_entry_id),
  FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
  FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
  FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
  CONSTRAINT chk_meta_one_entry CHECK (
    (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
    (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
  )
);
```

### Why the overlay holds exactly three fields

Study Pulse's `status` column (`'Pending' | 'Done'`) stays the **single source of truth for done-ness** — ticking an academic item in Workboard writes back to it, so both modules always agree. But three facts Workboard needs have no column in Study Pulse and, per the Non-goals, Study Pulse's schema is not being changed:

- `in_progress` — the Board's middle column. Study Pulse's status is binary; this is the third state, and it is deliberately *not* a source of truth for done-ness (an item with `in_progress = 1` whose Study Pulse status later becomes `'Done'` reads as Done — see the derivation rule below).
- `estimated_hours` — the user asked for estimates on academic items too.
- `start_date` — optional, powers Timeline bars.

A row exists in `workboard_entry_meta` only once one of these is set for a given entry; absence means "no overlay data," not an error. The four-nullable-FK-plus-CHECK shape mirrors `canvas_entry_links`, the pattern this codebase already uses for polymorphic references to those same four tables.

### Status derivation for academic items

The one load-bearing rule, stated explicitly so no call site re-invents it:

```
work_status(academic entry) =
  entry.status === 'Done'      → 'done'         (Study Pulse wins, always)
  meta?.in_progress === 1      → 'in_progress'
  otherwise                    → 'todo'
```

`'Done'` is checked **first**. If a student marks an item In Progress in Workboard and later marks it Done in Study Pulse, the stale `in_progress` flag never contradicts the real answer. Writing `work_status: 'done'` for an academic item clears `in_progress` in the same transaction, so the overlay does not accumulate stale flags.

### Priority mapping

Study Pulse stores `urgency` as `'High' | 'Medium' | 'Low'`; the mockup and `workboard_work_items` use `'high' | 'normal' | 'low'`. `Medium` ⇄ `normal` in both directions. Editing an academic item's priority from Workboard writes the mapped value back to the entry's `urgency` column.

## The unified read service

New module `src/lib/workboard/workItems.ts`:

```ts
export type WorkCategory = 'academic' | 'project' | 'organization' | 'life';
export type WorkStatus   = 'todo' | 'in_progress' | 'done';
export type WorkPriority = 'high' | 'normal' | 'low';
export type WorkSource   = 'owned' | 'activities' | 'quizzes' | 'exams' | 'grade_entries';

export interface WorkItem {
  source:           WorkSource;   // 'owned' = workboard_work_items; else the Study Pulse table
  id:               number;       // PK within that source
  title:            string;
  category:         WorkCategory;
  chip_label:       string | null; // project name when project_id is set, else course code when
                                   // user_subject_id is set, else null (Life/Organization items
                                   // typically have neither) — project wins if somehow both are set
  project_id:       number | null;
  user_subject_id:  number | null;
  priority:         WorkPriority;
  work_status:      WorkStatus;
  due_at:           string | null;  // "YYYY-MM-DD HH:MM:SS" (owned) or "YYYY-MM-DD" (academic, DATE-only)
  start_date:       string | null;
  estimated_hours:  number | null;
  completed_at:     string | null;
  note:             string | null;
}

export async function getWorkItems(userId: number): Promise<WorkItemsPayload>;
```

`WorkItemsPayload` is `{ items: WorkItem[]; projects: ProjectSummary[]; generated_at: string }`. One endpoint returns everything; view switching, category filtering, and search all happen client-side (the user chose client-side search, and at a student's data volume the whole list is small).

**Sources merged:**
- **Owned** — `workboard_work_items` LEFT JOIN `workboard_projects` for `chip_label`, LEFT JOIN `user_subjects`/`subjects` for the course chip on manually-created academic items.
- **Academic** — the same four Study Pulse tables v1 already queries (`activities`, `quizzes`, `exams`, `grade_entries`), each joined through `user_subjects` for ownership and `subjects` for the course-code chip, LEFT JOIN `workboard_entry_meta` for the overlay fields. Category is always `'academic'`; `work_status` comes from the derivation rule above.

**Bounded, not unbounded:** the payload includes every item with `work_status != 'done'`, plus done items completed within the last 14 days (so the Board's Done column and any "completed recently" reading have content without dragging in a semester of history).

**Computed on read, never stored** — the same discipline as v1's conflict/heatmap functions, and all pure functions over `WorkItem[]` so they are readable and checkable in isolation:

- `groupByTimeframe(items, today)` → Today / Upcoming / Later. **Today** = due on today's Manila date, plus anything overdue (an overdue item belongs at the top of the list, not buried in a past section that does not exist). **Upcoming** = due in the 7 days *after* today, inclusive of day 7. **Later** = everything else, including every undated item.
- `computeStats(items, today)` → the four stat cards:
  - **Active** = `work_status != 'done'`. Its delta line reads *net change over the last 7 days* — items created in that window minus items completed in it — because that is genuinely computable from `created_at`/`completed_at`. A "vs. last week's active count" figure is not reconstructable without history the schema does not keep, so it is not claimed.
  - **Due soon** = not done, due within the next 3 days, not already overdue.
  - **Overdue** = not done, `due_at` before today.
  - **Estimated this week** = summed `estimated_hours` of not-done items due in the current Mon–Sun week; the subtitle names how many items contributed and, when some in-scope items have no estimate, says so rather than implying the total is complete.
- `computeWorkloadChart(items, weekStart)` → 7 days (Mon–Sun), each stacked by the four categories, counting items due that day.

**Timezone:** "today" and the week window are computed with the Manila-date helper v1 already established (`todayInManilaAsUtcDate()` in `src/lib/workboard/aggregate.ts`), not raw `new Date()` UTC components — the exact bug v1's final review caught. Reuse it; do not reimplement it.

## Write paths

**Owned items** — plain CRUD, following v1's route conventions (`auth()` → 401 → `ensureWorkboardV2Schema()` → `parseInt(session.user.id)` → parameterized queries → ownership verified before every mutation):
- `POST /api/workboard/work-items`
- `PATCH /api/workboard/work-items/[id]` — whitelisted fields only (title, note, category, project_id, user_subject_id, priority, work_status, due_at, start_date, estimated_hours), verified `user_id` before update. Setting `work_status: 'done'` stamps `completed_at`; moving off done clears it.
- `DELETE /api/workboard/work-items/[id]`

**Projects:**
- `GET /api/workboard/projects`, `POST /api/workboard/projects`
- `PATCH /api/workboard/projects/[id]` (rename, recolor, archive), `DELETE /api/workboard/projects/[id]` — deleting a project leaves its items intact with `project_id` set null (`ON DELETE SET NULL`), it does not delete work.

**Academic items** — one routed endpoint, `PATCH /api/workboard/academic/[source]/[id]` where `source ∈ activities | quizzes | exams | grade_entries`. It validates `source` against that exact allow-list before touching anything, then routes each field to its correct home in a single transaction:

| Field changed | Written to |
|---|---|
| `work_status: 'done'` / back to `'todo'` | Study Pulse entry's `status` (`'Done'`/`'Pending'`) + `accomplished_at`; clears the overlay's `in_progress` |
| `work_status: 'in_progress'` | overlay `in_progress = 1` (upsert the overlay row) |
| `due_at` | Study Pulse entry's `deadline` |
| `priority` | Study Pulse entry's `urgency`, via the Medium⇄normal mapping |
| `estimated_hours`, `start_date` | overlay (upsert) |

**Ownership on every academic write** is verified by joining the target entry through `user_subjects` to the session user *before* any write — never trusting the id in the URL. v1's final review found exactly this class of gap (a client-supplied `user_subject_id` inserted without an ownership check); it is designed in here from the start rather than added after review. `user_subject_id` and `project_id` supplied when creating or editing an owned item are likewise verified to belong to the session user before being stored.

## Views

All four render from the same `WorkItemsPayload`; switching views is client-side and does not refetch.

**Shared shell** (`src/app/workboard/page.tsx` server component → a client shell):
gradient-text "Workboard" heading with a back-to-dashboard link (matching Study Pulse/Finance/Habits), the four stat cards, category tabs (My Work / Academic / Projects / Organization / Life), the view switcher, a client-side search input, a "New Work Item" button, and a right rail with the weekly workload chart and upcoming deadlines.

**The right rail collapses on Board and Timeline.** Those two views need the horizontal room; List and Calendar keep the rail. This is a layout decision the mockup does not address, made because kanban columns and a date axis both degrade badly when squeezed.

- **List** — Today / Upcoming / Later, collapsible sections with counts. Each row: completion checkbox, title, category chip, project-or-course chip, due label, priority indicator, overflow menu (edit, move status, delete / open in Study Pulse for academic items).
- **Board** — three columns: To Do / In Progress / Done. Drag-and-drop uses the **native HTML5 drag-and-drop API** — no new dependency, per the design guidelines' "avoid unnecessary dependencies." Every card's overflow menu also carries a "Move to →" action, so the board is fully operable from the keyboard; drag is an accelerator, never the only path.
- **Timeline** — a horizontally scrollable date axis with a today marker, one lane per category. Items with a `start_date` render as bars spanning start→due; items with only a due date render as markers on that date; items with neither do not appear. The view is legitimately empty when nothing plots, and says so rather than rendering an empty grid with no explanation.
- **Calendar** — v1's `WorkboardWeekView` preserved as-is (class blocks, deadline strip, conflict banners, heatmap, reminders), extended so work-item due dates also appear in the deadline strip alongside Canvas deadlines.

## Visual direction

Per `.agents/skills/design-guidelines/SKILL.md`: SCAN is done (light glassmorphism, `#f2a7c0 → #74bcd9` gradient, Inter/DM Sans, lucide-react, `.glass`/`.gradient-text`/`.vb-btn-*` primitives). The build runs `frontend-design` for direction, `ui-ux-pro-max` to systemize spacing/density/accessibility, and `impeccable` as the final quality gate — the minimum specialists, per that skill's final rule. Existing tokens and primitives are reused; no new dependencies, no new arbitrary tokens.

The mockup's information architecture is kept. Three deliberate departures, each addressing something the guidelines name explicitly ("avoid excessive cards, pills, gradients, rounded containers" / "generic SaaS patterns"):

1. **Item rows are flattened** — separated by dividers, not wrapped in individual cards. Cards are reserved for genuinely separable panels (stat cards, right-rail panels). Per-row cards are the strongest generic-template tell in the mockup.
2. **One priority signal, not two.** The mockup encodes priority as both a colored left edge and a High/Normal/Low pill on every row. The edge stays; a pill appears only for High. "Normal" pills on most rows are noise that makes real exceptions harder to spot.
3. **Overdue behaves like an alert.** It renders loud when greater than zero and quiet at zero, rather than holding identical visual weight regardless of value.

**Responsive** (desktop-first, with a deliberate mobile view — not a squeeze): below the mobile breakpoint, List becomes the default view, stat cards go to a 2×2 grid, the right rail moves below the main content, Board becomes snap-scrolling columns, Timeline scrolls horizontally, and the view switcher goes icon-only. Board and Timeline remain reachable on mobile rather than disappearing.

## Migration & compatibility

- All three tables are new; nothing existing is altered. Study Pulse's schema is untouched, so every existing Study Pulse and Canvas flow keeps working unchanged.
- `/workboard` remains the route and the dashboard tile keeps pointing at it; the page's content becomes the new shell, with v1's week grid living on as the Calendar view. No route changes, no dashboard changes.
- v1's announcement-routing Include flow (Task / Event / Reminder / Schedule Change) is unchanged and composes for free: an announcement Included as a Task creates a Study Pulse entry, which now appears in the work list automatically.
- v1's `workboard_items` (events/reminders) and `schedule_overrides` tables are untouched and continue to serve the Calendar view.
- Existing users see an empty owned-items list and their real academic items already populated from Study Pulse — no backfill, no import step.

## Testing / verification plan

Same standing approach as every prior pass in this repo (no test framework installed; no browser-automation tool available in this environment):

- `npx tsc --noEmit` across all new and changed files.
- **Pure functions** (`groupByTimeframe`, `computeStats`, `computeWorkloadChart`, the academic status-derivation helper, the priority mapping) verified by `tsc` plus written-out case traces, including: an item due today vs. tomorrow vs. undated; an academic entry with `status='Done'` *and* a stale `in_progress = 1` (must read `done`); a week where some in-scope items have no estimate (subtitle must disclose it); an empty item list (all stats zero, no divide-by-zero).
- **Real API/DB verification** against the local dev DB via a locally-signed dev-secret session token (`next-auth/jwt`'s `encode({ token: { sub }, secret: 'vibeboard-dev-secret-replace-in-production', salt: 'authjs.session-token' })`), using `user_id 6`'s existing real data (4 subjects, real Canvas entries):
  - create/edit/delete an owned item in each of the four categories; create a project and assign items to it; delete the project and confirm its items survive with `project_id` null.
  - tick an academic item done from Workboard, then confirm via `mysql.exe` that the correct Study Pulse table's `status` is `'Done'` with `accomplished_at` set, and that the overlay's `in_progress` was cleared.
  - set an academic item In Progress and confirm the overlay row is created; then mark it Done in Study Pulse directly and confirm the work list reads `done`, not `in_progress` (the derivation rule).
  - set `estimated_hours` and `start_date` on both an owned and an academic item; confirm the estimate stat and Timeline bar reflect them.
  - **cross-user isolation on every new mutating route**, including a second user's token attempting to PATCH an academic entry, an owned item, and a project belonging to `user_id 6`, plus supplying another user's `project_id`/`user_subject_id` on create — all must be rejected, not silently accepted.
  - confirm every test row is cleaned up and row counts return to baseline.
- **UI verification** is code-reading plus fetching the rendered page HTML (200, expected markup, no error markers) — the same honest limitation recorded in v1: pixel-level layout, drag interactions, and responsive behavior cannot be verified by eye in this environment, and any claim about them must say so.
