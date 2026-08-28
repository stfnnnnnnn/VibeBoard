// Pure date-string helpers for the Habit Tracker. All arithmetic works on
// plain 'YYYY-MM-DD' strings via UTC construction so it's stable regardless
// of the server's local timezone. Only `todayInManila()` reaches for a real
// clock, matching the legacy PHP module's `Asia/Manila` timezone pin.

export const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;
export type Weekday = typeof WEEKDAYS[number];

const TZ = 'Asia/Manila';

export function todayInManila(): { dateStr: string; weekday: Weekday } {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'long',
  }).format(now) as Weekday;
  return { dateStr, weekday };
}

export function addDaysToDateStr(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function weekdayOfDateStr(dateStr: string): Weekday {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Last N calendar days ending at (and including) `endDateStr`, oldest first. */
export function lastNDays(endDateStr: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDaysToDateStr(endDateStr, -i));
  return out;
}

/**
 * Walks backward day-by-day from `asOfDateStr` (inclusive) counting a
 * consecutive run of *scheduled* days that were completed. Non-scheduled
 * days are skipped without breaking the run; a scheduled-but-not-completed
 * day ends it. This fixes the legacy PHP bug where a habit scheduled
 * Mon/Wed/Fri checked in on both days would read as a broken streak
 * because Wed isn't literally "Mon + 1 calendar day" — the run is measured
 * in scheduled occurrences, not calendar days.
 */
export function computeConsecutiveScheduledStreak(
  scheduledWeekdays: ReadonlySet<Weekday>,
  completedDates: ReadonlySet<string>,
  asOfDateStr: string,
): { length: number; start: string | null } {
  let length = 0;
  let start: string | null = null;
  let cursor = asOfDateStr;
  const CAP = 3650; // ~10 years safety bound

  for (let i = 0; i < CAP; i++) {
    const wd = weekdayOfDateStr(cursor);
    if (scheduledWeekdays.has(wd)) {
      if (completedDates.has(cursor)) {
        length++;
        start = cursor;
        cursor = addDaysToDateStr(cursor, -1);
        continue;
      }
      break; // scheduled day, not completed -> the run ends here
    }
    cursor = addDaysToDateStr(cursor, -1); // unscheduled day, doesn't break the run
  }

  return { length, start };
}

export const URGENCY_RANK: Record<string, number> = {
  'Urgent': 5, 'Priority': 4, 'Important': 3, 'Not Important': 2, 'Not Urgent': 1,
};
