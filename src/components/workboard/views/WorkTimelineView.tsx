'use client';

import { CalendarRange } from 'lucide-react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope
// for its DB-access exports, so a runtime import here would drag mysql2 into this client
// bundle (see WorkboardShell.tsx's, WorkItemRow.tsx's, and WorkBoardView.tsx's comments on the
// same hazard — it has broken `/workboard` twice already).
import type { WorkItem } from '@/lib/workboard/workItems';
import { WORK_CATEGORIES, type WorkCategory } from '@/lib/workboard/workCategories';
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

export interface WorkTimelineViewProps {
  /** Already filtered by category and search — see `WorkboardShell`'s `visibleItems`. */
  items:     WorkItem[];
  /** "YYYY-MM-DD" — `work.week_start`, the Monday the four-week axis starts from. */
  weekStart: string;
  /** "YYYY-MM-DD" — `work.generated_at`, used only to place the today marker. */
  today:     string;
}

export default function WorkTimelineView({ items, weekStart, today }: WorkTimelineViewProps) {
  // Direction doc §5d: the *legitimately*-empty condition is "no item has a start_date or
  // due_at" — checked against the raw field presence, not against whether anything actually
  // plots in this particular four-week window (a fully-dated backlog with nothing due in the
  // next month is a different, unremarkable situation the axis can render as-is).
  const hasAnyDate = items.some(item => item.start_date !== null || item.due_at !== null);

  if (!hasAnyDate) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <CalendarRange size={48} color="#9aa4b5" style={{ marginBottom: '14px' }} />
        <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
          Nothing scheduled yet
        </h2>
        <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: 0 }}>
          Timeline needs a due date or start date to plot something — add one from the List view.
        </p>
      </div>
    );
  }

  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(weekStart, i));
  const todayIdx = dayIndex(weekStart, today);
  const totalWidth = WINDOW_DAYS * DAY_WIDTH;

  const lanes = WORK_CATEGORIES.map(category => ({
    category,
    plotted: items
      .filter(item => item.category === category)
      .map(item => plot(item, weekStart))
      .filter((p): p is Plotted => p !== null),
  }));

  return (
    <div className="vb-timeline" style={{ overflowX: 'auto', paddingBottom: '4px' }}>
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

        {/* Lanes — one per category, fixed order. */}
        <div>
          {lanes.map(({ category, plotted }) => (
            <div
              key={category}
              style={{
                position: 'relative', minHeight: '44px',
                background: `${CATEGORY_HUE[category]}08`,
                borderBottom: '1px solid rgba(200,210,230,0.25)',
              }}
            >
              <span style={{
                position: 'absolute', left: '8px', top: '4px', zIndex: 2,
                fontFamily: DM_FONT, fontSize: '0.68rem', fontWeight: 800, color: '#8a94a6',
                textTransform: 'uppercase', letterSpacing: '0.04em', pointerEvents: 'none',
              }}>
                {CATEGORY_LABEL[category]}
              </span>

              {plotted.map(p => {
                const color = EDGE_COLOR[p.item.priority];
                if (p.kind === 'bar') {
                  const labelFits = p.width >= 60;
                  return (
                    <div
                      key={itemKey(p.item)}
                      title={p.item.title}
                      style={{
                        position: 'absolute', left: `${p.left}px`, width: `${p.width}px`, height: '22px',
                        top: '50%', transform: 'translateY(-50%)', borderRadius: '6px',
                        background: color, border: `1.5px solid ${darken(color, 0.2)}`,
                        display: 'flex', alignItems: 'center', overflow: 'hidden',
                        paddingLeft: labelFits ? '6px' : 0, boxSizing: 'border-box',
                      }}
                    >
                      {labelFits ? (
                        <span style={{
                          fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700, color: '#fff',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {p.item.title}
                        </span>
                      ) : (
                        <span style={{
                          position: 'absolute', left: `${p.width + 6}px`, top: '50%', transform: 'translateY(-50%)',
                          fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700, color: '#2d3748',
                          whiteSpace: 'nowrap',
                        }}>
                          {p.item.title}
                        </span>
                      )}
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
    </div>
  );
}
