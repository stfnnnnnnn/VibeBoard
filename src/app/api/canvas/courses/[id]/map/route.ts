import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await props.params;
  const courseRowId = parseInt(id);
  const userId = parseInt(session.user.id);
  const { mode, user_subject_id, subject_name, course_code, units, year_level, trimester } = await req.json();

  const [ownedCourse] = await pool.execute<RowDataPacket[]>(
    `SELECT cc.id, cc.name FROM canvas_courses cc
     JOIN canvas_connections conn ON conn.id = cc.connection_id
     WHERE cc.id = ? AND conn.user_id = ?`,
    [courseRowId, userId],
  );
  if (ownedCourse.length === 0) return Response.json({ error: 'Not found' }, { status: 404 });

  if (mode === 'ignore') {
    await pool.execute(`UPDATE canvas_courses SET mapping_status = 'ignored' WHERE id = ?`, [courseRowId]);
    return Response.json({ status: 'success' });
  }

  if (mode === 'link') {
    if (!user_subject_id) return Response.json({ error: 'user_subject_id required' }, { status: 400 });
    const [owned] = await pool.execute<RowDataPacket[]>(
      `SELECT user_subject_id FROM user_subjects WHERE user_subject_id = ? AND user_id = ?`,
      [user_subject_id, userId],
    );
    if (owned.length === 0) return Response.json({ error: 'Subject not found' }, { status: 404 });

    await pool.execute(
      `UPDATE canvas_courses SET mapping_status = 'linked', user_subject_id = ? WHERE id = ?`,
      [user_subject_id, courseRowId],
    );
    return Response.json({ status: 'success' });
  }

  if (mode === 'create') {
    if (!subject_name || !course_code || !year_level || !trimester) {
      return Response.json({ error: 'subject_name, course_code, year_level, trimester are required' }, { status: 400 });
    }
    const [subRes] = await pool.execute<ResultSetHeader>(
      `INSERT INTO subjects (subject_name, course_code, units, year_level, trimester) VALUES (?,?,?,?,?)`,
      [subject_name.trim(), course_code.trim(), Number(units) || 0, year_level, trimester],
    );
    const [usRes] = await pool.execute<ResultSetHeader>(
      `INSERT INTO user_subjects (user_id, subject_id) VALUES (?,?)`,
      [userId, subRes.insertId],
    );
    await pool.execute(
      `UPDATE canvas_courses SET mapping_status = 'created', user_subject_id = ? WHERE id = ?`,
      [usRes.insertId, courseRowId],
    );
    return Response.json({ status: 'success', user_subject_id: usRes.insertId });
  }

  return Response.json({ error: 'mode must be link, create, or ignore' }, { status: 400 });
}
