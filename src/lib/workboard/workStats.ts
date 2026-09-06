import type { WorkItem, WorkCategory } from '@/lib/workboard/workItems';
import { addDays, dueDateOf } from '@/lib/workboard/dates';

export interface TimeframeGroups {
  today:     WorkItem[];
  upcoming:  WorkItem[];
  later:     WorkItem[];
}

/**
 * Today = due today OR overdue (an overdue item belongs at the top of the list, not buried
 * in a past section that doesn't exist). Upcoming = due in the 7 days after today, inclusive
 * of day 7. Later = everything else, including every undated item.
 * Done items are excluded from all three groups — the List view shows open work.
 */
export function groupByTimeframe(items: WorkItem[], todayStr: string): TimeframeGroups {
  const horizon = addDays(todayStr, 7);
  const groups: TimeframeGroups = { today: [], upcoming: [], later: [] };

  for (const item of items) {
    if (item.work_status === 'done') continue;
    const due = dueDateOf(item);
    if (due === null)             groups.later.push(item);
    else if (due <= todayStr)     groups.today.push(item);
    else if (due <= horizon)      groups.upcoming.push(item);
    else                          groups.later.push(item);
  }
  return groups;
}

export interface WorkStats {
  active_count:              number;
  /** Net change over the trailing 7 days: created minus completed. This is what the schema
   *  can honestly answer — a true "active count as of last week" isn't reconstructable
   *  without history we don't keep, so it is not claimed. */
  active_net_change_7d:      number;
  due_soon_count:            number;   // not done, due within the next 3 days, not overdue
  overdue_count:             number;   // not done, due before today
  estimated_hours_this_week: number;
  estimated_items_counted:   number;   // in-scope items that HAD an estimate
  estimated_items_missing:   number;   // in-scope items with no estimate (disclosed in the UI)
}

export function computeStats(items: WorkItem[], todayStr: string, weekStart: string): WorkStats {
  const soonHorizon = addDays(todayStr, 3);
  const weekEnd     = addDays(weekStart, 6);
  const weekAgo     = addDays(todayStr, -7);

  let active = 0, dueSoon = 0, overdue = 0;
  let hours = 0, counted = 0, missing = 0;
  let completed7d = 0;

  for (const item of items) {
    const due  = dueDateOf(item);
    const done = item.work_status === 'done';

    if (!done) {
      active++;
      if (due !== null) {
        if (due < todayStr) overdue++;
        else if (due <= soonHorizon) dueSoon++;
      }
      if (due !== null && due >= weekStart && due <= weekEnd) {
        if (item.estimated_hours !== null) { hours += item.estimated_hours; counted++; }
        else missing++;
      }
    }

    if (item.completed_at !== null && item.completed_at.slice(0, 10) >= weekAgo) completed7d++;
  }

  // `WorkItem` deliberately carries no `created_at` field, so creations cannot be counted from
  // this data alone. Only completions are countable, making the delta always ≤ 0.
  // The UI will render this as "N completed in the last 7 days" using completed7d's contribution.

  return {
    active_count:              active,
    active_net_change_7d:      -completed7d,
    due_soon_count:            dueSoon,
    overdue_count:             overdue,
    estimated_hours_this_week: Math.round(hours * 10) / 10,
    estimated_items_counted:   counted,
    estimated_items_missing:   missing,
  };
}

export interface WorkloadDay {
  date:          string;
  academic:      number;
  project:       number;
  organization:  number;
  life:          number;
  total:         number;
}

/** 7 days, Monday..Sunday, counting not-done items due on each day, split by category.
 *  Mirrors v1's `computeHeatmap` shape (7 entries, Mon-first) so the two charts agree. */
export function computeWorkloadChart(items: WorkItem[], weekStart: string): WorkloadDay[] {
  const days: WorkloadDay[] = [];

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const counts: Record<WorkCategory, number> = { academic: 0, project: 0, organization: 0, life: 0 };
    let total = 0;

    for (const item of items) {
      if (item.work_status === 'done') continue;
      if (dueDateOf(item) !== date) continue;
      counts[item.category]++;
      total++;
    }

    days.push({ date, ...counts, total });
  }
  return days;
}
