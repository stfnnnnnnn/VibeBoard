import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { ensureWorkboardV3Schema, ensureEntryNoteSchema } from '@/lib/migrate';
import { checkReferences } from '@/lib/workboard/ownership';
import { ACADEMIC_TABLES } from '@/lib/workboard/workItems';
import { parseEntryNote } from '@/lib/workboard/academicWrites';
import {
  insertActivityEntry, insertQuizEntry, insertExamEntry, insertGradeEntry,
} from '@/lib/studypulseEntries';

const LEGACY_TARGETS = ['activities', 'quizzes', 'exams'] as const;

/** `activities.activity_name`, `quizzes.quiz_name`, `exams.exam_name` and
 *  `grade_entries.name` are all VARCHAR(100) on the live schema (verified against
 *  information_schema, not assumed), and this database does not run in STRICT mode — an
 *  over-long title would be silently truncated rather than rejected, quietly mangling a
 *  row in a module Workboard does not own. Reject it here instead. */
const MAX_TITLE_LENGTH = 100;

/** Same check the Canvas Include route uses: a subject is "custom" mode when it has a
 *  subject_grading row pointing at a real grading preset. */
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
    console.error('Workboard academic create: grading-mode lookup failed, assuming legacy:', err);
    return 'legacy';
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();
  // The overlay's `note` column, written below when a note is sent (spec 2026-10-24 §6.1).
  await ensureEntryNoteSchema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const { user_subject_id, title, target_type, cat_id, period_id, deadline, priority } = body;

  if (typeof title !== 'string' || !title.trim()) {
    return Response.json({ error: 'A title is required' }, { status: 400 });
  }
  if (title.trim().length > MAX_TITLE_LENGTH) {
    return Response.json(
      { error: `A title of at most ${MAX_TITLE_LENGTH} characters is required` },
      { status: 400 },
    );
  }
  if (typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return Response.json({ error: 'A deadline (YYYY-MM-DD) is required' }, { status: 400 });
  }
  // The regex proves the shape, not the date: '2026-13-45', '2026-02-31' and '0000-00-00'
  // all match it. This is the same hazard as MAX_TITLE_LENGTH above — `sql_mode` here is
  // NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION with no STRICT_TRANS_TABLES, so
  // MySQL stores an impossible date with a warning instead of erroring and the route
  // answers 200, leaving a live Study Pulse row with a zero deadline that both Workboard
  // and the Study Pulse subject page have to render. Require the date to round-trip.
  const parsedDeadline = new Date(`${deadline}T00:00:00Z`);
  if (
    Number.isNaN(parsedDeadline.getTime()) ||
    parsedDeadline.toISOString().slice(0, 10) !== deadline
  ) {
    return Response.json({ error: 'A deadline (YYYY-MM-DD) is required' }, { status: 400 });
  }
  // Optional. Validated with the other fields, before anything is written, so an over-long
  // note can never leave a Study Pulse row behind with no overlay.
  const parsedNote = parseEntryNote(body.note);
  if (!parsedNote.ok) return Response.json({ error: parsedNote.error }, { status: 400 });
  // `checkReferences` skips keys whose value is null/undefined, so an omitted or
  // non-numeric `user_subject_id` would sail straight past it and land a Study Pulse row
  // with a null subject. Everything below — the grading-mode lookup, the category
  // ownership join, the insert itself — assumes this has been established first. The
  // strictness is deliberate: the raw value flows unchanged into four consumers, so there
  // is no seam for a coerced-versus-raw mismatch, and `parseInt('11abc') === 11` /
  // `Number(true) === 1` die at the door. The two messages are split so a present-but-
  // wrong-typed value (a `<select>` sends a *string*) does not read as a missing field.
  if (!('user_subject_id' in body)) {
    return Response.json({ error: 'A subject is required' }, { status: 400 });
  }
  if (!Number.isInteger(user_subject_id) || user_subject_id <= 0) {
    return Response.json(
      { error: 'user_subject_id must be a positive integer' },
      { status: 400 },
    );
  }
  const refError = await checkReferences(userId, { userSubjectId: user_subject_id });
  if (refError) return Response.json({ error: refError }, { status: 400 });

  const mode = await getSubjectMode(user_subject_id);
  if (mode === 'custom' && LEGACY_TARGETS.includes(target_type)) {
    return Response.json(
      { error: 'This subject uses custom grading. Choose a period and category instead.' },
      { status: 400 },
    );
  }
  if (mode === 'legacy' && target_type === 'grade_entries') {
    return Response.json(
      { error: 'This subject uses the standard Activity/Quiz/Exam categories.' },
      { status: 400 },
    );
  }
  if (target_type !== 'grade_entries' && !LEGACY_TARGETS.includes(target_type)) {
    return Response.json({ error: 'Invalid target_type' }, { status: 400 });
  }
  if (target_type === 'grade_entries') {
    if (!cat_id || !period_id) {
      return Response.json({ error: 'cat_id and period_id are required for grade_entries' }, { status: 400 });
    }
    // Same rule as `user_subject_id`, so one creation dialog does not face three different
    // rules for three fields that all come out of a `<select>`. Not a security control —
    // the ownership join below gates both before they reach the insert — but without it a
    // garbage type surfaces either as the misleading "does not belong to this subject" or,
    // for an array, as an unhandled 500 from `execute`.
    if (!Number.isInteger(cat_id) || cat_id <= 0) {
      return Response.json({ error: 'cat_id must be a positive integer' }, { status: 400 });
    }
    if (!Number.isInteger(period_id) || period_id <= 0) {
      return Response.json({ error: 'period_id must be a positive integer' }, { status: 400 });
    }
    // Never trust a client-supplied cat_id/period_id: this proves the category lives in the
    // given period and that period's preset is the one configured for THIS subject. It is
    // only sound because `checkReferences` above already proved the subject is the user's.
    const [owns] = await pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM grading_categories gc
       JOIN grading_periods gp ON gp.period_id = gc.period_id
       JOIN subject_grading sg ON sg.preset_id = gp.preset_id
       WHERE gc.cat_id = ? AND gc.period_id = ? AND sg.user_subject_id = ?`,
      [cat_id, period_id, user_subject_id],
    );
    if (!owns.length) {
      return Response.json({ error: 'That category/period does not belong to this subject' }, { status: 400 });
    }
  }

  // Anything that isn't 'high' or 'low' is deliberately treated as Medium — the creation
  // form only ever sends those three, and an unknown value is not worth a 400 here.
  const urgency = priority === 'high' ? 'High' : priority === 'low' ? 'Low' : 'Medium';
  // score/items/grade stay null: the row is created ungraded. Study Pulse's pre-existing
  // BEFORE UPDATE trigger forces status='Done' on graded rows, so leaving these null is
  // what keeps a freshly-created item safe to un-complete from Workboard.
  const common = {
    entryId: null, userSubjectId: user_subject_id, name: title.trim(),
    specificType: '', urgency, status: 'Pending', deadline,
    score: null, items: null, grade: null, accomplishedAt: null,
  };

  // The entry and its overlay note are one write: a transaction, so a failed note insert
  // never leaves a note-less entry the user asked to carry one.
  const conn = await pool.getConnection();
  let entryId: number;
  try {
    await conn.beginTransaction();
    if (target_type === 'activities')     entryId = (await insertActivityEntry(common, conn)).entryId;
    else if (target_type === 'quizzes')   entryId = (await insertQuizEntry(common, conn)).entryId;
    else if (target_type === 'exams')     entryId = (await insertExamEntry(common, conn)).entryId;
    else entryId = (await insertGradeEntry({ ...common, catId: cat_id, periodId: period_id, isLab: false }, conn)).entryId;

    // The Canvas Include route's shape: the overlay has a UNIQUE key per entry column, so
    // this upserts the row for the new entry. A fresh entry has no overlay row yet, so the
    // ON DUPLICATE branch is only a guard.
    if (parsedNote.note !== null) {
      const metaCol = ACADEMIC_TABLES.find(s => s.source === target_type)!.metaCol;
      await conn.execute(
        `INSERT INTO workboard_entry_meta (user_id, \`${metaCol}\`, note) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE note = VALUES(note)`,
        [userId, entryId, parsedNote.note],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return Response.json({ status: 'success', source: target_type, entry_id: entryId });
}
