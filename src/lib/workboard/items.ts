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
