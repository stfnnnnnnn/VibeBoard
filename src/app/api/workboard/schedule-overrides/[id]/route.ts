import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { ensureWorkboardSchema } from '@/lib/migrate';
import { updateScheduleOverride } from '@/lib/workboard/items';
import { validateOverrideModality } from '@/lib/workboard/dates';

/** The only edit path an existing override has — `POST` always creates fresh and collides on
 *  `uniq_block_date` if one already exists for that occurrence (see that route's own comment).
 *  `block_id`/`override_date` are absent from the body on purpose: they identify WHICH
 *  occurrence this override annotates, and changing that would really be "delete this override,
 *  create a different one" rather than an edit of this one. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardSchema();
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const overrideId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    `SELECT so.id FROM schedule_overrides so
     JOIN schedule_blocks sb ON sb.block_id = so.block_id
     WHERE so.id = ? AND sb.user_id = ?`,
    [overrideId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const validated = validateOverrideModality(body);
  if ('error' in validated) return Response.json({ error: validated.error }, { status: 400 });

  await updateScheduleOverride(overrideId, {
    modality: validated.modality, note: body.note || null, room: body.room || null,
    movedDate: validated.moved_date, movedStartTime: validated.moved_start_time, movedEndTime: validated.moved_end_time,
  });
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const overrideId = parseInt(id);

  const [res] = await pool.execute<ResultSetHeader>(
    `DELETE so FROM schedule_overrides so
     JOIN schedule_blocks sb ON sb.block_id = so.block_id
     WHERE so.id = ? AND sb.user_id = ?`,
    [overrideId, userId],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
