# Workboard v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new Workboard module — a weekly view unifying class schedule, Canvas-sourced deadlines, and one-off events — backed by smarter Canvas announcement routing (Task/Event/Reminder/Schedule Change) and deterministic conflict/workload surfacing.

**Architecture:** Two new tables (`workboard_items`, `schedule_overrides`) hold only the item types with no existing home; everything else (`schedule_blocks`, `activities`/`quizzes`/`exams`/`grade_entries`) is read live, never duplicated. A pure aggregation module merges all sources per requested week and runs deterministic conflict/heatmap logic over the merged result — no AI anywhere in this feature. `canvas_announcement_links` is extended (not replaced) to let one announcement fan out to multiple destinations in a single transaction.

**Tech Stack:** Next.js 15 App Router, TypeScript, mysql2/promise, no test framework installed (verification is `tsc --noEmit` + real local-DB calls via a locally-signed dev-secret session token, matching how the Habit Tracker migrations in this repo were verified — no browser-automation tool is available in this environment).

**Spec:** `docs/superpowers/specs/2026-09-05-workboard-v1-design.md` — read it before Task 1; this plan assumes its full detail (architecture rationale, data model, Non-goals).

## Global Constraints

- No unified `academic_calendar_items` table — live aggregation only, per the spec's Architecture section. Existing tables are never dual-written.
- `canvas_announcement_links` rows still name exactly one destination each; an announcement with multiple destinations gets multiple rows (spec: "Data model").
- Deadlines are `DATE`-only (no time component) — the include flow's existing `deadline` validation (`/^\d{4}-\d{2}-\d{2}$/`) is the proof; deadline clustering and rendering must not assume a time-of-day.
- The Workboard week spans **Monday through Sunday (7 days)**, not Monday–Saturday as the spec's heatmap section literally says — a deliberate refinement made during planning: `schedule_blocks.day_of_week` only ever populates Mon–Sat (0–5), but deadlines and events are not restricted to school days, so a 6-day window would silently drop a Sunday deadline cluster. This affects `computeHeatmap` (7 entries, not 6) and the week grid (7 columns). No other part of the spec changes.
- No new npm dependencies.
- All new/changed API routes follow the existing pattern exactly: `auth()` session check → 401 if absent → call the relevant `ensureXSchema()` → `parseInt(session.user.id)` → `pool.execute` with parameterized queries. Every mutating route verifies the target row's `user_id` (or a join back to it) before acting.

---

### Task 1: Schema migration

**Files:**
- Modify: `src/lib/migrate.ts` (add new function, following the exact pattern of `ensureCanvasSchema` already in this file)

**Interfaces:**
- Produces: `ensureWorkboardSchema(): Promise<void>` — idempotent, safe to call on every request and safe to re-run across server restarts (checks `information_schema` before any structural change that isn't a plain `ADD COLUMN`).

- [ ] **Step 1: Add the migration function**

Add near the bottom of `src/lib/migrate.ts`, add `let _ranWorkboard = false;` alongside the other `_ran*` flags at the top of the file, and add these helpers + the function (the three helpers are new to this file — needed because dropping/replacing an index and a CHECK constraint isn't safely idempotent via the existing `ER_DUP_FIELDNAME`-catch pattern, which only covers `ADD COLUMN`):

```ts
async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return rows.length > 0;
}

async function constraintExists(table: string, name: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, name],
  );
  return rows.length > 0;
}

async function indexExists(table: string, name: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name],
  );
  return rows.length > 0;
}

/** Create the Workboard tables and extend canvas_announcement_links for multi-destination
 *  announcements, if not already done. */
export async function ensureWorkboardSchema(): Promise<void> {
  if (_ranWorkboard) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_items (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      user_id                  INT NOT NULL,
      user_subject_id          INT NULL,
      item_type                ENUM('event','reminder') NOT NULL,
      title                    VARCHAR(255) NOT NULL,
      location                 VARCHAR(255) NULL,
      starts_at                DATETIME NULL,
      ends_at                  DATETIME NULL,
      remind_at                DATETIME NULL,
      note                     TEXT NULL,
      source_type              ENUM('manual','canvas_announcement') NOT NULL DEFAULT 'manual',
      source_announcement_id   INT NULL,
      status                   ENUM('active','dismissed','done') NOT NULL DEFAULT 'active',
      created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
      FOREIGN KEY (user_subject_id) REFERENCES user_subjects(user_subject_id) ON DELETE SET NULL,
      FOREIGN KEY (source_announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_overrides (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      block_id                 INT NOT NULL,
      override_date            DATE NOT NULL,
      modality                 ENUM('online','cancelled') NULL,
      note                     TEXT NULL,
      source_type              ENUM('manual','canvas_announcement') NOT NULL DEFAULT 'manual',
      source_announcement_id   INT NULL,
      created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_block_date (block_id, override_date),
      FOREIGN KEY (block_id) REFERENCES schedule_blocks(block_id) ON DELETE CASCADE,
      FOREIGN KEY (source_announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE SET NULL
    )
  `);

  if (!(await columnExists('canvas_announcement_links', 'workboard_item_id'))) {
    await pool.query(`
      ALTER TABLE canvas_announcement_links
        ADD COLUMN workboard_item_id INT NULL,
        ADD FOREIGN KEY (workboard_item_id) REFERENCES workboard_items(id) ON DELETE CASCADE
    `);
  }
  if (!(await columnExists('canvas_announcement_links', 'schedule_override_id'))) {
    await pool.query(`
      ALTER TABLE canvas_announcement_links
        ADD COLUMN schedule_override_id INT NULL,
        ADD FOREIGN KEY (schedule_override_id) REFERENCES schedule_overrides(id) ON DELETE CASCADE
    `);
  }

  // The original table was created with a single-destination UNIQUE index and an unnamed
  // CHECK constraint (MySQL auto-names those). Both must go before Workboard can insert a
  // second row for the same announcement_id with a different destination column set.
  if (await indexExists('canvas_announcement_links', 'uniq_announcement')) {
    await pool.query(`ALTER TABLE canvas_announcement_links DROP INDEX uniq_announcement`);
  }

  const [oldChecks] = await pool.query<RowDataPacket[]>(`
    SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_announcement_links' AND CONSTRAINT_TYPE = 'CHECK'
      AND CONSTRAINT_NAME != 'chk_one_destination'
  `);
  for (const row of oldChecks) {
    await pool.query(`ALTER TABLE canvas_announcement_links DROP CHECK \`${row.CONSTRAINT_NAME}\``);
  }

  if (!(await constraintExists('canvas_announcement_links', 'chk_one_destination'))) {
    await pool.query(`
      ALTER TABLE canvas_announcement_links ADD CONSTRAINT chk_one_destination CHECK (
        (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) + (exam_id IS NOT NULL) +
        (grade_entry_id IS NOT NULL) + (workboard_item_id IS NOT NULL) + (schedule_override_id IS NOT NULL) = 1
      )
    `);
  }

  _ranWorkboard = true;
}
```

- [ ] **Step 2: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Verify against the real local dev DB**

Run (from the project root, Git Bash) — same style as the Habit Tracker v2 plan's Task 1, a standalone script using `mysql2/promise` directly (already a project dependency) against the real local dev DB, duplicating the exact statements the new function runs so this is fast, direct feedback:

```bash
node -e "
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', database: 'vibeboard' });

  await conn.query(\`CREATE TABLE IF NOT EXISTS workboard_items (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, user_subject_id INT NULL,
    item_type ENUM('event','reminder') NOT NULL, title VARCHAR(255) NOT NULL, location VARCHAR(255) NULL,
    starts_at DATETIME NULL, ends_at DATETIME NULL, remind_at DATETIME NULL, note TEXT NULL,
    source_type ENUM('manual','canvas_announcement') NOT NULL DEFAULT 'manual', source_announcement_id INT NULL,
    status ENUM('active','dismissed','done') NOT NULL DEFAULT 'active', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
    FOREIGN KEY (user_subject_id) REFERENCES user_subjects(user_subject_id) ON DELETE SET NULL,
    FOREIGN KEY (source_announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE SET NULL
  )\`);

  await conn.query(\`CREATE TABLE IF NOT EXISTS schedule_overrides (
    id INT AUTO_INCREMENT PRIMARY KEY, block_id INT NOT NULL, override_date DATE NOT NULL,
    modality ENUM('online','cancelled') NULL, note TEXT NULL,
    source_type ENUM('manual','canvas_announcement') NOT NULL DEFAULT 'manual', source_announcement_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_block_date (block_id, override_date),
    FOREIGN KEY (block_id) REFERENCES schedule_blocks(block_id) ON DELETE CASCADE,
    FOREIGN KEY (source_announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE SET NULL
  )\`);

  const [wCol] = await conn.query(\"SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canvas_announcement_links' AND COLUMN_NAME='workboard_item_id'\");
  if (wCol.length === 0) await conn.query('ALTER TABLE canvas_announcement_links ADD COLUMN workboard_item_id INT NULL, ADD FOREIGN KEY (workboard_item_id) REFERENCES workboard_items(id) ON DELETE CASCADE');

  const [sCol] = await conn.query(\"SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canvas_announcement_links' AND COLUMN_NAME='schedule_override_id'\");
  if (sCol.length === 0) await conn.query('ALTER TABLE canvas_announcement_links ADD COLUMN schedule_override_id INT NULL, ADD FOREIGN KEY (schedule_override_id) REFERENCES schedule_overrides(id) ON DELETE CASCADE');

  const [idx] = await conn.query(\"SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canvas_announcement_links' AND INDEX_NAME='uniq_announcement'\");
  if (idx.length > 0) await conn.query('ALTER TABLE canvas_announcement_links DROP INDEX uniq_announcement');

  const [oldChecks] = await conn.query(\"SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canvas_announcement_links' AND CONSTRAINT_TYPE='CHECK' AND CONSTRAINT_NAME != 'chk_one_destination'\");
  for (const row of oldChecks) await conn.query('ALTER TABLE canvas_announcement_links DROP CHECK \`' + row.CONSTRAINT_NAME + '\`');

  const [chk] = await conn.query(\"SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canvas_announcement_links' AND CONSTRAINT_NAME='chk_one_destination'\");
  if (chk.length === 0) await conn.query(\`ALTER TABLE canvas_announcement_links ADD CONSTRAINT chk_one_destination CHECK (
    (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) + (exam_id IS NOT NULL) +
    (grade_entry_id IS NOT NULL) + (workboard_item_id IS NOT NULL) + (schedule_override_id IS NOT NULL) = 1
  )\`);

  const [wCols] = await conn.query('SHOW COLUMNS FROM workboard_items');
  const [sCols] = await conn.query('SHOW COLUMNS FROM schedule_overrides');
  const [lCols] = await conn.query('SHOW COLUMNS FROM canvas_announcement_links');
  console.log('workboard_items:', wCols.map(r => r.Field).join(', '));
  console.log('schedule_overrides:', sCols.map(r => r.Field).join(', '));
  console.log('canvas_announcement_links:', lCols.map(r => r.Field).join(', '));
  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
"
```
Expected: no errors; `canvas_announcement_links` column list includes `workboard_item_id` and `schedule_override_id`. Run it a second time immediately after — expected: identical output, no errors (proves every guard is truly idempotent, not just the plain `ADD COLUMN` cases).

Then confirm the old unique index and single-destination CHECK are actually gone and the new one is in place:
```bash
"C:\xampp\mysql\bin\mysql.exe" -u root vibeboard -e "SHOW CREATE TABLE canvas_announcement_links\G"
```
Expected: no `UNIQUE KEY uniq_announcement`, and a `CONSTRAINT chk_one_destination CHECK` referencing all six destination columns.

- [ ] **Step 4: Commit**

```bash
git add src/lib/migrate.ts
git commit -m "Add Workboard schema: workboard_items, schedule_overrides, multi-destination announcement links"
```

---

### Task 2: Workboard item/override insert helpers

**Files:**
- Create: `src/lib/workboard/items.ts`

**Interfaces:**
- Consumes: `SqlExecutor` type from `@/lib/studypulseEntries` (already exported there).
- Produces: `insertWorkboardItem(input: WorkboardItemInput, db?: SqlExecutor): Promise<{ itemId: number }>`, `insertScheduleOverride(input: ScheduleOverrideInput, db?: SqlExecutor): Promise<{ overrideId: number }>`, types `WorkboardItemInput`, `ScheduleOverrideInput`. Consumed by Task 6 (items CRUD routes) and Task 9 (announcement include route).

- [ ] **Step 1: Write the file**

```ts
import pool from '@/lib/db';
import type { ResultSetHeader } from 'mysql2';
import type { SqlExecutor } from '@/lib/studypulseEntries';

export interface WorkboardItemInput {
  userId:               number;
  userSubjectId:        number | null;
  itemType:             'event' | 'reminder';
  title:                string;
  location:             string | null;
  startsAt:             string | null;  // MySQL DATETIME string, e.g. "2026-09-11 15:00:00"
  endsAt:               string | null;
  remindAt:             string | null;
  note:                 string | null;
  sourceType:           'manual' | 'canvas_announcement';
  sourceAnnouncementId: number | null;
}

export async function insertWorkboardItem(
  input: WorkboardItemInput, db: SqlExecutor = pool,
): Promise<{ itemId: number }> {
  const [r] = await db.execute<ResultSetHeader>(
    `INSERT INTO workboard_items
       (user_id, user_subject_id, item_type, title, location, starts_at, ends_at, remind_at, note, source_type, source_announcement_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [input.userId, input.userSubjectId, input.itemType, input.title, input.location,
     input.startsAt, input.endsAt, input.remindAt, input.note, input.sourceType, input.sourceAnnouncementId],
  );
  return { itemId: r.insertId };
}

export interface ScheduleOverrideInput {
  blockId:              number;
  overrideDate:         string;  // "YYYY-MM-DD"
  modality:             'online' | 'cancelled' | null;
  note:                 string | null;
  sourceType:           'manual' | 'canvas_announcement';
  sourceAnnouncementId: number | null;
}

export async function insertScheduleOverride(
  input: ScheduleOverrideInput, db: SqlExecutor = pool,
): Promise<{ overrideId: number }> {
  const [r] = await db.execute<ResultSetHeader>(
    `INSERT INTO schedule_overrides
       (block_id, override_date, modality, note, source_type, source_announcement_id)
     VALUES (?,?,?,?,?,?)`,
    [input.blockId, input.overrideDate, input.modality, input.note, input.sourceType, input.sourceAnnouncementId],
  );
  return { overrideId: r.insertId };
}
```

- [ ] **Step 2: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: no errors (this file has no callers yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/workboard/items.ts
git commit -m "Add Workboard item/override insert helpers"
```

---

### Task 3: Aggregation pure functions

**Files:**
- Create: `src/lib/workboard/aggregate.ts` (this task writes the pure, DB-free half of the file; Task 4 adds `getWorkboardWeek` to the same file)

**Interfaces:**
- Produces: `mondayOf(date: Date): string`, `addDays(dateStr: string, days: number): string`, `detectConflicts(classOccurrences: ClassOccurrence[], events: WorkboardEventItem[]): ConflictWarning[]`, `detectDeadlineClusters(deadlines: DeadlineItem[]): ConflictWarning[]`, `computeHeatmap(weekStart: string, classOccurrences: ClassOccurrence[], deadlines: DeadlineItem[], events: WorkboardEventItem[]): DayLoad[]`, and the shared types `ClassOccurrence`, `DeadlineItem`, `WorkboardEventItem`, `ConflictWarning`, `LoadLevel`, `DayLoad`, `WorkboardWeek`. Consumed by Task 4 (same file), Task 5 (week route), Task 11 (UI).
- All wire-shape types use **snake_case** field names, matching this codebase's convention for anything serialized to JSON (e.g. `CanvasAnnouncementBank.tsx`'s `bank_status`, `user_subject_id`) — not the camelCase used for internal-only input types like `WorkboardItemInput` in Task 2.

- [ ] **Step 1: Write the types and date helpers**

```ts
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export interface ClassOccurrence {
  block_id:         number;
  user_subject_id:  number | null;
  course_code:      string;
  subject_name:     string | null;
  section:          string | null;
  date:             string;   // "YYYY-MM-DD"
  start_time:       string;   // "HH:MM"
  end_time:         string;   // "HH:MM"
  venue:            string | null;
  is_online:        boolean;
  override:         { modality: 'online' | 'cancelled' | null; note: string | null } | null;
}

export interface DeadlineItem {
  source_table:     'activities' | 'quizzes' | 'exams' | 'grade_entries';
  entry_id:         number;
  user_subject_id:  number;
  subject_name:     string | null;
  course_code:      string | null;
  name:             string;
  deadline:         string;   // "YYYY-MM-DD"
}

export interface WorkboardEventItem {
  id:               number;
  user_subject_id:  number | null;
  subject_name:     string | null;
  item_type:        'event' | 'reminder';
  title:            string;
  location:         string | null;
  starts_at:        string | null;   // "YYYY-MM-DD HH:MM:SS"
  ends_at:          string | null;
  remind_at:        string | null;
  note:             string | null;
}

export interface ConflictWarning {
  type:         'overlap' | 'deadline_cluster';
  date:         string;
  message:      string;
  item_labels:  string[];
}

export type LoadLevel = 'low' | 'medium' | 'high';

export interface DayLoad {
  date:            string;
  score:           number;
  level:           LoadLevel;
  class_hours:     number;
  deadline_count:  number;
  event_count:     number;
}

export interface WorkboardWeek {
  week_start:         string;
  class_occurrences:  ClassOccurrence[];
  deadlines:          DeadlineItem[];
  events:             WorkboardEventItem[];
  reminders:          WorkboardEventItem[];
  conflicts:          ConflictWarning[];
  heatmap:            DayLoad[];
}

/** Monday of the calendar week containing `date`, as "YYYY-MM-DD", computed in UTC so the
 *  result doesn't depend on the server's local timezone (same reasoning as toMysqlUtc in
 *  src/lib/canvas/normalize.ts). */
export function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
```

- [ ] **Step 2: Add `detectConflicts`**

```ts
export function detectConflicts(
  classOccurrences: ClassOccurrence[], events: WorkboardEventItem[],
): ConflictWarning[] {
  const byDate = new Map<string, { label: string; start: number; end: number }[]>();

  for (const c of classOccurrences) {
    if (c.override?.modality === 'cancelled') continue;
    const list = byDate.get(c.date) ?? [];
    list.push({ label: `${c.course_code} class`, start: timeToMinutes(c.start_time), end: timeToMinutes(c.end_time) });
    byDate.set(c.date, list);
  }

  for (const e of events) {
    if (e.item_type !== 'event' || !e.starts_at || !e.ends_at) continue;
    const date = e.starts_at.slice(0, 10);
    const start = timeToMinutes(e.starts_at.slice(11, 16));
    const end = timeToMinutes(e.ends_at.slice(11, 16));
    const list = byDate.get(date) ?? [];
    list.push({ label: e.title, start, end });
    byDate.set(date, list);
  }

  const conflicts: ConflictWarning[] = [];
  for (const [date, items] of byDate) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (rangesOverlap(items[i].start, items[i].end, items[j].start, items[j].end)) {
          conflicts.push({
            type: 'overlap',
            date,
            message: `${items[i].label} overlaps ${items[j].label}`,
            item_labels: [items[i].label, items[j].label],
          });
        }
      }
    }
  }
  return conflicts;
}
```

- [ ] **Step 3: Add `detectDeadlineClusters`**

```ts
/** 3+ deadlines on the same calendar day is a cluster (deadline is DATE-only in this schema —
 *  there's no time-of-day to narrow the window further). */
export function detectDeadlineClusters(deadlines: DeadlineItem[]): ConflictWarning[] {
  const byDate = new Map<string, DeadlineItem[]>();
  for (const d of deadlines) {
    const list = byDate.get(d.deadline) ?? [];
    list.push(d);
    byDate.set(d.deadline, list);
  }

  const clusters: ConflictWarning[] = [];
  for (const [date, items] of byDate) {
    if (items.length >= 3) {
      clusters.push({
        type: 'deadline_cluster',
        date,
        message: `${items.length} deadlines due on this day`,
        item_labels: items.map(i => i.name),
      });
    }
  }
  return clusters;
}
```

- [ ] **Step 4: Add `computeHeatmap`**

```ts
/** v1 heuristic, deliberately simple and easy to retune later:
 *  load = class hours + deadlines * 1.5 + events. Bucketed into low/medium/high. */
export function computeHeatmap(
  weekStart: string,
  classOccurrences: ClassOccurrence[],
  deadlines: DeadlineItem[],
  events: WorkboardEventItem[],
): DayLoad[] {
  const days: DayLoad[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);

    const classesOnDay = classOccurrences.filter(c => c.date === date && c.override?.modality !== 'cancelled');
    const classHours = classesOnDay.reduce(
      (sum, c) => sum + (timeToMinutes(c.end_time) - timeToMinutes(c.start_time)) / 60, 0,
    );
    const deadlineCount = deadlines.filter(d => d.deadline === date).length;
    const eventCount = events.filter(e => e.item_type === 'event' && e.starts_at?.slice(0, 10) === date).length;

    const score = classHours + deadlineCount * 1.5 + eventCount;
    const level: LoadLevel = score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low';

    days.push({ date, score, level, class_hours: classHours, deadline_count: deadlineCount, event_count: eventCount });
  }
  return days;
}
```

- [ ] **Step 5: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Verify by reasoning through concrete cases**

No test framework in this repo, and these are pure functions with no DB dependency — verify by tracing these cases against the code (this is the same verification depth used for `occurrenceFulfillment` in the Habit Tracker v2 plan's Task 2; full runtime exercise happens end-to-end in Task 5's curl-based verification once real data flows through):
- `detectConflicts`: two classes on different days never conflict (different map keys). A class 08:00–09:00 and an event 08:30–09:30 same day → `rangesOverlap(480,540,510,570)` → `480<570 && 510<540` → both true → conflict reported. A class 08:00–09:00 and an event 09:00–10:00 same day (back-to-back, not overlapping) → `480<600 && 540<540` → second clause false → no conflict (half-open interval semantics, correct).
- `detectDeadlineClusters`: exactly 2 deadlines same day → no cluster (`>= 3` required). Exactly 3 → one cluster with all 3 names.
- `computeHeatmap`: a day with one 1-hour class and one deadline → `score = 1 + 1.5 = 2.5` → `'low'` (below 3). Add one more deadline → `score = 4` → `'medium'`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/workboard/aggregate.ts
git commit -m "Add Workboard conflict detection and workload heatmap pure functions"
```

---

### Task 4: `getWorkboardWeek` aggregation query

**Files:**
- Modify: `src/lib/workboard/aggregate.ts` (add to the file from Task 3)

**Interfaces:**
- Consumes: `ClassOccurrence`, `DeadlineItem`, `WorkboardEventItem`, `WorkboardWeek`, `addDays`, `detectConflicts`, `detectDeadlineClusters`, `computeHeatmap` (Task 3, same file).
- Produces: `getWorkboardWeek(userId: number, weekStart: string): Promise<WorkboardWeek>` — `weekStart` must already be a Monday `"YYYY-MM-DD"` string (callers use `mondayOf` first). Consumed by Task 5 (week route).

- [ ] **Step 1: Add the function**

```ts
export async function getWorkboardWeek(userId: number, weekStart: string): Promise<WorkboardWeek> {
  const weekEnd = addDays(weekStart, 6);

  const [blockRows] = await pool.execute<RowDataPacket[]>(
    `SELECT sb.block_id, sb.user_subject_id, sb.course_code, sb.section,
            sb.day_of_week, sb.start_time, sb.end_time, sb.venue, sb.is_online,
            s.subject_name
     FROM schedule_blocks sb
     LEFT JOIN user_subjects us ON sb.user_subject_id = us.user_subject_id
     LEFT JOIN subjects s ON us.subject_id = s.subject_id
     WHERE sb.user_id = ?`,
    [userId],
  );

  const [overrideRows] = await pool.execute<RowDataPacket[]>(
    `SELECT so.block_id, so.override_date, so.modality, so.note
     FROM schedule_overrides so
     JOIN schedule_blocks sb ON sb.block_id = so.block_id
     WHERE sb.user_id = ? AND so.override_date BETWEEN ? AND ?`,
    [userId, weekStart, weekEnd],
  );
  const overrideByKey = new Map<string, RowDataPacket>();
  for (const o of overrideRows) {
    overrideByKey.set(`${o.block_id}:${String(o.override_date).slice(0, 10)}`, o);
  }

  const classOccurrences: ClassOccurrence[] = [];
  for (const b of blockRows) {
    const dow = b.day_of_week as number;
    if (dow == null || dow < 0 || dow > 5) continue; // schedule_blocks only ever populates Mon(0)..Sat(5)
    const date = addDays(weekStart, dow);
    const override = overrideByKey.get(`${b.block_id}:${date}`);
    classOccurrences.push({
      block_id: b.block_id, user_subject_id: b.user_subject_id, course_code: b.course_code,
      subject_name: b.subject_name, section: b.section, date,
      start_time: String(b.start_time).slice(0, 5), end_time: String(b.end_time).slice(0, 5),
      venue: b.venue, is_online: Boolean(b.is_online),
      override: override ? { modality: override.modality, note: override.note } : null,
    });
  }

  async function deadlineQuery(table: string, idCol: string, nameCol: string): Promise<RowDataPacket[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT t.\`${idCol}\` AS entry_id, t.user_subject_id, t.\`${nameCol}\` AS name, t.deadline,
              s.subject_name, s.course_code
       FROM \`${table}\` t
       JOIN user_subjects us ON t.user_subject_id = us.user_subject_id
       JOIN subjects s ON us.subject_id = s.subject_id
       WHERE us.user_id = ? AND t.status != 'Done' AND t.deadline BETWEEN ? AND ?`,
      [userId, weekStart, weekEnd],
    );
    return rows;
  }

  const [actRows, quizRows, examRows, geRows] = await Promise.all([
    deadlineQuery('activities', 'activity_id', 'activity_name'),
    deadlineQuery('quizzes', 'quiz_id', 'quiz_name'),
    deadlineQuery('exams', 'exam_id', 'exam_name'),
    deadlineQuery('grade_entries', 'entry_id', 'name'),
  ]);
  const deadlines: DeadlineItem[] = [
    ...actRows.map(r => ({ source_table: 'activities' as const, entry_id: r.entry_id, user_subject_id: r.user_subject_id, subject_name: r.subject_name, course_code: r.course_code, name: r.name, deadline: String(r.deadline).slice(0, 10) })),
    ...quizRows.map(r => ({ source_table: 'quizzes' as const, entry_id: r.entry_id, user_subject_id: r.user_subject_id, subject_name: r.subject_name, course_code: r.course_code, name: r.name, deadline: String(r.deadline).slice(0, 10) })),
    ...examRows.map(r => ({ source_table: 'exams' as const, entry_id: r.entry_id, user_subject_id: r.user_subject_id, subject_name: r.subject_name, course_code: r.course_code, name: r.name, deadline: String(r.deadline).slice(0, 10) })),
    ...geRows.map(r => ({ source_table: 'grade_entries' as const, entry_id: r.entry_id, user_subject_id: r.user_subject_id, subject_name: r.subject_name, course_code: r.course_code, name: r.name, deadline: String(r.deadline).slice(0, 10) })),
  ];

  const [itemRows] = await pool.execute<RowDataPacket[]>(
    `SELECT wi.id, wi.user_subject_id, wi.item_type, wi.title, wi.location,
            wi.starts_at, wi.ends_at, wi.remind_at, wi.note, s.subject_name
     FROM workboard_items wi
     LEFT JOIN user_subjects us ON wi.user_subject_id = us.user_subject_id
     LEFT JOIN subjects s ON us.subject_id = s.subject_id
     WHERE wi.user_id = ? AND wi.status = 'active'
       AND (
         (wi.item_type = 'event' AND DATE(wi.starts_at) BETWEEN ? AND ?)
         OR (wi.item_type = 'reminder' AND (wi.remind_at IS NULL OR DATE(wi.remind_at) BETWEEN ? AND ?))
       )`,
    [userId, weekStart, weekEnd, weekStart, weekEnd],
  );
  const allItems: WorkboardEventItem[] = itemRows.map(r => ({
    id: r.id, user_subject_id: r.user_subject_id, subject_name: r.subject_name, item_type: r.item_type,
    title: r.title, location: r.location, starts_at: r.starts_at, ends_at: r.ends_at,
    remind_at: r.remind_at, note: r.note,
  }));
  const events = allItems.filter(i => i.item_type === 'event');
  const reminders = allItems.filter(i => i.item_type === 'reminder');

  const conflicts = [...detectConflicts(classOccurrences, events), ...detectDeadlineClusters(deadlines)];
  const heatmap = computeHeatmap(weekStart, classOccurrences, deadlines, events);

  return { week_start: weekStart, class_occurrences: classOccurrences, deadlines, events, reminders, conflicts, heatmap };
}
```

- [ ] **Step 2: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workboard/aggregate.ts
git commit -m "Add getWorkboardWeek aggregation query"
```

(Full DB-backed verification of this function happens in Task 5, once the route that calls it exists — there's no value in a separate throwaway harness when the real route is one small task away.)

---

### Task 5: `GET /api/workboard/week`

**Files:**
- Create: `src/app/api/workboard/week/route.ts`

**Interfaces:**
- Consumes: `ensureWorkboardSchema` (Task 1), `getWorkboardWeek`, `mondayOf` (Tasks 3–4).

- [ ] **Step 1: Write the route**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardSchema } from '@/lib/migrate';
import { getWorkboardWeek, mondayOf } from '@/lib/workboard/aggregate';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardSchema();

  const userId = parseInt(session.user.id);
  const startParam = req.nextUrl.searchParams.get('start');
  const isValidDate = startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam) && !Number.isNaN(new Date(startParam).getTime());
  const weekStart = mondayOf(isValidDate ? new Date(`${startParam}T00:00:00Z`) : new Date());

  const week = await getWorkboardWeek(userId, weekStart);
  return Response.json(week);
}
```

- [ ] **Step 2: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Verify against the real local dev DB**

Generate a locally-signed session token for `user_id 6` (this account already owns real schedule/subject/Canvas data locally — 4 subjects, 3 class blocks on `user_subject_id 11` (CS0001, Mon/Tue/Wed 08:14–09:14), an active Canvas connection, and pending announcements including one literally titled "Asynchronous Today (Friday - May 15)"):

```bash
node -e "
const { encode } = require('next-auth/jwt');
(async () => {
  const token = await encode({
    token: { sub: '6', name: 'Test User' },
    secret: 'vibeboard-dev-secret-replace-in-production',
    salt: 'authjs.session-token',
  });
  console.log(token);
})();
"
```

Start the dev server if it isn't already running (`npm run dev`; confirm it binds to port 3000 to match `.env.local`'s `AUTH_URL`, and that XAMPP's MySQL service is running), then with the token from above:

```bash
curl -s -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/workboard/week" | node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')), null, 2))"
```
Expected: `class_occurrences` contains 3 entries for `block_id` 3/4/5 (CS0001) on the correct dates for whatever week contains today, with `override: null`; `deadlines`/`events`/`reminders`/`conflicts` are empty or reflect any real data already in the DB for user 6; `heatmap` has exactly 7 entries.

Also confirm a `?start=` override works and math for a non-Monday input still resolves to that week's Monday:
```bash
curl -s -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/workboard/week?start=2026-09-10" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).week_start)"
```
Expected: `2026-09-07` (the Monday of the week containing 2026-09-10, a Thursday).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/workboard/week/route.ts
git commit -m "Add GET /api/workboard/week"
```

---

### Task 6: Workboard items CRUD routes

**Files:**
- Create: `src/app/api/workboard/items/route.ts` (POST)
- Create: `src/app/api/workboard/items/[id]/route.ts` (PATCH, DELETE)

**Interfaces:**
- Consumes: `ensureWorkboardSchema` (Task 1), `insertWorkboardItem`, `WorkboardItemInput` (Task 2).

- [ ] **Step 1: Write the POST route**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardSchema } from '@/lib/migrate';
import { insertWorkboardItem } from '@/lib/workboard/items';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardSchema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  const { item_type, title, user_subject_id, location, starts_at, ends_at, remind_at, note } = body;

  if (item_type !== 'event' && item_type !== 'reminder') {
    return Response.json({ error: 'item_type must be "event" or "reminder"' }, { status: 400 });
  }
  if (!title || typeof title !== 'string') {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }
  if (item_type === 'event' && (!starts_at || !ends_at)) {
    return Response.json({ error: 'Events require starts_at and ends_at' }, { status: 400 });
  }

  const { itemId } = await insertWorkboardItem({
    userId, userSubjectId: user_subject_id ?? null, itemType: item_type, title,
    location: location || null, startsAt: starts_at || null, endsAt: ends_at || null,
    remindAt: remind_at || null, note: note || null,
    sourceType: 'manual', sourceAnnouncementId: null,
  });

  return Response.json({ status: 'success', item_id: itemId });
}
```

- [ ] **Step 2: Write the PATCH/DELETE route**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const PATCHABLE_FIELDS = ['title', 'location', 'starts_at', 'ends_at', 'remind_at', 'note', 'status'] as const;

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const itemId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM workboard_items WHERE id = ? AND user_id = ?', [itemId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];
  for (const field of PATCHABLE_FIELDS) {
    if (field in body) { setClauses.push(`${field} = ?`); values.push(body[field]); }
  }
  if (setClauses.length === 0) return Response.json({ error: 'No fields to update' }, { status: 400 });

  await pool.execute(`UPDATE workboard_items SET ${setClauses.join(', ')} WHERE id = ?`, [...values, itemId]);
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const itemId = parseInt(id);

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_items WHERE id = ? AND user_id = ?', [itemId, userId],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
```

- [ ] **Step 3: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Verify against the real local dev DB**

Using the same locally-signed `user_id 6` session token from Task 5:

```bash
# Create a reminder
curl -s -X POST -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"item_type":"reminder","title":"Buy a new notebook"}' \
  "http://localhost:3000/api/workboard/items"
# Expected: {"status":"success","item_id":<N>}

# Create an event
curl -s -X POST -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"item_type":"event","title":"Project Consultation","starts_at":"2026-09-11 15:00:00","ends_at":"2026-09-11 16:00:00","location":"F611","user_subject_id":11}' \
  "http://localhost:3000/api/workboard/items"
# Expected: {"status":"success","item_id":<M>}

# Confirm GET /api/workboard/week?start=2026-09-07 now includes both under events/reminders

# Patch the reminder's title
curl -s -X PATCH -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"title":"Buy two notebooks"}' "http://localhost:3000/api/workboard/items/<N>"
# Expected: {"status":"success"}

# Cross-user isolation: sign a token for a DIFFERENT user_id (e.g. sub: '1') and confirm
# PATCH/DELETE against item <M> (owned by user 6) both return 404, not success.

# Clean up: delete both test items
curl -s -X DELETE -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/workboard/items/<N>"
curl -s -X DELETE -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/workboard/items/<M>"
# Expected: {"status":"success"} both times; re-running DELETE on either now returns 404
```
Confirm via `mysql.exe` that `workboard_items` is back to empty (or its pre-test row count) after cleanup.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/workboard/items
git commit -m "Add Workboard items CRUD routes"
```

---

### Task 7: Schedule-overrides routes

**Files:**
- Create: `src/app/api/workboard/schedule-overrides/route.ts` (POST)
- Create: `src/app/api/workboard/schedule-overrides/[id]/route.ts` (DELETE)

**Interfaces:**
- Consumes: `ensureWorkboardSchema` (Task 1), `insertScheduleOverride`, `ScheduleOverrideInput` (Task 2).

- [ ] **Step 1: Write the POST route**

Ownership is verified by joining `schedule_blocks.user_id` — a schedule override can only be created against a block the requesting user actually owns.

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { ensureWorkboardSchema } from '@/lib/migrate';
import { insertScheduleOverride } from '@/lib/workboard/items';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardSchema();
  const userId = parseInt(session.user.id);

  const { block_id, override_date, modality, note } = await req.json();

  if (!block_id || !override_date || !/^\d{4}-\d{2}-\d{2}$/.test(override_date)) {
    return Response.json({ error: 'block_id and override_date (YYYY-MM-DD) are required' }, { status: 400 });
  }
  if (modality != null && modality !== 'online' && modality !== 'cancelled') {
    return Response.json({ error: 'modality must be "online", "cancelled", or omitted' }, { status: 400 });
  }

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT block_id FROM schedule_blocks WHERE block_id = ? AND user_id = ?', [block_id, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  try {
    const { overrideId } = await insertScheduleOverride({
      blockId: block_id, overrideDate: override_date, modality: modality ?? null, note: note || null,
      sourceType: 'manual', sourceAnnouncementId: null,
    });
    return Response.json({ status: 'success', override_id: overrideId });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'This class already has an override for that date' }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Write the DELETE route**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { ResultSetHeader } from 'mysql2';

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const overrideId = parseInt(id);

  const [res] = await pool.execute<ResultSetHeader>(
    `DELETE so FROM schedule_overrides so
     JOIN schedule_blocks sb ON sb.block_id = so.block_id
     WHERE so.id = ? AND sb.user_id = ?`,
    [overrideId, userId],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
```

- [ ] **Step 3: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Verify against the real local dev DB**

Using the `user_id 6` token and `block_id 3` (a real CS0001 Monday block owned by user 6):

```bash
curl -s -X POST -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"block_id":3,"override_date":"2026-09-07","modality":"cancelled","note":"Instructor sick"}' \
  "http://localhost:3000/api/workboard/schedule-overrides"
# Expected: {"status":"success","override_id":<N>}

curl -s -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/workboard/week?start=2026-09-07" | grep -o '"override":{[^}]*}'
# Expected: the block_id 3 occurrence on 2026-09-07 shows override.modality = "cancelled"

# Duplicate on the same block+date should be rejected
curl -s -X POST -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"block_id":3,"override_date":"2026-09-07","modality":"online"}' \
  "http://localhost:3000/api/workboard/schedule-overrides"
# Expected: 400 "This class already has an override for that date"

# Cross-user isolation: a different user's token attempting POST against block_id 3 → 404
# (block_id 3 belongs to user 6, not the other user)

curl -s -X DELETE -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/workboard/schedule-overrides/<N>"
# Expected: {"status":"success"}
```
Confirm via `mysql.exe` that `schedule_overrides` is empty again after cleanup.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/workboard/schedule-overrides
git commit -m "Add Workboard schedule-overrides routes"
```

---

### Task 8: Announcement destination suggestion

**Files:**
- Modify: `src/lib/canvas/classify.ts`
- Modify: `src/app/api/canvas/announcements/route.ts`

**Interfaces:**
- Produces: `WorkboardDestination = 'task' | 'event' | 'reminder' | 'schedule_change'`, `suggestDestinations(text: string, taskSuggested: boolean): Set<WorkboardDestination>` in `classify.ts`. Consumed by Task 10 (UI) via the `suggested_destinations` field this task adds to the announcements list API response.

- [ ] **Step 1: Add `suggestDestinations` to `classify.ts`**

Append to the end of `src/lib/canvas/classify.ts` (the file already exports `includesAny`, reused here):

```ts
export type WorkboardDestination = 'task' | 'event' | 'reminder' | 'schedule_change';

const SCHEDULE_CHANGE_KEYWORDS = [
  'asynchronous', 'async session', 'no class', 'class is cancelled', 'class is suspended',
  'classes are suspended', 'moved online', 'postponed', 'reschedule', 'rescheduled',
];
const EVENT_KEYWORDS = [
  'consultation', 'meeting', 'orientation', 'seminar', 'session will be held',
];

/**
 * Deterministic, keyword-based — no AI, matching suggestLegacyCategory/suggestCustomCategory
 * above. `taskSuggested` is computed by the caller from those two functions (a non-'general'
 * result) rather than recomputed here, so this function stays independent of grading-mode logic.
 * 'reminder' has no reliable keyword signal and is never auto-suggested — always opt-in.
 */
export function suggestDestinations(text: string, taskSuggested: boolean): Set<WorkboardDestination> {
  const lower = text.toLowerCase();
  const destinations = new Set<WorkboardDestination>();
  if (taskSuggested) destinations.add('task');
  if (includesAny(lower, SCHEDULE_CHANGE_KEYWORDS)) destinations.add('schedule_change');
  if (includesAny(lower, EVENT_KEYWORDS)) destinations.add('event');
  return destinations;
}
```

- [ ] **Step 2: Wire it into the announcements list route**

In `src/app/api/canvas/announcements/route.ts`, update the import and the `items` mapping:

```ts
import {
  suggestLegacyCategory, suggestCustomCategory, classificationText, suggestDestinations,
  type SuggestedCategory, type WorkboardDestination,
} from '@/lib/canvas/classify';
```

Replace the existing `items = rows.map(...)` block with:

```ts
  const items = rows.map(row => {
    const text = classificationText(row.title as string, row.message as string | null);
    let suggested: SuggestedCategory;
    if (row.subject_mode === 'custom' && row.user_subject_id) {
      const names = categoriesBySubject.get(row.user_subject_id as number) ?? [];
      const match = suggestCustomCategory(text, names);
      suggested = match ? { kind: 'custom', categoryName: match } : { kind: 'general' };
    } else {
      const target = suggestLegacyCategory(text);
      suggested = target === 'general' ? { kind: 'general' } : { kind: 'legacy', target };
    }
    const destinations: WorkboardDestination[] = [...suggestDestinations(text, suggested.kind !== 'general')];
    return { ...row, suggested_category: suggested, suggested_destinations: destinations };
  });
```

- [ ] **Step 3: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: errors in `src/components/studypulse/CanvasAnnouncementBank.tsx` are fine for now (its `AnnouncementItem` type doesn't have `suggested_destinations` yet — Task 10 fixes it). No errors in `classify.ts` or the announcements route itself.

- [ ] **Step 4: Verify against the real local dev DB**

Using the `user_id 6` token:

```bash
curl -s -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/canvas/announcements" | \
  node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.items.map(i=>({title:i.title, dest:i.suggested_destinations})))"
```
Expected: the item titled "Asynchronous Today (Friday - May 15)" has `dest` including `"schedule_change"` (matches `SCHEDULE_CHANGE_KEYWORDS`'s `"asynchronous"`); "First Meeting Session Details" includes `"event"` (matches `"meeting"` in `EVENT_KEYWORDS`); items whose text matches none of the keyword sets and whose legacy/custom category came back `'general'` have an empty `dest` array.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/classify.ts src/app/api/canvas/announcements/route.ts
git commit -m "Add deterministic Task/Event/Reminder/Schedule-Change destination suggestion for announcements"
```

---

### Task 9: Multi-destination announcement include route

**Files:**
- Modify: `src/app/api/canvas/announcements/[id]/include/route.ts` (full rewrite of the `POST` handler body — the destination fan-out touches every branch of the existing logic)

**Interfaces:**
- Consumes: `insertWorkboardItem`, `insertScheduleOverride` (Task 2); `insertActivityEntry`, `insertQuizEntry`, `insertExamEntry`, `insertGradeEntry` (existing, from `@/lib/studypulseEntries`).
- New request body shape: `{ destinations: DestinationInput[] }`, replacing the old single-destination `{ target_type, cat_id, period_id, deadline }`.

- [ ] **Step 1: Rewrite the route**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import type { Connection } from 'mysql2/promise';
import {
  insertActivityEntry, insertQuizEntry, insertExamEntry, insertGradeEntry,
} from '@/lib/studypulseEntries';
import { insertWorkboardItem, insertScheduleOverride } from '@/lib/workboard/items';
import { ensureWorkboardSchema } from '@/lib/migrate';

interface AnnouncementRow extends RowDataPacket {
  id: number;
  title: string;
  bank_status: 'pending' | 'included' | 'ignored' | 'removed_upstream';
  user_subject_id: number;
}

const LEGACY_TARGETS = ['activities', 'quizzes', 'exams'] as const;

interface TaskDestination {
  type: 'task';
  target_type: 'activities' | 'quizzes' | 'exams' | 'grade_entries';
  cat_id?: number;
  period_id?: number;
  deadline: string;
}
interface EventDestination {
  type: 'event';
  title: string;
  location?: string | null;
  starts_at: string;
  ends_at: string;
  user_subject_id?: number | null;
}
interface ReminderDestination {
  type: 'reminder';
  title: string;
  remind_at?: string | null;
}
interface ScheduleChangeDestination {
  type: 'schedule_change';
  block_id: number;
  override_date: string;
  modality?: 'online' | 'cancelled' | null;
  note?: string | null;
}
type DestinationInput = TaskDestination | EventDestination | ReminderDestination | ScheduleChangeDestination;

/** Same check as the Activity Bank's Include route — a subject is "custom" mode when it has
 *  a subject_grading row pointing at a real grading preset. */
async function getSubjectMode(userSubjectId: number): Promise<'legacy' | 'custom'> {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM subject_grading sg
       JOIN grading_presets gp ON gp.preset_id = sg.preset_id
       WHERE sg.user_subject_id = ?`,
      [userSubjectId],
    );
    return rows.length ? 'custom' : 'legacy';
  } catch (err) {
    console.error('Canvas announcement include: grading-mode lookup failed, assuming legacy:', err);
    return 'legacy';
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardSchema();

  try {
    const { id } = await props.params;
    const announcementId = parseInt(id);
    const userId = parseInt(session.user.id);
    const { destinations } = await req.json() as { destinations?: DestinationInput[] };

    if (!Array.isArray(destinations) || destinations.length === 0) {
      return Response.json({ error: 'At least one destination is required' }, { status: 400 });
    }

    const [rows] = await pool.execute<AnnouncementRow[]>(
      `SELECT bank.id, bank.title, bank.bank_status, cc.user_subject_id
       FROM canvas_announcement_bank bank
       JOIN canvas_courses cc ON cc.id = bank.course_id
       JOIN canvas_connections conn ON conn.id = bank.connection_id
       WHERE bank.id = ? AND conn.user_id = ?`,
      [announcementId, userId],
    );
    if (rows.length === 0) return Response.json({ error: 'Not found' }, { status: 404 });
    const item = rows[0];
    if (!item.user_subject_id) {
      return Response.json({ error: 'This item\'s course is not linked to a subject yet' }, { status: 400 });
    }
    if (item.bank_status === 'included') {
      return Response.json({ error: 'This announcement has already been included' }, { status: 400 });
    }
    if (item.bank_status !== 'pending' && item.bank_status !== 'ignored') {
      return Response.json(
        { error: 'This announcement is no longer reported by Canvas and can no longer be included' },
        { status: 400 },
      );
    }

    const subjectMode = await getSubjectMode(item.user_subject_id);
    for (const d of destinations) {
      if (d.type === 'task' && subjectMode === 'custom' && LEGACY_TARGETS.includes(d.target_type as typeof LEGACY_TARGETS[number])) {
        return Response.json(
          { error: 'This subject uses custom grading. Choose a period and category instead.' },
          { status: 400 },
        );
      }
      if (d.type === 'task' && subjectMode === 'legacy' && !LEGACY_TARGETS.includes(d.target_type as typeof LEGACY_TARGETS[number]) && d.target_type !== 'grade_entries') {
        return Response.json({ error: 'Invalid target_type' }, { status: 400 });
      }
      if (d.type === 'task' && d.target_type === 'grade_entries' && (!d.cat_id || !d.period_id)) {
        return Response.json({ error: 'cat_id and period_id are required for grade_entries' }, { status: 400 });
      }
      if (d.type === 'schedule_change') {
        const [owns] = await pool.execute<RowDataPacket[]>(
          'SELECT block_id FROM schedule_blocks WHERE block_id = ? AND user_id = ?', [d.block_id, userId],
        );
        if (!owns.length) return Response.json({ error: 'That class block was not found' }, { status: 400 });
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const createdEntryIds: number[] = [];

      for (const d of destinations) {
        let linkColumn: 'activity_id' | 'quiz_id' | 'exam_id' | 'grade_entry_id' | 'workboard_item_id' | 'schedule_override_id';
        let linkedId: number;

        if (d.type === 'task') {
          const commonFields = {
            entryId: null, userSubjectId: item.user_subject_id, name: item.title,
            specificType: '', urgency: 'Medium', status: 'Pending', deadline: d.deadline,
            score: null, items: null, grade: null, accomplishedAt: null,
          };
          if (d.target_type === 'activities') { linkedId = (await insertActivityEntry(commonFields, conn as unknown as Connection)).entryId; linkColumn = 'activity_id'; }
          else if (d.target_type === 'quizzes') { linkedId = (await insertQuizEntry(commonFields, conn as unknown as Connection)).entryId; linkColumn = 'quiz_id'; }
          else if (d.target_type === 'exams') { linkedId = (await insertExamEntry(commonFields, conn as unknown as Connection)).entryId; linkColumn = 'exam_id'; }
          else {
            const [owns] = await conn.execute<RowDataPacket[]>(
              `SELECT 1 FROM grading_categories gc
               JOIN grading_periods gp ON gp.period_id = gc.period_id
               JOIN subject_grading sg ON sg.preset_id = gp.preset_id
               WHERE gc.cat_id = ? AND gc.period_id = ? AND sg.user_subject_id = ?`,
              [d.cat_id, d.period_id, item.user_subject_id],
            );
            if (!owns.length) throw new Error('That category/period does not belong to this subject');
            linkedId = (await insertGradeEntry({ ...commonFields, catId: d.cat_id!, periodId: d.period_id!, isLab: false }, conn as unknown as Connection)).entryId;
            linkColumn = 'grade_entry_id';
          }
        } else if (d.type === 'event') {
          linkedId = (await insertWorkboardItem({
            userId, userSubjectId: d.user_subject_id ?? item.user_subject_id, itemType: 'event',
            title: d.title, location: d.location ?? null, startsAt: d.starts_at, endsAt: d.ends_at,
            remindAt: null, note: null, sourceType: 'canvas_announcement', sourceAnnouncementId: announcementId,
          }, conn as unknown as Connection)).itemId;
          linkColumn = 'workboard_item_id';
        } else if (d.type === 'reminder') {
          linkedId = (await insertWorkboardItem({
            userId, userSubjectId: item.user_subject_id, itemType: 'reminder',
            title: d.title, location: null, startsAt: null, endsAt: null,
            remindAt: d.remind_at ?? null, note: null, sourceType: 'canvas_announcement', sourceAnnouncementId: announcementId,
          }, conn as unknown as Connection)).itemId;
          linkColumn = 'workboard_item_id';
        } else {
          linkedId = (await insertScheduleOverride({
            blockId: d.block_id, overrideDate: d.override_date, modality: d.modality ?? null,
            note: d.note ?? null, sourceType: 'canvas_announcement', sourceAnnouncementId: announcementId,
          }, conn as unknown as Connection)).overrideId;
          linkColumn = 'schedule_override_id';
        }

        await conn.execute(
          `INSERT INTO canvas_announcement_links (announcement_id, ${linkColumn}) VALUES (?, ?)`,
          [announcementId, linkedId],
        );
        createdEntryIds.push(linkedId);
      }

      await conn.execute(
        `UPDATE canvas_announcement_bank SET bank_status = 'included' WHERE id = ?`,
        [announcementId],
      );

      await conn.commit();
      return Response.json({ status: 'success', created: createdEntryIds });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Canvas announcement include failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
```

Note: `insertActivityEntry`/`insertQuizEntry`/`insertExamEntry`/`insertGradeEntry` type their `db` parameter as `SqlExecutor` (`Connection` from `mysql2/promise`); a `PoolConnection` from `pool.getConnection()` structurally satisfies that interface, but its declared TS type comes from plain `mysql2`, hence the `as unknown as Connection` casts — this matches how the pre-existing single-destination version of this route already had to be typed (check the original file before this rewrite; if it didn't need the cast, mysql2's types have since converged and the casts can be dropped — verify by removing one and checking `tsc` still passes).

- [ ] **Step 2: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: no errors in this route file. (Try removing the `as unknown as Connection` casts first — if `tsc` still passes without them, drop them; only keep them if removing causes a type error.)

- [ ] **Step 3: Verify against the real local dev DB**

Using the `user_id 6` token and real announcement `id 6` ("Asynchronous Today (Friday - May 15)", linked to `user_subject_id 12`):

```bash
# Multi-destination: Task + Schedule Change in one Include action
curl -s -X POST -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"destinations":[
        {"type":"task","target_type":"activities","deadline":"2026-09-12"},
        {"type":"schedule_change","block_id":3,"override_date":"2026-09-14","modality":"online","note":"per announcement"}
      ]}' \
  "http://localhost:3000/api/canvas/announcements/6/include"
# Expected: {"status":"success","created":[<activity_id>,<override_id>]}

# Confirm two canvas_announcement_links rows now exist for announcement_id 6 (one activity_id, one schedule_override_id)
"C:\xampp\mysql\bin\mysql.exe" -u root vibeboard -e "SELECT * FROM canvas_announcement_links WHERE announcement_id=6"

# Confirm bank_status flipped to included
curl -s -H "Cookie: authjs.session-token=<token>" "http://localhost:3000/api/canvas/announcements" | \
  node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.items.find(i=>i.id===6).bank_status)"
# Expected: "included"

# Re-including the same announcement should now be rejected
curl -s -X POST -H "Cookie: authjs.session-token=<token>" -H "Content-Type: application/json" \
  -d '{"destinations":[{"type":"reminder","title":"x"}]}' "http://localhost:3000/api/canvas/announcements/6/include"
# Expected: 400 "This announcement has already been included"

# Cross-check: a failing destination (e.g. schedule_change with a block_id not owned by user 6)
# rolls back the whole transaction — confirm with a FRESH pending announcement that a partial
# failure leaves bank_status = 'pending' and creates zero rows, not one.
```

Clean up afterward: delete the created `activities` row, `schedule_overrides` row, and both `canvas_announcement_links` rows, then reset `canvas_announcement_bank.bank_status` back to `'pending'` for announcement `id 6` so the DB is restored to its pre-test state for later manual UI testing in Task 10.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/canvas/announcements/[id]/include/route.ts
git commit -m "Support multi-destination Canvas announcement include (Task/Event/Reminder/Schedule Change)"
```

---

### Task 10: `CanvasAnnouncementBank.tsx` multi-select rework

**Files:**
- Modify: `src/components/studypulse/CanvasAnnouncementBank.tsx` (full rewrite — the Include UI state is too interleaved across destinations to land as an incremental diff, same reasoning as the Habit Tracker `HabitsDashboard.tsx` rewrite in that plan)

**Interfaces:**
- Consumes: `WorkboardDestination` type from `@/lib/canvas/classify` (Task 8); the `suggested_destinations: WorkboardDestination[]` field the announcements route now returns (Task 8); the extended `POST /api/canvas/announcements/[id]/include` body shape `{ destinations: [...] }` (Task 9); `GET /api/studypulse/subjects` (existing) for the Event/Reminder "linked subject" dropdown.
- `AnnouncementItem` gains `suggested_destinations: WorkboardDestination[]` alongside the existing `suggested_category`.

- [ ] **Step 1: Rewrite the component**

Keep everything from the current file (imports, `GLASS`/`selectStyle`/`pillBtn`/`FILTER_PILL*` style constants, `stripHtml`, `suggestionLabel`, `FILTERS`/`FILTER_LABELS`, the empty-state early return, the filter pills, the item-list mapping's header/badges section) exactly as-is. Change only:

1. The import and `AnnouncementItem` interface:
```tsx
import type { SuggestedCategory, WorkboardDestination } from '@/lib/canvas/classify';

export interface AnnouncementItem {
  id: number;
  title: string;
  message: string | null;
  posted_at: string | null;
  course_name: string;
  user_subject_id: number | null;
  subject_mode?: 'legacy' | 'custom';
  bank_status: 'pending' | 'included' | 'ignored' | 'removed_upstream';
  suggested_category: SuggestedCategory;
  suggested_destinations: WorkboardDestination[];
  html_url: string | null;
}
```

2. Replace all of the Include-related state, `openInclude`, `confirmInclude`, and the two `includingId === item.id` render blocks (custom-mode and legacy-mode) with a multi-select version. New state:

```tsx
interface EventDraft { title: string; location: string; starts_at: string; ends_at: string; user_subject_id: number | null }
interface ReminderDraft { title: string; remind_at: string }
interface ScheduleChangeDraft { block_id: number | null; override_date: string; modality: 'online' | 'cancelled'; note: string }
interface ScheduleBlockOption { block_id: number; course_code: string; section: string | null; day_of_week: number }

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CanvasAnnouncementBank({ items, onChange }: { items: AnnouncementItem[]; onChange: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [includingId, setIncludingId] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<WorkboardDestination>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);

  // Task sub-form (legacy/custom picker — same fields as before)
  const [targetType, setTargetType] = useState<'activities' | 'quizzes' | 'exams'>('activities');
  const [deadline, setDeadline] = useState('');
  const [periodsBySubject, setPeriodsBySubject] = useState<Record<number, GradingPeriod[]>>({});
  const [loadingSubjectId, setLoadingSubjectId] = useState<number | null>(null);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [catId, setCatId] = useState<number | null>(null);

  // Event / Reminder / Schedule Change sub-forms
  const [eventDraft, setEventDraft] = useState<EventDraft>({ title: '', location: '', starts_at: '', ends_at: '', user_subject_id: null });
  const [reminderDraft, setReminderDraft] = useState<ReminderDraft>({ title: '', remind_at: '' });
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleChangeDraft>({ block_id: null, override_date: '', modality: 'online', note: '' });
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlockOption[]>([]);
```

3. New `openInclude`, pre-checking suggestions and resetting every draft, and loading grading periods (unchanged from before) plus schedule blocks (new — only fetched once, lazily, the first time any Include panel opens, matching the existing `periodsBySubject` lazy-fetch pattern):

```tsx
  const openInclude = async (item: AnnouncementItem) => {
    if (includingId === item.id) { setIncludingId(null); return; }
    setIncludingId(item.id);
    setChecked(new Set(item.suggested_destinations));
    setPeriodId(null);
    setCatId(null);
    setDeadline('');
    setTargetType(item.suggested_category.kind === 'legacy' ? item.suggested_category.target : 'activities');
    setEventDraft({ title: item.title, location: '', starts_at: '', ends_at: '', user_subject_id: item.user_subject_id });
    setReminderDraft({ title: item.title, remind_at: '' });
    setScheduleDraft({ block_id: null, override_date: '', modality: 'online', note: '' });

    const subjectId = item.user_subject_id;
    if (item.subject_mode === 'custom' && subjectId && !periodsBySubject[subjectId]) {
      setLoadingSubjectId(subjectId);
      try {
        const res  = await fetch(`/api/studypulse/subjects/${subjectId}/grading`);
        const data = await res.json();
        const periods: GradingPeriod[] = data.config?.preset?.periods ?? [];
        setPeriodsBySubject(prev => ({ ...prev, [subjectId]: periods }));
      } catch (err) {
        alert('Failed to load grading periods: ' + (err as Error).message);
      } finally {
        setLoadingSubjectId(null);
      }
    }
    if (scheduleBlocks.length === 0) {
      try {
        const res = await fetch('/api/studypulse/schedule');
        const data = await res.json();
        setScheduleBlocks((data.blocks ?? []).map((b: { block_id: number; course_code: string; section: string | null; day_of_week: number }) => (
          { block_id: b.block_id, course_code: b.course_code, section: b.section, day_of_week: b.day_of_week }
        )));
      } catch (err) {
        console.error('Failed to load schedule blocks:', err);
      }
    }
  };

  const toggleDestination = (d: WorkboardDestination) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  };
```

4. `handlePeriodChange` stays exactly as it was. Replace `confirmInclude` with a version that builds the `destinations` array from whichever boxes are checked:

```tsx
  const confirmInclude = async (item: AnnouncementItem) => {
    const customMode = item.subject_mode === 'custom';
    const destinations: Record<string, unknown>[] = [];

    if (checked.has('task')) {
      if (!deadline) { alert('Choose a deadline for the Task destination'); return; }
      if (customMode) {
        if (periodId == null || catId == null) { alert('Choose a grading period and category for the Task destination'); return; }
        destinations.push({ type: 'task', target_type: 'grade_entries', period_id: periodId, cat_id: catId, deadline });
      } else {
        destinations.push({ type: 'task', target_type: targetType, deadline });
      }
    }
    if (checked.has('event')) {
      if (!eventDraft.title || !eventDraft.starts_at || !eventDraft.ends_at) { alert('Fill in the Event title, start, and end time'); return; }
      destinations.push({
        type: 'event', title: eventDraft.title, location: eventDraft.location || null,
        starts_at: eventDraft.starts_at, ends_at: eventDraft.ends_at, user_subject_id: eventDraft.user_subject_id,
      });
    }
    if (checked.has('reminder')) {
      if (!reminderDraft.title) { alert('Fill in the Reminder title'); return; }
      destinations.push({ type: 'reminder', title: reminderDraft.title, remind_at: reminderDraft.remind_at || null });
    }
    if (checked.has('schedule_change')) {
      if (!scheduleDraft.block_id || !scheduleDraft.override_date) { alert('Choose a class meeting and date for the Schedule Change destination'); return; }
      destinations.push({
        type: 'schedule_change', block_id: scheduleDraft.block_id, override_date: scheduleDraft.override_date,
        modality: scheduleDraft.modality, note: scheduleDraft.note || null,
      });
    }
    if (destinations.length === 0) { alert('Check at least one destination'); return; }

    setBusy(item.id);
    try {
      const res = await fetch(`/api/canvas/announcements/${item.id}/include`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinations }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? 'Failed'); return; }
      setIncludingId(null);
      onChange();
    } catch (err) {
      alert('Include failed: ' + (err as Error).message);
    } finally {
      setBusy(null);
    }
  };
```

`dismiss` stays unchanged.

5. Replace the two `includingId === item.id && (!customMode | customMode)` render blocks with one unified panel: a checkbox row for the four destinations, followed by whichever sub-forms are checked, followed by one "Confirm Include" button:

```tsx
            {includingId === item.id && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignSelf: 'stretch', justifyContent: 'flex-end' }}>
                  {(['task', 'event', 'reminder', 'schedule_change'] as WorkboardDestination[]).map(d => (
                    <label key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem', fontWeight: 700, color: '#5c6b80', cursor: 'pointer' }}>
                      <input type="checkbox" checked={checked.has(d)} onChange={() => toggleDestination(d)} />
                      {d === 'schedule_change' ? 'Schedule Change' : d.charAt(0).toUpperCase() + d.slice(1)}
                    </label>
                  ))}
                </div>

                {checked.has('task') && !customMode && (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#8a94a6' }}>Task:</span>
                    <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="cab2-select" style={selectStyle} />
                    <select value={targetType} onChange={e => setTargetType(e.target.value as typeof targetType)} className="cab2-select" style={selectStyle}>
                      <option value="activities">Activity</option>
                      <option value="quizzes">Quiz</option>
                      <option value="exams">Exam</option>
                    </select>
                  </div>
                )}
                {checked.has('task') && customMode && (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#8a94a6' }}>Task:</span>
                    {loadingSubjectId === item.user_subject_id && <span style={{ fontSize: '0.8rem', color: '#8a94a6' }}>Loading grading periods…</span>}
                    {loadingSubjectId !== item.user_subject_id && (
                      <>
                        <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="cab2-select" style={selectStyle} />
                        <select value={periodId ?? ''} onChange={e => handlePeriodChange(item, Number(e.target.value))} className="cab2-select" style={selectStyle}>
                          <option value="" disabled>Period…</option>
                          {(periodsBySubject[item.user_subject_id!] ?? []).map(p => <option key={p.period_id} value={p.period_id}>{p.name}</option>)}
                        </select>
                        <select value={catId ?? ''} onChange={e => setCatId(Number(e.target.value))} disabled={periodId == null} className="cab2-select" style={selectStyle}>
                          <option value="" disabled>Category…</option>
                          {(periodsBySubject[item.user_subject_id!]?.find(p => p.period_id === periodId)?.categories ?? []).map(c => <option key={c.cat_id} value={c.cat_id}>{c.name}</option>)}
                        </select>
                      </>
                    )}
                  </div>
                )}

                {checked.has('event') && (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#8a94a6' }}>Event:</span>
                    <input placeholder="Title" value={eventDraft.title} onChange={e => setEventDraft(prev => ({ ...prev, title: e.target.value }))} className="cab2-select" style={selectStyle} />
                    <input placeholder="Location" value={eventDraft.location} onChange={e => setEventDraft(prev => ({ ...prev, location: e.target.value }))} className="cab2-select" style={selectStyle} />
                    <input type="datetime-local" value={eventDraft.starts_at} onChange={e => setEventDraft(prev => ({ ...prev, starts_at: e.target.value.replace('T', ' ') }))} className="cab2-select" style={selectStyle} />
                    <input type="datetime-local" value={eventDraft.ends_at} onChange={e => setEventDraft(prev => ({ ...prev, ends_at: e.target.value.replace('T', ' ') }))} className="cab2-select" style={selectStyle} />
                  </div>
                )}

                {checked.has('reminder') && (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#8a94a6' }}>Reminder:</span>
                    <input placeholder="Title" value={reminderDraft.title} onChange={e => setReminderDraft(prev => ({ ...prev, title: e.target.value }))} className="cab2-select" style={selectStyle} />
                    <input type="datetime-local" value={reminderDraft.remind_at} onChange={e => setReminderDraft(prev => ({ ...prev, remind_at: e.target.value.replace('T', ' ') }))} className="cab2-select" style={selectStyle} />
                  </div>
                )}

                {checked.has('schedule_change') && (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#8a94a6' }}>Schedule Change:</span>
                    <select value={scheduleDraft.block_id ?? ''} onChange={e => setScheduleDraft(prev => ({ ...prev, block_id: Number(e.target.value) }))} className="cab2-select" style={selectStyle}>
                      <option value="" disabled>Class meeting…</option>
                      {scheduleBlocks.map(b => (
                        <option key={b.block_id} value={b.block_id}>{b.course_code}{b.section ? ` (${b.section})` : ''} — {DAY_NAMES[b.day_of_week]}</option>
                      ))}
                    </select>
                    <input type="date" value={scheduleDraft.override_date} onChange={e => setScheduleDraft(prev => ({ ...prev, override_date: e.target.value }))} className="cab2-select" style={selectStyle} />
                    <select value={scheduleDraft.modality} onChange={e => setScheduleDraft(prev => ({ ...prev, modality: e.target.value as 'online' | 'cancelled' }))} className="cab2-select" style={selectStyle}>
                      <option value="online">Async / Online</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                )}

                <button disabled={busy === item.id || checked.size === 0} onClick={() => confirmInclude(item)} className="cab2-include"
                  style={{
                    ...pillBtn, color: 'white',
                    background: checked.size === 0 ? 'rgba(242,167,192,0.5)' : 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                    cursor: checked.size === 0 ? 'not-allowed' : 'pointer',
                  }}>
                  Add Selected
                </button>
              </div>
            )}
```

- [ ] **Step 2: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: no errors anywhere now (Task 8's earlier `CanvasAnnouncementBank.tsx` error is resolved by this rewrite).

- [ ] **Step 3: Verify in the browser**

No browser-automation tool available in this environment — verify manually:
1. `npm run dev`, sign in as the real account behind `user_id 6` (or use the locally-signed cookie in a browser dev-tools "Application → Cookies" entry for `localhost:3000`).
2. Navigate to `/studypulse/canvas`, find the announcement "Asynchronous Today (Friday - May 15)" — confirm its "Schedule Change" checkbox is pre-checked when Include is opened, and "Task"/"Event"/"Reminder" are not (unless its title also happens to match another keyword set).
3. Check "Event" too, fill in a title/start/end, and Confirm Include — confirm the request succeeds and the announcement now shows "Added".
4. Reload the page (or re-fetch) and confirm the same announcement can no longer be re-Included (button still visible per the `bank_status === 'ignored'` re-include allowance, but a fresh already-`included` one shows only the "Added" badge, matching existing behavior).
5. Clean up any real rows created during this manual pass (delete the created workboard_items/activities/schedule_overrides rows and reset `bank_status` back to `'pending'` via `mysql.exe`, as in Task 9's verification).

- [ ] **Step 4: Commit**

```bash
git add src/components/studypulse/CanvasAnnouncementBank.tsx
git commit -m "Rework Announcement Bank Include flow for multi-destination routing"
```

---

### Task 11: Workboard page + week view

**Files:**
- Create: `src/app/workboard/page.tsx`
- Create: `src/components/workboard/WorkboardWeekView.tsx`

**Interfaces:**
- Consumes: `GET /api/workboard/week` (Task 5) response shape (`WorkboardWeek` and its nested types from `@/lib/workboard/aggregate`, re-declared as local prop types in the client component since server and client components don't share TS types across the server/client boundary in this codebase's existing pattern — see `ScheduleMaker`'s own local `ClassBlock` interface duplicating the shape its server page fetches).

- [ ] **Step 1: Write the server page**

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ensureWorkboardSchema } from '@/lib/migrate';
import { getWorkboardWeek, mondayOf } from '@/lib/workboard/aggregate';
import WorkboardWeekView from '@/components/workboard/WorkboardWeekView';

export default async function WorkboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  await ensureWorkboardSchema();
  const userId = parseInt(session.user.id);
  const weekStart = mondayOf(new Date());
  const week = await getWorkboardWeek(userId, weekStart);

  return <WorkboardWeekView initialWeek={week} />;
}
```

- [ ] **Step 2: Write the client week view**

```tsx
'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Bell, CalendarClock } from 'lucide-react';

interface ClassOccurrence {
  block_id: number; user_subject_id: number | null; course_code: string; subject_name: string | null;
  section: string | null; date: string; start_time: string; end_time: string; venue: string | null;
  is_online: boolean; override: { modality: 'online' | 'cancelled' | null; note: string | null } | null;
}
interface DeadlineItem {
  source_table: string; entry_id: number; user_subject_id: number; subject_name: string | null;
  course_code: string | null; name: string; deadline: string;
}
interface WorkboardEventItem {
  id: number; user_subject_id: number | null; subject_name: string | null; item_type: 'event' | 'reminder';
  title: string; location: string | null; starts_at: string | null; ends_at: string | null;
  remind_at: string | null; note: string | null;
}
interface ConflictWarning { type: 'overlap' | 'deadline_cluster'; date: string; message: string; item_labels: string[] }
interface DayLoad { date: string; score: number; level: 'low' | 'medium' | 'high'; class_hours: number; deadline_count: number; event_count: number }
interface WorkboardWeek {
  week_start: string; class_occurrences: ClassOccurrence[]; deadlines: DeadlineItem[];
  events: WorkboardEventItem[]; reminders: WorkboardEventItem[]; conflicts: ConflictWarning[]; heatmap: DayLoad[];
}

const GLASS: React.CSSProperties = {
  background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  borderRadius: '22px', border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 8px 24px rgba(31,38,68,0.09)',
};
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GRID_START = 7 * 60;   // 7 AM
const GRID_END   = 21 * 60;  // 9 PM
const HOUR_HEIGHT = 48;
const LEVEL_COLOR: Record<DayLoad['level'], string> = { low: '#74bcd9', medium: '#f2a7c0', high: '#e0607c' };

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function addDaysLocal(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function courseColor(code: string): string {
  const palette = ['#74bcd9', '#f2a7c0', '#8b7fd6', '#4dabf5', '#f0a35c'];
  let h = 0; for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export default function WorkboardWeekView({ initialWeek }: { initialWeek: WorkboardWeek }) {
  const [week, setWeek] = useState<WorkboardWeek>(initialWeek);
  const [loading, setLoading] = useState(false);

  const dayDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysLocal(week.week_start, i)), [week.week_start]);

  const goToWeek = async (weekStart: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workboard/week?start=${weekStart}`);
      const data: WorkboardWeek = await res.json();
      setWeek(data);
    } finally {
      setLoading(false);
    }
  };

  const eventsByDay = (date: string) => week.events.filter(e => e.starts_at?.slice(0, 10) === date);
  const classesByDay = (date: string) => week.class_occurrences.filter(c => c.date === date);
  const deadlinesByDay = (date: string) => week.deadlines.filter(d => d.deadline === date);

  const gridHeight = ((GRID_END - GRID_START) / 60) * HOUR_HEIGHT;

  return (
    <div className="vb-bg min-h-screen pb-10" style={{ padding: '40px 5%', fontFamily: "'Inter','DM Sans','Segoe UI',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h1 className="gradient-text" style={{ fontSize: '2.2rem', fontWeight: 700, margin: 0 }}>Workboard</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => goToWeek(addDaysLocal(week.week_start, -7))} disabled={loading}
            style={{ ...GLASS, border: 'none', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ChevronLeft size={18} />
          </button>
          <span style={{ fontWeight: 700, color: '#5c6b80', fontSize: '0.9rem' }}>
            {week.week_start} – {dayDates[6]}
          </span>
          <button onClick={() => goToWeek(addDaysLocal(week.week_start, 7))} disabled={loading}
            style={{ ...GLASS, border: 'none', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {week.conflicts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px' }}>
          {week.conflicts.map((c, i) => (
            <div key={i} style={{ ...GLASS, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(224,96,124,0.12)' }}>
              <AlertTriangle size={16} color="#c0607c" />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#a0405a' }}>
                {c.type === 'overlap' ? 'Schedule Conflict' : 'Deadline Cluster'} — {c.message} ({c.date})
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', marginBottom: '18px' }}>
        {week.heatmap.map(h => (
          <div key={h.date} style={{ ...GLASS, padding: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#8a94a6', textTransform: 'uppercase' }}>{h.date.slice(5)}</div>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: LEVEL_COLOR[h.level], margin: '4px auto' }} />
            <div style={{ fontSize: '0.68rem', color: '#8a94a6' }}>{h.level}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
        <div style={{ ...GLASS, flex: '1 1 700px', padding: '14px', overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '46px repeat(7, 1fr)', minWidth: '860px' }}>
            <div />
            {dayDates.map((date, i) => (
              <div key={date} style={{ textAlign: 'center', paddingBottom: '8px', fontWeight: 800, fontSize: '0.72rem', color: '#5c6b80', textTransform: 'uppercase' }}>
                {DAY_LABELS[i]}
              </div>
            ))}

            <div style={{ position: 'relative', height: `${gridHeight}px` }}>
              {Array.from({ length: (GRID_END - GRID_START) / 60 + 1 }, (_, i) => GRID_START + i * 60).map(m => (
                <div key={m} style={{ position: 'absolute', top: `${((m - GRID_START) / 60) * HOUR_HEIGHT - 6}px`, right: '8px', fontSize: '0.62rem', color: '#9aa4b5' }}>
                  {m % 720 === 0 ? 12 : Math.floor(m / 60) % 12}{m < 720 ? 'a' : 'p'}
                </div>
              ))}
            </div>

            {dayDates.map(date => (
              <div key={date} style={{ position: 'relative', height: `${gridHeight}px`, borderLeft: '1px solid rgba(200,210,230,0.32)' }}>
                {classesByDay(date).map(c => {
                  const cancelled = c.override?.modality === 'cancelled';
                  const top = ((toMinutes(c.start_time) - GRID_START) / 60) * HOUR_HEIGHT;
                  const height = ((toMinutes(c.end_time) - toMinutes(c.start_time)) / 60) * HOUR_HEIGHT;
                  const color = courseColor(c.course_code);
                  return (
                    <div key={`c${c.block_id}`} title={c.override?.note ?? undefined} style={{
                      position: 'absolute', top: `${top + 1}px`, height: `${Math.max(height - 2, 24)}px`, left: '2px', right: '2px',
                      background: `${color}16`, border: `1.5px solid ${color}55`, borderLeft: `3px solid ${color}`,
                      borderRadius: '8px', padding: '3px 6px', opacity: cancelled ? 0.5 : 1,
                    }}>
                      <span style={{ fontSize: '0.66rem', fontWeight: 800, color, textDecoration: cancelled ? 'line-through' : 'none' }}>
                        {c.course_code}{c.override?.modality ? ` (${c.override.modality})` : ''}
                      </span>
                    </div>
                  );
                })}
                {eventsByDay(date).map(e => {
                  const top = ((toMinutes(e.starts_at!.slice(11, 16)) - GRID_START) / 60) * HOUR_HEIGHT;
                  const height = ((toMinutes(e.ends_at!.slice(11, 16)) - toMinutes(e.starts_at!.slice(11, 16))) / 60) * HOUR_HEIGHT;
                  return (
                    <div key={`e${e.id}`} style={{
                      position: 'absolute', top: `${top + 1}px`, height: `${Math.max(height - 2, 24)}px`, left: '2px', right: '2px',
                      background: 'rgba(242,167,192,0.18)', border: '1.5px dashed #f2a7c099', borderLeft: '3px solid #f2a7c0',
                      borderRadius: '8px', padding: '3px 6px',
                    }}>
                      <span style={{ fontSize: '0.66rem', fontWeight: 800, color: '#a0507a' }}>{e.title}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '46px repeat(7, 1fr)', marginTop: '10px', borderTop: '1px solid rgba(200,210,230,0.32)', paddingTop: '8px', minWidth: '860px' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#8a94a6', display: 'flex', alignItems: 'center' }}>
              <CalendarClock size={13} />
            </div>
            {dayDates.map(date => (
              <div key={date} style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '4px' }}>
                {deadlinesByDay(date).map(d => (
                  <div key={`${d.source_table}-${d.entry_id}`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#e0607c', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.66rem', color: '#5c6b80', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...GLASS, flex: '0 0 240px', padding: '14px' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px', color: '#2d3748' }}>
            <Bell size={16} color="#74bcd9" /> Reminders
          </h3>
          {week.reminders.length === 0 && <p style={{ fontSize: '0.8rem', color: '#8a94a6', margin: 0 }}>No reminders.</p>}
          {week.reminders.map(r => (
            <div key={r.id} style={{ fontSize: '0.8rem', color: '#5c6b80', marginBottom: '8px' }}>
              {r.title}{r.remind_at ? ` — ${r.remind_at.slice(0, 10)}` : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Verify in the browser**

No browser-automation tool available — verify manually with the dev server running, signed in as the account behind `user_id 6`:
1. Navigate to `/workboard` — confirm the three CS0001 class blocks render on the correct days/times, the heatmap shows 7 dots, and no conflict banner appears (no overlapping data exists yet).
2. Using the `user_id 6` curl recipe from Task 6, create an event that overlaps one of the CS0001 blocks, then reload `/workboard` — confirm the "Schedule Conflict" banner appears and both blocks render in that day's column.
3. Create a schedule override (Task 7's recipe) marking one CS0001 occurrence `cancelled` for the current week, reload, and confirm that block renders struck-through/dimmed instead of normal.
4. Click prev/next week — confirm the URL's underlying fetch (`/api/workboard/week?start=...`) updates the view without a full page reload.
5. Clean up all test rows created during this pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/workboard/page.tsx src/components/workboard/WorkboardWeekView.tsx
git commit -m "Add Workboard page and weekly view"
```

---

### Task 12: Dashboard tile

**Files:**
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- None new — purely additive UI.

- [ ] **Step 1: Add the Workboard tile**

The existing `MODULES` array drives image-based tiles (`Image` component per entry). Since Workboard has no commissioned artwork yet (spec's explicit v1 call), give it an icon-based tile instead: add a `kind: 'icon'` variant alongside the existing image entries rather than forcing a fake image path.

Change the `MODULES` array and its rendering:

```tsx
import { LayoutDashboard } from 'lucide-react';

const MODULES = [
  { href: '/studypulse',  kind: 'image' as const, src: '/studypulse.png',     alt: 'Study Pulse'     },
  { href: '/finance',     kind: 'image' as const, src: '/financetracker.png', alt: 'Finance Tracker' },
  { href: '/habits',      kind: 'image' as const, src: '/habittracker.png',   alt: 'Habit Tracker'   },
  { href: '/workboard',   kind: 'icon'  as const, alt: 'Workboard' },
];
```

In the `MODULES.map(...)` block, branch the inner tile content on `kind`, keeping the outer `Link`/card wrapper identical for every entry:

```tsx
        {MODULES.map((mod) => (
          <Link key={mod.href} href={mod.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div
              className="hover:-translate-y-2.5 transition-all duration-300 shadow-[0_8px_20px_rgba(0,0,0,0.15)] hover:shadow-[0_15px_35px_rgba(0,0,0,0.25)] w-full lg:w-[400px] lg:h-[300px] lg:flex-shrink-0"
              style={{
                background:          'rgba(255,255,255,0.2)',
                backdropFilter:      'blur(12px)',
                WebkitBackdropFilter:'blur(12px)',
                borderRadius:        '20px',
                padding:             '20px',
                cursor:              'pointer',
              }}
            >
              <div
                className="relative w-full overflow-hidden rounded-[14px] aspect-video lg:aspect-auto lg:h-[220px]"
                style={{ marginBottom: '10px' }}
              >
                {mod.kind === 'image' ? (
                  <Image
                    src={mod.src}
                    alt={mod.alt}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
                    className="object-cover"
                    style={{ borderRadius: '14px' }}
                    unoptimized
                  />
                ) : (
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: '14px',
                    background: 'linear-gradient(135deg, #f2a7c0, #74bcd9)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <LayoutDashboard size={64} color="rgba(255,255,255,0.9)" strokeWidth={1.5} />
                  </div>
                )}
              </div>
              <p style={{ textAlign: 'center', fontWeight: 700, color: '#333', margin: 0 }}>{mod.alt}</p>
            </div>
          </Link>
        ))}
```

Note: the existing three tiles never rendered a text label under the image (the PNG art carries the name) — the `<p>{mod.alt}</p>` line is new, needed only because the icon tile has no name baked into it. Adding it to every tile keeps all four visually consistent rather than only the new one having a caption. If this reads as a bigger visual change than "add a tile" should be, drop the `<p>` from the three image tiles and instead overlay `mod.alt` as text on top of the icon-only tile's gradient — but the shared-caption approach above is simpler and keeps all four tiles structurally identical.

- [ ] **Step 2: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Verify in the browser**

`npm run dev`, sign in, load `/dashboard` — confirm four tiles render (three with existing artwork + captions, one with the pink-to-blue gradient + `LayoutDashboard` icon + "Workboard" caption), and clicking the new tile navigates to `/workboard`.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "Add Workboard dashboard tile"
```

---

## Self-Review

**Spec coverage:**
- Data model (two tables + `canvas_announcement_links` extension) → Task 1. ✓
- Live aggregation, no unified table → Tasks 3–4. ✓
- API surface (`week`, `items`, `schedule-overrides`) → Tasks 5–7. ✓
- Announcement destination suggestion + multi-destination include → Tasks 8–9. ✓
- Include modal rework → Task 10. ✓
- Workboard page (grid, deadline strip, conflict banners, heatmap, reminders sidebar) → Task 11. ✓
- Dashboard tile → Task 12. ✓
- Non-goals (AI advisor rewiring, effort estimation, submission-closes-loop, Finance/Habits integration) → deliberately untouched by every task above; no task references `target-analysis`, effort fields, or Finance/Habits tables. ✓

**Placeholder scan:** no TBD/TODO markers; every step has runnable code or a concrete verification command.

**Type consistency:** `WorkboardWeek`/`ClassOccurrence`/`DeadlineItem`/`WorkboardEventItem`/`ConflictWarning`/`DayLoad` are defined once in Task 3 and reused verbatim (field names and types) through Tasks 4, 5, and re-declared identically as client-side prop types in Task 11 (the existing codebase pattern for server/client type sharing, per `ScheduleMaker`). `WorkboardItemInput`/`ScheduleOverrideInput` (Task 2, camelCase internal contracts) are consumed with matching field names in Task 6 and Task 9. `WorkboardDestination` (Task 8) is consumed identically in Tasks 9 and 10.

**Adjustment made during planning:** the spec's heatmap section says "6 entries, Mon..Sat"; this plan uses 7 (Mon–Sun) throughout, recorded in Global Constraints, because deadlines aren't restricted to school days and a 6-day window would silently drop Sunday deadline clusters.
