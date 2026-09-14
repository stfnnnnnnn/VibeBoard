import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { ensureWorkboardSchema } from '@/lib/migrate';
import { insertScheduleOverride } from '@/lib/workboard/items';
import { validateOverrideModality } from '@/lib/workboard/dates';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardSchema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  const { block_id, override_date, note } = body;

  if (!block_id || !override_date || !/^\d{4}-\d{2}-\d{2}$/.test(override_date)) {
    return Response.json({ error: 'block_id and override_date (YYYY-MM-DD) are required' }, { status: 400 });
  }
  const validated = validateOverrideModality(body);
  if ('error' in validated) return Response.json({ error: validated.error }, { status: 400 });

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT block_id FROM schedule_blocks WHERE block_id = ? AND user_id = ?', [block_id, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  try {
    const { overrideId } = await insertScheduleOverride({
      blockId: block_id, overrideDate: override_date, note: note || null,
      modality: validated.modality, movedDate: validated.moved_date,
      movedStartTime: validated.moved_start_time, movedEndTime: validated.moved_end_time,
      sourceType: 'manual', sourceAnnouncementId: null,
    });
    return Response.json({ status: 'success', override_id: overrideId });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'This class already has an override for that date' }, { status: 400 });
    }
    throw err;
  }
}
