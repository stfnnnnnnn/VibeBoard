/* Shared shapes for the Canvas hub (spec §6). */

export type HubTab = 'overview' | 'bank' | 'announcements';

export interface ConnectionStatus {
  connected:         boolean;
  canvas_user_name?: string;
  status?:           'active' | 'invalid' | 'disconnected';
  last_sync_at?:     string | null;
  last_sync_status?: 'success' | 'partial' | 'failed' | null;
  /** Seconds since last_sync_at, measured by MySQL (the column is written with NOW()). */
  last_sync_age_s?:  number | null;
  token_expires_at?: string | null;
  /** Whole days until token_expires_at (ceil), computed on the server; null when Canvas gave no expiry. */
  token_days_left?:  number | null;
}

export interface HubSubject {
  user_subject_id: number;
  subject_name:    string;
  course_code:     string | null;
}

export interface CanvasCourse {
  id:               number;
  canvas_course_id: number;
  name:             string;
  course_code:      string | null;
  term:             string | null;
  mapping_status:   'pending' | 'linked' | 'created' | 'ignored';
  user_subject_id:  number | null;
}

/** Pending counts keyed by user_subject_id (as a string), or 'none' for items on an unmapped course. */
export interface PendingCounts {
  bank:          Record<string, number>;
  announcements: Record<string, number>;
}

export const sumCounts = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

/** A subject's short label: its course code, else its name. */
export const subjectCode = (s: HubSubject) => s.course_code?.trim() || s.subject_name;

/* ── Activity Bank (spec §6 C3) ── */

export type LegacyTarget = 'activities' | 'quizzes' | 'exams';

/** GET /api/canvas/bank's per-item suggestion: a custom subject's period › category, or a legacy table. */
export type BankSuggestion =
  | { period_id: number; period_name: string; cat_id: number; cat_name: string; confidence: 'match' | 'guess'; reason: string }
  | { legacy: { target: LegacyTarget; confidence: 'match' | 'guess'; reason: string } };

export interface BankItem {
  id:                number;
  name:              string;
  /** UTC "YYYY-MM-DD HH:MM:SS" (normalize.ts toMysqlUtc). */
  due_at:            string | null;
  points_possible:   number | null;
  submission_score:  number | null;
  course_name:       string;
  user_subject_id:   number | null;
  subject_mode?:     'legacy' | 'custom';
  suggestion?:       BankSuggestion | null;
}

/** Where an Include sends an item. */
export type BankTarget =
  | { kind: 'custom'; period_id: number; period_name: string; cat_id: number; cat_name: string }
  | { kind: 'legacy'; target: LegacyTarget };

export const LEGACY_LABEL: Record<LegacyTarget, string> = { activities: 'Activities', quizzes: 'Quizzes', exams: 'Exams' };

export function suggestedTarget(s: BankSuggestion | null | undefined): BankTarget | null {
  if (!s) return null;
  if ('legacy' in s) return { kind: 'legacy', target: s.legacy.target };
  return { kind: 'custom', period_id: s.period_id, period_name: s.period_name, cat_id: s.cat_id, cat_name: s.cat_name };
}

export const targetLabel = (t: BankTarget) => (t.kind === 'custom' ? `${t.period_name} › ${t.cat_name}` : LEGACY_LABEL[t.target]);

/** A subject's grading periods as GET /api/studypulse/subjects/[id]/grading returns them (config.preset.periods). */
export interface PickerPeriod {
  period_id:  number;
  name:       string;
  categories: Array<{ cat_id: number; name: string }>;
}
