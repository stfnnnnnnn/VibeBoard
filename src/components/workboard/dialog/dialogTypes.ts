// Types and label tables shared by WorkItemDialog and its dialog/* field components.
// `workItems.ts` imports `@/lib/db` (mysql2) at module scope, so it is `import type` only here.
import type { WorkPriority, WorkStatus, WorkSource } from '@/lib/workboard/workItems';

export interface SubjectOption {
  user_subject_id: number;
  course_code:     string;
  subject_name:    string;
}

export const STATUS_LABEL: Record<WorkStatus, string> = {
  todo:        'To Do',
  in_progress: 'In Progress',
  done:        'Done',
};

export const PRIORITY_LABEL: Record<WorkPriority, string> = {
  high:   'High',
  normal: 'Normal',
  low:    'Low',
};

/**
 * The three ways an Academic item can come into being. They are genuinely different
 * operations, not three spellings of "create":
 *
 *   'link'        writes NOTHING. Study Pulse already put the item on the board; this path
 *                 only lets the user find it and see that it is there.
 *   'graded'      writes a real Study Pulse row via POST /api/workboard/academic/create.
 *   'independent' writes an owned `workboard_work_items` row through the same POST/PATCH
 *                 the Projects/Organization/Life contexts use. The only path of the three
 *                 whose row has a `project_id` column, which is why Academic Project is
 *                 offered here and nowhere else.
 */
export type AcademicSourcePath = 'link' | 'graded' | 'independent';

export const ACADEMIC_SOURCE_OPTIONS: { value: AcademicSourcePath; label: string; blurb: string }[] = [
  {
    value: 'link',
    label: 'Link an existing item',
    blurb: 'Study Pulse already put it on your board. Find it here to confirm — nothing is created.',
  },
  {
    value: 'graded',
    label: 'New graded work',
    blurb: 'Writes a real entry in Study Pulse, so it counts toward your grade.',
  },
  {
    value: 'independent',
    label: 'New independent activity',
    blurb: 'Revision, reading, practice — study work that only lives on Workboard.',
  },
];

/** How each row in the "Link an existing item" picker announces where it came from, so two
 *  similarly-titled entries stay tellable apart. `owned` is in the list because the picker
 *  filters by *context*, not by source: an independent activity added here is on the board
 *  for that course too, and "this is already here" is just as true of it. */
export const WORK_SOURCE_LABEL: Record<WorkSource, string> = {
  owned:         'Independent',
  activities:    'Activity',
  quizzes:       'Quiz',
  exams:         'Exam',
  grade_entries: 'Graded item',
};

/** The three targets a legacy-mode subject offers, in the order Study Pulse's own pickers
 *  offer them. Labels come from `WORK_SOURCE_LABEL` so a target reads as the same word here
 *  as it does in the "Link an existing item" list. */
export const LEGACY_TARGETS = ['activities', 'quizzes', 'exams'] as const;
export type LegacyTarget = typeof LEGACY_TARGETS[number];

/** One row of the "Link an existing item" picker — the handful of `WorkItem` fields the
 *  picker actually renders, kept narrow so the cache does not pin whole payloads. `key`
 *  exists because ids repeat across the four Study Pulse tables: `activities` #5 and
 *  `exams` #5 are different items, so source and id together are the only unique handle. */
export interface LinkableItem {
  key:    string;
  source: WorkSource;
  id:     number;
  title:  string;
  due_at: string | null;
}

export interface GradingCategory { cat_id: number; name: string }
export interface GradingPeriod   { period_id: number; name: string; categories: GradingCategory[] }

/**
 * What the "New graded work" path needs out of `GET /api/studypulse/subjects/[id]/grading`.
 *
 * `mode` is the whole point: a legacy subject is graded as Activity/Quiz/Exam, a custom one
 * as a category inside a grading period, and the create route 400s if the body describes the
 * wrong one. It is derived exactly as `CanvasAnnouncementBank` derives it — a *real* preset
 * means custom — which is also how the route's own `getSubjectMode` decides (it JOINs
 * `grading_presets`, so a `subject_grading` row pointing at a missing preset is legacy on
 * both sides). Deriving it from `config !== null` instead would disagree with the server on
 * exactly that row and strand the user on a picker whose every submission is rejected.
 */
export interface SubjectGrading {
  mode:    'legacy' | 'custom';
  periods: GradingPeriod[];
}

/** Which field a validation message belongs under; 'form' is the top banner (network errors). */
export type FormErrorField = 'title' | 'context' | 'project' | 'academicSource' | 'course' | 'grading' | 'dueAt' | 'form';
export interface FormError { field: FormErrorField; message: string }
