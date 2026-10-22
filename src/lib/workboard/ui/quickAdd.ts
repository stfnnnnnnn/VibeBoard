/** Quick-add defaults (spec 11, plan ruling R1). Pool-free. */
import type { WorkItem } from '@/lib/workboard/workItems';
import { WORK_CONTEXTS, isStageLegal, normaliseStage, type WorkContext, type WorkStage } from '@/lib/workboard/workContexts';

export interface CourseOption { userSubjectId: number; code: string }

export interface QuickAddDefaults {
  dueAt: string | null;
  stage?: WorkStage;
  preferredCourseId?: number | null;
}

const LAST_KEY = 'wb.quickAdd.lastContext';

export function courseOptions(items: WorkItem[]): CourseOption[] {
  const seen = new Map<number, string>();
  for (const item of items) {
    if (item.category !== 'academic' || item.user_subject_id == null) continue;
    if (!seen.has(item.user_subject_id)) {
      seen.set(item.user_subject_id, item.course_code ?? item.chip_label ?? `Course ${item.user_subject_id}`);
    }
  }
  return [...seen].map(([userSubjectId, code]) => ({ userSubjectId, code })).sort((a, b) => a.code.localeCompare(b.code));
}

export function quickAddContexts(hasCourses: boolean): WorkContext[] {
  return WORK_CONTEXTS.filter(c => c !== 'academic' || hasCourses);
}

function readLast(): WorkContext | null {
  try {
    const v = window.localStorage.getItem(LAST_KEY);
    return (WORK_CONTEXTS as string[]).includes(v ?? '') ? (v as WorkContext) : null;
  } catch { return null; }
}

export function rememberQuickAddContext(ctx: WorkContext): void {
  try { window.localStorage.setItem(LAST_KEY, ctx); } catch { /* storage unavailable: default next time */ }
}

export function defaultQuickAddContext(filter: WorkContext | 'all', hasCourses: boolean): WorkContext {
  const allowed = quickAddContexts(hasCourses);
  if (filter !== 'all' && allowed.includes(filter)) return filter;
  const last = readLast();
  if (last && allowed.includes(last)) return last;
  // Spec 11: fall back to the first owned (non-academic) context in WORK_CONTEXTS order.
  return 'project';
}

/** A Board column's stage may not exist in the context the user switched quick add to;
 *  fall back to the normalised status, which every context accepts. */
export function stageFor(ctx: WorkContext, stage: WorkStage | undefined): WorkStage | undefined {
  if (stage === undefined) return undefined;
  return isStageLegal(ctx, stage) ? stage : normaliseStage(stage);
}
