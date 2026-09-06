import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { addDays } from '@/lib/workboard/dates';

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

/** Today's calendar date in Asia/Manila (the app's timezone convention — see
 *  src/lib/db.ts's `timezone: '+08:00'` connection pin and src/lib/habitDate.ts's
 *  `todayInManila()`), as a Date anchored at midnight UTC so it can be fed straight
 *  into `mondayOf` without local-timezone drift. Using `new Date()` directly here
 *  would read the server process's own (possibly UTC) calendar date, which during
 *  the ~midnight-8AM Manila window is still "yesterday" and would silently show
 *  last week's board. */
export function todayInManilaAsUtcDate(): Date {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return new Date(`${dateStr}T00:00:00Z`);
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

export async function getWorkboardWeek(userId: number, weekStart: string): Promise<WorkboardWeek> {
  const weekEnd = addDays(weekStart, 6);

  const [blockRows] = await pool.execute<RowDataPacket[]>(
    `SELECT sb.block_id, sb.user_subject_id, sb.course_code, sb.section,
            sb.day_of_week, sb.start_time, sb.end_time, sb.venue, sb.is_online,
            s.subject_name
     FROM schedule_blocks sb
     LEFT JOIN user_subjects us ON sb.user_subject_id = us.user_subject_id
     LEFT JOIN subjects s ON us.subject_id = s.subject_id
     WHERE sb.user_id = ?`,
    [userId],
  );

  const [overrideRows] = await pool.execute<RowDataPacket[]>(
    `SELECT so.block_id, so.override_date, so.modality, so.note
     FROM schedule_overrides so
     JOIN schedule_blocks sb ON sb.block_id = so.block_id
     WHERE sb.user_id = ? AND so.override_date BETWEEN ? AND ?`,
    [userId, weekStart, weekEnd],
  );
  const overrideByKey = new Map<string, RowDataPacket>();
  for (const o of overrideRows) {
    overrideByKey.set(`${o.block_id}:${String(o.override_date).slice(0, 10)}`, o);
  }

  const classOccurrences: ClassOccurrence[] = [];
  for (const b of blockRows) {
    const dow = b.day_of_week as number;
    if (dow == null || dow < 0 || dow > 5) continue; // schedule_blocks only ever populates Mon(0)..Sat(5)
    const date = addDays(weekStart, dow);
    const override = overrideByKey.get(`${b.block_id}:${date}`);
    classOccurrences.push({
      block_id: b.block_id, user_subject_id: b.user_subject_id, course_code: b.course_code,
      subject_name: b.subject_name, section: b.section, date,
      start_time: String(b.start_time).slice(0, 5), end_time: String(b.end_time).slice(0, 5),
      venue: b.venue, is_online: Boolean(b.is_online),
      override: override ? { modality: override.modality, note: override.note } : null,
    });
  }

  async function deadlineQuery(table: string, idCol: string, nameCol: string): Promise<RowDataPacket[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT t.\`${idCol}\` AS entry_id, t.user_subject_id, t.\`${nameCol}\` AS name, t.deadline,
              s.subject_name, s.course_code
       FROM \`${table}\` t
       JOIN user_subjects us ON t.user_subject_id = us.user_subject_id
       JOIN subjects s ON us.subject_id = s.subject_id
       WHERE us.user_id = ? AND t.status != 'Done' AND t.deadline BETWEEN ? AND ?`,
      [userId, weekStart, weekEnd],
    );
    return rows;
  }

  const [actRows, quizRows, examRows, geRows] = await Promise.all([
    deadlineQuery('activities', 'activity_id', 'activity_name'),
    deadlineQuery('quizzes', 'quiz_id', 'quiz_name'),
    deadlineQuery('exams', 'exam_id', 'exam_name'),
    deadlineQuery('grade_entries', 'entry_id', 'name'),
  ]);
  const deadlines: DeadlineItem[] = [
    ...actRows.map(r => ({ source_table: 'activities' as const, entry_id: r.entry_id, user_subject_id: r.user_subject_id, subject_name: r.subject_name, course_code: r.course_code, name: r.name, deadline: String(r.deadline).slice(0, 10) })),
    ...quizRows.map(r => ({ source_table: 'quizzes' as const, entry_id: r.entry_id, user_subject_id: r.user_subject_id, subject_name: r.subject_name, course_code: r.course_code, name: r.name, deadline: String(r.deadline).slice(0, 10) })),
    ...examRows.map(r => ({ source_table: 'exams' as const, entry_id: r.entry_id, user_subject_id: r.user_subject_id, subject_name: r.subject_name, course_code: r.course_code, name: r.name, deadline: String(r.deadline).slice(0, 10) })),
    ...geRows.map(r => ({ source_table: 'grade_entries' as const, entry_id: r.entry_id, user_subject_id: r.user_subject_id, subject_name: r.subject_name, course_code: r.course_code, name: r.name, deadline: String(r.deadline).slice(0, 10) })),
  ];

  const [itemRows] = await pool.execute<RowDataPacket[]>(
    `SELECT wi.id, wi.user_subject_id, wi.item_type, wi.title, wi.location,
            wi.starts_at, wi.ends_at, wi.remind_at, wi.note, s.subject_name
     FROM workboard_items wi
     LEFT JOIN user_subjects us ON wi.user_subject_id = us.user_subject_id
     LEFT JOIN subjects s ON us.subject_id = s.subject_id
     WHERE wi.user_id = ? AND wi.status = 'active'
       AND (
         (wi.item_type = 'event' AND DATE(wi.starts_at) BETWEEN ? AND ?)
         OR (wi.item_type = 'reminder' AND (wi.remind_at IS NULL OR DATE(wi.remind_at) BETWEEN ? AND ?))
       )`,
    [userId, weekStart, weekEnd, weekStart, weekEnd],
  );
  const allItems: WorkboardEventItem[] = itemRows.map(r => ({
    id: r.id, user_subject_id: r.user_subject_id, subject_name: r.subject_name, item_type: r.item_type,
    title: r.title, location: r.location, starts_at: r.starts_at, ends_at: r.ends_at,
    remind_at: r.remind_at, note: r.note,
  }));
  const events = allItems.filter(i => i.item_type === 'event');
  const reminders = allItems.filter(i => i.item_type === 'reminder');

  const conflicts = [...detectConflicts(classOccurrences, events), ...detectDeadlineClusters(deadlines)];
  const heatmap = computeHeatmap(weekStart, classOccurrences, deadlines, events);

  return { week_start: weekStart, class_occurrences: classOccurrences, deadlines, events, reminders, conflicts, heatmap };
}
