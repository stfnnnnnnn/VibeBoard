import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureGradingV2Schema } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { editPresetTx } from '@/lib/studypulse/presetWrites';

/* GET /api/studypulse/grading/[id] — full preset with periods + categories */
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

  // Ownership: the preset row itself is scoped by user_id; everything below keys off this preset.
  const [presets] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM grading_presets WHERE preset_id=? AND user_id=?',
    [presetId, userId]
  );
  if (!presets.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const [periods] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM grading_periods WHERE preset_id=? ORDER BY sort_order',
    [presetId]
  );

  // SELECT gc.* carries every category column, include_earlier included.
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

/* PUT /api/studypulse/grading/[id] — edit a grading system without losing entries (spec §3.6).
   Body: { name, grade_scale, final_mode, final_period_index, periods: DraftPeriod[], moves, scope: 'all' | 'copy',
   user_subject_id }. One transaction; the preset row is locked and ownership-checked before anything else.
   'all' edits in place (ids kept); 'copy' clones the draft for user_subject_id only.
   The in-transaction body (ownership, validation, SQL) is editPresetTx in lib/studypulse/presetWrites. */
export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureGradingV2Schema();
  const userId   = parseInt(session.user.id);
  const { id }   = await props.params;
  const presetId = parseInt(id);
  if (!Number.isInteger(presetId)) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid request' }, { status: 400 });

  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await editPresetTx(conn, userId, presetId, body);
    if (result.status === 200) await conn.commit();
    else await conn.rollback();
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    await conn.rollback();
    // The full error stays in the server log; the client gets a generic message (no DB text).
    console.error('Edit grading system failed:', err);
    return Response.json({ error: 'Could not save the grading system. Try again.' }, { status: 500 });
  } finally {
    conn.release();
  }
}

/* DELETE /api/studypulse/grading/[id]
   Ownership is locked first; a preset still assigned to any subject is refused with 409. */
export async function DELETE(
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

  const conn: PoolConnection = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [owned] = await conn.execute<RowDataPacket[]>(
      'SELECT preset_id FROM grading_presets WHERE preset_id=? AND user_id=? FOR UPDATE',
      [presetId, userId]
    );
    if (!owned.length) {
      await conn.rollback();
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const [usage] = await conn.execute<RowDataPacket[]>(
      // Locking read: no subject can be pointed at this preset between the count and the delete.
      'SELECT COUNT(*) AS n FROM subject_grading WHERE preset_id=? FOR UPDATE', [presetId]
    );
    const count = Number(usage[0]?.n ?? 0);
    if (count > 0) {
      await conn.rollback();
      return Response.json(
        { error: `This grading system is used by ${count} subject${count === 1 ? '' : 's'}`, count },
        { status: 409 }
      );
    }

    await conn.execute(
      `DELETE gc FROM grading_categories gc
       JOIN grading_periods gp ON gp.period_id = gc.period_id
       WHERE gp.preset_id=?`,
      [presetId]
    );
    await conn.execute('DELETE FROM grading_periods WHERE preset_id=?', [presetId]);
    await conn.execute('DELETE FROM grading_presets WHERE preset_id=? AND user_id=?', [presetId, userId]);

    await conn.commit();
    return Response.json({ status: 'success' });
  } catch (err) {
    await conn.rollback();
    // The full error stays in the server log; the client gets a generic message (no DB text).
    console.error('Delete grading system failed:', err);
    return Response.json({ error: 'Could not delete the grading system. Try again.' }, { status: 500 });
  } finally {
    conn.release();
  }
}
