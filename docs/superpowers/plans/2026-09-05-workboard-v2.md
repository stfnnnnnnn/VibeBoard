# Workboard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Workboard from a weekly academic calendar into a unified work manager — one list spanning Academic/Projects/Organization/Life, with four views (List, Board, Timeline, and v1's Calendar preserved), first-class projects, and effort estimates.

**Architecture:** Academic items are read live from Study Pulse (`activities`/`quizzes`/`exams`/`grade_entries`) and written back to it, so Study Pulse keeps sole ownership of done-ness. Workboard owns `workboard_work_items` for Project/Organization/Life work and `workboard_projects` for named projects, plus a deliberately tiny `workboard_entry_meta` overlay holding the only three Workboard-specific facts about an academic item (`in_progress`, `estimated_hours`, `start_date`). One endpoint returns the merged list; all grouping, stats, and charts are computed on read by pure functions; view switching, filtering, and search are client-side.

**Tech Stack:** Next.js 15 App Router, TypeScript, mysql2/promise, lucide-react, React 19. No test framework installed — verification is `npx tsc --noEmit` plus real curl calls against the local dev server using a locally-signed session token, matching how v1 and every Habit Tracker pass in this repo were verified. No browser-automation tool is available.

**Spec:** `docs/superpowers/specs/2026-09-05-workboard-v2-design.md` — read it before Task 1.

## Global Constraints

- **Study Pulse's schema is never modified.** Every Workboard-only fact about an academic item lives in `workboard_entry_meta`.
- **Done-ness derivation rule (load-bearing):** `entry.status === 'Done'` → `'done'` is checked FIRST, before the overlay's `in_progress`. A stale `in_progress = 1` must never mask a real `'Done'`.
- **Priority mapping:** Study Pulse `urgency` is `'High' | 'Medium' | 'Low'`; Workboard uses `'high' | 'normal' | 'low'`. `Medium` ⇄ `normal`, both directions.
- **Timezone:** "today" and week boundaries always come from `todayInManilaAsUtcDate()` in `src/lib/workboard/aggregate.ts`. Never `new Date()`'s UTC components — that exact bug was caught in v1's final review.
- **Ownership on every mutating route**, verified before the write: owned rows by `user_id`; academic entries by joining through `user_subjects`; client-supplied `project_id`/`user_subject_id` verified to belong to the session user before being stored. v1's final review found exactly this gap; it is designed in here.
- **Wire shapes are snake_case** (`WorkItem`, API request/response bodies); internal function-input types are camelCase (matching `WorkboardItemInput` in `src/lib/workboard/items.ts`).
- **Bounded payload:** the work endpoint returns items with `work_status != 'done'`, plus done items completed within the last 14 days.
- **No new npm dependencies.** Board drag-and-drop uses the native HTML5 API.
- **Route convention:** `auth()` → 401 if absent → `ensureWorkboardV2Schema()` → `parseInt(session.user.id)` → parameterized queries.

---

### Task 1: Schema migration

**Files:**
- Modify: `src/lib/migrate.ts` (add a new function at the bottom, following `ensureWorkboardSchema`'s pattern)

**Interfaces:**
- Produces: `ensureWorkboardV2Schema(): Promise<void>` — idempotent, safe on every request and across restarts. Consumed by Tasks 5, 6, 7, 8, 10.

- [ ] **Step 1: Add the migration function**

Add `let _ranWorkboardV2 = false;` alongside the other `_ran*` flags at the top of the file, then append this function at the bottom. It reuses the `columnExists`/`constraintExists`/`indexExists` helpers already in this file from v1 — do not redefine them.

```ts
/** Create the Workboard v2 tables (projects, owned work items, and the academic overlay)
 *  if they don't already exist. Study Pulse's own tables are never modified — the overlay
 *  holds the only three Workboard-specific facts about an academic entry. */
export async function ensureWorkboardV2Schema(): Promise<void> {
  if (_ranWorkboardV2) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_projects (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      name        VARCHAR(120) NOT NULL,
      color       VARCHAR(16) NULL,
      status      ENUM('active','archived') NOT NULL DEFAULT 'active',
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_project_name (user_id, name),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_work_items (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      user_id          INT NOT NULL,
      category         ENUM('academic','project','organization','life') NOT NULL,
      project_id       INT NULL,
      user_subject_id  INT NULL,
      title            VARCHAR(255) NOT NULL,
      note             TEXT NULL,
      priority         ENUM('high','normal','low') NOT NULL DEFAULT 'normal',
      work_status      ENUM('todo','in_progress','done') NOT NULL DEFAULT 'todo',
      due_at           DATETIME NULL,
      start_date       DATE NULL,
      estimated_hours  DECIMAL(5,2) NULL,
      completed_at     DATETIME NULL,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_status (user_id, work_status),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES workboard_projects(id) ON DELETE SET NULL,
      FOREIGN KEY (user_subject_id) REFERENCES user_subjects(user_subject_id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
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
    )
  `);

  _ranWorkboardV2 = true;
}
```

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Verify against the real local dev DB**

Same standalone-script style as v1's Task 1 — `mysql2/promise` is already a project dependency, so plain `node -e` can drive it. Run from the project root in Git Bash:

```bash
node -e "
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', database: 'vibeboard' });
  await conn.query(\`CREATE TABLE IF NOT EXISTS workboard_projects (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(120) NOT NULL,
    color VARCHAR(16) NULL, status ENUM('active','archived') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_user_project_name (user_id, name),
    FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE)\`);
  await conn.query(\`CREATE TABLE IF NOT EXISTS workboard_work_items (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL,
    category ENUM('academic','project','organization','life') NOT NULL,
    project_id INT NULL, user_subject_id INT NULL, title VARCHAR(255) NOT NULL, note TEXT NULL,
    priority ENUM('high','normal','low') NOT NULL DEFAULT 'normal',
    work_status ENUM('todo','in_progress','done') NOT NULL DEFAULT 'todo',
    due_at DATETIME NULL, start_date DATE NULL, estimated_hours DECIMAL(5,2) NULL,
    completed_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_user_status (user_id, work_status),
    FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES workboard_projects(id) ON DELETE SET NULL,
    FOREIGN KEY (user_subject_id) REFERENCES user_subjects(user_subject_id) ON DELETE SET NULL)\`);
  await conn.query(\`CREATE TABLE IF NOT EXISTS workboard_entry_meta (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL,
    activity_id INT NULL, quiz_id INT NULL, exam_id INT NULL, grade_entry_id INT NULL,
    in_progress TINYINT(1) NOT NULL DEFAULT 0, estimated_hours DECIMAL(5,2) NULL,
    start_date DATE NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_activity (activity_id), UNIQUE KEY uniq_quiz (quiz_id),
    UNIQUE KEY uniq_exam (exam_id), UNIQUE KEY uniq_grade_entry (grade_entry_id),
    FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
    FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
    FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
    CONSTRAINT chk_meta_one_entry CHECK ((activity_id IS NOT NULL)+(quiz_id IS NOT NULL)+(exam_id IS NOT NULL)+(grade_entry_id IS NOT NULL)=1))\`);
  for (const t of ['workboard_projects','workboard_work_items','workboard_entry_meta']) {
    const [cols] = await conn.query('SHOW COLUMNS FROM ' + t);
    console.log(t + ':', cols.map(r => r.Field).join(', '));
  }
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
"
```
Expected: three column lists printed, no errors. Run it a second time — identical output, no errors (proves idempotency).

Then confirm the CHECK constraint actually landed (MySQL silently ignores CHECK on some older versions — if it is absent, report that as a concern rather than proceeding silently):
```bash
"C:\xampp\mysql\bin\mysql.exe" -u root vibeboard -e "SHOW CREATE TABLE workboard_entry_meta\G"
```
Expected: `chk_meta_one_entry` present in the output.

- [ ] **Step 4: Commit**

```bash
git add src/lib/migrate.ts
git commit -m "Add Workboard v2 schema: projects, work items, academic entry overlay"
```

---

### Task 2: Core types, status derivation, priority mapping

**Files:**
- Create: `src/lib/workboard/workItems.ts` (types + pure helpers only; Task 4 adds the DB query to this same file)

**Interfaces:**
- Produces: types `WorkCategory`, `WorkStatus`, `WorkPriority`, `WorkSource`, `AcademicSource`, `WorkItem`, `ProjectSummary`, `WorkItemsPayload`; constant `ACADEMIC_SOURCES`; functions `priorityFromUrgency`, `urgencyFromPriority`, `deriveAcademicStatus`, `dueDateOf`. Consumed by Tasks 3, 4, 5, 7, 8, and every view task.

- [ ] **Step 1: Write the file**

```ts
export type WorkCategory = 'academic' | 'project' | 'organization' | 'life';
export type WorkStatus   = 'todo' | 'in_progress' | 'done';
export type WorkPriority = 'high' | 'normal' | 'low';
export type WorkSource   = 'owned' | 'activities' | 'quizzes' | 'exams' | 'grade_entries';

export const ACADEMIC_SOURCES = ['activities', 'quizzes', 'exams', 'grade_entries'] as const;
export type AcademicSource = typeof ACADEMIC_SOURCES[number];

export const WORK_CATEGORIES: WorkCategory[] = ['academic', 'project', 'organization', 'life'];

export interface WorkItem {
  source:           WorkSource;   // 'owned' = workboard_work_items; else the Study Pulse table
  id:               number;       // primary key within that source
  title:            string;
  category:         WorkCategory;
  /** Project name when project_id is set, else course code when user_subject_id is set,
   *  else null. Project wins if both are somehow set. */
  chip_label:       string | null;
  project_id:       number | null;
  user_subject_id:  number | null;
  priority:         WorkPriority;
  work_status:      WorkStatus;
  /** "YYYY-MM-DD HH:MM:SS" for owned items, "YYYY-MM-DD" for academic ones (Study Pulse's
   *  deadline columns are DATE). Always slice(0,10) to compare dates — never parse as a Date. */
  due_at:           string | null;
  start_date:       string | null;
  estimated_hours:  number | null;
  completed_at:     string | null;
  note:             string | null;
}

export interface ProjectSummary {
  id:      number;
  name:    string;
  color:   string | null;
  status:  'active' | 'archived';
}

export interface WorkItemsPayload {
  items:         WorkItem[];
  projects:      ProjectSummary[];
  generated_at:  string;   // "YYYY-MM-DD" — today's Manila date, so clients group without re-deriving it
}

/** Study Pulse stores urgency as 'High' | 'Medium' | 'Low'; Workboard uses high/normal/low.
 *  Anything unrecognised (including null) reads as 'normal' rather than throwing — a bad
 *  urgency value in legacy data must not break the whole work list. */
export function priorityFromUrgency(urgency: string | null | undefined): WorkPriority {
  switch ((urgency ?? '').toLowerCase()) {
    case 'high': return 'high';
    case 'low':  return 'low';
    default:     return 'normal';
  }
}

export function urgencyFromPriority(priority: WorkPriority): 'High' | 'Medium' | 'Low' {
  if (priority === 'high') return 'High';
  if (priority === 'low')  return 'Low';
  return 'Medium';
}

/**
 * The load-bearing rule of this whole feature. Study Pulse's `status` column is the single
 * source of truth for done-ness, so it is checked FIRST: if a student marks something In
 * Progress here and later marks it Done in Study Pulse, the stale overlay flag must never
 * mask the real answer.
 */
export function deriveAcademicStatus(
  entryStatus: string | null | undefined,
  inProgress: number | boolean | null | undefined,
): WorkStatus {
  if (entryStatus === 'Done') return 'done';
  if (inProgress) return 'in_progress';
  return 'todo';
}

/** The calendar date portion of an item's due timestamp, or null when undated. */
export function dueDateOf(item: WorkItem): string | null {
  return item.due_at ? item.due_at.slice(0, 10) : null;
}
```

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors (nothing imports this file yet).

- [ ] **Step 3: Verify the derivation rule by tracing cases**

No test framework in this repo, and these are pure functions — verify by tracing against the code you just wrote, and write the trace into your report (this is the same verification depth used for `occurrenceFulfillment` in the Habit Tracker v2 plan and the pure functions in Workboard v1's Task 3):
- `deriveAcademicStatus('Done', 1)` → `'done'` (the stale-flag case — `'Done'` is checked first, so the `1` never wins).
- `deriveAcademicStatus('Pending', 1)` → `'in_progress'`.
- `deriveAcademicStatus('Pending', 0)` → `'todo'`.
- `deriveAcademicStatus(null, null)` → `'todo'`.
- `priorityFromUrgency('Medium')` → `'normal'`; `priorityFromUrgency(null)` → `'normal'`; `priorityFromUrgency('HIGH')` → `'high'` (case-insensitive).
- `urgencyFromPriority('normal')` → `'Medium'` — confirm it round-trips with `priorityFromUrgency`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workboard/workItems.ts
git commit -m "Add Workboard v2 work-item types, status derivation, and priority mapping"
```

---

### Task 3: Derived pure functions (grouping, stats, workload chart)

**Files:**
- Create: `src/lib/workboard/workStats.ts`

**Interfaces:**
- Consumes: `WorkItem`, `WorkCategory`, `dueDateOf` from `@/lib/workboard/workItems` (Task 2); `addDays` from `@/lib/workboard/aggregate` (already exists from v1).
- Produces: `TimeframeGroups`, `WorkStats`, `WorkloadDay`; functions `groupByTimeframe`, `computeStats`, `computeWorkloadChart`. Consumed by Tasks 5, 11, 12, 14.

- [ ] **Step 1: Write the grouping function**

```ts
import { addDays } from '@/lib/workboard/aggregate';
import { dueDateOf, type WorkItem, type WorkCategory } from '@/lib/workboard/workItems';

export interface TimeframeGroups {
  today:     WorkItem[];
  upcoming:  WorkItem[];
  later:     WorkItem[];
}

/**
 * Today = due today OR overdue (an overdue item belongs at the top of the list, not buried
 * in a past section that doesn't exist). Upcoming = due in the 7 days after today, inclusive
 * of day 7. Later = everything else, including every undated item.
 * Done items are excluded from all three groups — the List view shows open work.
 */
export function groupByTimeframe(items: WorkItem[], todayStr: string): TimeframeGroups {
  const horizon = addDays(todayStr, 7);
  const groups: TimeframeGroups = { today: [], upcoming: [], later: [] };

  for (const item of items) {
    if (item.work_status === 'done') continue;
    const due = dueDateOf(item);
    if (due === null)             groups.later.push(item);
    else if (due <= todayStr)     groups.today.push(item);
    else if (due <= horizon)      groups.upcoming.push(item);
    else                          groups.later.push(item);
  }
  return groups;
}
```

- [ ] **Step 2: Add the stats function**

```ts
export interface WorkStats {
  active_count:              number;
  /** Net change over the trailing 7 days: created minus completed. This is what the schema
   *  can honestly answer — a true "active count as of last week" isn't reconstructable
   *  without history we don't keep, so it is not claimed. */
  active_net_change_7d:      number;
  due_soon_count:            number;   // not done, due within the next 3 days, not overdue
  overdue_count:             number;   // not done, due before today
  estimated_hours_this_week: number;
  estimated_items_counted:   number;   // in-scope items that HAD an estimate
  estimated_items_missing:   number;   // in-scope items with no estimate (disclosed in the UI)
}

export function computeStats(items: WorkItem[], todayStr: string, weekStart: string): WorkStats {
  const soonHorizon = addDays(todayStr, 3);
  const weekEnd     = addDays(weekStart, 6);
  const weekAgo     = addDays(todayStr, -7);

  let active = 0, dueSoon = 0, overdue = 0;
  let hours = 0, counted = 0, missing = 0;
  let created7d = 0, completed7d = 0;

  for (const item of items) {
    const due  = dueDateOf(item);
    const done = item.work_status === 'done';

    if (!done) {
      active++;
      if (due !== null) {
        if (due < todayStr) overdue++;
        else if (due <= soonHorizon) dueSoon++;
      }
      if (due !== null && due >= weekStart && due <= weekEnd) {
        if (item.estimated_hours !== null) { hours += item.estimated_hours; counted++; }
        else missing++;
      }
    }

    if (item.completed_at !== null && item.completed_at.slice(0, 10) >= weekAgo) completed7d++;
  }

  // `created7d` is filled by the caller-supplied created dates on owned items only; academic
  // entries have no created_at exposed on WorkItem, so they contribute to completions but not
  // creations. Stated plainly rather than silently: the delta reads "net change in owned work".
  created7d = 0;

  return {
    active_count:              active,
    active_net_change_7d:      created7d - completed7d,
    due_soon_count:            dueSoon,
    overdue_count:             overdue,
    estimated_hours_this_week: Math.round(hours * 10) / 10,
    estimated_items_counted:   counted,
    estimated_items_missing:   missing,
  };
}
```

**Note for the implementer:** the `created7d = 0` line above is deliberate and must stay as written for this task — `WorkItem` intentionally carries no `created_at` (see Task 2's type), so creations cannot be counted from this data alone. Task 12 renders this stat's subtitle as "N completed in the last 7 days" using `completed7d`'s contribution rather than implying a creation delta. If you find yourself wanting to add `created_at` to `WorkItem` to make a nicer number, stop and report it as a concern instead — that is a spec change, not an implementation detail.

- [ ] **Step 3: Add the workload chart function**

```ts
export interface WorkloadDay {
  date:          string;
  academic:      number;
  project:       number;
  organization:  number;
  life:          number;
  total:         number;
}

/** 7 days, Monday..Sunday, counting not-done items due on each day, split by category.
 *  Mirrors v1's `computeHeatmap` shape (7 entries, Mon-first) so the two charts agree. */
export function computeWorkloadChart(items: WorkItem[], weekStart: string): WorkloadDay[] {
  const days: WorkloadDay[] = [];

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const counts: Record<WorkCategory, number> = { academic: 0, project: 0, organization: 0, life: 0 };
    let total = 0;

    for (const item of items) {
      if (item.work_status === 'done') continue;
      if (dueDateOf(item) !== date) continue;
      counts[item.category]++;
      total++;
    }

    days.push({ date, ...counts, total });
  }
  return days;
}
```

- [ ] **Step 4: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: Verify by tracing concrete cases**

Trace these against the code and write the results into your report (runtime behaviour gets exercised end-to-end in Task 5's curl verification):
- `groupByTimeframe`: an item due yesterday lands in `today` (overdue floats up, per the comment). An item due exactly `todayStr + 7` lands in `upcoming` (inclusive). An item due `todayStr + 8` lands in `later`. An item with `due_at: null` lands in `later`. A `work_status: 'done'` item lands in none of the three.
- `computeStats`: an item due yesterday counts in `overdue` and NOT in `due_soon`. An item due exactly `todayStr + 3` counts in `due_soon`. An in-week item with `estimated_hours: null` increments `estimated_items_missing`, not `estimated_hours`. An empty array returns all zeros with no NaN.
- `computeWorkloadChart`: exactly 7 entries; an item due on day 3 increments only that day's matching category and its `total`; a done item increments nothing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workboard/workStats.ts
git commit -m "Add Workboard v2 grouping, stats, and workload-chart pure functions"
```

---

### Task 4: `getWorkItems` unified read

**Files:**
- Modify: `src/lib/workboard/workItems.ts` (append to the file from Task 2)

**Interfaces:**
- Consumes: everything from Task 2 (same file).
- Produces: `getWorkItems(userId: number): Promise<WorkItemsPayload>`. Consumed by Tasks 5 and 10.

- [ ] **Step 1: Add the imports and the query**

Add these imports at the very top of the file (above the type declarations):

```ts
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { addDays, todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';
```

Then append this function at the bottom:

```ts
interface AcademicTableSpec {
  source:   AcademicSource;
  table:    string;
  pk:       string;
  nameCol:  string;
  metaCol:  'activity_id' | 'quiz_id' | 'exam_id' | 'grade_entry_id';
}

/** The four Study Pulse entry tables, their primary keys, their title columns, and the
 *  overlay column that points back at them. Every academic query in Workboard v2 walks
 *  this list rather than hardcoding table names at call sites. */
export const ACADEMIC_TABLES: AcademicTableSpec[] = [
  { source: 'activities',    table: 'activities',    pk: 'activity_id', nameCol: 'activity_name', metaCol: 'activity_id' },
  { source: 'quizzes',       table: 'quizzes',       pk: 'quiz_id',     nameCol: 'quiz_name',     metaCol: 'quiz_id' },
  { source: 'exams',         table: 'exams',         pk: 'exam_id',     nameCol: 'exam_name',     metaCol: 'exam_id' },
  { source: 'grade_entries', table: 'grade_entries', pk: 'entry_id',    nameCol: 'name',          metaCol: 'grade_entry_id' },
];

export async function getWorkItems(userId: number): Promise<WorkItemsPayload> {
  const today  = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(todayInManilaAsUtcDate());
  const cutoff = addDays(today, -14);   // done items older than this are out of the payload

  const [projectRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, color, status FROM workboard_projects
     WHERE user_id = ? ORDER BY status ASC, name ASC`,
    [userId],
  );
  const projects: ProjectSummary[] = projectRows.map(r => ({
    id: r.id, name: r.name, color: r.color, status: r.status,
  }));

  const [ownedRows] = await pool.execute<RowDataPacket[]>(
    `SELECT wi.id, wi.category, wi.project_id, wi.user_subject_id, wi.title, wi.note,
            wi.priority, wi.work_status, wi.due_at, wi.start_date, wi.estimated_hours,
            wi.completed_at, p.name AS project_name, s.course_code
     FROM workboard_work_items wi
     LEFT JOIN workboard_projects p ON p.id = wi.project_id
     LEFT JOIN user_subjects us ON us.user_subject_id = wi.user_subject_id
     LEFT JOIN subjects s ON s.subject_id = us.subject_id
     WHERE wi.user_id = ?
       AND (wi.work_status != 'done' OR DATE(wi.completed_at) >= ?)`,
    [userId, cutoff],
  );

  const items: WorkItem[] = ownedRows.map(r => ({
    source:          'owned' as const,
    id:              r.id,
    title:           r.title,
    category:        r.category,
    chip_label:      r.project_name ?? r.course_code ?? null,
    project_id:      r.project_id,
    user_subject_id: r.user_subject_id,
    priority:        r.priority,
    work_status:     r.work_status,
    due_at:          r.due_at,
    start_date:      r.start_date ? String(r.start_date).slice(0, 10) : null,
    estimated_hours: r.estimated_hours === null ? null : Number(r.estimated_hours),
    completed_at:    r.completed_at,
    note:            r.note,
  }));

  for (const spec of ACADEMIC_TABLES) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT t.\`${spec.pk}\` AS entry_id, t.\`${spec.nameCol}\` AS title, t.user_subject_id,
              t.urgency, t.status, t.deadline, t.accomplished_at,
              s.course_code,
              m.in_progress, m.estimated_hours, m.start_date
       FROM \`${spec.table}\` t
       JOIN user_subjects us ON us.user_subject_id = t.user_subject_id
       JOIN subjects s ON s.subject_id = us.subject_id
       LEFT JOIN workboard_entry_meta m ON m.\`${spec.metaCol}\` = t.\`${spec.pk}\`
       WHERE us.user_id = ?
         AND (t.status != 'Done' OR t.accomplished_at >= ?)`,
      [userId, cutoff],
    );

    for (const r of rows) {
      items.push({
        source:          spec.source,
        id:              r.entry_id,
        title:           r.title,
        category:        'academic',
        chip_label:      r.course_code ?? null,
        project_id:      null,
        user_subject_id: r.user_subject_id,
        priority:        priorityFromUrgency(r.urgency),
        work_status:     deriveAcademicStatus(r.status, r.in_progress),
        due_at:          r.deadline ? String(r.deadline).slice(0, 10) : null,
        start_date:      r.start_date ? String(r.start_date).slice(0, 10) : null,
        estimated_hours: r.estimated_hours === null || r.estimated_hours === undefined
                           ? null : Number(r.estimated_hours),
        completed_at:    r.accomplished_at ? String(r.accomplished_at).slice(0, 10) : null,
        note:            null,
      });
    }
  }

  return { items, projects, generated_at: today };
}
```

Interpolating `spec.table` / `spec.pk` / `spec.nameCol` / `spec.metaCol` into the SQL is safe: they come only from the fixed `ACADEMIC_TABLES` literal above, never from request input — the same pattern v1's `getWorkboardWeek` already uses for these four tables.

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workboard/workItems.ts
git commit -m "Add getWorkItems unified read across owned and Study Pulse work"
```

Live DB verification happens in Task 5, once the route that calls this exists — there's no value in a throwaway harness when the real route is one task away.

---

### Task 5: `GET /api/workboard/work`

**Files:**
- Create: `src/app/api/workboard/work/route.ts`

**Interfaces:**
- Consumes: `ensureWorkboardV2Schema` (Task 1), `getWorkItems` (Task 4), `groupByTimeframe`/`computeStats`/`computeWorkloadChart` (Task 3), `mondayOf`/`todayInManilaAsUtcDate` (existing, v1).
- Produces: the endpoint every view reads. Response shape documented below; consumed by Tasks 10–16.

- [ ] **Step 1: Write the route**

The route returns the raw items plus the derived values, so the client never re-derives "today" or the week boundary independently and drift is impossible.

```ts
import { auth } from '@/auth';
import { ensureWorkboardV2Schema } from '@/lib/migrate';
import { getWorkItems } from '@/lib/workboard/workItems';
import { computeStats, computeWorkloadChart } from '@/lib/workboard/workStats';
import { mondayOf, todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();

  const userId    = parseInt(session.user.id);
  const payload   = await getWorkItems(userId);
  const weekStart = mondayOf(todayInManilaAsUtcDate());

  return Response.json({
    ...payload,
    week_start: weekStart,
    stats:      computeStats(payload.items, payload.generated_at, weekStart),
    workload:   computeWorkloadChart(payload.items, weekStart),
  });
}
```

Note: grouping (`groupByTimeframe`) is deliberately NOT done server-side — the List view needs to regroup instantly as the user filters by category or types in the search box, so it runs client-side against the same `items` array. `computeStats`/`computeWorkloadChart` are server-side because they describe the whole board, not the current filter.

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Verify against the real local dev DB**

Generate a session token for `user_id 6` (the real fixture account — 4 subjects, real Canvas-sourced entries, `user_subject_id` 11/12/13/15):

```bash
node -e "
const { encode } = require('next-auth/jwt');
(async () => {
  console.log(await encode({
    token: { sub: '6', name: 'Test User' },
    secret: 'vibeboard-dev-secret-replace-in-production',
    salt: 'authjs.session-token',
  }));
})();
"
```

Start the dev server if it isn't running (`npm run dev`; confirm it binds to port 3000 to match `.env.local`'s `AUTH_URL`, and that XAMPP's MySQL is up), then:

```bash
curl -s -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/workboard/work" | \
  node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log('items:', d.items.length, 'projects:', d.projects.length);
    console.log('today:', d.generated_at, 'week_start:', d.week_start);
    console.log('stats:', JSON.stringify(d.stats));
    console.log('workload days:', d.workload.length);
    console.log('sample:', JSON.stringify(d.items.slice(0,3), null, 2));"
```

Expected: `items` contains user 6's real academic entries (each with `source` one of the four Study Pulse tables, `category: 'academic'`, a `chip_label` course code, and a `work_status` of `todo`/`in_progress`/`done`); `projects` is empty (none created yet); `workload days` is exactly 7; `stats` has all seven numeric fields with no `null`/`NaN`.

Also confirm no cross-user leakage: sign a token for a different user (e.g. `sub: '1'`) and confirm none of user 6's entries appear in that response.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/workboard/work/route.ts
git commit -m "Add GET /api/workboard/work unified work payload"
```

---

### Task 6: Projects CRUD routes

**Files:**
- Create: `src/app/api/workboard/projects/route.ts` (GET, POST)
- Create: `src/app/api/workboard/projects/[id]/route.ts` (PATCH, DELETE)

**Interfaces:**
- Consumes: `ensureWorkboardV2Schema` (Task 1).
- Produces: project management endpoints. Consumed by Task 13's dialog.

- [ ] **Step 1: Write GET/POST**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureWorkboardV2Schema } from '@/lib/migrate';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, color, status FROM workboard_projects
     WHERE user_id = ? ORDER BY status ASC, name ASC`,
    [parseInt(session.user.id)],
  );
  return Response.json({ projects: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();

  const { name, color } = await req.json();
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'A project name is required' }, { status: 400 });
  }

  try {
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO workboard_projects (user_id, name, color) VALUES (?, ?, ?)`,
      [parseInt(session.user.id), name.trim(), color || null],
    );
    return Response.json({ status: 'success', project_id: res.insertId });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'You already have a project with that name' }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Write PATCH/DELETE**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const PATCHABLE = ['name', 'color', 'status'] as const;

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const projectId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM workboard_projects WHERE id = ? AND user_id = ?', [projectId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('status' in body && body.status !== 'active' && body.status !== 'archived') {
    return Response.json({ error: 'status must be "active" or "archived"' }, { status: 400 });
  }

  const sets: string[] = [];
  const values: (string | null)[] = [];
  for (const field of PATCHABLE) {
    if (field in body) { sets.push(`${field} = ?`); values.push(body[field] ?? null); }
  }
  if (!sets.length) return Response.json({ error: 'No fields to update' }, { status: 400 });

  try {
    await pool.execute(`UPDATE workboard_projects SET ${sets.join(', ')} WHERE id = ?`, [...values, projectId]);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'You already have a project with that name' }, { status: 400 });
    }
    throw err;
  }
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await props.params;

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_projects WHERE id = ? AND user_id = ?',
    [parseInt(id), parseInt(session.user.id)],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
```

Deleting a project does not delete its work: `workboard_work_items.project_id` is `ON DELETE SET NULL`, so those items survive and simply lose their chip.

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Verify against the real local dev DB**

Using the `user_id 6` token from Task 5:

```bash
# Create
curl -s -X POST -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"name":"VibeBoard"}' "http://localhost:3000/api/workboard/projects"
# Expected: {"status":"success","project_id":<N>}

# Duplicate name rejected
curl -s -X POST -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"name":"VibeBoard"}' "http://localhost:3000/api/workboard/projects"
# Expected: 400 "You already have a project with that name"

# List
curl -s -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/workboard/projects"

# Rename + archive
curl -s -X PATCH -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"name":"VibeBoard Core","status":"archived"}' "http://localhost:3000/api/workboard/projects/<N>"

# Cross-user isolation: a token for sub:'1' must get 404 on PATCH and DELETE against project <N>

# Delete, then confirm re-delete is 404
curl -s -X DELETE -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/workboard/projects/<N>"
```

Confirm via `mysql.exe` that `workboard_projects` is back to zero rows afterward.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/workboard/projects
git commit -m "Add Workboard projects CRUD routes"
```

---

### Task 7: Owned work-item CRUD routes

**Files:**
- Create: `src/app/api/workboard/work-items/route.ts` (POST)
- Create: `src/app/api/workboard/work-items/[id]/route.ts` (PATCH, DELETE)

**Interfaces:**
- Consumes: `ensureWorkboardV2Schema` (Task 1); `WORK_CATEGORIES` from `@/lib/workboard/workItems` (Task 2).
- Produces: create/edit/delete for Workboard-owned items. Consumed by Tasks 11, 13, 15.

- [ ] **Step 1: Write a shared ownership helper and the POST route**

Both routes must verify that a client-supplied `project_id`/`user_subject_id` belongs to the session user before storing it — the exact class of gap v1's final review caught. Put the helper in the POST file and import it from the `[id]` file.

```ts
// src/app/api/workboard/work-items/route.ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureWorkboardV2Schema } from '@/lib/migrate';
import { WORK_CATEGORIES } from '@/lib/workboard/workItems';

const PRIORITIES = ['high', 'normal', 'low'];
const STATUSES   = ['todo', 'in_progress', 'done'];

/** Returns null when the reference is absent or valid; returns an error string when the
 *  client supplied an id that isn't theirs. Never trust an id from the request body. */
export async function checkReferences(
  userId: number, projectId: unknown, userSubjectId: unknown,
): Promise<string | null> {
  if (projectId !== null && projectId !== undefined) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM workboard_projects WHERE id = ? AND user_id = ?', [projectId, userId],
    );
    if (!rows.length) return 'That project was not found';
  }
  if (userSubjectId !== null && userSubjectId !== undefined) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT user_subject_id FROM user_subjects WHERE user_subject_id = ? AND user_id = ?',
      [userSubjectId, userId],
    );
    if (!rows.length) return 'That subject was not found';
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const { category, title, note, project_id, user_subject_id,
          priority, work_status, due_at, start_date, estimated_hours } = body;

  if (!WORK_CATEGORIES.includes(category)) {
    return Response.json({ error: 'category must be academic, project, organization, or life' }, { status: 400 });
  }
  if (typeof title !== 'string' || !title.trim()) {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    return Response.json({ error: 'priority must be high, normal, or low' }, { status: 400 });
  }
  if (work_status !== undefined && !STATUSES.includes(work_status)) {
    return Response.json({ error: 'work_status must be todo, in_progress, or done' }, { status: 400 });
  }

  const refError = await checkReferences(userId, project_id, user_subject_id);
  if (refError) return Response.json({ error: refError }, { status: 400 });

  const status = work_status ?? 'todo';
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO workboard_work_items
       (user_id, category, project_id, user_subject_id, title, note, priority, work_status,
        due_at, start_date, estimated_hours, completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [userId, category, project_id ?? null, user_subject_id ?? null, title.trim(), note || null,
     priority ?? 'normal', status, due_at || null, start_date || null,
     estimated_hours ?? null, status === 'done' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null],
  );

  return Response.json({ status: 'success', item_id: res.insertId });
}
```

- [ ] **Step 2: Write the PATCH/DELETE route**

`work_status` transitions must keep `completed_at` honest: moving to `done` stamps it, moving off `done` clears it.

```ts
// src/app/api/workboard/work-items/[id]/route.ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { WORK_CATEGORIES } from '@/lib/workboard/workItems';
import { checkReferences } from '../route';

const PATCHABLE = ['title', 'note', 'category', 'project_id', 'user_subject_id',
                   'priority', 'work_status', 'due_at', 'start_date', 'estimated_hours'] as const;
const PRIORITIES = ['high', 'normal', 'low'];
const STATUSES   = ['todo', 'in_progress', 'done'];

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const itemId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM workboard_work_items WHERE id = ? AND user_id = ?', [itemId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('category' in body && !WORK_CATEGORIES.includes(body.category)) {
    return Response.json({ error: 'Invalid category' }, { status: 400 });
  }
  if ('priority' in body && !PRIORITIES.includes(body.priority)) {
    return Response.json({ error: 'Invalid priority' }, { status: 400 });
  }
  if ('work_status' in body && !STATUSES.includes(body.work_status)) {
    return Response.json({ error: 'Invalid work_status' }, { status: 400 });
  }

  const refError = await checkReferences(
    userId,
    'project_id' in body ? body.project_id : undefined,
    'user_subject_id' in body ? body.user_subject_id : undefined,
  );
  if (refError) return Response.json({ error: refError }, { status: 400 });

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const field of PATCHABLE) {
    if (field in body) { sets.push(`${field} = ?`); values.push(body[field] ?? null); }
  }
  if ('work_status' in body) {
    sets.push('completed_at = ?');
    values.push(body.work_status === 'done' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null);
  }
  if (!sets.length) return Response.json({ error: 'No fields to update' }, { status: 400 });

  await pool.execute(`UPDATE workboard_work_items SET ${sets.join(', ')} WHERE id = ?`, [...values, itemId]);
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await props.params;

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_work_items WHERE id = ? AND user_id = ?',
    [parseInt(id), parseInt(session.user.id)],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
```

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Verify against the real local dev DB**

Using the `user_id 6` token:

```bash
# Create one item per category
curl -s -X POST -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"category":"life","title":"Renew driver'\''s license","due_at":"2026-09-08 09:00:00","priority":"normal"}' \
  "http://localhost:3000/api/workboard/work-items"

# With a project (create a project first via Task 6's route, note its id)
curl -s -X POST -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"category":"project","title":"Implement authentication","project_id":<P>,"priority":"high","estimated_hours":3.5,"start_date":"2026-09-05"}' \
  "http://localhost:3000/api/workboard/work-items"

# Confirm both appear in GET /api/workboard/work with correct chip_label (project name for the
# project item, null for the life item) and that stats/workload reflect them.

# Reject a project_id belonging to a DIFFERENT user (create one as sub:'1' first) — expect 400
# "That project was not found", NOT a successful insert.

# Status transition stamps completed_at
curl -s -X PATCH -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"work_status":"done"}' "http://localhost:3000/api/workboard/work-items/<N>"
# Then verify in mysql.exe that completed_at is set; PATCH back to "todo" and verify it is NULL again.

# Cross-user isolation: sub:'1' token gets 404 on PATCH and DELETE of item <N>.

# Clean up both items and the project; confirm row counts back to zero.
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/workboard/work-items
git commit -m "Add Workboard owned work-item CRUD routes"
```

---

### Task 8: Academic write-back endpoint

**Files:**
- Create: `src/lib/workboard/academicWrites.ts`
- Create: `src/app/api/workboard/academic/[source]/[id]/route.ts` (PATCH)

**Interfaces:**
- Consumes: `ACADEMIC_TABLES`, `ACADEMIC_SOURCES`, `AcademicSource`, `WorkStatus`, `WorkPriority`, `urgencyFromPriority` from `@/lib/workboard/workItems` (Tasks 2, 4).
- Produces: `patchAcademicItem(userId, source, entryId, patch)`, `AcademicItemNotFoundError`. Consumed by the route in this task and by Tasks 11, 15.

- [ ] **Step 1: Write the write-router module**

```ts
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import {
  ACADEMIC_TABLES, urgencyFromPriority,
  type AcademicSource, type WorkPriority, type WorkStatus,
} from '@/lib/workboard/workItems';

export class AcademicItemNotFoundError extends Error {
  constructor() { super('That item was not found'); this.name = 'AcademicItemNotFoundError'; }
}

export interface AcademicPatch {
  work_status?:      WorkStatus;
  due_at?:           string | null;
  priority?:         WorkPriority;
  estimated_hours?:  number | null;
  start_date?:       string | null;
}

/**
 * Routes each field of a patch to its correct home: done-ness and deadline and urgency go
 * back to the Study Pulse entry itself (it remains the source of truth); in_progress,
 * estimated_hours and start_date go to the workboard_entry_meta overlay, because Study
 * Pulse has no columns for them and its schema is deliberately not being changed.
 *
 * Everything runs in one transaction so a half-applied patch is impossible.
 */
export async function patchAcademicItem(
  userId: number, source: AcademicSource, entryId: number, patch: AcademicPatch,
): Promise<void> {
  const spec = ACADEMIC_TABLES.find(s => s.source === source);
  if (!spec) throw new AcademicItemNotFoundError();

  // Ownership: never trust the id in the URL — walk the entry back to this user's subjects.
  const [owns] = await pool.execute<RowDataPacket[]>(
    `SELECT t.\`${spec.pk}\` AS id FROM \`${spec.table}\` t
     JOIN user_subjects us ON us.user_subject_id = t.user_subject_id
     WHERE t.\`${spec.pk}\` = ? AND us.user_id = ?`,
    [entryId, userId],
  );
  if (!owns.length) throw new AcademicItemNotFoundError();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const entrySets: string[] = [];
    const entryValues: (string | null)[] = [];

    if (patch.work_status !== undefined) {
      if (patch.work_status === 'done') {
        entrySets.push('status = ?', 'accomplished_at = ?');
        entryValues.push('Done', new Date().toISOString().slice(0, 10));
      } else {
        entrySets.push('status = ?', 'accomplished_at = ?');
        entryValues.push('Pending', null);
      }
    }
    if (patch.due_at !== undefined) {
      entrySets.push('deadline = ?');
      entryValues.push(patch.due_at ? patch.due_at.slice(0, 10) : null);
    }
    if (patch.priority !== undefined) {
      entrySets.push('urgency = ?');
      entryValues.push(urgencyFromPriority(patch.priority));
    }
    if (entrySets.length) {
      await conn.execute(
        `UPDATE \`${spec.table}\` SET ${entrySets.join(', ')} WHERE \`${spec.pk}\` = ?`,
        [...entryValues, entryId],
      );
    }

    // Overlay fields. `in_progress` is derived from work_status: only the literal
    // 'in_progress' sets it; both 'done' and 'todo' clear it, so a stale flag can never
    // survive to contradict the entry's own status.
    const overlayCols: string[] = [];
    const overlayVals: (string | number | null)[] = [];
    if (patch.work_status !== undefined) {
      overlayCols.push('in_progress');
      overlayVals.push(patch.work_status === 'in_progress' ? 1 : 0);
    }
    if (patch.estimated_hours !== undefined) {
      overlayCols.push('estimated_hours'); overlayVals.push(patch.estimated_hours);
    }
    if (patch.start_date !== undefined) {
      overlayCols.push('start_date'); overlayVals.push(patch.start_date);
    }

    if (overlayCols.length) {
      const updates = overlayCols.map(c => `${c} = VALUES(${c})`).join(', ');
      await conn.execute(
        `INSERT INTO workboard_entry_meta (user_id, \`${spec.metaCol}\`, ${overlayCols.join(', ')})
         VALUES (?, ?, ${overlayCols.map(() => '?').join(', ')})
         ON DUPLICATE KEY UPDATE ${updates}`,
        [userId, entryId, ...overlayVals],
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
```

- [ ] **Step 2: Write the route**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardV2Schema } from '@/lib/migrate';
import { ACADEMIC_SOURCES, type AcademicSource } from '@/lib/workboard/workItems';
import { patchAcademicItem, AcademicItemNotFoundError, type AcademicPatch } from '@/lib/workboard/academicWrites';

const STATUSES   = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['high', 'normal', 'low'];

export async function PATCH(req: NextRequest, props: { params: Promise<{ source: string; id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();

  const { source, id } = await props.params;
  if (!ACADEMIC_SOURCES.includes(source as AcademicSource)) {
    return Response.json({ error: 'Invalid source' }, { status: 400 });
  }

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('work_status' in body && !STATUSES.includes(body.work_status)) {
    return Response.json({ error: 'Invalid work_status' }, { status: 400 });
  }
  if ('priority' in body && !PRIORITIES.includes(body.priority)) {
    return Response.json({ error: 'Invalid priority' }, { status: 400 });
  }

  const patch: AcademicPatch = {};
  if ('work_status' in body)     patch.work_status     = body.work_status;
  if ('due_at' in body)          patch.due_at          = body.due_at || null;
  if ('priority' in body)        patch.priority        = body.priority;
  if ('estimated_hours' in body) patch.estimated_hours = body.estimated_hours ?? null;
  if ('start_date' in body)      patch.start_date      = body.start_date || null;

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    await patchAcademicItem(parseInt(session.user.id), source as AcademicSource, parseInt(id), patch);
    return Response.json({ status: 'success' });
  } catch (err) {
    if (err instanceof AcademicItemNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
```

- [ ] **Step 3: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Verify against the real local dev DB**

Pick a real pending academic entry belonging to `user_id 6`:
```bash
"C:\xampp\mysql\bin\mysql.exe" -u root vibeboard -e "
SELECT a.activity_id, a.activity_name, a.status, a.urgency, a.deadline
FROM activities a JOIN user_subjects us ON us.user_subject_id = a.user_subject_id
WHERE us.user_id = 6 LIMIT 5;"
```

Record its original `status`/`urgency`/`deadline` so you can restore them, then:

```bash
# Mark In Progress → overlay row created, entry untouched
curl -s -X PATCH -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"work_status":"in_progress"}' "http://localhost:3000/api/workboard/academic/activities/<A>"
# Verify: workboard_entry_meta has a row with activity_id=<A>, in_progress=1;
#         activities.status for <A> is still 'Pending'.

# Confirm the work list reads it as in_progress
curl -s -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/workboard/work" | \
  node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(d.items.filter(i=>i.source==='activities'&&i.id===<A>));"

# Mark Done → writes back to Study Pulse AND clears the stale in_progress flag
curl -s -X PATCH -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"work_status":"done"}' "http://localhost:3000/api/workboard/academic/activities/<A>"
# Verify: activities.status = 'Done', accomplished_at set, overlay in_progress = 0.

# THE DERIVATION RULE: set in_progress=1 directly in SQL while status stays 'Done',
# then confirm GET /api/workboard/work still reports work_status 'done', NOT 'in_progress'.
"C:\xampp\mysql\bin\mysql.exe" -u root vibeboard -e "UPDATE workboard_entry_meta SET in_progress=1 WHERE activity_id=<A>;"

# Estimates and start date land on the overlay, not the entry
curl -s -X PATCH -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"estimated_hours":2.5,"start_date":"2026-09-04"}' "http://localhost:3000/api/workboard/academic/activities/<A>"

# Priority maps: 'normal' must write urgency 'Medium'
curl -s -X PATCH -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"priority":"normal"}' "http://localhost:3000/api/workboard/academic/activities/<A>"

# Invalid source rejected cleanly
curl -s -X PATCH -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"work_status":"done"}' "http://localhost:3000/api/workboard/academic/bogus/1"
# Expected: 400 "Invalid source"

# Cross-user isolation: a sub:'1' token PATCHing activity <A> must get 404, and the row must be unchanged.
```

Restore the entry's original `status`/`urgency`/`deadline`/`accomplished_at` and delete the overlay row when done; confirm `workboard_entry_meta` is empty again.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workboard/academicWrites.ts src/app/api/workboard/academic
git commit -m "Add academic write-back endpoint routing to Study Pulse and the overlay"
```

---

### Task 9: Design direction pass

**Files:**
- Create: `docs/design/workboard-v2-direction.md`

**Interfaces:**
- Produces: the written visual direction every later view task builds against, so three separately-implemented views don't each invent their own spacing, density, and chip treatment.

This task writes no product code. It exists because Tasks 11–16 build six UI surfaces independently; without one written direction they will drift.

- [ ] **Step 1: Invoke the design skills**

Per `.agents/skills/design-guidelines/SKILL.md`'s workflow (SCAN → DIRECT → SYSTEMIZE → …), and its final rule to use the minimum specialists necessary:
1. Invoke `frontend-design` for creative direction, giving it: the spec's Visual Direction section, the existing token set (`.vb-bg`, `.glass`, `.glass-strong`, `.gradient-text`, `.vb-btn-pink`, `.vb-btn-blue`, `.vb-btn-ghost` in `src/app/globals.css`; `#f2a7c0 → #74bcd9` gradient; Inter/DM Sans; lucide-react), and the three mandated departures from the mockup.
2. Invoke `ui-ux-pro-max` to systemize the result into concrete spacing, density, and accessibility decisions.

- [ ] **Step 2: Write the direction document**

Capture, concretely enough that another implementer can follow it without re-deriving anything:
- The type scale actually used (sizes/weights for page title, section headers, row titles, meta text).
- Row density: exact vertical padding, divider treatment and color, hover state.
- Chip treatment: one style for category, one for project/course; exact colors per category.
- Priority: the left-edge treatment (width, colors per level) and the rule that a pill renders only for `high`.
- The four stat cards, including how Overdue changes weight at zero vs. non-zero.
- Empty states for each view, including Timeline's legitimately-empty case.
- Focus-visible styling and the minimum hit target size for the checkbox and drag handles.

- [ ] **Step 3: Commit**

```bash
git add docs/design/workboard-v2-direction.md
git commit -m "Add Workboard v2 visual direction"
```

---

### Task 10: Shell + Calendar view integration

**Files:**
- Create: `src/components/workboard/WorkboardShell.tsx`
- Modify: `src/components/workboard/WorkboardWeekView.tsx` (remove its page chrome so it renders inside the shell)
- Modify: `src/app/workboard/page.tsx`

**Interfaces:**
- Consumes: `getWorkItems` (Task 4), `getWorkboardWeek`/`mondayOf`/`todayInManilaAsUtcDate` (v1), `ensureWorkboardSchema` + `ensureWorkboardV2Schema` (v1 + Task 1), `computeStats`/`computeWorkloadChart` (Task 3), the direction doc (Task 9).
- Produces: `WorkboardShell` accepting `{ initialWeek: WorkboardWeek; initialWork: WorkPayload }`, and a `WorkboardWeekView` that no longer paints the page background or title. Consumed by Tasks 11–17.

- [ ] **Step 1: Strip the page chrome out of `WorkboardWeekView`**

Today the component owns the whole page: its outermost element is
`<div className="vb-bg min-h-screen pb-10" style={{ padding: '40px 5%', … }}>` followed by a header row containing an `<h1 className="gradient-text">Workboard</h1>` and the week nav.

Change: remove that outer `vb-bg min-h-screen` wrapper and the `<h1>`, keeping the week-nav buttons (they belong to this view, not the shell). The component's new outermost element is a plain `<div>` with no page padding and no background — the shell provides both. Everything below the header row (conflict banners, heatmap, grid, deadline strip, reminders rail) is unchanged.

Keep the component's props (`{ initialWeek }`) and its internal `goToWeek` fetch exactly as they are.

- [ ] **Step 2: Write the shell**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, List, Columns3, GanttChart, CalendarDays } from 'lucide-react';
import WorkboardWeekView from './WorkboardWeekView';
import type { WorkboardWeek } from '@/lib/workboard/aggregate';
import type { WorkItem, ProjectSummary } from '@/lib/workboard/workItems';
import type { WorkStats, WorkloadDay } from '@/lib/workboard/workStats';

export interface WorkPayload {
  items:         WorkItem[];
  projects:      ProjectSummary[];
  generated_at:  string;
  week_start:    string;
  stats:         WorkStats;
  workload:      WorkloadDay[];
}

export type ViewKey = 'list' | 'board' | 'timeline' | 'calendar';

const VIEWS: { key: ViewKey; label: string; Icon: typeof List }[] = [
  { key: 'list',     label: 'List',     Icon: List },
  { key: 'board',    label: 'Board',    Icon: Columns3 },
  { key: 'timeline', label: 'Timeline', Icon: GanttChart },
  { key: 'calendar', label: 'Calendar', Icon: CalendarDays },
];

export default function WorkboardShell(
  { initialWeek, initialWork }: { initialWeek: WorkboardWeek; initialWork: WorkPayload },
) {
  const [view, setView] = useState<ViewKey>('list');
  const [work, setWork] = useState<WorkPayload>(initialWork);

  /** Re-pulls the whole work payload. Called after any mutation so stats, the workload
   *  chart, and every view stay consistent without each one tracking its own deltas. */
  const refreshWork = async () => {
    const res = await fetch('/api/workboard/work');
    if (res.ok) setWork(await res.json());
  };

  return (
    <div className="vb-bg min-h-screen pb-10" style={{ padding: '40px 5%', fontFamily: "'Inter','DM Sans','Segoe UI',sans-serif" }}>
      <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#5c6b80', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none', marginBottom: '14px' }}>
        <ArrowLeft size={15} /> Dashboard
      </Link>

      <h1 className="gradient-text" style={{ fontSize: '2.2rem', fontWeight: 700, margin: '0 0 4px' }}>Workboard</h1>
      <p style={{ margin: '0 0 22px', color: '#5c6b80', fontSize: '0.95rem' }}>All your work, in one place.</p>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '18px', flexWrap: 'wrap' }}>
        {VIEWS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setView(key)}
            aria-pressed={view === key}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              border: 'none', borderRadius: '999px', padding: '8px 16px',
              fontWeight: 700, fontSize: '0.83rem', cursor: 'pointer',
              background: view === key ? 'linear-gradient(to right, #f2a7c0, #74bcd9)' : 'rgba(255,255,255,0.5)',
              color: view === key ? '#fff' : '#5c6b80',
            }}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {view === 'calendar' && <WorkboardWeekView initialWeek={initialWeek} />}
      {view !== 'calendar' && (
        <p style={{ color: '#8a94a6', fontSize: '0.9rem' }}>
          {work.items.length} work item{work.items.length === 1 ? '' : 's'} loaded.
        </p>
      )}
    </div>
  );
}
```

The `view !== 'calendar'` branch is a real, honest placeholder for exactly one task: Task 11 replaces it with the List view, Tasks 15 and 16 add Board and Timeline. It renders a true statement about loaded data rather than a fake screen.

- [ ] **Step 3: Rewire the page**

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ensureWorkboardSchema, ensureWorkboardV2Schema } from '@/lib/migrate';
import { getWorkboardWeek, mondayOf, todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';
import { getWorkItems } from '@/lib/workboard/workItems';
import { computeStats, computeWorkloadChart } from '@/lib/workboard/workStats';
import WorkboardShell from '@/components/workboard/WorkboardShell';

export default async function WorkboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  await ensureWorkboardSchema();
  await ensureWorkboardV2Schema();

  const userId    = parseInt(session.user.id);
  const weekStart = mondayOf(todayInManilaAsUtcDate());
  const week      = await getWorkboardWeek(userId, weekStart);
  const payload   = await getWorkItems(userId);

  return (
    <WorkboardShell
      initialWeek={week}
      initialWork={{
        ...payload,
        week_start: weekStart,
        stats:    computeStats(payload.items, payload.generated_at, weekStart),
        workload: computeWorkloadChart(payload.items, weekStart),
      }}
    />
  );
}
```

- [ ] **Step 4: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: Verify**

With the dev server running and the `user_id 6` cookie set:
```bash
curl -s -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/workboard" | head -60
```
Expected: a 200 HTML response containing "Workboard", "All your work, in one place.", the four view labels, and no Next.js error markup. Switching to the Calendar view must render v1's grid exactly as before — confirm the page still contains the class-block markup it did before this task (compare against `curl` output taken before Step 1 if unsure).

No browser-automation tool is available; state plainly in your report which visual aspects you could not verify by eye.

- [ ] **Step 6: Commit**

```bash
git add src/components/workboard/WorkboardShell.tsx src/components/workboard/WorkboardWeekView.tsx src/app/workboard/page.tsx
git commit -m "Add Workboard shell with view switcher, preserving v1 calendar as a view"
```

---

### Task 11: List view

**Files:**
- Create: `src/components/workboard/WorkItemRow.tsx`
- Create: `src/components/workboard/views/WorkListView.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx` (render the List view in place of the Step-2 placeholder)

**Interfaces:**
- Consumes: `WorkItem`, `WorkPayload`, `groupByTimeframe` (Tasks 2, 3, 10); `PATCH /api/workboard/work-items/[id]` (Task 7) and `PATCH /api/workboard/academic/[source]/[id]` (Task 8); the direction doc (Task 9).
- Produces: `WorkItemRow` (shared by List and, in card form, Board) and `WorkListView`. Consumed by Tasks 12, 13, 15.

- [ ] **Step 1: Write the shared row component**

One helper both views need — toggling completion routes to a different endpoint depending on the item's source. Put it in `WorkItemRow.tsx` and export it:

```tsx
'use client';

import type { WorkItem, WorkStatus } from '@/lib/workboard/workItems';

/** Owned items and Study-Pulse-sourced items have different write endpoints. This is the
 *  single place that decision is made — no view should build these URLs itself. */
export async function setWorkStatus(item: WorkItem, next: WorkStatus): Promise<Response> {
  const url = item.source === 'owned'
    ? `/api/workboard/work-items/${item.id}`
    : `/api/workboard/academic/${item.source}/${item.id}`;
  return fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_status: next }),
  });
}
```

Then the row itself: a checkbox (calls `setWorkStatus` then the caller's `onChanged`), the title, a category chip, the `chip_label` chip when present, a due label, and — following Task 9's direction — a colored left edge for priority with a pill rendered **only** for `high`. Rows are separated by dividers, not wrapped in individual cards.

- [ ] **Step 2: Write the List view**

Three collapsible sections (Today / Upcoming / Later) from `groupByTimeframe(items, work.generated_at)`, each showing its count, each rendering `WorkItemRow`. An empty section renders a one-line empty state rather than a bare heading. After any mutation, call the shell's `refreshWork()` so stats and the workload chart stay in sync.

- [ ] **Step 3: Wire it into the shell**

Replace the `view !== 'calendar'` placeholder from Task 10 with `{view === 'list' && <WorkListView work={work} onChanged={refreshWork} />}`, leaving `board`/`timeline` still on the placeholder line until Tasks 15/16.

- [ ] **Step 4: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 5: Verify against the real dev server and DB**

Create a couple of owned items across categories (Task 7's curl recipe), then:
- `curl` the `/workboard` page and confirm the rendered HTML contains the section headings and your item titles.
- Tick an **owned** item complete through the API the row calls (`PATCH /api/workboard/work-items/<id>` with `{"work_status":"done"}`) and confirm it leaves the open sections on the next `GET /api/workboard/work`.
- Tick an **academic** item complete the same way through `/api/workboard/academic/activities/<id>` and confirm via `mysql.exe` that Study Pulse's `activities.status` became `'Done'` — the write-back working end-to-end from the row's own code path.
- Restore every row you changed and delete every item you created; confirm counts return to baseline.

- [ ] **Step 6: Commit**

```bash
git add src/components/workboard/WorkItemRow.tsx src/components/workboard/views/WorkListView.tsx src/components/workboard/WorkboardShell.tsx
git commit -m "Add Workboard list view with status write-back"
```

---

### Task 12: Stat cards, category tabs, and search

**Files:**
- Create: `src/components/workboard/WorkboardStats.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx`
- Modify: `src/components/workboard/views/WorkListView.tsx` (accept the filtered item list rather than the whole payload)

**Interfaces:**
- Consumes: `WorkStats` (Task 3), `WorkPayload` (Task 10), `WORK_CATEGORIES` (Task 2).
- Produces: `WorkboardStats`; the shell gains `category` and `query` state and passes a filtered `WorkItem[]` down to whichever view is active. Consumed by Tasks 15, 16.

- [ ] **Step 1: Write the stat cards**

Four cards from `work.stats`. Per Task 9's direction, **Overdue changes weight**: at `overdue_count > 0` it renders in the alert treatment; at zero it renders quiet. The estimate card's subtitle must disclose incompleteness honestly — when `estimated_items_missing > 0`, it reads e.g. `across 4 items · 2 without an estimate`, never implying the total is complete. The Active card's sub-line reads `{active_net_change_7d >= 0 ? '↑' : '↓'} {abs} net this week`.

- [ ] **Step 2: Add filtering state to the shell**

```tsx
const [category, setCategory] = useState<WorkCategory | 'all'>('all');
const [query, setQuery] = useState('');

const visibleItems = useMemo(() => {
  const q = query.trim().toLowerCase();
  return work.items.filter(item => {
    if (category !== 'all' && item.category !== category) return false;
    if (!q) return true;
    return item.title.toLowerCase().includes(q)
        || (item.chip_label ?? '').toLowerCase().includes(q);
  });
}, [work.items, category, query]);
```

Render the tab row (My Work / Academic / Projects / Organization / Life) and a search input bound to `query`, then pass `visibleItems` to the active view. Stats and the workload chart continue to read `work.stats`/`work.workload` — they describe the whole board, not the current filter, and must not change as the user types.

- [ ] **Step 3: Run tsc, then verify**

```bash
npx tsc --noEmit
```
Then `curl` the page and confirm the stat values in the HTML match what `GET /api/workboard/work` reports for `stats`. Create an overdue item (due yesterday) via Task 7's route and confirm `overdue_count` increments and the card's markup changes; delete it afterward.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/WorkboardStats.tsx src/components/workboard/WorkboardShell.tsx src/components/workboard/views/WorkListView.tsx
git commit -m "Add Workboard stat cards, category tabs, and client-side search"
```

---

### Task 13: Create/edit dialog

**Files:**
- Create: `src/components/workboard/WorkItemDialog.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx` (add the "New Work Item" button)
- Modify: `src/components/workboard/WorkItemRow.tsx` (row overflow menu → Edit)

**Interfaces:**
- Consumes: `POST/PATCH /api/workboard/work-items` (Task 7), `GET/POST /api/workboard/projects` (Task 6), `PATCH /api/workboard/academic/...` (Task 8).
- Produces: `WorkItemDialog` for creating and editing.

- [ ] **Step 1: Write the dialog**

Fields: title, category (four options), project (a select over `work.projects`, plus an inline "＋ New project" that POSTs to the projects route), subject (only offered when category is `academic`), due date, start date (optional — the field explicitly notes it enables a Timeline bar), priority, estimated hours, note.

**Editing an academic item shows only the fields that can actually be written** — status, due date, priority, estimated hours, start date — with a link out to the Study Pulse subject page for anything else (title, scores). Do not render a title field that silently fails to save.

Submit routes by source, exactly as `setWorkStatus` does: owned → `/api/workboard/work-items[/id]`, academic → `/api/workboard/academic/[source]/[id]`.

- [ ] **Step 2: Wire the entry points**

Shell gets a "New Work Item" button (`.vb-btn-pink`) opening the dialog in create mode; `WorkItemRow`'s overflow menu gets an Edit action opening it in edit mode. Both call `refreshWork()` on success.

- [ ] **Step 3: Run tsc, then verify**

```bash
npx tsc --noEmit
```
Exercise both paths through the endpoints the dialog calls: create an item with every field populated (including a new project created inline), confirm it appears in `GET /api/workboard/work` with the right `chip_label` and `estimated_hours`; edit an academic item's estimate and confirm the overlay row updates while Study Pulse's row does not. Clean up.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/WorkItemDialog.tsx src/components/workboard/WorkboardShell.tsx src/components/workboard/WorkItemRow.tsx
git commit -m "Add Workboard create/edit dialog with inline project creation"
```

---

### Task 14: Right rail

**Files:**
- Create: `src/components/workboard/WorkboardRail.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx`

**Interfaces:**
- Consumes: `WorkloadDay` (Task 3), `WorkItem` (Task 2).
- Produces: `WorkboardRail`, rendered beside List and Calendar and hidden on Board/Timeline.

- [ ] **Step 1: Write the rail**

Two panels. **This Week's Workload**: seven stacked bars from `work.workload`, segments coloured by category, with the heaviest day labelled — bar heights scale to the week's own maximum, and a week with no due items renders a flat baseline with an empty-state line rather than seven zero-height bars. **Upcoming Deadlines**: the next five not-done items with a due date, soonest first, each showing title, due label, and category chip.

- [ ] **Step 2: Lay it out in the shell**

Wrap the active view and the rail in a two-column flex row. Per the spec, the rail renders only when `view === 'list' || view === 'calendar'`; on Board and Timeline the view takes the full width, because kanban columns and a date axis both degrade badly when squeezed.

- [ ] **Step 3: Run tsc, then verify**

```bash
npx tsc --noEmit
```
`curl` the page and confirm the rail markup is present on the default (List) view. Confirm the workload numbers rendered match `GET /api/workboard/work`'s `workload` array.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/WorkboardRail.tsx src/components/workboard/WorkboardShell.tsx
git commit -m "Add Workboard right rail with workload chart and upcoming deadlines"
```

---

### Task 15: Board view

**Files:**
- Create: `src/components/workboard/views/WorkBoardView.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx`

**Interfaces:**
- Consumes: `WorkItem`, `WorkStatus` (Task 2); `setWorkStatus` from `@/components/workboard/WorkItemRow` (Task 11) — the board reuses it rather than rebuilding the endpoint routing.
- Produces: `WorkBoardView`.

- [ ] **Step 1: Write the board**

Three columns — To Do / In Progress / Done — from the filtered items, each column showing its count. Cards carry the same information as a List row in a stacked layout.

Drag-and-drop uses the **native HTML5 API only, no new dependency**: each card sets `draggable`, `onDragStart` stashes `{source, id}` via `e.dataTransfer.setData('text/plain', JSON.stringify(...))`; each column handles `onDragOver` (calling `e.preventDefault()`, which is what makes it a valid drop target) and `onDrop` (parsing the payload, calling `setWorkStatus(item, columnStatus)`, then `onChanged()`).

```tsx
const onDrop = async (e: React.DragEvent, next: WorkStatus) => {
  e.preventDefault();
  const raw = e.dataTransfer.getData('text/plain');
  if (!raw) return;
  const { source, id } = JSON.parse(raw) as { source: WorkItem['source']; id: number };
  const item = items.find(i => i.source === source && i.id === id);
  if (!item || item.work_status === next) return;
  const res = await setWorkStatus(item, next);
  if (!res.ok) { alert((await res.json()).error ?? 'Failed to move item'); return; }
  onChanged();
};
```

**Accessibility is not optional here:** every card also carries an overflow menu with "Move to → To Do / In Progress / Done" calling the same handler. Drag is an accelerator; the menu is the guaranteed path. A board that can only be operated by dragging fails keyboard users outright.

- [ ] **Step 2: Wire it into the shell** — `{view === 'board' && <WorkBoardView items={visibleItems} onChanged={refreshWork} />}`.

- [ ] **Step 3: Run tsc, then verify**

```bash
npx tsc --noEmit
```
Drag cannot be simulated without a browser tool. Verify instead that the underlying transition works by calling the same endpoint the drop handler calls: move an owned item `todo → in_progress → done → todo` via `PATCH /api/workboard/work-items/<id>` and confirm each state in `GET /api/workboard/work`; do the same for an academic item via the academic route, confirming `in_progress` lands on the overlay and `done` lands on Study Pulse. `curl` the page and confirm all three column headings render. State clearly in your report that the drag interaction itself was not verified by eye.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/views/WorkBoardView.tsx src/components/workboard/WorkboardShell.tsx
git commit -m "Add Workboard board view with native drag-and-drop and keyboard fallback"
```

---

### Task 16: Timeline view

**Files:**
- Create: `src/components/workboard/views/WorkTimelineView.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx`

**Interfaces:**
- Consumes: `WorkItem`, `dueDateOf` (Task 2); `addDays` from `@/lib/workboard/aggregate`.
- Produces: `WorkTimelineView`.

- [ ] **Step 1: Write the timeline**

A horizontally scrollable date axis spanning four weeks starting from this week's Monday (`work.week_start`), with a today marker line. One lane per category, each lane labelled.

Positioning, given a fixed `DAY_WIDTH` and `dayIndex(date) = days between week_start and date`:
- An item with **both** `start_date` and a due date renders a **bar** from `dayIndex(start_date)` to `dayIndex(due)` inclusive: `left = dayIndex(start) * DAY_WIDTH`, `width = (dayIndex(due) - dayIndex(start) + 1) * DAY_WIDTH`.
- An item with **only** a due date renders a **marker** at `dayIndex(due) * DAY_WIDTH`.
- An item with **no** due date does not appear at all.
- Items whose dates fall outside the four-week window are clipped out, not clamped to the edge — a bar pinned to the boundary would misrepresent when the work actually happens.

When nothing plots, render an explicit empty state ("Nothing scheduled in this window — items need a due date to appear here"), not a bare grid.

- [ ] **Step 2: Wire it into the shell** — `{view === 'timeline' && <WorkTimelineView items={visibleItems} weekStart={work.week_start} today={work.generated_at} />}`.

- [ ] **Step 3: Run tsc, then verify**

```bash
npx tsc --noEmit
```
Create three items: one with a start date and a due date a few days later, one with only a due date, one with neither. Confirm via `GET /api/workboard/work` that all three carry the field values you expect, then `curl` the page and confirm the rendered HTML contains the first two titles and not the third. Hand-trace the pixel math for the bar (state the computed `left`/`width` in your report) the way v1's Task 11 did for its class blocks. Clean up all three items.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/views/WorkTimelineView.tsx src/components/workboard/WorkboardShell.tsx
git commit -m "Add Workboard timeline view with bars, markers, and an honest empty state"
```

---

### Task 17: Responsive pass and final polish

**Files:**
- Modify: `src/components/workboard/WorkboardShell.tsx`, `WorkboardStats.tsx`, `WorkboardRail.tsx`, `views/WorkListView.tsx`, `views/WorkBoardView.tsx`, `views/WorkTimelineView.tsx`

**Interfaces:**
- Consumes: everything built above. Produces no new interfaces.

- [ ] **Step 1: Implement the mobile treatment**

Desktop-first, with a deliberate mobile view rather than a squeeze (the user's own words). Below the mobile breakpoint:
- List is the default view.
- Stat cards go to a 2×2 grid.
- The right rail moves below the main content instead of beside it.
- Board becomes snap-scrolling columns (`scroll-snap-type: x mandatory` on the track, `scroll-snap-align: start` on each column).
- Timeline scrolls horizontally, as it already does.
- The view switcher goes icon-only (labels hidden, `aria-label` retained so the buttons stay named for screen readers).

Board and Timeline remain reachable on mobile — they are not hidden by width.

- [ ] **Step 2: Run the quality gate**

Invoke `impeccable` per `.agents/skills/design-guidelines/SKILL.md` (critique / audit / layout / typeset / harden / polish as relevant) against the finished Workboard surfaces. Fix what it raises that is real; record anything you consciously decline and why.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```
`curl` the page and confirm it still returns 200 with the expected markup after the responsive changes. Since no browser-automation tool is available, responsive behaviour cannot be confirmed by eye — say so explicitly in your report rather than implying it was checked, and list which breakpoints were reasoned about rather than observed.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard
git commit -m "Add Workboard v2 responsive treatment and polish pass"
```

---

## Self-Review

**Spec coverage:**
- Three new tables → Task 1. ✓
- Types, status derivation, priority mapping → Task 2. ✓
- Grouping / stats / workload chart computed on read → Task 3. ✓
- `getWorkItems` merging owned + academic with the 14-day bound → Task 4. ✓
- Unified read endpoint → Task 5. ✓
- Projects CRUD → Task 6. ✓ Owned CRUD → Task 7. ✓ Academic write-back routing → Task 8. ✓
- Visual direction per design-guidelines → Task 9; `impeccable` gate → Task 17. ✓
- Shell, no sidebar, back-link navigation, Calendar preserved → Task 10. ✓
- List → 11; stats/tabs/search → 12; dialog + first-class projects UI → 13; rail (+ collapsing on Board/Timeline) → 14; Board with native DnD and keyboard fallback → 15; Timeline with bars/markers/empty state → 16; responsive → 17. ✓
- Ownership checks on every mutating route → Tasks 6, 7 (`checkReferences`), 8 (`patchAcademicItem`'s join). ✓
- Manila timezone reused, never reimplemented → Tasks 4, 5, 10. ✓

**Placeholder scan:** The only "placeholder" in the plan is Task 10's `view !== 'calendar'` branch, which renders a true statement about loaded data and is explicitly replaced by Tasks 11/15/16. No TBDs, no "add error handling", every code step carries real code.

**Type consistency:** `WorkItem`/`WorkStatus`/`WorkPriority`/`WorkCategory`/`WorkSource`/`AcademicSource` are defined once in Task 2 and imported unchanged everywhere after. `WorkStats`/`WorkloadDay`/`TimeframeGroups` are defined once in Task 3 and consumed in Tasks 5, 10, 12, 14. `WorkPayload` is defined in Task 10 and consumed in 11–16. `setWorkStatus` is defined in Task 11 and reused (not reimplemented) in Task 15. `ACADEMIC_TABLES` is defined in Task 4 and consumed in Task 8. `checkReferences` is defined in Task 7's POST file and imported by its `[id]` sibling.

**Known plan-level risk:** Task 3's `computeStats` hardcodes `created7d = 0` because `WorkItem` deliberately carries no `created_at`, so the "net change" stat only ever reflects completions. This is called out in-task with an instruction to report rather than silently add the field. If the user wants a true creation delta later, that is a spec change (add `created_at` to `WorkItem` and to the academic queries), not an implementation fix.
