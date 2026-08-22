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

import { normalizeAssignment, gradeBreakdown, type NormalizedAssignment } from './normalize';
import { normalizeAnnouncement, type NormalizedAnnouncement } from './normalize';

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
  points_possible:    number | null;
  submission_status:  string | null;
  submission_score:   number | null;
  canvas_updated_at:  string;
  bank_status:        'pending' | 'included' | 'ignored' | 'removed_upstream';
}

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

  // Both sides are now "YYYY-MM-DD HH:MM:SS" UTC strings — mysql2 returns DATETIME columns
  // in that form (dateStrings: true on the pool) and normalize.ts converts Canvas's ISO-8601
  // into the same form before it ever reaches here. Compare as timestamps, not raw strings.
  const storedUpdatedMs = new Date(stored.canvas_updated_at).getTime();
  const freshUpdatedMs  = new Date(a.canvasUpdatedAt).getTime();
  const storedDueMs = stored.due_at ? new Date(stored.due_at).getTime() : null;
  const freshDueMs  = a.dueAt ? new Date(a.dueAt).getTime() : null;

  // submission_score/points_possible are DECIMAL(8,2) columns; without decimalNumbers: true
  // on the pool, mysql2 returns them as strings ("95.00"), not numbers. Coerce before
  // comparing against Canvas's raw JSON numbers, preserving null.
  const storedScore  = stored.submission_score === null ? null : Number(stored.submission_score);
  const storedPoints = stored.points_possible  === null ? null : Number(stored.points_possible);

  const dueChanged    = storedDueMs !== freshDueMs;
  const scoreChanged  = storedScore !== a.submissionScore;
  const pointsChanged = storedPoints !== a.pointsPossible;

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

  if (metadataChanged && dueChanged) {
    await logEvent(connection.id, stored.id, 'due_date_changed', { dueAt: stored.due_at }, { dueAt: a.dueAt });
  }
  if (submissionChanged && scoreChanged) {
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
    // Only propagate what actually changed: a due-date-only Canvas edit must not overwrite
    // the linked entry's grade (which would wipe it to null on an ungraded assignment).
    // A points_possible change counts as a score change because `grade` is a percentage
    // derived from both numbers.
    await propagateToLinkedEntry(stored.id, a, {
      deadlineChanged: dueChanged,
      scoreChanged:    scoreChanged || pointsChanged,
    });
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

interface PropagateFlags {
  /** Canvas's due_at differs from what's stored — the linked entry's deadline should follow. */
  deadlineChanged: boolean;
  /** Canvas's submission score (or points_possible) differs — the linked entry's grade should follow. */
  scoreChanged:    boolean;
}

async function propagateToLinkedEntry(
  bankItemId: number, fresh: NormalizedAssignment, changed: PropagateFlags,
): Promise<void> {
  const sets:   string[] = [];
  const params: (string | number | null)[] = [];

  if (changed.deadlineChanged) {
    // dueAt is already a UTC "YYYY-MM-DD HH:MM:SS" string (normalize.ts), so the date
    // portion is deterministic rather than dependent on the server's timezone.
    sets.push('deadline = ?');
    params.push(fresh.dueAt ? fresh.dueAt.slice(0, 10) : null);
  }
  if (changed.scoreChanged) {
    // Canvas reports raw points; VibeBoard's `grade` column is a percentage. Store the
    // derived percentage plus the score/items pair the rest of the app renders alongside it.
    const { grade, score, items } = gradeBreakdown(fresh.submissionScore, fresh.pointsPossible);
    sets.push('grade = ?', 'score = ?', 'items = ?');
    params.push(grade, score, items);
  }
  if (sets.length === 0) return;

  const [linkRows] = await pool.execute<RowDataPacket[]>(
    `SELECT activity_id, quiz_id, exam_id, grade_entry_id FROM canvas_entry_links WHERE bank_item_id = ?`,
    [bankItemId],
  );
  if (linkRows.length === 0) return;
  const link = linkRows[0];

  let table: string, pkColumn: string, pkValue: number;
  if (link.activity_id) {
    table = 'activities';    pkColumn = 'activity_id'; pkValue = link.activity_id as number;
  } else if (link.quiz_id) {
    table = 'quizzes';       pkColumn = 'quiz_id';     pkValue = link.quiz_id as number;
  } else if (link.exam_id) {
    table = 'exams';         pkColumn = 'exam_id';     pkValue = link.exam_id as number;
  } else if (link.grade_entry_id) {
    table = 'grade_entries'; pkColumn = 'entry_id';    pkValue = link.grade_entry_id as number;
  } else {
    return;
  }

  // Table/column names here are fixed internal literals, never user input.
  await pool.execute(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE ${pkColumn} = ?`,
    [...params, pkValue],
  );
}

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
       last_synced_at = NOW(), last_seen_sync_run_id = VALUES(last_seen_sync_run_id),
       bank_status = IF(bank_status = 'removed_upstream', 'pending', bank_status)`,
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
      WHERE course_id = ? AND last_seen_sync_run_id != ? AND bank_status NOT IN ('removed_upstream', 'included')`,
    [courseRowId, runId],
  );
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
    let assignmentsOk = true;
    try {
      const result = await syncCourseAssignments(connection, course, runId);
      itemsFetched += result.fetched;
      itemsChanged += result.changed;
      await sweepRemovedAssignments(course.id, runId);
    } catch (err) {
      assignmentsOk = false;
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ stage: 'syncCourseAssignments', canvas_course_id: course.canvas_course_id, message, retryable: true });
    }

    try {
      const announcementResult = await syncCourseAnnouncements(connection, course, runId);
      itemsFetched += announcementResult.fetched;
      await sweepRemovedAnnouncements(course.id, runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ stage: 'syncCourseAnnouncements', canvas_course_id: course.canvas_course_id, message, retryable: true });
    }

    if (assignmentsOk) coursesSynced++;
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

/**
 * Connections are synced serially and each one makes several paginated Canvas calls, so the
 * batch size is the main lever keeping a cron invocation inside the platform's function
 * execution limit (see `maxDuration` on the cron route). Deliberately conservative: any
 * connection not reached this invocation is simply the stalest one on the next.
 */
export async function syncAllDueConnections(maxConnections = 5): Promise<void> {
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
