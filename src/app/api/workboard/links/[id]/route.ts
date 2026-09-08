import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { isValidUrl, LINK_TYPES } from '@/lib/workboard/links';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const linkId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM workboard_item_links WHERE id = ? AND user_id = ?', [linkId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('label' in body && (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 120)) {
    return Response.json({ error: 'A label between 1 and 120 characters is required' }, { status: 400 });
  }
  if ('url' in body && !isValidUrl(body.url)) {
    return Response.json({ error: 'A valid http or https URL is required' }, { status: 400 });
  }
  if ('link_type' in body && !LINK_TYPES.includes(body.link_type)) {
    return Response.json({ error: 'Invalid link_type' }, { status: 400 });
  }
  if ('position' in body && !(Number.isInteger(body.position) && body.position >= 0)) {
    return Response.json({ error: 'position must be a non-negative integer' }, { status: 400 });
  }

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const field of ['label', 'url', 'link_type', 'position'] as const) {
    if (field in body) { sets.push(`${field} = ?`); values.push(body[field]); }
  }
  if (!sets.length) return Response.json({ error: 'No fields to update' }, { status: 400 });

  await pool.execute(`UPDATE workboard_item_links SET ${sets.join(', ')} WHERE id = ?`, [...values, linkId]);
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await props.params;

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_item_links WHERE id = ? AND user_id = ?',
    [parseInt(id), parseInt(session.user.id)],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
