import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardV2Schema, ensureWorkboardV3Schema } from '@/lib/migrate';
import { ACADEMIC_SOURCES, type AcademicSource } from '@/lib/workboard/workItems';
import { patchAcademicItem, AcademicItemNotFoundError, type AcademicPatch } from '@/lib/workboard/academicWrites';
import { isStageLegal } from '@/lib/workboard/workContexts';
import { TIME_PATTERN } from '@/lib/workboard/dates';

const STATUSES   = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['high', 'normal', 'low'];

export async function PATCH(req: NextRequest, props: { params: Promise<{ source: string; id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  // V2 creates `workboard_entry_meta`; V3 adds the `work_stage` and `deadline_time`
  // columns this route now writes, so both must have run before the patch executes.
  await ensureWorkboardV2Schema();
  await ensureWorkboardV3Schema();

  const { source, id } = await props.params;
  if (!ACADEMIC_SOURCES.includes(source as AcademicSource)) {
    return Response.json({ error: 'Invalid source' }, { status: 400 });
  }

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  // A cleared <input type="time"> submits an empty string rather than omitting the key.
  // Treat that as "clear this field", exactly as the work-item routes do — the key stays
  // present so the write still happens; only the value becomes NULL.
  const deadlineTime = body.deadline_time === '' ? null : body.deadline_time;

  if ('work_status' in body && !STATUSES.includes(body.work_status)) {
    return Response.json({ error: 'Invalid work_status' }, { status: 400 });
  }
  if ('priority' in body && !PRIORITIES.includes(body.priority)) {
    return Response.json({ error: 'Invalid priority' }, { status: 400 });
  }
  // Academic items live in the 'academic' context by construction, so the stage
  // vocabulary is fixed — no per-row category lookup is needed here.
  if ('work_stage' in body && !isStageLegal('academic', body.work_stage)) {
    return Response.json(
      { error: `"${body.work_stage}" is not a valid stage for academic work` }, { status: 400 });
  }
  if ('deadline_time' in body && deadlineTime !== null && deadlineTime !== undefined
      && !TIME_PATTERN.test(deadlineTime)) {
    return Response.json({ error: 'deadline_time must be HH:MM or HH:MM:SS' }, { status: 400 });
  }

  const patch: AcademicPatch = {};
  if ('work_status' in body)     patch.work_status     = body.work_status;
  if ('work_stage' in body)      patch.work_stage      = body.work_stage;
  if ('due_at' in body)          patch.due_at          = body.due_at || null;
  if ('deadline_time' in body)   patch.deadline_time   = deadlineTime ?? null;
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
