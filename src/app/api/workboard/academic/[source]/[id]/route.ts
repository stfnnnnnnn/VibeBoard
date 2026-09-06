import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardV2Schema } from '@/lib/migrate';
import { ACADEMIC_SOURCES, type AcademicSource } from '@/lib/workboard/workItems';
import { patchAcademicItem, AcademicItemNotFoundError, type AcademicPatch } from '@/lib/workboard/academicWrites';

const STATUSES   = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['high', 'normal', 'low'];

export async function PATCH(req: NextRequest, props: { params: Promise<{ source: string; id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();

  const { source, id } = await props.params;
  if (!ACADEMIC_SOURCES.includes(source as AcademicSource)) {
    return Response.json({ error: 'Invalid source' }, { status: 400 });
  }

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('work_status' in body && !STATUSES.includes(body.work_status)) {
    return Response.json({ error: 'Invalid work_status' }, { status: 400 });
  }
  if ('priority' in body && !PRIORITIES.includes(body.priority)) {
    return Response.json({ error: 'Invalid priority' }, { status: 400 });
  }

  const patch: AcademicPatch = {};
  if ('work_status' in body)     patch.work_status     = body.work_status;
  if ('due_at' in body)          patch.due_at          = body.due_at || null;
  if ('priority' in body)        patch.priority        = body.priority;
  if ('estimated_hours' in body) patch.estimated_hours = body.estimated_hours ?? null;
  if ('start_date' in body)      patch.start_date      = body.start_date || null;

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    await patchAcademicItem(parseInt(session.user.id), source as AcademicSource, parseInt(id), patch);
    return Response.json({ status: 'success' });
  } catch (err) {
    if (err instanceof AcademicItemNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
