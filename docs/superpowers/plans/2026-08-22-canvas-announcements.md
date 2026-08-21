# Canvas Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync Canvas course announcements alongside the existing assignment sync, suggest a category for each one (matched against the subject's *actual* grading configuration), and let the student convert relevant announcements into real tasks — or leave them as plain, readable announcements — via a persistent Announcement Bank separate from the existing Activity Bank.

**Architecture:** Extends the existing Canvas sync engine (`src/lib/canvas/sync.ts`) with a second, simpler fetch-and-upsert path for announcements (no submission-state diffing, no change-propagation — announcements are captured once, not kept live). A new pure classification module (`classify.ts`) suggests a category at *read time*, not sync time, so it always reflects the subject's current grading config. A new bank table + link table (mirroring `canvas_activity_bank`/`canvas_entry_links`) back a new API surface and a new `CanvasAnnouncementBank` UI component that reuses the exact Include-flow pattern (and the period/category picker) already built for the Activity Bank this session.

**Tech Stack:** Next.js 15 (App Router) + TypeScript, `mysql2/promise` raw SQL, `next-auth` v5, native `fetch` for the Canvas API — same stack as the rest of Canvas Sync, no new dependencies.

**Spec:** [docs/superpowers/specs/2026-08-21-canvas-announcements-design.md](../specs/2026-08-21-canvas-announcements-design.md) — read this first; this plan implements it task-by-task and does not repeat its rationale.

## Global Constraints

- `CANVAS_TOKEN_ENC_KEY` is already set in `.env.local` (added this session, fixing a prior sync failure) — no new env var needed for this feature.
- No test framework is installed, and none should be added. Pure functions (`normalize.ts`'s `normalizeAnnouncement`, `classify.ts`'s `suggestLegacyCategory`/`suggestCustomCategory`) get real `node:assert` verification scripts run via `npx tsx <script>.ts` (genuine red/green — confirmed working in this environment; use an **absolute** import path in the script, e.g. `c:/xampp/htdocs/VibeBoard/src/lib/canvas/normalize`, since `tsx` does not resolve this project's `@/*` alias from a script outside `src/`). DB-touching code is verified with direct SQL (`"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "..."` — confirmed present in this environment) and, for the full sync→API→UI path, a real browser driven by Playwright against seeded fixtures (the exact method already proven this session for the Activity Bank's period/category picker — see Task 8).
- Reuse `insertActivityEntry`/`insertQuizEntry`/`insertExamEntry`/`insertGradeEntry` from `src/lib/studypulseEntries.ts` for creating entries — do not duplicate their SQL. `deadline` is always a `YYYY-MM-DD` string (matches the existing convention, e.g. `fresh.dueAt.slice(0, 10)` in `sync.ts`).
- Every new API route starts with the same auth check already used throughout: `const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });`.
- Unlike `GET /api/canvas/bank` (which defaults to `status=pending`), `GET /api/canvas/announcements` has **no status filter** — it always returns every announcement in scope (the persistent-feed decision from the spec). Filtering by status is a client-side concern in the UI.
- This repo **is** a git repository (unlike when the original Canvas Sync plan was written) — each task ends with a normal `git add` + `git commit`, following the Task Structure template exactly.
- All new visual components follow the glass/pill design language established this session (`GLASS` token: `background: rgba(255,255,255,0.4)`, `backdropFilter: blur(14px)`, `border: 1px solid rgba(255,255,255,0.4)`, `boxShadow: 0 8px 24px rgba(31,38,68,0.09)`, `borderRadius: 22px`; pill buttons: `borderRadius: 999px`; action rows always separate from wrapping content, per this session's button-placement-consistency fix) — copy `CanvasActivityBank.tsx`'s patterns, don't invent new ones.

---

## File Structure

**New files:**
- `src/lib/canvas/classify.ts` — `suggestLegacyCategory()`, `suggestCustomCategory()`, `stripHtml()`, `classificationText()`
- `src/app/api/canvas/announcements/route.ts` — GET
- `src/app/api/canvas/announcements/[id]/include/route.ts` — POST
- `src/app/api/canvas/announcements/[id]/ignore/route.ts` — POST
- `src/components/studypulse/CanvasAnnouncementBank.tsx`

**Modified files:**
- `src/lib/migrate.ts` — `ensureCanvasSchema()` gains two more `CREATE TABLE IF NOT EXISTS` statements
- `src/lib/canvas/normalize.ts` — add `NormalizedAnnouncement`, `normalizeAnnouncement()`
- `src/lib/canvas/sync.ts` — add `syncCourseAnnouncements()`, `upsertAnnouncement()`, `sweepRemovedAnnouncements()`; wire into `syncConnection()`'s per-course loop
- `src/app/studypulse/canvas/CanvasClientShell.tsx` — fetch announcements, render `CanvasAnnouncementBank`
- `src/components/studypulse/SubjectCardView.tsx` — second subject-page button, "📢 Announcements"

---

### Task 1: Database Schema

**Files:**
- Modify: `src/lib/migrate.ts`

**Interfaces:**
- Produces: two new tables inside the existing `ensureCanvasSchema()` — `canvas_announcement_bank`, `canvas_announcement_links`. No new exported function; `ensureCanvasSchema(): Promise<void>` already exists and is already called everywhere Canvas tables are needed.

- [ ] **Step 1: Confirm the tables don't exist yet**

Run:
```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SHOW TABLES LIKE 'canvas_announcement%';"
```
Expected: empty result set.

- [ ] **Step 2: Add the two tables to `ensureCanvasSchema()`**

In `src/lib/migrate.ts`, find the `canvas_sync_runs` table creation block (the last one inside `ensureCanvasSchema()`, right before `_ranCanvas = true;`) and insert these two new blocks immediately after it (still before `_ranCanvas = true;`):

```ts
  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_announcement_bank (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      connection_id            INT NOT NULL,
      course_id                INT NOT NULL,
      canvas_announcement_id   BIGINT NOT NULL,
      title                    VARCHAR(255) NOT NULL,
      message                  TEXT NULL,
      html_url                 VARCHAR(500) NULL,
      posted_at                DATETIME NULL,
      canvas_updated_at        DATETIME NOT NULL,
      bank_status              ENUM('pending','included','ignored','removed_upstream') NOT NULL DEFAULT 'pending',
      first_seen_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_synced_at           DATETIME NOT NULL,
      last_seen_sync_run_id    INT NULL,
      UNIQUE KEY uniq_conn_announcement (connection_id, canvas_announcement_id),
      FOREIGN KEY (connection_id) REFERENCES canvas_connections(id) ON DELETE CASCADE,
      FOREIGN KEY (course_id) REFERENCES canvas_courses(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_announcement_links (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      announcement_id  INT NOT NULL,
      activity_id      INT NULL,
      quiz_id          INT NULL,
      exam_id          INT NULL,
      grade_entry_id   INT NULL,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_announcement (announcement_id),
      FOREIGN KEY (announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE CASCADE,
      FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
      FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
      CHECK (
        (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
        (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
      )
    )
  `);
```

- [ ] **Step 3: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Verify the SQL directly, then drop it so the app creates it fresh later**

`ensureCanvasSchema()` only runs *after* the auth check in every route that calls it (e.g. `src/app/studypulse/canvas/page.tsx` checks the session and redirects unauthenticated requests before ever reaching `ensureCanvasSchema()`), so an unauthenticated `curl` won't trigger it — there's no session yet at this point in the plan (Playwright login isn't set up until Task 8). Instead, verify the two `CREATE TABLE` statements are valid SQL directly, matching the same approach the original Canvas Sync plan used for its own six tables:

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "
CREATE TABLE IF NOT EXISTS canvas_announcement_bank (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  connection_id            INT NOT NULL,
  course_id                INT NOT NULL,
  canvas_announcement_id   BIGINT NOT NULL,
  title                    VARCHAR(255) NOT NULL,
  message                  TEXT NULL,
  html_url                 VARCHAR(500) NULL,
  posted_at                DATETIME NULL,
  canvas_updated_at        DATETIME NOT NULL,
  bank_status              ENUM('pending','included','ignored','removed_upstream') NOT NULL DEFAULT 'pending',
  first_seen_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_synced_at           DATETIME NOT NULL,
  last_seen_sync_run_id    INT NULL,
  UNIQUE KEY uniq_conn_announcement (connection_id, canvas_announcement_id),
  FOREIGN KEY (connection_id) REFERENCES canvas_connections(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES canvas_courses(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS canvas_announcement_links (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  announcement_id  INT NOT NULL,
  activity_id      INT NULL,
  quiz_id          INT NULL,
  exam_id          INT NULL,
  grade_entry_id   INT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_announcement (announcement_id),
  FOREIGN KEY (announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
  FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
  FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
  CHECK (
    (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
    (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
  )
);
"
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SHOW TABLES LIKE 'canvas_announcement%'; SHOW CREATE TABLE canvas_announcement_links\G"
```
Expected: no errors; `SHOW TABLES` lists both new tables; `SHOW CREATE TABLE canvas_announcement_links`'s output includes the `CONSTRAINT ... CHECK` clause.

Then drop them again so `ensureCanvasSchema()` creates them fresh the first time the running app actually calls it (Task 8, through a real authenticated session):

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SET FOREIGN_KEY_CHECKS=0; DROP TABLE IF EXISTS canvas_announcement_links, canvas_announcement_bank; SET FOREIGN_KEY_CHECKS=1;"
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/migrate.ts
git commit -m "Add canvas_announcement_bank and canvas_announcement_links tables"
```

- [ ] **Checkpoint:** both tables exist with correct constraints. Move to Task 2.

---

### Task 2: Announcement Normalizer

**Files:**
- Modify: `src/lib/canvas/normalize.ts`

**Interfaces:**
- Produces: `interface NormalizedAnnouncement { canvasAnnouncementId: number; title: string; message: string | null; htmlUrl: string | null; postedAt: string | null; canvasUpdatedAt: string; }`, `normalizeAnnouncement(raw: RawAnnouncement): NormalizedAnnouncement`, both exported from `src/lib/canvas/normalize.ts`.
- Consumes: `toMysqlUtc()` (already in the same file).

- [ ] **Step 1: Write the failing verification script**

```bash
mkdir -p /tmp/vb-verify
cat > /tmp/vb-verify/normalize-announcement.ts <<'EOF'
import assert from 'node:assert';
import { normalizeAnnouncement } from 'c:/xampp/htdocs/VibeBoard/src/lib/canvas/normalize';

// Full shape: title/message/html_url/posted_at/updated_at all present.
const full = normalizeAnnouncement({
  id: 501,
  title: 'Quiz 2 moved to Friday',
  message: '<p>Please note the quiz has moved.</p>',
  html_url: 'https://school.instructure.com/courses/1/discussion_topics/501',
  posted_at: '2026-08-20T10:00:00Z',
  updated_at: '2026-08-20T11:30:00Z',
});
assert.strictEqual(full.canvasAnnouncementId, 501);
assert.strictEqual(full.title, 'Quiz 2 moved to Friday');
assert.strictEqual(full.message, '<p>Please note the quiz has moved.</p>');
assert.strictEqual(full.htmlUrl, 'https://school.instructure.com/courses/1/discussion_topics/501');
assert.strictEqual(full.postedAt, '2026-08-20 10:00:00');
assert.strictEqual(full.canvasUpdatedAt, '2026-08-20 11:30:00');

// Missing updated_at falls back to posted_at, not null (canvas_updated_at is NOT NULL).
const noUpdated = normalizeAnnouncement({
  id: 502, title: 'Welcome', message: null, posted_at: '2026-08-19T09:00:00Z',
});
assert.strictEqual(noUpdated.canvasUpdatedAt, '2026-08-19 09:00:00');
assert.strictEqual(noUpdated.message, null);
assert.strictEqual(noUpdated.htmlUrl, null);

console.log('OK: normalizeAnnouncement');
EOF
npx --yes tsx /tmp/vb-verify/normalize-announcement.ts
```
Expected: FAILS — `normalizeAnnouncement` does not exist yet (`SyntaxError` or `does not provide an export named 'normalizeAnnouncement'`).

- [ ] **Step 2: Add the type and function**

In `src/lib/canvas/normalize.ts`, append after `normalizeAssignment`:

```ts
export interface NormalizedAnnouncement {
  canvasAnnouncementId: number;
  title:                string;
  message:              string | null;
  htmlUrl:              string | null;
  postedAt:             string | null;
  canvasUpdatedAt:      string;
}

interface RawAnnouncement {
  id: number;
  title: string;
  message?: string | null;
  html_url?: string;
  posted_at?: string | null;
  updated_at?: string | null;
}

/**
 * Canvas discussion topics (announcements are discussion topics with only_announcements=true)
 * don't reliably echo updated_at, so posted_at is the fallback — canvas_updated_at is NOT NULL
 * in the schema and must always get a real value.
 */
export function normalizeAnnouncement(raw: RawAnnouncement): NormalizedAnnouncement {
  return {
    canvasAnnouncementId: raw.id,
    title:           raw.title,
    message:         raw.message ?? null,
    htmlUrl:         raw.html_url ?? null,
    postedAt:        toMysqlUtc(raw.posted_at),
    canvasUpdatedAt: toMysqlUtc(raw.updated_at ?? raw.posted_at)
      ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
}
```

- [ ] **Step 3: Run the verification script again**

Run: `npx --yes tsx /tmp/vb-verify/normalize-announcement.ts`
Expected: prints `OK: normalizeAnnouncement`.

- [ ] **Step 4: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/normalize.ts
git commit -m "Add normalizeAnnouncement() for Canvas discussion-topic announcements"
```

- [ ] **Checkpoint:** `normalizeAnnouncement` verified correct in isolation. Move to Task 3.

---

### Task 3: Classification Module

**Files:**
- Create: `src/lib/canvas/classify.ts`

**Interfaces:**
- Produces: `stripHtml(html: string | null): string`, `classificationText(title: string, message: string | null): string`, `suggestLegacyCategory(text: string): 'activities' | 'quizzes' | 'exams' | 'general'`, `suggestCustomCategory(text: string, categoryNames: string[]): string | null` (all exported from `src/lib/canvas/classify.ts`).

- [ ] **Step 1: Write the failing verification script**

```bash
cat > /tmp/vb-verify/classify.ts <<'EOF'
import assert from 'node:assert';
import {
  stripHtml, classificationText, suggestLegacyCategory, suggestCustomCategory,
} from 'c:/xampp/htdocs/VibeBoard/src/lib/canvas/classify';

// stripHtml
assert.strictEqual(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
assert.strictEqual(stripHtml(null), '');

// classificationText
assert.strictEqual(
  classificationText('Quiz moved', '<p>See you Friday</p>'),
  'Quiz moved See you Friday',
);

// suggestLegacyCategory — each bucket
assert.strictEqual(suggestLegacyCategory('Reminder: Quiz 2 this Friday'), 'quizzes');
assert.strictEqual(suggestLegacyCategory('FINAL EXAM schedule posted'), 'exams');
assert.strictEqual(suggestLegacyCategory('Submit your project by Sunday'), 'activities');
assert.strictEqual(suggestLegacyCategory('Welcome to the course!'), 'general');
// exam beats quiz when both appear
assert.strictEqual(suggestLegacyCategory('The final exam will cover all quiz material'), 'exams');
// case-insensitive
assert.strictEqual(suggestLegacyCategory('QUIZ 3 IS DUE'), 'quizzes');

// suggestCustomCategory — matches an actual configured category name
assert.strictEqual(
  suggestCustomCategory('Please submit your Requirements packet', ['Quizzes', 'Requirements', 'Documentation']),
  'Requirements',
);
assert.strictEqual(
  suggestCustomCategory('No idea what this is about', ['Quizzes', 'Requirements']),
  null,
);
assert.strictEqual(
  suggestCustomCategory('reminder about quizzes next week', ['Quizzes', 'Requirements']),
  'Quizzes',
);

console.log('OK: classify');
EOF
npx --yes tsx /tmp/vb-verify/classify.ts
```
Expected: FAILS — the module doesn't exist yet.

- [ ] **Step 2: Create `src/lib/canvas/classify.ts`**

```ts
const EXAM_KEYWORDS = ['exam', 'exams', 'final exam', 'finals', 'midterm exam', 'midterms'];
const QUIZ_KEYWORDS = ['quiz', 'quizzes'];
const ACTIVITY_KEYWORDS = [
  'due', 'deadline', 'submit', 'submission', 'assignment', 'assignments',
  'project', 'requirement', 'requirements', 'output', 'task',
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some(n => haystack.includes(n));
}

/** Strips HTML tags for keyword matching — not a sanitizer, output is never rendered as HTML. */
export function stripHtml(html: string | null): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function classificationText(title: string, message: string | null): string {
  return `${title} ${stripHtml(message)}`.trim();
}

/**
 * Legacy-mode subjects (Activity/Quiz/Exam) are a fixed, built-in taxonomy, so a fixed keyword
 * rule set applies. Checked in this order — exam beats quiz beats activity — since the more
 * specific/urgent category should win when an announcement mentions more than one.
 */
export function suggestLegacyCategory(text: string): 'activities' | 'quizzes' | 'exams' | 'general' {
  const lower = text.toLowerCase();
  if (includesAny(lower, EXAM_KEYWORDS)) return 'exams';
  if (includesAny(lower, QUIZ_KEYWORDS)) return 'quizzes';
  if (includesAny(lower, ACTIVITY_KEYWORDS)) return 'activities';
  return 'general';
}

/**
 * Custom-mode subjects have their own grading categories (e.g. "Requirements",
 * "Documentation") — there's no fixed vocabulary that could apply to every subject, so the
 * category names themselves ARE the keywords. `categoryNames` should already be ordered the
 * way the grading config UI lists them (period, then sort_order) so ties resolve predictably.
 */
export function suggestCustomCategory(text: string, categoryNames: string[]): string | null {
  const lower = text.toLowerCase();
  for (const name of categoryNames) {
    if (name && lower.includes(name.toLowerCase())) return name;
  }
  return null;
}
```

- [ ] **Step 3: Run the verification script again**

Run: `npx --yes tsx /tmp/vb-verify/classify.ts`
Expected: prints `OK: classify`.

- [ ] **Step 4: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/classify.ts
git commit -m "Add keyword-based announcement classification"
```

- [ ] **Checkpoint:** classification verified correct in isolation for both legacy and custom-mode branches. Move to Task 4.

---

### Task 4: Sync Engine

**Files:**
- Modify: `src/lib/canvas/sync.ts`

**Interfaces:**
- Consumes: `canvasGetAll()` (`src/lib/canvas/client.ts`), `normalizeAnnouncement()` (Task 2), `CanvasConnectionRow` (`src/lib/canvas/credentials.ts`), `CanvasCourseRow` (already exported from this file).
- Produces: `syncCourseAnnouncements(connection: CanvasConnectionRow, course: CanvasCourseRow, runId: number): Promise<{ fetched: number }>`, exported. `upsertAnnouncement` and `sweepRemovedAnnouncements` stay module-private (not exported — mirrors `upsertAssignment`, which is also private).

This task is verified statically (compile + structural review) rather than behaviorally — there's no live Canvas account in this dev environment, and this project's convention (established in the original Canvas Sync plan) is to defer network+DB behavioral proof to the point where a real end-to-end path exists. That happens in **Task 8**, which stands up a local stub Canvas server and drives a real "Sync Now" click through the browser — proving this task's code actually works, together with Tasks 5-7.

- [ ] **Step 1: Add the announcement sync functions**

In `src/lib/canvas/sync.ts`, add this import at the top (next to the existing `normalizeAssignment` import line):

```ts
import { normalizeAnnouncement, type NormalizedAnnouncement } from './normalize';
```

Then add these three functions right after `sweepRemovedAssignments` (before the `SyncError`/`SyncResult` section — exact placement doesn't matter functionally, but keep sync-engine functions grouped together):

```ts
async function upsertAnnouncement(
  connection: CanvasConnectionRow, courseRowId: number, runId: number, a: NormalizedAnnouncement,
): Promise<void> {
  // Unlike upsertAssignment, announcements don't need change detection or event logging —
  // they aren't graded, live Canvas data the way assignments are (see spec's non-goals).
  // ON DUPLICATE KEY UPDATE covers "insert if new, otherwise refresh" in one round trip.
  await pool.execute(
    `INSERT INTO canvas_announcement_bank
       (connection_id, course_id, canvas_announcement_id, title, message, html_url, posted_at,
        canvas_updated_at, last_synced_at, last_seen_sync_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), message = VALUES(message), html_url = VALUES(html_url),
       posted_at = VALUES(posted_at), canvas_updated_at = VALUES(canvas_updated_at),
       last_synced_at = NOW(), last_seen_sync_run_id = VALUES(last_seen_sync_run_id)`,
    [
      connection.id, courseRowId, a.canvasAnnouncementId, a.title, a.message, a.htmlUrl,
      a.postedAt, a.canvasUpdatedAt, runId,
    ],
  );
}

async function syncCourseAnnouncements(
  connection: CanvasConnectionRow, course: CanvasCourseRow, runId: number,
): Promise<{ fetched: number }> {
  const raw = await canvasGetAll(connection, `/courses/${course.canvas_course_id}/discussion_topics`, {
    'only_announcements': 'true',
  });

  for (const rawAnnouncement of raw) {
    const a = normalizeAnnouncement(rawAnnouncement as never);
    await upsertAnnouncement(connection, course.id, runId, a);
  }

  return { fetched: raw.length };
}

export { syncCourseAnnouncements };

async function sweepRemovedAnnouncements(courseRowId: number, runId: number): Promise<void> {
  await pool.execute(
    `UPDATE canvas_announcement_bank SET bank_status = 'removed_upstream'
      WHERE course_id = ? AND last_seen_sync_run_id != ? AND bank_status != 'removed_upstream'`,
    [courseRowId, runId],
  );
}
```

- [ ] **Step 2: Wire both calls into `syncConnection()`'s per-course loop**

Find this block inside `syncConnection()`:

```ts
  const mappedCourses = await getMappedCourses(connectionId);
  for (const course of mappedCourses) {
    try {
      const result = await syncCourseAssignments(connection, course, runId);
      itemsFetched += result.fetched;
      itemsChanged += result.changed;
      await sweepRemovedAssignments(course.id, runId);
      coursesSynced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ stage: 'syncCourseAssignments', canvas_course_id: course.canvas_course_id, message, retryable: true });
    }
  }
```

Replace it with:

```ts
  const mappedCourses = await getMappedCourses(connectionId);
  for (const course of mappedCourses) {
    try {
      const result = await syncCourseAssignments(connection, course, runId);
      itemsFetched += result.fetched;
      itemsChanged += result.changed;
      await sweepRemovedAssignments(course.id, runId);

      const announcementResult = await syncCourseAnnouncements(connection, course, runId);
      itemsFetched += announcementResult.fetched;
      await sweepRemovedAnnouncements(course.id, runId);

      coursesSynced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ stage: 'syncCourseAssignments', canvas_course_id: course.canvas_course_id, message, retryable: true });
    }
  }
```

(A failure in either the assignment or announcement fetch for a course aborts that course's sync for this run — same granularity the assignment path already has; no need for finer isolation.)

- [ ] **Step 3: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Structural review checklist**

Confirm by reading the file:
- `syncCourseAnnouncements` is exported.
- `syncConnection()`'s per-course loop calls both `syncCourseAnnouncements` and `sweepRemovedAnnouncements`.
- `upsertAnnouncement` and `sweepRemovedAnnouncements` are NOT exported (module-private, matching `upsertAssignment`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/sync.ts
git commit -m "Wire Canvas announcement sync into the sync engine"
```

- [ ] **Checkpoint:** compiles and is structurally wired correctly. Behavioral proof deferred to Task 8. Move to Task 5.

---

### Task 5: GET /api/canvas/announcements

**Files:**
- Create: `src/app/api/canvas/announcements/route.ts`

**Interfaces:**
- Consumes: `suggestLegacyCategory`, `suggestCustomCategory`, `classificationText` (Task 3).
- Produces: `GET` handler returning `{ items: AnnouncementRow[] }`, where each row has all `canvas_announcement_bank` columns plus `course_name`, `user_subject_id`, `subject_mode: 'legacy' | 'custom'`, and `suggested_category: { kind: 'legacy'; target: 'activities' | 'quizzes' | 'exams' } | { kind: 'custom'; categoryName: string } | { kind: 'general' }`.

- [ ] **Step 1: Create the route**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { suggestLegacyCategory, suggestCustomCategory, classificationText } from '@/lib/canvas/classify';

type SuggestedCategory =
  | { kind: 'legacy'; target: 'activities' | 'quizzes' | 'exams' }
  | { kind: 'custom'; categoryName: string }
  | { kind: 'general' };

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const userSubjectIdParam = req.nextUrl.searchParams.get('user_subject_id');
  const userSubjectId = userSubjectIdParam !== null ? parseInt(userSubjectIdParam) : null;

  // Same grading-mode join (and same graceful fallback if the grading tables don't exist)
  // as GET /api/canvas/bank. No status filter here — the Announcement Bank is a persistent
  // feed, so every status is always returned; filtering is a client-side UI concern.
  const SELECT_WITH_MODE = `
    SELECT bank.*, cc.name AS course_name, cc.user_subject_id,
           CASE WHEN gp.preset_id IS NOT NULL THEN 'custom' ELSE 'legacy' END AS subject_mode
     FROM canvas_announcement_bank bank
     JOIN canvas_courses cc ON cc.id = bank.course_id
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     LEFT JOIN subject_grading sg ON sg.user_subject_id = cc.user_subject_id
     LEFT JOIN grading_presets gp ON gp.preset_id = sg.preset_id
     WHERE conn.user_id = ?${userSubjectId !== null ? ' AND cc.user_subject_id = ?' : ''}
     ORDER BY bank.posted_at IS NULL, bank.posted_at DESC`;

  const SELECT_LEGACY_ONLY = `
    SELECT bank.*, cc.name AS course_name, cc.user_subject_id, 'legacy' AS subject_mode
     FROM canvas_announcement_bank bank
     JOIN canvas_courses cc ON cc.id = bank.course_id
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     WHERE conn.user_id = ?${userSubjectId !== null ? ' AND cc.user_subject_id = ?' : ''}
     ORDER BY bank.posted_at IS NULL, bank.posted_at DESC`;

  const params = userSubjectId !== null ? [userId, userSubjectId] : [userId];

  let rows: RowDataPacket[];
  try {
    [rows] = await pool.execute<RowDataPacket[]>(SELECT_WITH_MODE, params);
  } catch (err) {
    console.error('Canvas announcements: grading-mode join failed, falling back to legacy mode:', err);
    [rows] = await pool.execute<RowDataPacket[]>(SELECT_LEGACY_ONLY, params);
  }

  // Fetch each distinct custom-mode subject's category names once (not per row) to avoid N+1.
  const customSubjectIds = [...new Set(
    rows
      .filter(r => r.subject_mode === 'custom' && r.user_subject_id)
      .map(r => r.user_subject_id as number),
  )];
  const categoriesBySubject = new Map<number, string[]>();
  for (const sid of customSubjectIds) {
    const [cats] = await pool.execute<RowDataPacket[]>(
      `SELECT gc.name FROM grading_categories gc
       JOIN grading_periods gp ON gp.period_id = gc.period_id
       JOIN subject_grading sg ON sg.preset_id = gp.preset_id
       WHERE sg.user_subject_id = ?
       ORDER BY gp.period_id, gc.sort_order`,
      [sid],
    );
    categoriesBySubject.set(sid, cats.map(c => c.name as string));
  }

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
    return { ...row, suggested_category: suggested };
  });

  return Response.json({ items });
}
```

- [ ] **Step 2: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify the route mounts (unauthenticated check)**

```bash
curl -s http://localhost:3000/api/canvas/announcements
```
Expected: `{"error":"Unauthorized"}` (proves the route compiles, mounts, and the auth guard runs — full authenticated behavior is verified in Task 8 through a real browser session).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/canvas/announcements/route.ts
git commit -m "Add GET /api/canvas/announcements with live category suggestions"
```

- [ ] **Checkpoint:** route compiles and mounts. Move to Task 6.

---

### Task 6: Include + Ignore routes

**Files:**
- Create: `src/app/api/canvas/announcements/[id]/include/route.ts`
- Create: `src/app/api/canvas/announcements/[id]/ignore/route.ts`

**Interfaces:**
- Consumes: `insertActivityEntry`, `insertQuizEntry`, `insertExamEntry`, `insertGradeEntry` (`src/lib/studypulseEntries.ts`).
- Produces: `POST /api/canvas/announcements/[id]/include` — body `{ target_type: 'activities'|'quizzes'|'exams'|'grade_entries', cat_id?: number, period_id?: number, deadline: string }`, response `{ status: 'success', entry_id: number }` or `{ error: string }`. `POST /api/canvas/announcements/[id]/ignore` — no body, response `{ status: 'success' }` or `{ error: string }`.

- [ ] **Step 1: Create the Include route**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import {
  insertActivityEntry, insertQuizEntry, insertExamEntry, insertGradeEntry,
} from '@/lib/studypulseEntries';

interface AnnouncementRow extends RowDataPacket {
  id: number;
  title: string;
  bank_status: 'pending' | 'included' | 'ignored' | 'removed_upstream';
  user_subject_id: number;
}

const LEGACY_TARGETS = ['activities', 'quizzes', 'exams'] as const;

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

  try {
    const { id } = await props.params;
    const announcementId = parseInt(id);
    const userId = parseInt(session.user.id);
    const { target_type, cat_id, period_id, deadline } = await req.json();

    // Announcements carry no due date from Canvas (unlike assignments) — the student supplies one.
    if (typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      return Response.json({ error: 'A deadline (YYYY-MM-DD) is required' }, { status: 400 });
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

    // Same re-Include guard as the Activity Bank: 'ignored' can still be Included later
    // (that's the whole point of "Keep as Announcement" not being final).
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
    if (subjectMode === 'custom' && LEGACY_TARGETS.includes(target_type)) {
      return Response.json(
        { error: 'This subject uses custom grading. Choose a period and category instead.' },
        { status: 400 },
      );
    }

    // No score/points — announcements aren't graded, unlike assignments.
    const commonFields = {
      entryId: null, userSubjectId: item.user_subject_id, name: item.title,
      specificType: '', urgency: 'Medium', status: 'Pending', deadline,
      score: null, items: null, grade: null, accomplishedAt: null,
    };

    if (target_type === 'grade_entries') {
      if (!cat_id || !period_id) {
        return Response.json({ error: 'cat_id and period_id are required for grade_entries' }, { status: 400 });
      }
      const [owns] = await pool.execute<RowDataPacket[]>(
        `SELECT 1 FROM grading_categories gc
         JOIN grading_periods gp ON gp.period_id = gc.period_id
         JOIN subject_grading sg ON sg.preset_id = gp.preset_id
         WHERE gc.cat_id = ? AND gc.period_id = ? AND sg.user_subject_id = ?`,
        [cat_id, period_id, item.user_subject_id],
      );
      if (!owns.length) {
        return Response.json({ error: 'That category/period does not belong to this subject' }, { status: 400 });
      }
    } else if (!LEGACY_TARGETS.includes(target_type)) {
      return Response.json({ error: 'Invalid target_type' }, { status: 400 });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let linkColumn: 'activity_id' | 'quiz_id' | 'exam_id' | 'grade_entry_id';
      let newEntryId: number;

      if (target_type === 'activities') {
        newEntryId = (await insertActivityEntry(commonFields, conn)).entryId;
        linkColumn = 'activity_id';
      } else if (target_type === 'quizzes') {
        newEntryId = (await insertQuizEntry(commonFields, conn)).entryId;
        linkColumn = 'quiz_id';
      } else if (target_type === 'exams') {
        newEntryId = (await insertExamEntry(commonFields, conn)).entryId;
        linkColumn = 'exam_id';
      } else {
        newEntryId = (await insertGradeEntry(
          { ...commonFields, catId: cat_id, periodId: period_id, isLab: false }, conn,
        )).entryId;
        linkColumn = 'grade_entry_id';
      }

      await conn.execute(
        `INSERT INTO canvas_announcement_links (announcement_id, ${linkColumn}) VALUES (?, ?)`,
        [announcementId, newEntryId],
      );
      await conn.execute(
        `UPDATE canvas_announcement_bank SET bank_status = 'included' WHERE id = ?`,
        [announcementId],
      );

      await conn.commit();
      return Response.json({ status: 'success', entry_id: newEntryId });
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

- [ ] **Step 2: Create the Ignore route**

```ts
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await props.params;
  const announcementId = parseInt(id);
  const userId = parseInt(session.user.id);

  const [owned] = await pool.execute<RowDataPacket[]>(
    `SELECT bank.id FROM canvas_announcement_bank bank
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     WHERE bank.id = ? AND conn.user_id = ?`,
    [announcementId, userId],
  );
  if (owned.length === 0) return Response.json({ error: 'Not found' }, { status: 404 });

  await pool.execute(`UPDATE canvas_announcement_bank SET bank_status = 'ignored' WHERE id = ?`, [announcementId]);
  return Response.json({ status: 'success' });
}
```

- [ ] **Step 3: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Verify both routes mount (unauthenticated checks)**

```bash
curl -s -X POST http://localhost:3000/api/canvas/announcements/1/include
curl -s -X POST http://localhost:3000/api/canvas/announcements/1/ignore
```
Expected: both print `{"error":"Unauthorized"}`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/canvas/announcements/[id]/include/route.ts" "src/app/api/canvas/announcements/[id]/ignore/route.ts"
git commit -m "Add Include and Ignore routes for the announcement bank"
```

- [ ] **Checkpoint:** both routes compile and mount. Move to Task 7.

---

### Task 7: `CanvasAnnouncementBank` component

**Files:**
- Create: `src/components/studypulse/CanvasAnnouncementBank.tsx`

**Interfaces:**
- Consumes: the `GET /api/canvas/announcements` response shape (Task 5), `POST .../include` and `POST .../ignore` (Task 6), and the existing `GET /api/studypulse/subjects/[id]/grading` endpoint (already built for `CanvasActivityBank`, returns `{ config: { preset: { periods: [{ period_id, name, categories: [{ cat_id, name }] }] } } }`).
- Produces: `export default function CanvasAnnouncementBank({ items, onChange }: { items: AnnouncementItem[]; onChange: () => void })` — same prop shape convention as `CanvasActivityBank`.

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useState, useMemo } from 'react';
import { CheckCircle2, EyeOff, Clock, Megaphone } from 'lucide-react';

type SuggestedCategory =
  | { kind: 'legacy'; target: 'activities' | 'quizzes' | 'exams' }
  | { kind: 'custom'; categoryName: string }
  | { kind: 'general' };

interface AnnouncementItem {
  id: number;
  title: string;
  message: string | null;
  posted_at: string | null;
  course_name: string;
  user_subject_id: number | null;
  subject_mode?: 'legacy' | 'custom';
  bank_status: 'pending' | 'included' | 'ignored' | 'removed_upstream';
  suggested_category: SuggestedCategory;
}

interface GradingCategory { cat_id: number; name: string; }
interface GradingPeriod { period_id: number; name: string; categories: GradingCategory[]; }

const GLASS: React.CSSProperties = {
  background:           'rgba(255,255,255,0.4)',
  backdropFilter:       'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  borderRadius:         '22px',
  border:               '1px solid rgba(255,255,255,0.4)',
  boxShadow:            '0 8px 24px rgba(31,38,68,0.09)',
};

const selectStyle: React.CSSProperties = {
  padding: '7px 12px', borderRadius: '10px', border: '1px solid rgba(180,190,215,0.5)',
  fontSize: '0.82rem', background: 'rgba(255,255,255,0.8)',
};

const pillBtn: React.CSSProperties = {
  border: 'none', borderRadius: '999px', padding: '8px 15px', fontWeight: 700,
  fontSize: '0.82rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
};

const FILTER_PILL: React.CSSProperties = {
  border: '1px solid rgba(200,210,230,0.5)', borderRadius: '999px', padding: '6px 14px',
  fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', background: 'rgba(255,255,255,0.5)', color: '#5c6b80',
};
const FILTER_PILL_ACTIVE: React.CSSProperties = {
  ...FILTER_PILL, background: 'linear-gradient(to right, #f2a7c0, #74bcd9)', color: 'white', border: 'none',
};

function stripHtml(html: string | null): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function suggestionLabel(s: SuggestedCategory): string | null {
  if (s.kind === 'legacy') return s.target === 'activities' ? 'Activity' : s.target === 'quizzes' ? 'Quiz' : 'Exam';
  if (s.kind === 'custom') return s.categoryName;
  return null;
}

const FILTERS = ['all', 'needs_review', 'converted', 'dismissed'] as const;
type Filter = typeof FILTERS[number];
const FILTER_LABELS: Record<Filter, string> = {
  all: 'All', needs_review: 'Needs Review', converted: 'Converted', dismissed: 'Dismissed',
};

export default function CanvasAnnouncementBank({ items, onChange }: { items: AnnouncementItem[]; onChange: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [includingId, setIncludingId] = useState<number | null>(null);
  const [targetType, setTargetType] = useState<'activities' | 'quizzes' | 'exams'>('activities');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const [periodsBySubject, setPeriodsBySubject] = useState<Record<number, GradingPeriod[]>>({});
  const [loadingSubjectId, setLoadingSubjectId] = useState<number | null>(null);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [catId, setCatId] = useState<number | null>(null);

  const filtered = useMemo(() => items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'needs_review') return item.bank_status === 'pending';
    if (filter === 'converted') return item.bank_status === 'included';
    return item.bank_status === 'ignored'; // dismissed
  }), [items, filter]);

  const openInclude = async (item: AnnouncementItem) => {
    if (includingId === item.id) { setIncludingId(null); return; }
    setIncludingId(item.id);
    setPeriodId(null);
    setCatId(null);
    setDeadline('');
    setTargetType(item.suggested_category.kind === 'legacy' ? item.suggested_category.target : 'activities');

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
  };

  /** Picking a period auto-preselects a category matching the suggestion, if that period has one. */
  const handlePeriodChange = (item: AnnouncementItem, newPeriodId: number) => {
    setPeriodId(newPeriodId);
    const subjectId = item.user_subject_id!;
    const period = periodsBySubject[subjectId]?.find(p => p.period_id === newPeriodId);
    const suggestion = item.suggested_category.kind === 'custom' ? item.suggested_category.categoryName : null;
    const match = suggestion ? period?.categories.find(c => c.name === suggestion) : null;
    setCatId(match ? match.cat_id : null);
  };

  const confirmInclude = async (item: AnnouncementItem) => {
    const customMode = item.subject_mode === 'custom';
    if (!deadline) { alert('Choose a deadline first'); return; }
    if (customMode && (periodId == null || catId == null)) {
      alert('Choose a grading period and category first');
      return;
    }
    setBusy(item.id);
    try {
      const res = await fetch(`/api/canvas/announcements/${item.id}/include`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          customMode
            ? { target_type: 'grade_entries', period_id: periodId, cat_id: catId, deadline }
            : { target_type: targetType, deadline },
        ),
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

  const dismiss = async (announcementId: number) => {
    setBusy(announcementId);
    try {
      const res = await fetch(`/api/canvas/announcements/${announcementId}/ignore`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error ?? 'Failed to dismiss');
        return;
      }
      onChange();
    } catch (err) {
      alert('Dismiss failed: ' + (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <div id="announcements" style={{ ...GLASS, padding: '22px 26px', marginBottom: '20px' }}>
      <style jsx>{`
        .cab2-row { transition: transform 150ms ease, box-shadow 150ms ease; }
        .cab2-row:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(116,188,217,0.16); }
        .cab2-include:hover:not(:disabled) { filter: brightness(1.04); }
        .cab2-dismiss:hover:not(:disabled) { background: rgba(255,255,255,0.85) !important; }
        .cab2-select:focus { outline: none; border-color: #74bcd9; }
      `}</style>
      <h3 style={{
        margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 800, color: '#2d3748',
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif", display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        <Megaphone size={18} color="#74bcd9" /> Announcements <span style={{ color: '#8a94a6', fontWeight: 700 }}>({items.length})</span>
      </h3>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={filter === f ? FILTER_PILL_ACTIVE : FILTER_PILL}>
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <p style={{ color: '#8a94a6', fontSize: '0.85rem', margin: 0 }}>Nothing here.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filtered.map(item => {
          const customMode = item.subject_mode === 'custom';
          const actionable = item.bank_status === 'pending' || item.bank_status === 'ignored';
          const periods = item.user_subject_id ? periodsBySubject[item.user_subject_id] : undefined;
          const loading = item.user_subject_id != null && loadingSubjectId === item.user_subject_id;
          const selectedPeriod = periods?.find(p => p.period_id === periodId) ?? null;
          const suggestion = suggestionLabel(item.suggested_category);
          const messageText = stripHtml(item.message);
          return (
          <div key={item.id} className="cab2-row" style={{
            background: 'rgba(255,255,255,0.55)', borderRadius: '16px', padding: '14px 18px',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: '#333', flexGrow: 1, fontSize: '0.92rem' }}>{item.title}</span>
                <span style={{
                  fontSize: '0.72rem', fontWeight: 700, color: '#2a7fa8',
                  background: 'rgba(116,188,217,0.16)', borderRadius: '999px', padding: '3px 10px',
                }}>
                  {item.course_name}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#8a94a6', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={12} /> {item.posted_at ? new Date(item.posted_at).toLocaleDateString() : 'Unknown date'}
                </span>
              </div>
              {messageText && (
                <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: '#666', lineHeight: 1.4 }}>
                  {messageText.slice(0, 160)}{messageText.length > 160 ? '…' : ''}
                </p>
              )}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                {suggestion && (
                  <span style={{ background: 'rgba(242,167,192,0.18)', color: '#a0507a', borderRadius: '999px', padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                    Suggests: {suggestion}
                  </span>
                )}
                {item.bank_status === 'included' && (
                  <span style={{ background: 'rgba(120,200,150,0.2)', color: '#2f8a5a', borderRadius: '999px', padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                    Added
                  </span>
                )}
                {item.bank_status === 'ignored' && (
                  <span style={{ background: 'rgba(120,130,150,0.14)', color: '#5c6b80', borderRadius: '999px', padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                    Dismissed
                  </span>
                )}
                {item.bank_status === 'removed_upstream' && (
                  <span style={{ background: 'rgba(120,130,150,0.14)', color: '#5c6b80', borderRadius: '999px', padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                    No longer on Canvas
                  </span>
                )}
              </div>
            </div>
            {actionable && item.user_subject_id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="cab2-include" disabled={busy === item.id} onClick={() => openInclude(item)}
                  style={{ ...pillBtn, color: 'white', background: 'linear-gradient(to right, #74bcd9, #4dabf5)' }}>
                  <CheckCircle2 size={13} /> Include
                </button>
                <button className="cab2-dismiss" disabled={busy === item.id} onClick={() => dismiss(item.id)}
                  style={{ ...pillBtn, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.5)', color: '#8a94a6' }}>
                  <EyeOff size={13} /> Keep as Announcement
                </button>
              </div>
            )}
            {includingId === item.id && !customMode && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="cab2-select" style={selectStyle} />
                <select value={targetType} onChange={e => setTargetType(e.target.value as typeof targetType)} className="cab2-select" style={selectStyle}>
                  <option value="activities">Activity</option>
                  <option value="quizzes">Quiz</option>
                  <option value="exams">Exam</option>
                </select>
                <button disabled={busy === item.id || !deadline} onClick={() => confirmInclude(item)} className="cab2-include"
                  style={{
                    ...pillBtn, color: 'white',
                    background: !deadline ? 'rgba(242,167,192,0.5)' : 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                    cursor: !deadline ? 'not-allowed' : 'pointer',
                  }}>
                  Confirm Include
                </button>
              </div>
            )}
            {includingId === item.id && customMode && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {loading && <span style={{ fontSize: '0.8rem', color: '#8a94a6' }}>Loading grading periods…</span>}
                {!loading && periods && periods.length === 0 && (
                  <span style={{ fontSize: '0.8rem', color: '#a0507a', fontWeight: 600 }}>
                    This subject has no grading periods configured yet.
                  </span>
                )}
                {!loading && periods && periods.length > 0 && (
                  <>
                    <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="cab2-select" style={selectStyle} />
                    <select value={periodId ?? ''} onChange={e => handlePeriodChange(item, Number(e.target.value))} className="cab2-select" style={selectStyle}>
                      <option value="" disabled>Period…</option>
                      {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.name}</option>)}
                    </select>
                    <select value={catId ?? ''} onChange={e => setCatId(Number(e.target.value))} disabled={!selectedPeriod} className="cab2-select" style={selectStyle}>
                      <option value="" disabled>Category…</option>
                      {selectedPeriod?.categories.map(c => <option key={c.cat_id} value={c.cat_id}>{c.name}</option>)}
                    </select>
                    <button
                      disabled={busy === item.id || periodId == null || catId == null || !deadline}
                      onClick={() => confirmInclude(item)} className="cab2-include"
                      style={{
                        ...pillBtn, color: 'white',
                        background: (periodId == null || catId == null || !deadline) ? 'rgba(242,167,192,0.5)' : 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                        cursor: (periodId == null || catId == null || !deadline) ? 'not-allowed' : 'pointer',
                      }}>
                      Confirm Include
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/studypulse/CanvasAnnouncementBank.tsx
git commit -m "Add CanvasAnnouncementBank component"
```

- [ ] **Checkpoint:** component compiles. It isn't rendered anywhere yet — that's Task 8, which also provides the only real behavioral test (nothing renders this component in isolation, so there's nothing meaningful to screenshot before it's wired in).

---

### Task 8: Wire into the UI, add the subject-page button, and verify the whole feature end-to-end

**Files:**
- Modify: `src/app/studypulse/canvas/CanvasClientShell.tsx`
- Modify: `src/components/studypulse/SubjectCardView.tsx`

**Interfaces:**
- Consumes: `CanvasAnnouncementBank` (Task 7), `GET /api/canvas/announcements` (Task 5).

- [ ] **Step 1: Fetch announcements and render the panel in `CanvasClientShell.tsx`**

Add the import at the top, next to the other Canvas component imports:

```ts
import CanvasAnnouncementBank from '@/components/studypulse/CanvasAnnouncementBank';
```

Add a new state variable next to `bankItems`:

```ts
const [announcementItems, setAnnouncementItems] = useState<never[]>([]);
```

Replace the `refresh` function's body with:

```ts
const refresh = useCallback(async () => {
    try {
      const bankUrl = subjectId
        ? `/api/canvas/bank?status=pending&user_subject_id=${subjectId}`
        : '/api/canvas/bank?status=pending';
      const announcementsUrl = subjectId
        ? `/api/canvas/announcements?user_subject_id=${subjectId}`
        : '/api/canvas/announcements';
      // The course mapping list isn't rendered in the subject-scoped view, so skip fetching it.
      const [coursesRes, bankRes, announcementsRes] = await Promise.all([
        subjectId ? Promise.resolve(null) : fetch('/api/canvas/courses'),
        fetch(bankUrl),
        fetch(announcementsUrl),
      ]);
      if (coursesRes?.ok) setCourses((await coursesRes.json()).courses);
      if (bankRes.ok) setBankItems((await bankRes.json()).items);
      if (announcementsRes.ok) setAnnouncementItems((await announcementsRes.json()).items);
    } catch (err) {
      console.error('Failed to refresh Canvas data:', err);
    }
  }, [subjectId]);
```

Replace the render block:

```tsx
        <CanvasConnectPanel connection={connection} onChange={refresh} />
        {connection.connected && (
          <>
            {/* Scoped to one subject, this view is purely the Activity Bank — the
                New Canvas Courses mapping list is unrelated once you're already inside a subject. */}
            {!subjectId && <CanvasCourseMapping courses={courses} existingSubjects={existingSubjects} onChange={refresh} />}
            <CanvasActivityBank items={bankItems} onChange={refresh} />
            <CanvasAnnouncementBank items={announcementItems} onChange={refresh} />
          </>
        )}
```

- [ ] **Step 2: Add the subject-page button**

In `src/components/studypulse/SubjectCardView.tsx`, find the existing `<Link href={`/studypulse/canvas?subject=${userSubjectId}`}>📥 Activity Bank</Link>` block and add this immediately after it (same style object, copied — the two buttons should look identical apart from label/href):

```tsx
          <Link
            href={`/studypulse/canvas?subject=${userSubjectId}#announcements`}
            title="View Canvas announcements for this subject"
            style={{ background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(200,210,230,0.4)', borderRadius: '14px', padding: '8px 14px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: '#888', whiteSpace: 'nowrap', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
          >
            📢 Announcements
          </Link>
```

- [ ] **Step 3: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Seed fixtures and stand up a local stub Canvas server**

This proves Task 4's sync engine, Task 5's classification, Task 6's Include/Ignore, and Task 7's UI all actually work together — the same seed-then-drive-with-Playwright method already proven this session for the Activity Bank's period/category picker, extended with a tiny local HTTP server standing in for Canvas (no real Canvas account needed).

```bash
mkdir -p /tmp/vb-verify
cat > /tmp/vb-verify/stub-canvas.cjs <<'EOF'
const http = require('http');

// Course-specific responses — canvas_announcement_id is only unique per connection, not per
// course, so reusing the same ids across two courses under one connection would collide on
// canvas_announcement_bank's UNIQUE KEY uniq_conn_announcement(connection_id, canvas_announcement_id)
// and silently merge into one row. Each id below is used by exactly one course.
const BY_COURSE = {
  601: [ // legacy course
    {
      id: 7001, title: 'Quiz 2 moved to Friday',
      message: '<p>Please note the quiz has moved to this Friday.</p>',
      html_url: 'https://stub/1', posted_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:00:00Z',
    },
  ],
  602: [ // custom-mode course
    {
      id: 7002, title: 'Submit your Requirements packet',
      message: '<p>Reminder to submit your requirements by end of week.</p>',
      html_url: 'https://stub/2', posted_at: '2026-08-19T09:00:00Z', updated_at: '2026-08-19T09:00:00Z',
    },
    {
      id: 7003, title: 'Welcome to the term!',
      message: '<p>Excited to have you all this trimester.</p>',
      html_url: 'https://stub/3', posted_at: '2026-08-18T08:00:00Z', updated_at: '2026-08-18T08:00:00Z',
    },
  ],
};

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const match = req.url.match(/^\/api\/v1\/courses\/(\d+)\/(assignments|discussion_topics)/);
  if (match && match[2] === 'assignments') {
    res.end(JSON.stringify([])); // no assignments needed for this verification pass
    return;
  }
  if (match && match[2] === 'discussion_topics') {
    res.end(JSON.stringify(BY_COURSE[Number(match[1])] ?? []));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
server.listen(8899, () => console.log('stub Canvas listening on :8899'));
EOF
node /tmp/vb-verify/stub-canvas.cjs &
```

Now seed a throwaway user, a legacy-mode subject, a custom-mode subject (with grading categories named "Quizzes" and "Requirements" so both suggestion paths are exercised), and a `canvas_connections` row pointed at `http://localhost:8899`. The stored token must be encrypted **exactly the way `src/lib/canvas/credentials.ts`'s `encryptToken()` does it** (AES-256-GCM, key = the raw hex-decoded `CANVAS_TOKEN_ENC_KEY` bytes — not a derived key) or the app's own `decryptToken()` will fail with a bad-auth-tag error when the sync engine tries to read it back:

```bash
export CANVAS_TOKEN_ENC_KEY=$(grep '^CANVAS_TOKEN_ENC_KEY=' .env.local | cut -d= -f2)

cat > /tmp/vb-verify/seed.cjs <<'EOF'
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function main() {
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', password: '', database: 'vibeboard' });

  const hash = await bcrypt.hash('AnnouncementTest123!', 10);
  const [u] = await conn.execute(
    `INSERT INTO user_login (first_name, middle_name, surname, email, year_level, status, program, specialization, password)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ['Preview', 'T', 'Tester', 'announce-preview-test@vibeboard.local', '3rd Year', 'Regular', 1, 1, hash],
  );
  const userId = u.insertId;

  const [subjLeg] = await conn.execute(
    `INSERT INTO subjects (course_code, subject_name, units, year_level, trimester) VALUES (?,?,?,?,?)`,
    ['ANN101', 'Legacy Subject', 3, '3rd Year', '3rd Trimester'],
  );
  const [subjCus] = await conn.execute(
    `INSERT INTO subjects (course_code, subject_name, units, year_level, trimester) VALUES (?,?,?,?,?)`,
    ['ANN102', 'Custom Subject', 3, '3rd Year', '3rd Trimester'],
  );
  const [usLeg] = await conn.execute('INSERT INTO user_subjects (user_id, subject_id) VALUES (?,?)', [userId, subjLeg.insertId]);
  const [usCus] = await conn.execute('INSERT INTO user_subjects (user_id, subject_id) VALUES (?,?)', [userId, subjCus.insertId]);

  const [preset] = await conn.execute(
    'INSERT INTO grading_presets (user_id, name, is_default, has_lab, lec_weight, lab_weight, grade_scale) VALUES (?,?,?,?,?,?,?)',
    [userId, 'Preset', 1, 0, 100, 0, '4pt'],
  );
  const [period] = await conn.execute('INSERT INTO grading_periods (preset_id, name, sort_order) VALUES (?,?,?)', [preset.insertId, 'Midterm', 0]);
  await conn.execute('INSERT INTO grading_categories (period_id, name, weight, sort_order) VALUES (?,?,?,?)', [period.insertId, 'Quizzes', 30, 0]);
  await conn.execute('INSERT INTO grading_categories (period_id, name, weight, sort_order) VALUES (?,?,?,?)', [period.insertId, 'Requirements', 70, 1]);
  await conn.execute('INSERT INTO subject_grading (user_subject_id, preset_id) VALUES (?,?)', [usCus.insertId, preset.insertId]);

  // Encrypt a dummy token the same way encryptToken() in src/lib/canvas/credentials.ts does —
  // the stub server never inspects the Authorization header, but getAccessToken() must be able
  // to decrypt this back out before canvasGetAll() ever sends a request.
  const key = Buffer.from(process.env.CANVAS_TOKEN_ENC_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update('dummy-canvas-token', 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const [connRow] = await conn.execute(
    `INSERT INTO canvas_connections (user_id, base_url, canvas_user_id, canvas_user_name, access_token_enc, token_iv, token_tag, status)
     VALUES (?,?,?,?,?,?,?,'active')`,
    [userId, 'http://localhost:8899', 88001, 'Preview Tester', enc, iv, tag],
  );
  const connectionId = connRow.insertId;

  const insertCourse = async (canvasCourseId, name, userSubjectId) => {
    const [c] = await conn.execute(
      `INSERT INTO canvas_courses (connection_id, canvas_course_id, name, mapping_status, user_subject_id, last_seen_at)
       VALUES (?,?,?,'linked',?,NOW())`,
      [connectionId, canvasCourseId, name, userSubjectId],
    );
    return c.insertId;
  };
  await insertCourse(601, 'Legacy Course', usLeg.insertId);
  await insertCourse(602, 'Custom Course', usCus.insertId);

  console.log(JSON.stringify({
    userId, userSubjectLeg: usLeg.insertId, userSubjectCus: usCus.insertId, connectionId,
  }, null, 2));
  await conn.end();
}

main().catch(err => { console.error(err); process.exit(1); });
EOF

export NODE_PATH="$(pwd)/node_modules"
node /tmp/vb-verify/seed.cjs
```

Note the printed `userSubjectCus` value — it's needed for the subject-scoped URL in Step 6.

- [ ] **Step 5: Trigger a real sync and verify the announcements landed**

Start the dev server if it isn't already running (`npm run dev`), then drive a real login + "Sync Now" click with Playwright (same technique already proven this session — `npx playwright install chromium` if the browser isn't cached yet):

```bash
cat > /tmp/vb-verify/sync-and-check.cjs <<'EOF'
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.fill('#email', 'announce-preview-test@vibeboard.local');
  await page.fill('#password', 'AnnouncementTest123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });

  await page.goto('http://localhost:3000/studypulse/canvas', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sync Now")');
  await page.waitForTimeout(2000); // stub server is instant; this covers the round trip + re-render
  await page.screenshot({ path: '/tmp/vb-verify/after-sync.png', fullPage: true });

  await browser.close();
  console.log('Done.');
}
main().catch(err => { console.error(err); process.exit(1); });
EOF

export NODE_PATH="C:\Users\LENOVO\AppData\Roaming\npm-cache\_npx\e41f203b7505f1fb\node_modules"
node /tmp/vb-verify/sync-and-check.cjs
```

(If `npx playwright install chromium` reports a different cache hash than `e41f203b7505f1fb`, find the correct one first: `find "$(npm config get cache)/_npx" -maxdepth 4 -iname playwright -type d`.)

Then confirm the sync actually wrote announcement rows:

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SELECT id, course_id, title, bank_status FROM canvas_announcement_bank ORDER BY id;"
```
Expected: 3 rows total — one under the legacy course ("Quiz 2 moved to Friday"), two under the custom course ("Submit your Requirements packet", "Welcome to the term!").

- [ ] **Step 6: Include the legacy-mode announcement and verify**

```bash
cat > /tmp/vb-verify/include-legacy.cjs <<'EOF'
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.fill('#email', 'announce-preview-test@vibeboard.local');
  await page.fill('#password', 'AnnouncementTest123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });

  // REPLACE 16 below with the printed userSubjectLeg value from Step 4.
  await page.goto('http://localhost:3000/studypulse/canvas?subject=16', { waitUntil: 'networkidle' });
  // Scope by the card's own CSS class, not a bare 'div' — a generic div+hasText locator would
  // also match the whole panel and other ancestor wrapper divs (every ancestor "contains" this
  // text too), which is ambiguous for Playwright's strict mode and easy to get wrong either way.
  const row = page.locator('.cab2-row', { hasText: 'Quiz 2 moved to Friday' });
  await row.locator('button:has-text("Include")').click();
  await page.fill('input[type="date"]', '2026-09-01');
  await page.locator('button:has-text("Confirm Include")').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/vb-verify/after-include-legacy.png', fullPage: true });

  await browser.close();
  console.log('Done.');
}
main().catch(err => { console.error(err); process.exit(1); });
EOF
node /tmp/vb-verify/include-legacy.cjs
```

("Quiz 2 moved to Friday" matches `suggestLegacyCategory`'s "quiz" keyword, so it should default to target type "Quiz" — confirm this visually in the screenshot before clicking Confirm, or add a `console.log` assertion on the select's value if driving this interactively.)

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SELECT bank_status FROM canvas_announcement_bank WHERE title='Quiz 2 moved to Friday' AND course_id IN (SELECT id FROM canvas_courses WHERE canvas_course_id=601); SELECT * FROM canvas_announcement_links; SELECT quiz_name, deadline FROM quizzes WHERE user_subject_id=16;"
```
Expected: `bank_status = 'included'`, a `canvas_announcement_links` row with `quiz_id` set, and a `quizzes` row named "Quiz 2 moved to Friday" with `deadline = '2026-09-01'`.

- [ ] **Step 7: Include the custom-mode announcement (period + category picker) and verify**

```bash
cat > /tmp/vb-verify/include-custom.cjs <<'EOF'
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.fill('#email', 'announce-preview-test@vibeboard.local');
  await page.fill('#password', 'AnnouncementTest123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });

  // REPLACE 17 below with the printed userSubjectCus value from Step 4.
  await page.goto('http://localhost:3000/studypulse/canvas?subject=17', { waitUntil: 'networkidle' });
  const row = page.locator('.cab2-row', { hasText: 'Submit your Requirements packet' });
  await row.locator('button:has-text("Include")').click();
  await page.waitForSelector('text=Loading grading periods', { state: 'detached', timeout: 8000 }).catch(() => {});
  await page.fill('input[type="date"]', '2026-09-01');
  await page.locator('select').first().selectOption({ label: 'Midterm' });
  await page.waitForTimeout(200);
  // The category select should auto-preselect "Requirements" (the suggestion) once Midterm is
  // chosen — confirm its value before clicking, since a wrong pre-selection would submit silently.
  const catValue = await page.locator('select').nth(1).inputValue();
  console.log('Category preselected to cat_id:', catValue);
  await page.locator('button:has-text("Confirm Include")').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/vb-verify/after-include-custom.png', fullPage: true });

  await browser.close();
  console.log('Done.');
}
main().catch(err => { console.error(err); process.exit(1); });
EOF
node /tmp/vb-verify/include-custom.cjs
```

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SELECT ge.name, ge.deadline, gc.name AS category FROM grade_entries ge JOIN grading_categories gc ON gc.cat_id=ge.cat_id WHERE ge.user_subject_id=17;"
```
Expected: one row — "Submit your Requirements packet", `deadline='2026-09-01'`, `category='Requirements'` — proving the suggestion (Requirements) was correctly matched against this subject's *actual* configured category name and pre-selected.

- [ ] **Step 8: Confirm "Keep as Announcement" leaves the item visible (persistent feed)**

"Welcome to the term!" is still `pending` (Steps 6-7 only touched the other two announcements). Through the browser (or a small Playwright script following the same login pattern as Steps 5-7), click "Keep as Announcement" on its card, then confirm via SQL that `bank_status` became `'ignored'` while the row still exists (nothing deleted):

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SELECT id, title, bank_status FROM canvas_announcement_bank WHERE title='Welcome to the term!';"
```
Expected: one row, `bank_status = 'ignored'`. Reload the page and switch to the "Dismissed" filter pill to confirm the card is still visible there, not gone — that's the whole point of it being a persistent feed rather than a pending-only queue like the Activity Bank.

- [ ] **Step 9: Look at the screenshots**

Open `/tmp/vb-verify/after-sync.png`, `/tmp/vb-verify/after-include-legacy.png`, `/tmp/vb-verify/after-include-custom.png`. Confirm: the Announcement Bank panel renders below the Activity Bank with the glass/pill styling matching the rest of the page, the filter pills are visible, each card shows a suggested-category chip, and the Included cards show a resolved "Added" badge with no action buttons.

- [ ] **Step 10: Clean up**

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "
SET FOREIGN_KEY_CHECKS=0;
DELETE FROM canvas_announcement_bank WHERE connection_id IN (SELECT id FROM canvas_connections WHERE base_url='http://localhost:8899');
DELETE FROM canvas_courses WHERE connection_id IN (SELECT id FROM canvas_connections WHERE base_url='http://localhost:8899');
DELETE FROM canvas_connections WHERE base_url='http://localhost:8899';
DELETE ge FROM grade_entries ge JOIN user_subjects us ON us.user_subject_id=ge.user_subject_id JOIN user_login ul ON ul.user_id=us.user_id WHERE ul.email='announce-preview-test@vibeboard.local';
DELETE q FROM quizzes q JOIN user_subjects us ON us.user_subject_id=q.user_subject_id JOIN user_login ul ON ul.user_id=us.user_id WHERE ul.email='announce-preview-test@vibeboard.local';
DELETE sg FROM subject_grading sg JOIN user_subjects us ON us.user_subject_id=sg.user_subject_id JOIN user_login ul ON ul.user_id=us.user_id WHERE ul.email='announce-preview-test@vibeboard.local';
DELETE gc FROM grading_categories gc JOIN grading_periods gp ON gp.period_id=gc.period_id JOIN grading_presets p ON p.preset_id=gp.preset_id JOIN user_login ul ON ul.user_id=p.user_id WHERE ul.email='announce-preview-test@vibeboard.local';
DELETE gp FROM grading_periods gp JOIN grading_presets p ON p.preset_id=gp.preset_id JOIN user_login ul ON ul.user_id=p.user_id WHERE ul.email='announce-preview-test@vibeboard.local';
DELETE p FROM grading_presets p JOIN user_login ul ON ul.user_id=p.user_id WHERE ul.email='announce-preview-test@vibeboard.local';
DELETE us FROM user_subjects us JOIN user_login ul ON ul.user_id=us.user_id WHERE ul.email='announce-preview-test@vibeboard.local';
DELETE s FROM subjects s WHERE s.course_code IN ('ANN101','ANN102');
DELETE FROM user_login WHERE email='announce-preview-test@vibeboard.local';
SET FOREIGN_KEY_CHECKS=1;
"
```

Then stop the stub Canvas server: find and kill it (`netstat -ano | grep :8899` on Windows, then `taskkill //PID <pid> //F`, or `lsof -ti:8899 | xargs -r kill` on Linux/macOS).

- [ ] **Step 11: Commit**

```bash
git add src/app/studypulse/canvas/CanvasClientShell.tsx src/components/studypulse/SubjectCardView.tsx
git commit -m "Wire the Announcement Bank into the Canvas Integration page and subject page"
```

- [ ] **Checkpoint:** the full feature works end-to-end — sync fetches announcements, classification suggests categories using each subject's real grading config, Include creates real entries (legacy and custom-mode both verified), Dismiss is non-final, and nothing disappears from the persistent feed. All fixtures cleaned up. Feature complete.

---

## Post-Plan Note

This plan does not touch `src/app/api/canvas/sync/cron/route.ts` or `syncAllDueConnections()` — they already call `syncConnection()`, which Task 4 modified, so the cron path picks up announcement syncing automatically with no changes needed there.
