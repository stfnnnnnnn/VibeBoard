/* Shared StudyPulse types. Moved out of SubjectCardView.tsx so server code and pure libs can use them. */
import type { GradeScale } from '@/lib/gradeScale';

export type { GradeScale };

/** How the subject's final grade is formed: one designated period, or the average of all periods. */
export type FinalMode = 'period' | 'average';

/** A persisted grading preset as returned by the grading API routes. */
export interface GradingPresetFull {
  preset_id:       number;
  name:            string;
  is_default:      number;
  has_lab:         number;
  lec_weight:      number;
  lab_weight:      number;
  grade_scale:     GradeScale;
  final_period_id: number | null;
  final_mode:      FinalMode | null;
  periods:     Array<{
    period_id:  number;
    name:       string;
    sort_order: number;
    categories: Array<{
      cat_id:          number;
      name:            string;
      weight:          number;
      is_singleton:    number;
      sort_order:      number;
      link_group:      string | null;
      carry_score:     number;
      include_earlier: number;
    }>;
  }>;
}

export type Urgency = 'High' | 'Medium' | 'Low';
export type EntryStatus = 'Pending' | 'Done';

export interface EntryRow {
  id: number;
  name: string;
  specificType: string;
  urgency: Urgency;
  status: EntryStatus;
  deadline: string;
  accomplished_at: string;
  score: string;
  items: string;
  grade: number | null;
  canvas_linked?: boolean;
  /** The school task's note from the Workboard overlay (spec 2026-10-24 §6.1). Read-only here: edited in Workboard. */
  note?: string | null;
  saving?: boolean;
  /** Client-only identity for a row created on this page (id 0 until saved). Never sent to the server. */
  _key?: string;
}

export interface GradingConfig {
  preset_id: number;
  has_lab: number;
  lec_weight: number;
  lab_weight: number;
  grade_scale: GradeScale | null;
  preset: GradingPresetFull;
}

export type PresetLike = Pick<GradingPresetFull, 'periods' | 'final_mode' | 'final_period_id'>;

export interface SubjectCardData {
  user_subject_id: number;
  subject_name: string;
  course_code: string;
  section?: string | null;
  units: number;
  year_level: string;
  trimester: string;
  completed_tasks: number;
  total_tasks: number;
  progress_percent: number;
  /** Overall current grade (spec §6.1); null when nothing is graded. */
  current_grade: number | null;
  grade_scale: GradeScale | null;
  /** Set when this subject is in a lecture/lab link; current_grade is then the combined grade. */
  lab_tag?: 'Lec + Lab' | null;
}
