'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarRange, SearchX, ChevronLeft, ChevronRight, AlertTriangle, Bell, Clock, MapPin, Link2,
  CalendarClock, X,
} from 'lucide-react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope
// for its DB-access exports, so a runtime import here would drag mysql2 into this client
// bundle (see WorkboardShell.tsx's, WorkItemRow.tsx's, and WorkBoardView.tsx's comments on the
// same hazard — it has broken `/workboard` twice already).
import type { WorkItem } from '@/lib/workboard/workItems';
import type { WorkCategory } from '@/lib/workboard/workCategories';
// The canonical module. Pool-free by construction.
import type { WorkContext } from '@/lib/workboard/workContexts';
// Type-only, from the same module `getWorkboardWeek` and `WorkboardShell.tsx`'s own
// `WorkboardWeek` import already use — `aggregate.ts` reaches `pool` at module scope for its
// *value* exports, but `import type` is erased entirely, so none of that reaches this client
// bundle. The one canonical source for these four shapes, not a locally re-typed guess at them.
import type { ClassOccurrence, WorkboardEventItem, ConflictWarning, DayLoad } from '@/lib/workboard/aggregate';
import { addDays, dueDateOf, mondayOf, validateOverrideModality, type OverrideModality } from '@/lib/workboard/dates';
import { dueStateOf, formatDeadlineTime } from '@/lib/workboard/dueSemantics';
// Pool-free (see that module's own header) — the shared raw/darkened course-hue pair, already
// used by `WorkboardWeekView.tsx` for the identical class-block rendering this file now folds
// in. Reused rather than re-derived so a course's colour agrees everywhere it appears.
import { courseColor, courseTextColor } from '@/lib/workboard/color';
// The Table's one failure surface, reused here (LinksPopover does the same from outside the
// `table/` folder) rather than a second copy of "how a popover reports a failed write".
import { reportTableCellError } from '../table/tableCellError';

const FONT    = "'Inter','DM Sans','Segoe UI',sans-serif";
const DM_FONT = "'DM Sans','Segoe UI',sans-serif";

const WINDOW_DAYS = 7;
const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const EDGE_COLOR: Record<WorkItem['priority'], string> = {
  high:   '#e0607c',
  normal: '#b8c6da',
  low:    '#d3dbe6',
};

/** Raw context hues (§2a) — non-text decoration only (the dot on each card's context tag). */
const CATEGORY_HUE: Record<WorkCategory, string> = {
  academic:     '#4dabf5',
  project:      '#8b7fd6',
  organization: '#f0a35c',
  life:         '#f2a7c0',
};
/** Darkened, text-safe pair to each raw hue above (§2a/§16a) — the tag's actual text colour. */
const CATEGORY_TEXT: Record<WorkCategory, string> = {
  academic:     '#185a7d',
  project:      '#4f3fa0',
  organization: '#8a5010',
  life:         '#8a4468',
};

const LEVEL_COLOR: Record<DayLoad['level'], string> = { low: '#74bcd9', medium: '#f2a7c0', high: '#e0607c' };

/** Display text for a non-null, non-'rescheduled' `OverrideModality` — 'rescheduled' is excluded
 *  from the type on purpose (it never reaches `ClassCard`'s suffix line: a ghost replaces the
 *  whole line with the moved-to slot instead, and a make-up's own "From <date>" tag already
 *  says so). One shared map so the popover's `<select>` labels and the card's suffix can never
 *  read differently for the same value. */
const MODALITY_LABEL: Record<Exclude<OverrideModality, 'rescheduled' | null>, string> = {
  online_sync:  'online (sync)',
  online_async: 'online (async)',
  cancelled:    'cancelled',
};

/** `'all'` is the shell's My Work tab — every context at once. Mirrors `WorkBoardView`'s
 *  `BoardContext` and `WorkTableView`'s `TableContext`, and takes the same value from the
 *  same shell state. */
export type TimelineContext = WorkContext | 'all';

function itemKey(item: Pick<WorkItem, 'source' | 'id'>): string {
  return `${item.source}-${item.id}`;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** "Sat 9/19" — compact enough for a ghost/make-up card's one extra line. UTC-parsed to match
 *  this module's other date handling (`dayIndexOf`, the day-header labels). */
function formatShortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC',
  });
}

function formatTimeRange(start: string, end: string): string {
  const fmt = (hhmm: string) => {
    const mins = toMinutes(hhmm);
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(m).padStart(2, '0')}${h24 < 12 ? 'am' : 'pm'}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}

type PlottedBar    = { kind: 'bar';    item: WorkItem; startIdx: number; endIdx: number };
type PlottedMarker = { kind: 'marker'; item: WorkItem; dayIdx: number };
type Plotted       = PlottedBar | PlottedMarker;

interface AnchorRect { left: number; right: number; top: number; bottom: number }

/**
 * The plotting rule, restated as code:
 *  - both `start_date` and a due date, spanning MORE than one day -> a bar (rendered above the
 *    day columns, since a single day's card stack has no way to show "this spans three days").
 *  - both dates on the SAME day, or only a due date               -> a marker (a card in that
 *    day's own column — a one-day "bar" reads more naturally as a card than as a sliver of Gantt
 *    bar one column wide).
 *  - neither                                                       -> does not appear.
 *
 * Items whose relevant date(s) fall outside the one-week window are clipped out entirely
 * (return null) rather than clamped to day 0 or day 6 — a bar pinned to the boundary would
 * misrepresent when the work actually happens, which is a correctness requirement carried over
 * unchanged from this view's original four-week design.
 */
function plot(item: WorkItem, weekStart: string): Plotted | null {
  const due = dueDateOf(item);
  if (due === null) return null;

  const dueIdx = dayIndexOf(weekStart, due);

  if (item.start_date !== null && item.start_date !== due) {
    const startIdx = dayIndexOf(weekStart, item.start_date);
    if (startIdx < 0 || startIdx > WINDOW_DAYS - 1 || dueIdx < 0 || dueIdx > WINDOW_DAYS - 1) return null;
    return { kind: 'bar', item, startIdx, endIdx: dueIdx };
  }

  if (dueIdx < 0 || dueIdx > WINDOW_DAYS - 1) return null;
  return { kind: 'marker', item, dayIdx: dueIdx };
}

/** Number of whole days between `weekStart` and `date` (both "YYYY-MM-DD"). Computed in UTC,
 *  matching `dates.ts`'s convention, so this never depends on the server process's timezone. */
function dayIndexOf(weekStart: string, date: string): number {
  const start  = new Date(`${weekStart}T00:00:00Z`).getTime();
  const target = new Date(`${date}T00:00:00Z`).getTime();
  return Math.round((target - start) / 86_400_000);
}

export interface WorkTimelineViewProps {
  /** Already filtered by category, search, and the Filters popover — see `WorkboardShell`'s
   *  `visibleItems`. */
  items:     WorkItem[];
  /** "YYYY-MM-DD" Monday — the week currently on screen. Independent of the whole-board
   *  `work.week_start` the stat cards use: this one moves as the user navigates weeks here,
   *  which must never perturb a number describing the whole board. */
  weekStart: string;
  /** "YYYY-MM-DD" — `work.generated_at`, used to place the today marker. */
  today:     string;
  /** True when the shell's category tab, search query, or a popover filter is currently
   *  narrowing `items` — same distinction `WorkListView`/`WorkBoardView` make, so a
   *  filtered-to-nothing timeline reads as "no matches" rather than wrongly telling the user
   *  their dated items lack dates. */
  isFiltered?: boolean;
  /** The same value `visibleItems` is filtered by — `'all'` under My Work, one context under a
   *  tab. Deliberately REQUIRED, not optional — see `WorkBoardView`'s own history for why an
   *  optional context prop is a hazard `tsc` cannot catch. */
  context: TimelineContext;
  /** This week's class schedule, from `/api/workboard/week` (Calendar's merged data). */
  classOccurrences: ClassOccurrence[];
  /** Server-computed schedule conflicts and deadline clusters for this week. */
  conflicts: ConflictWarning[];
  /** Per-day workload score for this week's heatmap dot. */
  heatmap: DayLoad[];
  /** Workboard-owned events and reminders for this week. */
  events: WorkboardEventItem[];
  /** Requests a different week's Calendar data (class occurrences/conflicts/heatmap/events) —
   *  the parent owns the fetch, since it also owns `weekStart`. */
  onWeekChange: (weekStart: string) => void;
  /** True while a requested week's Calendar data is in flight — disables the nav buttons so a
   *  second click cannot race the first. */
  weekLoading?: boolean;
  /** Opens `WorkboardEventDialog` in edit mode for an existing event/reminder — the shell owns
   *  that dialog's state (it's reachable from the same "New Work Item" flow that creates one),
   *  so this view only ever asks for it to open, the same relationship `onOpenDetail` has with
   *  the work-item detail drawer elsewhere in Workboard. */
  onEditEvent: (item: WorkboardEventItem) => void;
}

export default function WorkTimelineView({
  items, weekStart, today, isFiltered, context,
  classOccurrences, conflicts, heatmap, events, onWeekChange, weekLoading, onEditEvent,
}: WorkTimelineViewProps) {
  // The day currently expanded, or `null` when the week is showing evenly. Cleared whenever the
  // visible week changes (a focused day from last week means nothing on this one).
  const [focusedDay, setFocusedDay] = useState<string | null>(null);

  const toggleFocus = (date: string) => setFocusedDay(current => (current === date ? null : date));
  const goToWeek = (nextStart: string) => { setFocusedDay(null); onWeekChange(nextStart); };

  // The single-day schedule override editor's one open slot — a class card anywhere in the
  // grid can open it, and only one can be open at a time (clicking a second closes the first,
  // the same "one open slot" shape `DeadlineCell`'s editor uses for the same reason: two
  // popovers open at once would double the dismissal logic for no benefit). `trigger` is the
  // clicked button itself, captured at open time rather than held in a ref map — unlike
  // `WorkBoardView`'s cards, a `ClassCard` is never reparented while its popover is open (only
  // a full week refetch recreates it, which this same popover's own save/delete triggers, and
  // which closes the popover in the same breath), so there is no reparenting case a stable ref
  // needs to survive.
  const [openOverride, setOpenOverride] = useState<{
    occurrence: ClassOccurrence; anchor: AnchorRect; trigger: HTMLElement;
  } | null>(null);

  // Re-fetches THIS week's data without navigating — `onWeekChange` with the week already on
  // screen still re-runs the shell's fetch (see `WorkboardShell.tsx`'s `goToWeek`), which is
  // exactly "reload what a class override changed". Deliberately not the local `goToWeek`
  // above: that one also clears `focusedDay`, and closing day-focus as a side effect of editing
  // one class within it would be a surprising thing for a save button to do.
  const refreshWeek = () => onWeekChange(weekStart);

  // Direction doc §5d's original rule, carried over: the *legitimately*-empty condition is "no
  // item has a start_date or due_at" at all, not "nothing plots in this particular week" — a
  // fully-dated backlog with nothing due this week is a different, unremarkable situation the
  // grid can render as-is (an ordinary empty week, not this module's own empty state).
  const hasAnyDate = items.some(item => item.start_date !== null || item.due_at !== null);

  if (!hasAnyDate && isFiltered) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <SearchX size={48} color="#9aa4b5" style={{ marginBottom: '14px' }} />
        <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
          No matching work items
        </h2>
        <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: 0 }}>
          Try a different category, search term, or filter.
        </p>
      </div>
    );
  }

  if (!hasAnyDate) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <CalendarRange size={48} color="#9aa4b5" style={{ marginBottom: '14px' }} />
        <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
          Nothing scheduled yet
        </h2>
        <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: 0 }}>
          Timeline needs a due date or start date to plot something — add one from the Focus view.
        </p>
      </div>
    );
  }

  const dayDates = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(weekStart, i));
  const weekEnd  = dayDates[WINDOW_DAYS - 1];
  // Compared against `weekStart` to grey out "Today" once it's already the visible week — a
  // week can be reached going forward OR back, so this can't just be "disable Next".
  const isCurrentWeek = weekStart === mondayOf(today);

  const plotted = items.map(item => plot(item, weekStart)).filter((p): p is Plotted => p !== null);
  const bars    = plotted.filter((p): p is PlottedBar => p.kind === 'bar');
  const markersByDay = new Map<string, PlottedMarker[]>();
  for (const p of plotted) {
    if (p.kind !== 'marker') continue;
    const date = dayDates[p.dayIdx];
    const list = markersByDay.get(date);
    if (list) list.push(p); else markersByDay.set(date, [p]);
  }

  const classesByDay = (date: string) => classOccurrences.filter(c => c.date === date)
    .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  const eventsByDay = (date: string) => events.filter(e =>
    (e.starts_at !== null && e.starts_at.slice(0, 10) === date) ||
    (e.item_type === 'reminder' && e.remind_at !== null && e.remind_at.slice(0, 10) === date));
  const conflictsByDay = (date: string) => conflicts.filter(c => c.date === date);
  const heatmapFor = (date: string) => heatmap.find(h => h.date === date) ?? null;

  return (
    <div role="region" aria-label="Timeline">
      {/* Week navigation — the same shape `WorkboardWeekView.tsx`'s Calendar page already used,
          now driving Timeline's own week window instead of a separate page's. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
        <span style={{ fontFamily: DM_FONT, fontSize: '0.95rem', fontWeight: 800, color: '#2d3748' }}>
          {weekStart} – {weekEnd}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => goToWeek(addDays(weekStart, -7))}
            disabled={weekLoading}
            aria-label="Previous week"
            className="vb-tl-nav"
            style={{
              width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '8px', border: '1px solid rgba(200,210,230,0.6)', background: 'rgba(255,255,255,0.6)',
              cursor: weekLoading ? 'default' : 'pointer', opacity: weekLoading ? 0.6 : 1,
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => goToWeek(mondayOf(today))}
            disabled={weekLoading || isCurrentWeek}
            className="vb-tl-nav"
            style={{
              height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '8px', border: '1px solid rgba(200,210,230,0.6)', background: 'rgba(255,255,255,0.6)',
              padding: '0 12px', fontFamily: FONT, fontSize: '0.76rem', fontWeight: 700, color: '#5c6b80',
              cursor: weekLoading || isCurrentWeek ? 'default' : 'pointer', opacity: weekLoading || isCurrentWeek ? 0.5 : 1,
            }}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => goToWeek(addDays(weekStart, 7))}
            disabled={weekLoading}
            aria-label="Next week"
            className="vb-tl-nav"
            style={{
              width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '8px', border: '1px solid rgba(200,210,230,0.6)', background: 'rgba(255,255,255,0.6)',
              cursor: weekLoading ? 'default' : 'pointer', opacity: weekLoading ? 0.6 : 1,
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Schedule conflicts and deadline clusters for the visible week, carried over unchanged
          from Calendar's own treatment — server-computed, so this view never re-derives them. */}
      {conflicts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
          {conflicts.map((c, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px',
              borderRadius: '10px', background: 'rgba(224,96,124,0.12)', border: '1px solid rgba(224,96,124,0.3)',
            }}>
              <AlertTriangle size={14} color="#c0607c" style={{ flexShrink: 0 }} />
              <span style={{ fontFamily: FONT, fontSize: '0.78rem', fontWeight: 700, color: '#a0405a' }}>
                {c.type === 'overlap' ? 'Schedule conflict' : 'Deadline cluster'} — {c.message} ({c.date})
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Multi-day bars — a thin Gantt-style overview spanning the day columns below. Hidden
          while a day is focused: the bars' left/width are computed as percentages assuming
          seven EQUAL-width columns (true only in the unfocused state — an enlarged focused
          column would misalign them), and a whole-week overview adds little once the user has
          zoomed into one day's detail anyway. */}
      {bars.length > 0 && focusedDay === null && (
        <div style={{ position: 'relative', height: `${Math.max(bars.length, 1) * 26}px`, marginBottom: '10px' }}>
          {stackBars(bars).map(({ bar, row }) => {
            const color = EDGE_COLOR[bar.item.priority];
            const leftPct  = (bar.startIdx / WINDOW_DAYS) * 100;
            const widthPct = ((bar.endIdx - bar.startIdx + 1) / WINDOW_DAYS) * 100;
            return (
              <div
                key={itemKey(bar.item)}
                title={bar.item.title}
                style={{
                  position: 'absolute', left: `${leftPct}%`, width: `calc(${widthPct}% - 4px)`,
                  top: `${row * 26}px`, height: '22px', borderRadius: '6px',
                  background: color, border: `1px solid ${color}`, boxSizing: 'border-box',
                  display: 'flex', alignItems: 'center', padding: '0 8px', overflow: 'hidden',
                }}
              >
                <span style={{
                  fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700, color: '#fff',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {bar.item.title}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Day columns — the primary layout. Each column stacks that day's class blocks, work
          items, and events/reminders as cards, in that order. Clicking a day's header expands
          it (more room, unaffected by the others shrinking) and shrinks the rest to a slim
          strip; a second click returns the week to even columns.
          `alignItems: 'stretch'` (the flex default, set explicitly here) is what makes every
          column the SAME height regardless of how much that day holds: each is a flex item in
          one row, so all of them stretch to match whichever one needs the most room — a quiet
          Tuesday no longer reads as a visually "smaller" day than a packed Monday next to it.
          Focusing a day grows this same effect: its cards render `expanded` (more fields per
          card, taller), which grows the whole row's height, and every column — focused or
          not — stretches to match; the width swing is deliberately mild (1.7:0.85:1, not the
          earlier 3:0.6:1) since the row's new height already does most of the "this day is now
          the center of attention" work. */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
        {dayDates.map((date, i) => {
          const isToday    = date === today;
          const isFocused  = focusedDay === date;
          const isDimmed   = focusedDay !== null && !isFocused;
          const load       = heatmapFor(date);
          const dayConflicts = conflictsByDay(date);
          const d = new Date(`${date}T00:00:00Z`);
          const dayItems   = markersByDay.get(date) ?? [];
          const doneCount  = dayItems.filter(p => p.item.work_status === 'done').length;

          return (
            <div
              key={date}
              style={{
                flex: isFocused ? '1.7 1 0' : isDimmed ? '0.85 1 0' : '1 1 0',
                minWidth: 0, minHeight: '220px', transition: 'flex-grow 180ms ease',
                display: 'flex', flexDirection: 'column',
                background: 'rgba(255,255,255,0.4)', borderRadius: '14px',
                border: isToday ? '1.5px solid #74bcd9' : '1px solid rgba(200,210,230,0.4)',
                padding: '8px', boxSizing: 'border-box',
              }}
            >
              <button
                type="button"
                onClick={() => toggleFocus(date)}
                aria-pressed={isFocused}
                aria-label={`${isFocused ? 'Collapse' : 'Expand'} ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}`}
                className="vb-tl-day-toggle"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 2px 8px',
                  borderBottom: '1px solid rgba(200,210,230,0.35)', marginBottom: '6px',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{
                    fontFamily: DM_FONT, fontSize: '0.66rem', fontWeight: 800, textTransform: 'uppercase',
                    letterSpacing: '0.04em', color: isToday ? '#256f92' : '#8a94a6',
                  }}>
                    {DAY_LABELS[i]}
                  </span>
                  <span style={{ fontFamily: FONT, fontSize: '0.82rem', fontWeight: 700, color: '#2d3748' }}>
                    {d.getUTCDate()}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {dayConflicts.length > 0 && <AlertTriangle size={12} color="#c0607c" aria-label="Schedule conflict" />}
                  {load && load.score > 0 && (
                    <span
                      aria-label={`Workload: ${load.level}`}
                      style={{ width: '8px', height: '8px', borderRadius: '50%', background: LEVEL_COLOR[load.level], flexShrink: 0 }}
                    />
                  )}
                </span>
              </button>

              {/* This day's work-item completion, at a glance — the same signal Focus and
                  Board's per-column meta already give per-item, rolled up per-day here since a
                  focused-out, narrow column has no room left for per-card text. Red rather than
                  the done-teal the instant one of today's items is overdue: a day that's "60%
                  done but the other 40% is late" is not the same shade of fine as "60% done, on
                  track", and the bar is the only thing still visible on a dimmed column. */}
              {dayItems.length > 0 && (
                <div
                  role="progressbar"
                  aria-valuenow={doneCount}
                  aria-valuemin={0}
                  aria-valuemax={dayItems.length}
                  aria-label={`${doneCount} of ${dayItems.length} work item${dayItems.length === 1 ? '' : 's'} done`}
                  style={{ height: '3px', borderRadius: '999px', background: 'rgba(200,210,230,0.35)', marginBottom: '7px', overflow: 'hidden', flexShrink: 0 }}
                >
                  <div style={{
                    height: '100%', width: `${(doneCount / dayItems.length) * 100}%`, borderRadius: '999px',
                    background: dayItems.some(p => dueStateOf(p.item, today) === 'overdue') ? '#e0607c' : '#74bcd9',
                    transition: 'width 200ms ease',
                  }} />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {classesByDay(date).map(c => (
                  <ClassCard
                    // A make-up occurrence carries the same `block_id` as its own original
                    // slot; if a class is ever rescheduled onto a date its own weekly template
                    // would already occupy, both entries can appear in the same day's list —
                    // `moved_from` is what tells the two apart when `block_id` alone can't.
                    key={`c${c.block_id}-${c.moved_from ?? 'orig'}`}
                    c={c}
                    expanded={isFocused}
                    onEdit={(occurrence, anchor, trigger) => setOpenOverride({ occurrence, anchor, trigger })}
                  />
                ))}
                {dayItems.map(p => (
                  <WorkCard key={itemKey(p.item)} item={p.item} today={today} expanded={isFocused} />
                ))}
                {eventsByDay(date).map(e => (
                  <EventCard key={`e${e.id}`} e={e} expanded={isFocused} onEdit={() => onEditEvent(e)} />
                ))}
                {classesByDay(date).length === 0 && dayItems.length === 0 && eventsByDay(date).length === 0 && (
                  <span style={{ fontFamily: FONT, fontSize: '0.7rem', color: '#9aa4b5', padding: '4px 2px' }}>
                    {isDimmed ? '' : 'Nothing scheduled'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {openOverride && (
        <ClassOverridePopover
          occurrence={openOverride.occurrence}
          anchor={openOverride.anchor}
          trigger={openOverride.trigger}
          onClose={() => setOpenOverride(null)}
          onSaved={() => { setOpenOverride(null); refreshWeek(); }}
        />
      )}

      <style jsx>{`
        .vb-tl-nav:focus-visible,
        .vb-tl-day-toggle:focus-visible,
        .vb-tl-class-card:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
          border-radius: 8px;
        }
        .vb-tl-nav:hover:not(:disabled) {
          border-color: rgba(140,160,190,0.75);
        }
        .vb-tl-class-card:hover {
          filter: brightness(0.97);
        }
      `}</style>
    </div>
  );
}

/** Greedily assigns each bar to the lowest-numbered row that doesn't already have a bar
 *  overlapping its day range, so two bars whose weeks intersect never render on top of each
 *  other. Bars are otherwise independent of each other and of the day columns' own stacking. */
function stackBars(bars: PlottedBar[]): { bar: PlottedBar; row: number }[] {
  const rows: { endIdx: number }[] = [];
  const placed: { bar: PlottedBar; row: number }[] = [];
  for (const bar of [...bars].sort((a, b) => a.startIdx - b.startIdx)) {
    let row = rows.findIndex(r => r.endIdx < bar.startIdx);
    if (row === -1) { row = rows.length; rows.push({ endIdx: bar.endIdx }); }
    else { rows[row].endIdx = bar.endIdx; }
    placed.push({ bar, row });
  }
  return placed;
}

const CARD_STYLE: React.CSSProperties = {
  borderRadius: '8px', padding: '5px 8px', boxSizing: 'border-box',
  display: 'flex', flexDirection: 'column', gap: '2px',
};

function CardTag({ color, background, children }: { color: string; background: string; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px', borderRadius: '999px',
      padding: '1px 6px', background, color, fontFamily: FONT, fontSize: '0.6rem', fontWeight: 700,
    }}>
      {children}
    </span>
  );
}

/**
 * A recurring class meeting, now also the entry point for the single-day override editor: the
 * whole card is a button, and clicking it — a ghost, a make-up, or a plain unannotated
 * occurrence alike — opens `ClassOverridePopover` over this exact occurrence (see
 * `WorkTimelineView`'s `openOverride` state for why one card's click is enough to identify
 * which occurrence, ghost-or-not, is being edited).
 *
 * Three renderings share this one component rather than three components, because they are the
 * same fact (an occurrence, annotated or not) at three points along it:
 *  - a GHOST (`override.modality === 'rescheduled'` and no `moved_from`) — the class does NOT
 *    meet here; the time range is replaced with where it moved to instead of shown alongside it,
 *    since showing both would read as "meets twice."
 *  - a MAKE-UP (`moved_from` set) — the class DOES meet here, at a slot its own weekly template
 *    never claimed, tagged with where it came from so it doesn't look like a schedule error.
 *  - anything else — today's unchanged rendering: cancelled/online suffix, venue when expanded.
 */
function ClassCard({
  c, expanded, onEdit,
}: {
  c: ClassOccurrence;
  expanded: boolean;
  onEdit: (occurrence: ClassOccurrence, anchor: AnchorRect, trigger: HTMLElement) => void;
}) {
  const isGhost   = c.moved_from === undefined && c.override?.modality === 'rescheduled';
  const isMakeup  = c.moved_from !== undefined;
  const cancelled = c.override?.modality === 'cancelled';
  const dimmed    = cancelled || isGhost;
  const color = courseColor(c.course_code);
  const textColor = courseTextColor(c.course_code);

  const title = isGhost && c.override?.moved_date
    ? `Moved to ${formatShortDate(c.override.moved_date)}${c.override.note ? ` — ${c.override.note}` : ''}`
    : c.override?.note ?? undefined;

  return (
    <button
      type="button"
      title={title}
      onClick={e => onEdit(c, e.currentTarget.getBoundingClientRect(), e.currentTarget)}
      className="vb-tl-class-card"
      style={{
        ...CARD_STYLE, background: `${color}16`, borderLeft: `3px solid ${color}`,
        opacity: dimmed ? 0.55 : 1, border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
      }}
    >
      <span style={{
        fontFamily: FONT, fontSize: '0.72rem', fontWeight: 800, color: textColor,
        textDecoration: dimmed ? 'line-through' : 'none',
      }}>
        {c.course_code}
      </span>
      <span style={{ fontFamily: FONT, fontSize: '0.64rem', color: '#5c6b80' }}>
        {isGhost && c.override?.moved_date && c.override.moved_start_time && c.override.moved_end_time
          ? `→ ${formatShortDate(c.override.moved_date)}, ${formatTimeRange(c.override.moved_start_time, c.override.moved_end_time)}`
          : <>
              {formatTimeRange(c.start_time, c.end_time)}
              {/* Not for 'rescheduled': a make-up card is the only occurrence that reaches this
                  branch with that modality, and its own "From <date>" tag just below already
                  says so more usefully than repeating the word here. */}
              {c.override?.modality && c.override.modality !== 'rescheduled' ? ` · ${MODALITY_LABEL[c.override.modality]}` : ''}
            </>}
      </span>
      {isMakeup && c.moved_from && (
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontFamily: FONT, fontSize: '0.62rem', color: '#8a5010', fontWeight: 700 }}>
          <CalendarClock size={10} aria-hidden /> From {formatShortDate(c.moved_from)}
        </span>
      )}
      {expanded && c.venue && !isGhost && (
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontFamily: FONT, fontSize: '0.64rem', color: '#8a94a6' }}>
          <MapPin size={10} aria-hidden /> {c.venue}
        </span>
      )}
    </button>
  );
}

function WorkCard({ item, today, expanded }: { item: WorkItem; today: string; expanded: boolean }) {
  const state = dueStateOf(item, today);
  const edgeColor = EDGE_COLOR[item.priority];
  const textColor = state === 'overdue' ? '#922e48' : state === 'completed_late' ? '#8a5010' : '#2d3748';
  const isDone = item.work_status === 'done';
  const time = formatDeadlineTime(item);
  return (
    <div
      title={item.title}
      style={{ ...CARD_STYLE, background: 'rgba(255,255,255,0.55)', borderLeft: `3px solid ${edgeColor}` }}
    >
      <span style={{
        fontFamily: FONT, fontSize: '0.72rem', fontWeight: 700, color: isDone ? '#9aa4b5' : textColor,
        textDecoration: isDone ? 'line-through' : 'none', overflowWrap: 'break-word',
      }}>
        {item.title}
      </span>
      {(expanded || item.chip_label || time !== '—') && (
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', marginTop: '1px' }}>
          {item.chip_label && (
            <CardTag color={CATEGORY_TEXT[item.category]} background={`${CATEGORY_HUE[item.category]}1f`}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: CATEGORY_HUE[item.category], flexShrink: 0 }} />
              {item.chip_label}
            </CardTag>
          )}
          {time !== '—' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '2px', fontFamily: FONT, fontSize: '0.62rem', color: '#8a94a6' }}>
              <Clock size={9} aria-hidden /> {time}
            </span>
          )}
          {expanded && item.link_count > 0 && (
            <span
              aria-label={`${item.link_count} link${item.link_count === 1 ? '' : 's'}`}
              style={{ display: 'flex', alignItems: 'center', gap: '2px', fontFamily: FONT, fontSize: '0.62rem', color: '#8a94a6' }}
            >
              <Link2 size={9} aria-hidden /> <span aria-hidden>{item.link_count}</span>
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function EventCard({ e, expanded, onEdit }: { e: WorkboardEventItem; expanded: boolean; onEdit: () => void }) {
  const isReminder = e.item_type === 'reminder';
  return (
    <button
      type="button"
      onClick={onEdit}
      className="vb-tl-class-card"
      style={{
        ...CARD_STYLE, background: 'rgba(242,167,192,0.14)', borderLeft: '3px solid #f2a7c0',
        border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {isReminder && <Bell size={10} color="#8a4468" aria-hidden style={{ flexShrink: 0 }} />}
        <span style={{ fontFamily: FONT, fontSize: '0.72rem', fontWeight: 700, color: '#8a4468', overflowWrap: 'break-word' }}>
          {e.title}
        </span>
      </span>
      {expanded && e.location && (
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontFamily: FONT, fontSize: '0.64rem', color: '#8a94a6' }}>
          <MapPin size={10} aria-hidden /> {e.location}
        </span>
      )}
    </button>
  );
}

/* ─── The single-day schedule override editor ──────────────────────────────────────────── */

const OVERRIDE_NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';
const OVERRIDE_SAVE_ERROR    = 'Could not save this schedule change. Please try again.';
const OVERRIDE_REMOVE_ERROR  = 'Could not remove this schedule change. Please try again.';

const POP_WIDTH  = 260;
const POP_GAP    = 6;
const POP_MARGIN = 8;

const POP_INPUT_STYLE: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: '30px', borderRadius: '8px',
  padding: '4px 8px', background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(200,210,230,0.6)', fontFamily: FONT, fontSize: '0.78rem',
  fontWeight: 500, color: '#2d3748',
};
const POP_LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700,
  color: '#5c6b80', marginBottom: '3px',
};

/** The sibling popovers' message extraction, verbatim (`DeadlineCell`, `LinksPopover`): the
 *  server's own words when it has any, a generic sentence when the body is an HTML error page
 *  or an empty 500. */
async function messageFrom(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  return typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : fallback;
}

type ModalityChoice = 'online_sync' | 'online_async' | 'cancelled' | 'rescheduled' | '';

/**
 * The single-day schedule-exception editor: cancel a meeting, mark it online, or move it to a
 * make-up slot on another day and time — the one thing `schedule_overrides` could never express
 * before this task (see `ScheduleOverrideInput`'s own doc for the schema side of this).
 *
 * One occurrence in, one override out, regardless of which of `ClassCard`'s three renderings
 * was clicked to get here: a plain occurrence has no `override` yet, so Save issues a `POST`
 * (creating one, keyed to `occurrence.block_id`/`occurrence.date`); a ghost or a make-up already
 * has one (`occurrence.override.id`), so Save issues a `PATCH` to that same row — editing either
 * the ghost's card or the make-up's card changes the identical override, because they ARE the
 * same override, just rendered on the two dates it now spans.
 *
 * Portalled for the reason `DeadlinePopover`/`LinksPopover` both are: Timeline sits inside the
 * shell's `backdrop-filter` view-content wrapper, which traps a `position: fixed` child's
 * viewport-relative coordinates against THAT wrapper's box instead of the real viewport.
 * Dismissal (Escape, outside click, scroll/resize) follows their exact shape, with one
 * simplification their table-row setting doesn't allow: `trigger` is the clicked `<button>`
 * element itself rather than a ref object, because a `ClassCard` is never reparented while this
 * popover is open (see `WorkTimelineView`'s `openOverride` state for why).
 */
function ClassOverridePopover({
  occurrence, anchor, trigger, onClose, onSaved,
}: {
  occurrence: ClassOccurrence;
  anchor:     AnchorRect;
  trigger:    HTMLElement;
  onClose:    () => void;
  onSaved:    () => void;
}) {
  const ids = useId();
  const modalityId = `${ids}-modality`;
  const dateId     = `${ids}-date`;
  const startId    = `${ids}-start`;
  const endId      = `${ids}-end`;
  const noteId     = `${ids}-note`;

  const panelRef = useRef<HTMLDivElement>(null);
  const existing = occurrence.override;

  const [modality, setModality]   = useState<ModalityChoice>((existing?.modality ?? '') as ModalityChoice);
  const [movedDate, setMovedDate] = useState(existing?.moved_date ?? '');
  // Defaults to the occurrence's OWN time when there is no override yet — moving a class to a
  // different day almost always keeps its usual time, so the common case needs only the date
  // field touched rather than all three.
  const [movedStart, setMovedStart] = useState(existing?.moved_start_time ?? occurrence.start_time);
  const [movedEnd, setMovedEnd]     = useState(existing?.moved_end_time ?? occurrence.end_time);
  const [note, setNote] = useState(existing?.note ?? '');

  const [formError, setFormError]   = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving]     = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const dismiss = () => { onClose(); trigger.focus(); };

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const { width, height } = panel.getBoundingClientRect();
    let left = anchor.left;
    if (left + width > window.innerWidth - POP_MARGIN) left = window.innerWidth - POP_MARGIN - width;
    if (left < POP_MARGIN) left = POP_MARGIN;
    let top = anchor.bottom + POP_GAP;
    if (top + height > window.innerHeight - POP_MARGIN) {
      const above = anchor.top - height - POP_GAP;
      top = above >= POP_MARGIN ? above : Math.max(POP_MARGIN, window.innerHeight - POP_MARGIN - height);
    }
    setPos({ left, top });
    // Re-measures when `modality` changes: choosing "Rescheduled" adds three more fields, which
    // changes the panel's height and can require flipping it above the trigger instead.
  }, [anchor, modality]);

  useEffect(() => { panelRef.current?.focus(); }, []);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      // A click on the trigger belongs to the trigger — without this the popover would close
      // here and `ClassCard`'s own click handler would immediately reopen it.
      if (trigger.contains(target)) return;
      onClose();
    };
    const handleScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      dismiss();
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', dismiss);
    };
    // `trigger` and `onClose` are stable for this popover's whole lifetime — it is unmounted and
    // a fresh instance created the moment either would change (a different card is clicked).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (submitting || removing) return;
    const validated = validateOverrideModality({
      modality: modality === '' ? null : modality,
      moved_date: movedDate, moved_start_time: movedStart, moved_end_time: movedEnd,
    });
    if ('error' in validated) { setFormError(validated.error); return; }
    setFormError(null);
    setSubmitting(true);
    try {
      const body = { ...validated, note: note.trim() || null };
      const res = existing
        ? await fetch(`/api/workboard/schedule-overrides/${existing.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          }).catch(() => null)
        : await fetch('/api/workboard/schedule-overrides', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, block_id: occurrence.block_id, override_date: occurrence.date }),
          }).catch(() => null);

      if (res === null) { reportTableCellError(OVERRIDE_NETWORK_ERROR); return; }
      if (!res.ok) { setFormError(await messageFrom(res, OVERRIDE_SAVE_ERROR)); return; }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    if (!existing || submitting || removing) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/workboard/schedule-overrides/${existing.id}`, { method: 'DELETE' }).catch(() => null);
      if (res === null) { reportTableCellError(OVERRIDE_NETWORK_ERROR); return; }
      if (!res.ok) { setFormError(await messageFrom(res, OVERRIDE_REMOVE_ERROR)); return; }
      onSaved();
    } finally {
      setRemoving(false);
    }
  };

  const busy = submitting || removing;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Edit ${occurrence.course_code} on ${formatShortDate(occurrence.date)}`}
      tabIndex={-1}
      className="vb-tl-override-pop"
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); } }}
      style={{
        position: 'fixed',
        left: pos?.left ?? 0, top: pos?.top ?? 0,
        opacity: pos === null ? 0 : 1, pointerEvents: pos === null ? 'none' : 'auto',
        zIndex: 40, width: `${POP_WIDTH}px`, boxSizing: 'border-box',
        background: '#fff', borderRadius: '12px', border: '1px solid rgba(200,210,230,0.6)',
        boxShadow: '0 8px 24px rgba(31,38,68,0.18)', padding: '12px',
        display: 'flex', flexDirection: 'column', gap: '10px', fontFamily: FONT,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{
          fontFamily: FONT, fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.04em',
          textTransform: 'uppercase', color: '#5c6b80',
        }}>
          {occurrence.course_code} · {formatShortDate(occurrence.date)}
        </span>
        <button
          type="button" aria-label="Close" onClick={dismiss} className="vb-tl-override-icon-btn"
          style={{
            flex: '0 0 26px', width: '26px', height: '26px', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', borderRadius: '8px',
            background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.6)',
            color: '#5c6b80', cursor: 'pointer', padding: 0,
          }}
        >
          <X size={13} aria-hidden />
        </button>
      </div>

      <div>
        <label htmlFor={modalityId} style={POP_LABEL_STYLE}>This occurrence</label>
        <select
          id={modalityId} className="vb-tl-override-input" value={modality}
          onChange={e => setModality(e.target.value as ModalityChoice)}
          style={POP_INPUT_STYLE}
        >
          <option value="">Face to face class</option>
          <option value="online_sync">Online (synchronous)</option>
          <option value="online_async">Online (asynchronous)</option>
          <option value="cancelled">Cancelled</option>
          <option value="rescheduled">Rescheduled (make-up class)</option>
        </select>
      </div>

      {modality === 'rescheduled' && (
        <>
          <div>
            <label htmlFor={dateId} style={POP_LABEL_STYLE}>Moved to</label>
            <input
              id={dateId} type="date" className="vb-tl-override-input"
              value={movedDate} onChange={e => setMovedDate(e.target.value)} style={POP_INPUT_STYLE}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor={startId} style={POP_LABEL_STYLE}>Start</label>
              <input
                id={startId} type="time" className="vb-tl-override-input"
                value={movedStart} onChange={e => setMovedStart(e.target.value)} style={POP_INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor={endId} style={POP_LABEL_STYLE}>End</label>
              <input
                id={endId} type="time" className="vb-tl-override-input"
                value={movedEnd} onChange={e => setMovedEnd(e.target.value)} style={POP_INPUT_STYLE}
              />
            </div>
          </div>
        </>
      )}

      <div>
        <label htmlFor={noteId} style={POP_LABEL_STYLE}>Note (optional)</label>
        <textarea
          id={noteId} className="vb-tl-override-input" value={note} onChange={e => setNote(e.target.value)}
          rows={2} style={{ ...POP_INPUT_STYLE, minHeight: '48px', resize: 'vertical' }}
        />
      </div>

      {formError && (
        // `role="alert"` so a screen-reader user hears why Save did nothing, the same as every
        // other write-failure surface in this module.
        <p role="alert" style={{ margin: 0, fontFamily: FONT, fontSize: '0.72rem', fontWeight: 600, color: '#922e48' }}>
          {formError}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
        {existing ? (
          <button
            type="button" onClick={() => void remove()} disabled={busy} className="vb-tl-override-btn"
            style={{
              minHeight: '30px', padding: '6px 10px', borderRadius: '8px',
              background: 'rgba(224,96,124,0.12)', border: '1px solid rgba(224,96,124,0.4)',
              fontFamily: FONT, fontSize: '0.74rem', fontWeight: 700, color: '#922e48',
              cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.6 : 1,
            }}
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        ) : <span />}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button" onClick={dismiss} disabled={busy} className="vb-tl-override-btn"
            style={{
              minHeight: '30px', padding: '6px 12px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.6)',
              fontFamily: FONT, fontSize: '0.76rem', fontWeight: 600, color: '#5c6b80', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button" onClick={() => void submit()} disabled={busy} className="vb-tl-override-btn"
            style={{
              minHeight: '30px', padding: '6px 14px', borderRadius: '8px',
              background: '#2a7fa8', border: '1px solid #2a7fa8',
              fontFamily: FONT, fontSize: '0.76rem', fontWeight: 700, color: '#fff',
              cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.7 : 1,
            }}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <style jsx>{`
        .vb-tl-override-input:focus-visible,
        .vb-tl-override-icon-btn:focus-visible,
        .vb-tl-override-btn:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        .vb-tl-override-input:hover:not(:disabled),
        .vb-tl-override-icon-btn:hover:not(:disabled) {
          border-color: rgba(140,160,190,0.75);
        }
        .vb-tl-override-btn:hover:not(:disabled) {
          filter: brightness(0.97);
        }
      `}</style>
    </div>,
    document.body,
  );
}
