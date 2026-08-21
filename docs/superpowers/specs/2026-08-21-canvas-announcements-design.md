# Canvas Announcements — Design

**Status:** Approved for planning
**Date:** 2026-08-21
**Depends on:** the existing Canvas Sync feature (`docs/superpowers/specs/2026-08-20-canvas-sync-design.md`, `docs/superpowers/plans/2026-08-20-canvas-sync.md`) and its Activity Bank Include flow (period+category picker for custom-graded subjects, added this session).

## Problem

Canvas course announcements often communicate the same things assignments do — "Quiz 3 moved to Friday," "Submit your Chapter 3 draft by Sunday" — but arrive as plain text posts with no due date, no points, and no structured type. Today VibeBoard only syncs *assignments* (`canvas_activity_bank`). Announcements are invisible to the app entirely.

## Goals

- Sync Canvas announcements per mapped course, alongside the existing assignment sync.
- Suggest a category for each announcement using keyword rules, so the student can quickly tell "this is probably about a quiz" from "this is just an FYI."
- Let the student convert a relevant announcement into a real task (Activity/Quiz/Exam for legacy-graded subjects, or a Period+Category grade entry for custom-graded subjects) — reusing the exact insert logic and Include UI pattern already built for the Activity Bank.
- Let announcements that aren't actionable stay exactly what they are: a static, readable announcement.
- A separate bank from the Activity Bank (separate table, separate UI), shown on both the general Canvas Integration page and the per-subject scoped view — plus a new dedicated entry point button on the subject page.

## Non-goals (out of scope for this iteration)

- No date/deadline extraction from announcement text (NLP). The student fills in the deadline manually when converting.
- No user-editable keyword configuration UI. Keyword rules for legacy-mode subjects are fixed in code.
- No change-propagation for edited announcements (unlike assignments, which propagate due-date/score changes into a linked entry after Include). An announcement's content is captured once, at conversion time; if Canvas edits the announcement afterward, VibeBoard does not update the created entry. This mirrors the fact that announcements aren't graded, live Canvas data the way assignments are.
- No announcement read/unread tracking beyond the existing bank_status states.

## Data model

Two new tables, both created via `ensureCanvasSchema()` in `src/lib/migrate.ts` (same idempotent `CREATE TABLE IF NOT EXISTS` pattern already used there):

```sql
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
```

No `points_possible`/`submission_score`/`submission_status` columns — announcements aren't graded, unlike assignments. `bank_status` reuses the same four-value enum as `canvas_activity_bank` for consistency, but the UI treats it differently (see "Persistent feed" below) — nothing ever disappears from the list.

## Sync engine (`src/lib/canvas/sync.ts`)

New functions, added next to the existing assignment-sync functions and following the same shape:

- **`syncCourseAnnouncements(connection, course, runId)`** — `canvasGetAll(connection, '/courses/{id}/discussion_topics', { only_announcements: 'true' })`, normalize each item (`id`, `title`, `message`, `html_url`, `posted_at`, `updated_at` from Canvas's discussion-topic shape), then `upsertAnnouncement`.
- **`upsertAnnouncement`** — much simpler than `upsertAssignment`: no submission-state diffing, no `canvas_sync_events` logging (announcements don't have a change history worth tracking the way assignment due-dates/scores do). Insert if `canvas_announcement_id` is new; otherwise `UPDATE title/message/html_url/canvas_updated_at/last_synced_at/last_seen_sync_run_id` unconditionally (cheap, idempotent, and picks up upstream edits automatically — the one place we *do* want fresh Canvas data, since it just informs display, not a linked entry).
- **`sweepRemovedAnnouncements(courseRowId, runId)`** — direct mirror of `sweepRemovedAssignments`: any row not seen in this run flips to `bank_status = 'removed_upstream'`.

`syncConnection()`'s existing per-course loop gets one more call — `syncCourseAssignments` then `syncCourseAnnouncements`, both inside the same try/catch (a Canvas failure mid-course already aborts that course's sync for the run; no need for finer-grained isolation than what assignments already have) — and `itemsFetched`/`itemsChanged` accumulate both.

## Classification (`src/lib/canvas/classify.ts`, new file)

Pure functions, no DB access — the caller supplies the subject's grading context.

```ts
export type SuggestedCategory =
  | { kind: 'legacy'; target: 'activities' | 'quizzes' | 'exams' }
  | { kind: 'custom'; categoryName: string }
  | { kind: 'general' };

export function suggestLegacyCategory(text: string): 'activities' | 'quizzes' | 'exams' | 'general';
export function suggestCustomCategory(text: string, categoryNames: string[]): string | null; // null → general
```

- **Legacy-mode subjects**: fixed keyword rules (checked in this order — exam beats quiz beats activity, since e.g. "quiz" could theoretically appear in an exam-review announcement and exam is the more specific/urgent category):
  - Exam: `exam`, `exams`, `final exam`, `finals`, `midterm exam`, `midterms`
  - Quiz: `quiz`, `quizzes`
  - Activity: `due`, `deadline`, `submit`, `submission`, `assignment`, `assignments`, `project`, `requirement`, `requirements`, `output`, `task`
  - Else: General
- **Custom-mode subjects**: for each of the subject's *actual* `grading_categories.name` values (queried live, ordered by `period_id, sort_order` — the same order the grading config UI itself lists them in), check if that name appears (case-insensitive substring) in the announcement's title/message. First match wins; no match → General. This is what makes the suggestion "dynamic based on the configured grading system" — a subject with categories named "Requirements"/"Documentation"/"Final Defense" gets suggestions matched against exactly those words, not a fixed Activity/Quiz/Exam vocabulary that may not even apply to it.
  - The suggestion carries a category *name* (e.g. "Requirements"), not a `(period_id, cat_id)` pair — the same category name can exist in multiple periods (e.g. every period has a "Quizzes" category). In the Include panel, once the student picks a period, the category dropdown auto-preselects a category in *that* period whose name matches the suggestion, if one exists; otherwise it's left unselected as normal.

Classification runs **at read time**, in the API route, not at sync time — a subject's grading categories can be renamed after an announcement was synced, and the suggestion should reflect the *current* config, not a snapshot. Text matched is `title + ' ' + stripHtml(message)`, lowercased.

## API routes

- **`GET /api/canvas/announcements`** — mirrors `GET /api/canvas/bank`: same `status` and `user_subject_id` query params (though the UI will typically ask for all statuses, given the persistent-feed model), same `subject_mode` join. Additionally computes `suggested_category` per row using the classify functions above (fetching each distinct subject's grading categories once, not per-row, to avoid N+1 queries).
- **`POST /api/canvas/announcements/[id]/include`** — mirrors `POST /api/canvas/bank/[id]/include` almost exactly (same ownership check, same re-Include guard allowing `pending`→`included` and `ignored`→`included`, same subject-mode/target-type validation, same three insert helpers). Two differences: (1) no `gradeBreakdown` — announcements carry no score/points; (2) requires a client-supplied `deadline` (`YYYY-MM-DD`), since Canvas gives none. Writes to `canvas_announcement_links` instead of `canvas_entry_links`.
- **`POST /api/canvas/announcements/[id]/ignore`** — identical shape to the existing bank `/ignore` route, just targeting the new table. (UI label: "Keep as Announcement" — see below.)

## UI

**`CanvasAnnouncementBank.tsx`** (new component, same visual language as the just-redesigned `CanvasActivityBank`/`CanvasCourseMapping` — glass panel, pill buttons, chips, action row always separate from wrapping content per the consistency fix from this session):

- Filter pills at the top: **All / Needs Review / Converted / Dismissed** (client-side filter over the fetched set — the API always returns everything for the scope, matching the persistent-feed decision).
- Each card: title, course badge, posted date, a truncated plain-text message preview, a suggested-category chip (e.g. "Suggests: Quiz" or "Suggests: Requirements"), and status-dependent actions:
  - `pending` / `ignored`: **Include** (opens the same period+category or activity/quiz/exam picker pattern as the Activity Bank, pre-selecting the suggested target/category, plus a **deadline** date input since there's none from Canvas) and **Keep as Announcement** (dismiss — not final, can still be Included later, exactly like the Activity Bank's existing Ignore semantics).
  - `included`: a resolved badge, e.g. "Added as Quiz — Midterm" or "Added as Activity", no actions.
  - `removed_upstream`: a muted "No longer on Canvas" badge.

**Placement**: added to `CanvasClientShell.tsx` below `CanvasActivityBank`, in both the general and `?subject=` scoped views (same conditional pattern already used for hiding `CanvasCourseMapping` in the scoped view — Announcement Bank shows in both).

**Subject page entry point** ([SubjectCardView.tsx](../../../src/components/studypulse/SubjectCardView.tsx)): a second button next to the existing "📥 Activity Bank" — "📢 Announcements" — linking to `/studypulse/canvas?subject={id}#announcements`, with a matching `id="announcements"` anchor on the new panel so it scrolls into view directly.

## Error handling

Follows existing conventions throughout: `ensureCanvasSchema()`-style idempotent table creation; the bank GET route's try/catch-and-fall-back-to-simpler-query pattern for the grading-mode join; the Include route's transaction wrapping the insert + link + status update. No new error-handling patterns needed.

## Testing approach

- `classify.ts` is pure functions — straightforward unit tests for `suggestLegacyCategory` and `suggestCustomCategory` covering each keyword bucket, case-insensitivity, and the no-match → general fallback.
- Manual end-to-end verification the same way this session's Activity Bank period/category picker was verified: seed a throwaway user + Canvas connection + course + announcements (legacy and custom-mode subjects) directly in the dev DB, drive the real app via Playwright, screenshot, verify the DB writes, then clean up — no real Canvas account required for verification.
