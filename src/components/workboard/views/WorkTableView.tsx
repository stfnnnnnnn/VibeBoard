'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, CheckCircle2, ChevronDown, ChevronUp, Clock, Link2, SearchX, Table2 } from 'lucide-react';
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
// Task 21's cell, on the same terms as Task 20's and for the same reasons: it owns its own
// `<td>` so its select's hover and focus rules can live in the same component (styled-jsx
// scopes per component, so they would match nothing from here), and so the vertical padding
// that keeps a 26px control from inflating the row is decided next to the control.
import PriorityCell from '../table/PriorityCell';
// Task 22's cell — the first that is a popover editor rather than a plain `<select>`, and the
// first that renders *two* columns. `DeadlineCell` draws the Deadline `<td>` and the Time `<td>`
// from one component, and `useDeadlineEditor` (called once, below) is the editor's single home:
// both cells read the same open-state, the same in-flight flag and the same optimistic override,
// so the two columns are two views of one editor rather than two editors that can disagree.
import DeadlineCell, { useDeadlineEditor } from '../table/DeadlineCell';
// Task 23's cell — the fourth and last interactive column, and the only one that is not an
// editor in its own right: it renders a summary and a trigger, and `LinksPopover` (a
// standalone component the detail panel reuses unchanged) does the editing. It owns its own
// `<td>` on the same terms as the three above.
//
// `summariseLinks` is that cell's pure text function — the Links column's string in both of its
// states ("3 links" before the labels are known, "Canvas · GitHub · +1" after) — and the phone
// card below renders its links affordance through it, so the two surfaces cannot word the same
// fact differently.
import LinksCell, { summariseLinks } from '../table/LinksCell';
// The links editor itself, plus the shared owner-links store `LinksCell` reads. Imported here
// for the phone card's links trigger only: the card renders a trigger and hands every mutation
// to this same standalone popover, so nothing about link editing is re-implemented for phone.
// Pool-free — `LinksPopover` is a client component with no `@/lib/db` reach of its own.
import LinksPopover, { cachedOwnerLinks, loadOwnerLinks, useOwnerLinks } from '../LinksPopover';
// Task 32's title trigger, shared with Focus's rows rather than re-declared here: the Work cell,
// the phone card and both of `WorkItemRow`'s layouts must offer the same affordance for the same
// thing, and its `:hover`/`:focus-visible` rules only scope correctly inside the component that
// renders the element (styled-jsx hashes per component — the trap several tasks here have hit).
// `WorkItemRow` is already this module's home for row primitives the views share: `setWorkStage`,
// `setPriority` and `setDeadline` are all imported from it by the Table's own cells.
import { WorkTitleButton } from '../WorkItemRow';

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

/** §4's second half used to render here as a pill for `high` and plain text otherwise. Both now
 *  live in `PriorityCell`, which owns the column: the labels moved with the control that shows
 *  them, and the pill's alert red moved onto that control's text so the "this one is urgent"
 *  reading survives the pill's removal. `EDGE_COLOR` above — §4's *first* half, the coloured
 *  left edge — still renders from here on every row, unchanged. */

/** The Deadline cell's colour (`DEADLINE_COLOR`), its visually-hidden overdue suffix
 *  (`DEADLINE_SR_SUFFIX`) and the `VISUALLY_HIDDEN` style that carried it all moved into
 *  `DeadlineCell` with the cell that renders them — same move `PriorityCell` made for the High
 *  pill's labels and colour. They are unchanged in value; they simply live next to the markup
 *  they style now that the Deadline column is a control rather than a string.
 *
 *  Task 24 brings copies of all three back to this file, under `CARD_`-prefixed names and
 *  `VISUALLY_HIDDEN` below: the phone card renders the same two values without rendering either
 *  cell, and none of the three constants is exported (nothing outside those cells had ever
 *  needed them). The copies are marked at their definitions. */

const DASH = '—';

const DIVIDER = '1px solid rgba(200,210,230,0.35)';

/** Moved out of `DeadlineCell` for the phone card's use — the card needs the same visually-hidden
 *  treatment for the field labels its header row no longer provides. Identical values to the
 *  copies in `DeadlineCell` and `LinksCell`; a shared export is not worth a module for one style
 *  object, and all three are frozen by what "visually hidden" means rather than by taste. */
const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/* ─── Width tiers ──────────────────────────────────────────────────────────────────────
 * The direction doc's two canonical anchors (§10): `1024px` and `768px`. They are named here
 * as numbers and read *only* from JavaScript — this file deliberately contains no `@media`
 * rule at all, so the JS breakpoint and a CSS breakpoint cannot drift by a pixel, because
 * there is no second place for the value to be written.
 *
 * That is not only tidiness. Every responsive decision in this view is a decision about what
 * to *render* — which columns exist, whether a `<table>` exists at all — and every `<th>` and
 * `<td>` here carries inline styles for display, padding, alignment and colour. An inline
 * declaration beats any class selector regardless of source order, so a media query trying to
 * hide a column or restructure a row would compile cleanly and match nothing: exactly the
 * failure that shipped Board's mobile snap-scroll dead in v2. Deciding in JS means no rule
 * ever has to win that fight.
 */
const TABLET_MIN_WIDTH  = 768;
const DESKTOP_MIN_WIDTH = 1024;

type WidthTier = 'phone' | 'tablet' | 'desktop';

/**
 * `WorkListView`'s `useIsDesktopRow`, widened from one breakpoint to two with its shape kept
 * exactly: state seeded with the desktop value so the server render and the first client paint
 * agree (the effect only ever corrects it after mount), a `matchMedia` query per anchor,
 * `update()` called once immediately, and every listener removed on unmount.
 *
 * **One piece of state derived from both queries in one expression**, rather than two boolean
 * hooks. Two independent hooks can be observed mid-update in a combination no viewport actually
 * produces (`isDesktop && !isTablet`), and every consumer would then have to decide for itself
 * which of the two wins. A single three-way tier cannot be internally inconsistent.
 */
function useWidthTier(): WidthTier {
  const [tier, setTier] = useState<WidthTier>('desktop');
  useEffect(() => {
    const desktop = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
    const tablet  = window.matchMedia(`(min-width: ${TABLET_MIN_WIDTH}px)`);
    const update = () => setTier(desktop.matches ? 'desktop' : tablet.matches ? 'tablet' : 'phone');
    update();
    desktop.addEventListener('change', update);
    tablet.addEventListener('change', update);
    return () => {
      desktop.removeEventListener('change', update);
      tablet.removeEventListener('change', update);
    };
  }, []);
  return tier;
}

/** Phone renders no columns at all. A stable module-level reference rather than a fresh `[]`
 *  each render, so the tier alone decides whether `columns` changes identity. */
const NO_COLUMNS: readonly TableColumn[] = [];

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

/* ─── The phone card ───────────────────────────────────────────────────────────────────
 * Below 768px the `<table>` is not rendered at all and one card per item takes its place.
 * The constants below are the three things the card needs that live inside a cell component
 * on desktop — `PriorityCell`'s labels and alert colour, `DeadlineCell`'s due colour and its
 * overdue suffix — none of which are exported, because on desktop nothing outside those cells
 * has ever needed them. They are deliberate copies, in the same spirit as this file's own
 * `stageOf` and `EDGE_COLOR`: the alternative is widening three cells' public surface for a
 * branch that renders none of them.
 */

/** `PriorityCell`'s `PRIORITY_LABEL`. */
const CARD_PRIORITY_LABEL: Record<WorkItem['priority'], string> = {
  high:   'High',
  normal: 'Normal',
  low:    'Low',
};

/** `PriorityCell`'s `TEXT_COLOR`, with one change for this surface: normal and low take §1's
 *  meta colour rather than the body-text shade, because on a card the priority word sits beside
 *  the title rather than inside a control, and at body-text weight it would compete with it.
 *  High keeps §6's alert red — and the word still reads "High", so colour carries nothing
 *  alone here either. */
const CARD_PRIORITY_COLOR: Record<WorkItem['priority'], string> = {
  high:   '#922e48',
  normal: '#5c6b80',
  low:    '#5c6b80',
};

/** `DeadlineCell`'s `DEADLINE_COLOR`, value for value, so a date that reads late in the table
 *  reads late on the card. Keyed by `DueState` so a sixth state fails the build here. */
const CARD_DUE_COLOR: Record<DueState, string> = {
  none:           '#5c6b80',
  upcoming:       '#5c6b80',
  due_today:      '#5c6b80',
  completed:      '#5c6b80',
  completed_late: '#8a5010',
  overdue:        '#922e48',
};

/** `DeadlineCell`'s `DEADLINE_SR_SUFFIX`. The card's date is a bare string, so without this the
 *  lateness would be conveyed by colour alone. */
const CARD_DUE_SR_SUFFIX: Partial<Record<DueState, string>> = {
  overdue:        ' (overdue)',
  completed_late: ' (completed late)',
};

/** The identity columns — the one column per context that says *where* a work item lives
 *  (`COLUMNS_BY_CONTEXT`'s first entry in all five contexts today). Matched by key rather than
 *  by position so reordering a context's array cannot silently promote `Work` to the card's
 *  lead value and print the title twice. */
const LEAD_KEYS: readonly ColumnKey[] = ['context', 'course', 'organization', 'area', 'project'];

function leadColumnOf(columns: readonly TableColumn[]): TableColumn | undefined {
  return columns.find(col => LEAD_KEYS.includes(col.key));
}

/**
 * The card's links affordance — the one control on the phone card, and the only field the card
 * renders as something you can act on rather than read.
 *
 * It is a live trigger because it costs no duplicated logic to make one: `LinksPopover` is
 * standalone by design (`LinksCell`'s header says so, and the detail panel reuses it unchanged),
 * so the card hands it the same owner pair and the same `onChanged` the table cell does and every
 * add, delete, validation and error path is the shipped one. What is *not* reused is
 * `LinksCell` itself, which renders a `<td>`: a table cell inside a card is dropped outright by
 * the HTML parser on any server-rendered path and has no row or table to belong to in the
 * accessibility tree. The trigger below is that cell's presentation, minus its `<td>`.
 *
 * The lazy read is `LinksCell`'s too, unchanged in behaviour: the card paints from `link_count`
 * alone, and primes the owner's labels on pointer-enter or focus — the fetch opening the popover
 * would have made anyway. Fetching every card's list up front is the per-row query `link_count`
 * exists to avoid.
 */
function CardLinksButton({ item, onChanged }: {
  item:      WorkItem;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const links   = useOwnerLinks(item.source, item.id);
  const summary = summariseLinks(item.link_count, links);
  // The store wins over the payload's count for the same reason it does in `summariseLinks`:
  // it is updated the instant an add or delete succeeds, while `link_count` waits for the
  // whole work payload to be re-pulled.
  const count   = links?.length ?? item.link_count;

  /** Cheap to call repeatedly: `loadOwnerLinks` returns a cached value without a request and
   *  joins an in-flight one rather than issuing a second. Failure is silent here — a hover is
   *  not a request for data; the popover reports what went wrong when the user actually opens
   *  it. `LinksCell`'s reasoning, unchanged. */
  const prefetch = () => {
    if (item.link_count === 0) return;
    if (cachedOwnerLinks(item.source, item.id) !== undefined) return;
    void loadOwnerLinks(item.source, item.id);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        type="button"
        className="vb-card-links"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onClick={() => setOpen(current => !current)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          // 32px rather than the table trigger's 26px: this is a touch surface, and §9 sets
          // comfortable floors above WCAG 2.2's 24px minimum wherever a user actually taps.
          boxSizing: 'border-box', minHeight: '32px', borderRadius: '8px',
          padding: '4px 10px', background: 'rgba(255,255,255,0.6)',
          // `borderWidth` and `borderStyle` only. The colour is set in the rules below, for the
          // base state as well as `:hover`, because an inline `border` shorthand sets
          // border-color too — and an inline declaration beats any class selector, so a
          // `border-color` hover rule written against an inline `border` compiles cleanly and
          // never applies. That is this task's named trap, in miniature, on one element.
          borderWidth: '1px', borderStyle: 'solid',
          fontFamily: FONT, fontSize: '0.76rem', fontWeight: 600, color: '#5c6b80',
          lineHeight: 1.2, cursor: 'pointer',
        }}
      >
        <Link2 size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.75 }} />
        <span style={{
          display: 'block', maxWidth: '150px', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {summary}
        </span>
        {/* The accessible name is composed from the button's own content rather than an
            `aria-label`, so the visible string is always contained in it (WCAG 2.5.3). An em
            dash alone would name this button "—", hence the spelled-out absent state. */}
        <span style={VISUALLY_HIDDEN}>
          {count === 0 ? ' No links.' : ''}
          {` Edit links for "${item.title}".`}
        </span>
      </button>

      {open && (
        <LinksPopover
          // `source` and `id` *are* the owner pair — `LinkOwner['kind']` is exactly
          // `WorkSource`, so an academic card resolves through the academic path with no
          // translation on either side of the wire.
          ownerKind={item.source}
          ownerId={item.id}
          title={item.title}
          linkCount={count}
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
        />
      )}

      {/* Scoped to this component, which is the one that renders the trigger. A rule for it
          written in `WorkTableView` below would compile cleanly and match nothing — each
          component gets its own styled-jsx scope hash. */}
      <style jsx>{`
        /* The base border colour lives here rather than inline — see the trigger's style. */
        .vb-card-links {
          border-color: rgba(200,210,230,0.6);
          transition: border-color 150ms ease;
        }
        .vb-card-links:hover {
          border-color: rgba(140,160,190,0.75);
        }
        /* §9's ring, on the darker blue. */
        .vb-card-links:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}

export interface WorkTableViewProps {
  /** Already filtered by category and search — see `WorkboardShell`'s `visibleItems`. */
  items:       WorkItem[];
  /** The shell's active context tab, `'all'` for My Work. Drives the whole column set: the user
   *  never configures a column (spec §7, §34), the context decides them. */
  context:     TableContext;
  /** "YYYY-MM-DD" — `work.generated_at`, so every row agrees with Focus on what "today" is. */
  todayStr:    string;
  /** True when **anything** is currently narrowing `items` — the shell's context tab, its search
   *  box, or the Filters popover (Task 38 added the last). The same signal
   *  `WorkListView`/`WorkBoardView` take, kept so the three views' prop shapes stay recognisably
   *  the same. */
  isFiltered?: boolean;
  /** True when something **other than the context tab** is narrowing `items`: the search box or
   *  the Filters popover. This view needs the narrower signal because it has three empty states,
   *  not two: `isFiltered` alone cannot tell "this context has no work yet" (offer the create
   *  button) apart from "what you asked for matched nothing inside this context" (offering a
   *  create button there would be wrong advice), since `isFiltered` is true for *any* non-My-Work
   *  tab. The name predates the popover; `WorkboardShell` is where the value is computed and says
   *  why the popover now counts. */
  isSearching?: boolean;
  /** Re-pulls the whole work payload after an inline mutation, so the stats, the workload
   *  chart and every other view reconcile with what the Status cell just wrote. Tasks 21–24
   *  take the same prop for priority, links and the detail panel. */
  onChanged:   () => void | Promise<void>;
  /** Opens the create/edit dialog in create mode — wired to this view's own empty states. */
  onNewItem:   () => void;
  /** Opens the detail drawer (Task 32) for a given item — the Work cell's title is its trigger,
   *  in the table and on the phone card alike. The Table has no `onEdit` of its own, so this is
   *  also the only route from this view to an item's full field set. */
  onOpenDetail: (item: WorkItem) => void;
}

export default function WorkTableView({
  items, context, todayStr, isFiltered, isSearching, onChanged, onNewItem, onOpenDetail,
}: WorkTableViewProps) {
  // Never sorted or filtered in place — `COLUMNS_BY_CONTEXT`'s arrays and their `TableColumn`
  // objects are `readonly` precisely because the same object is shared across contexts, and a
  // write through one would corrupt the others for the rest of the session. Sorting reorders
  // the rows below, never this array; the width filter a few lines down produces a new array
  // with `.filter` rather than touching this one.
  const contextColumns: readonly TableColumn[] = COLUMNS_BY_CONTEXT[context];

  // Every hook sits above the three empty-state returns: a `return` before a hook is the one
  // way to break the rules of hooks in a component that otherwise looks linear.
  const [sort, setSort] = useState<SortState | null>(null);

  // The Deadline/Time editor's single home, called once for the whole table and read by both of
  // every row's two `DeadlineCell` instances. It sits here, above the empty-state returns, for
  // the same reason `useState` above does — a `return` before a hook breaks the rules of hooks —
  // and it is lifted this high rather than per-row because "which popover is open" is a property
  // of the table, not of a cell: only one can be, and either of a row's two cells can open it.
  const deadlineEditor = useDeadlineEditor(onChanged);

  const tier = useWidthTier();

  /**
   * The columns this width actually renders, decided **in JavaScript** and never by hiding a
   * rendered `<th>`/`<td>` in CSS (see the `TABLET_MIN_WIDTH` block for why hiding could not
   * work here even if it were wanted). One array, three tiers:
   *
   * - **desktop** — `contextColumns` itself, the same reference this line used to return, so
   *   nothing about the desktop table changes;
   * - **tablet** — everything except `priority: 'low'`, which is the field `tableColumns.ts`
   *   exists to carry (Time, Links, and per context Project or Estimate go; Work, Status,
   *   Deadline and the context's lead column stay). If the remainder still overflows, the
   *   scroll container this returns into takes it — the columns are not compressed;
   * - **phone** — nothing, because the phone branch below renders no table.
   */
  const columns: readonly TableColumn[] =
    tier === 'desktop' ? contextColumns
    : tier === 'tablet' ? contextColumns.filter(col => col.priority !== 'low')
    : NO_COLUMNS;

  // The sort a column *no longer present in this context* would apply is derived away rather
  // than cleared: switching from Projects (sorted by Estimate) to Academic, which has no
  // Estimate column, would otherwise leave rows in an order no visible header explains, since
  // `aria-sort` lives on a header that is gone. Deriving rather than clearing in an effect
  // avoids an extra render pass and a one-frame flash of the stale order — and it restores
  // the sort if the user switches back to a context that does have the column.
  //
  // `columns` is now the *width-filtered* array, so this one mechanism covers both reasons a
  // column can be absent. A tablet-width table sorted by Time, and a phone whose cards have no
  // header row at all (`NO_COLUMNS`, so nothing can match), both fall back to the default order
  // — the rule was always "sort only by a column the user can see", and narrowing has simply
  // gained a second cause. The `sort` state itself is untouched, so widening the window back to
  // desktop restores the sort exactly as switching context back does.
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
  //   1. nothing is narrowing the view at all              -> the board itself is empty
  //   2. a search or a popover filter is running           -> nothing matched it
  //   3. only the context tab is narrowing                 -> that context has no work yet
  //
  // `isSearching` is the shell's "something other than the tab is narrowing" signal — the search
  // box or the Filters popover (Task 40 widened it to the latter; before that, a popover filter
  // emptying a real context fell through to case 3 and claimed the context itself was empty).
  //
  // The `context === 'all'` disjunct in test 2 stays unreachable at runtime, and now for a
  // structural reason rather than a coincidental one: under My Work the category disjunct of
  // `isFiltered` is false by definition, so the only ways `isFiltered` can be true there are the
  // search box and the popover — both of which now set `isSearching`, which the same test already
  // caught. So `context === 'all'` can never be the disjunct that decides this branch. It is kept
  // because it is still load-bearing for types: it is what narrows `context` from `TableContext`
  // to `WorkContext` so case 3's `CONTEXT_LABELS[context]` cannot be indexed with `'all'`.
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
      // Heading and body copy shared verbatim with `WorkListView`, `WorkBoardView`, and
      // `WorkTimelineView`'s identical filtered-empty state — all four were synced in the same
      // Task 40 commit that widened this condition to also cover an active popover filter, per
      // v3 §17c's rule that this exact string must never diverge between views.
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

  // The name the surface carries, shared by the table's `<caption>` and the phone list's
  // `aria-label`: the card branch replaces the table's structure, so it has to replace the name
  // that structure carried. The `context === 'all'` test is also what narrows `context` to
  // `WorkContext` for the `CONTEXT_LABELS` lookup.
  const surfaceLabel = context === 'all' ? 'All work items' : `${CONTEXT_LABELS[context]} work items`;

  /* ─── Phone: cards, not a table ──────────────────────────────────────────────────────
   * Below 768px the `<table>` element is not rendered at all. This is a structural
   * replacement rather than a restyling of the same markup — a seven-column grid squeezed to
   * 375px is unusable, and the elements a CSS-only version would have to restructure all carry
   * inline styles for the properties it would need to change, so it could not win anyway.
   *
   * The list is a real `<ul>`/`<li>` with the table's own accessible name. That is deliberate:
   * the `<table>` gave a screen-reader user a row/column count and a header per value, and
   * dropping to a pile of `<div>`s would drop all of it. A list restores the count, and each
   * value carries a visually-hidden label in place of the `<th>` it lost.
   *
   * **The card is read-only apart from its links affordance**, and that is a considered
   * tradeoff, not an omission — see the module note above `CardLinksButton`. The three editable
   * columns are `StatusCell`, `PriorityCell` and `DeadlineCell`, and each of them renders its
   * own `<td>`: a table cell inside a card is dropped by the HTML parser on any server-rendered
   * path and belongs to no row in the accessibility tree, so reusing them here is not available
   * without changing four components this task does not own. Re-implementing them instead would
   * mean a second copy of the tagged optimistic override, the `pending` disable, the focus
   * restoration and the error extraction — every line of which closed a review defect on the
   * originals, and duplication of exactly the kind this module has already had to remove twice.
   * Nor can the card delegate to the edit dialog: this view takes no `onEdit` prop.
   *
   * What the user keeps at this width: every value the table showed, including the overdue
   * colour and its spelled-out suffix; and, in Focus — which §10 makes the default view on
   * load below 768px and restructures for exactly this width — a fully interactive row with
   * the completion toggle and the edit dialog behind its overflow menu. Table on a phone is the
   * scanning surface; Focus is the editing one. Visually the card says so: values render flat,
   * and the one live control is the only thing wearing the module's bordered-pill control
   * language, so nothing that looks tappable is inert.
   */
  if (tier === 'phone') {
    // The context's own identity column, read from the *unfiltered* array — `columns` is
    // `NO_COLUMNS` at this tier, and the card's lead value is a property of the context, not of
    // a width. It is `high` priority in every context, so it is the one column that survives
    // every tier anyway.
    const leadColumn = leadColumnOf(contextColumns);

    return (
      <ul
        // `role="list"` stated explicitly, redundant as it looks: WebKit drops a `<ul>`'s list
        // semantics entirely when `list-style: none` is applied, so without this the card list
        // would announce its count in every browser except Safari/VoiceOver — and the count is
        // the whole reason this is a list rather than a stack of `<div>`s.
        role="list"
        aria-label={surfaceLabel}
        style={{ listStyle: 'none', margin: 0, padding: 0, fontFamily: FONT }}
      >
        {sortedItems.map((item, rowIdx) => {
          const isLast = rowIdx === sortedItems.length - 1;
          const isDone = item.work_status === 'done';

          // Every string on the card is read through `cellValue`, the same function the `<td>`s
          // call, rather than formatted again here: a card and a row cannot word the same value
          // differently, and `cellValue` is what guarantees an absent value reads as an em dash
          // rather than as a blank. `dueStateOf` likewise decides lateness once for the module.
          const leadValue = leadColumn === undefined ? null : cellValue(item, leadColumn.key);
          const dateLabel = cellValue(item, 'deadline') ?? DASH;
          const timeLabel = cellValue(item, 'time') ?? DASH;
          const dueState  = dueStateOf(item, todayStr);

          return (
            <li
              key={itemKey(item)}
              style={{
                position: 'relative',
                display: 'flex', flexDirection: 'column', gap: '6px',
                // 15px on the left is the row's 12px rhythm plus the 3px priority edge, so the
                // text starts where it would in the table. A floor, not a cap, exactly as §10's
                // two-line List row is: a long title or a wrapped meta line grows the card.
                padding: '10px 8px 10px 15px', minHeight: '82px', boxSizing: 'border-box',
                borderBottom: isLast ? 'none' : DIVIDER,
              }}
            >
              {/* §4's priority edge, unchanged in meaning from the table's first-cell border —
                  drawn as a positioned span here because a card has no first cell to border. */}
              <span
                aria-hidden
                style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px',
                  background: EDGE_COLOR[item.priority], borderRadius: '2px',
                }}
              />

              {/* Line 1 — title, and priority at the end of the line, which is where §10's
                  two-line List row puts the High pill. The title truncates to one line for
                  the same reason it does there and in the Work cell: it is the one element
                  that must never push the line taller. */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                {/* The card's one *other* control besides its links trigger, and the same
                    component the table's Work cell renders. */}
                <WorkTitleButton
                  item={item}
                  isDone={isDone}
                  style={{ flex: 1, minWidth: 0 }}
                  onOpenDetail={onOpenDetail}
                />
                <span style={{
                  flexShrink: 0, fontSize: '0.72rem', fontWeight: 700,
                  color: CARD_PRIORITY_COLOR[item.priority],
                }}>
                  {/* The label the `<th>` used to supply. Every value on this card carries one. */}
                  <span style={VISUALLY_HIDDEN}>Priority: </span>
                  {CARD_PRIORITY_LABEL[item.priority]}
                </span>
              </div>

              {/* Line 2 — where this work lives, and what state it is in. The lead value is the
                  context's identity column (Course / Organization / Project / Area, or Context
                  under My Work), the same column that leads the table. */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px',
                fontSize: '0.76rem', fontWeight: 600, color: '#5c6b80',
              }}>
                {leadColumn !== undefined && (
                  <>
                    <span>
                      <span style={VISUALLY_HIDDEN}>{leadColumn.label}: </span>
                      {leadValue ?? DASH}
                    </span>
                    <span aria-hidden style={{ color: '#9aa4b5' }}>·</span>
                  </>
                )}
                <span>
                  <span style={VISUALLY_HIDDEN}>Status: </span>
                  {/* `stageOf`, so the card reports the item's own stage exactly as the Status
                      column does — five vocabularies, one label lookup. */}
                  {STAGE_LABELS[stageOf(item)]}
                </span>
              </div>

              {/* Line 3 — when it is due, and the links affordance. The two icons are the ones
                  `DeadlineCell` uses for the same two values, so the card and the table read as
                  the same information rather than two conventions. */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px',
                fontSize: '0.76rem', fontWeight: 600,
              }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  color: CARD_DUE_COLOR[dueState],
                }}>
                  <Calendar size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.75 }} />
                  <span style={VISUALLY_HIDDEN}>Deadline: </span>
                  {dateLabel}
                  {/* Without this the lateness would be carried by the colour alone — the card,
                      like the table cell, shows a bare date with no "Overdue" in the string. */}
                  <span style={VISUALLY_HIDDEN}>
                    {dateLabel === DASH ? ' No deadline set.' : (CARD_DUE_SR_SUFFIX[dueState] ?? '')}
                  </span>
                </span>

                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#5c6b80',
                }}>
                  <Clock size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.75 }} />
                  <span style={VISUALLY_HIDDEN}>Deadline time: </span>
                  {timeLabel}
                  <span style={VISUALLY_HIDDEN}>{timeLabel === DASH ? ' No time set.' : ''}</span>
                </span>

                <div style={{ marginLeft: 'auto' }}>
                  <CardLinksButton item={item} onChanged={onChanged} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
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
      // `scroll-padding-top` per addendum §15d: tabbing between inline controls scrolls this
      // container to bring the next one into view, and the sticky header would then sit on top of
      // it — WCAG 2.2 AA *Focus Not Obscured (Minimum)* forbids persistent UI fully covering the
      // focused control. The header is `2 + 27 + 2 = 31px` and §9's ring extends 4px past a
      // control's box (2px outline at 2px offset), so 35px is the floor; 36px is used because it
      // is 3 × 12, on this module's own spacing rhythm, rather than the bare floor plus one.
      style={{ maxHeight: '68vh', overflow: 'auto', borderRadius: '12px', scrollPaddingTop: '36px' }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
        <caption
          style={{
            position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
            overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
          }}
        >
          {surfaceLabel}
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
                              it is honoured. That inner block is now the detail drawer's
                              trigger — the affordance the plan always intended the title to be
                              (it was pencilled in for Task 22 and landed here with the drawer
                              itself), and the Table's only route to an item's full field set. */}
                          <WorkTitleButton
                            item={item}
                            isDone={isDone}
                            style={{ display: 'block', maxWidth: '340px', width: '100%' }}
                            onOpenDetail={onOpenDetail}
                          />
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
                      // High/normal/low, the same three in every context — priority is not a
                      // per-context vocabulary the way stages are, so unlike `StatusCell` this
                      // cell needs nothing from the item beyond its current value.
                      return (
                        <PriorityCell key={col.key} item={item} style={{ ...base, fontWeight: 600 }} onChanged={onChanged} />
                      );

                    case 'links':
                      // The bare count this cell used to render is now only its *unloaded*
                      // state. `link_count` is all the payload carries — one COUNT subquery per
                      // item, deliberately, rather than one list query per row — so the cell
                      // shows "3 links" until that owner's labels are in the shared store, then
                      // upgrades to "Canvas · GitHub · +1". Nothing about that fetch blocks this
                      // render: the cell asks for it on pointer-enter or focus, and the popover
                      // asks for it on open.
                      return (
                        <LinksCell key={col.key} item={item} style={base} onChanged={onChanged} />
                      );

                    case 'deadline':
                    case 'time':
                      // Both columns, one component, one editor. The `column` prop is the only
                      // difference between the two render calls: it decides which value the cell
                      // shows and which trigger the shared popover anchors to. `cellValue`'s
                      // string is deliberately unused for these two now — the cell formats from
                      // the *shown* values (stored, or the optimistic override) through the same
                      // `formatDeadline`/`formatDeadlineTime` that `cellValue` calls, so an
                      // in-flight edit moves the date and the time together.
                      return (
                        <DeadlineCell
                          key={col.key}
                          item={item}
                          column={col.key}
                          style={base}
                          todayStr={todayStr}
                          editor={deadlineEditor}
                        />
                      );

                    case 'context':
                    case 'course':
                    case 'organization':
                    case 'area':
                    case 'project':
                    case 'estimate':
                      // `cellValue` already guarantees a non-empty string for all six — the
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
