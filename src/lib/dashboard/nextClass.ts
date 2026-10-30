/** Today strip "Next class" (spec §4.1, §5.2). Pool-free; fed by getWorkboardWeek's occurrences,
 *  which already carry cancellations and make-up reschedules. */
import type { ClassOccurrence } from '@/lib/workboard/aggregate';

export interface NextClass {
  courseCode: string;
  date:       string;   // "YYYY-MM-DD"
  startTime:  string;   // "HH:MM"
  timeLabel:  string;   // "1 PM"
  when:       string;   // "now" | "today" | "tomorrow" | "Mon"
  place:      string | null;
}

export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

function isLive(o: ClassOccurrence, today: string, now: string): boolean {
  const m = o.override?.modality;
  if (m === 'cancelled') return false;
  if (m === 'rescheduled' && !o.moved_from) return false;   // the moved-away original slot
  return o.date > today || (o.date === today && o.end_time > now);
}

function placeOf(o: ClassOccurrence): string | null {
  const m = o.override?.modality;
  if (m === 'online_sync' || m === 'online_async') return 'Online';
  if (!m && o.modality !== 'face_to_face') return 'Online';
  return o.override?.room ?? o.venue;
}

export function pickNextClass(occ: ClassOccurrence[], today: string, nowHHMM: string): NextClass | null {
  const next = occ
    .filter(o => isLive(o, today, nowHHMM))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time))[0];
  if (!next) return null;
  const when = next.date === today
    ? (next.start_time <= nowHHMM ? 'now' : 'today')
    : next.date === nextDay(today)
      ? 'tomorrow'
      : new Date(`${next.date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return {
    courseCode: next.course_code, date: next.date, startTime: next.start_time,
    timeLabel: timeLabel(next.start_time), when, place: placeOf(next),
  };
}
