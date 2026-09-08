import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { validateProjectParent } from '@/lib/workboard/workContexts';
import { checkReferences } from '@/lib/workboard/ownership';

const PATCHABLE = ['name', 'color', 'status', 'context', 'user_subject_id', 'organization_id'] as const;

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  await ensureWorkboardV3Schema();
  const { id } = await props.params;
  const projectId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT id, context, user_subject_id, organization_id FROM workboard_projects WHERE id = ? AND user_id = ?',
    [projectId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });
  const current = owns[0];

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('status' in body && body.status !== 'active' && body.status !== 'archived') {
    return Response.json({ error: 'status must be "active" or "archived"' }, { status: 400 });
  }

  const mergedContext = 'context' in body ? body.context : current.context;
  const mergedUserSubjectId = 'user_subject_id' in body ? body.user_subject_id : current.user_subject_id;
  const mergedOrganizationId = 'organization_id' in body ? body.organization_id : current.organization_id;

  const parentError = validateProjectParent(mergedContext, mergedUserSubjectId, mergedOrganizationId);
  if (parentError) return Response.json({ error: parentError }, { status: 400 });

  const refError = await checkReferences(userId, {
    userSubjectId: mergedUserSubjectId,
    organizationId: mergedOrganizationId,
  });
  if (refError) return Response.json({ error: refError }, { status: 400 });

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const field of PATCHABLE) {
    if (field in body) { sets.push(`${field} = ?`); values.push(body[field] ?? null); }
  }
  if (!sets.length) return Response.json({ error: 'No fields to update' }, { status: 400 });

  try {
    await pool.execute(`UPDATE workboard_projects SET ${sets.join(', ')} WHERE id = ?`, [...values, projectId]);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'You already have a project with that name' }, { status: 400 });
    }
    throw err;
  }
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await props.params;

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_projects WHERE id = ? AND user_id = ?',
    [parseInt(id), parseInt(session.user.id)],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
