'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Link2, SearchX, Table2 } from 'lucide-react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope,
// so a *value* import here would drag the driver into this client bundle and 500 the page.
// Same hazard documented in `WorkboardShell.tsx`, `WorkItemRow.tsx` and `WorkBoardView.tsx`.
import type { WorkItem } from '@/lib/workboard/workItems';
// Pool-free by construction (`workContexts.ts` has no imports at all), so these are safe as
// runtime imports from a client component.
import {
  CONTEXT_LABELS, STAGES_BY_CONTEXT, STAGE_LABELS, normaliseStage,
  type WorkContext, type WorkStage, type WorkStatus,
} from '@/lib/workboard/workContexts';
// Task 17's column projections. Also pool-free: its only runtime imports are `workContexts`
// and `dueSemantics`, and `dueSemantics` reaches only the import-free `dates.ts`.
import { COLUMNS_BY_CONTEXT, cellValue, type ColumnKey, type TableColumn } from '@/lib/workboard/tableColumns';
import { dueStateOf, type DueState } from '@/lib/workboard/dueSemantics';
// Pool-free by design — see the module header in `dates.ts` for the incident that put it there.
import { dueDateOf } from '@/lib/workboard/dates';
// Task 20's one interactive cell. It owns its own `<td>` — partly so its select's hover and
// focus rules can live in the same component (styled-jsx scopes per component, so they would
// match nothing from here), partly so the vertical padding that keeps a 26px control from
// inflating the row is decided next to the control that sets the height.
import StatusCell from '../table/StatusCell';

const FONT    = "'Inter','DM Sans','Segoe UI',sans-serif";
const DM_FONT = "'DM Sans','Segoe UI',sans-serif";

/** `'all'` is the shell's My Work tab — every context at once. Mirrors `WorkBoardView`'s
 *  `BoardContext`, and takes the same value from the same shell state. */
export type TableContext = WorkContext | 'all';

/** Direction doc §4: the coloured left edge renders on every row, always, keyed by priority.
 *  Values copied from `WorkItemRow.tsx`/`WorkBoardView.tsx` so "that pink-red edge means high"
 *  reads identically across Focus, Board and Table. */
const EDGE_COLOR: Record<WorkItem['priority'], string> = {
  high:   '#e0607c',
  normal: '#b8c6da',
  low:    '#d3dbe6',
};

/** §4's second half: a pill renders if and only if `priority === 'high'`. `normal`/`low` still
 *  need *something* in a column literally headed "Priority" — an em dash there would report a
 *  real, set value as absent, which is the one thing §7's "never blank" rule exists to prevent —
 *  so they render as plain meta text rather than as a muted pill. The rule §4 is protecting is
 *  "no pill on two-thirds of rows", and plain text does not reintroduce that noise. */
const PRIORITY_LABEL: Record<WorkItem['priority'], string> = {
  high:   'High',
  normal: 'Normal',
  low:    'Low',
};

/** The Deadline cell's colour, keyed by the same `DueState` the rest of the module uses, so the
 *  Table cannot contradict Focus about whether a date is late. Values are `WorkItemRow.tsx`'s
 *  `META_COLOR` exactly: §6's overdue red, §2a's darkened amber (the only AA-passing amber text
 *  colour in this system) for completed-late, §1's ordinary meta colour otherwise. */
const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** The textual half of the lateness signal. In Focus the colour is a *second* cue because
 *  `formatDueLabel` already puts "Overdue" in the string; the Table's Deadline cell is a
 *  bare date, so without this the state would be conveyed by colour alone — unreadable to a
 *  screen reader and to anyone with a red deficiency. The Status column shows the stage,
 *  not lateness, so it cannot stand in. */
const DEADLINE_SR_SUFFIX: Partial<Record<DueState, string>> = {
  overdue:        ' (overdue)',
  completed_late: ' (completed late)',
};

const DEADLINE_COLOR: Record<DueState, string> = {
  none:           '#5c6b80',
  upcoming:       '#5c6b80',
  due_today:      '#5c6b80',
  completed:      '#5c6b80',
  completed_late: '#8a5010',
  overdue:        '#922e48',
};

const DASH = '—';

const DIVIDER = '1px solid rgba(200,210,230,0.35)';

/** `work_stage` is typed `WorkStage` but stored in a free-form `VARCHAR(24)`, so the type is a
 *  compile-time assertion over DB text rather than a runtime guarantee. Falling back to
 *  `work_status` keeps a row with an unrecognised stage showing a real label instead of a blank
 *  Status cell; every `WorkStatus` is itself a legal stage in every context. Deliberately a
 *  local copy of `WorkBoardView`'s helper of the same name — that one is not exported, and this
 *  view needs no other part of the Board's column machinery. */
function stageOf(item: WorkItem): WorkStage {
  const raw: string = item.work_stage;
  return raw in STAGE_LABELS ? (raw as WorkStage) : item.work_status;
}

function itemKey(item: Pick<WorkItem, 'source' | 'id'>): string {
  return `${item.source}-${item.id}`;
}

/* ─── Sorting ──────────────────────────────────────────────────────────────────────────
 * Everything below sorts *items*. It never touches `columns`: `COLUMNS_BY_CONTEXT`'s arrays
 * and their `TableColumn` objects are shared by reference across contexts (`WORK` is the
 * same object in four of them), so an in-place sort of a column array would reorder every
 * other context's header row for the rest of the session — a bug that would only surface
 * after switching tabs. `tableColumns.ts` marks them `readonly` to make that a build error.
 */

type SortDir = 'asc' | 'desc';

/** `null` — the state, not a member of this type — means "no explicit sort", which is where
 *  the third click on a column lands. The cycle is ascending → descending → default order,
 *  not a two-state flip that can never be undone. */
interface SortState {
  key: ColumnKey;
  dir: SortDir;
}

/** A comparator takes the direction rather than being wrapped in a `-1 *` at the call site,
 *  because two of the rules are deliberately direction-*independent*: an item with no
 *  deadline and an item with no estimate sort last ascending AND descending. Negating a
 *  whole comparator to get the descending pass would float exactly those to the top.
 *  Every comparator returns a number for every pair, including two absent values (0). */
type Comparator = (a: WorkItem, b: WorkItem, dir: SortDir) => number;

const signed = (result: number, dir: SortDir): number => (dir === 'asc' ? result : -result);

/** Builds a comparator over a *present* value, with absent values pinned last in both
 *  directions. The direction is applied only to the value-vs-value result and never to the
 *  null branches — that asymmetry is the entire point of this helper. */
function nullsLast<T>(
  read: (item: WorkItem) => T | null,
  compare: (a: T, b: T) => number,
): Comparator {
  return (a, b, dir) => {
    const va = read(a);
    const vb = read(b);
    if (va === null) return vb === null ? 0 : 1;
    if (vb === null) return -1;
    return signed(compare(va, vb), dir);
  };
}

/** ISO-ish "YYYY-MM-DD" strings compare correctly as plain strings; `localeCompare` would
 *  work too but costs a collator for values that are pure digits and hyphens. */
const compareIso = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Ruling 5. `dueDateOf` returns null for an undated item, and `nullsLast` keeps it below
 *  every dated one in both directions — an item with no deadline is not "earliest". */
const compareDeadline: Comparator = nullsLast(dueDateOf, compareIso);

/** `cellValue` renders an absent text value as an em dash, and an em dash is punctuation,
 *  which `localeCompare` sorts *before* every letter — so comparing the rendered string
 *  directly would open the ascending pass with a block of blank-looking cells. That is the
 *  same mistake ruling 5 names for deadlines, so the dash reads as absent here and the row
 *  pins last in both directions; real values still compare with `localeCompare`. */
function textOf(item: WorkItem, key: ColumnKey): string | null {
  const value = cellValue(item, key);
  return value === null || value === DASH ? null : value;
}

const compareText = (key: ColumnKey): Comparator =>
  nullsLast(item => textOf(item, key), (a, b) => a.localeCompare(b));

/** High → normal → low ascending, which is the order the column is actually read in. */
const PRIORITY_RANK: Record<WorkItem['priority'], number> = { high: 0, normal: 1, low: 2 };

/** My Work mixes all four stage vocabularies, and they have no common order — `submitted`
 *  and `review` are not comparable — so it sorts by the normalised three-value status, the
 *  one vocabulary every context shares. A single context sorts by its own stage list. */
const NORMALISED_ORDER: readonly WorkStatus[] = ['todo', 'in_progress', 'done'];

function statusRank(item: WorkItem, context: TableContext): number {
  const stage = stageOf(item);
  if (context === 'all') return NORMALISED_ORDER.indexOf(normaliseStage(stage));
  const order = STAGES_BY_CONTEXT[context];
  const index = order.indexOf(stage);
  // `work_stage` is a free-form VARCHAR(24), so a stage outside its context's vocabulary is
  // storable. `indexOf`'s -1 would sort such a row *above* every legal stage; ranking it
  // past the end keeps the comparator total without inventing a position for it.
  return index === -1 ? order.length : index;
}

/** Per column key, never generic — the point of the whole exercise is that `deadline`,
 *  `status` and `priority` each mean something the rendered string does not. */
function comparatorFor(key: ColumnKey, context: TableContext): Comparator {
  switch (key) {
    case 'work':     return (a, b, dir) => signed(a.title.localeCompare(b.title), dir);
    case 'status':   return (a, b, dir) => signed(statusRank(a, context) - statusRank(b, context), dir);
    // `?? PRIORITY_RANK.normal` for the same reason `statusRank` maps an unknown stage to
    // `order.length`: an out-of-union stored value would otherwise index to `undefined`, and
    // `undefined - n` is `NaN`, which a comparator returns as an arbitrary order rather than
    // an error. The POST route whitelists priority, so this needs hand-edited data.
    case 'priority': return (a, b, dir) => signed(
      (PRIORITY_RANK[a.priority] ?? PRIORITY_RANK.normal) - (PRIORITY_RANK[b.priority] ?? PRIORITY_RANK.normal),
      dir,
    );
    case 'deadline': return compareDeadline;
    // Sorted on the stored "HH:MM:SS", not on the rendered "11:59 PM" — 12-hour text sorts
    // "11:59 PM" above "9:00 AM", which is exactly backwards. Absent times pin last.
    case 'time':     return nullsLast(item => item.deadline_time, compareIso);
    case 'estimate': return nullsLast(item => item.estimated_hours, (a, b) => a - b);
    // Zero links is a real value, not an absent one, so this is a plain numeric compare.
    case 'links':    return (a, b, dir) => signed(a.link_count - b.link_count, dir);
    case 'context':
    case 'course':
    case 'organization':
    case 'area':
    case 'project':  return compareText(key);
    default: {
      // A thirteenth `ColumnKey` fails the build here rather than silently sorting by nothing.
      const unhandled: never = key;
      return unhandled;
    }
  }
}

/** The order with no column selected: overdue first, then deadline ascending, undated last —
 *  Focus's intuition, so switching views does not reshuffle the same work.
 *
 *  The overdue rank is not redundant with deadline-ascending: `dueStateOf` calls a *done*
 *  item with a past deadline `completed`/`completed_late`, never `overdue`, so on deadline
 *  alone last month's finished work would sit above this week's genuinely late work. */
function defaultComparator(todayStr: string): (a: WorkItem, b: WorkItem) => number {
  return (a, b) => {
    const ra = dueStateOf(a, todayStr) === 'overdue' ? 0 : 1;
    const rb = dueStateOf(b, todayStr) === 'overdue' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return compareDeadline(a, b, 'asc');
  };
}

export interface WorkTableViewProps {
  /** Already filtered by category and search — see `WorkboardShell`'s `visibleItems`. */
  items:       WorkItem[];
  /** The shell's active context tab, `'all'` for My Work. Drives the whole column set: the user
   *  never configures a column (spec §7, §34), the context decides them. */
  context:     TableContext;
  /** "YYYY-MM-DD" — `work.generated_at`, so every row agrees with Focus on what "today" is. */
  todayStr:    string;
  /** True when the shell's context tab *or* its search box is currently narrowing `items` —
   *  the same signal `WorkListView`/`WorkBoardView` take, kept so the three views' prop shapes
   *  stay recognisably the same. */
  isFiltered?: boolean;
  /** True when the search box specifically is narrowing `items`. This view needs the narrower
   *  signal because it has three empty states, not two: `isFiltered` alone cannot tell "this
   *  context has no work yet" (offer the create button) apart from "your search matched nothing
   *  inside this context" (offering a create button there would be wrong advice), since
   *  `isFiltered` is true for *any* non-My-Work tab. */
  isSearching?: boolean;
  /** Re-pulls the whole work payload after an inline mutation, so the stats, the workload
   *  chart and every other view reconcile with what the Status cell just wrote. Tasks 21–24
   *  take the same prop for priority, links and the detail panel. */
  onChanged:   () => void | Promise<void>;
  /** Opens the create/edit dialog in create mode — wired to this view's own empty states. */
  onNewItem:   () => void;
}

export default function WorkTableView({
  items, context, todayStr, isFiltered, isSearching, onChanged, onNewItem,
}: WorkTableViewProps) {
  // Never sorted or filtered in place — `COLUMNS_BY_CONTEXT`'s arrays and their `TableColumn`
  // objects are `readonly` precisely because the same object is shared across contexts, and a
  // write through one would corrupt the others for the rest of the session. Sorting reorders
  // the rows below, never this array.
  const columns: readonly TableColumn[] = COLUMNS_BY_CONTEXT[context];

  // Both hooks sit above the three empty-state returns: a `return` before a hook is the one
  // way to break the rules of hooks in a component that otherwise looks linear.
  const [sort, setSort] = useState<SortState | null>(null);

  // The sort a column *no longer present in this context* would apply is derived away rather
  // than cleared: switching from Projects (sorted by Estimate) to Academic, which has no
  // Estimate column, would otherwise leave rows in an order no visible header explains, since
  // `aria-sort` lives on a header that is gone. Deriving rather than clearing in an effect
  // avoids an extra render pass and a one-frame flash of the stale order — and it restores
  // the sort if the user switches back to a context that does have the column.
  const activeSort = sort !== null && columns.some(c => c.key === sort.key) ? sort : null;

  const sortedItems = useMemo(() => {
    // `[...items]` on every path. `Array.prototype.sort` sorts in place and `items` is a
    // prop — sorting it directly would mutate the shell's memoised `visibleItems` array,
    // which React would not see as a change, so other views would render stale order.
    // The copy is also why stability is safe to rely on: V8's sort is stable, and every
    // comparator returns 0 for a tie rather than inventing a tiebreak, so equal rows keep
    // the order they arrived in.
    const rows = [...items];
    if (activeSort === null) return rows.sort(defaultComparator(todayStr));
    const compare = comparatorFor(activeSort.key, context);
    return rows.sort((a, b) => compare(a, b, activeSort.dir));
  }, [items, activeSort, context, todayStr]);

  /** Ascending → descending → back to the default order. The third click clears the sort
   *  rather than re-sorting ascending, so the default is reachable without a page reload. */
  const toggleSort = (key: ColumnKey) => {
    setSort(current => {
      if (current === null || current.key !== key) return { key, dir: 'asc' };
      return current.dir === 'asc' ? { key, dir: 'desc' } : null;
    });
  };

  // Three distinct empty states, resolved in this order:
  //   1. nothing is narrowing the view at all      -> the board itself is empty
  //   2. a search is running                       -> nothing matched it
  //   3. only the context tab is narrowing         -> that context has no work yet
  // The `context === 'all'` disjunct in test 2 is unreachable at runtime (if `isFiltered` is
  // true and `isSearching` is false, the tab must be a real context) but it is what narrows
  // `context` from `TableContext` to `WorkContext` for case 3's `CONTEXT_LABELS` lookup, so the
  // label cannot be indexed with `'all'`.
  if (items.length === 0) {
    if (!isFiltered) {
      // Nothing at all. `WorkListView`'s copy, unchanged — this is the board-level statement
      // "you have no work", not a Table-flavoured one.
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <CheckCircle2 size={56} color="#74bcd9" style={{ marginBottom: '14px' }} />
          <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
            Nothing on your plate
          </h2>
          <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: '0 0 18px' }}>
            Add your first work item to get started.
          </p>
          <button type="button" className="vb-btn-pink" onClick={onNewItem} style={{ width: 'auto', padding: '10px 22px' }}>
            New Work Item
          </button>
        </div>
      );
    }

    if (isSearching || context === 'all') {
      // Wording taken verbatim from `WorkListView`/`WorkBoardView`'s filtered empty state.
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <SearchX size={48} color="#9aa4b5" style={{ marginBottom: '14px' }} />
          <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
            No matching work items
          </h2>
          <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: 0 }}>
            Try a different category or search term.
          </p>
        </div>
      );
    }

    // Only the context tab is narrowing, and `context` has narrowed to `WorkContext` with it —
    // the two tests above are what make the `CONTEXT_LABELS` lookup below type-check.
    // New to Table: a context the user has simply not put any work into yet. Distinct from the
    // two states above because the fix *is* available from this view — direction doc §5e only
    // grants an action button when that is true — so this one offers New Work Item.
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <Table2 size={48} color="#9aa4b5" style={{ marginBottom: '14px' }} />
        <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
          Nothing in {CONTEXT_LABELS[context]} yet
        </h2>
        <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: '0 0 18px' }}>
          Work items you add under this context will appear here as rows.
        </p>
        <button type="button" className="vb-btn-pink" onClick={onNewItem} style={{ width: 'auto', padding: '10px 22px' }}>
          New Work Item
        </button>
      </div>
    );
  }

  return (
    // The scroll container, not the page, is what the sticky header sticks inside — and it is
    // focusable with a name because a scrollable region must be reachable by keyboard alone.
    <div
      className="vb-table-scroll"
      role="region"
      aria-label="Work items table"
      tabIndex={0}
      style={{ maxHeight: '68vh', overflow: 'auto', borderRadius: '12px' }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
        <caption
          style={{
            position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
            overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
          }}
        >
          {context === 'all' ? 'All work items' : `${CONTEXT_LABELS[context]} work items`}
        </caption>
        <thead>
          <tr>
            {columns.map(col => {
              // `null` when this column is not the sorted one — which is also what makes
              // `aria-sort` *absent* rather than `"none"` on the other eleven headers.
              // `activeSort`, not `sort`: the header must agree with the order actually
              // applied, so a sort derived away by a context switch shows no caret either.
              const dir: SortDir | null = activeSort !== null && activeSort.key === col.key ? activeSort.dir : null;
              return (
              // `position: sticky` lives on the `<th>`, never on `<thead>` — sticky on a
              // table section is unreliable across browsers, on the cells it is not.
              <th
                key={col.key}
                scope="col"
                // Set on the active column only. This attribute — not the caret — is what
                // makes the sort perceivable to a screen reader; the caret is `aria-hidden`
                // decoration on top of it. `"none"` on every other header would announce
                // twelve sort states per row of headers, so the others carry nothing.
                aria-sort={dir === null ? undefined : dir === 'asc' ? 'ascending' : 'descending'}
                style={{
                  position: 'sticky', top: 0, zIndex: 1,
                  textAlign: col.align === 'right' ? 'right' : 'left',
                  // Vertical padding moved onto the button so the whole 27px-tall strip is
                  // the click target (WCAG 2.2 Target Size wants ≥24px) rather than a 13px
                  // ribbon of text inside a padded cell. 2 + 7 + 7 + 2 keeps the header's
                  // rendered height exactly where it was.
                  padding: '2px 12px', whiteSpace: 'nowrap',
                  background: 'rgba(255,255,255,0.95)',
                  // An inset shadow, not `borderBottom`: under `border-collapse: collapse`
                  // the border belongs to the table rather than the cell, so it does not
                  // travel with a sticky `<th>` — on scroll the background would stick while
                  // the rule scrolled away, leaving the header sitting on rows undivided.
                  boxShadow: 'inset 0 -1px 0 rgba(200,210,230,0.55)',
                }}
              >
                {/* A real `<button>`, not an `onClick` on the `<th>`: a click handler on a
                    cell is not keyboard reachable and is announced as static text, so the
                    sort would exist only for mouse users. */}
                <button
                  type="button"
                  // Without this the accessible name is the bare column label — and since
                  // `aria-sort` is correctly absent on inactive headers, a screen-reader user
                  // tabbing the header row gets no cue that the button sorts at all. The
                  // visible label is contained in the name, so WCAG 2.5.3 still holds.
                  aria-label={`Sort by ${col.label}`}
                  className={dir === null ? 'vb-th-sort' : 'vb-th-sort vb-th-sort-on'}
                  onClick={() => toggleSort(col.key)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    padding: '7px 0', border: 'none', background: 'none', cursor: 'pointer',
                    // Typography stated rather than inherited: a `<button>`'s UA style
                    // overrides the inherited font, so leaving it off would drop the header
                    // to 13px Arial. §1's micro-label, unchanged from before this task.
                    fontFamily: DM_FONT, fontSize: '0.68rem', fontWeight: 800,
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                    // Colour is deliberately NOT set here — it lives in the styled-jsx rules
                    // below, because an inline colour would win over `:hover`.
                  }}
                >
                  {col.label}
                  {/* The slot is always rendered, empty when inactive, so toggling a caret
                      in and out cannot change a column's width and shift the whole table. */}
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      flex: '0 0 12px', width: '12px', height: '12px',
                    }}
                  >
                    {dir === 'asc'  ? <ChevronUp   size={12} strokeWidth={2.75} /> : null}
                    {dir === 'desc' ? <ChevronDown size={12} strokeWidth={2.75} /> : null}
                  </span>
                </button>
              </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item, rowIdx) => {
            const isLast  = rowIdx === sortedItems.length - 1;
            const isDone  = item.work_status === 'done';
            const divider = isLast ? 'none' : DIVIDER;

            return (
              <tr key={itemKey(item)} className="vb-table-row">
                {columns.map((col, colIdx) => {
                  const value = cellValue(item, col.key);

                  const base: React.CSSProperties = {
                    // Denser than Focus's 56px row (§27: tighter than Rituals or Finance) — the
                    // table has no per-row card and no checkbox column to pad around.
                    padding: '7px 12px',
                    borderBottom: divider,
                    // §4's priority edge, drawn as the first cell's left border rather than an
                    // absolutely-positioned span: a `<td>` is not a positioning context by
                    // default, and a border keeps the markup free of decorative elements.
                    borderLeft: colIdx === 0 ? `3px solid ${EDGE_COLOR[item.priority]}` : undefined,
                    textAlign: col.align === 'right' ? 'right' : 'left',
                    verticalAlign: 'middle',
                    whiteSpace: 'nowrap',
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    color: '#5c6b80',
                  };

                  // `cellValue` returns a string for every value column and `null` for exactly
                  // the four that need a component (`work`, `status`, `priority`, `links`).
                  // Switching on the key rather than on `value === null` is what buys the
                  // exhaustiveness check below: a thirteenth `ColumnKey` fails the build here
                  // instead of silently rendering an em dash.
                  switch (col.key) {
                    case 'work':
                      return (
                        <td key={col.key} style={{ ...base, whiteSpace: 'normal' }}>
                          {/* Truncation lives on an inner block, not the cell: `max-width` on a
                              `<td>` under `table-layout: auto` is only a hint, on a block child
                              it is honoured. Task 22 turns this into the detail-view trigger. */}
                          <span
                            title={item.title}
                            style={{
                              display: 'block', maxWidth: '340px', overflow: 'hidden',
                              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              fontSize: '0.88rem', fontWeight: 600,
                              color: isDone ? '#9aa4b5' : '#2d3748',
                              textDecoration: isDone ? 'line-through' : 'none',
                            }}
                          >
                            {item.title}
                          </span>
                        </td>
                      );

                    case 'status':
                      // The cell offers the *item's own* context's stages, not this table's —
                      // five options on an Academic row and three on a Life row even when the
                      // two sit side by side under My Work. The displayed value has always
                      // followed the item's own stage (`stageOf`, still the cell's own
                      // fallback); the editable vocabulary now matches it.
                      return (
                        <StatusCell key={col.key} item={item} style={{ ...base, fontWeight: 600 }} onChanged={onChanged} />
                      );

                    case 'priority':
                      return (
                        <td key={col.key} style={base}>
                          {item.priority === 'high' ? (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', borderRadius: '999px',
                              padding: '2px 9px', background: 'rgba(224,96,124,0.15)', color: '#922e48',
                              fontSize: '0.64rem', fontWeight: 700, textTransform: 'uppercase',
                              letterSpacing: '0.03em',
                            }}>
                              {PRIORITY_LABEL.high}
                            </span>
                          ) : (
                            PRIORITY_LABEL[item.priority]
                          )}
                        </td>
                      );

                    case 'links':
                      return (
                        <td key={col.key} style={base}>
                          {item.link_count > 0 ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                              <Link2 size={13} aria-hidden />
                              {item.link_count}
                            </span>
                          ) : DASH}
                        </td>
                      );

                    case 'deadline': {
                      const dueState = dueStateOf(item, todayStr);
                      const srSuffix = DEADLINE_SR_SUFFIX[dueState];
                      return (
                        <td key={col.key} style={{ ...base, color: DEADLINE_COLOR[dueState], fontWeight: 600 }}>
                          {value ?? DASH}
                          {srSuffix ? <span style={VISUALLY_HIDDEN}>{srSuffix}</span> : null}
                        </td>
                      );
                    }

                    case 'context':
                    case 'course':
                    case 'organization':
                    case 'area':
                    case 'project':
                    case 'time':
                    case 'estimate':
                      // `cellValue` already guarantees a non-empty string for all seven — the
                      // `?? DASH` is belt-and-braces against a future signature change, never a
                      // reachable path today.
                      return <td key={col.key} style={base}>{value ?? DASH}</td>;

                    default: {
                      const unhandled: never = col.key;
                      return <td key={unhandled} style={base}>{DASH}</td>;
                    }
                  }
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <style jsx>{`
        /* Every rule here targets an element rendered by *this* component — including the
           header buttons — so they all carry this component's styled-jsx scope hash. A rule
           for a child component's markup placed here would compile fine and match nothing. */
        .vb-table-row:hover {
          background: rgba(255,255,255,0.45);
        }
        .vb-table-scroll:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        /* §8: a column header is load-bearing information, so it takes the AA-passing meta
           colour, not one of the lighter decorative shades. The sorted column darkens to the
           body-text shade so the active column reads as active without the caret alone. */
        .vb-th-sort {
          color: #5c6b80;
          transition: color 150ms ease;
        }
        .vb-th-sort:hover,
        .vb-th-sort-on {
          color: #2d3748;
        }
        /* §9's ring, on the darker blue, applied via :focus-visible so a mouse click on a
           header does not leave a ring nobody asked for. */
        .vb-th-sort:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}
