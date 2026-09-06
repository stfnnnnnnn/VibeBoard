export type WorkCategory = 'academic' | 'project' | 'organization' | 'life';
export type WorkStatus   = 'todo' | 'in_progress' | 'done';
export type WorkPriority = 'high' | 'normal' | 'low';
export type WorkSource   = 'owned' | 'activities' | 'quizzes' | 'exams' | 'grade_entries';

export const ACADEMIC_SOURCES = ['activities', 'quizzes', 'exams', 'grade_entries'] as const;
export type AcademicSource = typeof ACADEMIC_SOURCES[number];

export const WORK_CATEGORIES: WorkCategory[] = ['academic', 'project', 'organization', 'life'];

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

/** The calendar date portion of an item's due timestamp, or null when undated. */
export function dueDateOf(item: WorkItem): string | null {
  return item.due_at ? item.due_at.slice(0, 10) : null;
}
