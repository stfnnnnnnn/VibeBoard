import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { WORK_CATEGORIES } from '@/lib/workboard/workItems';
import { manilaNowDatetime, normaliseDeadlineTime, TIME_PATTERN } from '@/lib/workboard/dates';
import { checkReferences } from '@/lib/workboard/ownership';
import { LIFE_AREAS, isStageLegal, normaliseStage, type WorkContext } from '@/lib/workboard/workContexts';

// `work_status`, `work_stage`, `deadline_time` and `life_area` are deliberately absent:
// each is written by a dedicated block below, so no column can ever collect two `= ?`
// fragments in one SET clause (MySQL would silently keep the last one).
const PATCHABLE = ['title', 'note', 'category', 'project_id', 'user_subject_id',
                   'organization_id', 'priority', 'due_at', 'start_date',
                   'estimated_hours'] as const;
const PRIORITIES = ['high', 'normal', 'low'];
const STATUSES   = ['todo', 'in_progress', 'done'];

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const itemId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    `SELECT id, work_status AS current_status, work_stage AS current_stage,
            category AS current_category
       FROM workboard_work_items WHERE id = ? AND user_id = ?`, [itemId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });
  const currentStatus   = owns[0].current_status as string;
  const currentStage    = (owns[0].current_stage ?? '') as string;
  const currentCategory = owns[0].current_category as WorkContext;

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  // A cleared <input> submits an empty string rather than omitting the key. Treat that as
  // "clear this field", exactly as `due_at` already does — the key is still present, so
  // the write still happens; only the value becomes NULL.
  const lifeArea     = body.life_area === '' ? null : body.life_area;
  const deadlineTime = body.deadline_time === '' ? null : body.deadline_time;

  if ('category' in body && !WORK_CATEGORIES.includes(body.category)) {
    return Response.json({ error: 'Invalid category' }, { status: 400 });
  }
  if ('priority' in body && !PRIORITIES.includes(body.priority)) {
    return Response.json({ error: 'Invalid priority' }, { status: 400 });
  }
  // Validated on the value itself, whether or not the status actually changes and whether
  // or not a `work_stage` outranks it — garbage is rejected, never silently dropped.
  if ('work_status' in body && !STATUSES.includes(body.work_status)) {
    return Response.json({ error: 'Invalid work_status' }, { status: 400 });
  }
  if ('life_area' in body && lifeArea !== null && lifeArea !== undefined
      && !LIFE_AREAS.includes(lifeArea)) {
    return Response.json({ error: 'Invalid life_area' }, { status: 400 });
  }
  if ('deadline_time' in body && deadlineTime !== null && deadlineTime !== undefined
      && !TIME_PATTERN.test(deadlineTime)) {
    return Response.json({ error: 'deadline_time must be HH:MM or HH:MM:SS' }, { status: 400 });
  }

  // A stage is legal relative to the context the row will have *after* this PATCH, not the
  // one it had before — otherwise moving an item and restaging it in one request could
  // store a stage that does not exist in its new context.
  const nextContext = ('category' in body ? body.category : currentCategory) as WorkContext;
  if ('work_stage' in body && !isStageLegal(nextContext, body.work_stage)) {
    return Response.json(
      { error: `"${body.work_stage}" is not a valid stage for ${nextContext} work` }, { status: 400 });
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
  if ('life_area' in body) { sets.push('life_area = ?'); values.push(lifeArea ?? null); }
  if ('deadline_time' in body) {
    sets.push('deadline_time = ?');
    values.push(deadlineTime ? normaliseDeadlineTime(deadlineTime) : null);
  }

  // --- work_stage / work_status: one source, one fragment per column, never divergent ---
  // Exactly one branch can run, so neither column is ever written twice in one statement.
  let nextStatus: string | null = null;
  if ('work_stage' in body) {
    // The stage decides; a `work_status` the body also sent is ignored.
    nextStatus = normaliseStage(body.work_stage);
    sets.push('work_stage = ?', 'work_status = ?');
    values.push(body.work_stage, nextStatus);
  } else if ('work_status' in body && body.work_status !== currentStatus) {
    // v2 compatibility: the canonical stage for each normalised status is its own name,
    // and all three are legal in every context. Gated on an actual *change* for the same
    // reason `completed_at` is: the v2 edit dialog resends the whole form, so an unchanged
    // `work_status` must not overwrite a finer stage (review becoming in_progress) that
    // the user set on the board. When the status has not moved, the stored stage already
    // normalises to it by this route's own invariant, so leaving both columns alone is
    // correct.
    nextStatus = body.work_status;
    sets.push('work_stage = ?', 'work_status = ?');
    values.push(body.work_status, body.work_status);
  } else if ('category' in body && !isStageLegal(nextContext, currentStage)) {
    // The context moved and the body did not restage, leaving a stage the new vocabulary
    // does not contain (a review-stage Projects item dragged to Life, which has no such
    // column). Fall back to the canonical stage for the unchanged status: legal in every
    // context, and `work_status` does not move, so `completed_at` is untouched.
    sets.push('work_stage = ?');
    values.push(currentStatus);
  }
  // Only re-stamp `completed_at` when the *normalised* status is actually *changing* — a
  // PATCH that includes `work_status: 'done'` (or the equivalent stage) merely because the
  // dialog always seeds it from the existing value (editing an unrelated field on an
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
