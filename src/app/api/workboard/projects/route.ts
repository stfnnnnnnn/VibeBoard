import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureWorkboardV2Schema } from '@/lib/migrate';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, color, status FROM workboard_projects
     WHERE user_id = ? ORDER BY status ASC, name ASC`,
    [parseInt(session.user.id)],
  );
  return Response.json({ projects: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();

  const { name, color } = await req.json();
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'A project name is required' }, { status: 400 });
  }

  try {
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO workboard_projects (user_id, name, color) VALUES (?, ?, ?)`,
      [parseInt(session.user.id), name.trim(), color || null],
    );
    return Response.json({ status: 'success', project_id: res.insertId });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'You already have a project with that name' }, { status: 400 });
    }
    throw err;
  }
}
