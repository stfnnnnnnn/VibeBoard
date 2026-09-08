# Workboard v3 — Context-Aware Refinement — Design

**Status:** Approved for planning
**Date:** 2026-09-08
**Depends on:** Workboard v2 (shipped 2026-09-05, commits `eec432d..b567a0b`) and Workboard v1 (`7c7c2de..29c12ee`). Also depends on Study Pulse's entry tables (`activities`, `quizzes`, `exams`, `grade_entries`), `user_subjects`/`subjects`, and the Canvas announcement Include flow whose target-picking logic this spec deliberately mirrors.
**Origin:** a 36-section refinement specification supplied by the user, refined through an inspection pass and seven scoping decisions. §-references throughout point at that document.

## Problem

Workboard v2 works, but it does not yet deliver its stated purpose:

> A preconfigured, context-aware work-management system with the efficiency of a structured spreadsheet, without requiring the user to design and maintain the spreadsheet themselves.

Three gaps stand between v2 and that goal.

**The domain is flatter than the work it models.** `category` is a bare enum and `workboard_projects` is one context-agnostic list. Nothing connects an academic project to its course, or an org initiative to its organization. The New Work modal therefore offers "Project" for a Life errand and "Category" for everything, so the user is asked to impose structure the system should already know.

**There is no structured inspection surface.** Focus answers "what needs attention," Board answers "what stage," Timeline answers "over what span" — but nothing answers "let me see my work as a table and work through it." That table was the original inspiration (`COURSE | ACTIVITY | STATUS | DEADLINE | TIME | FILE`), and it is the one view v2 never built.

**Several semantics are subtly wrong.** Overdue items hide inside Today. A completed item can still read "Overdue." Deadline time exists in the database but is never surfaced. Resources are modelled as a single conceptual "file" when real work lives across Canvas, Drive, GitHub, and Figma at once.

## Goals

- Rename the domain concept `Category` → **Context** throughout the UI and service layer (§4), and enforce that **My Work is an aggregate projection, never a stored value** (§2).
- Give each context the hierarchy it actually has (§3): Academic → Course → optional Academic Project; Organization → Organization → optional Initiative; Projects → Project; Life → Area.
- Replace the Calendar slot with a **context-aware Table view** — the spec's central new feature (§7, §8).
- Rename List → **Focus** and split **Overdue** out of Today (§6).
- Replace the "File" concept with **multiple typed Links** per work item (§10, §25).
- Make **deadline time first-class** and honestly absent when unset (§16).
- Correct **completed / overdue / completed-late** semantics (§18).
- Add **per-context status vocabularies**, normalised to three columns in My Work (§17).
- Add **one flat level of subtasks** (§26).
- Move context navigation into the header, visually distinct from the view selector (§1).
- Preserve ownership isolation across every new relationship (§31).

## Non-goals (§32)

Real-time collaboration, comments, arbitrary custom fields, sprint/Scrum management, nested subtasks, AI scheduling or task generation, dependency graphs, enterprise permissions, team management. Also not in scope: moving the Calendar into the Schedule module (a separate migration), and any change to Study Pulse's own UI.

## What the inspection found

§35 requires inspecting before designing. Four findings materially shaped this spec, and two of them contradict the refinement spec's premises.

1. **§18's bug is narrower than described.** `buildMeta` in `WorkItemRow.tsx` already excludes done items from the overdue flag, so completed cards are *not* styled red. But `formatDueLabel` returns the literal string `'Overdue'` from the date alone with no status check, so a completed item displays the word in ordinary colour. It is a label bug, not a styling bug. No "Completed Late" concept exists at all.

2. **§6's "overdue under Today" was a deliberate v2 decision**, documented at `workStats.ts:11`: *"an overdue item belongs at the top of the list, not buried in a past section that doesn't exist."* v3 reverses it. That is a legitimate product change, recorded here so the reversal is not mistaken for a bug fix.

3. **Deadline time is asymmetric.** `workboard_work_items.due_at` is already a `DATETIME` — time is supported and merely unsurfaced. `activities.deadline` (and the other three Study Pulse tables) is a `DATE`. Study Pulse has no deadline time and its schema is not being altered.

4. **Three of the spec's four hierarchies have no data model.** No organizations, no life areas, no academic projects, no links, no subtasks exist anywhere in the codebase.

Additionally, carried forward from v2's final review: **graded Study Pulse rows have a `BEFORE UPDATE` trigger forcing `status='Done'`.** This shapes the academic-creation design below.

## Decisions taken during scoping

| Question | Decision |
|---|---|
| Spec granularity | **One spec, phased plan.** Recorded: this is ~3× the v2 spec and will produce a 40+ task plan. The user chose this over a three-spec split after the size was stated. |
| Academic deadline time | **Store on the overlay.** Study Pulse keeps owning the date; Workboard owns the time it has no column for. |
| Hierarchy depth | **Generalise projects; add organizations; Life areas as a fixed enum.** No org-management subsystem (§13). |
| Calendar | **Dropped from the primary view selector, kept reachable.** v1's conflict detection, workload heatmap, and the announcement→schedule-override flow are not orphaned. |
| Status model | **Per-context vocabularies now**, against §17's "do not overbuild" but matching §8's own examples. |
| Subtasks | **One flat level.** |
| Academic creation | **Three paths** (see below). |

## Domain model

### Context

`workboard_work_items.category` — the ENUM `('academic','project','organization','life')` — is **not renamed in the database**. The domain layer, API surface, and UI expose it as `context` (§4's explicit allowance: avoid destructive schema renaming where the service layer can carry the terminology). A single mapping point in `workCategories.ts` (renamed `workContexts.ts`) owns the translation.

`my_work` is never a persisted value. The enum has no such member, so the invariant is enforced by the schema, not by convention (§2).

### New tables

```sql
CREATE TABLE IF NOT EXISTS workboard_organizations (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  name        VARCHAR(120) NOT NULL,
  status      ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_org_name (user_id, name),
  FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workboard_item_links (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  -- exactly one owner, mirroring canvas_entry_links' polymorphic pattern
  work_item_id  INT NULL,
  activity_id   INT NULL,
  quiz_id       INT NULL,
  exam_id       INT NULL,
  grade_entry_id INT NULL,
  label         VARCHAR(120) NOT NULL,
  url           VARCHAR(2048) NOT NULL,
  link_type     ENUM('canvas','drive','docs','github','figma','website','portal','form','other')
                  NOT NULL DEFAULT 'other',
  position      SMALLINT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_work_item (work_item_id),
  FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
  FOREIGN KEY (work_item_id) REFERENCES workboard_work_items(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
  FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
  FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
  CONSTRAINT chk_link_one_owner CHECK (
    (work_item_id IS NOT NULL) + (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
    (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
  )
);

CREATE TABLE IF NOT EXISTS workboard_subtasks (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  work_item_id  INT NULL,
  activity_id   INT NULL,
  quiz_id       INT NULL,
  exam_id       INT NULL,
  grade_entry_id INT NULL,
  title         VARCHAR(255) NOT NULL,
  is_done       TINYINT(1) NOT NULL DEFAULT 0,
  position      SMALLINT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_work_item (work_item_id),
  FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
  FOREIGN KEY (work_item_id) REFERENCES workboard_work_items(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
  FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
  FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
  CONSTRAINT chk_subtask_one_owner CHECK (
    (work_item_id IS NOT NULL) + (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
    (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
  )
);
```

Links and subtasks attach to **either** a Workboard-owned item **or** a Study Pulse entry, using the same four-nullable-FK-plus-CHECK pattern `canvas_entry_links` and `workboard_entry_meta` already use. This is what lets an academic item — which Workboard does not own — still carry Workboard-only links and subtasks without touching Study Pulse's schema.

### Altered tables

```sql
-- Projects become context-scoped with an optional parent (§3)
ALTER TABLE workboard_projects
  ADD COLUMN context ENUM('academic','project','organization') NOT NULL DEFAULT 'project',
  ADD COLUMN user_subject_id INT NULL,   -- parent course, when context='academic'
  ADD COLUMN organization_id INT NULL,   -- parent organization, when context='organization'
  ADD FOREIGN KEY (user_subject_id) REFERENCES user_subjects(user_subject_id) ON DELETE CASCADE,
  ADD FOREIGN KEY (organization_id) REFERENCES workboard_organizations(id) ON DELETE CASCADE;

-- Life area, and the organization relationship for org work
ALTER TABLE workboard_work_items
  ADD COLUMN life_area ENUM('personal','household','errands','finance','health','other') NULL,
  ADD COLUMN organization_id INT NULL,
  ADD COLUMN deadline_time TIME NULL,      -- see "Deadline time" below
  ADD COLUMN work_stage VARCHAR(24) NULL,  -- see "Status" below
  ADD FOREIGN KEY (organization_id) REFERENCES workboard_organizations(id) ON DELETE SET NULL;

-- The overlay absorbs academic deadline time and the richer status stage
ALTER TABLE workboard_entry_meta
  ADD COLUMN deadline_time TIME NULL,
  ADD COLUMN work_stage VARCHAR(24) NULL;
```

`workboard_projects.context` deliberately excludes `'life'` — §15 says keep Life lightweight, so Life work has an Area and no project concept. Existing project rows default to `'project'`, which is where they all semantically belong today.

The `context` on a project constrains which parent applies. Validation lives in the service layer, not a CHECK, because the rule is conditional (`context='academic'` requires `user_subject_id` and forbids `organization_id`, and vice versa) and MySQL's CHECK support for that shape is inconsistent across versions.

### Note on the overlay's growth

v2's spec described `workboard_entry_meta` as "deliberately tiny — three fields, and nothing else." v3 adds two: `deadline_time` and `work_stage`. The justification is unchanged and still holds — these are facts about an academic item that Study Pulse has no column for and whose schema is not being altered. But the constraint is now "the overlay holds only what Study Pulse cannot," not "the overlay holds three fields." That relaxation is recorded here deliberately rather than made silently.

## Status model (§17)

Per-context vocabularies, stored as `work_stage` (a `VARCHAR(24)` rather than an enum, so adding a state later is not a migration). Because the column is a free string, **the service layer validates that a stage is legal for its context** — an Academic item can never be persisted as `backlog`, a Life item never as `review`. That validation is a single table-driven check, rejecting with a 400 rather than silently storing a nonsense state:

| Context | Stages |
|---|---|
| Academic | `todo`, `in_progress`, `ready_to_submit`, `submitted`, `done` |
| Projects | `backlog`, `todo`, `in_progress`, `review`, `blocked`, `done` |
| Organization | `todo`, `in_progress`, `review`, `blocked`, `done` |
| Life | `todo`, `in_progress`, `done` |

**My Work normalises to three columns** (§17 explicitly): `backlog`/`todo` → **To Do**; `in_progress`/`ready_to_submit`/`review`/`blocked` → **In Progress**; `submitted`/`done` → **Done**. A `blocked` item additionally renders a badge, so the state is not lost in the normalised view.

The existing `work_status` column (`todo`/`in_progress`/`done`) is **retained as the normalised value** and kept in sync whenever `work_stage` changes. Every v2 consumer — `groupByTimeframe`, `computeStats`, `computeWorkloadChart`, `getWorkItems`'s 14-day cutoff — continues reading `work_status` unchanged. This is what keeps the migration non-breaking.

### The derivation rule, extended

v2's load-bearing rule stands and is extended, not replaced. For academic items:

```
work_status(academic) =
  entry.status === 'Done'   → 'done'      (Study Pulse still wins, checked FIRST)
  meta.work_stage present   → normalise(meta.work_stage)
  otherwise                 → 'todo'

work_stage(academic) =
  entry.status === 'Done'   → meta.work_stage === 'submitted' ? 'submitted' : 'done'
  otherwise                 → meta.work_stage ?? 'todo'
```

`'Done'` is still checked before anything in the overlay, so a stale stage can never mask a genuinely completed item. Write-back maps the other way: `submitted` and `done` both write `status='Done'`; every other stage writes `status='Pending'`.

**Migration:** existing `workboard_entry_meta.in_progress = 1` rows become `work_stage = 'in_progress'`. The `in_progress` column is retained and kept in sync for one release rather than dropped, so a rollback does not lose data.

## Deadline and time (§16)

Deadline is modelled as a **date plus an optional time**, never a datetime with an invented midnight.

- **Owned items:** the date lives in `due_at` normalised to `00:00:00`, and the optional time in the new `deadline_time` column — the same shape as academic items, so one rendering path serves both. This is chosen over reusing `due_at`'s time component because a DATETIME cannot distinguish "due at midnight" from "no time set," which is exactly the distinction §16 requires. A migration moves any existing non-midnight `due_at` time into `deadline_time` and zeroes the time component. `dueDateOf`'s `slice(0, 10)` continues to work unchanged, so every v2 consumer is unaffected.
- **Academic items:** date from Study Pulse's `deadline` (a DATE), optional time from the overlay's `deadline_time`.

Both render as `Sep 8 · 11:59 PM`, or `Sep 8 · —` when the time is unset (§16 is explicit that an absent time must not be rendered as midnight).

## Completed / overdue semantics (§18)

```
status is not done  AND deadline (+time, if set) < now   → OVERDUE
status is done      AND completed_at <= deadline         → COMPLETED
status is done      AND completed_at >  deadline         → COMPLETED LATE
```

`formatDueLabel` gains the status check it currently lacks. Academic items compare at day granularity (`accomplished_at` and `deadline` are both DATEs); owned items compare exactly. A completed item with no recorded completion timestamp renders **COMPLETED** rather than guessing lateness.

## Views

All four are projections over one Work Item domain (§30). No view holds its own state or storage.

### Focus (renamed from List, §6)

Four groups: **OVERDUE**, **TODAY**, **UPCOMING**, **LATER**. Overdue is its own section, no longer folded into Today. The Overdue summary metric links to that section.

### Table (new, §7–§9)

Context-aware columns, fixed per context — the user never configures them, because the system already knows which fields matter (§34):

| Context | Columns |
|---|---|
| My Work | Context, Work, Status, Priority, Deadline, Time, Links |
| Academic | Course, Project, Activity, Status, Deadline, Time, Links |
| Organization | Organization, Project / Initiative, Work, Status, Deadline, Time, Links |
| Projects | Project, Work, Status, Priority, Deadline, Estimate, Links |
| Life | Area, Work, Status, Priority, Deadline, Time, Links |

Absent optional values render an em dash, never an empty cell. Sorting on any column; search and filters apply. Inline editing for Status and Priority (existing select controls), Deadline (existing date picker), and Links (a popover) — all through the existing validated mutation endpoints. **No contenteditable cells** (§9). Clicking the work title opens the detail view.

### Board (§17, §18)

Columns follow the selected context's vocabulary; My Work uses the three normalised columns. Card deadline labels use the corrected semantics above.

### Timeline (§19, §20)

Unchanged plotting rules (bar for start+due, marker for due-only, omitted for neither). Lanes become context-aware: courses under Academic, projects under Projects, organizations under Organization, areas under Life, contexts under My Work.

### Calendar (§21)

Removed from the primary view selector. The route and component remain reachable through a secondary entry point so v1's conflict detection, workload heatmap, and the Canvas announcement → schedule-override flow keep working. Nothing is deleted; the module boundary §21 asks for is enforced where it matters — the primary UI.

## Creation (§11–§15)

A context-aware modal with progressive disclosure. Common to all contexts: Title, Context, Due date, Deadline time, Start date, Priority, Estimated effort, Notes, Links.

**Academic** adds a source choice — the one part of this spec with real blast radius:

1. **Link an existing Study Pulse / Canvas item** — surfaces what already exists. Explicit rather than implicit (§12); creates nothing.
2. **New graded work** — writes a real Study Pulse row, choosing its target the same way the Canvas announcement Include flow already does: Activity / Quiz / Exam for legacy-mode subjects, grading period + category for custom-mode subjects. Reuses `insertActivityEntry`/`insertQuizEntry`/`insertExamEntry`/`insertGradeEntry` unchanged.
3. **New independent activity** — Workboard-owned (`workboard_work_items` with `category='academic'` and a `user_subject_id`), for study work that is not a graded deliverable: revision, reading, practice.

The split is deliberate and resolves the trigger hazard rather than accepting it: graded work lives where grades live, and non-graded study work never touches Study Pulse, so it never meets the `BEFORE UPDATE` trigger that forces `status='Done'` on graded rows.

**Organization** adds Organization and optional Project / Initiative. Never shows Course. **Projects** requires a Project — §14's reasoning is adopted: independent one-off work with no project belongs in Life. **Life** shows Area only; no project field.

Invalid cross-context combinations are rejected at the service layer (§36), not merely hidden in the UI.

## Shell (§1, §22, §23, §27–§29)

Context navigation moves to the upper right of the header, aligned with the title — *where am I working?* The view selector stays below with the toolbar — *how do I want to see it?* The two must not read as identical pill groups; the context row uses the underline treatment already specified for tabs, the view selector keeps its filled-pill treatment.

Metric copy is corrected: Active no longer pairs its count with an unrelated completion figure (§22). Overdue keeps a restrained red accent rather than a saturated warning surface.

A Filters popover (status, priority, project, deadline, overdue) sits beside Search; both apply consistently across all views.

Responsive: contexts in the header on desktop, compact on tablet, horizontally scrolling or a selector on mobile. Table degrades to cards on phone (§29) — never a compressed seven-column grid. Density stays tighter than Rituals or Finance (§27); context colours are used as small accents only and never override the semantic red/amber/green (§28).

## Security (§31)

Every new relationship enforces ownership before persistence: `organization_id`, `project_id`, `user_subject_id`, link and subtask parents. The `checkReferences` helper established in v2 is extended to cover organizations, and equivalent checks guard link and subtask mutations. A user must never reach another user's work item, project, subject, organization, link, or subtask through a manipulated ID. Link URLs are validated and rendered by label, never as raw URLs (§10).

## Migration and compatibility

Additive except for the three `ALTER TABLE`s above, all of which add nullable or defaulted columns. `work_status` is retained as the normalised value so every v2 read path keeps working unchanged. `in_progress` is retained and synced alongside `work_stage` for one release. Existing project rows default to `context='project'`. No existing row requires backfill beyond the two in-place migrations named above (`in_progress` → `work_stage`, non-midnight `due_at` → `deadline_time`).

Study Pulse, Canvas sync, and the v1 Calendar are unaffected: no Study Pulse column is altered, and the only new write path into Study Pulse is the deliberate, opt-in "new graded work" creation path.

## Verification (§36)

No test framework exists in this repo and no browser-automation tool exists in this environment; verification is `tsc --noEmit` plus real curl/mysql calls against the local dev DB with a locally-signed session token, and code reading for anything visual. That limitation must be stated, never implied away.

Domain: `my_work` cannot be persisted; academic fields appear only under Academic; organization fields only under Organization; invalid cross-context combinations rejected by the API, not just hidden. Focus: overdue separate from today; completed items never labelled overdue; group boundaries correct. Table: columns change per context; sorting works; inline mutations persist; absent values render an em dash. Board: stage changes persist and normalise correctly in My Work; completed cards show the right deadline semantics. Timeline: bars/markers/omissions correct; context lanes correct. Links: multiple per item, URLs validated, ownership enforced, both owner kinds (owned and academic) working. Status: the extended derivation rule verified for the stale-stage case — an item marked `ready_to_submit` in Workboard and then `Done` in Study Pulse must read as done. Security: cross-user isolation on work items, projects, organizations, links, subtasks, and academic relationships, each attempted with a manipulated ID from a second account.
