import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import {
  insertActivityEntry, insertQuizEntry, insertExamEntry, insertGradeEntry,
} from '@/lib/studypulseEntries';
import { insertWorkboardItem, insertScheduleOverride } from '@/lib/workboard/items';
import { ensureWorkboardSchema, ensureEntryNoteSchema } from '@/lib/migrate';

interface AnnouncementRow extends RowDataPacket {
  id: number;
  title: string;
  bank_status: 'pending' | 'included' | 'ignored' | 'removed_upstream';
  user_subject_id: number;
}

const LEGACY_TARGETS = ['activities', 'quizzes', 'exams'] as const;

interface TaskDestination {
  type: 'task';
  target_type: 'activities' | 'quizzes' | 'exams' | 'grade_entries';
  cat_id?: number;
  period_id?: number;
  deadline: string;
  /** Ruling R15: the entry's name; trimmed, ≤ 255, empty falls back to the announcement title. */
  title?: string | null;
  note?: string | null;
}
interface EventDestination {
  type: 'event';
  title: string;
  location?: string | null;
  starts_at: string;
  ends_at: string;
  user_subject_id?: number | null;
  note?: string | null;
}
interface ReminderDestination {
  type: 'reminder';
  title: string;
  remind_at?: string | null;
  note?: string | null;
}
interface ScheduleChangeDestination {
  type: 'schedule_change';
  block_id: number;
  override_date: string;
  modality?: 'online_sync' | 'online_async' | 'cancelled' | null;
  note?: string | null;
}
type DestinationInput = TaskDestination | EventDestination | ReminderDestination | ScheduleChangeDestination;

const NOTE_MAX = 1000;
const TITLE_MAX = 255; // the entry tables' name column

/** Ruling R15: an optional task title; trimmed; empty means "use the announcement title". */
function normalizeTitle(raw: unknown): { ok: true; title: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, title: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Invalid title' };
  const title = raw.trim();
  if (title.length > TITLE_MAX) return { ok: false, error: 'Title is too long' };
  return { ok: true, title: title === '' ? null : title };
}

/** Spec §6.1: trimmed; empty means null; over 1,000 characters is rejected. */
function normalizeNote(raw: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, note: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Invalid note' };
  const note = raw.trim();
  if (note.length > NOTE_MAX) return { ok: false, error: 'Note is too long' };
  return { ok: true, note: note === '' ? null : note };
}

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
  await ensureWorkboardSchema();
  // The task destination writes workboard_entry_meta.note (Ruling R2).
  await ensureEntryNoteSchema();

  try {
    const { id } = await props.params;
    const announcementId = parseInt(id);
    const userId = parseInt(session.user.id);
    const { destinations } = await req.json() as { destinations?: DestinationInput[] };

    if (!Array.isArray(destinations) || destinations.length === 0) {
      return Response.json({ error: 'At least one destination is required' }, { status: 400 });
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
    if (item.bank_status === 'included') {
      return Response.json({ error: 'This announcement has already been included' }, { status: 409 });
    }
    if (item.bank_status !== 'pending' && item.bank_status !== 'ignored') {
      return Response.json(
        { error: 'This announcement is no longer reported by Canvas and can no longer be included' },
        { status: 400 },
      );
    }

    const subjectMode = await getSubjectMode(item.user_subject_id);
    // Normalised notes, index-aligned with `destinations`.
    const notes: Array<string | null> = [];
    // Normalised task titles, index-aligned with `destinations` (null for non-tasks or "use the announcement title").
    const titles: Array<string | null> = [];
    for (const d of destinations) {
      if (d.type !== 'task' && d.type !== 'event' && d.type !== 'reminder' && d.type !== 'schedule_change') {
        return Response.json({ error: 'Invalid destination type' }, { status: 400 });
      }
      const n = normalizeNote((d as { note?: unknown }).note);
      if (!n.ok) return Response.json({ error: n.error }, { status: 400 });
      notes.push(n.note);
      if (d.type === 'task') {
        const t = normalizeTitle(d.title);
        if (!t.ok) return Response.json({ error: t.error }, { status: 400 });
        titles.push(t.title);
      } else {
        titles.push(null);
      }
      if (d.type === 'task') {
        if (
          d.target_type !== 'activities' && d.target_type !== 'quizzes'
          && d.target_type !== 'exams' && d.target_type !== 'grade_entries'
        ) {
          return Response.json({ error: 'Invalid target_type' }, { status: 400 });
        }
        if (subjectMode === 'custom' && LEGACY_TARGETS.includes(d.target_type as typeof LEGACY_TARGETS[number])) {
          return Response.json(
            { error: 'This subject uses custom grading. Choose a period and category instead.' },
            { status: 400 },
          );
        }
        if (d.target_type === 'grade_entries') {
          if (subjectMode === 'legacy') {
            return Response.json(
              { error: 'This subject uses legacy grading. Choose activities, quizzes, or exams instead.' },
              { status: 400 },
            );
          }
          if (!d.cat_id || !d.period_id) {
            return Response.json({ error: 'cat_id and period_id are required for grade_entries' }, { status: 400 });
          }
          const [owns] = await pool.execute<RowDataPacket[]>(
            `SELECT 1 FROM grading_categories gc
             JOIN grading_periods gp ON gp.period_id = gc.period_id
             JOIN subject_grading sg ON sg.preset_id = gp.preset_id
             WHERE gc.cat_id = ? AND gc.period_id = ? AND sg.user_subject_id = ?`,
            [d.cat_id, d.period_id, item.user_subject_id],
          );
          if (!owns.length) {
            return Response.json({ error: 'That category/period does not belong to this subject' }, { status: 400 });
          }
        }
      }
      if (d.type === 'event' && d.user_subject_id != null) {
        const [owns] = await pool.execute<RowDataPacket[]>(
          'SELECT 1 FROM user_subjects WHERE user_subject_id = ? AND user_id = ?', [d.user_subject_id, userId],
        );
        if (!owns.length) return Response.json({ error: 'That subject was not found' }, { status: 400 });
      }
      if (d.type === 'schedule_change') {
        const [owns] = await pool.execute<RowDataPacket[]>(
          'SELECT block_id FROM schedule_blocks WHERE block_id = ? AND user_id = ?', [d.block_id, userId],
        );
        if (!owns.length) return Response.json({ error: 'That class block was not found' }, { status: 400 });
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Re-read the status under a row lock: two concurrent includes both pass the check above, but only the first
      // gets here with 'pending'/'ignored'; the second waits on the lock, then sees 'included' and stops.
      const [locked] = await conn.execute<RowDataPacket[]>(
        'SELECT bank_status FROM canvas_announcement_bank WHERE id = ? FOR UPDATE', [announcementId],
      );
      const lockedStatus = locked[0]?.bank_status as AnnouncementRow['bank_status'] | undefined;
      if (lockedStatus === 'included') {
        await conn.rollback();
        return Response.json({ error: 'This announcement has already been included' }, { status: 409 });
      }
      if (lockedStatus !== 'pending' && lockedStatus !== 'ignored') {
        await conn.rollback();
        return Response.json(
          { error: 'This announcement is no longer reported by Canvas and can no longer be included' },
          { status: 400 },
        );
      }
      const createdEntryIds: number[] = [];

      for (const [i, d] of destinations.entries()) {
        const note = notes[i];
        let linkColumn: 'activity_id' | 'quiz_id' | 'exam_id' | 'grade_entry_id' | 'workboard_item_id' | 'schedule_override_id';
        let linkedId: number;

        if (d.type === 'task') {
          const commonFields = {
            entryId: null, userSubjectId: item.user_subject_id, name: titles[i] ?? item.title,
            specificType: '', urgency: 'Medium', status: 'Pending', deadline: d.deadline,
            score: null, items: null, grade: null, accomplishedAt: null,
          };
          if (d.target_type === 'activities') { linkedId = (await insertActivityEntry(commonFields, conn)).entryId; linkColumn = 'activity_id'; }
          else if (d.target_type === 'quizzes') { linkedId = (await insertQuizEntry(commonFields, conn)).entryId; linkColumn = 'quiz_id'; }
          else if (d.target_type === 'exams') { linkedId = (await insertExamEntry(commonFields, conn)).entryId; linkColumn = 'exam_id'; }
          else {
            // cat_id/period_id ownership was already validated in the pre-transaction
            // validation loop above; no need to re-check here.
            linkedId = (await insertGradeEntry({ ...commonFields, catId: d.cat_id!, periodId: d.period_id!, isLab: false }, conn)).entryId;
            linkColumn = 'grade_entry_id';
          }
          // School tasks keep their note on the Workboard overlay (spec §6.1). The meta table
          // has a UNIQUE key on each entry column, so this upserts the row for the new entry.
          if (note !== null) {
            await conn.execute(
              `INSERT INTO workboard_entry_meta (user_id, ${linkColumn}, note) VALUES (?, ?, ?)
               ON DUPLICATE KEY UPDATE note = VALUES(note)`,
              [userId, linkedId, note],
            );
          }
        } else if (d.type === 'event') {
          linkedId = (await insertWorkboardItem({
            userId, userSubjectId: d.user_subject_id ?? item.user_subject_id, itemType: 'event',
            title: d.title, location: d.location ?? null, startsAt: d.starts_at, endsAt: d.ends_at,
            remindAt: null, note, sourceType: 'canvas_announcement', sourceAnnouncementId: announcementId,
          }, conn)).itemId;
          linkColumn = 'workboard_item_id';
        } else if (d.type === 'reminder') {
          linkedId = (await insertWorkboardItem({
            userId, userSubjectId: item.user_subject_id, itemType: 'reminder',
            title: d.title, location: null, startsAt: null, endsAt: null,
            remindAt: d.remind_at ?? null, note, sourceType: 'canvas_announcement', sourceAnnouncementId: announcementId,
          }, conn)).itemId;
          linkColumn = 'workboard_item_id';
        } else {
          linkedId = (await insertScheduleOverride({
            blockId: d.block_id, overrideDate: d.override_date, modality: d.modality ?? null,
            note, room: null, movedDate: null, movedStartTime: null, movedEndTime: null,
            sourceType: 'canvas_announcement', sourceAnnouncementId: announcementId,
          }, conn)).overrideId;
          linkColumn = 'schedule_override_id';
        }

        await conn.execute(
          `INSERT INTO canvas_announcement_links (announcement_id, ${linkColumn}) VALUES (?, ?)`,
          [announcementId, linkedId],
        );
        createdEntryIds.push(linkedId);
      }

      await conn.execute(
        `UPDATE canvas_announcement_bank SET bank_status = 'included' WHERE id = ?`,
        [announcementId],
      );

      await conn.commit();
      return Response.json({ status: 'success', created: createdEntryIds });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    // Logged in full, but the client only gets a generic line: raw DB error text leaks schema details.
    console.error('Canvas announcement include failed:', err);
    return Response.json({ error: 'Could not convert this announcement. Try again.' }, { status: 500 });
  }
}
