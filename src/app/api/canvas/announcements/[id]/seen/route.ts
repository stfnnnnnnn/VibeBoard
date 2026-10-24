import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { ensureGradingV2Schema } from '@/lib/migrate';

/** Marks an announcement as seen. Idempotent: the first time it was seen is kept. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  // seen_at is added by the grading v2 migration. Without it there is nothing to mark: answer in JSON, not an HTML 500.
  try {
    await ensureGradingV2Schema();
  } catch (err) {
    console.error('Canvas announcement seen: ensureGradingV2Schema failed:', err);
    return Response.json({ error: 'Could not mark this announcement as read' }, { status: 503 });
  }

  const { id } = await props.params;
  const announcementId = parseInt(id);
  const userId = parseInt(session.user.id);

  const [owned] = await pool.execute<RowDataPacket[]>(
    `SELECT bank.id FROM canvas_announcement_bank bank
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     WHERE bank.id = ? AND conn.user_id = ?`,
    [announcementId, userId],
  );
  if (owned.length === 0) return Response.json({ error: 'Not found' }, { status: 404 });

  await pool.execute(
    'UPDATE canvas_announcement_bank SET seen_at = COALESCE(seen_at, NOW()) WHERE id = ?',
    [announcementId],
  );
  return Response.json({ status: 'success' });
}
