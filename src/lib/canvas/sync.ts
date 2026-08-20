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

  // mysql2 returns DATETIME columns as MySQL-format strings ("2026-08-20 10:00:00", via
  // dateStrings: true on the pool) while Canvas's JSON gives ISO-8601 ("2026-08-20T10:00:00Z").
  // Compare as timestamps, not raw strings, or every sync would report a false change.
  const storedUpdatedMs = new Date(stored.canvas_updated_at).getTime();
  const freshUpdatedMs  = new Date(a.canvasUpdatedAt).getTime();
  const storedDueMs = stored.due_at ? new Date(stored.due_at).getTime() : null;
  const freshDueMs  = a.dueAt ? new Date(a.dueAt).getTime() : null;

  // submission_score is a DECIMAL(8,2) column; without decimalNumbers: true on the pool,
  // mysql2 returns it as a string ("95.00"), not a number. Coerce before comparing against
  // Canvas's raw JSON number, preserving null.
  const storedScore = stored.submission_score === null ? null : Number(stored.submission_score);

  const metadataChanged = storedUpdatedMs !== freshUpdatedMs;
  const submissionChanged = submissionFieldsChanged(
    stored.submission_status, storedScore, a.submissionStatus, a.submissionScore,
  );

  if (!metadataChanged && !submissionChanged) {
    await pool.execute(
      `UPDATE canvas_activity_bank SET last_synced_at = NOW(), last_seen_sync_run_id = ? WHERE id = ?`,
      [runId, stored.id],
    );
    return false;
  }

  if (metadataChanged && storedDueMs !== freshDueMs) {
    await logEvent(connection.id, stored.id, 'due_date_changed', { dueAt: stored.due_at }, { dueAt: a.dueAt });
  }
  if (submissionChanged && storedScore !== a.submissionScore) {
    await logEvent(connection.id, stored.id, 'score_changed',
      { score: storedScore }, { score: a.submissionScore });
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

async function propagateToLinkedEntry(_bankItemId: number, _fresh: NormalizedAssignment): Promise<void> {
  // Implemented in Task 11 once canvas_entry_links exists and is populated.
}
