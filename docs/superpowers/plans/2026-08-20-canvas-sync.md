# Canvas Sync + Activity Bank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a VibeBoard student connect their Canvas account (via a Personal Access Token), automatically discover courses/assignments, stage them in an Activity Bank the student reviews, and keep Included items in sync with Canvas going forward (deadlines and scores auto-updating, Canvas always authoritative).

**Architecture:** Three pure/near-pure `src/lib/canvas/*` modules (credentials, HTTP client, normalizer) feed an orchestration module (`sync.ts`) that upserts into six new MySQL tables. A course-mapping review screen and an Activity Bank review screen sit on top, both reusing the existing StudyPulse entry-insert logic (extracted into a small shared helper) rather than duplicating it. Sync is triggered by a Vercel Cron job and a manual "Sync Now" button, both calling the same orchestration function.

**Tech Stack:** Next.js 15 (App Router) + TypeScript, `mysql2/promise` raw SQL (no ORM), `next-auth` v5 for session/`user_id`, native `fetch` for the Canvas API, Node's built-in `crypto` for token encryption.

**Spec:** [docs/superpowers/specs/2026-08-20-canvas-sync-design.md](../specs/2026-08-20-canvas-sync-design.md) — read this first; this plan implements it task-by-task and does not repeat its rationale.

## Global Constraints

- This working directory is **not a git repository** (confirmed via `git status` failing). Task steps therefore end in a verification checkpoint, not a `git commit` — do not run git commands as part of this plan. If you want history tracking, initialize git before starting; that's a separate decision, not part of this plan.
- No test framework is installed in this project, and none should be added for this feature — the existing project convention (see `log1.md`) is `tsc --noEmit`, direct SQL against the live DB, `curl` route checks, and hand-verification against real captured data. This plan follows that convention: pure functions (`credentials.ts` roundtrip, `normalize.ts`, the pure diff helper in `sync.ts`) get real `node:assert`-based throwaway verification scripts (genuine red/green, just without a test runner); DB- and network-touching code is verified with direct SQL and `curl`/manual real-Canvas-account checks, exactly as this project already verifies its OCR pipeline and DB migrations.
- All new tables scope through `user_subjects`/`user_login`, matching the existing `activities`/`quizzes`/`exams`/`grade_entries` convention — never introduce a parallel user-identity concept.
- `CANVAS_TOKEN_ENC_KEY` (64 hex chars = 32 bytes, for AES-256-GCM) and `CRON_SECRET` (any random string) must be added to `.env.local` before Task 2 and Task 9 respectively. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **`CRON_SECRET` is not an arbitrary name** — it must be exactly this, because Vercel Cron auto-injects `Authorization: Bearer $CRON_SECRET` only for an env var with this exact name; anything else requires manually configuring the header, which is easy to forget and fails closed (silent 401 forever) rather than loudly. **Deployment checklist: set `CRON_SECRET` in the Vercel project's env vars — not `CANVAS_CRON_SECRET`, which was the name used through Task 9's original implementation and renamed during final review.**
- Every new API route starts with the same `auth()` session check already used throughout `src/app/api/studypulse/**` (`const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });`) — copy this pattern exactly, don't invent a new auth helper.

---

## File Structure

**New files:**
- `src/lib/canvas/errors.ts` — `CanvasAuthError`, `CanvasApiError`
- `src/lib/canvas/credentials.ts` — token encryption, `CanvasConnectionRow` type, `getAccessToken()`
- `src/lib/canvas/client.ts` — `canvasGetAll()` (pagination, rate-limit backoff, retry)
- `src/lib/canvas/normalize.ts` — `normalizeCourse()`, `normalizeAssignment()`, pure types
- `src/lib/canvas/sync.ts` — `syncConnection()`, `syncAllDueConnections()`, `submissionFieldsChanged()`
- `src/lib/studypulseEntries.ts` — extracted shared insert helpers (`insertActivityEntry`, `insertQuizEntry`, `insertExamEntry`, `insertGradeEntry`), used by both the existing entries/grade-entries routes and the new Canvas Include route
- `src/app/api/canvas/connect/route.ts` — POST
- `src/app/api/canvas/disconnect/route.ts` — POST
- `src/app/api/canvas/courses/route.ts` — GET
- `src/app/api/canvas/courses/[id]/map/route.ts` — POST
- `src/app/api/canvas/bank/route.ts` — GET
- `src/app/api/canvas/bank/[id]/include/route.ts` — POST
- `src/app/api/canvas/bank/[id]/ignore/route.ts` — POST
- `src/app/api/canvas/sync/manual/route.ts` — POST
- `src/app/api/canvas/sync/cron/route.ts` — POST
- `src/app/studypulse/canvas/page.tsx` — server component, page shell
- `src/components/studypulse/CanvasConnectPanel.tsx`
- `src/components/studypulse/CanvasCourseMapping.tsx`
- `src/components/studypulse/CanvasActivityBank.tsx`
- `vercel.json`

**Modified files:**
- `src/lib/migrate.ts` — add `ensureCanvasSchema()`
- `src/app/api/studypulse/entries/route.ts` — use the extracted helpers instead of inline SQL (behavior-preserving)
- `src/app/api/studypulse/grade-entries/route.ts` — same
- `src/app/studypulse/[id]/page.tsx` — join `canvas_entry_links` into the four entry queries, pass `canvas_linked` through
- `src/components/studypulse/SubjectCardView.tsx` — `EntryRow.canvas_linked?: boolean`, `toEntry()` passthrough, confirm-dialog guard in both `setField` functions

---

### Task 1: Database Schema

**Files:**
- Modify: `src/lib/migrate.ts`

**Interfaces:**
- Produces: `ensureCanvasSchema(): Promise<void>`, exported from `src/lib/migrate.ts`, callable idempotently (matches the `_ranAc`/`_ranGs` guard pattern already in that file).

- [ ] **Step 1: Confirm the tables don't exist yet**

Run:
```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SHOW TABLES LIKE 'canvas_%';"
```
Expected: empty result set.

- [ ] **Step 2: Add `ensureCanvasSchema()` to `src/lib/migrate.ts`**

Add near the top with the other `_ran*` flags:

```ts
let _ranCanvas = false;
```

Add the function (append to the file):

```ts
/** Create the Canvas integration tables if they don't already exist. */
export async function ensureCanvasSchema(): Promise<void> {
  if (_ranCanvas) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_connections (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      user_id            INT NOT NULL,
      base_url           VARCHAR(255) NOT NULL,
      canvas_user_id     BIGINT NOT NULL,
      canvas_user_name   VARCHAR(255) NULL,
      access_token_enc   VARBINARY(1024) NULL,
      token_iv           VARBINARY(16) NULL,
      token_tag          VARBINARY(16) NULL,
      status             ENUM('active','invalid','disconnected') NOT NULL DEFAULT 'active',
      last_sync_at       DATETIME NULL,
      last_sync_status   ENUM('success','partial','failed') NULL,
      last_error         TEXT NULL,
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user (user_id),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_courses (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      connection_id      INT NOT NULL,
      canvas_course_id   BIGINT NOT NULL,
      name               VARCHAR(255) NOT NULL,
      course_code        VARCHAR(100) NULL,
      term               VARCHAR(100) NULL,
      workflow_state     VARCHAR(30) NULL,
      start_at           DATETIME NULL,
      end_at             DATETIME NULL,
      mapping_status     ENUM('pending','linked','created','ignored') NOT NULL DEFAULT 'pending',
      user_subject_id    INT NULL,
      first_seen_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at       DATETIME NOT NULL,
      UNIQUE KEY uniq_conn_course (connection_id, canvas_course_id),
      FOREIGN KEY (connection_id) REFERENCES canvas_connections(id) ON DELETE CASCADE,
      FOREIGN KEY (user_subject_id) REFERENCES user_subjects(user_subject_id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_activity_bank (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      connection_id            INT NOT NULL,
      course_id                INT NOT NULL,
      canvas_assignment_id     BIGINT NOT NULL,
      name                     VARCHAR(255) NOT NULL,
      due_at                   DATETIME NULL,
      points_possible          DECIMAL(8,2) NULL,
      html_url                 VARCHAR(500) NULL,
      submission_status        VARCHAR(50) NULL,
      submission_score         DECIMAL(8,2) NULL,
      submission_submitted_at  DATETIME NULL,
      canvas_updated_at        DATETIME NOT NULL,
      bank_status              ENUM('pending','included','ignored','removed_upstream') NOT NULL DEFAULT 'pending',
      first_seen_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_synced_at           DATETIME NOT NULL,
      last_change_at           DATETIME NULL,
      last_seen_sync_run_id    INT NULL,
      UNIQUE KEY uniq_conn_assignment (connection_id, canvas_assignment_id),
      FOREIGN KEY (connection_id) REFERENCES canvas_connections(id) ON DELETE CASCADE,
      FOREIGN KEY (course_id) REFERENCES canvas_courses(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_entry_links (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      bank_item_id     INT NOT NULL,
      activity_id      INT NULL,
      quiz_id          INT NULL,
      exam_id          INT NULL,
      grade_entry_id   INT NULL,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_bank_item (bank_item_id),
      FOREIGN KEY (bank_item_id) REFERENCES canvas_activity_bank(id) ON DELETE CASCADE,
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_sync_events (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      connection_id  INT NOT NULL,
      bank_item_id   INT NULL,
      event_type     ENUM('course_discovered','assignment_created','due_date_changed',
                           'score_changed','submission_status_changed','assignment_removed') NOT NULL,
      old_data       JSON NULL,
      new_data       JSON NULL,
      created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES canvas_connections(id) ON DELETE CASCADE,
      FOREIGN KEY (bank_item_id) REFERENCES canvas_activity_bank(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_sync_runs (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      connection_id    INT NOT NULL,
      trigger_source   ENUM('cron','manual') NOT NULL,
      started_at       DATETIME NOT NULL,
      finished_at      DATETIME NULL,
      status           ENUM('running','success','partial','failed') NOT NULL DEFAULT 'running',
      courses_synced   INT NOT NULL DEFAULT 0,
      items_fetched    INT NOT NULL DEFAULT 0,
      items_changed    INT NOT NULL DEFAULT 0,
      errors_json      JSON NULL,
      FOREIGN KEY (connection_id) REFERENCES canvas_connections(id) ON DELETE CASCADE
    )
  `);

  _ranCanvas = true;
}
```

- [ ] **Step 3: Wire the migration into a route that runs early**

This will actually be called from Task 5's `connect` route (the first Canvas-related route any user hits) the same way `ensureAccomplishedAt()` is called from the entries route. No action needed yet — just confirmed here so Task 5 doesn't forget it.

- [ ] **Step 4: Verify manually**

Add a temporary call at the bottom of a scratch script, or simplest: temporarily import and call it from a Node REPL-style script:

```bash
cat > /tmp/verify-schema.mjs <<'EOF'
process.env.DB_HOST = 'localhost';
process.env.DB_USER = 'root';
process.env.DB_PASS = '';
process.env.DB_NAME = 'vibeboard';
const { ensureCanvasSchema } = await import('./src/lib/migrate.ts');
await ensureCanvasSchema();
console.log('done');
process.exit(0);
EOF
```

This won't run directly (TS import from `.mjs`), so instead verify via the app itself in Task 5 (the connect route calls it on first hit) — for now, confirm the SQL is syntactically valid by running the six `CREATE TABLE` statements directly:

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard < /dev/stdin <<'EOF'
-- paste the six CREATE TABLE statements from Step 2 here
EOF
```

Expected: no errors.

- [ ] **Step 5: Confirm the tables and constraints landed correctly**

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SHOW TABLES LIKE 'canvas_%'; SHOW CREATE TABLE canvas_entry_links\G"
```
Expected: 6 tables listed; `canvas_entry_links`'s `SHOW CREATE TABLE` output includes the `CONSTRAINT ... CHECK` clause.

- [ ] **Step 6: Drop the manually-created tables so `ensureCanvasSchema()` creates them fresh via the app in Task 5**

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SET FOREIGN_KEY_CHECKS=0; DROP TABLE IF EXISTS canvas_sync_events, canvas_sync_runs, canvas_entry_links, canvas_activity_bank, canvas_courses, canvas_connections; SET FOREIGN_KEY_CHECKS=1;"
```

- [ ] **Step 7: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Checkpoint:** `ensureCanvasSchema()` exists and its SQL is verified valid. Move to Task 2.

---

### Task 2: Credential Encryption

**Files:**
- Create: `src/lib/canvas/credentials.ts`

**Interfaces:**
- Produces: `encryptToken(plain: string): {enc: Buffer, iv: Buffer, tag: Buffer}`, `decryptToken(enc: Buffer, iv: Buffer, tag: Buffer): string`, `getAccessToken(connection: CanvasConnectionRow): string`, `type CanvasConnectionRow` (fields: `id`, `user_id`, `base_url`, `canvas_user_id`, `canvas_user_name`, `access_token_enc`, `token_iv`, `token_tag`, `status`, `last_sync_at`, `last_sync_status`, `last_error`).
- Consumes: `CANVAS_TOKEN_ENC_KEY` env var (32 bytes, hex-encoded).

- [ ] **Step 1: Add the env var**

Add to `.env.local` (create if absent — check `.gitignore` already excludes it, this project has no `.env.example` so just add directly):

```bash
node -e "console.log('CANVAS_TOKEN_ENC_KEY=' + require('crypto').randomBytes(32).toString('hex'))" >> .env.local
```

- [ ] **Step 2: Write `src/lib/canvas/credentials.ts`**

```ts
import crypto from 'crypto';
import type { RowDataPacket } from 'mysql2';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.CANVAS_TOKEN_ENC_KEY;
  if (!hex) throw new Error('CANVAS_TOKEN_ENC_KEY is not set');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('CANVAS_TOKEN_ENC_KEY must be 32 bytes (64 hex chars)');
  return key;
}

export interface EncryptedToken {
  enc: Buffer;
  iv:  Buffer;
  tag: Buffer;
}

export function encryptToken(plain: string): EncryptedToken {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc    = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return { enc, iv, tag };
}

export function decryptToken(enc: Buffer, iv: Buffer, tag: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export interface CanvasConnectionRow extends RowDataPacket {
  id:                number;
  user_id:           number;
  base_url:          string;
  canvas_user_id:    number;
  canvas_user_name:  string | null;
  access_token_enc:  Buffer | null;
  token_iv:          Buffer | null;
  token_tag:         Buffer | null;
  status:            'active' | 'invalid' | 'disconnected';
  last_sync_at:      string | null;
  last_sync_status:  'success' | 'partial' | 'failed' | null;
  last_error:        string | null;
}

export function getAccessToken(connection: CanvasConnectionRow): string {
  if (!connection.access_token_enc || !connection.token_iv || !connection.token_tag) {
    throw new Error(`Canvas connection ${connection.id} has no stored token`);
  }
  return decryptToken(connection.access_token_enc, connection.token_iv, connection.token_tag);
}
```

- [ ] **Step 3: Write and run a throwaway roundtrip verification script**

Create `scratch-verify-credentials.mjs` in the project root (delete after running):

```js
import assert from 'node:assert';
import crypto from 'crypto';
process.env.CANVAS_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('hex');

const { encryptToken, decryptToken } = await import('./src/lib/canvas/credentials.ts');

const original = 'test-canvas-pat-1234567890';
const { enc, iv, tag } = encryptToken(original);
assert.notStrictEqual(enc.toString('utf8'), original, 'ciphertext must not equal plaintext');

const decrypted = decryptToken(enc, iv, tag);
assert.strictEqual(decrypted, original, 'roundtrip should return the original token');

const tamperedTag = Buffer.from(tag);
tamperedTag[0] ^= 0xff;
assert.throws(() => decryptToken(enc, iv, tamperedTag), 'tampered auth tag must fail to decrypt');

console.log('credentials.ts verification passed');
```

Run: `npx tsx scratch-verify-credentials.mjs`
Expected: `credentials.ts verification passed`, no assertion errors.

- [ ] **Step 4: Delete the scratch script**

```bash
rm scratch-verify-credentials.mjs
```

- [ ] **Step 5: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Checkpoint:** token encryption round-trips correctly and fails closed on tampering. Move to Task 3.

---

### Task 3: Canvas API Client

**Files:**
- Create: `src/lib/canvas/errors.ts`
- Create: `src/lib/canvas/client.ts`

**Interfaces:**
- Consumes: `CanvasConnectionRow`, `getAccessToken()` from Task 2.
- Produces: `canvasGetAll(connection: CanvasConnectionRow, path: string, params?: Record<string, string | string[]>): Promise<unknown[]>`, `class CanvasAuthError extends Error`, `class CanvasApiError extends Error { status: number }`.

- [ ] **Step 1: Write `src/lib/canvas/errors.ts`**

```ts
export class CanvasAuthError extends Error {
  constructor(message = 'Canvas token is invalid or expired') {
    super(message);
    this.name = 'CanvasAuthError';
  }
}

export class CanvasApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CanvasApiError';
    this.status = status;
  }
}
```

- [ ] **Step 2: Write `src/lib/canvas/client.ts`**

```ts
import { getAccessToken, type CanvasConnectionRow } from './credentials';
import { CanvasAuthError, CanvasApiError } from './errors';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function requestWithRetry(url: string, token: string, attempt = 1): Promise<Response> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 401) throw new CanvasAuthError();

  if (res.status === 429 || res.status === 403 || res.status >= 500) {
    if (attempt >= 3) {
      throw new CanvasApiError(`Canvas request failed after ${attempt} attempts (status ${res.status})`, res.status);
    }
    await sleep(2 ** attempt * 500); // 1s, 2s, 4s
    return requestWithRetry(url, token, attempt + 1);
  }

  if (!res.ok) throw new CanvasApiError(`Canvas request failed (status ${res.status})`, res.status);

  const remaining = res.headers.get('X-Rate-Limit-Remaining');
  if (remaining !== null && Number(remaining) < 10) {
    await sleep(1000);
  }

  return res;
}

/** Fetches every page of a Canvas list endpoint (following the Link header) and returns the combined array. */
export async function canvasGetAll(
  connection: CanvasConnectionRow,
  path: string,
  params: Record<string, string | string[]> = {},
): Promise<unknown[]> {
  const token = getAccessToken(connection);
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach(v => qs.append(key, v));
    else qs.append(key, value);
  }
  qs.set('per_page', '100');

  let url: string | null = `${connection.base_url.replace(/\/$/, '')}/api/v1${path}?${qs.toString()}`;
  const results: unknown[] = [];

  while (url) {
    const res  = await requestWithRetry(url, token);
    const page = (await res.json()) as unknown[];
    results.push(...page);
    url = parseNextLink(res.headers.get('Link'));
  }

  return results;
}

/** Validates a token by fetching the connected Canvas user's own profile. Throws CanvasAuthError on a bad token. */
export async function canvasValidateToken(baseUrl: string, token: string): Promise<{ id: number; name: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/users/self`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new CanvasAuthError('Invalid Canvas access token');
  if (!res.ok) throw new CanvasApiError(`Could not reach Canvas at ${baseUrl} (status ${res.status})`, res.status);
  const data = await res.json() as { id: number; name: string };
  return { id: data.id, name: data.name };
}
```

- [ ] **Step 3: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification against a real Canvas account**

This module talks to a live external API — there's nothing to unit test without a real token. Write a throwaway script, run it once with your own Canvas base URL and a PAT generated from your Canvas Settings page, confirm pagination and the shape of the response, then delete it:

```js
// scratch-verify-client.mjs — delete after running
const { canvasValidateToken, canvasGetAll } = await import('./src/lib/canvas/client.ts');

const baseUrl = 'https://YOUR-INSTITUTION.instructure.com'; // replace
const token   = 'YOUR_PAT_HERE'; // replace, from Canvas Settings > New Access Token

const user = await canvasValidateToken(baseUrl, token);
console.log('Authenticated as:', user);

const fakeConnection = { base_url: baseUrl, access_token_enc: null, token_iv: null, token_tag: null } as never;
// canvasGetAll needs a real getAccessToken() call, so test pagination via a direct fetch loop instead
// if courses/assignments volume is low, just confirm the shape:
const res = await fetch(`${baseUrl}/api/v1/courses?enrollment_state=active&per_page=100`, {
  headers: { Authorization: `Bearer ${token}` },
});
console.log('Courses:', await res.json());
```

Run: `npx tsx scratch-verify-client.mjs`
Expected: your real course list prints, matching what you see in the Canvas UI. Then delete the script (`rm scratch-verify-client.mjs`) — it contains a real token, do not leave it on disk.

- [ ] **Checkpoint:** client correctly authenticates and lists real courses. Move to Task 4.

---

### Task 4: Response Normalizer

**Files:**
- Create: `src/lib/canvas/normalize.ts`

**Interfaces:**
- Produces: `normalizeCourse(raw: RawCourse): NormalizedCourse`, `normalizeAssignment(raw: RawAssignment): NormalizedAssignment`, types `NormalizedCourse`, `NormalizedAssignment`.
- No dependency on any other Task's code — pure functions only.

- [ ] **Step 1: Write `src/lib/canvas/normalize.ts`**

```ts
export interface NormalizedCourse {
  canvasCourseId: number;
  name:           string;
  courseCode:     string | null;
  term:           string | null;
  workflowState:  string | null;
  startAt:        string | null;
  endAt:          string | null;
}

interface RawCourse {
  id: number;
  name: string;
  course_code?: string;
  term?: { name?: string } | null;
  workflow_state?: string;
  start_at?: string | null;
  end_at?: string | null;
}

export function normalizeCourse(raw: RawCourse): NormalizedCourse {
  return {
    canvasCourseId: raw.id,
    name:           raw.name,
    courseCode:     raw.course_code ?? null,
    term:           raw.term?.name ?? null,
    workflowState:  raw.workflow_state ?? null,
    startAt:        raw.start_at ?? null,
    endAt:          raw.end_at ?? null,
  };
}

export interface NormalizedAssignment {
  canvasAssignmentId:     number;
  canvasCourseId:         number;
  name:                   string;
  dueAt:                  string | null;
  pointsPossible:         number | null;
  htmlUrl:                string | null;
  canvasUpdatedAt:        string;
  submissionStatus:       string | null;
  submissionScore:        number | null;
  submissionSubmittedAt:  string | null;
}

interface RawSubmission {
  workflow_state?: string;
  score?: number | null;
  submitted_at?: string | null;
}

interface RawAssignment {
  id: number;
  course_id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  html_url?: string;
  updated_at: string;
  submission?: RawSubmission;
}

export function normalizeAssignment(raw: RawAssignment): NormalizedAssignment {
  return {
    canvasAssignmentId:    raw.id,
    canvasCourseId:        raw.course_id,
    name:                  raw.name,
    dueAt:                 raw.due_at ?? null,
    pointsPossible:        raw.points_possible ?? null,
    htmlUrl:               raw.html_url ?? null,
    canvasUpdatedAt:       raw.updated_at,
    submissionStatus:      raw.submission?.workflow_state ?? null,
    submissionScore:       raw.submission?.score ?? null,
    submissionSubmittedAt: raw.submission?.submitted_at ?? null,
  };
}
```

- [ ] **Step 2: Write and run a throwaway verification script using realistic sample Canvas JSON**

Create `scratch-verify-normalize.mjs` (delete after running):

```js
import assert from 'node:assert';
const { normalizeCourse, normalizeAssignment } = await import('./src/lib/canvas/normalize.ts');

const sampleCourse = {
  id: 12345, name: 'CS 101 - Data Structures', course_code: 'CS101',
  term: { name: 'Fall 2026' }, workflow_state: 'available',
  start_at: '2026-08-01T00:00:00Z', end_at: '2026-12-15T00:00:00Z',
};
const course = normalizeCourse(sampleCourse);
assert.strictEqual(course.canvasCourseId, 12345);
assert.strictEqual(course.term, 'Fall 2026');

const sampleCourseNoTerm = { id: 999, name: 'No Term Course' };
const course2 = normalizeCourse(sampleCourseNoTerm);
assert.strictEqual(course2.term, null);
assert.strictEqual(course2.courseCode, null);

const sampleAssignment = {
  id: 555, course_id: 12345, name: 'Final Project',
  due_at: '2026-08-28T13:00:00Z', points_possible: 100,
  html_url: 'https://school.instructure.com/courses/12345/assignments/555',
  updated_at: '2026-08-15T10:00:00Z',
  submission: { workflow_state: 'graded', score: 95, submitted_at: '2026-08-27T20:00:00Z' },
};
const assignment = normalizeAssignment(sampleAssignment);
assert.strictEqual(assignment.submissionScore, 95);
assert.strictEqual(assignment.submissionStatus, 'graded');

const sampleUngraded = {
  id: 556, course_id: 12345, name: 'Ungraded Assignment',
  due_at: null, points_possible: 50, updated_at: '2026-08-15T10:00:00Z',
};
const assignment2 = normalizeAssignment(sampleUngraded);
assert.strictEqual(assignment2.submissionScore, null);
assert.strictEqual(assignment2.submissionStatus, null);
assert.strictEqual(assignment2.dueAt, null);

console.log('normalize.ts verification passed');
```

Run: `npx tsx scratch-verify-normalize.mjs`
Expected: `normalize.ts verification passed`.

- [ ] **Step 3: Delete the scratch script**

```bash
rm scratch-verify-normalize.mjs
```

- [ ] **Step 4: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Checkpoint:** normalizer handles both fully-populated and sparse Canvas responses correctly. Move to Task 5.

---

### Task 5: Connect / Disconnect Routes

**Files:**
- Create: `src/app/api/canvas/connect/route.ts`
- Create: `src/app/api/canvas/disconnect/route.ts`

**Interfaces:**
- Consumes: `ensureCanvasSchema()` (Task 1), `canvasValidateToken()` (Task 3), `encryptToken()` (Task 2).

- [ ] **Step 1: Write `src/app/api/canvas/connect/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureCanvasSchema } from '@/lib/migrate';
import { canvasValidateToken } from '@/lib/canvas/client';
import { encryptToken } from '@/lib/canvas/credentials';
import { CanvasAuthError, CanvasApiError } from '@/lib/canvas/errors';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCanvasSchema();

  const { base_url, access_token } = await req.json();
  if (!base_url || !access_token) {
    return Response.json({ error: 'base_url and access_token are required' }, { status: 400 });
  }

  const cleanBaseUrl = String(base_url).trim().replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9.-]+\.instructure\.com$/i.test(cleanBaseUrl) && !/^https?:\/\//.test(cleanBaseUrl)) {
    return Response.json({ error: 'base_url must be a valid URL, e.g. https://yourschool.instructure.com' }, { status: 400 });
  }

  let canvasUser: { id: number; name: string };
  try {
    canvasUser = await canvasValidateToken(cleanBaseUrl, access_token);
  } catch (err) {
    if (err instanceof CanvasAuthError) {
      return Response.json({ error: 'Canvas rejected that access token. Double-check you copied it correctly.' }, { status: 400 });
    }
    if (err instanceof CanvasApiError) {
      return Response.json({ error: `Could not reach Canvas at ${cleanBaseUrl}. Check the domain is correct.` }, { status: 400 });
    }
    throw err;
  }

  const { enc, iv, tag } = encryptToken(access_token);
  const userId = parseInt(session.user.id);

  await pool.execute(
    `INSERT INTO canvas_connections
       (user_id, base_url, canvas_user_id, canvas_user_name, access_token_enc, token_iv, token_tag, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
     ON DUPLICATE KEY UPDATE
       base_url = VALUES(base_url), canvas_user_id = VALUES(canvas_user_id),
       canvas_user_name = VALUES(canvas_user_name), access_token_enc = VALUES(access_token_enc),
       token_iv = VALUES(token_iv), token_tag = VALUES(token_tag), status = 'active', last_error = NULL`,
    [userId, cleanBaseUrl, canvasUser.id, canvasUser.name, enc, iv, tag],
  );

  return Response.json({ status: 'success', canvas_user_name: canvasUser.name });
}
```

- [ ] **Step 2: Write `src/app/api/canvas/disconnect/route.ts`**

```ts
import { auth } from '@/auth';
import pool from '@/lib/db';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  await pool.execute(
    `UPDATE canvas_connections
        SET status = 'disconnected', access_token_enc = NULL, token_iv = NULL, token_tag = NULL
      WHERE user_id = ?`,
    [userId],
  );

  return Response.json({ status: 'success' });
}
```

- [ ] **Step 3: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Verify the schema gets created on first hit, and connect/disconnect work end-to-end**

Start the dev server if not already running (`npm run dev` in a separate terminal), then, while logged in via the browser (grab your session cookie from devtools, or test through the browser directly once Task 13 adds a UI — for now, confirm the route mounts and the schema materializes):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/canvas/connect
```
Expected: `405` (POST-only route hit with GET) or a redirect — confirms the route compiles and mounts, matching this project's existing route-check convention.

```bash
"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SHOW TABLES LIKE 'canvas_%';"
```
Expected: still empty until the route actually runs once with a valid session — full end-to-end connect/disconnect verification happens in Task 13 once the UI exists to drive it with a real session cookie.

- [ ] **Checkpoint:** routes compile and mount correctly. Full functional verification deferred to Task 13 (needs the UI to authenticate through the browser). Move to Task 6.

---

### Task 6: Sync Engine — Course Discovery

**Files:**
- Create: `src/lib/canvas/sync.ts`

**Interfaces:**
- Consumes: `CanvasConnectionRow` (Task 2), `canvasGetAll()` (Task 3), `normalizeCourse()` (Task 4).
- Produces (this task): `discoverCourses(connection: CanvasConnectionRow): Promise<number>` (returns count of courses seen) — internal helper, not yet exported from the module's public surface beyond what Task 7/8 build on.

- [ ] **Step 1: Write the course-discovery portion of `src/lib/canvas/sync.ts`**

```ts
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { canvasGetAll } from './client';
import { normalizeCourse } from './normalize';
import type { CanvasConnectionRow } from './credentials';

async function discoverCourses(connection: CanvasConnectionRow): Promise<number> {
  const raw = await canvasGetAll(connection, '/courses', {
    'enrollment_state': 'active',
    'include[]': 'term',
  });

  let count = 0;
  for (const rawCourse of raw) {
    const course = normalizeCourse(rawCourse as never);
    await pool.execute(
      `INSERT INTO canvas_courses
         (connection_id, canvas_course_id, name, course_code, term, workflow_state, start_at, end_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), course_code = VALUES(course_code), term = VALUES(term),
         workflow_state = VALUES(workflow_state), start_at = VALUES(start_at),
         end_at = VALUES(end_at), last_seen_at = NOW()`,
      [
        connection.id, course.canvasCourseId, course.name, course.courseCode,
        course.term, course.workflowState, course.startAt, course.endAt,
      ],
    );
    count++;
  }
  return count;
}

export interface CanvasCourseRow extends RowDataPacket {
  id:                number;
  connection_id:     number;
  canvas_course_id:  number;
  name:              string;
  mapping_status:    'pending' | 'linked' | 'created' | 'ignored';
  user_subject_id:   number | null;
}

async function getMappedCourses(connectionId: number): Promise<CanvasCourseRow[]> {
  const [rows] = await pool.execute<CanvasCourseRow[]>(
    `SELECT * FROM canvas_courses WHERE connection_id = ? AND mapping_status IN ('linked','created')`,
    [connectionId],
  );
  return rows;
}

export { discoverCourses, getMappedCourses };
```

- [ ] **Step 2: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors (note: `ResultSetHeader` import is unused at this point — that's fine, it's used in Task 7; if `tsc`/eslint flags unused imports, remove it here and re-add in Task 7).

- [ ] **Checkpoint:** course discovery upserts correctly (functional verification happens with real data in Task 9's manual-sync check). Move to Task 7.

---

### Task 7: Sync Engine — Assignment Fetch + Change Detection

**Files:**
- Modify: `src/lib/canvas/sync.ts`

**Interfaces:**
- Consumes: `getMappedCourses()`, `discoverCourses()` (Task 6), `normalizeAssignment()` (Task 4), `canvasGetAll()` (Task 3).
- Produces: `submissionFieldsChanged(storedStatus, storedScore, freshStatus, freshScore): boolean` (pure, exported for direct verification), `syncCourseAssignments(connection, course, runId): Promise<{fetched: number; changed: number}>`.

- [ ] **Step 1: Add the pure diff helper and assignment-sync logic to `src/lib/canvas/sync.ts`**

Append to the file:

```ts
import { normalizeAssignment, type NormalizedAssignment } from './normalize';

/** Pure: true if the connected student's submission state differs from what's stored. */
export function submissionFieldsChanged(
  storedStatus: string | null, storedScore: number | null,
  freshStatus:  string | null, freshScore:  number | null,
): boolean {
  return storedStatus !== freshStatus || storedScore !== freshScore;
}

interface BankRow extends RowDataPacket {
  id:                 number;
  due_at:             string | null;
  submission_status:  string | null;
  submission_score:   number | null;
  canvas_updated_at:  string;
  bank_status:        'pending' | 'included' | 'ignored' | 'removed_upstream';
}

async function logEvent(
  connectionId: number, bankItemId: number | null,
  eventType: 'assignment_created' | 'due_date_changed' | 'score_changed' | 'submission_status_changed',
  oldData: unknown, newData: unknown,
): Promise<void> {
  await pool.execute(
    `INSERT INTO canvas_sync_events (connection_id, bank_item_id, event_type, old_data, new_data)
     VALUES (?, ?, ?, ?, ?)`,
    [connectionId, bankItemId, eventType, JSON.stringify(oldData), JSON.stringify(newData)],
  );
}

async function upsertAssignment(
  connection: CanvasConnectionRow, courseRowId: number, runId: number, a: NormalizedAssignment,
): Promise<boolean> {
  const [existing] = await pool.execute<BankRow[]>(
    `SELECT * FROM canvas_activity_bank WHERE connection_id = ? AND canvas_assignment_id = ?`,
    [connection.id, a.canvasAssignmentId],
  );

  if (existing.length === 0) {
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO canvas_activity_bank
         (connection_id, course_id, canvas_assignment_id, name, due_at, points_possible, html_url,
          submission_status, submission_score, submission_submitted_at, canvas_updated_at,
          last_synced_at, last_change_at, last_seen_sync_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)`,
      [
        connection.id, courseRowId, a.canvasAssignmentId, a.name, a.dueAt, a.pointsPossible, a.htmlUrl,
        a.submissionStatus, a.submissionScore, a.submissionSubmittedAt, a.canvasUpdatedAt, runId,
      ],
    );
    await logEvent(connection.id, res.insertId, 'assignment_created', null, { name: a.name, dueAt: a.dueAt });
    return true;
  }

  const stored = existing[0];
  const metadataChanged = stored.canvas_updated_at !== a.canvasUpdatedAt;
  const submissionChanged = submissionFieldsChanged(
    stored.submission_status, stored.submission_score, a.submissionStatus, a.submissionScore,
  );

  if (!metadataChanged && !submissionChanged) {
    await pool.execute(
      `UPDATE canvas_activity_bank SET last_synced_at = NOW(), last_seen_sync_run_id = ? WHERE id = ?`,
      [runId, stored.id],
    );
    return false;
  }

  if (metadataChanged && stored.due_at !== a.dueAt) {
    await logEvent(connection.id, stored.id, 'due_date_changed', { dueAt: stored.due_at }, { dueAt: a.dueAt });
  }
  if (submissionChanged && stored.submission_score !== a.submissionScore) {
    await logEvent(connection.id, stored.id, 'score_changed',
      { score: stored.submission_score }, { score: a.submissionScore });
  }
  if (submissionChanged && stored.submission_status !== a.submissionStatus) {
    await logEvent(connection.id, stored.id, 'submission_status_changed',
      { status: stored.submission_status }, { status: a.submissionStatus });
  }

  await pool.execute(
    `UPDATE canvas_activity_bank SET
       name = ?, due_at = ?, points_possible = ?, html_url = ?,
       submission_status = ?, submission_score = ?, submission_submitted_at = ?,
       canvas_updated_at = ?, last_synced_at = NOW(), last_change_at = NOW(), last_seen_sync_run_id = ?
     WHERE id = ?`,
    [
      a.name, a.dueAt, a.pointsPossible, a.htmlUrl, a.submissionStatus, a.submissionScore,
      a.submissionSubmittedAt, a.canvasUpdatedAt, runId, stored.id,
    ],
  );

  if (stored.bank_status === 'included') {
    await propagateToLinkedEntry(stored.id, a);
  }

  return true;
}

async function syncCourseAssignments(
  connection: CanvasConnectionRow, course: CanvasCourseRow, runId: number,
): Promise<{ fetched: number; changed: number }> {
  const raw = await canvasGetAll(connection, `/courses/${course.canvas_course_id}/assignments`, {
    'include[]': 'submission',
  });

  let changed = 0;
  for (const rawAssignment of raw) {
    const a = normalizeAssignment(rawAssignment as never);
    const didChange = await upsertAssignment(connection, course.id, runId, a);
    if (didChange) changed++;
  }

  return { fetched: raw.length, changed };
}

export { syncCourseAssignments };
```

Note `propagateToLinkedEntry` is a forward reference to Task 11 (created there, in the same `sync.ts` file) — add a placeholder stub now so this compiles, replaced with the real implementation in Task 11:

```ts
async function propagateToLinkedEntry(_bankItemId: number, _fresh: NormalizedAssignment): Promise<void> {
  // Implemented in Task 11 once canvas_entry_links exists and is populated.
}
```

- [ ] **Step 2: Write and run a throwaway verification script for `submissionFieldsChanged`**

Create `scratch-verify-diff.mjs` (delete after running):

```js
import assert from 'node:assert';
const { submissionFieldsChanged } = await import('./src/lib/canvas/sync.ts');

assert.strictEqual(submissionFieldsChanged(null, null, null, null), false, 'both unset = no change');
assert.strictEqual(submissionFieldsChanged('graded', 95, 'graded', 95), false, 'identical = no change');
assert.strictEqual(submissionFieldsChanged('submitted', null, 'graded', 95), true, 'status+score both changed');
assert.strictEqual(submissionFieldsChanged('graded', 95, 'graded', 98), true, 'regrade should be detected');
assert.strictEqual(submissionFieldsChanged(null, null, 'submitted', null), true, 'first submission should be detected');

console.log('submissionFieldsChanged verification passed');
```

Run: `npx tsx scratch-verify-diff.mjs`
Expected: `submissionFieldsChanged verification passed`.

- [ ] **Step 3: Delete the scratch script**

```bash
rm scratch-verify-diff.mjs
```

- [ ] **Step 4: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Checkpoint:** change detection correctly distinguishes metadata changes from submission changes. Move to Task 8.

---

### Task 8: Sync Engine — Removal Sweep + Run Finalization

**Files:**
- Modify: `src/lib/canvas/sync.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–7.
- Produces: `syncConnection(connectionId: number, trigger: 'cron' | 'manual'): Promise<SyncResult>`, `type SyncResult = { runId: number; status: 'success'|'partial'|'failed'; coursesSynced: number; itemsFetched: number; itemsChanged: number }`.

- [ ] **Step 1: Add the removal sweep and top-level orchestration to `src/lib/canvas/sync.ts`**

```ts
interface SyncError {
  stage: string;
  canvas_course_id?: number;
  message: string;
  retryable: boolean;
}

async function sweepRemovedAssignments(courseRowId: number, runId: number): Promise<void> {
  const [stale] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM canvas_activity_bank
      WHERE course_id = ? AND last_seen_sync_run_id != ? AND bank_status != 'removed_upstream'`,
    [courseRowId, runId],
  );
  for (const row of stale) {
    await pool.execute(`UPDATE canvas_activity_bank SET bank_status = 'removed_upstream' WHERE id = ?`, [row.id]);
  }
  if (stale.length > 0) {
    const [connRows] = await pool.execute<RowDataPacket[]>(
      `SELECT connection_id FROM canvas_courses WHERE id = ?`, [courseRowId],
    );
    const connectionId = connRows[0].connection_id as number;
    for (const row of stale) {
      await logEvent(connectionId, row.id as number, 'assignment_created', null, null); // placeholder overwritten below
    }
  }
}
```

Replace that last loop — `assignment_removed` isn't in the `logEvent` type union yet; widen it:

```ts
async function logEvent(
  connectionId: number, bankItemId: number | null,
  eventType: 'assignment_created' | 'due_date_changed' | 'score_changed' | 'submission_status_changed' | 'assignment_removed',
  oldData: unknown, newData: unknown,
): Promise<void> {
  await pool.execute(
    `INSERT INTO canvas_sync_events (connection_id, bank_item_id, event_type, old_data, new_data)
     VALUES (?, ?, ?, ?, ?)`,
    [connectionId, bankItemId, eventType, JSON.stringify(oldData), JSON.stringify(newData)],
  );
}
```

And fix the sweep to use the correct event type:

```ts
async function sweepRemovedAssignments(courseRowId: number, runId: number): Promise<void> {
  const [stale] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM canvas_activity_bank
      WHERE course_id = ? AND last_seen_sync_run_id != ? AND bank_status != 'removed_upstream'`,
    [courseRowId, runId],
  );
  if (stale.length === 0) return;

  const [connRows] = await pool.execute<RowDataPacket[]>(
    `SELECT connection_id FROM canvas_courses WHERE id = ?`, [courseRowId],
  );
  const connectionId = connRows[0].connection_id as number;

  for (const row of stale) {
    await pool.execute(`UPDATE canvas_activity_bank SET bank_status = 'removed_upstream' WHERE id = ?`, [row.id]);
    await logEvent(connectionId, row.id as number, 'assignment_removed', null, null);
  }
}

export interface SyncResult {
  runId:         number;
  status:        'success' | 'partial' | 'failed';
  coursesSynced: number;
  itemsFetched:  number;
  itemsChanged:  number;
}

export async function syncConnection(connectionId: number, trigger: 'cron' | 'manual'): Promise<SyncResult> {
  const [connRows] = await pool.execute<CanvasConnectionRow[]>(
    `SELECT * FROM canvas_connections WHERE id = ? AND status = 'active'`, [connectionId],
  );
  if (connRows.length === 0) {
    throw new Error(`No active Canvas connection ${connectionId}`);
  }
  const connection = connRows[0];

  const [runRes] = await pool.execute<ResultSetHeader>(
    `INSERT INTO canvas_sync_runs (connection_id, trigger_source, started_at, status) VALUES (?, ?, NOW(), 'running')`,
    [connectionId, trigger],
  );
  const runId = runRes.insertId;

  const errors: SyncError[] = [];
  let coursesSynced = 0, itemsFetched = 0, itemsChanged = 0;

  try {
    await discoverCourses(connection);
  } catch (err) {
    const { CanvasAuthError } = await import('./errors');
    if (err instanceof CanvasAuthError) {
      await pool.execute(`UPDATE canvas_connections SET status = 'invalid', last_error = ? WHERE id = ?`,
        ['Canvas token is invalid or expired', connectionId]);
      await pool.execute(
        `UPDATE canvas_sync_runs SET status = 'failed', finished_at = NOW(), errors_json = ? WHERE id = ?`,
        [JSON.stringify([{ stage: 'discoverCourses', message: 'Auth failed', retryable: false }]), runId],
      );
      return { runId, status: 'failed', coursesSynced: 0, itemsFetched: 0, itemsChanged: 0 };
    }
    const message = err instanceof Error ? err.message : String(err);
    await pool.execute(
      `UPDATE canvas_sync_runs SET status = 'failed', finished_at = NOW(), errors_json = ? WHERE id = ?`,
      [JSON.stringify([{ stage: 'discoverCourses', message, retryable: true }]), runId],
    );
    await pool.execute(`UPDATE canvas_connections SET last_sync_status = 'failed', last_error = ? WHERE id = ?`,
      [message, connectionId]);
    return { runId, status: 'failed', coursesSynced: 0, itemsFetched: 0, itemsChanged: 0 };
  }

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

  const status: SyncResult['status'] = errors.length === 0 ? 'success' : coursesSynced > 0 ? 'partial' : 'failed';

  await pool.execute(
    `UPDATE canvas_sync_runs SET status = ?, finished_at = NOW(), courses_synced = ?, items_fetched = ?,
       items_changed = ?, errors_json = ? WHERE id = ?`,
    [status, coursesSynced, itemsFetched, itemsChanged, errors.length ? JSON.stringify(errors) : null, runId],
  );
  await pool.execute(
    `UPDATE canvas_connections SET last_sync_at = NOW(), last_sync_status = ?, last_error = ? WHERE id = ?`,
    [status, errors.length ? errors[0].message : null, connectionId],
  );

  return { runId, status, coursesSynced, itemsFetched, itemsChanged };
}
```

- [ ] **Step 2: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors. If `CanvasConnectionRow[]` typing on `pool.execute` complains, confirm `CanvasConnectionRow extends RowDataPacket` (it does, from Task 2) — that's what makes it a valid generic for `execute`.

- [ ] **Checkpoint:** full sync orchestration compiles; functional verification (real courses/assignments) happens in Task 9 once there's a route to trigger it through. Move to Task 9.

---

### Task 9: Manual Sync + Cron Routes

**Files:**
- Create: `src/app/api/canvas/sync/manual/route.ts`
- Create: `src/app/api/canvas/sync/cron/route.ts`
- Create: `vercel.json`

**Interfaces:**
- Consumes: `syncConnection()` (Task 8).
- Produces: `syncAllDueConnections(maxConnections: number): Promise<void>`, added to `src/lib/canvas/sync.ts`.

- [ ] **Step 1: Add `syncAllDueConnections` to `src/lib/canvas/sync.ts`**

```ts
export async function syncAllDueConnections(maxConnections = 10): Promise<void> {
  const [due] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM canvas_connections
      WHERE status = 'active' AND (last_sync_at IS NULL OR last_sync_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE))
      ORDER BY last_sync_at IS NULL DESC, last_sync_at ASC
      LIMIT ?`,
    [maxConnections],
  );
  for (const row of due) {
    try {
      await syncConnection(row.id as number, 'cron');
    } catch {
      // Individual connection failures are already recorded on canvas_sync_runs/canvas_connections
      // inside syncConnection; continue to the next connection rather than aborting the batch.
    }
  }
}
```

- [ ] **Step 2: Add the env var**

```bash
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(24).toString('hex'))" >> .env.local
```

Note: originally implemented as `CANVAS_CRON_SECRET`, renamed to `CRON_SECRET` during final review (see Global Constraints) so Vercel's automatic cron auth header injection works without extra configuration.

- [ ] **Step 3: Write `src/app/api/canvas/sync/manual/route.ts`**

```ts
import { auth } from '@/auth';
import pool from '@/lib/db';
import { syncConnection } from '@/lib/canvas/sync';
import type { RowDataPacket } from 'mysql2';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM canvas_connections WHERE user_id = ? AND status = 'active'`, [userId],
  );
  if (rows.length === 0) {
    return Response.json({ error: 'No active Canvas connection' }, { status: 400 });
  }

  const result = await syncConnection(rows[0].id as number, 'manual');
  return Response.json(result);
}
```

- [ ] **Step 4: Write `src/app/api/canvas/sync/cron/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { syncAllDueConnections } from '@/lib/canvas/sync';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!process.env.CANVAS_CRON_SECRET || secret !== process.env.CANVAS_CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await syncAllDueConnections();
  return Response.json({ status: 'success' });
}
```

- [ ] **Step 5: Write `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/canvas/sync/cron", "schedule": "*/30 * * * *" }
  ]
}
```

Note: Vercel's Hobby tier has historically limited cron frequency (often to once/day) — check your actual plan's cron limits before relying on the 30-minute schedule; the manual Sync Now button (Step 3) works regardless of cron cadence.

- [ ] **Step 6: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Route-mount check**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/canvas/sync/cron
```
Expected: `401` (no secret provided) — confirms the route compiles, mounts, and its auth guard works.

- [ ] **Checkpoint:** sync can now be triggered by both paths; full functional verification (real Canvas data flowing through) happens once Task 13 provides a UI to connect through. Move to Task 10.

---

### Task 10: Course Mapping Routes

**Files:**
- Create: `src/app/api/canvas/courses/route.ts`
- Create: `src/app/api/canvas/courses/[id]/map/route.ts`

**Interfaces:**
- Consumes: `canvas_courses` table (Task 1), `user_subjects` table (existing).

- [ ] **Step 1: Write `src/app/api/canvas/courses/route.ts`**

```ts
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT cc.* FROM canvas_courses cc
     JOIN canvas_connections conn ON conn.id = cc.connection_id
     WHERE conn.user_id = ?
     ORDER BY cc.mapping_status = 'pending' DESC, cc.name ASC`,
    [userId],
  );
  return Response.json({ courses: rows });
}
```

- [ ] **Step 2: Write `src/app/api/canvas/courses/[id]/map/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await props.params;
  const courseRowId = parseInt(id);
  const userId = parseInt(session.user.id);
  const { mode, user_subject_id, subject_name, course_code, units, year_level, trimester } = await req.json();

  const [ownedCourse] = await pool.execute<RowDataPacket[]>(
    `SELECT cc.id, cc.name FROM canvas_courses cc
     JOIN canvas_connections conn ON conn.id = cc.connection_id
     WHERE cc.id = ? AND conn.user_id = ?`,
    [courseRowId, userId],
  );
  if (ownedCourse.length === 0) return Response.json({ error: 'Not found' }, { status: 404 });

  if (mode === 'ignore') {
    await pool.execute(`UPDATE canvas_courses SET mapping_status = 'ignored' WHERE id = ?`, [courseRowId]);
    return Response.json({ status: 'success' });
  }

  if (mode === 'link') {
    if (!user_subject_id) return Response.json({ error: 'user_subject_id required' }, { status: 400 });
    const [owned] = await pool.execute<RowDataPacket[]>(
      `SELECT user_subject_id FROM user_subjects WHERE user_subject_id = ? AND user_id = ?`,
      [user_subject_id, userId],
    );
    if (owned.length === 0) return Response.json({ error: 'Subject not found' }, { status: 404 });

    await pool.execute(
      `UPDATE canvas_courses SET mapping_status = 'linked', user_subject_id = ? WHERE id = ?`,
      [user_subject_id, courseRowId],
    );
    return Response.json({ status: 'success' });
  }

  if (mode === 'create') {
    if (!subject_name || !course_code || !year_level || !trimester) {
      return Response.json({ error: 'subject_name, course_code, year_level, trimester are required' }, { status: 400 });
    }
    const [subRes] = await pool.execute<ResultSetHeader>(
      `INSERT INTO subjects (subject_name, course_code, units, year_level, trimester) VALUES (?,?,?,?,?)`,
      [subject_name.trim(), course_code.trim(), Number(units) || 0, year_level, trimester],
    );
    const [usRes] = await pool.execute<ResultSetHeader>(
      `INSERT INTO user_subjects (user_id, subject_id) VALUES (?,?)`,
      [userId, subRes.insertId],
    );
    await pool.execute(
      `UPDATE canvas_courses SET mapping_status = 'created', user_subject_id = ? WHERE id = ?`,
      [usRes.insertId, courseRowId],
    );
    return Response.json({ status: 'success', user_subject_id: usRes.insertId });
  }

  return Response.json({ error: 'mode must be link, create, or ignore' }, { status: 400 });
}
```

This mirrors the existing subject-creation SQL in `src/app/api/studypulse/subjects/route.ts` exactly (same two-table insert), not duplicating new logic — just reusing the established pattern in a new call site, consistent with how course-creation should behave identically whether triggered manually or from Canvas mapping.

- [ ] **Step 3: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Route-mount check**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/canvas/courses
```
Expected: `307` (auth redirect) — matches this project's existing convention for confirming a route compiles and mounts without a server crash.

- [ ] **Checkpoint:** course mapping routes are in place. Move to Task 11.

---

### Task 11: Shared Entry-Insert Helper + Activity Bank Include/Ignore Routes

**Files:**
- Create: `src/lib/studypulseEntries.ts`
- Modify: `src/app/api/studypulse/entries/route.ts`
- Modify: `src/app/api/studypulse/grade-entries/route.ts`
- Create: `src/app/api/canvas/bank/route.ts`
- Create: `src/app/api/canvas/bank/[id]/include/route.ts`
- Create: `src/app/api/canvas/bank/[id]/ignore/route.ts`
- Modify: `src/lib/canvas/sync.ts` (replace the `propagateToLinkedEntry` stub from Task 7)

**Interfaces:**
- Produces: `insertActivityEntry()`, `insertQuizEntry()`, `insertExamEntry()`, `insertGradeEntry()` from `src/lib/studypulseEntries.ts` — same parameters and return shape (`{ entryId: number }`) as the inline logic they replace.

This task extracts the insert logic already in `entries/route.ts` and `grade-entries/route.ts` into a shared module, so the new Canvas Include action and the existing manual-entry forms can never drift out of sync on how a row gets created — directly serving the spec's "reused, not duplicated" requirement without importing across route-handler boundaries.

- [ ] **Step 1: Write `src/lib/studypulseEntries.ts`, extracting the exact SQL already in the two existing routes**

```ts
import pool from '@/lib/db';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface LegacyEntryInput {
  entryId?:        number | null;
  userSubjectId:   number;
  name:            string;
  specificType:    string;
  urgency:         string;
  status:          string;
  deadline:        string | null;
  score:           number | null;
  items:           number | null;
  grade:           number | null;
  accomplishedAt:  string | null;
}

export async function insertActivityEntry(input: LegacyEntryInput): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, name, specificType, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await pool.execute(
      'UPDATE activities SET activity_name=?,activity_type=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE activity_id=? AND user_subject_id=?',
      [name, specificType ?? '', urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    'INSERT INTO activities (user_subject_id,activity_name,activity_type,urgency,status,deadline,score,items,grade,accomplished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [userSubjectId, name, specificType ?? '', urgency, status, deadline, score, items, grade, accomplishedAt],
  );
  return { entryId: r.insertId };
}

export async function insertQuizEntry(input: LegacyEntryInput): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, name, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await pool.execute(
      'UPDATE quizzes SET quiz_name=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE quiz_id=? AND user_subject_id=?',
      [name, urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [mx] = await pool.execute<RowDataPacket[]>(
    'SELECT COALESCE(MAX(quiz_number),0)+1 AS next_num FROM quizzes WHERE user_subject_id=?', [userSubjectId],
  );
  const [r] = await pool.execute<ResultSetHeader>(
    'INSERT INTO quizzes (user_subject_id,quiz_name,quiz_number,urgency,status,deadline,score,items,grade,accomplished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [userSubjectId, name, mx[0].next_num, urgency, status, deadline, score, items, grade, accomplishedAt],
  );
  return { entryId: r.insertId };
}

export async function insertExamEntry(input: LegacyEntryInput): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, name, specificType, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await pool.execute(
      'UPDATE exams SET exam_name=?,exam_type=?,urgency=?,status=?,deadline=?,score=?,items=?,grade=?,accomplished_at=? WHERE exam_id=? AND user_subject_id=?',
      [name, specificType ?? '', urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    'INSERT INTO exams (user_subject_id,exam_name,exam_type,urgency,status,deadline,score,items,grade,accomplished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [userSubjectId, name, specificType ?? '', urgency, status, deadline, score, items, grade, accomplishedAt],
  );
  return { entryId: r.insertId };
}

export interface GradeEntryInput {
  entryId?:        number | null;
  userSubjectId:   number;
  catId:           number;
  periodId:        number;
  isLab:           boolean;
  name:            string;
  urgency:         string;
  status:          string;
  deadline:        string | null;
  score:           number | null;
  items:           number | null;
  grade:           number | null;
  accomplishedAt:  string | null;
}

export async function insertGradeEntry(input: GradeEntryInput): Promise<{ entryId: number }> {
  const { entryId, userSubjectId, catId, periodId, isLab, name, urgency, status, deadline, score, items, grade, accomplishedAt } = input;
  if (entryId) {
    await pool.execute(
      `UPDATE grade_entries SET cat_id=?, period_id=?, is_lab=?, name=?, urgency=?,
       status=?, deadline=?, score=?, items=?, grade=?, accomplished_at=?
       WHERE entry_id=? AND user_subject_id=?`,
      [catId, periodId, isLab ? 1 : 0, name, urgency, status, deadline, score, items, grade, accomplishedAt, entryId, userSubjectId],
    );
    return { entryId };
  }
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO grade_entries
       (user_subject_id, cat_id, period_id, is_lab, name, urgency, status, deadline, score, items, grade, accomplished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userSubjectId, catId, periodId, isLab ? 1 : 0, name, urgency, status, deadline, score, items, grade, accomplishedAt],
  );
  return { entryId: res.insertId };
}
```

- [ ] **Step 2: Update `src/app/api/studypulse/entries/route.ts` to call the helpers instead of inlining SQL**

Replace the `switch (type)` block's three cases with calls to the new helpers, keeping every other line (the auth check, `ensureAccomplishedAt()`, field parsing, response shape) exactly as-is:

```ts
  let newId: number;

  switch (type) {
    case 'activities': {
      const { entryId } = await insertActivityEntry({
        entryId: entry_id, userSubjectId: user_subject_id, name, specificType: specific_type,
        urgency, status, deadline: dl, score: s, items: it, grade: g, accomplishedAt: ac,
      });
      newId = entryId;
      break;
    }
    case 'quizzes': {
      const { entryId } = await insertQuizEntry({
        entryId: entry_id, userSubjectId: user_subject_id, name, specificType: specific_type,
        urgency, status, deadline: dl, score: s, items: it, grade: g, accomplishedAt: ac,
      });
      newId = entryId;
      break;
    }
    case 'exams': {
      const { entryId } = await insertExamEntry({
        entryId: entry_id, userSubjectId: user_subject_id, name, specificType: specific_type,
        urgency, status, deadline: dl, score: s, items: it, grade: g, accomplishedAt: ac,
      });
      newId = entryId;
      break;
    }
    default:
      return Response.json({ error: 'Invalid type' }, { status: 400 });
  }
```

Add the import at the top: `import { insertActivityEntry, insertQuizEntry, insertExamEntry } from '@/lib/studypulseEntries';`

- [ ] **Step 3: Update `src/app/api/studypulse/grade-entries/route.ts` similarly**

Replace the `try { if (entry_id) {...} else {...} }` body with:

```ts
  await ensureAccomplishedAt();
  const ac = accomplished_at || null;

  try {
    const { entryId } = await insertGradeEntry({
      entryId: entry_id, userSubjectId: user_subject_id, catId: cat_id, periodId: period_id,
      isLab: !!is_lab, name, urgency: urgency ?? 'Medium', status: status ?? 'Pending',
      deadline: deadline || null, score: score ?? null, items: items ?? null, grade: grade ?? null,
      accomplishedAt: ac,
    });
    return Response.json({ status: 'success', entry_id: entryId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
```

Add the import: `import { insertGradeEntry } from '@/lib/studypulseEntries';`

- [ ] **Step 4: Verify the refactor didn't change behavior**

```bash
npx tsc --noEmit
```
Expected: no errors.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/studypulse/entries -H "Content-Type: application/json" -d "{}"
```
Expected: same response code as before the refactor (`401` if unauthenticated, matching the unchanged `auth()` check at the top of the route) — confirms the route still mounts and behaves the same for malformed input.

- [ ] **Step 5: Write `src/app/api/canvas/bank/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  const status = req.nextUrl.searchParams.get('status') ?? 'pending';

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT bank.*, cc.name AS course_name, cc.user_subject_id
     FROM canvas_activity_bank bank
     JOIN canvas_courses cc ON cc.id = bank.course_id
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     WHERE conn.user_id = ? AND bank.bank_status = ?
     ORDER BY bank.due_at IS NULL, bank.due_at ASC`,
    [userId, status],
  );
  return Response.json({ items: rows });
}
```

- [ ] **Step 6: Write `src/app/api/canvas/bank/[id]/ignore/route.ts`**

```ts
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await props.params;
  const bankId = parseInt(id);
  const userId = parseInt(session.user.id);

  const [owned] = await pool.execute<RowDataPacket[]>(
    `SELECT bank.id FROM canvas_activity_bank bank
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     WHERE bank.id = ? AND conn.user_id = ?`,
    [bankId, userId],
  );
  if (owned.length === 0) return Response.json({ error: 'Not found' }, { status: 404 });

  await pool.execute(`UPDATE canvas_activity_bank SET bank_status = 'ignored' WHERE id = ?`, [bankId]);
  return Response.json({ status: 'success' });
}
```

- [ ] **Step 7: Write `src/app/api/canvas/bank/[id]/include/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import {
  insertActivityEntry, insertQuizEntry, insertExamEntry, insertGradeEntry,
} from '@/lib/studypulseEntries';

interface BankItemRow extends RowDataPacket {
  id: number; name: string; due_at: string | null; submission_score: number | null;
  user_subject_id: number;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await props.params;
  const bankId = parseInt(id);
  const userId = parseInt(session.user.id);
  const { target_type, cat_id, period_id } = await req.json();
  // target_type: 'activities' | 'quizzes' | 'exams' | 'grade_entries'

  const [rows] = await pool.execute<BankItemRow[]>(
    `SELECT bank.id, bank.name, bank.due_at, bank.submission_score, cc.user_subject_id
     FROM canvas_activity_bank bank
     JOIN canvas_courses cc ON cc.id = bank.course_id
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     WHERE bank.id = ? AND conn.user_id = ?`,
    [bankId, userId],
  );
  if (rows.length === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  const item = rows[0];
  if (!item.user_subject_id) {
    return Response.json({ error: 'This item\'s course is not linked to a subject yet' }, { status: 400 });
  }

  const deadline = item.due_at ? item.due_at.slice(0, 10) : null;
  const commonFields = {
    entryId: null, userSubjectId: item.user_subject_id, name: item.name,
    specificType: '', urgency: 'Medium', status: 'Pending', deadline,
    score: null, items: null, grade: item.submission_score, accomplishedAt: null,
  };

  let linkColumn: 'activity_id' | 'quiz_id' | 'exam_id' | 'grade_entry_id';
  let newEntryId: number;

  if (target_type === 'activities') {
    newEntryId = (await insertActivityEntry(commonFields)).entryId;
    linkColumn = 'activity_id';
  } else if (target_type === 'quizzes') {
    newEntryId = (await insertQuizEntry(commonFields)).entryId;
    linkColumn = 'quiz_id';
  } else if (target_type === 'exams') {
    newEntryId = (await insertExamEntry(commonFields)).entryId;
    linkColumn = 'exam_id';
  } else if (target_type === 'grade_entries') {
    if (!cat_id || !period_id) {
      return Response.json({ error: 'cat_id and period_id are required for grade_entries' }, { status: 400 });
    }
    newEntryId = (await insertGradeEntry({ ...commonFields, catId: cat_id, periodId: period_id, isLab: false })).entryId;
    linkColumn = 'grade_entry_id';
  } else {
    return Response.json({ error: 'Invalid target_type' }, { status: 400 });
  }

  await pool.execute(
    `INSERT INTO canvas_entry_links (bank_item_id, ${linkColumn}) VALUES (?, ?)`,
    [bankId, newEntryId],
  );
  await pool.execute(`UPDATE canvas_activity_bank SET bank_status = 'included' WHERE id = ?`, [bankId]);

  return Response.json({ status: 'success', entry_id: newEntryId });
}
```

- [ ] **Step 8: Replace the `propagateToLinkedEntry` stub in `src/lib/canvas/sync.ts` (from Task 7) with the real implementation**

```ts
async function propagateToLinkedEntry(bankItemId: number, fresh: NormalizedAssignment): Promise<void> {
  const [linkRows] = await pool.execute<RowDataPacket[]>(
    `SELECT activity_id, quiz_id, exam_id, grade_entry_id FROM canvas_entry_links WHERE bank_item_id = ?`,
    [bankItemId],
  );
  if (linkRows.length === 0) return;
  const link = linkRows[0];
  const deadline = fresh.dueAt ? fresh.dueAt.slice(0, 10) : null;
  const grade = fresh.submissionScore;

  if (link.activity_id) {
    await pool.execute('UPDATE activities SET deadline = ?, grade = ? WHERE activity_id = ?', [deadline, grade, link.activity_id]);
  } else if (link.quiz_id) {
    await pool.execute('UPDATE quizzes SET deadline = ?, grade = ? WHERE quiz_id = ?', [deadline, grade, link.quiz_id]);
  } else if (link.exam_id) {
    await pool.execute('UPDATE exams SET deadline = ?, grade = ? WHERE exam_id = ?', [deadline, grade, link.exam_id]);
  } else if (link.grade_entry_id) {
    await pool.execute('UPDATE grade_entries SET deadline = ?, grade = ? WHERE entry_id = ?', [deadline, grade, link.grade_entry_id]);
  }
}
```

- [ ] **Step 9: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 10: Route-mount checks**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/canvas/bank
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/canvas/bank/1/include
```
Expected: `307` / `401`-class responses (auth redirect), confirming both routes mount.

- [ ] **Checkpoint:** Include/Ignore are fully wired, deadline+score propagation is live, and the entry-insert logic has exactly one source of truth. Move to Task 12.

---

### Task 12: `canvas_linked` Flag on Existing Entries + Override Confirm Dialog

**Files:**
- Modify: `src/app/studypulse/[id]/page.tsx`
- Modify: `src/components/studypulse/SubjectCardView.tsx`

**Interfaces:**
- `EntryRow` gains `canvas_linked?: boolean`.

- [ ] **Step 1: Add the join to the four entry queries in `src/app/studypulse/[id]/page.tsx`**

The legacy queries (around line 139–155) become:

```ts
    const [actRows] = await pool.execute<RowDataPacket[]>(`
      SELECT a.activity_id AS id, a.activity_name AS name, a.activity_type AS specificType,
             a.urgency, a.status, a.deadline, a.score, a.items, a.grade, a.accomplished_at,
             (cel.activity_id IS NOT NULL) AS canvas_linked
      FROM activities a
      LEFT JOIN canvas_entry_links cel ON cel.activity_id = a.activity_id
      WHERE a.user_subject_id=? ORDER BY a.activity_id ASC
    `, [userSubjectId]);

    const [quizRows] = await pool.execute<RowDataPacket[]>(`
      SELECT q.quiz_id AS id, q.quiz_name AS name, q.quiz_number AS specificType,
             q.urgency, q.status, q.deadline, q.score, q.items, q.grade, q.accomplished_at,
             (cel.quiz_id IS NOT NULL) AS canvas_linked
      FROM quizzes q
      LEFT JOIN canvas_entry_links cel ON cel.quiz_id = q.quiz_id
      WHERE q.user_subject_id=? ORDER BY q.quiz_number ASC
    `, [userSubjectId]);

    const [examRows] = await pool.execute<RowDataPacket[]>(`
      SELECT e.exam_id AS id, e.exam_name AS name, e.exam_type AS specificType,
             e.urgency, e.status, e.deadline, e.score, e.items, e.grade, e.accomplished_at,
             (cel.exam_id IS NOT NULL) AS canvas_linked
      FROM exams e
      LEFT JOIN canvas_entry_links cel ON cel.exam_id = e.exam_id
      WHERE e.user_subject_id=? ORDER BY e.exam_id ASC
    `, [userSubjectId]);
```

Find the grade_entries query near line 90–105 (the one populating `initialGradeEntries`) and add the same join pattern: `LEFT JOIN canvas_entry_links cel ON cel.grade_entry_id = <alias>.entry_id`, selecting `(cel.grade_entry_id IS NOT NULL) AS canvas_linked`.

- [ ] **Step 2: Pass `canvas_linked` through `toEntry()` and the `EntryRow` type**

In `src/components/studypulse/SubjectCardView.tsx`, update the interface (near line 22–34):

```ts
export interface EntryRow {
  id:              number;
  name:            string;
  specificType:    string;
  urgency:         Urgency;
  status:          EntryStatus;
  deadline:        string;
  accomplished_at: string;
  score:           string;
  items:           string;
  grade:           number | null;
  canvas_linked?:  boolean;
  saving?:         boolean;
}
```

Find `toEntry()` (used by `page.tsx` — search for `function toEntry` or `const toEntry`) and add `canvas_linked: !!r.canvas_linked,` to its return object, passing through the raw DB row's new column.

- [ ] **Step 3: Add the override-confirm guard to both `setField` functions**

In the legacy `setField` (around line 255):

```ts
  const setField = useCallback((idx: number, field: keyof EntryRow, val: string) => {
    const row = entries[idx];
    if (field === 'score' && row.canvas_linked) {
      const ok = window.confirm(
        `This score comes from Canvas. It will be overwritten by Canvas on the next sync — edit anyway?`
      );
      if (!ok) return;
    }
    onUpdate(entries.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, [field]: val };
      if (field === 'score' || field === 'items') {
        next.grade = calcGrade(
          field === 'score' ? val : r.score,
          field === 'items' ? val : r.items,
        );
        if (next.grade !== null) next.status = 'Done';
      }
      return next;
    }));
  }, [entries, onUpdate]);
```

Apply the identical guard (same condition, same confirm message) to the custom-mode `setField` around line 554, using `updateEntries` in place of `onUpdate` to match that function's existing update call.

- [ ] **Step 4: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual verification in the browser**

Start the dev server, open a subject that has at least one entry, confirm the page still loads and existing (non-Canvas-linked) entries can be edited without any prompt — the guard only fires when `canvas_linked` is true, which nothing is yet at this point in the plan (no real Include has happened through the UI). Full end-to-end verification of the prompt itself happens after Task 13 (UI) makes it possible to actually Include a real Canvas item.

- [ ] **Checkpoint:** existing grading UI is unaffected for non-Canvas entries; the guard is in place and ready. Move to Task 13.

---

### Task 13: Connect Panel UI

**Files:**
- Create: `src/components/studypulse/CanvasConnectPanel.tsx`

**Interfaces:**
- Consumes: `POST /api/canvas/connect`, `POST /api/canvas/disconnect` (Task 5).
- Produces: `<CanvasConnectPanel connection={...} onChange={...} />`, following the glass-panel visual style already established in `TargetGradePanel.tsx` (pink `#f2a7c0` / blue `#74bcd9` glassmorphism, no new design system).

- [ ] **Step 1: Write `src/components/studypulse/CanvasConnectPanel.tsx`**

```tsx
'use client';

import { useState } from 'react';

const GLASS: React.CSSProperties = {
  background:           'rgba(255,255,255,0.22)',
  backdropFilter:       'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  borderRadius:         '20px',
  border:               '1px solid rgba(255,255,255,0.35)',
  boxShadow:            '0 8px 28px rgba(0,0,0,0.12)',
};

export interface ConnectionStatus {
  connected:        boolean;
  canvas_user_name?: string;
  status?:          'active' | 'invalid' | 'disconnected';
  last_sync_at?:    string | null;
  last_sync_status?: 'success' | 'partial' | 'failed' | null;
}

export default function CanvasConnectPanel({
  connection, onChange,
}: {
  connection: ConnectionStatus;
  onChange:   () => void;
}) {
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch('/api/canvas/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: baseUrl, access_token: token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Connection failed');
      setToken('');
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await fetch('/api/canvas/disconnect', { method: 'POST' });
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch('/api/canvas/sync/manual', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (connection.connected) {
    return (
      <div style={{ ...GLASS, padding: '20px 24px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, color: '#333' }}>
            Connected to Canvas as {connection.canvas_user_name}
          </span>
          {connection.status === 'invalid' && (
            <span style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.85rem' }}>
              ⚠ Token expired — reconnect below
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#888' }}>
            {connection.last_sync_at
              ? `Last synced ${new Date(connection.last_sync_at).toLocaleString()} (${connection.last_sync_status})`
              : 'Never synced'}
          </span>
          <button onClick={syncNow} disabled={busy}
            style={{ background: 'linear-gradient(to right, #f2a7c0, #74bcd9)', color: 'white', border: 'none', borderRadius: '10px', padding: '8px 16px', fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? 'Syncing…' : 'Sync Now'}
          </button>
          <button onClick={disconnect} disabled={busy}
            style={{ background: 'rgba(240,240,245,0.9)', border: 'none', borderRadius: '10px', padding: '8px 16px', fontWeight: 700, color: '#888', cursor: 'pointer' }}>
            Disconnect
          </button>
        </div>
        {error && <div style={{ marginTop: '10px', color: '#dc2626', fontSize: '0.85rem' }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ ...GLASS, padding: '24px', marginBottom: '20px' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: '1.1rem', fontWeight: 800, color: '#333' }}>Connect Canvas</h2>
      <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '14px' }}>
        Enter your Canvas domain, then generate an access token from your Canvas Settings page
        (Account → Settings → New Access Token) and paste it below.
      </p>
      <input placeholder="https://yourschool.instructure.com" value={baseUrl}
        onChange={e => setBaseUrl(e.target.value)}
        style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(180,190,215,0.5)', marginBottom: '10px' }} />
      <input placeholder="Paste your Canvas access token" value={token} type="password"
        onChange={e => setToken(e.target.value)}
        style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(180,190,215,0.5)', marginBottom: '10px' }} />
      <button onClick={connect} disabled={busy || !baseUrl || !token}
        style={{ background: 'linear-gradient(to right, #f2a7c0, #74bcd9)', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 20px', fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? 'Connecting…' : 'Connect'}
      </button>
      {error && <div style={{ marginTop: '10px', color: '#dc2626', fontSize: '0.85rem' }}>{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Checkpoint:** component compiles standalone. Full render verification happens once Task 16 mounts it on a real page. Move to Task 14.

---

### Task 14: Course Mapping UI

**Files:**
- Create: `src/components/studypulse/CanvasCourseMapping.tsx`

**Interfaces:**
- Consumes: `GET /api/canvas/courses`, `POST /api/canvas/courses/[id]/map` (Task 10).

- [ ] **Step 1: Write `src/components/studypulse/CanvasCourseMapping.tsx`**

```tsx
'use client';

import { useState } from 'react';

interface CanvasCourse {
  id: number;
  canvas_course_id: number;
  name: string;
  course_code: string | null;
  term: string | null;
  mapping_status: 'pending' | 'linked' | 'created' | 'ignored';
  user_subject_id: number | null;
}

interface ExistingSubject {
  user_subject_id: number;
  subject_name: string;
}

const GLASS: React.CSSProperties = {
  background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  borderRadius: '20px', border: '1px solid rgba(255,255,255,0.35)', boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
};

export default function CanvasCourseMapping({
  courses, existingSubjects, onChange,
}: {
  courses: CanvasCourse[];
  existingSubjects: ExistingSubject[];
  onChange: () => void;
}) {
  const pending = courses.filter(c => c.mapping_status === 'pending');
  const [linkChoice, setLinkChoice] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const act = async (courseId: number, body: object) => {
    setBusy(courseId);
    try {
      const res  = await fetch(`/api/canvas/courses/${courseId}/map`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? 'Failed'); return; }
      onChange();
    } finally {
      setBusy(null);
    }
  };

  if (pending.length === 0) return null;

  return (
    <div style={{ ...GLASS, padding: '20px 24px', marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 800, color: '#333' }}>
        New Canvas Courses ({pending.length})
      </h3>
      {pending.map(course => (
        <div key={course.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid rgba(200,215,235,0.3)', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: '#444', flexGrow: 1 }}>
            {course.name} {course.course_code && <span style={{ color: '#999', fontWeight: 500 }}>({course.course_code})</span>}
          </span>
          <select value={linkChoice[course.id] ?? ''} onChange={e => setLinkChoice(prev => ({ ...prev, [course.id]: e.target.value }))}
            style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(180,190,215,0.5)' }}>
            <option value="">Link to existing subject…</option>
            {existingSubjects.map(s => <option key={s.user_subject_id} value={s.user_subject_id}>{s.subject_name}</option>)}
          </select>
          <button disabled={busy === course.id || !linkChoice[course.id]}
            onClick={() => act(course.id, { mode: 'link', user_subject_id: Number(linkChoice[course.id]) })}
            style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#74bcd9', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
            Link
          </button>
          <button disabled={busy === course.id}
            onClick={() => act(course.id, {
              mode: 'create', subject_name: course.name, course_code: course.course_code ?? course.name,
              units: 3, year_level: '1st Year', trimester: '1st Trimester',
            })}
            style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#f2a7c0', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
            Create Subject
          </button>
          <button disabled={busy === course.id} onClick={() => act(course.id, { mode: 'ignore' })}
            style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: 'rgba(240,240,245,0.9)', color: '#888', fontWeight: 700, cursor: 'pointer' }}>
            Ignore
          </button>
        </div>
      ))}
    </div>
  );
}
```

Note: the "Create Subject" button here uses placeholder defaults (`units: 3`, `year_level: '1st Year'`, `trimester: '1st Trimester'`) rather than a full pre-filled form — matching the spec's "pre-filled from the Canvas course's name/code" intent for name/code specifically, while keeping this component simple. If this feels too presumptuous once you're using it for real, the fix is a small modal reusing the existing subject-creation form fields instead of fixed defaults — flagged here rather than silently shipped as final.

- [ ] **Step 2: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Checkpoint:** component compiles standalone. Move to Task 15.

---

### Task 15: Activity Bank UI

**Files:**
- Create: `src/components/studypulse/CanvasActivityBank.tsx`

**Interfaces:**
- Consumes: `GET /api/canvas/bank`, `POST /api/canvas/bank/[id]/include`, `POST /api/canvas/bank/[id]/ignore` (Task 11).

- [ ] **Step 1: Write `src/components/studypulse/CanvasActivityBank.tsx`**

```tsx
'use client';

import { useState } from 'react';

interface BankItem {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  submission_status: string | null;
  submission_score: number | null;
  course_name: string;
  user_subject_id: number | null;
}

const GLASS: React.CSSProperties = {
  background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  borderRadius: '20px', border: '1px solid rgba(255,255,255,0.35)', boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
};

export default function CanvasActivityBank({ items, onChange }: { items: BankItem[]; onChange: () => void }) {
  const [includingId, setIncludingId] = useState<number | null>(null);
  const [targetType, setTargetType]   = useState<'activities' | 'quizzes' | 'exams'>('activities');
  const [busy, setBusy]               = useState(false);

  const confirmInclude = async (bankId: number) => {
    setBusy(true);
    try {
      const res  = await fetch(`/api/canvas/bank/${bankId}/include`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: targetType }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? 'Failed'); return; }
      setIncludingId(null);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const ignore = async (bankId: number) => {
    setBusy(true);
    try {
      await fetch(`/api/canvas/bank/${bankId}/ignore`, { method: 'POST' });
      onChange();
    } finally {
      setBusy(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <div style={{ ...GLASS, padding: '20px 24px', marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 800, color: '#333' }}>
        Activity Bank ({items.length})
      </h3>
      {items.map(item => (
        <div key={item.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(200,215,235,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: '#444', flexGrow: 1 }}>{item.name}</span>
            <span style={{ fontSize: '0.78rem', color: '#999' }}>{item.course_name}</span>
            <span style={{ fontSize: '0.78rem', color: '#999' }}>
              {item.due_at ? `Due ${new Date(item.due_at).toLocaleDateString()}` : 'No due date'}
            </span>
            <button disabled={busy || !item.user_subject_id} onClick={() => setIncludingId(includingId === item.id ? null : item.id)}
              style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#74bcd9', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
              Include
            </button>
            <button disabled={busy} onClick={() => ignore(item.id)}
              style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: 'rgba(240,240,245,0.9)', color: '#888', fontWeight: 700, cursor: 'pointer' }}>
              Ignore
            </button>
          </div>
          {includingId === item.id && (
            <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <select value={targetType} onChange={e => setTargetType(e.target.value as typeof targetType)}
                style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(180,190,215,0.5)' }}>
                <option value="activities">Activity</option>
                <option value="quizzes">Quiz</option>
                <option value="exams">Exam</option>
              </select>
              <button disabled={busy} onClick={() => confirmInclude(item.id)}
                style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: '#f2a7c0', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
                Confirm Include
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

Note: this covers legacy-mode subjects only (Activity/Quiz/Exam type picker), matching the spec's "type picker for legacy-mode subjects." A `grade_entries` (custom-mode, period+category picker) path through this same modal is real scope from the spec but needs the subject's grading preset (periods/categories) loaded per item to populate those dropdowns — deferred as a follow-up increment to this component once Task 16 wires real subject data through, rather than guessed at here without the actual preset shape in front of us.

- [ ] **Step 2: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Checkpoint:** component compiles standalone, legacy-mode Include path complete. Move to Task 16.

---

### Task 16: Wire Up the Canvas Page

**Files:**
- Create: `src/app/studypulse/canvas/page.tsx`

**Interfaces:**
- Consumes: all components from Tasks 13–15, `GET /api/canvas/courses`, `GET /api/canvas/bank`.

- [ ] **Step 1: Write `src/app/studypulse/canvas/page.tsx`**

Following the existing pattern of `src/app/studypulse/subjects/page.tsx` (server component doing direct queries, no client-side data-fetching layer):

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureCanvasSchema } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';
import CanvasClientShell from './CanvasClientShell';

export default async function CanvasPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  await ensureCanvasSchema();
  const userId = parseInt(session.user.id);

  const [connRows] = await pool.execute<RowDataPacket[]>(
    `SELECT canvas_user_name, status, last_sync_at, last_sync_status FROM canvas_connections WHERE user_id = ?`,
    [userId],
  );

  const [subjectRows] = await pool.execute<RowDataPacket[]>(
    `SELECT us.user_subject_id, s.subject_name FROM user_subjects us
     JOIN subjects s ON s.subject_id = us.subject_id WHERE us.user_id = ?`,
    [userId],
  );

  return (
    <CanvasClientShell
      initialConnection={connRows[0] ? {
        connected: true,
        canvas_user_name: connRows[0].canvas_user_name as string,
        status: connRows[0].status as 'active' | 'invalid' | 'disconnected',
        last_sync_at: connRows[0].last_sync_at as string | null,
        last_sync_status: connRows[0].last_sync_status as 'success' | 'partial' | 'failed' | null,
      } : { connected: false }}
      existingSubjects={subjectRows.map(r => ({
        user_subject_id: r.user_subject_id as number,
        subject_name: r.subject_name as string,
      }))}
    />
  );
}
```

- [ ] **Step 2: Write the client shell that ties the three components together with refetch-on-change**

Create `src/app/studypulse/canvas/CanvasClientShell.tsx`:

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import CanvasConnectPanel, { type ConnectionStatus } from '@/components/studypulse/CanvasConnectPanel';
import CanvasCourseMapping from '@/components/studypulse/CanvasCourseMapping';
import CanvasActivityBank from '@/components/studypulse/CanvasActivityBank';

export default function CanvasClientShell({
  initialConnection, existingSubjects,
}: {
  initialConnection: ConnectionStatus;
  existingSubjects: { user_subject_id: number; subject_name: string }[];
}) {
  const [connection, setConnection] = useState(initialConnection);
  const [courses, setCourses]       = useState<never[]>([]);
  const [bankItems, setBankItems]   = useState<never[]>([]);

  const refresh = useCallback(async () => {
    const [connRes, coursesRes, bankRes] = await Promise.all([
      fetch('/api/canvas/connect', { method: 'GET' }).catch(() => null), // no GET handler yet — see Step 3
      fetch('/api/canvas/courses'),
      fetch('/api/canvas/bank?status=pending'),
    ]);
    if (coursesRes.ok) setCourses((await coursesRes.json()).courses);
    if (bankRes.ok) setBankItems((await bankRes.json()).items);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 900, marginBottom: '18px' }}>Canvas Integration</h1>
      <CanvasConnectPanel connection={connection} onChange={refresh} />
      {connection.connected && (
        <>
          <CanvasCourseMapping courses={courses} existingSubjects={existingSubjects} onChange={refresh} />
          <CanvasActivityBank items={bankItems} onChange={refresh} />
        </>
      )}
    </div>
  );
}
```

Fix the dead `fetch('/api/canvas/connect', { method: 'GET' })` call (there is no GET handler for that route — connection status is already passed as `initialConnection` from the server component and doesn't need client refetching after a Connect/Disconnect action, since those actions can just update local state directly instead):

```tsx
  const connectPanelChange = useCallback((next?: ConnectionStatus) => {
    if (next) setConnection(next);
    refresh();
  }, [refresh]);
```

Simplify further — since `CanvasConnectPanel`'s `onChange` prop takes no arguments per Task 13's signature, just have `CanvasConnectPanel` call `window.location.reload()` internally after a successful connect/disconnect instead of threading connection state back up through props. Update `src/components/studypulse/CanvasConnectPanel.tsx`'s `connect` and `disconnect` functions: replace `onChange();` with `window.location.reload();` in both. This matches the simplicity of the rest of this page (server-rendered initial state, full reload on major state transitions) rather than building a client-side state-sync layer for a two-action panel.

Update `CanvasClientShell.tsx`'s `refresh` to drop the dead connect fetch:

```tsx
  const refresh = useCallback(async () => {
    const [coursesRes, bankRes] = await Promise.all([
      fetch('/api/canvas/courses'),
      fetch('/api/canvas/bank?status=pending'),
    ]);
    if (coursesRes.ok) setCourses((await coursesRes.json()).courses);
    if (bankRes.ok) setBankItems((await bankRes.json()).items);
  }, []);
```

- [ ] **Step 3: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Full end-to-end manual verification (this is where Tasks 5, 8, 9, 10, 11 finally get real functional verification)**

With the dev server running and logged into VibeBoard in the browser:

1. Navigate to `/studypulse/canvas`. Expected: "Connect Canvas" panel shown.
2. Enter your real Canvas base URL and a PAT generated from Canvas Settings. Click Connect. Expected: page reloads, now shows "Connected to Canvas as {your name}".
3. Confirm the schema landed: `"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "SELECT * FROM canvas_connections;"` — expected one row, `status='active'`, token columns non-null.
4. Click "Sync Now". Expected: after a moment, the New Courses list populates with your real Canvas courses.
5. Confirm: `"...mysql.exe" ... -e "SELECT id, name, mapping_status FROM canvas_courses;"` — expected all rows `mapping_status='pending'`.
6. For one course, click "Create Subject". Expected: it disappears from New Courses; confirm via `-e "SELECT * FROM subjects ORDER BY subject_id DESC LIMIT 1;"` that a new subject row appeared, and `-e "SELECT * FROM canvas_courses WHERE mapping_status='created';"` shows it linked.
7. Click "Sync Now" again. Expected: Activity Bank section populates with that course's real assignments.
8. Include one item as an Activity. Expected: it disappears from the bank list; confirm via `-e "SELECT * FROM activities ORDER BY activity_id DESC LIMIT 1;"` and `-e "SELECT * FROM canvas_entry_links ORDER BY id DESC LIMIT 1;"` that both the entry and the link row exist.
9. Navigate to that subject's page (`/studypulse/[id]`). Expected: the included item appears in the Activities list with its real Canvas deadline. If it already has a Canvas grade, try editing its score field — expected: the confirm dialog from Task 12 fires.
10. Run Sync Now once more with no real Canvas-side changes. Expected: `canvas_sync_runs` gets a new row with `items_changed = 0` for that course (confirm via `-e "SELECT * FROM canvas_sync_runs ORDER BY id DESC LIMIT 1;"`) — proving the `canvas_updated_at`/submission-diff short-circuit is working, not reprocessing unchanged data.

- [ ] **Checkpoint:** Phase 1 is fully functional end-to-end against a real Canvas account. This is the deliverable — Phases 2–4 (announcements, Gemini, entity resolution) are separate future plans built on this foundation.

---

## Plan Self-Review

**Spec coverage:** Connection flow (Task 5, 13), sync engine incl. change detection/removal sweep/reliability (Tasks 6–9), course mapping (Task 10, 14), Activity Bank + Include/Ignore + dedup via `UNIQUE` constraint (Task 11, 15), score/deadline propagation policy incl. override-confirm UX (Task 11 Step 8, Task 12), audit trail via `canvas_sync_events`/`canvas_sync_runs` (Tasks 7–8), background trigger via Cron + manual (Task 9). All spec sections have a covering task.

**Known gap, called out rather than hidden:** the custom-mode (period + category) Include path is deferred at the end of Task 15 rather than built — it needs the subject's grading-preset shape loaded per bank item, which isn't in front of us to get right without guessing. Flagging this explicitly as the one piece of the spec not fully closed by this plan, to be picked up as a fast follow once Task 16 is verified working, rather than shipped as a guessed implementation.

**Placeholder scan:** no TBD/TODO left unresolved as a plan step — the one deferred item above is explicitly scoped and explained, not a vague "handle this later."

**Type consistency:** `NormalizedAssignment`/`NormalizedCourse` (Task 4) used identically in Tasks 6–8; `CanvasConnectionRow` (Task 2) used identically in Tasks 3, 5–9; `SyncResult` (Task 8) matches what Task 9's manual route returns; `LegacyEntryInput`/`GradeEntryInput` (Task 11) match what both the refactored existing routes and the new Include route pass.
