import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { validateProjectParent } from '@/lib/workboard/workContexts';
import { checkReferences } from '@/lib/workboard/ownership';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, color, status, context, user_subject_id, organization_id
     FROM workboard_projects WHERE user_id = ? ORDER BY status ASC, name ASC`,
    [parseInt(session.user.id)],
  );
  return Response.json({ projects: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  await ensureWorkboardV3Schema();

  const body = await req.json();
  const { name, color } = body;
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'A project name is required' }, { status: 400 });
  }

  const context = body.context ?? 'project';
  const userSubjectId = body.user_subject_id ?? null;
  const organizationId = body.organization_id ?? null;

  const parentError = validateProjectParent(context, userSubjectId, organizationId);
  if (parentError) return Response.json({ error: parentError }, { status: 400 });

  const refError = await checkReferences(userId, {
    userSubjectId,
    organizationId,
  });
  if (refError) return Response.json({ error: refError }, { status: 400 });

  try {
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO workboard_projects (user_id, name, color, context, user_subject_id, organization_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, name.trim(), color || null, context, userSubjectId, organizationId],
    );
    return Response.json({ status: 'success', project_id: res.insertId });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'You already have a project with that name' }, { status: 400 });
    }
    throw err;
  }
}
