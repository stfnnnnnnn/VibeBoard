import type { WorkItem, WorkCategory } from '@/lib/workboard/workItems';
import { addDays, dueDateOf } from '@/lib/workboard/dates';
import { isRevisionStage } from '@/lib/workboard/workContexts';

export interface TimeframeGroups {
  overdue:      WorkItem[];
  today:        WorkItem[];
  tomorrow:     WorkItem[];
  this_week:    WorkItem[];
  later:        WorkItem[];
  no_deadline:  WorkItem[];
}

/**
 * Overdue is its own section (spec §6). v2 folded overdue items into Today on the
 * reasoning that a past section "doesn't exist"; v3 gives it one, because burying a
 * late item among today's work hides exactly the thing that most needs attention.
 *
 * Today/Tomorrow/This Week are three points along the same rolling 7-day window the old
 * single "Upcoming" bucket covered (today+1 through today+7) — splitting it out is a finer
 * read of the same horizon, not a wider one: "This Week" is today+2 through today+7, not the
 * calendar week, so it never produces a lopsided bucket right after a Saturday or Sunday.
 * Later = anything past that 7-day horizon. No Deadline is its own group rather than folded
 * into Later — an undated item isn't "far away," it has no temporal position to sort by at
 * all, and conflating the two hid genuinely-undated work behind items that are merely distant.
 * Done items appear in none of these. A past-due revision item (`isRevisionStage`) is never
 * overdue; it goes in Today, the nearest live slot for work that still needs doing.
 */
export function groupByTimeframe(items: WorkItem[], todayStr: string): TimeframeGroups {
  const tomorrowStr = addDays(todayStr, 1);
  const horizon = addDays(todayStr, 7);
  const groups: TimeframeGroups = {
    overdue: [], today: [], tomorrow: [], this_week: [], later: [], no_deadline: [],
  };

  for (const item of items) {
    if (item.work_status === 'done') continue;
    const due = dueDateOf(item);
    if (due === null)             groups.no_deadline.push(item);
    else if (due < todayStr)      (isRevisionStage(item.work_stage) ? groups.today : groups.overdue).push(item);
    else if (due === todayStr)    groups.today.push(item);
    else if (due === tomorrowStr) groups.tomorrow.push(item);
    else if (due <= horizon)      groups.this_week.push(item);
    else                          groups.later.push(item);
  }
  return groups;
}

export interface WorkStats {
  active_count:              number;
  /** Not-done items whose normalised status is specifically `in_progress` — a subset of
   *  `active_count` (which is todo + in_progress). Only the Active tile's fallback subtitle,
   *  "N in progress", shown when nothing is due this week. */
  in_progress_count:         number;
  /** Net change over the trailing 7 days: created minus completed. This is what the schema
   *  can honestly answer — a true "active count as of last week" isn't reconstructable
   *  without history we don't keep, so it is not claimed. */
  active_net_change_7d:      number;
  due_soon_count:            number;   // not done, due within the next 3 days, not overdue
  overdue_count:             number;   // not done, not a revision stage, due before today
  estimated_hours_this_week: number;
  estimated_items_counted:   number;   // in-scope items that HAD an estimate
  estimated_items_missing:   number;   // in-scope items with no estimate (disclosed in the UI)
}

export function computeStats(items: WorkItem[], todayStr: string, weekStart: string): WorkStats {
  const soonHorizon = addDays(todayStr, 3);
  const weekEnd     = addDays(weekStart, 6);
  const weekAgo     = addDays(todayStr, -7);

  let active = 0, inProgress = 0, dueSoon = 0, overdue = 0;
  let hours = 0, counted = 0, missing = 0;
  let completed7d = 0;

  for (const item of items) {
    const due  = dueDateOf(item);
    const done = item.work_status === 'done';

    if (!done) {
      active++;
      if (item.work_status === 'in_progress') inProgress++;
      if (due !== null) {
        // A past-due revision item counts as neither overdue nor due soon.
        if (due < todayStr) { if (!isRevisionStage(item.work_stage)) overdue++; }
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
  // No longer surfaced on the Active card: spec §22 replaced that sub-line with
  // `in_progress_count`, which describes the number above it. The value is still computed and
  // exported — it is an honest independent figure, not dead by intent — but nothing reads it
  // today, so a future task may retire it.

  return {
    active_count:              active,
    in_progress_count:         inProgress,
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
