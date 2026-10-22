'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CalendarRange, SearchX, ChevronLeft, ChevronRight, AlertTriangle, Bell, Flag, CalendarClock,
} from 'lucide-react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope
// for its DB-access exports, so a runtime import here would drag mysql2 into this client
// bundle (see WorkboardShell.tsx's, WorkItemRow.tsx's, and WorkBoardView.tsx's comments on the
// same hazard — it has broken `/workboard` twice already).
import type { WorkItem } from '@/lib/workboard/workItems';
// The canonical module. Pool-free by construction.
import type { WorkContext } from '@/lib/workboard/workContexts';
// Type-only, from the same module `getWorkboardWeek` and `WorkboardShell.tsx`'s own
// `WorkboardWeek` import already use — `aggregate.ts` reaches `pool` at module scope for its
// *value* exports, but `import type` is erased entirely, so none of that reaches this client
// bundle. The one canonical source for these four shapes, not a locally re-typed guess at them.
import type { ClassOccurrence, WorkboardEventItem, ConflictWarning, DayLoad } from '@/lib/workboard/aggregate';
import type { CourseOption } from '@/lib/workboard/ui/quickAdd';
import { addDays, dueDateOf, mondayOf, type OverrideModality } from '@/lib/workboard/dates';
import { dueStateOf, formatDeadlineTime } from '@/lib/workboard/dueSemantics';
// Pool-free (see that module's own header) — the shared course hue, reused rather than
// re-derived so a course's colour agrees everywhere it appears.
import { courseColor } from '@/lib/workboard/color';
import { CONTEXT_FILL, CONTEXT_TEXT, DUR } from '@/lib/workboard/ui/tokens';
import { itemKey } from '@/lib/workboard/ui/itemKey';
import { DUE_ACCENT } from '@/lib/workboard/ui/dueColors';
import { formatClock, useNowMinutes } from '@/lib/workboard/ui/nowMinutes';
import { weekProgress } from '@/lib/workboard/ui/weekPicker';
// The single-day schedule-exception editor — shared with StudyPulse's ScheduleMaker, which
// reads/writes the exact same schedule_overrides rows. See that module's own doc comment.
import { ClassOverridePopover, formatShortDate, type AnchorRect } from '@/components/schedule/ClassOverridePopover';
import WbOverlay, { usePresence } from '../ui/WbOverlay';
import WbSkeleton from '../ui/WbSkeleton';
import TimelineDayPanel from './TimelineDayPanel';
import { buildDayEntries, entryKey, eventStart, nowSlot, toMinutes, type DayEntry } from '@/lib/workboard/ui/dayEntries';

const WINDOW_DAYS = 7;
const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const EDGE_COLOR: Record<WorkItem['priority'], string> = {
  high:   'var(--wb-priority-high)',
  normal: 'var(--wb-priority-normal)',
  low:    'var(--wb-priority-low)',
};

const LEVEL_COLOR: Record<DayLoad['level'], string> = {
  low: 'var(--wb-blue)', medium: 'var(--wb-ctx-life)', high: 'var(--wb-priority-high)',
};

/** Display text for a non-null, non-'rescheduled' `OverrideModality` — 'rescheduled' is excluded
 *  from the type on purpose (it never reaches `ClassCard`'s suffix line: a ghost replaces the
 *  whole line with the moved-to slot instead, and a make-up's own "From <date>" tag already
 *  says so). */
const MODALITY_LABEL: Record<Exclude<OverrideModality, 'rescheduled' | null>, string> = {
  online_sync:  'online (sync)',
  online_async: 'online (async)',
  cancelled:    'cancelled',
};

/** `'all'` is the shell's My Work tab — every context at once. Mirrors `WorkBoardView`'s
 *  `BoardContext` and `WorkTableView`'s `TableContext`, and takes the same value from the
 *  same shell state. */
export type TimelineContext = WorkContext | 'all';

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

/** "Oct 12 – 18", or "Sep 29 – Oct 5" when the week crosses a month. */
function formatWeekRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const mon = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return s.getUTCMonth() === e.getUTCMonth()
    ? `${mon(s)} ${s.getUTCDate()} – ${e.getUTCDate()}`
    : `${mon(s)} ${s.getUTCDate()} – ${mon(e)} ${e.getUTCDate()}`;
}

/** Desktop places the day panel beside the week; below 1024px it opens as a drawer instead.
 *  Defaults to true so server markup matches the common desktop case. */
function useMedia(query: string, ssrDefault: boolean): boolean {
  const [matches, setMatches] = useState(ssrDefault);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return matches;
}
const useIsDesktop = () => useMedia('(min-width: 1024px)', true);

type PlottedBar    = { kind: 'bar';    item: WorkItem; startIdx: number; endIdx: number };
type PlottedMarker = { kind: 'marker'; item: WorkItem; dayIdx: number };
type Plotted       = PlottedBar | PlottedMarker;

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
  onWeekChange: (weekStart: string) => void | Promise<void>;
  /** True while a requested week's Calendar data is in flight — disables the nav buttons so a
   *  second click cannot race the first, and swaps the day columns for skeletons. */
  weekLoading?: boolean;
  /** Opens `WorkboardEventDialog` in edit mode for an existing event/reminder — the shell owns
   *  that dialog's state. */
  onEditEvent: (item: WorkboardEventItem) => void;
  /** The same value `visibleItems` is filtered by — `'all'` under My Work, one context under a
   *  tab; also the day panel's quick-add default. Deliberately REQUIRED, not optional — see
   *  `WorkBoardView`'s own history for why an optional context prop is a hazard `tsc` cannot catch. */
  filter: TimelineContext;
  courses: CourseOption[];
  /** Refreshes work items after the day panel's quick add creates one. */
  onChanged: () => Promise<void>;
  onOpenDetail: (item: WorkItem) => void;
}

export default function WorkTimelineView({
  items, weekStart, today, isFiltered,
  classOccurrences, conflicts, heatmap, events, onWeekChange, weekLoading, onEditEvent,
  filter, courses, onChanged, onOpenDetail,
}: WorkTimelineViewProps) {
  // The day whose agenda panel is open, or `null`. The week grid itself never changes shape
  // for it (spec 9): selection only rings the column and opens the panel.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // Keyboard-opened UI does not animate: remembered from the click that opened the panel.
  const [panelInstant, setPanelInstant] = useState(false);
  const selectDay = (date: string, viaKeyboard: boolean) => {
    if (selectedDay === null) setPanelInstant(viaKeyboard);
    setSelectedDay(current => (current === date ? null : date));
  };

  // Directional slide for the next week to land. `target` pins it to that week, so changing
  // direction never re-triggers the animation on the week still on screen.
  const [slide, setSlide] = useState<{ dir: 1 | -1; target: string } | null>(null);
  // The week a navigation asked for. Skeletons show only while that differs from the week on
  // screen, so a same-week refresh (an override save) keeps the current week visible instead.
  const [pendingWeek, setPendingWeek] = useState<string | null>(null);
  const navigate = (nextStart: string, dir: 1 | -1 | 0, viaKeyboard: boolean) => {
    setSelectedDay(null);
    setPendingWeek(nextStart);
    const far = Math.abs((Date.parse(nextStart) - Date.parse(weekStart)) / 86_400_000) > 7;
    setSlide(dir === 0 || far || viaKeyboard ? null : { dir, target: nextStart });
    void onWeekChange(nextStart);
  };

  // The single-day schedule override editor's one open slot — a class card anywhere in the
  // grid (or a class row in the day panel) can open it, and only one can be open at a time.
  // `trigger` is the clicked button itself, captured at open time rather than held in a ref map.
  const [openOverride, setOpenOverride] = useState<{
    occurrence: ClassOccurrence; anchor: AnchorRect; trigger: HTMLElement;
  } | null>(null);
  const editClass = (occurrence: ClassOccurrence, anchor: AnchorRect, trigger: HTMLElement) =>
    setOpenOverride({ occurrence, anchor, trigger });

  // Re-fetches THIS week's data without navigating. Deliberately not `navigate`: that also
  // clears `selectedDay`, and closing the day panel as a side effect of editing one class
  // within it would be a surprising thing for a save button to do.
  const refreshWeek = () => { void onWeekChange(weekStart); };

  useEffect(() => { if (!weekLoading) setPendingWeek(null); }, [weekLoading]);
  const showSkeleton = !!weekLoading && pendingWeek !== null && pendingWeek !== weekStart;

  const isDesktop = useIsDesktop();
  // Below 768px the week is a horizontal scroll-snap row (see workboard.css). On load and on
  // every week change it starts at today's column, or the week's first day. No smooth scroll.
  const isPhone = useMedia('(max-width: 767px)', false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!isPhone || !scroller) return;
    const col = scroller.querySelector<HTMLElement>(`[data-date="${today}"]`);
    scroller.scrollLeft = col ? col.offsetLeft : 0;
  }, [isPhone, weekStart, today]);
  const now = useNowMinutes();
  const drawer = usePresence(isDesktop ? null : selectedDay, DUR.slow);

  // Esc closes the desktop panel. The drawer handles its own Esc; anything that already
  // consumed the key (the override popover, a quick add) or sits in a dialog is left alone.
  useEffect(() => {
    if (!isDesktop || selectedDay === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest?.('[role="dialog"]')) return;
      setSelectedDay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop, selectedDay]);

  // Direction doc §5d's original rule, carried over: the *legitimately*-empty condition is "no
  // item has a start_date or due_at" at all, not "nothing plots in this particular week".
  const hasAnyDate = items.some(item => item.start_date !== null || item.due_at !== null);

  if (!hasAnyDate) {
    const Icon = isFiltered ? SearchX : CalendarRange;
    // On its own glass sheet: the shell no longer wraps Timeline in a panel.
    return (
      <div className="wb-glass-panel" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <Icon size={48} style={{ color: 'var(--wb-text-faint)', marginBottom: '14px' }} />
        <h2 style={{ fontFamily: 'var(--wb-font-head)', fontSize: 'var(--wb-fs-16)', fontWeight: 700, color: 'var(--wb-text)', margin: '0 0 6px' }}>
          {isFiltered ? 'No matching work items' : 'Nothing scheduled yet'}
        </h2>
        <p style={{ fontFamily: 'var(--wb-font-ui)', fontSize: 'var(--wb-fs-14)', fontWeight: 500, color: 'var(--wb-text-muted)', margin: 0 }}>
          {isFiltered
            ? 'Try a different category, search term, or filter.'
            : 'Timeline needs a due date or start date to plot something — add one from the Focus view.'}
        </p>
      </div>
    );
  }

  const dayDates = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(weekStart, i));
  const weekEnd  = dayDates[WINDOW_DAYS - 1];
  // Compared against `weekStart` to grey out "Today" once it's already the visible week — a
  // week can be reached going forward OR back, so this can't just be "disable Next".
  const isCurrentWeek = weekStart === mondayOf(today);
  const todayMonday = mondayOf(today);

  const plotted = items.map(item => plot(item, weekStart)).filter((p): p is Plotted => p !== null);
  const bars    = plotted.filter((p): p is PlottedBar => p.kind === 'bar');
  const markersByDay = new Map<string, WorkItem[]>();
  for (const p of plotted) {
    if (p.kind !== 'marker') continue;
    const date = dayDates[p.dayIdx];
    const list = markersByDay.get(date);
    if (list) list.push(p.item); else markersByDay.set(date, [p.item]);
  }

  const classesByDay = (date: string) => classOccurrences.filter(c => c.date === date)
    .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  const eventsByDay = (date: string) => events.filter(e => eventStart(e, date) !== null);
  const conflictsByDay = (date: string) => conflicts.filter(c => c.date === date);
  const heatmapFor = (date: string) => heatmap.find(h => h.date === date) ?? null;

  const longDateOf = (date: string) => new Date(`${date}T00:00:00Z`)
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

  // `today` may carry a time suffix; only its date orders days.
  const todayDate = today.slice(0, 10);
  const progressPct = Math.round(weekProgress(weekStart, today, now ?? 0) * 100);

  const panelFor = (date: string) => (
    <TimelineDayPanel
      date={date}
      today={today}
      classes={classesByDay(date)}
      // Everything due that day, including a multi-day bar ending there.
      items={items.filter(item => dueDateOf(item) === date)}
      events={eventsByDay(date)}
      filter={filter}
      courses={courses}
      onClose={() => setSelectedDay(null)}
      onChanged={onChanged}
      onOpenDetail={onOpenDetail}
      onEditClass={editClass}
      onEditEvent={onEditEvent}
      switchKey={date}
    />
  );

  return (
    <div role="region" aria-label="Timeline" className="vb-tl-root">
      <div className="vb-tl-week">
        <div className="vb-tl-sheet wb-glass-panel">
          <div className="vb-tl-head">
            <span className="vb-tl-range">{formatWeekRange(weekStart, weekEnd)}</span>
            {/* Elapsed share of the visible week: full for past weeks, empty for future ones. */}
            <div
              className="vb-tl-weekbar"
              role="progressbar"
              aria-label="Week progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct}
            >
              <div className="vb-tl-weekbar__fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="vb-tl-navs">
              <button
                type="button"
                onClick={e => navigate(addDays(weekStart, -7), -1, e.detail === 0)}
                disabled={weekLoading}
                aria-label="Previous week"
                className="wb-gpill vb-tl-nav vb-tl-nav--icon"
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
              <button
                type="button"
                onClick={e => navigate(todayMonday, todayMonday > weekStart ? 1 : -1, e.detail === 0)}
                disabled={weekLoading || isCurrentWeek}
                className="wb-gpill vb-tl-nav"
              >
                Today
              </button>
              <button
                type="button"
                onClick={e => navigate(addDays(weekStart, 7), 1, e.detail === 0)}
                disabled={weekLoading}
                aria-label="Next week"
                className="wb-gpill vb-tl-nav vb-tl-nav--icon"
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          </div>

          {/* Schedule conflicts and deadline clusters for the visible week — server-computed. */}
          {/* Prefixed: the week-slide sibling below is keyed by the bare weekStart. */}
          <ConflictSummary key={`conflicts-${weekStart}`} conflicts={conflicts} />

          {/* Keyed by week, so the row remounts when the new week's data lands and the slide plays
              on the new content rather than before the fetch. */}
          <div key={weekStart} className="vb-week-slide" data-dir={slide && slide.target === weekStart ? slide.dir : undefined}>
            {/* One scroller holds the bars and the columns, so on phones they scroll together. */}
            <div ref={scrollerRef} className="vb-tl-scroll">
              <div className="vb-tl-track">
                {/* Multi-day bars sit on the same column template as the days (weekends are
                    narrower on desktop), so a bar spans exactly the columns it covers. */}
                {bars.length > 0 && (
                  <div className="vb-tl-cols vb-tl-bars">
                    {stackBars(bars).map(({ bar, row }) => {
                      const color = EDGE_COLOR[bar.item.priority];
                      return (
                        <div
                          key={itemKey(bar.item)}
                          role="img"
                          aria-label={bar.item.title}
                          style={{
                            gridColumn: `${bar.startIdx + 1} / ${bar.endIdx + 2}`, gridRow: row + 1, minWidth: 0,
                            height: '22px', borderRadius: 'var(--wb-r-sm)',
                            background: color, border: `1px solid ${color}`, boxSizing: 'border-box',
                            display: 'flex', alignItems: 'center', padding: '0 8px', overflow: 'hidden',
                          }}
                        >
                          <span aria-hidden style={{
                            fontFamily: 'var(--wb-font-ui)', fontSize: 'var(--wb-fs-12)', fontWeight: 700, color: 'var(--wb-inverse-text)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {bar.item.title}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Day columns. Grid rows stretch, so every column is the same height regardless
                    of how much that day holds. Full detail for a day lives in the day panel, so
                    cards here are always compact. */}
                <div className="vb-tl-cols">
                  {dayDates.map((date, i) => {
                    const isToday    = date === todayDate;
                    const isPast     = date < todayDate;
                    const isWeekend  = i >= 5;
                    const isSelected = selectedDay === date;
                    const load       = heatmapFor(date);
                    const dayConflicts = conflictsByDay(date);
                    const d = new Date(`${date}T00:00:00Z`);
                    const dayItems   = markersByDay.get(date) ?? [];
                    const doneCount  = dayItems.filter(item => item.work_status === 'done').length;
                    const entries    = buildDayEntries(date, classesByDay(date), eventsByDay(date), dayItems);
                    const slot       = isToday && now !== null ? nowSlot(entries, now) : -1;

                    return (
                      <div
                        key={date}
                        data-date={date}
                        className="vb-tl-day wb-glass-item"
                        data-today={isToday ? 'true' : undefined}
                        data-past={isPast ? 'true' : undefined}
                        data-weekend={isWeekend ? 'true' : undefined}
                        data-selected={isSelected ? 'true' : undefined}
                      >
                        <button
                          type="button"
                          onClick={e => selectDay(date, e.detail === 0)}
                          aria-pressed={isSelected}
                          aria-label={`Show ${longDateOf(date)} agenda`}
                          className="vb-tl-day-toggle"
                        >
                          <span className="vb-tl-day-head">
                            <span className="vb-tl-dn">
                              {isToday ? `${DAY_LABELS[i]} · Today` : DAY_LABELS[i]}
                            </span>
                            <span className="vb-tl-dd">{d.getUTCDate()}</span>
                          </span>
                          <span className="vb-tl-day-flags">
                            {dayConflicts.length > 0 && <AlertTriangle size={12} style={{ color: 'var(--wb-danger)' }} aria-label="Schedule conflict" />}
                            {load && load.score > 0 && (
                              <span
                                aria-label={`Workload: ${load.level}`}
                                style={{ width: '8px', height: '8px', borderRadius: '50%', background: LEVEL_COLOR[load.level], flexShrink: 0 }}
                              />
                            )}
                          </span>
                        </button>

                        {showSkeleton ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <WbSkeleton height={28} radius="var(--wb-r-md)" />
                            <WbSkeleton height={28} radius="var(--wb-r-md)" />
                            <WbSkeleton height={20} radius="var(--wb-r-md)" />
                          </div>
                        ) : (
                          <div className="vb-tl-day-body">
                            {/* This day's work-item completion, at a glance. Red rather than the
                                done-blue the instant one of the day's items is overdue. */}
                            {dayItems.length > 0 && (
                              <div
                                role="progressbar"
                                className="vb-tl-day-progress"
                                aria-valuenow={doneCount}
                                aria-valuemin={0}
                                aria-valuemax={dayItems.length}
                                aria-label={`${doneCount} of ${dayItems.length} work item${dayItems.length === 1 ? '' : 's'} done`}
                                style={{ height: '3px', borderRadius: 'var(--wb-r-pill)', background: 'rgba(200,210,230,0.35)', marginBottom: '7px', overflow: 'hidden', flexShrink: 0 }}
                              >
                                <div className="vb-tl-progress" style={{
                                  height: '100%', width: '100%', transformOrigin: 'left center',
                                  transform: `scaleX(${doneCount / dayItems.length})`,
                                  background: dayItems.some(item => dueStateOf(item, today) === 'overdue') ? 'var(--wb-priority-high)' : 'var(--wb-blue)',
                                }} />
                              </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', minWidth: 0 }}>
                              {entries.map((en, idx) => (
                                <DayCell key={entryKey(en)} en={en} today={today} faded={isPast} onEditClass={editClass} onEditEvent={onEditEvent}
                                  nowBefore={idx === slot ? now : null} />
                              ))}
                              {now !== null && slot !== -1 && slot === entries.length && <NowLine now={now} />}
                              {/* Empty days stay clean; only today says so. */}
                              {entries.length === 0 && isToday && (
                                <span className="vb-tl-free">
                                  <span className="vb-tl-free__orb" aria-hidden />
                                  Free day
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isDesktop && selectedDay !== null && (
        // Mounted once while any day is selected; only the panel's `switchKey` changes, so the
        // slide plays once and switching days only crossfades the agenda.
        <aside className="vb-day-panel" aria-labelledby="vb-day-panel-title" data-instant={panelInstant ? 'true' : undefined}>
          {panelFor(selectedDay)}
        </aside>
      )}

      {!isDesktop && drawer.value !== null && (
        <WbOverlay
          open={drawer.open}
          variant="drawer"
          labelledBy="vb-day-panel-title"
          instant={panelInstant}
          onClose={() => setSelectedDay(null)}
          panelStyle={{ padding: '16px' }}
        >
          {panelFor(drawer.value)}
        </WbOverlay>
      )}

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
        .vb-tl-root { display: flex; align-items: flex-start; gap: 14px; }
        .vb-tl-week { flex: 1; min-width: 0; }
        .vb-tl-sheet { padding: 18px; box-sizing: border-box; }

        .vb-tl-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .vb-tl-range {
          flex-shrink: 0; font: 700 var(--wb-fs-16) var(--wb-font-head); color: var(--wb-text); white-space: nowrap;
        }
        /* No transition: the bar only ever jumps (spec §9). */
        .vb-tl-weekbar {
          flex: 1; min-width: 40px; height: 6px; border-radius: 3px; overflow: hidden;
          background: rgba(255, 255, 255, 0.5);
        }
        .vb-tl-weekbar__fill {
          height: 100%; border-radius: 3px;
          background: linear-gradient(90deg, var(--wb-blue), var(--wb-pink-strong));
        }
        .vb-tl-navs { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .vb-tl-nav { min-height: 32px; justify-content: center; cursor: pointer; padding: 0 12px; }
        .vb-tl-nav--icon { width: 32px; padding: 0; color: var(--wb-text-muted); }
        .vb-tl-nav:disabled { cursor: default; opacity: 0.5; }

        /* Desktop and tablet: weekends recessed and narrower. Phones override to seven equal
           columns inside the scroll-snap track (below). */
        .vb-tl-cols {
          display: grid; gap: 10px;
          grid-template-columns: repeat(5, minmax(0, 1fr)) repeat(2, minmax(0, 0.7fr));
        }
        .vb-tl-bars { grid-auto-rows: 22px; row-gap: 4px; margin-bottom: 10px; }

        .vb-tl-day {
          min-width: 0; min-height: 250px; display: flex; flex-direction: column;
          border-radius: 18px; padding: 12px 10px; box-sizing: border-box;
        }
        .vb-tl-day[data-past='true'] {
          background: linear-gradient(160deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0.3));
          box-shadow: none;
        }
        .vb-tl-day[data-weekend='true'] {
          background: rgba(255, 255, 255, 0.18); border: 1px solid rgba(255, 255, 255, 0.35); box-shadow: none;
        }
        .vb-tl-day[data-today='true'] {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(255, 236, 245, 0.7));
          box-shadow: inset 0 1px 0 var(--wb-surface), 0 0 0 1.5px rgba(232, 85, 143, 0.45), 0 26px 50px -20px rgba(232, 85, 143, 0.55);
        }
        /* Selection keeps the app's blue selection ring, layered onto the tile's glass depth. */
        .vb-tl-day[data-selected='true'] {
          box-shadow: inset 0 1px 0 var(--wb-surface), 0 0 0 2px var(--wb-blue-strong), 0 16px 30px -16px rgba(60, 40, 110, 0.5);
        }
        .vb-tl-day[data-selected='true'][data-today='true'] {
          box-shadow: inset 0 1px 0 var(--wb-surface), 0 0 0 2px var(--wb-blue-strong), 0 26px 50px -20px rgba(232, 85, 143, 0.55);
        }
        .vb-tl-day-body { display: flex; flex-direction: column; min-width: 0; }
        /* Past days fade surfaces only (chip fills via the cards' faded prop, the progress bar and
           the now line); text stays at full opacity so it keeps 4.5:1. */
        .vb-tl-day[data-past='true'] .vb-tl-day-progress,
        .vb-tl-day[data-past='true'] :global(.vb-tl-now) { opacity: 0.6; }

        .vb-tl-day-toggle {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 4px; width: 100%;
          background: transparent; border: none; cursor: pointer; padding: 0 2px; margin-bottom: 10px; text-align: left;
        }
        .vb-tl-day-head { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
        .vb-tl-dn {
          font: 800 var(--wb-fs-11) var(--wb-font-head); text-transform: uppercase; letter-spacing: 0.07em;
          color: var(--wb-text-muted);
        }
        .vb-tl-dd {
          margin-top: 2px; font: 750 22px/1.1 var(--wb-font-ui); letter-spacing: -0.02em; color: var(--wb-text);
        }
        .vb-tl-day[data-past='true'] .vb-tl-dd { color: var(--wb-text-muted); }
        .vb-tl-day[data-today='true'] .vb-tl-dn,
        .vb-tl-day[data-today='true'] .vb-tl-dd { color: var(--wb-pink-ink); }
        .vb-tl-day-flags { display: flex; align-items: center; gap: 4px; padding-top: 2px; flex-shrink: 0; }

        .vb-tl-free {
          display: flex; flex-direction: column; align-items: center; gap: 6px; margin-top: 30px;
          font: 600 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted);
        }
        .vb-tl-free__orb {
          width: 34px; height: 34px; border-radius: 50%; box-sizing: border-box;
          background: radial-gradient(circle at 35% 30%, var(--wb-surface), rgba(255, 255, 255, 0.2));
          border: 1px solid rgba(255, 255, 255, 0.9);
        }

        /* NowLine renders in a child component, outside this tree's scope class. */
        .vb-tl-sheet :global(.vb-tl-now) {
          position: relative; height: 2px; border: 0; border-radius: 1px; margin: 4px 0 4px 4px;
          background: var(--wb-pink-strong); box-shadow: 0 0 10px rgba(232, 85, 143, 0.8);
        }
        .vb-tl-sheet :global(.vb-tl-now)::before {
          content: ''; position: absolute; left: -4px; top: -3px; width: 8px; height: 8px; border-radius: 50%;
          background: var(--wb-pink-strong);
        }

        @media (max-width: 767px) {
          .vb-tl-cols { grid-template-columns: repeat(7, minmax(0, 1fr)); }
          /* The bar takes its own row so the range and the controls keep their width. */
          .vb-tl-head { flex-wrap: wrap; row-gap: 10px; }
          .vb-tl-navs { margin-left: auto; }
          .vb-tl-weekbar { order: 3; flex-basis: 100%; }
        }

        .vb-tl-nav:focus-visible,
        .vb-tl-day-toggle:focus-visible {
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 2px;
        }
        .vb-tl-day-toggle:focus-visible { border-radius: var(--wb-r-md); }
        @media (hover: hover) and (pointer: fine) {
          .vb-tl-nav:hover:not(:disabled) { background: var(--wb-surface); }
        }
        .vb-tl-progress { transition: transform var(--wb-dur) var(--wb-ease); }
        .vb-day-panel {
          width: 300px; flex-shrink: 0; align-self: flex-start; box-sizing: border-box; padding: 14px;
          position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto;
          background: var(--wb-surface); border-radius: var(--wb-r-xl); box-shadow: var(--wb-shadow-pop);
          animation: vb-panel-in var(--wb-dur-slow) var(--wb-ease);
        }
        .vb-day-panel[data-instant='true'] { animation: none; }
        @keyframes vb-panel-in { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
        .vb-week-slide[data-dir='1'] { animation: vb-week-next 160ms var(--wb-ease); }
        .vb-week-slide[data-dir='-1'] { animation: vb-week-prev 160ms var(--wb-ease); }
        @keyframes vb-week-next { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
        @keyframes vb-week-prev { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .vb-day-panel { animation: none; }
          .vb-week-slide[data-dir] { animation: none; }
          .vb-tl-progress { transition: none; }
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

function NowLine({ now }: { now: number }) {
  return <div role="separator" aria-label={`Now, ${formatClock(now)}`} className="vb-tl-now" />;
}

/** One time-ordered entry in a day column, with the now marker before it when it is the first
 *  entry at or after the current time. */
function DayCell({
  en, today, faded, onEditClass, onEditEvent, nowBefore,
}: {
  en: DayEntry; today: string; nowBefore: number | null;
  /** A past day: chip surfaces fade, text does not. */
  faded: boolean;
  onEditClass: (occurrence: ClassOccurrence, anchor: AnchorRect, trigger: HTMLElement) => void;
  onEditEvent: (item: WorkboardEventItem) => void;
}) {
  return (
    <>
      {nowBefore !== null && <NowLine now={nowBefore} />}
      {en.kind === 'class' && <ClassCard c={en.c} faded={faded} onEdit={onEditClass} />}
      {en.kind === 'item' && <WorkCard item={en.item} today={today} faded={faded} />}
      {en.kind === 'event' && <EventCard e={en.e} faded={faded} onEdit={() => onEditEvent(en.e)} />}
    </>
  );
}

const CARD_STYLE: React.CSSProperties = {
  borderRadius: '12px', padding: '8px 9px', boxSizing: 'border-box',
  display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, maxWidth: '100%', overflow: 'hidden',
};

/** Past-day fade: every chip surface alpha scaled by .6, matching an opacity of .6 on the
 *  surface alone. Text keeps full opacity, so it stays at or above 4.5:1. */
const FADE = 0.6;
const alpha = (a: number, faded: boolean) => +(faded ? a * FADE : a).toFixed(3);

/** Tinted glass chip in a hue: classes take their course colour, life events the Life hue. */
function tintedGlass(color: string, faded: boolean): React.CSSProperties {
  return {
    background: `linear-gradient(160deg, color-mix(in srgb, ${color} ${alpha(45, faded)}%, transparent), rgba(255,255,255,${alpha(0.45, faded)}))`,
    border: `1px solid rgba(255,255,255,${alpha(0.75, faded)})`,
  };
}

// Text wraps (or, in tags, truncates) inside its column; never spills into the next one.
const CARD_TEXT: React.CSSProperties = { fontFamily: 'var(--wb-font-ui)', fontSize: 'var(--wb-fs-12)', overflowWrap: 'anywhere', minWidth: 0 };

// Grid card titles stop at 3 lines; the day panel shows them in full.
const CARD_TITLE_CLAMP: React.CSSProperties = {
  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
};

/** `text-overflow` only works on a block container, never on the anonymous flex item that loose
 *  text becomes inside an inline-flex, so the label gets its own ellipsizing span. */
function CardTag({ color, background, dot, label }: {
  color: string; background: string; dot?: React.ReactNode; label: string;
}) {
  return (
    <span title={label} style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px', borderRadius: 'var(--wb-r-pill)',
      padding: '1px 6px', background, color, ...CARD_TEXT, fontWeight: 700,
      maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', overflow: 'hidden',
    }}>
      {dot}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </span>
  );
}

function conflictText(c: ConflictWarning): string {
  return `${c.type === 'overlap' ? 'Schedule conflict' : 'Deadline cluster'} — ${c.message} (${c.date})`;
}

/** One line however many conflicts the week has, so the grid stays near the top; the list
 *  opens on demand (one line per conflict, full text in `title`). A single conflict shows inline. */
function ConflictSummary({ conflicts }: { conflicts: ConflictWarning[] }) {
  const [open, setOpen] = useState(false);
  if (conflicts.length === 0) return null;
  const single = conflicts.length === 1;
  return (
    <div className="vb-cf">
      <div className="vb-cf__bar">
        <AlertTriangle size={14} aria-hidden style={{ color: 'var(--wb-danger)', flexShrink: 0 }} />
        {single ? (
          <span role="status" className="vb-cf__text vb-cf__text--single" title={conflictText(conflicts[0])}>{conflictText(conflicts[0])}</span>
        ) : (
          <>
            <span role="status" className="vb-cf__text">
              {conflicts.length} {conflicts.every(c => c.type === 'overlap') ? 'schedule conflicts' : 'conflicts'} this week
            </span>
            <button
              type="button"
              className="vb-cf__toggle wb-focus-ring"
              aria-expanded={open}
              aria-controls="vb-cf-list"
              onClick={() => setOpen(o => !o)}
            >
              {open ? 'Hide' : 'Show'}
            </button>
          </>
        )}
      </div>
      {!single && open && (
        <ul id="vb-cf-list" className="vb-cf__list">
          {conflicts.map((c, i) => (
            <li key={`${c.type}|${c.date}|${c.message}|${i}`} className="vb-cf__item" title={conflictText(c)}>{conflictText(c)}</li>
          ))}
        </ul>
      )}
      <style jsx>{`
        .vb-cf {
          margin-bottom: 14px; border-radius: var(--wb-r-lg); background: var(--wb-danger-bg);
          border: 1px solid rgba(224, 96, 124, 0.3); font-family: var(--wb-font-ui); color: var(--wb-danger);
        }
        .vb-cf__bar { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 8px 4px 14px; }
        .vb-cf__text { flex: 1; min-width: 0; font: 700 var(--wb-fs-13) var(--wb-font-ui); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .vb-cf__text--single {
          white-space: normal; overflow-wrap: anywhere;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        }
        .vb-cf__toggle {
          flex-shrink: 0; min-height: 28px; padding: 0 10px; border: 0; border-radius: var(--wb-r-md);
          background: transparent; color: var(--wb-danger); font: 700 var(--wb-fs-12) var(--wb-font-ui); cursor: pointer;
        }
        /* The container already carries the danger tint, so hover underlines rather than tints. */
        @media (hover: hover) and (pointer: fine) { .vb-cf__toggle:hover { text-decoration: underline; } }
        @media (max-width: 767px) { .vb-cf__toggle { min-height: 44px; } }
        .vb-cf__list {
          list-style: none; margin: 0; padding: 0 14px 8px; max-height: 180px; overflow-y: auto;
          display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px;
        }
        .vb-cf__item {
          min-width: 0; font: 600 var(--wb-fs-12)/1.6 var(--wb-font-ui);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
      `}</style>
    </div>
  );
}

/**
 * A recurring class meeting, and the entry point for the single-day override editor: the whole
 * card is a button that opens `ClassOverridePopover` over this exact occurrence.
 *
 * Three renderings share this one component, because they are the same fact (an occurrence,
 * annotated or not) at three points along it:
 *  - a GHOST (`override.modality === 'rescheduled'` and no `moved_from`) — the class does NOT
 *    meet here; the time range is replaced with where it moved to instead of shown alongside it,
 *    since showing both would read as "meets twice."
 *  - a MAKE-UP (`moved_from` set) — the class DOES meet here, at a slot its own weekly template
 *    never claimed, tagged with where it came from so it doesn't look like a schedule error.
 *  - anything else — the cancelled/online suffix, if any.
 */
function ClassCard({
  c, faded, onEdit,
}: {
  c: ClassOccurrence;
  faded: boolean;
  onEdit: (occurrence: ClassOccurrence, anchor: AnchorRect, trigger: HTMLElement) => void;
}) {
  const isGhost   = c.moved_from === undefined && c.override?.modality === 'rescheduled';
  const isMakeup  = c.moved_from !== undefined;
  const cancelled = c.override?.modality === 'cancelled';
  const dimmed    = cancelled || isGhost;
  const color = courseColor(c.course_code);

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
        ...CARD_STYLE, ...tintedGlass(color, faded),
        opacity: dimmed ? 0.55 : 1, width: '100%', textAlign: 'left', cursor: 'pointer',
      }}
    >
      <span
        title={c.course_code}
        style={{
          ...CARD_TEXT, fontSize: '12.5px', fontWeight: 700, color: 'var(--wb-text)', textDecoration: dimmed ? 'line-through' : 'none',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', flexShrink: 0,
        }}
      >
        {c.course_code}
      </span>
      {/* --wb-text, not muted: muted drops below 4.5:1 on the saturated course tints. */}
      <span style={{ ...CARD_TEXT, fontWeight: 600, color: 'var(--wb-text)' }}>
        {isGhost && c.override?.moved_date && c.override.moved_start_time && c.override.moved_end_time
          ? `→ ${formatShortDate(c.override.moved_date)}, ${formatTimeRange(c.override.moved_start_time, c.override.moved_end_time)}`
          : <>
              {formatTimeRange(c.start_time, c.end_time)}
              {c.override?.modality && c.override.modality !== 'rescheduled' ? ` · ${MODALITY_LABEL[c.override.modality]}` : ''}
            </>}
      </span>
      {isMakeup && c.moved_from && (
        // Warn hue on the icon only: as text it falls below 4.5:1 on the course tints.
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px', ...CARD_TEXT, color: 'var(--wb-text)', fontWeight: 700 }}>
          <CalendarClock size={12} aria-hidden style={{ color: 'var(--wb-warn)', flexShrink: 0 }} /> From {formatShortDate(c.moved_from)}
        </span>
      )}
      {/* `title` alone never reaches keyboard, touch or screen-reader users. */}
      {c.override?.note && <span className="wb-sr-only">. Note: {c.override.note}</span>}
      <style jsx>{`
        .vb-tl-class-card:focus-visible {
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 2px;
        }
        @media (hover: hover) and (pointer: fine) {
          .vb-tl-class-card:hover { filter: brightness(0.97); }
        }
      `}</style>
    </button>
  );
}

function WorkCard({ item, today, faded }: { item: WorkItem; today: string; faded: boolean }) {
  const state = dueStateOf(item, today);
  const textColor = DUE_ACCENT[state] ?? 'var(--wb-text)';
  const isDone = item.work_status === 'done';
  const time = formatDeadlineTime(item);
  return (
    // Bright white so deadlines stand apart from the tinted class chips.
    <div
      title={item.title}
      style={{
        ...CARD_STYLE, background: `rgba(255,255,255,${alpha(0.75, faded)})`,
        border: `1px solid rgba(255,255,255,${alpha(1, faded)})`,
        boxShadow: `0 8px 18px -12px rgba(60,40,110,${alpha(0.45, faded)})`,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', minWidth: 0, color: isDone ? 'var(--wb-text-faint)' : textColor }}>
        <Flag size={12} aria-hidden style={{ flexShrink: 0, marginTop: '2px' }} />
        <span style={{
          ...CARD_TEXT, fontWeight: 700, textDecoration: isDone ? 'line-through' : 'none', ...CARD_TITLE_CLAMP,
        }}>
          {item.title}
        </span>
      </span>
      {(item.chip_label || time !== '—') && (
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', marginTop: '1px', minWidth: 0 }}>
          {item.chip_label && (
            <CardTag
              color={CONTEXT_TEXT[item.category]} background={`${CONTEXT_FILL[item.category]}1f`}
              label={item.chip_label}
              dot={<span style={{ width: '5px', height: '5px', borderRadius: '50%', background: CONTEXT_FILL[item.category], flexShrink: 0 }} />}
            />
          )}
          {time !== '—' && (
            <span style={{ ...CARD_TEXT, fontWeight: 600, color: 'var(--wb-text-muted)' }}>
              Due {time}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function EventCard({ e, faded, onEdit }: { e: WorkboardEventItem; faded: boolean; onEdit: () => void }) {
  const isReminder = e.item_type === 'reminder';
  return (
    <button
      type="button"
      onClick={onEdit}
      title={e.title}
      className="vb-tl-class-card"
      style={{
        ...CARD_STYLE, ...tintedGlass('var(--wb-ctx-life)', faded),
        width: '100%', textAlign: 'left', cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--wb-ctx-life-text)' }}>
        {isReminder && <Bell size={12} aria-hidden style={{ flexShrink: 0 }} />}
        <span style={{ ...CARD_TEXT, fontWeight: 700, ...CARD_TITLE_CLAMP }}>
          {e.title}
        </span>
      </span>
      <style jsx>{`
        .vb-tl-class-card:focus-visible {
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 2px;
        }
        @media (hover: hover) and (pointer: fine) {
          .vb-tl-class-card:hover { filter: brightness(0.97); }
        }
      `}</style>
    </button>
  );
}
