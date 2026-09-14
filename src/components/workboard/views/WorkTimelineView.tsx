'use client';

import { useState } from 'react';
import { CalendarRange, SearchX, ChevronLeft, ChevronRight, AlertTriangle, Bell, Clock, MapPin, Link2 } from 'lucide-react';
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
import { addDays, dueDateOf, mondayOf } from '@/lib/workboard/dates';
import { dueStateOf, formatDeadlineTime } from '@/lib/workboard/dueSemantics';
// Pool-free (see that module's own header) — the shared raw/darkened course-hue pair, already
// used by `WorkboardWeekView.tsx` for the identical class-block rendering this file now folds
// in. Reused rather than re-derived so a course's colour agrees everywhere it appears.
import { courseColor, courseTextColor } from '@/lib/workboard/color';

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
}

export default function WorkTimelineView({
  items, weekStart, today, isFiltered, context,
  classOccurrences, conflicts, heatmap, events, onWeekChange, weekLoading,
}: WorkTimelineViewProps) {
  // The day currently expanded, or `null` when the week is showing evenly. Cleared whenever the
  // visible week changes (a focused day from last week means nothing on this one).
  const [focusedDay, setFocusedDay] = useState<string | null>(null);

  const toggleFocus = (date: string) => setFocusedDay(current => (current === date ? null : date));
  const goToWeek = (nextStart: string) => { setFocusedDay(null); onWeekChange(nextStart); };

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
                {classesByDay(date).map(c => <ClassCard key={`c${c.block_id}`} c={c} expanded={isFocused} />)}
                {dayItems.map(p => (
                  <WorkCard key={itemKey(p.item)} item={p.item} today={today} expanded={isFocused} />
                ))}
                {eventsByDay(date).map(e => <EventCard key={`e${e.id}`} e={e} expanded={isFocused} />)}
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

      <style jsx>{`
        .vb-tl-nav:focus-visible,
        .vb-tl-day-toggle:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
          border-radius: 8px;
        }
        .vb-tl-nav:hover:not(:disabled) {
          border-color: rgba(140,160,190,0.75);
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

function ClassCard({ c, expanded }: { c: ClassOccurrence; expanded: boolean }) {
  const cancelled = c.override?.modality === 'cancelled';
  const color = courseColor(c.course_code);
  const textColor = courseTextColor(c.course_code);
  return (
    <div
      title={c.override?.note ?? undefined}
      style={{ ...CARD_STYLE, background: `${color}16`, borderLeft: `3px solid ${color}`, opacity: cancelled ? 0.55 : 1 }}
    >
      <span style={{
        fontFamily: FONT, fontSize: '0.72rem', fontWeight: 800, color: textColor,
        textDecoration: cancelled ? 'line-through' : 'none',
      }}>
        {c.course_code}
      </span>
      <span style={{ fontFamily: FONT, fontSize: '0.64rem', color: '#5c6b80' }}>
        {formatTimeRange(c.start_time, c.end_time)}
        {c.override?.modality ? ` · ${c.override.modality}` : ''}
      </span>
      {expanded && c.venue && (
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontFamily: FONT, fontSize: '0.64rem', color: '#8a94a6' }}>
          <MapPin size={10} aria-hidden /> {c.venue}
        </span>
      )}
    </div>
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

function EventCard({ e, expanded }: { e: WorkboardEventItem; expanded: boolean }) {
  const isReminder = e.item_type === 'reminder';
  return (
    <div style={{ ...CARD_STYLE, background: 'rgba(242,167,192,0.14)', borderLeft: '3px solid #f2a7c0' }}>
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
    </div>
  );
}
