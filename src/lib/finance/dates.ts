// src/lib/finance/dates.ts
/* Calendar dates as 'YYYY-MM-DD' strings. All arithmetic runs in UTC on the string's own
   date, so the server's timezone can never shift a day (plan ruling R3). "Today" is the
   Asia/Manila calendar date (spec §4.4). */
const DAY_MS = 86_400_000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/* Milliseconds from `now` until the next Asia/Manila midnight. Manila is a fixed UTC+8 (no
   DST), so its midnight is 16:00 UTC. Exactly at midnight this returns a full day. */
const MANILA_OFFSET_MS = 8 * 3_600_000;
export function msUntilNextManilaMidnight(now: Date = new Date()): number {
  const into = (((now.getTime() + MANILA_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return DAY_MS - into;
}

export function addDays(date: string, n: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function addMonthsClamped(date: string, n: number): string {
  const d = utc(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return iso(target);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / DAY_MS);
}

export function mondayOf(date: string): string {
  const dow = utc(date).getUTCDay(); // 0=Sun..6=Sat
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const d = utc(date);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  utc(date).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

/* With a reference date in a different year, the year is appended ("Wed, Aug 20, 2025"). */
export function formatWeekdayDate(date: string, reference?: string): string {
  const withYear = reference !== undefined && reference.slice(0, 4) !== date.slice(0, 4);
  return fmt(date, withYear ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDay(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return formatWeekdayDate(date, today);
}

export function formatShortDate(date: string): string {
  return fmt(date, { month: 'short', day: 'numeric' });
}

export function formatFullDate(date: string): string {
  return fmt(date, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatMonthYear(date: string): string {
  return fmt(date, { month: 'short', year: 'numeric' });
}

export function formatLongDate(date: string): string {
  return fmt(date, { weekday: 'long', month: 'short', day: 'numeric' });
}
