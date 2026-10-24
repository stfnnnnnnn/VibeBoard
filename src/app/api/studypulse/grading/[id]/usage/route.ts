import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureGradingV2Schema } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';

/* GET /api/studypulse/grading/[id]/usage
   { subjects: [{ user_subject_id, code, name, entry_count }] } — every subject of this user assigned to the
   preset (0-entry subjects included); entry_count counts that subject's grade_entries in this preset's categories. */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureGradingV2Schema();
  const userId   = parseInt(session.user.id);
  const { id }   = await props.params;
  const presetId = parseInt(id);
  if (!Number.isInteger(presetId)) return Response.json({ error: 'Not found' }, { status: 404 });

  const [owned] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM grading_presets WHERE preset_id=? AND user_id=?',
    [presetId, userId]
  );
  if (!owned.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT us.user_subject_id, s.course_code AS code, s.subject_name AS name,
           COUNT(ge.entry_id) AS entry_count
    FROM subject_grading sg
    JOIN user_subjects us ON us.user_subject_id = sg.user_subject_id AND us.user_id = ?
    JOIN subjects s ON s.subject_id = us.subject_id
    LEFT JOIN grade_entries ge
      ON ge.user_subject_id = sg.user_subject_id
     AND ge.cat_id IN (
       SELECT gc.cat_id FROM grading_categories gc
       JOIN grading_periods gp ON gp.period_id = gc.period_id
       WHERE gp.preset_id = ?
     )
    WHERE sg.preset_id = ?
    GROUP BY us.user_subject_id, s.course_code, s.subject_name
    ORDER BY s.course_code, us.user_subject_id
  `, [userId, presetId, presetId]);

  return Response.json({
    subjects: rows.map(r => ({
      user_subject_id: Number(r.user_subject_id),
      code: r.code as string,
      name: r.name as string,
      entry_count: Number(r.entry_count),
    })),
  });
}
