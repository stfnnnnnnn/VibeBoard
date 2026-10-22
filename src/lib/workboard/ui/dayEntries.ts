/** Pure day-agenda helpers shared by Timeline's week grid and its day panel. Pool-free:
 *  type-only imports from the server modules. */
import type { WorkItem } from '@/lib/workboard/workItems';
import type { ClassOccurrence, WorkboardEventItem } from '@/lib/workboard/aggregate';

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** A class that does not actually meet on this date (cancelled, or moved elsewhere). */
export function isSkippedClass(c: ClassOccurrence): boolean {
  if (c.override?.modality === 'cancelled') return true;
  return c.moved_from === undefined && c.override?.modality === 'rescheduled';
}

/** "YYYY-MM-DD HH:MM:SS" -> minutes since midnight. */
export function minutesOfDateTime(dt: string): number {
  return toMinutes(dt.slice(11, 16));
}

/** The time an event or reminder sits at on `date`, or null when it has none there. */
export function eventStart(e: WorkboardEventItem, date: string): number | null {
  if (e.starts_at !== null && e.starts_at.slice(0, 10) === date) return minutesOfDateTime(e.starts_at);
  if (e.item_type === 'reminder' && e.remind_at !== null && e.remind_at.slice(0, 10) === date) return minutesOfDateTime(e.remind_at);
  return null;
}

export type DayEntry =
  | { kind: 'class'; c: ClassOccurrence; start: number }
  | { kind: 'event'; e: WorkboardEventItem; start: number | null }
  | { kind: 'item'; item: WorkItem; start: number | null };

const KIND_RANK: Record<DayEntry['kind'], number> = { class: 0, event: 1, item: 2 };

/** One time-ordered list for a day: classes, events, then due items at equal times; untimed last. */
export function buildDayEntries(
  date: string, classes: ClassOccurrence[], events: WorkboardEventItem[], items: WorkItem[],
): DayEntry[] {
  const entries: DayEntry[] = [
    ...classes.map(c => ({ kind: 'class' as const, c, start: toMinutes(c.start_time) })),
    ...events.map(e => ({ kind: 'event' as const, e, start: eventStart(e, date) })),
    ...items.map(item => ({ kind: 'item' as const, item, start: item.deadline_time ? toMinutes(item.deadline_time) : null })),
  ];
  return entries.sort((a, b) => {
    if (a.start === null || b.start === null) {
      if (a.start === b.start) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
      return a.start === null ? 1 : -1;
    }
    return a.start - b.start || KIND_RANK[a.kind] - KIND_RANK[b.kind];
  });
}

/** Where the now marker goes: before the first entry starting at or after `now`, otherwise after
 *  the last timed entry (untimed entries are not placed in time, so they stay below it). */
export function nowSlot(entries: DayEntry[], now: number): number {
  const next = entries.findIndex(en => en.start !== null && en.start >= now);
  if (next !== -1) return next;
  const firstUntimed = entries.findIndex(en => en.start === null);
  return firstUntimed === -1 ? entries.length : firstUntimed;
}

export function entryKey(en: DayEntry): string {
  if (en.kind === 'class') return `c${en.c.block_id}-${en.c.moved_from ?? 'orig'}`;
  if (en.kind === 'event') return `e${en.e.id}`;
  return `i${en.item.source}-${en.item.id}`;
}
