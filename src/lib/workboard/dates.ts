/**
 * Pure date-string helpers shared across Workboard's server and client code.
 *
 * Deliberately kept in their own module with zero imports — in particular, no
 * `@/lib/db` — so client components (`WorkItemRow.tsx`, and anything `workStats.ts`
 * feeds) can import them without dragging `pool`/mysql2 into the browser bundle.
 * `aggregate.ts` and `workItems.ts` both import `pool` at module scope for their
 * (unrelated) DB-access exports; a 'use client' file that imported `addDays` or
 * `dueDateOf` from either of those previously broke `/workboard`'s client bundle
 * (Turbopack: "Module not found: Can't resolve 'net'"). See Task 11's report for
 * the incident — this module is the fix, replacing three duplicated copies of
 * these two functions with one shared source of truth.
 *
 * All dates here are "YYYY-MM-DD" strings, computed in UTC so results don't
 * depend on the server process's local timezone — same convention as
 * `todayInManilaAsUtcDate()`/`mondayOf()` in `aggregate.ts`, which callers still
 * reach for the actual "what is today" question. This module only ever answers
 * "N days from this date string" and "what date does this item fall on" — it has
 * no opinion on what "today" is.
 */

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday ("YYYY-MM-DD") of the ISO week containing `dateStr`, computed in UTC — same
 *  convention as `addDays`, and the same Monday-start `aggregate.ts`'s own (pool-importing,
 *  so unreachable from a client bundle) `mondayOf()` uses for the whole-board week. Kept here,
 *  pool-free, so a client component (`WorkTimelineView.tsx`'s "Today" jump) can compute the
 *  Monday of an arbitrary date — usually `today` — without reaching into that module. */
export function mondayOf(dateStr: string): string {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return addDays(dateStr, day === 0 ? -6 : 1 - day);
}

/** Current instant's wall-clock reading in Asia/Manila, as "YYYY-MM-DD HH:MM:SS" for a
 *  DATETIME column. Every consumer of `workboard_work_items.completed_at`
 *  (`workStats.ts`'s `completed7d`, `workItems.ts`'s 14-day retention cutoff) does
 *  `completed_at.slice(0, 10)` and compares that against a Manila calendar date, so the
 *  stamped value must already be a Manila date — `new Date().toISOString()` would stamp the
 *  UTC instant instead, which reads one day early during the ~8-hour Manila-midnight window
 *  (UTC 16:00-24:00). Same convention as `academicWrites.ts`'s `todayManilaDateString()`, just
 *  carrying a time-of-day too since this column is DATETIME rather than DATE. */
export function manilaNowDatetime(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  // Some Intl implementations render midnight as hour "24" under hour12:false — normalize it.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

/** The calendar date portion of an item's due timestamp, or null when undated.
 *  Takes a structural `{ due_at }` shape rather than importing `WorkItem` from
 *  `workItems.ts`, so this module never has a reason to import that file (which
 *  would reintroduce the exact `pool` transitivity problem this module exists to
 *  avoid). `WorkItem` satisfies this shape today and any future item source will
 *  too, since every Workboard item carries a `due_at`. */
export function dueDateOf(item: { due_at: string | null }): string | null {
  return item.due_at ? item.due_at.slice(0, 10) : null;
}

/** The wire format for a deadline time: "HH:MM" or "HH:MM:SS". Shared by the work-items
 *  POST and PATCH so the two routes cannot drift on what they accept. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** Normalises a wire deadline time to the "HH:MM:SS" shape a TIME column round-trips, so
 *  a value stored from the short form and one stored from the long form read back the
 *  same. Returns null for anything the pattern does not accept — the seconds come from
 *  the match itself rather than from the input's length, so this stays correct even if a
 *  caller ever runs it before its validation guard. */
export function normaliseDeadlineTime(value: string): string | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}
