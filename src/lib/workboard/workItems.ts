import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';
import { addDays, dueDateOf } from '@/lib/workboard/dates';
import type { WorkCategory } from '@/lib/workboard/workCategories';
import type { WorkContext, WorkStage, LifeArea } from '@/lib/workboard/workContexts';
import { isRevisionStage, isStageLegal, isWaitingStage, normaliseStage } from '@/lib/workboard/workContexts';
import type { OrganizationSummary } from '@/lib/workboard/organizations';
import { listOrganizations } from '@/lib/workboard/organizations';
import { ensureEntryNoteSchema } from '@/lib/migrate';

export type WorkStatus   = 'todo' | 'in_progress' | 'done';
export type WorkPriority = 'high' | 'normal' | 'low';
export type WorkSource   = 'owned' | 'activities' | 'quizzes' | 'exams' | 'grade_entries';

export const ACADEMIC_SOURCES = ['activities', 'quizzes', 'exams', 'grade_entries'] as const;
export type AcademicSource = typeof ACADEMIC_SOURCES[number];

/** Re-exported from `./workCategories` (the pool-free module) so existing importers of
 *  `WorkCategory`/`WORK_CATEGORIES` from this file keep working — see that file for why the
 *  implementation lives there and not here (client-bundle safety). */
export { WORK_CATEGORIES, type WorkCategory } from '@/lib/workboard/workCategories';

export interface WorkItem {
  source:           WorkSource;   // 'owned' = workboard_work_items; else the Study Pulse table
  id:               number;       // primary key within that source
  title:            string;
  /** @deprecated Use `context`. Retained for one release. */
  category:         WorkCategory;
  /** Domain term for the DB's `category` column. */
  context:          WorkContext;
  /** Project name when project_id is set, else organization name, else course code when
   *  user_subject_id is set, else null. Earlier entries in that chain win if several are set. */
  chip_label:       string | null;
  /** First-class project name, independent of `chip_label`'s collapsed chain — the
   *  Academic table needs Course and Project as two separate columns. Populated for owned
   *  rows of any context, so an owned academic item can carry both this and `course_code`;
   *  null when the row has no linked project, which is always the case for rows read live
   *  from Study Pulse. */
  project_name:     string | null;
  /** First-class course code, independent of `chip_label`. */
  course_code:      string | null;
  project_id:       number | null;
  user_subject_id:  number | null;
  priority:         WorkPriority;
  work_status:      WorkStatus;
  /** Per-context stage. `work_status` remains its normalised value. */
  work_stage:       WorkStage;
  /** "YYYY-MM-DD HH:MM:SS" for owned items, "YYYY-MM-DD" for academic ones (Study Pulse's
   *  deadline columns are DATE). Always slice(0,10) to compare dates — never parse as a Date. */
  due_at:           string | null;
  /** "HH:MM:SS" or null. The date lives in `due_at`; an absent time renders as an em dash. */
  deadline_time:    string | null;
  start_date:       string | null;
  estimated_hours:  number | null;
  completed_at:     string | null;
  note:             string | null;
  life_area:        LifeArea | null;
  organization_id:  number | null;
  organization_name: string | null;
  /** The parent context of the linked project, when there is one — lets the Table view
   *  label the column "Project" vs "Initiative" without a second query. */
  project_context:  WorkContext | null;
  link_count:       number;
  subtask_total:    number;
  subtask_done:     number;
  /** Set only while the item is in a waiting stage (`WAITING_STAGES`: Project/Organization's
   *  `blocked`, Academic's `submitted` — whose reason is the revision note); never populated
   *  for Life rows, and cleared together the moment the item leaves a waiting stage.
   *  §18's "Waiting" content: what it's waiting on, and since when — Focus's own Waiting
   *  section reads both straight off the item, no join. */
  blocked_reason:   string | null;
  /** "YYYY-MM-DD HH:MM:SS", Manila wall-clock — stamped server-side the instant the item
   *  enters a waiting stage, exactly like `completed_at` is for `done`. Never
   *  client-supplied, so it can't be spoofed or drift from actual clock skew. */
  blocked_since:    string | null;
}

export interface ProjectSummary {
  id:      number;
  name:    string;
  color:   string | null;
  status:  'active' | 'archived';
  /** The three dialog branches that let a user attach a project (Academic, Organization,
   *  Projects) each list only projects whose own context matches and whose parent matches
   *  the chosen course/organization — a course's project list must not show another
   *  course's projects. `context` and the two parent ids are what makes that filter
   *  possible client-side without a second request per keystroke. */
  context:         WorkContext;
  user_subject_id: number | null;
  organization_id: number | null;
}

export interface WorkItemsPayload {
  items:         WorkItem[];
  projects:      ProjectSummary[];
  organizations: OrganizationSummary[];
  generated_at:  string;   // "YYYY-MM-DD" — today's Manila date, so clients group without re-deriving it
}

/** Study Pulse stores urgency as 'High' | 'Medium' | 'Low'; Workboard uses high/normal/low.
 *  Anything unrecognised (including null) reads as 'normal' rather than throwing — a bad
 *  urgency value in legacy data must not break the whole work list. */
export function priorityFromUrgency(urgency: string | null | undefined): WorkPriority {
  switch ((urgency ?? '').toLowerCase()) {
    case 'high': return 'high';
    case 'low':  return 'low';
    default:     return 'normal';
  }
}

export function urgencyFromPriority(priority: WorkPriority): 'High' | 'Medium' | 'Low' {
  if (priority === 'high') return 'High';
  if (priority === 'low')  return 'Low';
  return 'Medium';
}

/**
 * The load-bearing rule of this whole feature. Study Pulse's `status` column is the single
 * source of truth for done-ness, so it is checked FIRST: if a student marks something In
 * Progress here and later marks it Done in Study Pulse, the stale overlay flag must never
 * mask the real answer.
 */
export function deriveAcademicStatus(
  entryStatus: string | null | undefined,
  inProgress: number | boolean | null | undefined,
): WorkStatus {
  if (entryStatus === 'Done') return 'done';
  if (inProgress) return 'in_progress';
  return 'todo';
}

/**
 * The stage-level companion to `deriveAcademicStatus`. Study Pulse's `'Done'` is still
 * checked FIRST — a stale overlay stage can never mask a genuinely completed item — with
 * one exception: an overlay `submitted` ("For Revision") wins over an entry that was
 * already Done when it was sent back (a graded entry's trigger pins it Done; see
 * `patchAcademicItem`). An entry completed at or after `blocked_since` reads `done`.
 *
 * `inProgress` is the legacy `workboard_entry_meta.in_progress` flag, used only as a
 * fallback when no legal `work_stage` is present. As of Task 10 the PATCH route
 * (`patchAcademicItem`) writes both columns together, so rows it touches always carry a
 * stage and never reach this fallback; it exists for rows written *before* that release,
 * when the route wrote only `in_progress`. Without it such a row — marked in-progress
 * through the old path — would fall all the way through to `'todo'` here while
 * `deriveAcademicStatus` (below) correctly reports `'in_progress'`, breaking the
 * stage/status invariant. `work_stage` still outranks the flag whenever it is present and
 * legal (e.g. `'ready_to_submit'`, which the write path deliberately stores alongside
 * `in_progress = 0`, is not clobbered back to `'todo'`).
 */
export function deriveAcademicStage(
  entryStatus: string | null | undefined,
  metaStage: string | null | undefined,
  inProgress?: number | boolean | null,
  accomplishedAt?: string | null,
  blockedSince?: string | null,
): WorkStage {
  if (entryStatus === 'Done') {
    if (metaStage !== 'submitted') return 'done';
    // Sent back, then completed in Study Pulse: an entry Done at or after the overlay's
    // `blocked_since` was finished after the revision request, so Study Pulse wins. Done
    // earlier (e.g. graded before being sent back) keeps For Revision. `accomplished_at` is
    // a DATE, compared as midnight against the DATETIME; either one null keeps the overlay.
    if (accomplishedAt && blockedSince
        && `${String(accomplishedAt).slice(0, 10)} 00:00:00` >= String(blockedSince).slice(0, 19)) {
      return 'done';
    }
    return 'submitted';
  }
  if (metaStage && isStageLegal('academic', metaStage)) return metaStage;
  return inProgress ? 'in_progress' : 'todo';
}

/** Re-exported from `@/lib/workboard/dates` (the pool-free module) so existing callers of
 *  `dueDateOf` from this file keep working — see `dates.ts` for why the implementation
 *  lives there and not here. */
export { dueDateOf };

interface AcademicTableSpec {
  source:   AcademicSource;
  table:    string;
  pk:       string;
  nameCol:  string;
  metaCol:  'activity_id' | 'quiz_id' | 'exam_id' | 'grade_entry_id';
  /** `activities`/`quizzes`/`exams` each carry a `BEFORE UPDATE` trigger that forces
   *  `status = 'Done'` the moment `score`/`items`/`grade` are all non-null, regardless of what
   *  the UPDATE's own SET clause asked for — confirmed live via `information_schema.TRIGGERS`.
   *  `grade_entries` has the identical `score`/`items`/`grade`/`status`/`accomplished_at`
   *  columns but NO such trigger (same query, zero rows) — editing a graded `grade_entries` row
   *  is genuinely safe. `patchAcademicItem` gates its graded-row guard on this flag so it
   *  protects exactly the three tables that need it and never blocks the one that doesn't. */
  hasGradedTrigger: boolean;
}

/** The four Study Pulse entry tables, their primary keys, their title columns, and the
 *  overlay column that points back at them. Every academic query in Workboard v2 walks
 *  this list rather than hardcoding table names at call sites. */
export const ACADEMIC_TABLES: AcademicTableSpec[] = [
  { source: 'activities',    table: 'activities',    pk: 'activity_id', nameCol: 'activity_name', metaCol: 'activity_id',     hasGradedTrigger: true },
  { source: 'quizzes',       table: 'quizzes',       pk: 'quiz_id',     nameCol: 'quiz_name',     metaCol: 'quiz_id',        hasGradedTrigger: true },
  { source: 'exams',         table: 'exams',         pk: 'exam_id',     nameCol: 'exam_name',     metaCol: 'exam_id',        hasGradedTrigger: true },
  { source: 'grade_entries', table: 'grade_entries', pk: 'entry_id',    nameCol: 'name',          metaCol: 'grade_entry_id', hasGradedTrigger: false },
];

export async function getWorkItems(userId: number): Promise<WorkItemsPayload> {
  const today  = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(todayInManilaAsUtcDate());
  const cutoff = addDays(today, -14);   // done items older than this are out of the payload
  // The academic SELECT below reads the overlay's `note` (spec 2026-10-24 §6.1). Ensured here,
  // not at each call site, so every reader of this payload gets the column (Ruling R2).
  await ensureEntryNoteSchema();

  const [projectRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, color, status, context, user_subject_id, organization_id
     FROM workboard_projects WHERE user_id = ? ORDER BY status ASC, name ASC`,
    [userId],
  );
  const projects: ProjectSummary[] = projectRows.map(r => ({
    id: r.id, name: r.name, color: r.color, status: r.status,
    context: r.context, user_subject_id: r.user_subject_id, organization_id: r.organization_id,
  }));

  const [ownedRows] = await pool.execute<RowDataPacket[]>(
    `SELECT wi.id, wi.category, wi.project_id, wi.user_subject_id, wi.title, wi.note,
            wi.priority, wi.work_status, wi.work_stage, wi.due_at, wi.deadline_time,
            wi.start_date, wi.estimated_hours, wi.completed_at,
            wi.life_area, wi.organization_id, wi.blocked_reason, wi.blocked_since,
            p.name AS project_name, p.context AS project_context,
            o.name AS organization_name,
            s.course_code,
            (SELECT COUNT(*) FROM workboard_item_links l WHERE l.work_item_id = wi.id) AS link_count,
            (SELECT COUNT(*) FROM workboard_subtasks t WHERE t.work_item_id = wi.id) AS subtask_total,
            (SELECT COUNT(*) FROM workboard_subtasks t WHERE t.work_item_id = wi.id AND t.is_done = 1) AS subtask_done
     FROM workboard_work_items wi
     LEFT JOIN workboard_projects p ON p.id = wi.project_id
     LEFT JOIN workboard_organizations o ON o.id = wi.organization_id
     LEFT JOIN user_subjects us ON us.user_subject_id = wi.user_subject_id
     LEFT JOIN subjects s ON s.subject_id = us.subject_id
     WHERE wi.user_id = ?
       AND (wi.work_status != 'done' OR wi.work_stage = 'submitted' OR DATE(wi.completed_at) >= ?)`,
    [userId, cutoff],
  );

  const items: WorkItem[] = ownedRows.map(r => {
    // Defensive fallback: rows created by a write path that hasn't yet been migrated to set
    // work_stage (pre-v3 POST/PATCH routes) leave the column NULL. Falling back to work_status
    // keeps the normaliseStage(work_stage) === work_status invariant true for every row.
    const stage = (r.work_stage ?? r.work_status) as WorkStage;
    // Rows saved while `submitted` still normalised to done carry work_status 'done' and a
    // completed_at; read them as the active state they now are.
    const revision = isRevisionStage(stage);
    return {
      source:          'owned' as const,
      id:              r.id,
      title:           r.title,
      category:        r.category,
      context:         r.category,
      chip_label:      r.project_name ?? r.organization_name ?? r.course_code ?? null,
      project_name:    r.project_name ?? null,
      course_code:     r.course_code ?? null,
      project_id:      r.project_id,
      user_subject_id: r.user_subject_id,
      priority:        r.priority,
      work_status:     revision ? normaliseStage(stage) : r.work_status,
      work_stage:      stage,
      due_at:          r.due_at,
      deadline_time:   r.deadline_time,
      start_date:      r.start_date ? String(r.start_date).slice(0, 10) : null,
      estimated_hours: r.estimated_hours === null ? null : Number(r.estimated_hours),
      completed_at:    revision ? null : r.completed_at,
      note:            r.note,
      life_area:       r.life_area,
      organization_id: r.organization_id,
      organization_name: r.organization_name,
      project_context: r.project_context ?? null,
      link_count:      Number(r.link_count),
      subtask_total:   Number(r.subtask_total),
      subtask_done:    Number(r.subtask_done),
      blocked_reason:  r.blocked_reason,
      blocked_since:   r.blocked_since,
    };
  });

  for (const spec of ACADEMIC_TABLES) {
    // The cutoff's For Revision bypass holds only while the overlay `submitted` still wins over
    // a Done entry: exactly `deriveAcademicStage`'s rule, the DATE `accomplished_at` read as
    // midnight against the DATETIME `blocked_since`.
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT t.\`${spec.pk}\` AS entry_id, t.\`${spec.nameCol}\` AS title, t.user_subject_id,
              t.urgency, t.status, t.deadline, t.accomplished_at,
              s.course_code,
              m.in_progress, m.estimated_hours, m.start_date, m.deadline_time, m.work_stage,
              m.blocked_reason, m.blocked_since, m.note,
              (SELECT COUNT(*) FROM workboard_item_links l WHERE l.\`${spec.metaCol}\` = t.\`${spec.pk}\`) AS link_count,
              (SELECT COUNT(*) FROM workboard_subtasks st WHERE st.\`${spec.metaCol}\` = t.\`${spec.pk}\`) AS subtask_total,
              (SELECT COUNT(*) FROM workboard_subtasks st WHERE st.\`${spec.metaCol}\` = t.\`${spec.pk}\` AND st.is_done = 1) AS subtask_done
       FROM \`${spec.table}\` t
       JOIN user_subjects us ON us.user_subject_id = t.user_subject_id
       JOIN subjects s ON s.subject_id = us.subject_id
       LEFT JOIN workboard_entry_meta m ON m.\`${spec.metaCol}\` = t.\`${spec.pk}\`
       WHERE us.user_id = ?
         AND (t.status != 'Done' OR t.accomplished_at >= ?
              OR (m.work_stage = 'submitted' AND (m.blocked_since IS NULL OR t.accomplished_at IS NULL
                  OR CAST(t.accomplished_at AS DATETIME) < m.blocked_since)))`,
      [userId, cutoff],
    );

    for (const r of rows) {
      // Derive the stage first, then derive work_status FROM the stage (rather than
      // separately from deriveAcademicStatus) so normaliseStage(work_stage) === work_status
      // holds by construction for every row, regardless of which write path (v2's
      // in_progress-only PATCH, or a later task's work_stage-aware one) produced it.
      const stage = deriveAcademicStage(
        r.status, r.work_stage, r.in_progress, r.accomplished_at, r.blocked_since,
      );
      items.push({
        source:          spec.source,
        id:              r.entry_id,
        title:           r.title,
        category:        'academic',
        context:         'academic',
        chip_label:      r.course_code ?? null,
        project_name:    null,
        course_code:     r.course_code ?? null,
        project_id:      null,
        user_subject_id: r.user_subject_id,
        priority:        priorityFromUrgency(r.urgency),
        work_status:     normaliseStage(stage),
        work_stage:      stage,
        due_at:          r.deadline ? String(r.deadline).slice(0, 10) : null,
        deadline_time:   r.deadline_time,
        start_date:      r.start_date ? String(r.start_date).slice(0, 10) : null,
        estimated_hours: r.estimated_hours === null || r.estimated_hours === undefined
                           ? null : Number(r.estimated_hours),
        // Only a done stage has a completion date: a For Revision row on a Done (graded)
        // entry must not read as completed.
        completed_at:    normaliseStage(stage) === 'done' && r.accomplished_at
                           ? String(r.accomplished_at).slice(0, 10) : null,
        // School-task notes live on the overlay; Study Pulse shows them read-only (spec §6.1).
        note:            r.note ?? null,
        life_area:       null,
        organization_id: null,
        organization_name: null,
        project_context: null,
        link_count:      Number(r.link_count),
        subtask_total:   Number(r.subtask_total),
        subtask_done:    Number(r.subtask_done),
        // Academic's waiting stage is `submitted` ("For Revision"). Gated on the derived stage
        // so a stale overlay pair never surfaces on a row that no longer reads as waiting.
        blocked_reason:  isWaitingStage(stage) ? r.blocked_reason ?? null : null,
        blocked_since:   isWaitingStage(stage) ? r.blocked_since ?? null : null,
      });
    }
  }

  const organizations = await listOrganizations(userId);

  return { items, projects, organizations, generated_at: today };
}
