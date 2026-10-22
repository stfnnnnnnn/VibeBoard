import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { ensureWorkboardV2Schema, ensureWorkboardV3Schema } from '@/lib/migrate';
import { WORK_CATEGORIES } from '@/lib/workboard/workItems';
import { manilaNowDatetime, normaliseDeadlineTime, TIME_PATTERN } from '@/lib/workboard/dates';
import { checkReferences } from '@/lib/workboard/ownership';
import {
  LIFE_AREAS, isStageLegal, isWaitingStage, normaliseStage,
  validateWorkItemCategoryParent, validateWorkItemProjectConsistency,
  type WorkContext,
} from '@/lib/workboard/workContexts';

const PRIORITIES = ['high', 'normal', 'low'];
const STATUSES   = ['todo', 'in_progress', 'done'];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV2Schema();
  await ensureWorkboardV3Schema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const { category, title, note, project_id, user_subject_id, organization_id,
          priority, work_status, work_stage, due_at, start_date, estimated_hours } = body;
  // A cleared <input> submits '' rather than omitting the key. Treat that as "no value",
  // exactly as `due_at`'s `|| null` already does, so clearing a field is not a 400.
  const life_area     = body.life_area === '' ? null : body.life_area;
  const deadline_time = body.deadline_time === '' ? null : body.deadline_time;

  if (!WORK_CATEGORIES.includes(category)) {
    return Response.json({ error: 'category must be academic, project, organization, or life' }, { status: 400 });
  }
  if (typeof title !== 'string' || !title.trim()) {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    return Response.json({ error: 'priority must be high, normal, or low' }, { status: 400 });
  }
  if (work_status !== undefined && !STATUSES.includes(work_status)) {
    return Response.json({ error: 'work_status must be todo, in_progress, or done' }, { status: 400 });
  }
  if (life_area !== undefined && life_area !== null && !LIFE_AREAS.includes(life_area)) {
    return Response.json({ error: 'Invalid life_area' }, { status: 400 });
  }
  if (deadline_time !== undefined && deadline_time !== null && !TIME_PATTERN.test(deadline_time)) {
    return Response.json({ error: 'deadline_time must be HH:MM or HH:MM:SS' }, { status: 400 });
  }

  // `work_stage` outranks `work_status`: when both arrive the stage decides, so the two
  // columns can never be handed conflicting values. A v2 client that only knows
  // `work_status` still works — 'todo'/'in_progress'/'done' are legal stages everywhere.
  const stage = work_stage ?? work_status ?? 'todo';
  if (!isStageLegal(category as WorkContext, stage)) {
    return Response.json({ error: `"${stage}" is not a valid stage for ${category} work` }, { status: 400 });
  }
  const status = normaliseStage(stage);

  const refError = await checkReferences(userId, {
    projectId: project_id, userSubjectId: user_subject_id, organizationId: organization_id,
  });
  if (refError) return Response.json({ error: refError }, { status: 400 });

  // Whole-branch review Finding I-2: `checkReferences` above only confirms each id belongs
  // to this user independently — it never checks the ids are mutually consistent. Gap 1: an
  // academic item with no course, previously enforced only by the dialog.
  const categoryParentError = validateWorkItemCategoryParent(category, user_subject_id);
  if (categoryParentError) return Response.json({ error: categoryParentError }, { status: 400 });

  // Gap 2: a project's own organization/course must agree with what the item independently
  // claims, when the item sets one — e.g. organization_id=5 beside a project scoped to
  // organization 7. Only queried when project_id is actually present; skipped otherwise.
  if (project_id != null) {
    const [projectRows] = await pool.execute<RowDataPacket[]>(
      'SELECT user_subject_id, organization_id FROM workboard_projects WHERE id = ? AND user_id = ?',
      [project_id, userId],
    );
    if (projectRows.length) {
      const consistencyError = validateWorkItemProjectConsistency(
        user_subject_id, organization_id,
        projectRows[0].user_subject_id, projectRows[0].organization_id,
      );
      if (consistencyError) return Response.json({ error: consistencyError }, { status: 400 });
    }
  }

  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO workboard_work_items
       (user_id, category, project_id, user_subject_id, organization_id, life_area,
        title, note, priority, work_status, work_stage,
        due_at, deadline_time, start_date, estimated_hours, completed_at, blocked_since)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [userId, category, project_id ?? null, user_subject_id ?? null, organization_id ?? null,
     life_area ?? null, title.trim(), note || null, priority ?? 'normal', status, stage,
     due_at || null, deadline_time ? normaliseDeadlineTime(deadline_time) : null,
     start_date || null, estimated_hours ?? null, status === 'done' ? manilaNowDatetime() : null,
     // Created straight into a waiting stage: stamp the wait-start, as the PATCH route does.
     isWaitingStage(stage) ? manilaNowDatetime() : null],
  );

  return Response.json({ status: 'success', item_id: res.insertId });
}
