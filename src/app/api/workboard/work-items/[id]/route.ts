import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { WORK_CATEGORIES } from '@/lib/workboard/workItems';
import { manilaNowDatetime } from '@/lib/workboard/dates';
import { checkReferences } from '@/lib/workboard/ownership';
import { LIFE_AREAS, isStageLegal, normaliseStage, type WorkContext } from '@/lib/workboard/workContexts';

// `work_status`, `work_stage` and `deadline_time` are deliberately absent: they are written
// by dedicated blocks below, so no column can ever collect two fragments in one SET clause.
const PATCHABLE = ['title', 'note', 'category', 'project_id', 'user_subject_id',
                   'organization_id', 'life_area', 'priority', 'due_at', 'start_date',
                   'estimated_hours'] as const;
const PRIORITIES = ['high', 'normal', 'low'];
const STATUSES   = ['todo', 'in_progress', 'done'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** The wire accepts "HH:MM" and "HH:MM:SS"; the TIME column should hold one shape, so the
 *  short form grows a ":00" before storage. */
function normaliseDeadlineTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const itemId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    `SELECT id, work_status AS current_status, category AS current_category
       FROM workboard_work_items WHERE id = ? AND user_id = ?`, [itemId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });
  const currentStatus = owns[0].current_status as string;
  const currentCategory = owns[0].current_category as WorkContext;

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('category' in body && !WORK_CATEGORIES.includes(body.category)) {
    return Response.json({ error: 'Invalid category' }, { status: 400 });
  }
  if ('priority' in body && !PRIORITIES.includes(body.priority)) {
    return Response.json({ error: 'Invalid priority' }, { status: 400 });
  }
  if ('work_status' in body && !STATUSES.includes(body.work_status)) {
    return Response.json({ error: 'Invalid work_status' }, { status: 400 });
  }
  if ('life_area' in body && body.life_area !== null && body.life_area !== undefined
      && !LIFE_AREAS.includes(body.life_area)) {
    return Response.json({ error: 'Invalid life_area' }, { status: 400 });
  }
  if ('deadline_time' in body && body.deadline_time !== null && body.deadline_time !== undefined
      && !TIME_PATTERN.test(body.deadline_time)) {
    return Response.json({ error: 'deadline_time must be HH:MM or HH:MM:SS' }, { status: 400 });
  }

  // A stage is legal relative to the context the row will *have* after this PATCH, not the
  // one it had before — otherwise moving an item and restaging it in one request could
  // store a stage that does not exist in its new context.
  const currentContext = ('category' in body ? body.category : currentCategory) as WorkContext;
  if ('work_stage' in body && !isStageLegal(currentContext, body.work_stage)) {
    return Response.json(
      { error: `"${body.work_stage}" is not a valid stage for ${currentContext} work` }, { status: 400 });
  }

  const refError = await checkReferences(userId, {
    projectId:      'project_id' in body ? body.project_id : undefined,
    userSubjectId:  'user_subject_id' in body ? body.user_subject_id : undefined,
    organizationId: 'organization_id' in body ? body.organization_id : undefined,
  });
  if (refError) return Response.json({ error: refError }, { status: 400 });

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const field of PATCHABLE) {
    if (field in body) { sets.push(`${field} = ?`); values.push(body[field] ?? null); }
  }
  if ('deadline_time' in body) {
    sets.push('deadline_time = ?');
    values.push(body.deadline_time ? normaliseDeadlineTime(body.deadline_time) : null);
  }

  // `work_stage` and `work_status` are always written together, from a single source, so
  // they cannot drift. When both arrive the stage wins and the body's `work_status` is
  // ignored — two fragments for one column would let MySQL silently pick the last one.
  let nextStatus: string | null = null;
  if ('work_stage' in body) {
    nextStatus = normaliseStage(body.work_stage);
    sets.push('work_stage = ?', 'work_status = ?');
    values.push(body.work_stage, nextStatus);
  } else if ('work_status' in body) {
    // v2 compatibility: the canonical stage for each normalised status is its own name,
    // and all three are legal in every context.
    nextStatus = body.work_status;
    sets.push('work_stage = ?', 'work_status = ?');
    values.push(body.work_status, body.work_status);
  }
  // Only re-stamp `completed_at` when the *normalised* status is actually *changing* — a
  // PATCH that includes `work_status: 'done'` (or the equivalent stage) merely because the
  // dialog always seeds it from the item's existing value (editing an unrelated field on an
  // already-done item, say) must not rewrite the true completion date. See Finding 1 of the
  // whole-branch review.
  if (nextStatus !== null && nextStatus !== currentStatus) {
    sets.push('completed_at = ?');
    values.push(nextStatus === 'done' ? manilaNowDatetime() : null);
  }
  if (!sets.length) return Response.json({ error: 'No fields to update' }, { status: 400 });

  await pool.execute(`UPDATE workboard_work_items SET ${sets.join(', ')} WHERE id = ?`, [...values, itemId]);
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await props.params;

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_work_items WHERE id = ? AND user_id = ?',
    [parseInt(id), parseInt(session.user.id)],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
