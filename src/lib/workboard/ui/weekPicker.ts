/** Focus week picker data (refine spec §5.2). Pool-free. */
import type { WorkItem } from '@/lib/workboard/workItems';
import type { ClassOccurrence } from '@/lib/workboard/aggregate';
import { addDays, dueDateOf } from '@/lib/workboard/dates';
import { isSkippedClass } from './dayEntries';

export interface PickerDay { date: string; dueCount: number; dueHours: number; classCount: number; isPast: boolean; isToday: boolean }

export function weekPickerDays(items: WorkItem[], classes: ClassOccurrence[], weekStart: string, today: string): PickerDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const due = items.filter(it => it.work_status !== 'done' && dueDateOf(it) === date);
    return {
      date,
      dueCount: due.length,
      dueHours: due.reduce((s, it) => s + (it.estimated_hours ?? 0), 0),
      classCount: classes.filter(c => c.date === date && !isSkippedClass(c)).length,
      isPast: date < today,
      isToday: date === today,
    };
  });
}

export function dueBarHeight(day: PickerDay, week: PickerDay[]): number {
  if (day.dueCount === 0) return 0;
  const byHours = week.some(d => d.dueHours > 0);
  const val = (d: PickerDay) => (byHours ? d.dueHours : d.dueCount);
  const max = Math.max(...week.map(val));
  if (max <= 0) return 4;
  return Math.max(4, Math.round((val(day) / max) * 18));
}

/** Elapsed fraction of the week (0–1). `today` may carry a time suffix; only its date counts.
 *  The day index is computed arithmetically, so a malformed date can never spin a loop. */
export function weekProgress(weekStart: string, today: string, nowMinutes: number): number {
  const start = Date.parse(`${weekStart.slice(0, 10)}T00:00:00Z`);
  const day = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(day)) return 0;
  const idx = Math.round((day - start) / 86_400_000);
  if (idx < 0) return 0;
  if (idx > 6) return 1;
  const mins = Math.min(Math.max(nowMinutes, 0), 1440);
  return (idx + mins / 1440) / 7;
}
