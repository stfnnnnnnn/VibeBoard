import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { todayInManilaAsUtcDate } from '@/lib/workboard/aggregate';
import { addDays, dueDateOf } from '@/lib/workboard/dates';
import type { WorkCategory } from '@/lib/workboard/workCategories';

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
  category:         WorkCategory;
  /** Project name when project_id is set, else course code when user_subject_id is set,
   *  else null. Project wins if both are somehow set. */
  chip_label:       string | null;
  project_id:       number | null;
  user_subject_id:  number | null;
  priority:         WorkPriority;
  work_status:      WorkStatus;
  /** "YYYY-MM-DD HH:MM:SS" for owned items, "YYYY-MM-DD" for academic ones (Study Pulse's
   *  deadline columns are DATE). Always slice(0,10) to compare dates — never parse as a Date. */
  due_at:           string | null;
  start_date:       string | null;
  estimated_hours:  number | null;
  completed_at:     string | null;
  note:             string | null;
}

export interface ProjectSummary {
  id:      number;
  name:    string;
  color:   string | null;
  status:  'active' | 'archived';
}

export interface WorkItemsPayload {
  items:         WorkItem[];
  projects:      ProjectSummary[];
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
}

/** The four Study Pulse entry tables, their primary keys, their title columns, and the
 *  overlay column that points back at them. Every academic query in Workboard v2 walks
 *  this list rather than hardcoding table names at call sites. */
export const ACADEMIC_TABLES: AcademicTableSpec[] = [
  { source: 'activities',    table: 'activities',    pk: 'activity_id', nameCol: 'activity_name', metaCol: 'activity_id' },
  { source: 'quizzes',       table: 'quizzes',       pk: 'quiz_id',     nameCol: 'quiz_name',     metaCol: 'quiz_id' },
  { source: 'exams',         table: 'exams',         pk: 'exam_id',     nameCol: 'exam_name',     metaCol: 'exam_id' },
  { source: 'grade_entries', table: 'grade_entries', pk: 'entry_id',    nameCol: 'name',          metaCol: 'grade_entry_id' },
];

export async function getWorkItems(userId: number): Promise<WorkItemsPayload> {
  const today  = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(todayInManilaAsUtcDate());
  const cutoff = addDays(today, -14);   // done items older than this are out of the payload

  const [projectRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, color, status FROM workboard_projects
     WHERE user_id = ? ORDER BY status ASC, name ASC`,
    [userId],
  );
  const projects: ProjectSummary[] = projectRows.map(r => ({
    id: r.id, name: r.name, color: r.color, status: r.status,
  }));

  const [ownedRows] = await pool.execute<RowDataPacket[]>(
    `SELECT wi.id, wi.category, wi.project_id, wi.user_subject_id, wi.title, wi.note,
            wi.priority, wi.work_status, wi.due_at, wi.start_date, wi.estimated_hours,
            wi.completed_at, p.name AS project_name, s.course_code
     FROM workboard_work_items wi
     LEFT JOIN workboard_projects p ON p.id = wi.project_id
     LEFT JOIN user_subjects us ON us.user_subject_id = wi.user_subject_id
     LEFT JOIN subjects s ON s.subject_id = us.subject_id
     WHERE wi.user_id = ?
       AND (wi.work_status != 'done' OR DATE(wi.completed_at) >= ?)`,
    [userId, cutoff],
  );

  const items: WorkItem[] = ownedRows.map(r => ({
    source:          'owned' as const,
    id:              r.id,
    title:           r.title,
    category:        r.category,
    chip_label:      r.project_name ?? r.course_code ?? null,
    project_id:      r.project_id,
    user_subject_id: r.user_subject_id,
    priority:        r.priority,
    work_status:     r.work_status,
    due_at:          r.due_at,
    start_date:      r.start_date ? String(r.start_date).slice(0, 10) : null,
    estimated_hours: r.estimated_hours === null ? null : Number(r.estimated_hours),
    completed_at:    r.completed_at,
    note:            r.note,
  }));

  for (const spec of ACADEMIC_TABLES) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT t.\`${spec.pk}\` AS entry_id, t.\`${spec.nameCol}\` AS title, t.user_subject_id,
              t.urgency, t.status, t.deadline, t.accomplished_at,
              s.course_code,
              m.in_progress, m.estimated_hours, m.start_date
       FROM \`${spec.table}\` t
       JOIN user_subjects us ON us.user_subject_id = t.user_subject_id
       JOIN subjects s ON s.subject_id = us.subject_id
       LEFT JOIN workboard_entry_meta m ON m.\`${spec.metaCol}\` = t.\`${spec.pk}\`
       WHERE us.user_id = ?
         AND (t.status != 'Done' OR t.accomplished_at >= ?)`,
      [userId, cutoff],
    );

    for (const r of rows) {
      items.push({
        source:          spec.source,
        id:              r.entry_id,
        title:           r.title,
        category:        'academic',
        chip_label:      r.course_code ?? null,
        project_id:      null,
        user_subject_id: r.user_subject_id,
        priority:        priorityFromUrgency(r.urgency),
        work_status:     deriveAcademicStatus(r.status, r.in_progress),
        due_at:          r.deadline ? String(r.deadline).slice(0, 10) : null,
        start_date:      r.start_date ? String(r.start_date).slice(0, 10) : null,
        estimated_hours: r.estimated_hours === null || r.estimated_hours === undefined
                           ? null : Number(r.estimated_hours),
        completed_at:    r.accomplished_at ? String(r.accomplished_at).slice(0, 10) : null,
        note:            null,
      });
    }
  }

  return { items, projects, generated_at: today };
}
