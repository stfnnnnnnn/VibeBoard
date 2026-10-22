'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, ChevronDown, ChevronUp, Clock, Link2, SearchX, Table2, Plus, ExternalLink } from 'lucide-react';
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
import { dueStateOf } from '@/lib/workboard/dueSemantics';
import { DUE_COLOR, DUE_SR_SUFFIX } from '@/lib/workboard/ui/dueColors';
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
import { itemKey } from '@/lib/workboard/ui/itemKey';
import { useSelection } from '../ui/useSelection';
import WbCheckbox from '../ui/WbCheckbox';
import WbBulkBar, { type BulkStatusOption } from '../ui/WbBulkBar';
// Type-only: the hook's return shape. The shell owns the one `useBulkActions` instance.
import type { useBulkActions } from '../useBulkActions';
// Pool-free: the context-dot colours (refine spec §6's Context cell).
import { CONTEXT_FILL } from '@/lib/workboard/ui/tokens';
import { courseColor } from '@/lib/workboard/color';
import { shortCourseCode } from '@/lib/workboard/ui/courseCode';

const FONT    = 'var(--wb-font-ui)';
const DM_FONT = 'var(--wb-font-head)';

/** `'all'` is the shell's My Work tab — every context at once. Mirrors `WorkBoardView`'s
 *  `BoardContext`, and takes the same value from the same shell state. */
export type TableContext = WorkContext | 'all';

/** Priority lives in the Priority column alone (`PriorityCell`, plan ruling R1): the row's
 *  coloured left edge is gone with the refine pass's side stripes (spec §3). */

/** The due-date colour and its visually-hidden lateness suffix come from
 *  `lib/workboard/ui/dueColors`, shared with `DeadlineCell` so the phone card and the Deadline
 *  cell cannot disagree about whether a date is late. */

const DASH = '—';

/** Refine spec §6 washes, shared by the table row's glass layer and the phone card. */
const OVERDUE_WASH  = 'linear-gradient(90deg, rgba(255,196,218,.95), rgba(255,255,255,.6) 55%)';
const SELECTED_WASH = 'linear-gradient(90deg, rgba(59,143,224,.14), rgba(255,255,255,.6))';
const SELECTED_RING = 'inset 0 0 0 1.5px rgba(59,143,224,.45)';

/** Spec §6's overdue deadline, "⚠ Overdue · Jul 7" at 700. `DeadlineCell` already draws the ⚠
 *  icon, the date and the danger colour; these inherited properties, set on the Deadline `<td>`
 *  only, let this view's `.is-overdue` rules add the word and the weight without the Time cell
 *  (same component, same trigger class) picking them up. */
const OVERDUE_LABEL_HOOK = {
  '--vb-od-label':  '"Overdue ·"',
  '--vb-od-weight': '700',
  '--vb-od-color':  'var(--wb-danger)',
} as React.CSSProperties;

/** Spec §6's column order — checkbox, Work, then the context's own columns. `COLUMNS_BY_CONTEXT`
 *  leads with the identity column (sorting and the phone card rely on that), so the view moves
 *  Work to the front here, as a new array: the shared arrays are never touched. */
function workFirst(cols: readonly TableColumn[]): readonly TableColumn[] {
  return [...cols.filter(c => c.key === 'work'), ...cols.filter(c => c.key !== 'work')];
}

/** The Context cell's glow-dot colour: the course's own colour for an academic item with a
 *  course, else the context's fill. `CONTEXT_FILL` is keyed by a free-form DB value, hence the
 *  grey fallback. */
function contextDot(item: WorkItem): string {
  if (item.context === 'academic' && item.course_code) return courseColor(item.course_code);
  return CONTEXT_FILL[item.context] ?? 'var(--wb-st-todo)';
}

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
 * `stageOf`: the alternative is widening three cells' public surface for a
 * branch that renders none of them.
 */

/** `PriorityCell`'s `PRIORITY_LABEL`. */
const CARD_PRIORITY_LABEL: Record<WorkItem['priority'], string> = {
  high:   'High',
  normal: 'Normal',
  low:    'Low',
};

/** The card's priority word: High in the alert red, Normal and Low in the muted meta colour —
 *  the same colours `PriorityCell`'s styled-jsx gives its select. The word itself still reads
 *  "High", so colour carries nothing alone. */
const CARD_PRIORITY_COLOR: Record<WorkItem['priority'], string> = {
  high:   'var(--wb-danger)',
  normal: 'var(--wb-text-muted)',
  low:    'var(--wb-text-muted)',
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
function CardLinksButton({ item, onChanged, overdue = false }: {
  /** On the overdue wash, muted text is ~3.8:1, so the label switches to body text. */
  overdue?:  boolean;
  item:      WorkItem;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const links   = useOwnerLinks(item.source, item.id);
  const summary = summariseLinks(item.link_count, links);
  // The store wins over the payload's count for the same reason it does in `summariseLinks`:
  // it is updated the instant an add or delete succeeds, while `link_count` waits for the
  // whole work payload to be re-pulled.
  const count   = links?.length ?? item.link_count;
  const isEmpty = count === 0;
  // `LinksCell`'s reasoning, unchanged: the glyph pairs with an actual known label, not a
  // still-loading "1 link" placeholder.
  const showExternalGlyph = links !== undefined && links.length === 1;

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
        className={`vb-card-links${isEmpty ? ' vb-card-links--empty' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onClick={e => { setInstant(e.detail === 0); setOpen(current => !current); }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: isEmpty ? '4px' : '5px',
          // 32px rather than the table trigger's 26px: this is a touch surface, and §9 sets
          // comfortable floors above WCAG 2.2's 24px minimum wherever a user actually taps.
          boxSizing: 'border-box', minHeight: '32px', borderRadius: 'var(--wb-r-md)',
          padding: '4px 10px', background: isEmpty ? 'var(--wb-selected)' : 'var(--wb-surface)',
          // `borderWidth` and `borderStyle` only. The colour is set in the rules below, for the
          // base state as well as `:hover`, because an inline `border` shorthand sets
          // border-color too — and an inline declaration beats any class selector, so a
          // `border-color` hover rule written against an inline `border` compiles cleanly and
          // never applies. That is this task's named trap, in miniature, on one element.
          borderWidth: isEmpty ? '1.5px' : '1px', borderStyle: isEmpty ? 'dashed' : 'solid',
          fontFamily: FONT, fontSize: 'var(--wb-fs-13)', fontWeight: isEmpty ? 700 : 600,
          color: isEmpty ? 'var(--wb-blue-strong)' : overdue ? 'var(--wb-text)' : 'var(--wb-text-muted)',
          lineHeight: 1.2, cursor: 'pointer',
        }}
      >
        {isEmpty ? (
          <Plus size={12} aria-hidden style={{ flexShrink: 0 }} />
        ) : (
          <Link2 size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.75 }} />
        )}
        <span style={{
          display: 'block', maxWidth: '150px', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {isEmpty ? 'Link' : summary}
        </span>
        {showExternalGlyph && (
          <ExternalLink size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.55 }} />
        )}
        {/* The accessible name is composed from the button's own content rather than an
            `aria-label`, so the visible string is always contained in it (WCAG 2.5.3). "Link"
            alone would name this button ambiguously, hence the spelled-out action either way. */}
        <span style={VISUALLY_HIDDEN}>
          {isEmpty ? ` Add a link to "${item.title}".` : ` Edit links for "${item.title}".`}
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
          instant={instant}
        />
      )}

      {/* Scoped to this component, which is the one that renders the trigger. A rule for it
          written in `WorkTableView` below would compile cleanly and match nothing — each
          component gets its own styled-jsx scope hash. */}
      <style jsx>{`
        /* The base border colour lives here rather than inline — see the trigger's style. */
        .vb-card-links {
          border-color: var(--wb-border);
        }
        .vb-card-links--empty {
          border-color: var(--wb-blue);
        }
        .vb-card-links:focus-visible {
          outline: 2px solid var(--wb-blue-strong);
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
  /** The shell's one bulk-actions instance (spec §12). */
  bulk:          ReturnType<typeof useBulkActions>;
  /** The bulk bar's Status menu: this context's stages, or the three statuses under My Work. */
  statusOptions: BulkStatusOption[];
  /** Reports the selection size up so the shell can lift the toaster above the bulk bar. */
  onSelectionCount: (n: number) => void;
}

export default function WorkTableView({
  items, context, todayStr, isFiltered, isSearching, onChanged, onNewItem, onOpenDetail,
  bulk, statusOptions, onSelectionCount,
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
  const columns: readonly TableColumn[] = useMemo(
    () =>
      tier === 'desktop' ? workFirst(contextColumns)
      : tier === 'tablet' ? workFirst(contextColumns.filter(col => col.priority !== 'low'))
      : NO_COLUMNS,
    [tier, contextColumns],
  );
  // The identity column (Context / Course / Organization / Project / Area) wears the glow dot.
  const leadKey = leadColumnOf(contextColumns)?.key;

  // The sticky header takes its frosted strip only once rows can slide under it; at rest it has
  // no background (spec §6). `setState` with an unchanged value bails out, so scrolling is cheap.
  const [scrolled, setScrolled] = useState(false);

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

  // Selection (spec §7, §12). Keyed by `itemKey` over the rows in their displayed order, so a
  // shift-click range covers what the user sees between the two clicks.
  const orderedKeys = useMemo(() => sortedItems.map(itemKey), [sortedItems]);
  const selection = useSelection(orderedKeys);
  useEffect(() => { onSelectionCount(selection.count); }, [selection.count, onSelectionCount]);
  useEffect(() => () => onSelectionCount(0), [onSelectionCount]);
  // Spec §12: switching context clears the selection (a view switch unmounts the view, which clears it too).
  useEffect(() => { selection.clear(); }, [context]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedItems = sortedItems.filter(i => selection.isSelected(itemKey(i)));

  // Phone only: cards show their checkboxes while this is on. Turning it off clears the selection.
  const [selectMode, setSelectMode] = useState(false);
  // A width-tier change swaps table for cards (or back), so a selection made in one would
  // otherwise show its bulk bar over the other with Select mode off. Start both afresh.
  useEffect(() => { selection.clear(); setSelectMode(false); }, [tier]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSelectMode = () => {
    if (selectMode) selection.clear();
    setSelectMode(on => !on);
  };

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
          <CheckCircle2 size={56} aria-hidden style={{ marginBottom: '14px', color: 'var(--wb-blue)' }} />
          <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: 'var(--wb-text)', margin: '0 0 6px' }}>
            Nothing on your plate
          </h2>
          <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: 'var(--wb-text-muted)', margin: '0 0 18px' }}>
            Add your first work item to get started.
          </p>
          <button type="button" className="vb-btn-pink" onClick={onNewItem} style={{ width: 'auto', padding: '10px 22px' }}>
            New item
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
          <SearchX size={48} aria-hidden style={{ marginBottom: '14px', color: 'var(--wb-text-faint)' }} />
          <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: 'var(--wb-text)', margin: '0 0 6px' }}>
            No matching work items
          </h2>
          <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: 'var(--wb-text-muted)', margin: 0 }}>
            Try a different category, search term, or filter.
          </p>
        </div>
      );
    }

    // Only the context tab is narrowing, and `context` has narrowed to `WorkContext` with it —
    // the two tests above are what make the `CONTEXT_LABELS` lookup below type-check.
    // New to Table: a context the user has simply not put any work into yet. Distinct from the
    // two states above because the fix *is* available from this view — direction doc §5e only
    // grants an action button when that is true — so this one offers New item.
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <Table2 size={48} aria-hidden style={{ marginBottom: '14px', color: 'var(--wb-text-faint)' }} />
        <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: 'var(--wb-text)', margin: '0 0 6px' }}>
          Nothing in {CONTEXT_LABELS[context]} yet
        </h2>
        <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: 'var(--wb-text-muted)', margin: '0 0 18px' }}>
          Work items you add under this context will appear here as rows.
        </p>
        <button type="button" className="vb-btn-pink" onClick={onNewItem} style={{ width: 'auto', padding: '10px 22px' }}>
          New item
        </button>
      </div>
    );
  }

  // The name the surface carries, shared by the table's `<caption>` and the phone list's
  // `aria-label`: the card branch replaces the table's structure, so it has to replace the name
  // that structure carried. The `context === 'all'` test is also what narrows `context` to
  // `WorkContext` for the `CONTEXT_LABELS` lookup.
  const surfaceLabel = context === 'all' ? 'All work items' : `${CONTEXT_LABELS[context]} work items`;

  // Portalled by `WbBulkBar` itself, so where it sits in this tree does not matter.
  const bulkBar = selection.count > 0 && (
    <WbBulkBar
      count={selection.count}
      statusOptions={statusOptions}
      busy={bulk.busy}
      onStatus={v => void bulk.setStatus(selectedItems, v)}
      onPriority={p => void bulk.setPriority(selectedItems, p)}
      onDeadline={d => void bulk.setDeadline(selectedItems, d)}
      onDelete={() => { bulk.remove(selectedItems); selection.clear(); }}
      onClear={selection.clear}
    />
  );

  // Spec §6's footer. Built outside the returned trees, so it uses inline styles and global
  // classes only — a styled-jsx class here would carry no scope hash and match nothing.
  const overdueCount = sortedItems.filter(i => dueStateOf(i, todayStr) === 'overdue').length;
  const footer = (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
      padding: '8px 4px 2px 14px', fontFamily: FONT, fontSize: 'var(--wb-fs-13)', fontWeight: 600,
      color: 'var(--wb-text-muted)',
    }}>
      <span>
        {sortedItems.length} {sortedItems.length === 1 ? 'item' : 'items'}
        {overdueCount > 0 && ` · ${overdueCount} overdue`}
      </span>
      <button
        type="button"
        className="wb-add-trigger wb-focus-ring"
        onClick={onNewItem}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
      >
        <Plus size={14} aria-hidden /> New item
      </button>
    </div>
  );

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
      <>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
          <button
            type="button"
            className="wb-add-trigger wb-focus-ring"
            onClick={toggleSelectMode}
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
        </div>
        <ul
          // `role="list"` stated explicitly, redundant as it looks: WebKit drops a `<ul>`'s list
          // semantics entirely when `list-style: none` is applied, so without this the card list
          // would announce its count in every browser except Safari/VoiceOver — and the count is
          // the whole reason this is a list rather than a stack of `<div>`s.
          role="list"
          aria-label={surfaceLabel}
          style={{
            listStyle: 'none', margin: 0, padding: 0, fontFamily: FONT,
            display: 'flex', flexDirection: 'column', gap: '6px',
          }}
        >
          {sortedItems.map(item => {
            const isDone = item.work_status === 'done';

            // Every string on the card is read through `cellValue`, the same function the `<td>`s
            // call, rather than formatted again here: a card and a row cannot word the same value
            // differently, and `cellValue` is what guarantees an absent value reads as an em dash
            // rather than as a blank. `dueStateOf` likewise decides lateness once for the module.
            const leadValue = leadColumn === undefined ? null : cellValue(item, leadColumn.key);
            const dateLabel = cellValue(item, 'deadline') ?? DASH;
            const timeLabel = cellValue(item, 'time') ?? DASH;
            const dueState  = dueStateOf(item, todayStr);
            const key       = itemKey(item);
            const selected  = selection.isSelected(key);
            // Muted on the overdue wash is ~3.8:1, so overdue cards use body text, as the rows do.
            const overdue   = dueState === 'overdue';
            const metaColor = overdue ? 'var(--wb-text)' : 'var(--wb-text-muted)';
            // The Course lead shows the short code, with the full section code as its tooltip.
            const leadCourse = leadColumn?.key === 'course' ? item.course_code : null;

            return (
              <li
                key={key}
                // Spec §6: each card is its own glass strip. The overdue and selected washes are
                // inline because this branch has no styled-jsx block of its own.
                className="wb-glass-item"
                style={{
                  position: 'relative',
                  display: 'flex', flexDirection: 'column', gap: '6px',
                  // Select mode makes room for the 40px checkbox. A floor, not a cap: a long
                  // title or a wrapped meta line grows the card.
                  padding: selectMode ? '10px 10px 10px 52px' : '10px 10px 10px 14px',
                  minHeight: '82px', boxSizing: 'border-box',
                  ...(selected
                    ? { background: SELECTED_WASH, boxShadow: `${SELECTED_RING}, var(--wb-glass-item-shadow)` }
                    : dueState === 'overdue' ? { background: OVERDUE_WASH } : null),
                }}
              >
                {/* 40px on phones: `.wb-check`'s size comes from workboard.css's max-width: 767px rule. */}
                {selectMode && (
                  <span style={{ position: 'absolute', left: '8px', top: '2px' }}>
                    <WbCheckbox
                      shape="square"
                      checked={selected}
                      label={`Select "${item.title}"`}
                      onChange={(_, e) => selection.toggle(key, e.shiftKey)}
                    />
                  </span>
                )}
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
                    // `position: relative` makes the button the containing block of its
                    // visually-hidden "Open details." span; otherwise that absolute span sits at
                    // the end of the untruncated title and overflows the card to the right.
                    style={{ flex: 1, minWidth: 0, position: 'relative' }}
                    onOpenDetail={onOpenDetail}
                  />
                  <span style={{
                    flexShrink: 0, fontSize: 'var(--wb-fs-12)', fontWeight: 700,
                    color: overdue && item.priority !== 'high' ? metaColor : CARD_PRIORITY_COLOR[item.priority],
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
                  fontSize: 'var(--wb-fs-12)', fontWeight: 600, color: metaColor,
                }}>
                  {leadColumn !== undefined && (
                    <>
                      <span title={leadCourse ?? undefined}>
                        <span style={VISUALLY_HIDDEN}>{leadColumn.label}: </span>
                        {leadCourse ? shortCourseCode(leadCourse) : (leadValue ?? DASH)}
                      </span>
                      <span aria-hidden style={{ color: 'var(--wb-text-faint)' }}>·</span>
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
                  fontSize: 'var(--wb-fs-12)', fontWeight: 600,
                }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    color: DUE_COLOR[dueState],
                  }}>
                    {dueState === 'overdue'
                      ? <AlertTriangle size={13} aria-hidden style={{ flexShrink: 0 }} />
                      : <Calendar size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.75 }} />}
                    <span style={VISUALLY_HIDDEN}>Deadline: </span>
                    {dateLabel}
                    {/* Without this the lateness would be carried by the colour alone — the card,
                        like the table cell, shows a bare date with no "Overdue" in the string. */}
                    <span style={VISUALLY_HIDDEN}>
                      {dateLabel === DASH ? ' No deadline set.' : (DUE_SR_SUFFIX[dueState] ?? '')}
                    </span>
                  </span>

                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px', color: metaColor,
                  }}>
                    <Clock size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.75 }} />
                    <span style={VISUALLY_HIDDEN}>Deadline time: </span>
                    {timeLabel}
                    <span style={VISUALLY_HIDDEN}>{timeLabel === DASH ? ' No time set.' : ''}</span>
                  </span>

                  <div style={{ marginLeft: 'auto' }}>
                    <CardLinksButton item={item} onChanged={onChanged} overdue={overdue} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {footer}
        {bulkBar}
      </>
    );
  }

  /** The sticky header cell's shared look; the sort buttons and the select-all box sit in it. */
  /** The sticky header cell's shared look; the sort buttons and the select-all box sit in it.
   *  No background inline: `.vb-th` gets its frosted strip from the rules below once scrolled. */
  const thStyle: React.CSSProperties = {
    position: 'sticky', top: 0, zIndex: 2,
    // Spec §6: a 40px header. The sort button carries its own vertical padding, so the whole
    // strip height is the click target (WCAG 2.2 Target Size wants ≥24px).
    height: 40, boxSizing: 'border-box', padding: '0 12px', whiteSpace: 'nowrap', verticalAlign: 'middle',
  };

  return (
    <>
      {/* The scroll container, not the page, is what the sticky header sticks inside — and it is
          focusable with a name because a scrollable region must be reachable by keyboard alone. */}
      <div
        className={`vb-table-scroll${scrolled ? ' is-scrolled' : ''}`}
        role="region"
        aria-label="Work items table"
        tabIndex={0}
        onScroll={e => setScrolled(e.currentTarget.scrollTop > 0)}
        // `scroll-padding-top` per addendum §15d: tabbing between inline controls scrolls this
        // container to bring the next one into view, and the sticky header would then sit on top of
        // it — WCAG 2.2 AA *Focus Not Obscured (Minimum)* forbids persistent UI fully covering the
        // focused control. The header is 40px and §9's ring extends 4px past a control's box, so
        // 44px is the floor; 48px leaves the 6px row gap's worth of air.
        style={{
          maxHeight: '68vh', overflow: 'auto', borderRadius: 'var(--wb-r-item)', scrollPaddingTop: '48px',
          // Room for the last row's drop shadow, which the scroll box would otherwise clip.
          paddingBottom: '6px',
        }}
      >
        <table
          className={`vb-table${selection.count ? ' has-selection' : ''}`}
          // Spec §6: separate glass strips with a 6px gap. The negative margin hides the spacing
          // above the header row, so no row can peek out above the sticky header.
          style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px', marginTop: '-6px', fontFamily: FONT }}
        >
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
              <th scope="col" className="vb-th" style={{ ...thStyle, width: 44, padding: '0 0 0 12px' }}>
                <WbCheckbox
                  shape="square"
                  checked={selection.allState}
                  label="Select all rows"
                  onChange={on => selection.setAll(on)}
                />
              </th>
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
                  className="vb-th"
                  style={{ ...thStyle, textAlign: col.align === 'right' ? 'right' : 'left' }}
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
                      // overrides the inherited font. Spec 7's header label.
                      font: '800 var(--wb-fs-11) var(--wb-font-ui)', letterSpacing: '0.06em', textTransform: 'uppercase',
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
            {sortedItems.map(item => {
              const isDone    = item.work_status === 'done';
              const isOverdue = dueStateOf(item, todayStr) === 'overdue';
              const key       = itemKey(item);
              const selected  = selection.isSelected(key);
              const rowClass  = 'vb-table-row'
                + (selected ? ' is-selected' : '')
                + (isOverdue ? ' is-overdue' : '')
                + (isDone ? ' is-done' : '');

              return (
                <tr key={key} className={rowClass}>
                  <td
                    // Shift-click extends the selection; without this it also selects page text.
                    onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }}
                    style={{ padding: '0 0 0 12px', width: 44, verticalAlign: 'middle' }}
                  >
                    {/* The row's glass strip (spec §6). A `<tr>` cannot take a radius and a
                        per-cell background restarts its gradient in every cell, so the strip is
                        one absolutely positioned layer sized by the row (`.vb-table-row` is its
                        containing block) and drawn behind the cells. */}
                    <span aria-hidden className="wb-glass-item vb-row-glass" />
                    <WbCheckbox
                      shape="square"
                      checked={selected}
                      label={`Select "${item.title}"`}
                      onChange={(_, e) => selection.toggle(key, e.shiftKey)}
                      className="vb-row-check"
                    />
                  </td>
                  {columns.map(col => {
                    const value = cellValue(item, col.key);

                    const base: React.CSSProperties = {
                      // The row's 52px comes from the `<tr>` (spec §6); this only spaces columns.
                      padding: '7px 12px',
                      textAlign: col.align === 'right' ? 'right' : 'left',
                      verticalAlign: 'middle',
                      whiteSpace: 'nowrap',
                      // Spec §6: every cell but Work is 550/13px muted.
                      fontSize: 'var(--wb-fs-13)',
                      fontWeight: 550,
                      // Muted on the overdue wash is ~3.8:1, so overdue rows use body text (8:1).
                      color: isOverdue ? 'var(--wb-text)' : 'var(--wb-text-muted)',
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
                              style={{ display: 'block', maxWidth: '340px', width: '100%', position: 'relative' }}
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
                            // The Deadline cell (not Time) carries the overdue label hook; the
                            // rules below read it only on an `.is-overdue` row.
                            style={col.key === 'deadline' ? { ...base, ...OVERDUE_LABEL_HOOK } : base}
                            todayStr={todayStr}
                            editor={deadlineEditor}
                          />
                        );

                      case 'context':
                      case 'course':
                      case 'organization':
                      case 'area':
                      case 'project':
                      case 'estimate': {
                        // `cellValue` already guarantees a non-empty string for all six — the
                        // `?? DASH` is belt-and-braces against a future signature change, never a
                        // reachable path today.
                        const text = value ?? DASH;
                        // Spec §6: the identity column wears a glow dot. The Course column shows
                        // the short code ("CS0061L"), with the full section code as its tooltip.
                        if (col.key !== leadKey || text === DASH) {
                          return <td key={col.key} style={base}>{text}</td>;
                        }
                        const course = col.key === 'course' ? item.course_code : null;
                        return (
                          <td key={col.key} style={base}>
                            <span className="vb-ctx-cell" title={course ?? undefined}>
                              <span
                                aria-hidden
                                className="wb-gdot"
                                style={{ '--dot': contextDot(item) } as React.CSSProperties}
                              />
                              {course ? shortCourseCode(course) : text}
                            </span>
                          </td>
                        );
                      }

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
          /* Refine spec §6: each row is a floating glass strip. The row is the containing block
             and its own stacking context, so the layer sits behind this row's cells only. */
          .vb-table-row {
            position: relative;
            isolation: isolate;
            height: 52px;
            transition: transform var(--wb-dur-fast) var(--wb-ease);
          }
          .vb-row-glass {
            position: absolute;
            inset: 0;
            z-index: -1;
            pointer-events: none;
          }
          .vb-table-row.is-overdue .vb-row-glass {
            background: ${OVERDUE_WASH};
          }
          .vb-table-row.is-selected .vb-row-glass {
            background: ${SELECTED_WASH};
            box-shadow: ${SELECTED_RING}, var(--wb-glass-item-shadow);
          }
          /* The lift lives on the row, not the layer: the layer takes no pointer events, and the
             cells must rise with it. Same 1px and hover shadow as .wb-glass-item--hoverable. */
          @media (hover: hover) and (pointer: fine) {
            .vb-table-row:hover { transform: translateY(-1px); }
            .vb-table-row:hover .vb-row-glass { box-shadow: var(--wb-glass-item-shadow-hover); }
            .vb-table-row.is-selected:hover .vb-row-glass {
              box-shadow: ${SELECTED_RING}, var(--wb-glass-item-shadow-hover);
            }
            .vb-table-row:hover :global(.vb-row-check) { opacity: 1; }
            .vb-th-sort:hover { color: var(--wb-text); }
          }
          @media (prefers-reduced-motion: reduce) {
            .vb-table-row { transition: none; }
            .vb-table-row:hover { transform: none; }
          }
          /* The header has no fill at rest; once rows can slide beneath it, it takes the panel's
             glass over a near-opaque base so passing text cannot show through the labels. */
          .vb-table-scroll.is-scrolled .vb-th {
            background: var(--wb-glass-panel), rgba(255, 255, 255, 0.72);
            box-shadow: inset 0 -1px 0 var(--wb-hairline);
          }
          /* Work is the one 650/14px text (spec §6). WorkTitleButton sets its weight inline, so
             only !important can raise it from here without touching the shared component. */
          .vb-table-row :global(.vb-row-title) {
            font-weight: 650 !important;
          }
          /* Spec §6 "title muted": --wb-text-muted keeps AA; subtle would be ~2.4–3.1:1. */
          .vb-table-row.is-done :global(.vb-row-title-done) {
            color: var(--wb-text-muted);
            text-decoration-thickness: 1.5px;
          }
          .vb-ctx-cell {
            display: inline-flex;
            align-items: center;
            gap: 8px;
          }
          /* "⚠ Overdue · Jul 7": the word goes between DeadlineCell's icon and its date. The
             alt text after the slash is empty because the cell's visually-hidden suffix already
             says "(overdue)". Only the Deadline td defines the two properties; on the Time td the
             content is invalid and computes to none. */
          .vb-table-row.is-overdue :global(.vb-deadline-trigger) {
            font-weight: var(--vb-od-weight, 600);
            color: var(--vb-od-color, var(--wb-text));
          }
          /* The cells' own muted/blue-ink text is ~3.7–3.8:1 on the overdue wash; body text is 8:1.
             High priority keeps its danger red (5.2:1). */
          .vb-table-row.is-overdue :global(.vb-priority-select:not(.is-high)),
          .vb-table-row.is-overdue :global(.vb-links-trigger) {
            color: var(--wb-text);
          }
          .vb-table-row.is-overdue :global(.vb-deadline-trigger > svg) {
            order: -1;
          }
          .vb-table-row.is-overdue :global(.vb-deadline-trigger)::before {
            content: var(--vb-od-label) / '';
          }
          /* The row checkbox appears on hover or focus, and stays once anything is selected. */
          .vb-table-row :global(.vb-row-check) {
            opacity: 0;
            transition: opacity var(--wb-dur-fast) var(--wb-ease);
          }
          .vb-table-row:focus-within :global(.vb-row-check),
          .vb-table.has-selection :global(.vb-row-check) {
            opacity: 1;
          }
          @media (hover: none) {
            .vb-table-row :global(.vb-row-check) { opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            .vb-table-row :global(.vb-row-check) { transition: none; }
          }
          .vb-table-scroll:focus-visible {
            outline: 2px solid var(--wb-blue-strong);
            outline-offset: 2px;
          }
          /* A column header is load-bearing information, so it takes the AA-passing muted colour.
             The sorted column darkens to the body-text shade so it reads as active without the
             caret alone. */
          .vb-th-sort {
            color: var(--wb-text-muted);
          }
          .vb-th-sort-on {
            color: var(--wb-text);
          }
          .vb-th-sort:focus-visible {
            outline: 2px solid var(--wb-blue-strong);
            outline-offset: 2px;
            border-radius: var(--wb-r-sm);
          }
        `}</style>
      </div>
      {footer}
      {bulkBar}
    </>
  );
}
