import pool from '@/lib/db';
import type { ResultSetHeader } from 'mysql2';
import type { SqlExecutor } from '@/lib/studypulseEntries';
import type { OverrideModality } from '@/lib/workboard/dates';

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

/** `movedDate`/`movedStartTime`/`movedEndTime` are set together, and only when `modality` is
 *  `'rescheduled'` — a make-up class's new slot. `null` for anything else (`'online_sync'`,
 *  `'online_async'`, `'cancelled'`, or `null`), which annotate the occurrence in place rather
 *  than relocating it. */
export interface ScheduleOverrideInput {
  blockId:              number;
  overrideDate:         string;  // "YYYY-MM-DD"
  modality:             OverrideModality;
  note:                 string | null;
  movedDate:            string | null;  // "YYYY-MM-DD"
  movedStartTime:       string | null;  // "HH:MM"
  movedEndTime:         string | null;  // "HH:MM"
  sourceType:           'manual' | 'canvas_announcement';
  sourceAnnouncementId: number | null;
}

export async function insertScheduleOverride(
  input: ScheduleOverrideInput, db: SqlExecutor = pool,
): Promise<{ overrideId: number }> {
  const [r] = await db.execute<ResultSetHeader>(
    `INSERT INTO schedule_overrides
       (block_id, override_date, modality, note, moved_date, moved_start_time, moved_end_time,
        source_type, source_announcement_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [input.blockId, input.overrideDate, input.modality, input.note,
     input.movedDate, input.movedStartTime, input.movedEndTime,
     input.sourceType, input.sourceAnnouncementId],
  );
  return { overrideId: r.insertId };
}

/** The fields a PATCH can change — never `blockId`/`overrideDate`, which identify WHICH
 *  occurrence this override annotates (see `ScheduleOverrideInput`'s own doc); those are fixed
 *  at creation, exactly like `insertScheduleOverride`'s equivalents. */
export interface ScheduleOverrideUpdate {
  modality:       OverrideModality;
  note:           string | null;
  movedDate:      string | null;
  movedStartTime: string | null;
  movedEndTime:   string | null;
}

export async function updateScheduleOverride(
  overrideId: number, input: ScheduleOverrideUpdate, db: SqlExecutor = pool,
): Promise<void> {
  await db.execute(
    `UPDATE schedule_overrides
     SET modality = ?, note = ?, moved_date = ?, moved_start_time = ?, moved_end_time = ?
     WHERE id = ?`,
    [input.modality, input.note, input.movedDate, input.movedStartTime, input.movedEndTime, overrideId],
  );
}

