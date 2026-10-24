import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

/** Ignored → pending (the Ignored tab's Restore). 409 when the item isn't ignored. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await props.params;
  const bankId = parseInt(id);
  const userId = parseInt(session.user.id);

  const [owned] = await pool.execute<RowDataPacket[]>(
    `SELECT bank.id, bank.bank_status FROM canvas_activity_bank bank
     JOIN canvas_connections conn ON conn.id = bank.connection_id
     WHERE bank.id = ? AND conn.user_id = ?`,
    [bankId, userId],
  );
  if (owned.length === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  if (owned[0].bank_status !== 'ignored') {
    return Response.json({ error: 'Only ignored items can be restored' }, { status: 409 });
  }

  await pool.execute(
    `UPDATE canvas_activity_bank SET bank_status = 'pending' WHERE id = ? AND bank_status = 'ignored'`,
    [bankId],
  );
  return Response.json({ status: 'success' });
}
