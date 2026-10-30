/** The dashboard's read-only Workboard strip (dashboard spec §5.5). Pool-free; reuses Focus's own
 *  Up next ranking so the two never disagree about what comes next. */
import type { WorkItem } from '@/lib/workboard/workItems';
import type { WorkContext } from '@/lib/workboard/workContexts';
import { CONTEXT_LABELS, STAGE_LABELS, isRevisionStage, isWaitingStage, normaliseStage } from '@/lib/workboard/workContexts';
import { addDays, daysSince, dueDateOf } from '@/lib/workboard/dates';
import { computeStats, computeWorkloadChart } from '@/lib/workboard/workStats';
import { rankUpNext, UP_NEXT_LIMIT } from '@/lib/workboard/ui/upNext';
import { itemKey } from '@/lib/workboard/ui/itemKey';
import { shortCourseCode } from '@/lib/workboard/ui/courseCode';

export type StageTone = 'todo' | 'progress' | 'waiting' | 'revision';
export interface DueChip { top: string; bottom: string | null; late: boolean }
export interface DigestItem {
  key: string; href: string; title: string;
  context: WorkContext; contextLabel: string;
  stageLabel: string; stageTone: StageTone;
  priority: 'high' | 'normal' | 'low';
  subtasks: { done: number; total: number } | null;
  estimatedHours: number | null;
  due: DueChip | null;
  doneOn: string | null;   // 'Wed' for items completed this week; null otherwise
}
export interface DigestDay { date: string; counts: Record<WorkContext, number>; total: number; items: DigestItem[] }
export interface WorkboardDigest {
  hasAnyItems: boolean;
  overdue: number; inProgress: number; dueThisWeek: number;
  doneThisWeek: number; totalThisWeek: number;
  upNext: DigestItem[];
  /** Not-done items outside upNext, due after today+7 or undated; due order, undated last; at most 3. */
  later: DigestItem[];
  /** Items completed Mon–Sun of this week, newest completion first; at most 3; doneOn set. */
  doneRecent: DigestItem[];
  /** 'Nov 12': the earliest due date among not-done items due after the week; null if none. */
  nextDueAfterWeek: string | null;
  week: DigestDay[];
}

/** How many filler items the dashboard strip may borrow from each of later / doneRecent. */
const FILL_LIMIT = 3;

const fmt = (date: string, o: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });

function clock(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function dueChip(due: string | null, time: string | null, today: string, revision: boolean): DueChip | null {
  if (!due) return null;
  const t = clock(time);
  if (due < today && !revision) {
    return { top: `${daysSince(due, today)}d late`, bottom: [fmt(due, { weekday: 'short' }), t].filter(Boolean).join(' '), late: true };
  }
  // A past-due item sent back for revision is not late, and its due date is not today either.
  if (due < today) {
    return { top: 'Revision', bottom: t ? `${fmt(due, { weekday: 'short' })} ${t}` : fmt(due, { month: 'short', day: 'numeric' }), late: false };
  }
  if (due <= today)              return { top: 'Today', bottom: t, late: false };
  if (due === addDays(today, 1)) return { top: 'Tomorrow', bottom: t, late: false };
  if (due <= addDays(today, 6))  return { top: fmt(due, { weekday: 'short' }), bottom: t ?? fmt(due, { month: 'short', day: 'numeric' }), late: false };
  return { top: fmt(due, { month: 'short', day: 'numeric' }), bottom: t, late: false };
}

function toneOf(item: WorkItem): StageTone {
  if (isRevisionStage(item.work_stage)) return 'revision';
  if (isWaitingStage(item.work_stage))  return 'waiting';
  return normaliseStage(item.work_stage) === 'in_progress' ? 'progress' : 'todo';
}

function labelOf(item: WorkItem): string {
  if (item.context === 'academic' && item.course_code) return shortCourseCode(item.course_code);
  return item.project_name ?? item.organization_name ?? item.chip_label ?? CONTEXT_LABELS[item.context];
}

function toDigest(item: WorkItem, today: string, doneOn: string | null = null): DigestItem {
  const key = itemKey(item);
  return {
    key, href: `/workboard?item=${key}`, title: item.title,
    context: item.context, contextLabel: labelOf(item),
    stageLabel: STAGE_LABELS[item.work_stage] ?? 'To Do', stageTone: toneOf(item),
    priority: item.priority,
    subtasks: item.subtask_total > 0 ? { done: item.subtask_done, total: item.subtask_total } : null,
    estimatedHours: item.estimated_hours,
    due: dueChip(dueDateOf(item), item.deadline_time, today, isRevisionStage(item.work_stage)),
    doneOn,
  };
}

const byDueThenTime = (a: WorkItem, b: WorkItem) =>
  (dueDateOf(a) ?? '9999').localeCompare(dueDateOf(b) ?? '9999')
  || (a.deadline_time ?? '99').localeCompare(b.deadline_time ?? '99')
  || a.title.localeCompare(b.title);

export function buildWorkboardDigest(items: WorkItem[], today: string, weekStart: string): WorkboardDigest {
  const weekEnd = addDays(weekStart, 6);
  const horizon = addDays(today, 7);
  const stats = computeStats(items, today, weekStart);
  const load = computeWorkloadChart(items, weekStart);

  const ranked = rankUpNext(items, today);
  const shown = new Set(ranked.map(itemKey));
  const topUp = items
    .filter(i => i.work_status !== 'done' && !shown.has(itemKey(i)))
    .filter(i => { const d = dueDateOf(i); return d !== null && d <= horizon; })
    .sort(byDueThenTime);
  const upNext = [...ranked, ...topUp].slice(0, UP_NEXT_LIMIT).map(i => toDigest(i, today));
  const inUpNext = new Set(upNext.map(i => i.key));

  const later = items
    .filter(i => i.work_status !== 'done' && !inUpNext.has(itemKey(i)))
    .filter(i => { const d = dueDateOf(i); return d === null || d > horizon; })
    .sort(byDueThenTime)
    .slice(0, FILL_LIMIT)
    .map(i => toDigest(i, today));

  const completedThisWeek = (i: WorkItem) => {
    const c = i.completed_at?.slice(0, 10);
    return c !== undefined && c >= weekStart && c <= weekEnd;
  };
  const doneRecent = items
    .filter(completedThisWeek)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
    .slice(0, FILL_LIMIT)
    .map(i => toDigest(i, today, fmt(i.completed_at!.slice(0, 10), { weekday: 'short' })));

  const afterWeek = items
    .filter(i => i.work_status !== 'done')
    .map(dueDateOf)
    .filter((d): d is string => d !== null && d > weekEnd)
    .sort();
  const nextDueAfterWeek = afterWeek.length ? fmt(afterWeek[0], { month: 'short', day: 'numeric' }) : null;

  const week: DigestDay[] = load.map(day => ({
    date: day.date,
    counts: { academic: day.academic, project: day.project, organization: day.organization, life: day.life },
    total: day.total,
    items: items
      .filter(i => i.work_status !== 'done' && dueDateOf(i) === day.date)
      .sort(byDueThenTime)
      .slice(0, UP_NEXT_LIMIT)
      .map(i => toDigest(i, today)),
  }));

  const dueThisWeek = load.reduce((s, d) => s + d.total, 0);
  const doneThisWeek = items.filter(completedThisWeek).length;

  return {
    hasAnyItems: items.length > 0,
    overdue: stats.overdue_count, inProgress: stats.in_progress_count,
    dueThisWeek, doneThisWeek, totalThisWeek: dueThisWeek + doneThisWeek,
    upNext, later, doneRecent, nextDueAfterWeek, week,
  };
}
