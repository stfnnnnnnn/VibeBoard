import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { WORK_CATEGORIES } from '@/lib/workboard/workItems';
import { manilaNowDatetime, normaliseDeadlineTime, TIME_PATTERN } from '@/lib/workboard/dates';
import { checkReferences } from '@/lib/workboard/ownership';
import {
  LIFE_AREAS, isRevisionStage, isStageLegal, isWaitingStage, normaliseStage, normaliseWaitingReason,
  validateWorkItemCategoryParent, validateWorkItemProjectConsistency,
  type WorkContext, type WorkStage,
} from '@/lib/workboard/workContexts';

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
            category AS current_category, project_id AS current_project_id,
            user_subject_id AS current_user_subject_id, organization_id AS current_organization_id
       FROM workboard_work_items WHERE id = ? AND user_id = ?`, [itemId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });
  const currentStage    = (owns[0].current_stage ?? '') as string;
  // A row saved while `submitted` still normalised to done stores work_status 'done'; it is
  // active now, so compare against the status its stage implies (keeps completed_at honest).
  const storedStatus    = owns[0].current_status as string;
  const currentStatus   = isRevisionStage(currentStage)
    ? normaliseStage(currentStage as WorkStage) : storedStatus;
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
  if ('blocked_reason' in body && body.blocked_reason !== null && typeof body.blocked_reason !== 'string') {
    return Response.json({ error: 'blocked_reason must be a string or null' }, { status: 400 });
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

  // Whole-branch review Finding I-2: `checkReferences` above only confirms each id belongs
  // to this user independently — it never checks the ids are mutually consistent. Validated
  // against the MERGED state (this field's incoming value if the body sent one, else the
  // row's current value), exactly `projects/[id]/route.ts`'s already-reviewed pattern — a
  // PATCH that only changes an unrelated field must not be rejected over a field it never
  // touched, and a PATCH that changes `category` without also supplying the now-required
  // parent field must correctly be caught.
  const mergedProjectId      = 'project_id' in body ? body.project_id : owns[0].current_project_id;
  const mergedUserSubjectId  = 'user_subject_id' in body ? body.user_subject_id : owns[0].current_user_subject_id;
  const mergedOrganizationId = 'organization_id' in body ? body.organization_id : owns[0].current_organization_id;

  const categoryParentError = validateWorkItemCategoryParent(nextContext, mergedUserSubjectId);
  if (categoryParentError) return Response.json({ error: categoryParentError }, { status: 400 });

  if (mergedProjectId != null) {
    const [projectRows] = await pool.execute<RowDataPacket[]>(
      'SELECT user_subject_id, organization_id FROM workboard_projects WHERE id = ? AND user_id = ?',
      [mergedProjectId, userId],
    );
    if (projectRows.length) {
      const consistencyError = validateWorkItemProjectConsistency(
        mergedUserSubjectId, mergedOrganizationId,
        projectRows[0].user_subject_id, projectRows[0].organization_id,
      );
      if (consistencyError) return Response.json({ error: consistencyError }, { status: 400 });
    }
  }

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
  // `nextStage` (the raw stage, not the normalised status) is tracked alongside `nextStatus`
  // purely for the blocked_reason/blocked_since block below — 'blocked' is a stage, never a
  // status, so `nextStatus` alone can't answer "is this row becoming, staying, or leaving
  // blocked?".
  let nextStatus: string | null = null;
  let nextStage: string | null = null;
  if ('work_stage' in body) {
    // The stage decides; a `work_status` the body also sent is ignored.
    nextStatus = normaliseStage(body.work_stage);
    nextStage = body.work_stage;
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
    nextStage = body.work_status;
    sets.push('work_stage = ?', 'work_status = ?');
    values.push(body.work_status, body.work_status);
  } else if ('category' in body && !isStageLegal(nextContext, currentStage)) {
    // The context moved and the body did not restage, leaving a stage the new vocabulary
    // does not contain (a review-stage Projects item dragged to Life, which has no such
    // column). Fall back to the canonical stage for the unchanged status: legal in every
    // context. `work_status` normally does not move, so `completed_at` is untouched; the one
    // exception is a legacy `submitted` row still storing 'done', repaired just below.
    nextStage = currentStatus;
    sets.push('work_stage = ?');
    values.push(currentStatus);
    if (storedStatus !== currentStatus) {
      // A legacy `submitted` row still storing 'done': repair work_status too, and let the
      // completed_at block below clear its stale date.
      nextStatus = currentStatus;
      sets.push('work_status = ?');
      values.push(currentStatus);
    }
  }

  // --- blocked_reason / blocked_since: tracks the transition `nextStage` just decided ---
  // Server-stamped, like `completed_at` — never client-supplied, so it can't be spoofed or
  // drift from clock skew. Only the reason (free text describing what it's waiting on) comes
  // from the caller.
  // "Waiting" is any of `WAITING_STAGES` (`blocked`, `submitted`): moving between two of them
  // (blocked ↔ submitted) keeps the original `blocked_since`.
  if (nextStage !== null) {
    const wasBlocked = isWaitingStage(currentStage);
    const isBlocked   = isWaitingStage(nextStage);
    const reasonValue = normaliseWaitingReason(body.blocked_reason);
    if (isBlocked && !wasBlocked) {
      sets.push('blocked_since = ?', 'blocked_reason = ?');
      values.push(manilaNowDatetime(), reasonValue);
    } else if (!isBlocked && wasBlocked) {
      // Leaving a waiting stage clears both — stale waiting info must not survive into
      // whatever stage comes next, exactly as `completed_at` is cleared the moment `done` isn't.
      sets.push('blocked_since = ?', 'blocked_reason = ?');
      values.push(null, null);
    } else if (isBlocked && wasBlocked && 'blocked_reason' in body) {
      // Staying waiting, but the caller is updating why — `blocked_since` (the original
      // wait-start) is deliberately left untouched.
      sets.push('blocked_reason = ?');
      values.push(reasonValue);
    }
  } else if ('blocked_reason' in body && isWaitingStage(currentStage)) {
    // A PATCH that edits only the reason, no stage change in the same request — not reachable
    // from any UI today, but the sparse-patch contract honours it either way.
    const reasonValue = normaliseWaitingReason(body.blocked_reason);
    sets.push('blocked_reason = ?');
    values.push(reasonValue);
  }
  // Only re-stamp `completed_at` when the *normalised* status is actually *changing* — a
  // PATCH that includes `work_status: 'done'` (or the equivalent stage) merely because the
  // dialog always seeds it from the existing value (editing an unrelated field on an
  // already-done item, say) must not rewrite the true completion date. See Finding 1 of the
  // whole-branch review. A legacy `submitted` row (stored 'done', see `currentStatus`) also
  // gets its stale completed_at rewritten on any status write.
  if (nextStatus !== null && (nextStatus !== currentStatus || storedStatus !== currentStatus)) {
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
