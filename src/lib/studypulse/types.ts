/* Shared StudyPulse types. Moved out of SubjectCardView.tsx so server code and pure libs can use them. */
import type { GradeScale } from '@/lib/gradeScale';
import type { GradingPresetFull } from '@/components/studypulse/GradingSetupWizard';

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
}
