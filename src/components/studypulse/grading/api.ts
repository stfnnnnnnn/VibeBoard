/* Thin fetch helpers for the grading setup sheet. Every call resolves to { ok, status, data } and never throws,
   so the sheet can turn a 400's `{ error }` into an inline message. Routes: Tasks 5–7 (see each route file). */
import type { GradingConfig, GradingPresetFull } from '@/lib/studypulse/types';

export interface ApiResult<T> { ok: boolean; status: number; data: T & { error?: string } }

export async function api<T = Record<string, unknown>>(url: string, method = 'GET', body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({})) as T & { error?: string };
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server. Check your connection and try again.' } as T & { error?: string } };
  }
}

export const subjectGradingUrl = (id: number) => `/api/studypulse/subjects/${id}/grading`;

export async function loadConfig(userSubjectId: number): Promise<GradingConfig | null> {
  const r = await api<{ config: GradingConfig | null }>(subjectGradingUrl(userSubjectId));
  return r.ok && r.data.config?.preset ? r.data.config : null;
}

export async function loadPreset(presetId: number): Promise<GradingPresetFull | null> {
  const r = await api<{ preset: GradingPresetFull }>(`/api/studypulse/grading/${presetId}`);
  return r.ok ? r.data.preset : null;
}

export interface UsageSubject { user_subject_id: number; code: string; name: string; entry_count: number }
export interface LabLink {
  role: 'lecture' | 'lab';
  partner_user_subject_id: number;
  partner_code: string;
  partner_name: string;
  lecture_weight: number;
}
export interface SubjectOption { user_subject_id: number; course_code: string; subject_name: string }
