/** Dashboard summary contract (spec §4.1). Pool-free: safe to import from client components. */

/** One independently-loaded part of the dashboard. `ok: false` = that query failed; the rest
 *  of the page still renders and the cell offers a retry. */
export type Section<T> = { ok: true; data: T } | { ok: false };

export type FinanceTone = 'on_track' | 'tight' | 'over';

export interface HabitsToday  { done: number; total: number; bestStreak: number }
export interface FinanceToday { perDay: number; safeTotal: number; tone: FinanceTone }
export interface StudyToday   { gpa: number }

export interface HeaderData {
  dateLine:        string;
  weekOfTerm:      number | null;
  canvasConnected: boolean;
}
