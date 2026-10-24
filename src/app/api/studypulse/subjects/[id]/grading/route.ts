import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureGradingV2Schema } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';

/* GET /api/studypulse/subjects/[id]/grading
   Returns subject grading config + full preset (periods + categories) if configured */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureGradingV2Schema();
  const userId        = parseInt(session.user.id);
  const { id }        = await props.params;
  const userSubjectId = parseInt(id);

  // Verify ownership
  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM user_subjects WHERE user_subject_id=? AND user_id=?',
    [userSubjectId, userId]
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const [sgRows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM subject_grading WHERE user_subject_id=?',
    [userSubjectId]
  );
  if (!sgRows.length) return Response.json({ config: null });

  const sg       = sgRows[0];
  const presetId = sg.preset_id as number;

  const [presets] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM grading_presets WHERE preset_id=?',
    [presetId]
  );
  const [periods] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM grading_periods WHERE preset_id=? ORDER BY sort_order',
    [presetId]
  );
  const [cats] = await pool.execute<RowDataPacket[]>(
    `SELECT gc.* FROM grading_categories gc
     JOIN grading_periods gp ON gc.period_id=gp.period_id
     WHERE gp.preset_id=? ORDER BY gc.period_id, gc.sort_order`,
    [presetId]
  );

  const periodsWithCats = periods.map(p => ({
    ...p,
    categories: cats.filter(c => c.period_id === p.period_id),
  }));

  const preset = presets[0];
  return Response.json({
    config: {
      user_subject_id: userSubjectId,
      preset_id:   sg.preset_id,
      has_lab:     sg.has_lab,
      lec_weight:  sg.lec_weight,
      lab_weight:  sg.lab_weight,
      grade_scale: preset?.grade_scale ?? '4pt',
      preset:      preset ? { ...preset, periods: periodsWithCats } : null,
    }
  });
}

/* POST /api/studypulse/subjects/[id]/grading
   Upsert subject grading config (link to existing preset OR create inline) */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureGradingV2Schema();
  const userId        = parseInt(session.user.id);
  const { id }        = await props.params;
  const userSubjectId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM user_subjects WHERE user_subject_id=? AND user_id=?',
    [userSubjectId, userId]
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const { preset_id, has_lab, lec_weight, lab_weight } = await req.json();

  await pool.execute(
    `INSERT INTO subject_grading (user_subject_id, preset_id, has_lab, lec_weight, lab_weight)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       preset_id=VALUES(preset_id), has_lab=VALUES(has_lab),
       lec_weight=VALUES(lec_weight), lab_weight=VALUES(lab_weight)`,
    [userSubjectId, preset_id, has_lab ? 1 : 0, lec_weight ?? 100, lab_weight ?? 0]
  );

  return Response.json({ status: 'success' });
}
