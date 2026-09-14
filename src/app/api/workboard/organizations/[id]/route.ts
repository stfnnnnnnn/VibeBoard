import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const PATCHABLE = ['name', 'status'] as const;

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const orgId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM workboard_organizations WHERE id = ? AND user_id = ?', [orgId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('name' in body && (typeof body.name !== 'string' || !body.name.trim())) {
    return Response.json({ error: 'An organization name is required' }, { status: 400 });
  }
  if ('status' in body && body.status !== 'active' && body.status !== 'archived') {
    return Response.json({ error: 'status must be "active" or "archived"' }, { status: 400 });
  }

  const sets: string[] = [];
  const values: (string | null)[] = [];
  for (const field of PATCHABLE) {
    if (field in body) { sets.push(`${field} = ?`); values.push(body[field] ?? null); }
  }
  if (!sets.length) return Response.json({ error: 'No fields to update' }, { status: 400 });

  try {
    await pool.execute(`UPDATE workboard_organizations SET ${sets.join(', ')} WHERE id = ?`, [...values, orgId]);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'You already have an organization with that name' }, { status: 400 });
    }
    throw err;
  }
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const orgId = parseInt(id);

  // `fk_project_org` is ON DELETE CASCADE, so an unguarded delete here silently destroys every
  // project scoped to this organization, and each of THOSE projects' own work items then has
  // `project_id` set to NULL by a second cascade (`workboard_work_items_ibfk_2`) — quietly
  // reproducing the exact "Context = Projects with no project" shape Task 29 made unproducible
  // through the dialog, for an arbitrary number of rows, with no explanation to the user whose
  // item just lost its project. Refuse rather than let the FK graph do this implicitly; the user
  // can reassign or delete the dependent projects first, the same way the dialog already forces
  // them to pick a project rather than leaving one behind.
  const [dependents] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM workboard_projects WHERE organization_id = ? AND user_id = ?',
    [orgId, userId],
  );
  if ((dependents[0].n as number) > 0) {
    return Response.json(
      { error: 'This organization still has projects. Reassign or delete them first.' },
      { status: 409 },
    );
  }

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_organizations WHERE id = ? AND user_id = ?',
    [orgId, userId],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
