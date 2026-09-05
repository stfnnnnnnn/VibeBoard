import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export interface ClassOccurrence {
  block_id:         number;
  user_subject_id:  number | null;
  course_code:      string;
  subject_name:     string | null;
  section:          string | null;
  date:             string;   // "YYYY-MM-DD"
  start_time:       string;   // "HH:MM"
  end_time:         string;   // "HH:MM"
  venue:            string | null;
  is_online:        boolean;
  override:         { modality: 'online' | 'cancelled' | null; note: string | null } | null;
}

export interface DeadlineItem {
  source_table:     'activities' | 'quizzes' | 'exams' | 'grade_entries';
  entry_id:         number;
  user_subject_id:  number;
  subject_name:     string | null;
  course_code:      string | null;
  name:             string;
  deadline:         string;   // "YYYY-MM-DD"
}

export interface WorkboardEventItem {
  id:               number;
  user_subject_id:  number | null;
  subject_name:     string | null;
  item_type:        'event' | 'reminder';
  title:            string;
  location:         string | null;
  starts_at:        string | null;   // "YYYY-MM-DD HH:MM:SS"
  ends_at:          string | null;
  remind_at:        string | null;
  note:             string | null;
}

export interface ConflictWarning {
  type:         'overlap' | 'deadline_cluster';
  date:         string;
  message:      string;
  item_labels:  string[];
}

export type LoadLevel = 'low' | 'medium' | 'high';

export interface DayLoad {
  date:            string;
  score:           number;
  level:           LoadLevel;
  class_hours:     number;
  deadline_count:  number;
  event_count:     number;
}

export interface WorkboardWeek {
  week_start:         string;
  class_occurrences:  ClassOccurrence[];
  deadlines:          DeadlineItem[];
  events:             WorkboardEventItem[];
  reminders:          WorkboardEventItem[];
  conflicts:          ConflictWarning[];
  heatmap:            DayLoad[];
}

/** Monday of the calendar week containing `date`, as "YYYY-MM-DD", computed in UTC so the
 *  result doesn't depend on the server's local timezone (same reasoning as toMysqlUtc in
 *  src/lib/canvas/normalize.ts). */
export function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function detectConflicts(
  classOccurrences: ClassOccurrence[], events: WorkboardEventItem[],
): ConflictWarning[] {
  const byDate = new Map<string, { label: string; start: number; end: number }[]>();

  for (const c of classOccurrences) {
    if (c.override?.modality === 'cancelled') continue;
    const list = byDate.get(c.date) ?? [];
    list.push({ label: `${c.course_code} class`, start: timeToMinutes(c.start_time), end: timeToMinutes(c.end_time) });
    byDate.set(c.date, list);
  }

  for (const e of events) {
    if (e.item_type !== 'event' || !e.starts_at || !e.ends_at) continue;
    const date = e.starts_at.slice(0, 10);
    const start = timeToMinutes(e.starts_at.slice(11, 16));
    const end = timeToMinutes(e.ends_at.slice(11, 16));
    const list = byDate.get(date) ?? [];
    list.push({ label: e.title, start, end });
    byDate.set(date, list);
  }

  const conflicts: ConflictWarning[] = [];
  for (const [date, items] of byDate) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (rangesOverlap(items[i].start, items[i].end, items[j].start, items[j].end)) {
          conflicts.push({
            type: 'overlap',
            date,
            message: `${items[i].label} overlaps ${items[j].label}`,
            item_labels: [items[i].label, items[j].label],
          });
        }
      }
    }
  }
  return conflicts;
}

/** 3+ deadlines on the same calendar day is a cluster (deadline is DATE-only in this schema —
 *  there's no time-of-day to narrow the window further). */
export function detectDeadlineClusters(deadlines: DeadlineItem[]): ConflictWarning[] {
  const byDate = new Map<string, DeadlineItem[]>();
  for (const d of deadlines) {
    const list = byDate.get(d.deadline) ?? [];
    list.push(d);
    byDate.set(d.deadline, list);
  }

  const clusters: ConflictWarning[] = [];
  for (const [date, items] of byDate) {
    if (items.length >= 3) {
      clusters.push({
        type: 'deadline_cluster',
        date,
        message: `${items.length} deadlines due on this day`,
        item_labels: items.map(i => i.name),
      });
    }
  }
  return clusters;
}

/** v1 heuristic, deliberately simple and easy to retune later:
 *  load = class hours + deadlines * 1.5 + events. Bucketed into low/medium/high. */
export function computeHeatmap(
  weekStart: string,
  classOccurrences: ClassOccurrence[],
  deadlines: DeadlineItem[],
  events: WorkboardEventItem[],
): DayLoad[] {
  const days: DayLoad[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);

    const classesOnDay = classOccurrences.filter(c => c.date === date && c.override?.modality !== 'cancelled');
    const classHours = classesOnDay.reduce(
      (sum, c) => sum + (timeToMinutes(c.end_time) - timeToMinutes(c.start_time)) / 60, 0,
    );
    const deadlineCount = deadlines.filter(d => d.deadline === date).length;
    const eventCount = events.filter(e => e.item_type === 'event' && e.starts_at?.slice(0, 10) === date).length;

    const score = classHours + deadlineCount * 1.5 + eventCount;
    const level: LoadLevel = score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low';

    days.push({ date, score, level, class_hours: classHours, deadline_count: deadlineCount, event_count: eventCount });
  }
  return days;
}
