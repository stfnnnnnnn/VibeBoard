/** Header date line (spec §5.1). Pool-free. All dates are "YYYY-MM-DD" Manila calendar days. */

export function manilaClock(now: Date = new Date()): { date: string; hour: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), hhmm: `${get('hour')}:${get('minute')}` };
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** 1-based week of the term; null before the start, after the end, or with no start date. */
export function weekOfTerm(start: string | null, end: string | null, today: string): number | null {
  if (!start || today < start || (end && today > end)) return null;
  return Math.floor((dayMs(today) - dayMs(start)) / 86_400_000 / 7) + 1;
}

/** "Friday, Oct 30 · Week 7 · Good afternoon". */
export function dateLine(today: string, hour: number, week: number | null): string {
  const label = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  return [label, week ? `Week ${week}` : null, greetingFor(hour)].filter(Boolean).join(' · ');
}
