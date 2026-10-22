/** Focus "Up next" ranking and the Show-all partition (refine spec §5.1, plan R2/R3). Pool-free. */
import type { WorkItem } from '@/lib/workboard/workItems';
import { addDays, dueDateOf } from '@/lib/workboard/dates';
import { isRevisionStage } from '@/lib/workboard/workContexts';
import { itemKey } from './itemKey';

export const UP_NEXT_LIMIT = 4;

const PRIORITY_RANK: Record<WorkItem['priority'], number> = { high: 0, normal: 1, low: 2 };
const timeOf = (i: WorkItem) => i.deadline_time ?? '99:99:99';   // untimed sorts after timed
const dueOf = (i: WorkItem) => dueDateOf(i) ?? '9999-12-31';

/** 0 overdue · 1 today · 2 tomorrow · 3 in progress within 7 days · null = not Up next material. */
function tierOf(item: WorkItem, today: string): number | null {
  if (item.work_status === 'done') return null;
  const due = dueDateOf(item);
  if (due === null) return null;
  if (due < today) return isRevisionStage(item.work_stage) ? 1 : 0;
  if (due === today) return 1;
  if (due === addDays(today, 1)) return 2;
  if (due <= addDays(today, 7) && item.work_status === 'in_progress') return 3;
  return null;
}

function byDueThenTime(a: WorkItem, b: WorkItem): number {
  return dueOf(a).localeCompare(dueOf(b)) || timeOf(a).localeCompare(timeOf(b)) || itemKey(a).localeCompare(itemKey(b));
}

export function rankUpNext(items: WorkItem[], today: string): WorkItem[] {
  return items
    .map(item => ({ item, tier: tierOf(item, today) }))
    .filter((x): x is { item: WorkItem; tier: number } => x.tier !== null)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier === 3) {
        const p = PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority];
        if (p !== 0) return p;
      }
      return byDueThenTime(a.item, b.item);
    })
    .map(x => x.item);
}

export type ShowAllKey = 'more_overdue' | 'this_week' | 'next_week' | 'later' | 'waiting' | 'no_deadline';
export const SHOW_ALL_ORDER: ShowAllKey[] = ['more_overdue', 'this_week', 'next_week', 'later', 'waiting', 'no_deadline'];
export const SHOW_ALL_LABELS: Record<ShowAllKey, string> = {
  more_overdue: 'More overdue', this_week: 'This week', next_week: 'Next week',
  later: 'Later', waiting: 'Waiting', no_deadline: 'No deadline',
};

export function showAllGroups(items: WorkItem[], today: string, shown: ReadonlySet<string>): Record<ShowAllKey, WorkItem[]> {
  const g: Record<ShowAllKey, WorkItem[]> = { more_overdue: [], this_week: [], next_week: [], later: [], waiting: [], no_deadline: [] };
  const wk = addDays(today, 7);
  const nx = addDays(today, 14);
  for (const item of items) {
    if (item.work_status === 'done' || shown.has(itemKey(item))) continue;
    if (item.blocked_since !== null) { g.waiting.push(item); continue; }
    const due = dueDateOf(item);
    if (due === null) g.no_deadline.push(item);
    else if (due < today && !isRevisionStage(item.work_stage)) g.more_overdue.push(item);
    else if (due <= wk) g.this_week.push(item);
    else if (due <= nx) g.next_week.push(item);
    else g.later.push(item);
  }
  for (const k of ['more_overdue', 'this_week', 'next_week', 'later'] as const) g[k].sort(byDueThenTime);
  g.waiting.sort((a, b) => a.blocked_since!.localeCompare(b.blocked_since!));
  g.no_deadline.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title));
  return g;
}

/** "+3 more this week · 1 no deadline · 2 later" — '' when nothing is left to show. */
export function foldLabel(g: Record<ShowAllKey, WorkItem[]>): string {
  const week = g.more_overdue.length + g.this_week.length;
  const rest = g.next_week.length + g.later.length + g.waiting.length;
  const parts: string[] = [];
  if (week) parts.push(`${week} more this week`);
  if (g.no_deadline.length) parts.push(`${g.no_deadline.length} no deadline`);
  if (rest) parts.push(`${rest} later`);
  return parts.length ? `+${parts.join(' · ')}` : '';
}
