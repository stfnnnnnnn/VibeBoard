import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await props.params;
  await pool.execute('DELETE FROM grade_entries WHERE entry_id=?', [parseInt(id)]);
  return Response.json({ status: 'success' });
}
