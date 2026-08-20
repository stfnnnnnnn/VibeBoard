import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureCanvasSchema } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';
import CanvasClientShell from './CanvasClientShell';

export default async function CanvasPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  await ensureCanvasSchema();
  const userId = parseInt(session.user.id);

  const [connRows] = await pool.execute<RowDataPacket[]>(
    `SELECT canvas_user_name, status, last_sync_at, last_sync_status FROM canvas_connections WHERE user_id = ? AND status IN ('active', 'invalid')`,
    [userId],
  );

  const [subjectRows] = await pool.execute<RowDataPacket[]>(
    `SELECT us.user_subject_id, s.subject_name FROM user_subjects us
     JOIN subjects s ON s.subject_id = us.subject_id WHERE us.user_id = ?`,
    [userId],
  );

  return (
    <CanvasClientShell
      initialConnection={connRows[0] ? {
        connected: true,
        canvas_user_name: connRows[0].canvas_user_name as string,
        status: connRows[0].status as 'active' | 'invalid' | 'disconnected',
        last_sync_at: connRows[0].last_sync_at as string | null,
        last_sync_status: connRows[0].last_sync_status as 'success' | 'partial' | 'failed' | null,
      } : { connected: false }}
      existingSubjects={subjectRows.map(r => ({
        user_subject_id: r.user_subject_id as number,
        subject_name: r.subject_name as string,
      }))}
    />
  );
}
