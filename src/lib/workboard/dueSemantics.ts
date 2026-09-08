import { dueDateOf } from '@/lib/workboard/dates';
import type { WorkItem } from '@/lib/workboard/workItems';

export type DueState = 'none' | 'upcoming' | 'due_today' | 'overdue' | 'completed' | 'completed_late';

/**
 * The spec's rules, in order:
 *   not done AND deadline < now        -> overdue
 *   done     AND completed <= deadline -> completed
 *   done     AND completed >  deadline -> completed late
 * A completed item with no recorded completion timestamp reads `completed`, never
 * `completed_late` — guessing lateness from missing data would be a lie, not a default.
 */
export function dueStateOf(item: WorkItem, todayStr: string): DueState {
  const due = dueDateOf(item);
  const done = item.work_status === 'done';

  if (done) {
    if (due === null || item.completed_at === null) return 'completed';
    return item.completed_at.slice(0, 10) > due ? 'completed_late' : 'completed';
  }
  if (due === null) return 'none';
  if (due < todayStr) return 'overdue';
  if (due === todayStr) return 'due_today';
  return 'upcoming';
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** "Sep 8" — the date half of a deadline. Null when the item has no deadline. */
export function formatDeadline(item: WorkItem): string | null {
  const due = dueDateOf(item);
  if (due === null) return null;
  const [, m, d] = due.split('-');
  return MONTHS[parseInt(m, 10) - 1] + ' ' + parseInt(d, 10);
}

/**
 * "11:59 PM", or an em dash when no time is set. The spec is explicit that an absent
 * time must never render as midnight — which is exactly why the time lives in its own
 * column rather than inside a DATETIME.
 */
export function formatDeadlineTime(item: WorkItem): string {
  if (!item.deadline_time) return '—';
  const [hRaw, min] = item.deadline_time.split(':');
  const h = parseInt(hRaw, 10);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return display + ':' + min + ' ' + suffix;
}

/** The human label a row or card shows for its deadline. */
export function formatDueLabel(item: WorkItem, todayStr: string): string | null {
  const state = dueStateOf(item, todayStr);
  const date = formatDeadline(item);

  switch (state) {
    case 'none':           return null;
    case 'completed':      return date ? 'Completed · ' + date : 'Completed';
    case 'completed_late': return date ? 'Completed late · ' + date : 'Completed late';
    case 'overdue':        return date ? 'Overdue · ' + date : 'Overdue';
    case 'due_today':      return 'Due today';
    case 'upcoming':       return date ? 'Due ' + date : null;
  }
}
