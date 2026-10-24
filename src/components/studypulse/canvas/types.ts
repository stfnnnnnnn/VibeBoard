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
