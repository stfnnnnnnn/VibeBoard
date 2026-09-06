import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import {
  ACADEMIC_TABLES, urgencyFromPriority,
  type AcademicSource, type WorkPriority, type WorkStatus,
} from '@/lib/workboard/workItems';
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
