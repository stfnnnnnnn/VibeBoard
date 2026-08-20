# Canvas LMS Integration — Phase 1: Assignment Sync + Activity Bank

**Status:** Approved design, ready for implementation planning.
**Scope:** First of four sequential sub-projects for the full Canvas integration concept:

1. **Canvas assignment sync + Activity Bank** ← this spec
2. Announcement sync + feed (not started)
3. Gemini announcement interpreter (not started)
4. Entity resolution + suggestion/approval UI (not started)

Phases 2–4 are deliberately out of scope here and will get their own spec once this phase is built and working. Where this phase's design has implications for later phases (e.g. keeping AI-derived data separate from Canvas-sourced data), that principle is noted but not built.

## Goals

- Let a student connect their Canvas account and see their real courses/assignments/due dates/submission status inside VibeBoard without re-typing anything.
- Canvas remains authoritative for Canvas-originated data. VibeBoard never invents or silently diverges from it for linked items.
- Nothing Canvas-sourced becomes a permanent VibeBoard record without the student explicitly choosing to include it (Activity Bank staging model).
- Real synchronization: idempotent, detects new/changed/removed items, survives partial failures, leaves an audit trail — not a one-shot import.

## Non-Goals (this phase)

- Announcements (Phase 2).
- Any AI/LLM involvement (Phase 3+).
- Multiple Canvas connections per user (one connection per user; the schema's `UNIQUE(user_id)` constraint is a deliberate, easily-relaxed scope cut).
- True OAuth2 (no Canvas Developer Key available to this deployment — see Connection Flow).
- Pulling Canvas Quizzes-API data separately — Canvas's Assignments API already includes graded quizzes as assignments in modern Canvas, so a second API surface isn't needed.

## Architecture Overview

```
                    Canvas LMS (per-connection base_url)
                                │
                    Personal Access Token (Bearer)
                                │
                    src/lib/canvas/client.ts
                    (pagination, rate-limit backoff,
                     401 vs 5xx error handling)
                                │
                    src/lib/canvas/normalize.ts
                    (pure: raw JSON → typed shape)
                                │
                    src/lib/canvas/sync.ts
                    (orchestration, change detection,
                     removal sweep, event logging)
                                │
                ┌───────────────┼────────────────┐
                ▼               ▼                ▼
        canvas_courses   canvas_activity_bank   canvas_sync_runs
        (course mapping)  (staging, per-        (audit/reliability)
                            assignment)                │
                                │                       ▼
                        Student: Include/Ignore   canvas_sync_events
                                │                  (per-field change log)
                                ▼
                        canvas_entry_links
                                │
                ┌───────────────┼────────────────┬─────────────┐
                ▼               ▼                ▼             ▼
           activities        quizzes           exams      grade_entries
           (existing StudyPulse tables — real VibeBoard academic records)
```

Trigger paths into `sync.ts`: a Vercel Cron job (`POST /api/canvas/sync/cron`, shared-secret protected) for background freshness, and a "Sync Now" button (`POST /api/canvas/sync/manual`) for immediate on-demand sync. Both call the same orchestration code.

## Data Model

All new tables. Existing tables (`user_login`, `user_subjects`, `activities`, `quizzes`, `exams`, `grade_entries`, `subjects`) are referenced but not altered, except for one small addition noted under "Touches to Existing Code."

```sql
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
);

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
);

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
);

-- One bank item maps to exactly one local record, in exactly one of four tables.
-- FK + CHECK together give real referential integrity, not just an app-level convention.
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
);

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
);

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
);
```

Verified against the live local DB: MariaDB 10.4.32, which enforces `CHECK` constraints (supported since MariaDB 10.2.1 — unlike MySQL pre-8.0.16, where `CHECK` parses but is silently ignored). Any reasonably current MySQL 8+/MariaDB 10.2+ managed host used for the eventual Vercel deployment will also enforce it.

Migrations follow the existing lazy-migration convention in `src/lib/migrate.ts` (idempotent, called defensively from the routes that need the tables) rather than a new migration mechanism — these are `CREATE TABLE IF NOT EXISTS` statements, so the existing `ER_DUP_FIELDNAME`-catching pattern isn't needed; a straightforward "run once per process" guard (matching `_ranAc`/`_ranGs`/etc.) is sufficient.

## Canvas Connection Flow

**Why not OAuth2:** Canvas's authorization-code flow requires a Developer Key registered on the target Canvas instance by a Canvas admin — not something a student can self-register, and not available here. Instead: per-user Personal Access Token (PAT), generated by the student in their own Canvas **Settings → New Access Token**, pasted into VibeBoard once.

- New route/panel: `/studypulse/canvas`. Student enters their Canvas base URL, gets a direct link + short instructions to their Canvas token settings page, pastes the token.
- `POST /api/canvas/connect`: validates the token live against `GET {base_url}/api/v1/users/self` **before** persisting anything. Invalid domain or invalid token → clear error, nothing stored.
- On success: token is encrypted (AES-256-GCM) via the credential service (below) and upserted into `canvas_connections` (`status='active'`, `UNIQUE(user_id)` — one connection per user for this phase).
- `POST /api/canvas/disconnect`: **soft** disconnect — `status='disconnected'`, token ciphertext cleared, but `canvas_courses`/`canvas_activity_bank`/`canvas_entry_links`/audit tables are untouched. Sync skips non-active connections. Reconnecting (even with a fresh token) revives the same connection row and resumes matching by `canvas_assignment_id` — no data loss, no re-linking needed. Included items are already independent rows in the real StudyPulse tables, so they're unaffected either way; they just stop receiving live updates.

**Credential isolation:** `src/lib/canvas/credentials.ts` is the *only* module that touches raw tokens — `encryptToken()`, `decryptToken()`, `getAccessToken(connection)`. The sync engine and API client call `getAccessToken()` and never see encryption details. The encryption key (`CANVAS_TOKEN_ENC_KEY`) lives in an env var, never in the database alongside the ciphertext.

## Sync Engine

Three modules with single responsibilities:

**`src/lib/canvas/client.ts`** — HTTP layer only.
- Attaches the bearer token via the credential service.
- Follows Canvas's `Link` response header for pagination (loop until no `rel="next"`).
- Watches `X-Rate-Limit-Remaining`; backs off briefly when it gets low.
- `401` → throws `CanvasAuthError`. This aborts the entire run immediately and flips `connection.status='invalid'`. **No retry** — retrying a bad credential can't succeed and only burns rate-limit budget.
- `5xx` / network error → retries with exponential backoff (3 attempts, ~1s/2s/4s). If still failing, the error is attached to *that course's* processing only; other courses in the same run continue.
- `403`/`429` with a rate-limit response body → backoff-and-retry, same budget as `5xx`.

**`src/lib/canvas/normalize.ts`** — pure functions, no network or DB. `normalizeCourse(raw)` / `normalizeAssignment(raw)` map Canvas's JSON shape to internal `NormalizedCourse`/`NormalizedAssignment` types. Kept pure specifically so they can be sanity-checked against pasted real Canvas API responses in a throwaway script — this project has no test framework, and that's the same verification discipline already used for the OCR parser (hand-traced against real captured data, never guessed).

**`src/lib/canvas/sync.ts`** — orchestration. `syncConnection(connectionId, trigger)`:

1. Load the connection (must be `status='active'`); create a `canvas_sync_runs` row (`status='running'`).
2. Fetch the course list (`GET /courses?enrollment_state=active&include[]=term`). Upsert into `canvas_courses` — new courses land `mapping_status='pending'` for the review screen; existing ones get `name`/`term`/`workflow_state`/`last_seen_at` refreshed.
3. For each course where `mapping_status IN ('linked','created')` **only** — pending/ignored courses are never fetched, which both respects the staging model and saves API calls:
   - Fetch assignments: `GET /courses/:id/assignments?include[]=submission&per_page=100`, paginated. One call gets due date *and* the connected student's own submission/grade — no separate Submissions API round-trip needed.
   - Per assignment, normalize and upsert into `canvas_activity_bank` (key: `UNIQUE(connection_id, canvas_assignment_id)` — this constraint *is* the dedup mechanism; every write is an upsert, application code never does an insert-if-missing check).
   - **Change detection** is split by what actually changes independently in Canvas's own data model: `canvas_updated_at` unchanged skips *assignment-metadata* reprocessing; `submission_status`/`submission_score` are always diffed directly against stored values regardless of `canvas_updated_at`, because a grade being posted doesn't bump the assignment's own `updated_at` (they're different Canvas resources) — and diffing costs nothing extra since both values are already in the same fetched response.
   - Whichever changed produces a `canvas_sync_events` row (`due_date_changed` / `score_changed` / `submission_status_changed` / `assignment_created` for brand-new rows) with `old_data`/`new_data` as JSON (not bare strings — a date change needs date+time together, and future event types may carry multi-field payloads).
   - For `bank_status='included'` items: propagate through `canvas_entry_links` to whichever concrete table holds the linked row, per the sync policy below.
   - Update `last_seen_sync_run_id` on every row touched this run.
4. **Removal detection**, gated on complete success: only *after* a course's assignment fetch finishes without error does a sweep run for that course — any `canvas_activity_bank` row with `last_seen_sync_run_id != <this run>` gets `bank_status='removed_upstream'` and a `assignment_removed` event. A course whose fetch failed this run is skipped by the sweep entirely, so a transient API error never gets misread as "Canvas deleted a dozen assignments." Linked local entries are never deleted or altered when this happens — they just stop receiving future propagated updates, with a UI indicator that Canvas no longer reports the source item.
5. Finalize the `canvas_sync_runs` row: `status='success'` if every course succeeded, `'partial'` if some courses failed but others didn't, `'failed'` if course discovery itself failed (couldn't authenticate or list courses at all). Persist `courses_synced`/`items_fetched`/`items_changed` and an `errors_json` array of `{stage, canvas_course_id, message, retryable}` for whatever failed. Update `connection.last_sync_at`/`last_sync_status`/`last_error`.

`syncAllDueConnections()` (used by the cron route): selects `active` connections ordered by staleness (`last_sync_at` oldest-first, nulls first), processes a bounded batch to respect serverless execution limits, and is safe to re-invoke — already-fresh connections are naturally skipped on the next call.

## Course Mapping + Activity Bank UI

New page: `/studypulse/canvas`, with a connection-status card (connected as X, last synced, Sync Now, Disconnect) and two review queues plus a change feed:

- **New Courses** — each `pending` course: `[Link to existing subject ▾] [Create Subject] [Ignore]`. Link opens a dropdown of the student's existing `user_subjects`. Create Subject reuses the existing subject-creation form (pre-filled from the Canvas course's name/code) and tags the resulting `user_subject_id` back onto the course row. Ignore stops future assignment fetches for that course. This queue also doubles as onboarding: a brand-new account with zero subjects populates them from here.
- **Activity Bank** — `pending` bank items grouped by mapped subject: `[Include] [Ignore]`. Include opens a modal — period+category picker for custom-mode subjects (matching the real `grade_entries` schema), activity/quiz/exam type picker for legacy-mode subjects (matching the real legacy table split) — confirming calls the *existing* entries/grade-entries insert logic (reused, not duplicated) and creates the `canvas_entry_links` row. Ignore hides an item from the active queue without finality — an Ignored tab allows flipping it to Include later, and Canvas-side changes to an ignored item still log events, they just don't propagate anywhere while ignored.
- **Recent Changes** — included items with a recent `last_change_at`, rendered from `canvas_sync_events` — this is the "Deadline changed: Aug 25 → Aug 28" surfacing from the original concept.

## Score/Deadline Sync Policy (Included Items)

- **Deadline**: Canvas always wins, auto-applied to the linked local entry's deadline on every sync, logged as a `due_date_changed` event (visible in Recent Changes).
- **Score**: Canvas always wins, auto-applied on every sync where `submission_score` changed.
- **Manual override UX**: if a student edits the grade field of an entry that has an active `canvas_entry_links` row, a confirm dialog appears — "This score comes from Canvas ({current value}). It will be overwritten by Canvas on the next sync — edit anyway?" `[Edit Anyway] [Cancel]`. The edit is allowed (never blocked outright) but is understood by both the UI and the student to be transient, since the next sync re-applies Canvas's value regardless.

## Touches to Existing Code

One small, necessary change: the entries/grade-entries GET routes need a cheap `canvas_linked: boolean` (a left join against `canvas_entry_links`) so `SubjectCardView.tsx`'s existing grade-input handler can show the override-confirm dialog above. This is a targeted addition to an existing response shape, not a rewrite of the grading components.

## Reliability Summary

| Failure | Behavior |
|---|---|
| Invalid/expired token (`401`) | Abort run immediately, no retry, `connection.status='invalid'`, student must reconnect |
| Transient API error (`5xx`, network) | Retry 3× with backoff; if still failing, that course is marked failed in `errors_json`, other courses continue |
| Rate limited (`403`/`429`) | Backoff-and-retry, same budget as transient errors |
| One course fails, others succeed | Run finishes `status='partial'`, not silently `'success'` |
| Course list fetch itself fails | Run finishes `status='failed'`, nothing else attempted |
| Cron fires while a manual sync is in flight for the same connection | Out of scope for this phase — see Open Questions |

## Background Trigger

`vercel.json` cron hits `POST /api/canvas/sync/cron` (shared-secret protected) → `syncAllDueConnections()`. Flagging now: Vercel's Hobby tier has historically restricted cron frequency (often once/day) — the **manual "Sync Now" button** (`POST /api/canvas/sync/manual`, scoped to the logged-in user, calls `syncConnection()` directly and returns a run summary for immediate UI feedback) is the dependable path regardless of what cadence the actual plan allows, not a fallback of last resort.

## Testing/Verification

Matches this project's existing no-test-suite convention rather than introducing a new one:
- `tsc --noEmit` after each edit batch.
- Direct SQL against the live DB to confirm the new `ensureCanvas*()`-style lazy migrations land correctly (same pattern as `migrate.ts`).
- `curl` route-mount/auth-redirect checks for the new API routes.
- Throwaway scripts feeding `normalize.ts` real pasted Canvas API responses (from a real Canvas account/course) to verify field mapping by hand — same discipline already used for the OCR parser fixes, never guessing at what an external API returns.

## Open Questions (deferred, not blocking)

- Concurrent cron + manual sync for the same connection (currently unhandled — a `canvas_sync_runs` row with `status='running'` could be used as a simple mutex if this becomes a real problem).
- Exact Vercel Cron cadence, pending confirmation of the actual hosting plan.
