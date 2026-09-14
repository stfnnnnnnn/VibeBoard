'use client';

import { CalendarRange, SearchX } from 'lucide-react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope
// for its DB-access exports, so a runtime import here would drag mysql2 into this client
// bundle (see WorkboardShell.tsx's, WorkItemRow.tsx's, and WorkBoardView.tsx's comments on the
// same hazard — it has broken `/workboard` twice already).
import type { WorkItem } from '@/lib/workboard/workItems';
import { WORK_CATEGORIES, type WorkCategory } from '@/lib/workboard/workCategories';
// The canonical module (not the deprecated `workCategories` shim above, kept only for the
// existing My-Work lane logic this task does not touch). Pool-free by construction — safe as
// a runtime import for `LIFE_AREA_LABELS` — see `workContexts.ts`.
import { LIFE_AREA_LABELS, type WorkContext } from '@/lib/workboard/workContexts';
import { addDays, dueDateOf } from '@/lib/workboard/dates';

const FONT    = "'Inter','DM Sans','Segoe UI',sans-serif";
const DM_FONT = "'DM Sans','Segoe UI',sans-serif";

/** Width of one day column. Not spec-mandated as an exact number — chosen wide enough that a
 *  short bar label fits inline and the day-header date is legible without crowding. */
const DAY_WIDTH    = 56;
const WINDOW_WEEKS = 4;
const WINDOW_DAYS  = WINDOW_WEEKS * 7; // 28 — direction doc §5c: "four weeks starting from work.week_start"
const HEADER_HEIGHT = 34;

const EDGE_COLOR: Record<WorkItem['priority'], string> = {
  high:   '#e0607c',
  normal: '#b8c6da',
  low:    '#d3dbe6',
};

/** Fixed top-to-bottom lane order, direction doc §5c: "Academic/Projects/Organization/Life,
 *  in that fixed order top-to-bottom so a returning user learns the layout" — this is exactly
 *  `WORK_CATEGORIES`'s own order, so lanes are built straight off that constant. */
const CATEGORY_LABEL: Record<WorkCategory, string> = {
  academic:     'Academic',
  project:      'Projects',
  organization: 'Organization',
  life:         'Life',
};

/** Raw category hues (§2a) — used here only as non-text decoration (lane tint), which is the
 *  one place §8 says the raw hue is the correct choice rather than a darkened text-safe shade. */
const CATEGORY_HUE: Record<WorkCategory, string> = {
  academic:     '#4dabf5',
  project:      '#8b7fd6',
  organization: '#f0a35c',
  life:         '#f2a7c0',
};

/** `'all'` is the shell's My Work tab — every context at once. Mirrors `WorkBoardView`'s
 *  `BoardContext` and `WorkTableView`'s `TableContext`, and takes the same value from the
 *  same shell state. */
export type TimelineContext = WorkContext | 'all';

/** Number of whole days between `week_start` and `date` (both "YYYY-MM-DD"). Negative when
 *  `date` precedes `week_start`. Computed in UTC, matching `dates.ts`'s convention, so this
 *  never depends on the server process's local timezone. */
function dayIndex(weekStart: string, date: string): number {
  const start  = new Date(`${weekStart}T00:00:00Z`).getTime();
  const target = new Date(`${date}T00:00:00Z`).getTime();
  return Math.round((target - start) / 86_400_000);
}

/** Darkens a `#rrggbb` hex color toward black by `amount` (0..1). Used for a bar's border,
 *  which direction doc §5c specifies as "20% darker" than the bar's own fill color. */
function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((n >> 8) & 0xff) * (1 - amount));
  const b = Math.round((n & 0xff) * (1 - amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function itemKey(item: Pick<WorkItem, 'source' | 'id'>): string {
  return `${item.source}-${item.id}`;
}

/**
 * `context !== 'all'` lane grouping (§16b/§16c, Task 39): which group `item` belongs to under
 * a single active context, or `null` when it has no group value for that context (destined for
 * the trailing "Unassigned" lane rather than being dropped). Grouped by the id field, never the
 * label, so two same-named things (e.g. two courses that happen to share a code) are never
 * accidentally merged into one lane.
 */
function groupOf(item: WorkItem, context: WorkContext): { id: number | string; label: string } | null {
  switch (context) {
    case 'academic':
      return item.user_subject_id === null
        ? null
        : { id: item.user_subject_id, label: item.course_code ?? '' };
    case 'project':
      return item.project_id === null
        ? null
        : { id: item.project_id, label: item.project_name ?? '' };
    case 'organization':
      return item.organization_id === null
        ? null
        : { id: item.organization_id, label: item.organization_name ?? '' };
    case 'life':
      return item.life_area === null
        ? null
        : { id: item.life_area, label: LIFE_AREA_LABELS[item.life_area] };
  }
}

type PlottedBar    = { kind: 'bar';    item: WorkItem; left: number; width: number };
type PlottedMarker = { kind: 'marker'; item: WorkItem; left: number };
type Plotted       = PlottedBar | PlottedMarker;

/**
 * The task's exact plotting rule, restated as code:
 *  - both `start_date` and a due date  -> bar, `dayIndex(start)`..`dayIndex(due)` inclusive.
 *  - only a due date                   -> marker at `dayIndex(due)`.
 *  - neither                           -> does not appear (returns null).
 *
 * Items whose relevant date(s) fall outside the four-week window are clipped out entirely
 * (return null) rather than clamped to day 0 or day `WINDOW_DAYS - 1` — a bar or marker pinned
 * to the boundary would misrepresent when the work actually happens, which the brief calls out
 * as a correctness requirement, not a style choice. For a bar this means BOTH ends must fall
 * inside the window; a bar that only partially overlaps the visible range is not drawn as a
 * truncated stub, since a stub still misrepresents one of its two real endpoints.
 */
function plot(item: WorkItem, weekStart: string): Plotted | null {
  const due = dueDateOf(item);
  if (due === null) return null; // no due date at all -> never appears, start_date or not

  const dueIdx = dayIndex(weekStart, due);

  if (item.start_date !== null) {
    const startIdx = dayIndex(weekStart, item.start_date);
    if (startIdx < 0 || startIdx > WINDOW_DAYS - 1 || dueIdx < 0 || dueIdx > WINDOW_DAYS - 1) {
      return null; // clipped out, not clamped
    }
    return { kind: 'bar', item, left: startIdx * DAY_WIDTH, width: (dueIdx - startIdx + 1) * DAY_WIDTH };
  }

  if (dueIdx < 0 || dueIdx > WINDOW_DAYS - 1) return null; // clipped out, not clamped
  return { kind: 'marker', item, left: dueIdx * DAY_WIDTH };
}

/**
 * One rendered row. `hue` carries the per-lane tint (form 4, My Work only) — `null` means
 * "paint no background at all" (form 5, a single context), never a fallback color, per §16c:
 * lanes drop the tint entirely rather than trading it for a neutral one.
 */
type Lane = { key: string; label: string; hue: string | null; plotted: Plotted[] };

/**
 * Alphabetical by label, EXCEPT a lane whose label is the empty-string fallback (`groupOf`'s
 * `?? ''`, taken when a group's id is present but its display-label field is somehow blank —
 * unreachable today since `course_code`/`project_name`/`organization_name` are all NOT NULL
 * with FK constraints, but defensive against a future schema loosening that) sorts LAST among
 * the real groups instead of first. Plain `localeCompare` would put `''` ahead of every real
 * label, opening the list with a blank-looking lane — the same mistake `WorkTableView.tsx`'s
 * `compareText`/`textOf` already guards against for an absent text column, applied here to the
 * same kind of "nothing to show" value.
 */
function compareLaneLabel(a: Lane, b: Lane): number {
  if (a.label === '' || b.label === '') {
    if (a.label === b.label) return 0;
    return a.label === '' ? 1 : -1;
  }
  return a.label.localeCompare(b.label);
}

/**
 * `context !== 'all'` lane grouping (§16b/§16c, Task 39): one lane per distinct real group
 * (grouped and keyed by id, never by label, so two same-named groups are never merged),
 * labelled with that group's display label and sorted alphabetically by it — the only
 * deterministic ordering signal available for courses/projects/organizations/areas, absent a
 * stored display order — plus one trailing "Unassigned" lane, appended only when at least one
 * item actually has no group under this context (never rendered empty). Every lane's `plotted`
 * list runs through the exact same `plot()` used for My Work's lanes.
 */
function buildContextLanes(items: WorkItem[], context: WorkContext, weekStart: string): Lane[] {
  const groups = new Map<number | string, { label: string; items: WorkItem[] }>();
  const unassigned: WorkItem[] = [];

  for (const item of items) {
    const group = groupOf(item, context);
    if (group === null) {
      unassigned.push(item);
      continue;
    }
    const bucket = groups.get(group.id);
    if (bucket) {
      bucket.items.push(item);
    } else {
      groups.set(group.id, { label: group.label, items: [item] });
    }
  }

  const toLane = (key: string, label: string, laneItems: WorkItem[]): Lane => ({
    key, label, hue: null, // form 5: no per-lane tint — the hue moves to the lane-stack edge
    plotted: laneItems.map(item => plot(item, weekStart)).filter((p): p is Plotted => p !== null),
  });

  const lanes = Array.from(groups.entries())
    .map(([id, { label, items: laneItems }]) => toLane(String(id), label, laneItems))
    .sort(compareLaneLabel);

  if (unassigned.length > 0) {
    lanes.push(toLane('unassigned', 'Unassigned', unassigned));
  }

  return lanes;
}

export interface WorkTimelineViewProps {
  /** Already filtered by category and search — see `WorkboardShell`'s `visibleItems`. */
  items:     WorkItem[];
  /** "YYYY-MM-DD" — `work.week_start`, the Monday the four-week axis starts from. */
  weekStart: string;
  /** "YYYY-MM-DD" — `work.generated_at`, used only to place the today marker. */
  today:     string;
  /** True when the shell's category tab or search query is currently narrowing `items` —
   *  same distinction `WorkListView`/`WorkBoardView` make, so a filtered-to-nothing timeline
   *  reads as "no matches" rather than wrongly telling the user their dated items lack dates. */
  isFiltered?: boolean;
  /** The same value `visibleItems` is filtered by — `'all'` under My Work, one context under a
   *  tab. Deliberately REQUIRED, not optional: `WorkBoardView`'s equivalent prop shipped
   *  optional in Task 16, and its own history is on record for the consequence — an optional
   *  prop let the shell's call site forget to pass it, and `tsc` had nothing to catch that, so
   *  the Board silently kept showing My Work's shape under every tab until manual testing caught
   *  it. Required here means the same mistake fails the build instead of shipping quietly. */
  context: TimelineContext;
}

export default function WorkTimelineView({ items, weekStart, today, isFiltered, context }: WorkTimelineViewProps) {
  // Direction doc §5d: the *legitimately*-empty condition is "no item has a start_date or
  // due_at" — checked against the raw field presence, not against whether anything actually
  // plots in this particular four-week window (a fully-dated backlog with nothing due in the
  // next month is a different, unremarkable situation the axis can render as-is).
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

  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(weekStart, i));
  const todayIdx = dayIndex(weekStart, today);
  const totalWidth = WINDOW_DAYS * DAY_WIDTH;

  // §16b/§16c (Task 39): My Work keeps the four fixed context lanes, form 4 (per-lane tint,
  // untouched below); a single context regroups by that context's own id field instead, form 5
  // (no per-lane tint — see `buildContextLanes` and the lane-stack edge on the wrapper below).
  const lanes: Lane[] = context === 'all'
    ? WORK_CATEGORIES.map(category => ({
        category,
        plotted: items
          .filter(item => item.category === category)
          .map(item => plot(item, weekStart))
          .filter((p): p is Plotted => p !== null),
      })).map(({ category, plotted }) => ({
        key:   category,
        label: CATEGORY_LABEL[category],
        hue:   CATEGORY_HUE[category],
        plotted,
      }))
    : buildContextLanes(items, context, weekStart);

  return (
    // Scroll container, not the page: must be reachable and operable by keyboard alone, since
    // on any viewport narrower than `totalWidth` the four-week axis extends past the fold.
    // Matches `WorkTableView.tsx`'s `.vb-table-scroll` treatment exactly (role/aria-label/
    // tabIndex + a `:focus-visible` outline supplied via the stylesheet below — `outline` must
    // never be set inline here, or it becomes another dead-CSS instance).
    <div
      className="vb-timeline"
      style={{ overflowX: 'auto', paddingBottom: '4px' }}
      role="region"
      aria-label="Timeline"
      tabIndex={0}
    >
      <div style={{ position: 'relative', width: `${totalWidth}px`, minWidth: '100%' }}>
        {/* Date header row — weekday + day-of-month per column, micro-label style (§1). */}
        <div style={{ display: 'flex', height: `${HEADER_HEIGHT}px` }}>
          {days.map(d => {
            const date = new Date(`${d}T00:00:00Z`);
            const isToday = d === today;
            return (
              <div
                key={d}
                style={{
                  width: `${DAY_WIDTH}px`, flexShrink: 0, textAlign: 'center',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                }}
              >
                <span style={{
                  fontFamily: DM_FONT, fontSize: '0.68rem', fontWeight: 800,
                  color: isToday ? '#256f92' : '#8a94a6', textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {date.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' })}
                </span>
                <span style={{ fontFamily: FONT, fontSize: '0.72rem', fontWeight: 600, color: '#5c6b80' }}>
                  {date.getUTCDate()}
                </span>
              </div>
            );
          })}
        </div>

        {/* Today marker: 2px line + flag, spanning the lane stack only (not the header row). */}
        {todayIdx >= 0 && todayIdx < WINDOW_DAYS && (
          <div
            aria-hidden
            style={{
              position: 'absolute', top: `${HEADER_HEIGHT}px`, bottom: 0,
              left: `${todayIdx * DAY_WIDTH + DAY_WIDTH / 2}px`, width: '2px',
              background: '#74bcd9', zIndex: 5, pointerEvents: 'none',
            }}
          >
            <span style={{
              position: 'absolute', top: 0, left: 0, transform: 'translateX(-50%)',
              background: '#74bcd9', color: '#fff', fontFamily: FONT, fontSize: '0.62rem',
              fontWeight: 800, padding: '2px 8px', borderRadius: '0 0 6px 6px', whiteSpace: 'nowrap',
            }}>
              Today
            </span>
          </div>
        )}

        {/* The lane-stack edge (form 5, §16b/§16c): the active context's hue as a 2px line,
            painted as its own absolutely-positioned overlay — the exact pattern the today-marker
            above already uses — rather than a `border-left` on the lane-stack wrapper below.
            A real border sits inside the wrapper's own box and would push every bar/marker's
            `left: dayIndex * DAY_WIDTH` (computed relative to this same wrapper) 2px right of
            its true day column, while the header row and the today-marker — siblings outside
            the wrapper — would stay put: a 2px misalignment between the axis and every bar,
            live only in this mode. An overlay paints without touching layout, so the wrapper
            stays exactly as unstyled here as it is for My Work, and every bar/marker/today-line
            keeps the same origin in both modes. */}
        {context !== 'all' && (
          <div
            aria-hidden
            style={{
              position: 'absolute', top: `${HEADER_HEIGHT}px`, bottom: 0, zIndex: 4,
              left: 0, width: '2px', background: CATEGORY_HUE[context], pointerEvents: 'none',
            }}
          />
        )}

        {/* Lanes. Under My Work: one per fixed context, each carrying its own tint (form 4).
            Under a single context: one per group of that context (course/project/organization/
            area) plus a trailing Unassigned lane when needed, none tinted — the active
            context's hue is painted separately, above, as the lane-stack edge overlay. */}
        <div>
          {lanes.map(({ key, label, hue, plotted }) => (
            <div
              key={key}
              style={{
                position: 'relative', minHeight: '44px',
                background: hue !== null ? `${hue}08` : undefined,
                borderBottom: '1px solid rgba(200,210,230,0.25)',
              }}
            >
              {/* P3-3: a bar starting on the first visible day (`left: 0`) can vertically
                  intersect this label's box, and bars carry no z-index, so the label needs a
                  solid backing to stay legible rather than letting a bar's fill show through
                  around its glyphs. `#fbfbfd` is this module's established off-white solid-panel
                  surface colour; kept small so it still reads as a label, not a stray rectangle. */}
              <span style={{
                position: 'absolute', left: '8px', top: '4px', zIndex: 2,
                fontFamily: DM_FONT, fontSize: '0.68rem', fontWeight: 800, color: '#8a94a6',
                textTransform: 'uppercase', letterSpacing: '0.04em', pointerEvents: 'none',
                background: '#fbfbfd', padding: '1px 4px', borderRadius: '4px',
              }}>
                {label}
              </span>

              {plotted.map(p => {
                const color = EDGE_COLOR[p.item.priority];
                if (p.kind === 'bar') {
                  // P1-1: the title always renders outside the bar, in the page-background
                  // `#2d3748` treatment. An in-bar white label was previously shown for bars
                  // wide enough to fit it (`width >= 60`), but white-on-fill computed to
                  // 1.73:1 (normal priority) and 1.40:1 (low) against WCAG AA's 4.5:1 — a
                  // failure on the common case, since normal is the default priority. The
                  // bar's fill colour itself stays (it is non-text decoration at 3:1+); only
                  // the label's position is now unconditional, matching the one treatment that
                  // already passed contrast.
                  return (
                    <div
                      key={itemKey(p.item)}
                      title={p.item.title}
                      style={{
                        position: 'absolute', left: `${p.left}px`, width: `${p.width}px`, height: '22px',
                        top: '50%', transform: 'translateY(-50%)', borderRadius: '6px',
                        background: color, border: `1.5px solid ${darken(color, 0.2)}`,
                        boxSizing: 'border-box',
                      }}
                    >
                      <span style={{
                        position: 'absolute', left: `${p.width + 6}px`, top: '50%', transform: 'translateY(-50%)',
                        fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700, color: '#2d3748',
                        whiteSpace: 'nowrap',
                      }}>
                        {p.item.title}
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    key={itemKey(p.item)}
                    title={p.item.title}
                    style={{
                      position: 'absolute', left: `${p.left}px`, width: `${DAY_WIDTH}px`,
                      top: '50%', transform: 'translateY(-50%)',
                      display: 'flex', justifyContent: 'center',
                    }}
                  >
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <style jsx>{`
        .vb-timeline:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
