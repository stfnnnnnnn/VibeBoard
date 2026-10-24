import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import {
  ACADEMIC_TABLES, deriveAcademicStage, urgencyFromPriority,
  type AcademicSource, type WorkPriority,
} from '@/lib/workboard/workItems';
import {
  isRevisionStage, isStageLegal, isWaitingStage, normaliseStage, normaliseWaitingReason,
  type WorkStage, type WorkStatus,
} from '@/lib/workboard/workContexts';
import { manilaNowDatetime, normaliseDeadlineTime } from '@/lib/workboard/dates';
import { todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';

/** "YYYY-MM-DD" for today in Manila time — never derive "today" from `new Date()`'s own
 *  UTC components, since that reads as yesterday during the ~8-hour Manila midnight window. */
function todayManilaDateString(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(todayInManilaAsUtcDate());
}

export class AcademicItemNotFoundError extends Error {
  constructor() { super('That item was not found'); this.name = 'AcademicItemNotFoundError'; }
}

/** Thrown when a patch would write `activities`/`quizzes`/`exams`' own status, deadline, or
 *  urgency column on a row that is already graded (`score`/`items`/`grade` all non-null) —
 *  see `patchAcademicItem`'s guard for why ANY such write is unsafe on a graded row, not only
 *  a status change. */
export class AcademicItemGradedError extends Error {
  constructor() {
    super('This item has been graded in Study Pulse — its status, deadline, and priority can only be changed there.');
    this.name = 'AcademicItemGradedError';
  }
}

export interface AcademicPatch {
  work_status?:      WorkStatus;
  work_stage?:       WorkStage;
  due_at?:           string | null;
  deadline_time?:    string | null;
  priority?:         WorkPriority;
  estimated_hours?:  number | null;
  start_date?:       string | null;
  /** The revision note for `submitted` ("For Revision"); ignored outside a waiting stage. */
  blocked_reason?:   string | null;
  /** The school task's note (spec 2026-10-24 §6.1). Overlay-only, like `estimated_hours`:
   *  Study Pulse has no column for it and only shows it read-only. Already normalised by
   *  `parseEntryNote` (trimmed, '' → null). */
  note?:             string | null;
}

/** `workboard_entry_meta.note` is TEXT, but the Canvas Include route and the convert form
 *  cap a note at 1,000 characters (spec §6.1); every write path holds the same line. */
export const ENTRY_NOTE_MAX = 1000;

/** The request-body rule both academic routes share: absent or null clears, a string is
 *  trimmed (empty → null), anything else or over `ENTRY_NOTE_MAX` is a 400. */
export function parseEntryNote(raw: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, note: null };
  if (typeof raw !== 'string') return { ok: false, error: 'note must be a string or null' };
  const note = raw.trim();
  if (note.length > ENTRY_NOTE_MAX) {
    return { ok: false, error: `A note of at most ${ENTRY_NOTE_MAX} characters is required` };
  }
  return { ok: true, note: note === '' ? null : note };
}

/**
 * Routes each field of a patch to its correct home: done-ness and deadline and urgency go
 * back to the Study Pulse entry itself (it remains the source of truth); work_stage,
 * in_progress, deadline_time, estimated_hours, start_date and note go to the
 * workboard_entry_meta overlay, because Study Pulse has no columns for them and its
 * schema is deliberately not being changed.
 *
 * Everything runs in one transaction so a half-applied patch is impossible.
 */
export async function patchAcademicItem(
  userId: number, source: AcademicSource, entryId: number, patch: AcademicPatch,
): Promise<void> {
  const spec = ACADEMIC_TABLES.find(s => s.source === source);
  if (!spec) throw new AcademicItemNotFoundError();

  // Ownership: never trust the id in the URL — walk the entry back to this user's subjects.
  // The inner JOIN through `user_subjects` is the 404 gate and stays exactly as it was; the
  // LEFT JOIN to the overlay is additive and cannot admit a row the gate would reject.
  // Values riding along with the ownership check:
  //   - `current_status`, so a patch that merely re-sends the dialog's seeded `work_status`
  //     (unchanged) doesn't re-stamp `accomplished_at` — see Finding 1 of the whole-branch
  //     review;
  //   - `current_stage`, so the same re-send can't flatten a finer stored stage — see
  //     Fix 1 of the Task 10 review;
  //   - `score`/`items`/`grade`, to detect a graded row before the guard below — see the
  //     whole-branch review's Finding C-1. Selected unconditionally (not just for
  //     `hasGradedTrigger` tables) so this one query stays a single shape for all four
  //     sources; `grade_entries` rows simply never trip the guard that reads them.
  const [owns] = await pool.execute<RowDataPacket[]>(
    `SELECT t.\`${spec.pk}\` AS id, t.status AS current_status, m.work_stage AS current_stage,
            t.score AS current_score, t.items AS current_items, t.grade AS current_grade,
            t.accomplished_at AS current_accomplished_at, m.blocked_since AS current_blocked_since
       FROM \`${spec.table}\` t
       JOIN user_subjects us ON us.user_subject_id = t.user_subject_id
       LEFT JOIN workboard_entry_meta m
         ON m.\`${spec.metaCol}\` = t.\`${spec.pk}\` AND m.user_id = ?
      WHERE t.\`${spec.pk}\` = ? AND us.user_id = ?`,
    [userId, entryId, userId],
  );
  if (!owns.length) throw new AcademicItemNotFoundError();
  const currentStatus = owns[0].current_status as string;
  const currentStage  = owns[0].current_stage as string | null;
  const isGraded =
    owns[0].current_score !== null && owns[0].current_items !== null && owns[0].current_grade !== null;

  // A stage implies its status; a bare status (v2 callers) implies the matching stage —
  // 'todo', 'in_progress' and 'done' are all legal academic stage names, so the cast is
  // sound for every value the route lets through. `stage` is what the overlay stores;
  // `status` is what Study Pulse gets. `submitted` ("For Revision") normalises to
  // 'in_progress' — an active state — so moving into it sets the entry back to Pending,
  // except on a graded entry (see `revisionOnGraded` below).
  const stage: WorkStage | undefined =
    patch.work_stage ?? (patch.work_status ? patch.work_status as WorkStage : undefined);
  const status: WorkStatus | undefined = stage ? normaliseStage(stage) : patch.work_status;

  // The stage counterpart of the status gate below. A bare `work_status` — which both the
  // edit dialog (it resends the whole form) and any status-only PATCH send — must not flatten a
  // finer stored stage it never meant to touch: `ready_to_submit` normalises to
  // 'in_progress', so an unchanged status would otherwise rewrite it to plain
  // 'in_progress'. Write the stage only when an explicit `work_stage` asked for it, when
  // there is no usable stored stage to preserve, or when the normalised status genuinely
  // moved (making the stored stage stale). Same shape as the work-items route's gate.
  const usableStoredStage: WorkStage | null =
    currentStage !== null && isStageLegal('academic', currentStage) ? currentStage : null;
  const stageChanging =
    stage !== undefined && (
      patch.work_stage !== undefined ||
      usableStoredStage === null ||
      normaliseStage(usableStoredStage) !== status
    );

  // A graded entry's trigger pins it Done, so a revision stage on one (moving into it, or a
  // dialog save that keeps it) lives in the overlay only: the entry is left untouched rather
  // than refused with `AcademicItemGradedError`. The read path shows the overlay's
  // `submitted` over the Done entry.
  const effectiveStage = stageChanging ? stage! : usableStoredStage;
  const revisionOnGraded = spec.hasGradedTrigger && isGraded && isRevisionStage(effectiveStage);

  const incomingStatus = status === 'done' ? 'Done' : status !== undefined ? 'Pending' : undefined;
  const statusChanging =
    incomingStatus !== undefined && incomingStatus !== currentStatus && !revisionOnGraded;

  // Whole-branch review Finding C-1: `activities`/`quizzes`/`exams` each carry a
  // `BEFORE UPDATE` trigger that forces `status = 'Done'` the instant `score`/`items`/`grade`
  // are all non-null — on ANY update to the row, not only one that touches `status`. A patch
  // that only changes the deadline or the priority still fires it, silently marking a
  // `Pending` graded row `Done` with no `accomplished_at` ever written, which drops it out of
  // `getWorkItems`'s academic predicate. So this must gate the entry table UPDATE as a whole,
  // not only the status branch below — `touchesEntryTable` is true whenever ANY of the three
  // entry-table-affecting fields would produce a `SET` clause. Overlay-only fields
  // (`deadline_time`/`estimated_hours`/`start_date`/`work_stage`/`note`) never reach this table at
  // all (they write `workboard_entry_meta` instead) and are correctly unaffected by this guard.
  const touchesEntryTable = statusChanging || patch.due_at !== undefined || patch.priority !== undefined;
  if (spec.hasGradedTrigger && isGraded && touchesEntryTable) {
    throw new AcademicItemGradedError();
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const entrySets: string[] = [];
    const entryValues: (string | null)[] = [];

    // Gated on `statusChanging`, not merely `patch.work_status !== undefined` — the dialog
    // always sends the item's current work_status even when the user never touched the
    // Status field, so an unconditional write here would re-stamp (or clear) `accomplished_at`
    // on every save. See Finding 1 of the whole-branch review.
    if (statusChanging) {
      if (status === 'done') {
        entrySets.push('status = ?', 'accomplished_at = ?');
        entryValues.push('Done', todayManilaDateString());
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

    // Overlay fields. `work_stage` is the authoritative stage column that
    // `deriveAcademicStage` reads; `in_progress` is the legacy v2 mirror, retained and
    // kept in sync for one release (see the spec's Migration section) so a rollback loses
    // nothing. The mirror is deliberately lossy — 'ready_to_submit' stores in_progress = 0
    // — because the reader only consults the flag when `work_stage` is absent, and a
    // row written by this path always has one.
    const overlayCols: string[] = [];
    const overlayVals: (string | number | null)[] = [];
    // Both columns move together or neither does, so the mirror can never be left
    // describing a stage the row no longer has.
    if (stageChanging) {
      overlayCols.push('work_stage'); overlayVals.push(stage!);
      overlayCols.push('in_progress'); overlayVals.push(stage === 'in_progress' ? 1 : 0);
    }
    if (patch.deadline_time !== undefined) {
      overlayCols.push('deadline_time');
      overlayVals.push(patch.deadline_time ? normaliseDeadlineTime(patch.deadline_time) : null);
    }
    if (patch.estimated_hours !== undefined) {
      overlayCols.push('estimated_hours'); overlayVals.push(patch.estimated_hours);
    }
    if (patch.start_date !== undefined) {
      overlayCols.push('start_date'); overlayVals.push(patch.start_date);
    }
    if (patch.note !== undefined) {
      overlayCols.push('note'); overlayVals.push(patch.note);
    }

    // blocked_reason / blocked_since: the same transition rules as the work-items PATCH
    // route, against the stored overlay stage. `blocked_since` is server-stamped.
    const reasonValue = normaliseWaitingReason(patch.blocked_reason);
    // Judged on the stage the read path shows: a `submitted` overlay that Study Pulse has
    // since overridden (completed after being sent back) is not waiting, so re-entering
    // For Revision stamps a fresh `blocked_since` rather than keeping the stale one.
    const wasWaiting = usableStoredStage !== null && isWaitingStage(deriveAcademicStage(
      currentStatus, usableStoredStage, null,
      owns[0].current_accomplished_at, owns[0].current_blocked_since,
    ));
    if (stageChanging) {
      const isWaiting = isWaitingStage(stage);
      if (isWaiting && !wasWaiting) {
        overlayCols.push('blocked_since', 'blocked_reason');
        overlayVals.push(manilaNowDatetime(), reasonValue);
      } else if (!isWaiting && wasWaiting) {
        overlayCols.push('blocked_since', 'blocked_reason');
        overlayVals.push(null, null);
      } else if (isWaiting && wasWaiting && patch.blocked_reason !== undefined) {
        overlayCols.push('blocked_reason'); overlayVals.push(reasonValue);
      }
    } else if (patch.blocked_reason !== undefined && wasWaiting) {
      overlayCols.push('blocked_reason'); overlayVals.push(reasonValue);
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
