import { auth } from '@/auth';
import pool from '@/lib/db';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = parseInt(session.user.id);
  await pool.execute(
    `UPDATE canvas_connections
        SET status = 'disconnected', access_token_enc = NULL, token_iv = NULL, token_tag = NULL
      WHERE user_id = ?`,
    [userId],
  );

  return Response.json({ status: 'success' });
}
