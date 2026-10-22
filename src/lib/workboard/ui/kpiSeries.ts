/** Pure series behind the KPI micro-visuals (spec 5, plan ruling R2). Whole-board: callers pass
 *  `work.items`, never the filtered list, so the tiles never move as the user filters. */
import type { WorkItem } from '@/lib/workboard/workItems';
import { addDays, dueDateOf } from '@/lib/workboard/dates';
import { isRevisionStage } from '@/lib/workboard/workContexts';

export function weekCompletion(items: WorkItem[], weekStart: string): { done: number; total: number } {
  const weekEnd = addDays(weekStart, 6);
  let done = 0;
  let total = 0;
  for (const item of items) {
    const due = dueDateOf(item);
    if (due === null || due < weekStart || due > weekEnd) continue;
    total++;
    if (item.work_status === 'done') done++;
  }
  return { done, total };
}

/** Not-done items due on each of today .. today+3: the same window `computeStats` counts for
 *  `due_soon_count`, so the dots always add up to the Due Soon numeral. */
export function dueSoonByDay(items: WorkItem[], today: string): [number, number, number, number] {
  const days = [today, addDays(today, 1), addDays(today, 2), addDays(today, 3)];
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (const item of items) {
    if (item.work_status === 'done') continue;
    const idx = days.indexOf(dueDateOf(item) ?? '');
    if (idx >= 0) out[idx]++;
  }
  return out;
}

export function estimateByDay(items: WorkItem[], weekStart: string): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const item of items) {
    // Done work is excluded, matching `estimated_hours_this_week`.
    if (item.estimated_hours == null || item.work_status === 'done') continue;
    const due = dueDateOf(item);
    if (due === null) continue;
    for (let i = 0; i < 7; i++) {
      if (addDays(weekStart, i) === due) { out[i] += Number(item.estimated_hours); break; }
    }
  }
  return out;
}

/** The earliest due date among overdue items, "YYYY-MM-DD", or null. Same overdue rule as
 *  `computeStats`: not done, due before today, not a revision stage. */
export function oldestOverdueDue(items: WorkItem[], today: string): string | null {
  let oldest: string | null = null;
  for (const item of items) {
    if (item.work_status === 'done' || isRevisionStage(item.work_stage)) continue;
    const due = dueDateOf(item);
    if (due === null || due >= today) continue;
    if (oldest === null || due < oldest) oldest = due;
  }
  return oldest;
}
