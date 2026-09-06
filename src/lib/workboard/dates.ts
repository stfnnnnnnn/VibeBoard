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

/** The calendar date portion of an item's due timestamp, or null when undated.
 *  Takes a structural `{ due_at }` shape rather than importing `WorkItem` from
 *  `workItems.ts`, so this module never has a reason to import that file (which
 *  would reintroduce the exact `pool` transitivity problem this module exists to
 *  avoid). `WorkItem` satisfies this shape today and any future item source will
 *  too, since every Workboard item carries a `due_at`. */
export function dueDateOf(item: { due_at: string | null }): string | null {
  return item.due_at ? item.due_at.slice(0, 10) : null;
}
