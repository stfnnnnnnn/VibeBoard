import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureGradingV2Schema } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { setSubjectPresetTx } from '@/lib/studypulse/presetWrites';

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
    'SELECT * FROM grading_presets WHERE preset_id=? AND user_id=?',
    [presetId, userId]
  );
  // A subject pointing at another user's preset (possible before Task 6) exposes nothing from it.
  if (!presets.length) {
    return Response.json({
      config: {
        user_subject_id: userSubjectId,
        preset_id:   sg.preset_id,
        has_lab:     sg.has_lab,
        lec_weight:  sg.lec_weight,
        lab_weight:  sg.lab_weight,
        grade_scale: '4pt',
        preset:      null,
      }
    });
  }
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
   Upsert the subject's grading config. Body: { preset_id, has_lab, lec_weight, lab_weight, map? }. Switching a
   subject that has entries to a different preset needs `map` (old cat_id -> new cat_id | 'delete'), else 400
   { error: 'map-required', categories: [{ cat_id, name, entry_count }] }. SQL: setSubjectPresetTx. */
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

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: 'Invalid request' }, { status: 400 });
  const { preset_id, has_lab, lec_weight, lab_weight, map } = body;
  const presetId = Number(preset_id);
  if (!Number.isInteger(presetId)) return Response.json({ error: 'Grading system not found' }, { status: 404 });

  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Preset ownership (locking read), the entry map and the upsert all run in this one transaction.
    const result = await setSubjectPresetTx(conn, userId, userSubjectId, presetId, { has_lab, lec_weight, lab_weight, map });
    if (result.status === 200) await conn.commit();
    else await conn.rollback();
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    await conn.rollback();
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    conn.release();
  }
}
