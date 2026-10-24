import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureGradingV2Schema } from '@/lib/migrate';
import { loadGradingConfig } from '@/lib/studypulse/subjectCards';
import { periodNamesMatch } from '@/lib/studypulse/labLink';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

/* Linked lecture + lab subjects (spec §3.5). subject_links has no foreign keys, so every query here joins
   user_subjects on BOTH ids with the caller's user_id: orphaned rows stay inert. */

type Ctx = { params: Promise<{ id: string }> };

/** Session user id, or null when signed out. */
async function sessionUserId(): Promise<number | null> {
  const session = await auth();
  return session?.user?.id ? parseInt(session.user.id) : null;
}

async function owns(userId: number, userSubjectId: number): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM user_subjects WHERE user_subject_id=? AND user_id=?', [userSubjectId, userId],
  );
  return rows.length > 0;
}

/** Links involving any of `ids`, both sides owned by `userId`. */
async function linksInvolving(userId: number, ids: number[]): Promise<RowDataPacket[]> {
  const ph = ids.map(() => '?').join(',');
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT sl.lecture_user_subject_id AS lec, sl.lab_user_subject_id AS lab, sl.lecture_weight
    FROM subject_links sl
    JOIN user_subjects ul ON ul.user_subject_id = sl.lecture_user_subject_id AND ul.user_id = ?
    JOIN user_subjects ub ON ub.user_subject_id = sl.lab_user_subject_id AND ub.user_id = ?
    WHERE sl.lecture_user_subject_id IN (${ph}) OR sl.lab_user_subject_id IN (${ph})
  `, [userId, userId, ...ids, ...ids]);
  return rows;
}

/* GET /api/studypulse/subjects/[id]/lab-link
   { link: { role, partner_user_subject_id, partner_code, partner_name, lecture_weight } | null } */
export async function GET(_req: NextRequest, props: Ctx) {
  const userId = await sessionUserId();
  if (userId === null) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureGradingV2Schema();
  const userSubjectId = parseInt((await props.params).id);
  if (!(await owns(userId, userSubjectId))) return Response.json({ error: 'Not found' }, { status: 404 });

  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT sl.lecture_user_subject_id AS lec, sl.lab_user_subject_id AS lab, sl.lecture_weight,
           sub_lec.course_code AS lec_code, sub_lec.subject_name AS lec_name,
           sub_lab.course_code AS lab_code, sub_lab.subject_name AS lab_name
    FROM subject_links sl
    JOIN user_subjects ul ON ul.user_subject_id = sl.lecture_user_subject_id AND ul.user_id = ?
    JOIN user_subjects ub ON ub.user_subject_id = sl.lab_user_subject_id AND ub.user_id = ?
    JOIN subjects sub_lec ON sub_lec.subject_id = ul.subject_id
    JOIN subjects sub_lab ON sub_lab.subject_id = ub.subject_id
    WHERE sl.lecture_user_subject_id = ? OR sl.lab_user_subject_id = ?
    LIMIT 1
  `, [userId, userId, userSubjectId, userSubjectId]);
  if (!rows.length) return Response.json({ link: null });

  const r = rows[0];
  const isLecture = Number(r.lec) === userSubjectId;
  return Response.json({
    link: {
      role: isLecture ? 'lecture' : 'lab',
      partner_user_subject_id: Number(isLecture ? r.lab : r.lec),
      partner_code: (isLecture ? r.lab_code : r.lec_code) as string,
      partner_name: (isLecture ? r.lab_name : r.lec_name) as string,
      lecture_weight: Number(r.lecture_weight),
    },
  });
}

/* PUT /api/studypulse/subjects/[id]/lab-link   body { lab_user_subject_id, lecture_weight }
   Links this subject (the lecture) to a lab subject, replacing any link between these two. */
export async function PUT(req: NextRequest, props: Ctx) {
  const userId = await sessionUserId();
  if (userId === null) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureGradingV2Schema();
  const lecId = parseInt((await props.params).id);
  const body = await req.json().catch(() => null) as { lab_user_subject_id?: unknown; lecture_weight?: unknown } | null;
  const labId = Number(body?.lab_user_subject_id);
  const weight = Number(body?.lecture_weight);

  if (!(await owns(userId, lecId))) return Response.json({ error: 'Not found' }, { status: 404 });
  if (!Number.isInteger(labId) || !(await owns(userId, labId))) {
    return Response.json({ error: 'Lab subject not found' }, { status: 404 });
  }
  if (labId === lecId) return Response.json({ error: 'A subject cannot be linked to itself' }, { status: 400 });

  const pair = new Set([lecId, labId]);
  const others = (await linksInvolving(userId, [lecId, labId]))
    .filter(r => !(pair.has(Number(r.lec)) && pair.has(Number(r.lab))));
  if (others.length) {
    return Response.json({ error: 'One of these subjects is already linked to another subject' }, { status: 409 });
  }

  const [lecConfig, labConfig] = await Promise.all([loadGradingConfig(lecId, userId), loadGradingConfig(labId, userId)]);
  const lecture_periods = lecConfig?.preset.periods.map(p => p.name) ?? [];
  const lab_periods = labConfig?.preset.periods.map(p => p.name) ?? [];
  if (!lecConfig || !labConfig) {
    return Response.json({ error: 'Both subjects need a custom grading setup', lecture_periods, lab_periods }, { status: 400 });
  }
  if (!periodNamesMatch(lecture_periods, lab_periods)) {
    return Response.json({ error: 'The two subjects must have the same grading periods, in the same order', lecture_periods, lab_periods }, { status: 400 });
  }

  if (!Number.isFinite(weight) || weight < 1 || weight > 99) {
    return Response.json({ error: 'Lecture weight must be between 1 and 99' }, { status: 400 });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `DELETE FROM subject_links
       WHERE lecture_user_subject_id IN (?, ?) OR lab_user_subject_id IN (?, ?)`,
      [lecId, labId, lecId, labId],
    );
    await conn.execute(
      'INSERT INTO subject_links (lecture_user_subject_id, lab_user_subject_id, lecture_weight) VALUES (?, ?, ?)',
      [lecId, labId, weight],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return Response.json({ status: 'success' });
}

/* DELETE /api/studypulse/subjects/[id]/lab-link
   Removes the link this subject is in, on either side. */
export async function DELETE(_req: NextRequest, props: Ctx) {
  const userId = await sessionUserId();
  if (userId === null) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureGradingV2Schema();
  const userSubjectId = parseInt((await props.params).id);
  if (!(await owns(userId, userSubjectId))) return Response.json({ error: 'Not found' }, { status: 404 });

  const [res] = await pool.execute<ResultSetHeader>(`
    DELETE sl FROM subject_links sl
    JOIN user_subjects ul ON ul.user_subject_id = sl.lecture_user_subject_id AND ul.user_id = ?
    JOIN user_subjects ub ON ub.user_subject_id = sl.lab_user_subject_id AND ub.user_id = ?
    WHERE sl.lecture_user_subject_id = ? OR sl.lab_user_subject_id = ?
  `, [userId, userId, userSubjectId, userSubjectId]);
  return Response.json({ status: 'success', removed: res.affectedRows });
}
