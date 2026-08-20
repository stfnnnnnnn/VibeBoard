import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

/* GET /api/studypulse/grading/[id] — full preset with periods + categories */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId   = parseInt(session.user.id);
  const { id }   = await props.params;
  const presetId = parseInt(id);

  const [presets] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM grading_presets WHERE preset_id=? AND user_id=?',
    [presetId, userId]
  );
  if (!presets.length) return Response.json({ error: 'Not found' }, { status: 404 });

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

  return Response.json({ preset: { ...presets[0], periods: periodsWithCats } });
}

/* PUT /api/studypulse/grading/[id] — replace preset (delete periods+cats, re-insert) */
export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId   = parseInt(session.user.id);
  const { id }   = await props.params;
  const presetId = parseInt(id);

  const { name, is_default, has_lab, lec_weight, lab_weight, periods } = await req.json();

  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (is_default) {
      await conn.execute('UPDATE grading_presets SET is_default=0 WHERE user_id=?', [userId]);
    }
    await conn.execute(
      `UPDATE grading_presets SET name=?, is_default=?, has_lab=?, lec_weight=?, lab_weight=?
       WHERE preset_id=? AND user_id=?`,
      [name, is_default ? 1 : 0, has_lab ? 1 : 0, lec_weight ?? 100, lab_weight ?? 0, presetId, userId]
    );

    // Delete old periods (cascades to categories via app-level deletion)
    const [oldPeriods] = await conn.execute<RowDataPacket[]>(
      'SELECT period_id FROM grading_periods WHERE preset_id=?', [presetId]
    );
    for (const p of oldPeriods) {
      await conn.execute('DELETE FROM grading_categories WHERE period_id=?', [p.period_id]);
    }
    await conn.execute('DELETE FROM grading_periods WHERE preset_id=?', [presetId]);

    for (let pi = 0; pi < (periods ?? []).length; pi++) {
      const period = periods[pi];
      const [pr] = await conn.execute<ResultSetHeader>(
        'INSERT INTO grading_periods (preset_id, name, sort_order) VALUES (?, ?, ?)',
        [presetId, period.name, pi]
      );
      const periodId = pr.insertId;
      for (let ci = 0; ci < (period.categories ?? []).length; ci++) {
        const cat = period.categories[ci];
        await conn.execute(
          'INSERT INTO grading_categories (period_id, name, weight, is_singleton, sort_order) VALUES (?, ?, ?, ?, ?)',
          [periodId, cat.name, cat.weight, cat.is_singleton ? 1 : 0, ci]
        );
      }
    }

    await conn.commit();
    return Response.json({ status: 'success' });
  } catch (err) {
    await conn.rollback();
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    conn.release();
  }
}

/* DELETE /api/studypulse/grading/[id] */
export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId   = parseInt(session.user.id);
  const { id }   = await props.params;
  const presetId = parseInt(id);

  const [periods] = await pool.execute<RowDataPacket[]>(
    'SELECT period_id FROM grading_periods WHERE preset_id=?', [presetId]
  );
  for (const p of periods) {
    await pool.execute('DELETE FROM grading_categories WHERE period_id=?', [p.period_id]);
  }
  await pool.execute('DELETE FROM grading_periods WHERE preset_id=?', [presetId]);
  await pool.execute<ResultSetHeader>(
    'DELETE FROM grading_presets WHERE preset_id=? AND user_id=?', [presetId, userId]
  );
  return Response.json({ status: 'success' });
}
