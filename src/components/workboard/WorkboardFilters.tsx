'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal, Check } from 'lucide-react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope,
// so a *value* import here would drag the driver into this client bundle and 500 the page.
// Same hazard documented in `WorkboardShell.tsx`, `DeadlineCell.tsx`, `StatusCell.tsx`,
// `PriorityCell.tsx`, `WorkItemRow.tsx` and `WorkTableView.tsx`.
import type { ProjectSummary, WorkItem, WorkPriority } from '@/lib/workboard/workItems';
// `workContexts.ts` is pool-free by design (see its module header), so the stage vocabularies,
// their labels and the context labels are all safe to import into a client component.
import {
  CONTEXT_LABELS, STAGES_BY_CONTEXT, STAGE_LABELS,
  type WorkContext, type WorkStatus,
} from '@/lib/workboard/workContexts';
// The single source of truth for "overdue" on every Workboard surface. Hand-rolling a
// `due < today` comparison here would give the popover its own private definition of lateness,
// which is exactly the drift `dueSemantics.ts` exists to prevent.
import { dueStateOf } from '@/lib/workboard/dueSemantics';
// Pool-free (see the module header in `dates.ts`). The only approved way to read an item's
// calendar date — `due_at` is a DATETIME for owned rows and a DATE for academic ones.
import { dueDateOf } from '@/lib/workboard/dates';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";

/* ─── State ────────────────────────────────────────────────────────────────────────────── */

/**
 * Everything the Filters popover can narrow by. Owned by `WorkboardShell` (which composes it
 * into the single `visibleItems` memo every view reads), rendered and mutated here.
 *
 * `status` is a plain `string` rather than a union on purpose: its vocabulary depends on the
 * active context. Under a single context it holds a `WorkStage` from that context's own list
 * (Academic can therefore filter to "Ready to Submit"); under My Work it holds one of the three
 * normalised `WorkStatus` values, because items there span four different stage vocabularies and
 * no single one of them fits. Typing it as `WorkStage | WorkStatus | ''` would be a union whose
 * legal members change per render, which the type system cannot express usefully — the shell's
 * context-change reset (below) is what actually keeps the value and the vocabulary in step.
 */
export interface FilterState {
  /** '' = All. Otherwise a `WorkStage` (single context) or a `WorkStatus` (My Work). */
  status:       string;
  priority:     WorkPriority | '';
  /** '' = All projects. */
  projectId:    number | '';
  /** "YYYY-MM-DD", or null for an open-ended bound. */
  deadlineFrom: string | null;
  deadlineTo:   string | null;
  overdueOnly:  boolean;
}

export const EMPTY_FILTERS: FilterState = {
  status: '', priority: '', projectId: '', deadlineFrom: null, deadlineTo: null, overdueOnly: false,
};

/**
 * The trigger badge's number: one per filter *type*, not per input field, so the two date inputs
 * count once between them as a single "deadline range" dimension. Maximum 5.
 */
export function countActiveFilters(filters: FilterState): number {
  let n = 0;
  if (filters.status !== '') n += 1;
  if (filters.priority !== '') n += 1;
  if (filters.projectId !== '') n += 1;
  if (filters.deadlineFrom !== null || filters.deadlineTo !== null) n += 1;
  if (filters.overdueOnly) n += 1;
  return n;
}

/**
 * The whole predicate, pure and side-effect free, so the shell can call it inside `visibleItems`
 * and every view — Focus, Table, Board, Timeline — filters identically without implementing any
 * of this itself.
 *
 * Two rulings worth stating, because neither is forced by the brief:
 *
 * 1. **The status dimension reads a different field per context.** Under a single context it
 *    compares `work_stage`, matching the Board's per-context columns and the Table's Status cell;
 *    under My Work it compares `work_status`, matching those same two surfaces' My Work
 *    behaviour. Comparing `work_stage` under My Work would silently hide every `backlog` item
 *    from a "To Do" filter, which is the opposite of what the normalised view promises.
 * 2. **An undated item never satisfies a deadline range.** Either bound being set makes the
 *    range an assertion about *when* an item is due, and an item with no deadline has no answer
 *    to that question — including it would put items with no date inside a date window. The
 *    range is inclusive on both ends (`>= from`, `<= to`), matching how a user reads two date
 *    fields labelled From and To.
 */
export function matchesFilters(
  item: WorkItem,
  filters: FilterState,
  context: WorkContext | 'all',
  todayStr: string,
): boolean {
  if (filters.status !== '') {
    const field = context === 'all' ? item.work_status : item.work_stage;
    if (field !== filters.status) return false;
  }

  if (filters.priority !== '' && item.priority !== filters.priority) return false;

  if (filters.projectId !== '' && item.project_id !== filters.projectId) return false;

  if (filters.deadlineFrom !== null || filters.deadlineTo !== null) {
    const due = dueDateOf(item);
    if (due === null) return false;
    if (filters.deadlineFrom !== null && due < filters.deadlineFrom) return false;
    if (filters.deadlineTo !== null && due > filters.deadlineTo) return false;
  }

  // `dueStateOf` rather than a date comparison: it is the one place that knows a *done* item is
  // never "overdue" (it is `completed` or `completed_late`), which a bare `due < today` check
  // would get wrong for every completed item with a past deadline.
  if (filters.overdueOnly && dueStateOf(item, todayStr) !== 'overdue') return false;

  return true;
}

/* ─── Local presentation constants ─────────────────────────────────────────────────────── */

/** My Work's status vocabulary — the normalised three, the same set the Board's My Work columns
 *  and the Table's Status cell under All use. Labels match `WorkItemDialog.tsx`'s private
 *  `STATUS_LABEL` verbatim; duplicated rather than exported from there for the same reason the
 *  `GLASS` recipe is duplicated across three files in this module (see `WorkboardShell.tsx`'s
 *  note): small presentational constants stay local so no file acquires an import path it does
 *  not otherwise need. */
const STATUS_OPTIONS: WorkStatus[] = ['todo', 'in_progress', 'done'];
const STATUS_LABEL: Record<WorkStatus, string> = {
  todo:        'To Do',
  in_progress: 'In Progress',
  done:        'Done',
};

const PRIORITY_OPTIONS: WorkPriority[] = ['high', 'normal', 'low'];
const PRIORITY_LABEL: Record<WorkPriority, string> = {
  high:   'High',
  normal: 'Normal',
  low:    'Low',
};

/**
 * Direction-addendum §16a's four context hues and their darkened text pairs, for §16b's **form
 * 3** — the compact label — which §16c scopes to the Filters popover's context rows and nowhere
 * else in the app.
 *
 * Values duplicated locally rather than imported from `WorkBoardView`'s `CATEGORY_META` or
 * `WorkTimelineView`'s `CATEGORY_HUE`: this module's convention (documented on `GLASS` in
 * `WorkboardShell.tsx` and repeated in `WorkboardWeekView.tsx`/`WorkboardRail.tsx`) is that a
 * small presentational constant is copied into each file that needs it, so no file acquires a
 * runtime import edge for four hex strings. §16a is the authority both copies answer to.
 */
const CONTEXT_ACCENT: Record<WorkContext, { raw: string; darkened: string }> = {
  academic:     { raw: '#4dabf5', darkened: '#185a7d' },
  project:      { raw: '#8b7fd6', darkened: '#4f3fa0' },
  organization: { raw: '#f0a35c', darkened: '#8a5010' },
  life:         { raw: '#f2a7c0', darkened: '#8a4468' },
};

/** The order context sections appear in under My Work — the same order the shell's context tabs
 *  use, so the popover's project groups and the tab row above it read left-to-right the same. */
const CONTEXT_ORDER: WorkContext[] = ['academic', 'project', 'organization', 'life'];

/** `DeadlineCell.tsx`'s control language, unchanged: the module's popovers already share one
 *  input/label/button vocabulary and a filters panel is not the place to invent a second. */
const CONTROL_STYLE: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: '32px', borderRadius: '8px',
  padding: '4px 8px', background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(200,210,230,0.6)', fontFamily: FONT, fontSize: '0.82rem',
  fontWeight: 500, color: '#2d3748',
};

const SECTION_LABEL: React.CSSProperties = {
  display: 'block', fontFamily: FONT, fontSize: '0.7rem', fontWeight: 700,
  color: '#5c6b80', marginBottom: '4px',
};

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

const PANEL_WIDTH = 292;
/** Gap between the trigger and the panel, and the panel and the viewport edge — `DeadlineCell`'s
 *  two constants, same values. */
const GAP = 6;
const MARGIN = 8;

/* ─── Phone breakpoint ─────────────────────────────────────────────────────────────────────
 * Addendum §21 gives this popover two treatments, not three: anchored at `≥1024px`, "unchanged"
 * at `768–1023px`, and a bottom sheet below `768px`. One boundary, so one boolean.
 *
 * **This has to be decided in JavaScript, unlike the context row and the detail drawer**, which
 * §21 places at the same breakpoint and which this task moves into `@media` rules. Those two are
 * laid out by normal flow, so a class rule can restyle them. This panel's position is pixel math:
 * a layout effect measures the panel and the trigger and writes `left`/`top` as inline values. No
 * media query can turn "anchored 6px under a button at x=871" into "pinned to the viewport
 * bottom", because there is no CSS property holding the anchoring — the anchoring *is* the
 * computed number. So the branch is on the render, and the measurement is skipped outright when
 * there is nothing to anchor to.
 *
 * The query is `(max-width: 767px)` rather than the negation of a `(min-width: 768px)` query so
 * that it is the exact complement of the `@media (max-width: 767px)` rules this task adds to
 * `WorkboardShell` and `WorkItemDetail`: at a fractional viewport width between the two values
 * (a zoomed desktop browser can produce one), negating a min-width query would put this panel in
 * its phone form while the context row beside it was still in its tablet form.
 *
 * Shape otherwise copied from `WorkTableView`'s `useWidthTier`: state seeded with the desktop
 * value so the server render and the first client paint agree — the effect only ever corrects it
 * after mount — `update()` called once immediately, and the listener removed on unmount. Copied
 * rather than imported for this module's usual reason (see `CONTEXT_ACCENT` above): a small
 * private helper is duplicated into each file that needs it instead of creating an import edge
 * between sibling view components. `useWidthTier` is not exported in any case.
 */
const PHONE_MAX_WIDTH = 767;

function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const phone = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);
    const update = () => setIsPhone(phone.matches);
    update();
    phone.addEventListener('change', update);
    return () => phone.removeEventListener('change', update);
  }, []);
  return isPhone;
}

/** Everything the panel looks like at *every* width, factored out so the two position shapes
 *  below differ only by the properties that actually differ. `position: fixed` is in here rather
 *  than in either branch because both shapes are fixed — one to a measured point, one to the
 *  viewport's bottom edge. */
const PANEL_SURFACE: React.CSSProperties = {
  position: 'fixed', zIndex: 40, boxSizing: 'border-box',
  background: '#fff', boxShadow: '0 8px 24px rgba(31,38,68,0.18)', padding: '12px',
  display: 'flex', flexDirection: 'column', gap: '12px',
  textAlign: 'left', fontFamily: FONT,
};

/* ─── The project listbox ──────────────────────────────────────────────────────────────── */

/** One rendered section of the project list. Under a single context there is exactly one section
 *  and it has no header; under My Work there is one per context that actually owns a project. */
interface ProjectGroup {
  context:  WorkContext | null;   // null = the ungrouped single-context list
  projects: ProjectSummary[];
}

/**
 * §16b form 3, rendered exactly as specified: a `6px` dot in the context's raw hue, then the
 * context's name at `0.68rem`/700/uppercase in its darkened text colour, `gap: 5px`, and **no
 * background fill, no padding, no border**. `aria-hidden` because the section's accessible
 * grouping is carried by the `role="group"`'s `aria-label` — announcing the name twice would
 * make every option in the section read its context header first.
 */
function ContextCompactLabel({ context }: { context: WorkContext }) {
  const accent = CONTEXT_ACCENT[context];
  return (
    <div
      aria-hidden
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700,
        // §16b form 3 is "the chip with its pill removed", and the shipped chip
        // (`WorkItemRow.tsx`'s `CategoryChip`, `WorkBoardView.tsx:300-304`) declares **no**
        // tracking — so neither does this. `normal` rather than simply omitting the property:
        // §1's 0.04em uppercase tracking is on several nearby micro-labels in this module, and an
        // explicit value means a future container edit cannot inherit tracking onto a form that
        // is defined by matching the chip's type exactly.
        textTransform: 'uppercase', letterSpacing: 'normal',
        color: accent.darkened,
        // Spelled out rather than merely omitted: §16b's form 3 is defined by what it does *not*
        // carry, and an inherited padding or border from a future container edit would quietly
        // turn it back into form 1.
        background: 'none', border: 'none', padding: 0,
        marginTop: '6px', marginBottom: '2px',
      }}
    >
      <span style={{
        flex: '0 0 6px', width: '6px', height: '6px', borderRadius: '50%',
        background: accent.raw,
      }} />
      {CONTEXT_LABELS[context]}
    </div>
  );
}

interface ProjectOptionRowProps {
  label:       string;
  selected:    boolean;
  /** Roving tabindex: 0 for the selected row, -1 for every other. */
  tabIndex:    number;
  /** The panel keeps one flat ref array for its arrow keys; this hands the element back to it. */
  registerRef: (el: HTMLButtonElement | null) => void;
  onSelect:    () => void;
  onKeyDown:   (e: React.KeyboardEvent) => void;
}

/**
 * One row of the project listbox — **a real component, not a helper function returning JSX**, and
 * that distinction is the whole reason it exists.
 *
 * styled-jsx's SWC transform scopes the JSX that appears lexically inside the *same function* as
 * the `<style jsx>` tag. When these buttons were built by an `optionRow(...)` arrow function
 * declared beside the panel's `return`, they sat in a different function scope, so the compiler
 * emitted `className: "vb-filters-option"` with no `jsx-<hash>` alongside it while every sibling
 * control got one — and the panel's `.vb-filters-option:hover` / `:focus-visible` rules compiled
 * to `.vb-filters-option.jsx-<hash>{…}`, a selector that could never match. The rows silently lost
 * this module's `2px #2a7fa8` focus ring and their hover affordance.
 *
 * This is the same trap `WorkItemDetail.tsx`'s `WorkTitleButton` was extracted to escape, fixed
 * the same way: the button now lives in a component that owns its own `<style jsx>` block, so the
 * rules and the elements they target share one scope hash. Verified in the compiled SWC output,
 * not assumed — see this task's report.
 */
function ProjectOptionRow({
  label, selected, tabIndex, registerRef, onSelect, onKeyDown,
}: ProjectOptionRowProps) {
  return (
    <>
      <button
        ref={registerRef}
        type="button"
        role="option"
        aria-selected={selected}
        tabIndex={tabIndex}
        className="vb-filters-option"
        onClick={onSelect}
        onKeyDown={onKeyDown}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
          boxSizing: 'border-box', minHeight: '28px', padding: '4px 8px',
          borderRadius: '8px', border: 'none', textAlign: 'left',
          background: selected ? 'rgba(37,111,146,0.12)' : 'transparent',
          fontFamily: FONT, fontSize: '0.8rem',
          fontWeight: selected ? 700 : 500,
          color: selected ? '#1f5c7a' : '#2d3748',
          cursor: 'pointer',
        }}
      >
        <span style={{ flex: '0 0 13px', display: 'inline-flex', alignItems: 'center' }}>
          {selected ? <Check size={13} aria-hidden /> : null}
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </button>

      {/* Moved here from the panel's own block, which is the point of this component. Every row
          renders the same declaration; styled-jsx keys its registry by the style's hash, so the
          rule is injected once however many rows are on screen. */}
      <style jsx>{`
        /* §9's ring, on the darker blue — :focus-visible so a mouse click does not leave a ring
           nobody asked for, while keyboard arrival through the listbox always does. */
        .vb-filters-option:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        .vb-filters-option:hover {
          background: rgba(37,111,146,0.08);
        }
      `}</style>
    </>
  );
}

/* ─── The popover panel ────────────────────────────────────────────────────────────────── */

interface AnchorRect { left: number; right: number; top: number; bottom: number }

interface PanelProps {
  filters:  FilterState;
  onChange: (next: FilterState) => void;
  context:  WorkContext | 'all';
  projects: ProjectSummary[];
  anchor:   AnchorRect;
  onClose:  () => void;
}

/**
 * Solid white rather than §11's glass recipe, `position: fixed` rather than absolute, measured
 * once in a layout effect and flipped above the trigger when the viewport has no room below —
 * `DeadlineCell`'s `DeadlinePopover` shape, deliberately unchanged, so the module has one
 * floating-panel mechanism rather than two.
 *
 * The one deviation: the panel is aligned to the trigger's **right** edge rather than its left,
 * because this trigger sits at the right end of the toolbar where a left-aligned 292px panel
 * would immediately hit the clamp and detach from its own trigger. The clamp is still applied
 * afterwards, so a narrow viewport behaves exactly as it does for the deadline popover.
 *
 * All of the above describes the panel at `≥768px`. Below that, addendum §21 makes it a bottom
 * sheet: the anchoring is skipped rather than clamped, and the panel takes the detail drawer's
 * phone metrics. See `useIsPhone` for why that branch is in JavaScript while the drawer's and the
 * context row's are `@media` rules, and `panelStyle` for the two shapes. Open/close mechanics —
 * Escape, outside click, scroll and resize dismissal, focus in and focus back — are untouched by
 * the branch and identical in both.
 */
function FiltersPanel({ filters, onChange, context, projects, anchor, onClose }: PanelProps) {
  const ids       = useId();
  const statusId  = `${ids}-status`;
  const priorityId = `${ids}-priority`;
  const fromId    = `${ids}-from`;
  const toId      = `${ids}-to`;
  const overdueId = `${ids}-overdue`;
  const projectLabelId = `${ids}-project-label`;

  const panelRef  = useRef<HTMLDivElement>(null);
  const firstRef  = useRef<HTMLSelectElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const isPhone = useIsPhone();

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    // Phone renders a bottom sheet, whose position is four fixed edge values and no arithmetic.
    // Returning before the measurement is what keeps `pos` out of that branch entirely: the phone
    // style below reads none of it, and this effect writes none of it. Neither half can end up
    // half-applied, which is the failure mode a shared `pos` between the two shapes would invite.
    if (isPhone) return;
    const el = panelRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();

    let left = anchor.right - width;
    if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - MARGIN - width;
    if (left < MARGIN) left = MARGIN;

    let top = anchor.bottom + GAP;
    if (top + height > window.innerHeight - MARGIN) {
      const above = anchor.top - height - GAP;
      top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - MARGIN - height);
    }
    setPos({ left, top });
  }, [anchor, isPhone]);

  // Opening moves focus into the panel; the trigger's own Escape/Done handling moves it back.
  // `opacity: 0` rather than `visibility: hidden` for the pre-measurement frame precisely so
  // this can run — a `visibility: hidden` element is not focusable.
  useEffect(() => { firstRef.current?.focus(); }, []);

  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filters, [key]: value });

  /** The status vocabulary, per the ruling on `matchesFilters` above. */
  const statusOptions: { value: string; label: string }[] = context === 'all'
    ? STATUS_OPTIONS.map(s => ({ value: s, label: STATUS_LABEL[s] }))
    : STAGES_BY_CONTEXT[context].map(s => ({ value: s, label: STAGE_LABELS[s] }));

  /** Under a single context: that context's projects, ungrouped. Under My Work: one section per
   *  context that actually owns a project, in the tab row's order. Empty sections are dropped
   *  rather than rendered as a lone header — and note projects only ever carry three of the four
   *  contexts (`PROJECT_CONTEXTS` has no `life`), so the Life section is normally absent by
   *  construction rather than by this filter. Archived projects stay listed: they still own
   *  items, and an item attached to one must remain reachable. */
  const groups: ProjectGroup[] = useMemo(() => {
    if (context !== 'all') {
      return [{ context: null, projects: projects.filter(p => p.context === context) }];
    }
    return CONTEXT_ORDER
      .map(c => ({ context: c as WorkContext | null, projects: projects.filter(p => p.context === c) }))
      .filter(g => g.projects.length > 0);
  }, [projects, context]);

  /** Every option's value in DOM order, "All projects" first — the roving-tabindex index space
   *  for the listbox's arrow keys. Rebuilt with the groups, so a context switch cannot leave the
   *  keyboard cursor pointing past the end of the list. */
  const optionValues: (number | '')[] = useMemo(
    () => ['' as number | '', ...groups.flatMap(g => g.projects.map(p => p.id))],
    [groups],
  );

  const selectedIndex = Math.max(0, optionValues.indexOf(filters.projectId));

  /** Whether there is a single *real* project to choose in the current scope — the question the
   *  section's empty state actually asks. Keyed on `groups` rather than on the raw `projects`
   *  prop: under a specific context tab whose own list is empty (the live state today on three of
   *  the four tabs), the prop is non-empty while this scope has nothing in it, and the check
   *  would render a bordered, padded scroll box holding nothing but the ever-present "All
   *  projects" row — which reads as stuck rather than as "there is nothing here". */
  const hasProjects = groups.some(g => g.projects.length > 0);

  /** WAI-ARIA's listbox keyboard contract, with selection following focus — the same shape (and
   *  the same wrap-around Home/End behaviour) as the shell's own `handleRovingKeyDown`, which its
   *  context radiogroup and view tablist both use. Duplicated rather than exported from the shell
   *  for the usual reason: one small helper, two files, no shared import edge. */
  const handleOptionKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const count = optionValues.length;
    let next: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (idx + 1) % count;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (idx - 1 + count) % count;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    if (next === null) return;
    e.preventDefault();
    set('projectId', optionValues[next]);
    optionRefs.current[next]?.focus();
  };

  const activeCount = countActiveFilters(filters);

  /** Builds one option row. `flatIndex` is its position in `optionValues`, which is what the
   *  roving tabindex and the arrow keys both index by. The row itself is a real component
   *  (`ProjectOptionRow`) rather than JSX returned from here — see that component's comment; JSX
   *  built inside this function would not be scoped by any `<style jsx>` block in this file. */
  const optionRow = (value: number | '', label: string, flatIndex: number) => (
    <ProjectOptionRow
      key={value === '' ? 'all' : value}
      label={label}
      selected={filters.projectId === value}
      tabIndex={flatIndex === selectedIndex ? 0 : -1}
      registerRef={el => { optionRefs.current[flatIndex] = el; }}
      onSelect={() => set('projectId', value)}
      onKeyDown={e => handleOptionKeyDown(e, flatIndex)}
    />
  );

  // A running counter rather than an index computed per group: the flat index has to advance
  // across group boundaries, and "All projects" already occupies 0.
  let flat = 0;

  /**
   * Addendum §21's two shapes for this surface, and the `isPhone` ternary is the only thing that
   * chooses between them — there is no width at which a property from one leaks into the other.
   *
   * **Non-phone** is byte-for-byte what shipped: the measured `left`/`top` with the pre-measured
   * fallback, the `opacity`/`pointerEvents` guard that hides the panel for the one frame before
   * the layout effect runs, and the 292px rounded card.
   *
   * **Phone** is the drawer's bottom sheet, sharing its phone metrics (`width: 100%`,
   * `height: min(88vh, 100%)`, `border-radius: 18px 18px 0 0`). Three decisions inside that are
   * this control's rather than §21's, since §21 says only "sharing the drawer's phone metrics":
   *
   * 1. **Border on the top edge only.** Bottom-anchored and full-width leaves three of the four
   *    edges flush with the viewport, where a border draws a line against nothing; the top edge
   *    is the one newly exposed against the page behind it and is the one that needs the rule.
   *    Exactly the swap the drawer makes (`border-left: none` + `border-top`), applied to this
   *    sheet's own geometry.
   * 2. **No `opacity`/`pointerEvents` guard.** That guard exists to hide the panel until `pos` is
   *    measured, and this branch has no measurement to wait for — carrying it over would read
   *    `pos`, which stays `null` here forever, and leave the sheet permanently invisible and
   *    click-through. This is the specific way the two branches could have been wired into each
   *    other, and it is why the effect's early return and this omission are a pair.
   * 3. **`overflow-y: auto`.** The panel is content-height everywhere else, but this branch gives
   *    it a fixed `88vh`; on a short viewport the footer buttons would otherwise fall outside a
   *    box with no way to scroll to them. The drawer carries the same property for the same
   *    reason. The panel is inside `containerRef`, so the trigger's capture-phase scroll-dismiss
   *    already ignores scrolls that originate in here, exactly as it does for the project listbox.
   *
   * Everything else — ground, shadow, padding, gap, type — is `PANEL_SURFACE`, unchanged. This is
   * a repositioning, not a restyle: the shadow stays the downward `0 8px 24px` it has always been
   * rather than being flipped upward for the sheet, because the new top border is what separates
   * the sheet from the page and §21 asks for no shadow change.
   */
  const panelStyle: React.CSSProperties = isPhone
    ? {
        ...PANEL_SURFACE,
        left: 0, right: 0, bottom: 0,
        width: '100%', height: 'min(88vh, 100%)', overflowY: 'auto',
        borderRadius: '18px 18px 0 0',
        borderTop: '1px solid rgba(200,210,230,0.6)',
      }
    : {
        ...PANEL_SURFACE,
        left: pos?.left ?? Math.max(MARGIN, anchor.right - PANEL_WIDTH),
        top:  pos?.top  ?? anchor.bottom + GAP,
        // Hidden until measured, but still focusable — see the focus effect above.
        opacity: pos === null ? 0 : 1,
        pointerEvents: pos === null ? 'none' : 'auto',
        width: `${PANEL_WIDTH}px`,
        borderRadius: '12px',
        border: '1px solid rgba(200,210,230,0.6)',
      };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Filter work items"
      className="vb-filters-panel"
      onKeyDown={e => {
        // `DeadlineCell`'s ruling 3: Escape closes and hands focus back to the trigger (the
        // trigger's `onClose` does the refocus). `stopPropagation` so nothing outside the panel
        // also acts on the key.
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      }}
      style={panelStyle}
    >
      {/* Status — the context's own stage vocabulary, or My Work's normalised three. */}
      <div>
        <label htmlFor={statusId} style={SECTION_LABEL}>Status</label>
        <select
          ref={firstRef}
          id={statusId}
          className="vb-filters-control"
          value={filters.status}
          onChange={e => set('status', e.target.value)}
          style={CONTROL_STYLE}
        >
          <option value="">All statuses</option>
          {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Priority — context-independent, so it survives a context switch. */}
      <div>
        <label htmlFor={priorityId} style={SECTION_LABEL}>Priority</label>
        <select
          id={priorityId}
          className="vb-filters-control"
          value={filters.priority}
          onChange={e => set('priority', e.target.value as WorkPriority | '')}
          style={CONTROL_STYLE}
        >
          <option value="">All priorities</option>
          {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
      </div>

      {/* Project — the one section that cannot be a native `<select>`: §16c puts the compact
          label on these context rows, and a native `<optgroup>` cannot render a coloured dot. */}
      <div>
        <span id={projectLabelId} style={SECTION_LABEL}>Project</span>
        {!hasProjects ? (
          // Naming the scope, because under a context tab "No projects yet" would contradict the
          // project list the user can see on another tab. Hiding the listbox entirely also removes
          // the lone "All projects" row, which is the correct loss: with nothing to narrow to,
          // `projectId` is already '' (the shell clears it on every context change) and "Clear
          // filters" remains the escape hatch for any state that outlives a payload refresh.
          <p style={{ margin: 0, fontSize: '0.76rem', fontWeight: 600, color: '#8a94a6' }}>
            {context === 'all' ? 'No projects yet.' : 'No projects in this context yet.'}
          </p>
        ) : (
          <div
            role="listbox"
            aria-labelledby={projectLabelId}
            className="vb-filters-listbox"
            style={{
              maxHeight: '164px', overflowY: 'auto', padding: '4px',
              borderRadius: '8px', border: '1px solid rgba(200,210,230,0.6)',
              background: 'rgba(255,255,255,0.6)',
            }}
          >
            {optionRow('', 'All projects', flat++)}
            {groups.map(g => {
              const rows = g.projects.map(p => optionRow(p.id, p.name, flat++));
              if (g.context === null) return rows;
              return (
                <div key={g.context} role="group" aria-label={CONTEXT_LABELS[g.context]}>
                  <ContextCompactLabel context={g.context} />
                  {rows}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Deadline range — inclusive on both ends; an undated item matches neither bound. */}
      <div>
        <span style={SECTION_LABEL}>Deadline</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor={fromId} style={{ ...SECTION_LABEL, fontWeight: 600, color: '#8a94a6', marginBottom: '3px' }}>
              From
            </label>
            <input
              id={fromId}
              type="date"
              className="vb-filters-control"
              // The native empty value is `''`; the state's empty value is `null`, so the two are
              // translated at this boundary rather than letting `''` leak into `FilterState` and
              // give "no bound" two spellings.
              value={filters.deadlineFrom ?? ''}
              onChange={e => set('deadlineFrom', e.target.value === '' ? null : e.target.value)}
              style={CONTROL_STYLE}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor={toId} style={{ ...SECTION_LABEL, fontWeight: 600, color: '#8a94a6', marginBottom: '3px' }}>
              To
            </label>
            <input
              id={toId}
              type="date"
              className="vb-filters-control"
              value={filters.deadlineTo ?? ''}
              onChange={e => set('deadlineTo', e.target.value === '' ? null : e.target.value)}
              style={CONTROL_STYLE}
            />
          </div>
        </div>
      </div>

      {/* Overdue only. */}
      <label
        htmlFor={overdueId}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          fontFamily: FONT, fontSize: '0.8rem', fontWeight: 600, color: '#2d3748',
          cursor: 'pointer',
        }}
      >
        <input
          id={overdueId}
          type="checkbox"
          className="vb-filters-control"
          checked={filters.overdueOnly}
          onChange={e => set('overdueOnly', e.target.checked)}
          style={{ width: '16px', height: '16px', margin: 0, accentColor: '#256f92', cursor: 'pointer' }}
        />
        Overdue only
      </label>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px',
        paddingTop: '10px', borderTop: '1px solid rgba(200,210,230,0.5)',
      }}>
        <button
          type="button"
          className="vb-filters-btn"
          // Disabled rather than hidden: a control that appears and disappears as the last filter
          // clears would move the Done button under the pointer mid-click.
          disabled={activeCount === 0}
          onClick={() => onChange(EMPTY_FILTERS)}
          style={{
            minHeight: '30px', padding: '6px 12px', borderRadius: '8px',
            background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.6)',
            fontFamily: FONT, fontSize: '0.76rem', fontWeight: 600, color: '#5c6b80',
            cursor: activeCount === 0 ? 'default' : 'pointer',
            opacity: activeCount === 0 ? 0.45 : 1,
          }}
        >
          Clear filters
        </button>
        <button
          type="button"
          className="vb-filters-btn"
          onClick={onClose}
          style={{
            minHeight: '30px', padding: '6px 14px', borderRadius: '8px',
            background: '#2a7fa8', border: '1px solid #2a7fa8',
            fontFamily: FONT, fontSize: '0.76rem', fontWeight: 700, color: '#fff',
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>

      {/* These rules MUST live in the component that renders the elements they target — each
          component gets its own styled-jsx scope hash, so the same rule written in the parent
          would compile cleanly and match nothing. The trap several tasks in this plan have hit. */}
      <style jsx>{`
        /* The .vb-filters-option rules are deliberately NOT here: those buttons are rendered by
           ProjectOptionRow, a different component with a different styled-jsx scope hash, so a
           rule written here would compile to a selector matching none of them. They live in that
           component instead. */
        .vb-filters-control:focus-visible,
        .vb-filters-btn:focus-visible,
        .vb-filters-listbox:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        .vb-filters-control:hover:not(:disabled) {
          border-color: rgba(140,160,190,0.75);
        }
        .vb-filters-btn:hover:not(:disabled) {
          filter: brightness(0.97);
        }
      `}</style>
    </div>
  );
}

/* ─── The trigger ──────────────────────────────────────────────────────────────────────── */

export interface WorkboardFiltersProps {
  filters:  FilterState;
  onChange: (next: FilterState) => void;
  /** The shell's active context tab, `'all'` for My Work. Decides the status vocabulary and
   *  whether the project list is grouped. */
  context:  WorkContext | 'all';
  projects: ProjectSummary[];
}

/**
 * Spec §23's compact Filter control beside Search — never a permanently-expanded form. The count
 * badge is the promise the brief makes explicit: a filtered board is never *silently* filtered,
 * so the number is visible the moment the panel closes.
 */
export default function WorkboardFilters({ filters, onChange, context, projects }: WorkboardFiltersProps) {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef   = useRef<HTMLButtonElement>(null);

  const open  = anchor !== null;
  const count = countActiveFilters(filters);

  const close = () => setAnchor(null);
  const closeAndRefocus = () => { setAnchor(null); triggerRef.current?.focus(); };

  /** `DeadlineCell`'s ruling 3, same `mousedown` + `contains` shape: the container holds both the
   *  trigger and (a DOM descendant, even though it is `position: fixed`) the panel, so including
   *  the trigger in the "inside" test is what stops a click on it closing and reopening at once.
   *  Outside-click is a deliberate exit and deliberately does *not* refocus the trigger — the
   *  same asymmetry `DeadlineCell` ships.
   *
   *  Scroll dismissal is included, but narrowed twice from that precedent. It has to exist at all
   *  because the panel is `position: fixed` and this trigger — unlike a table cell's — sits in the
   *  normally-scrolling page, so a page scroll would leave the panel floating over unrelated
   *  content. It ignores scrolls originating *inside* the container, because the project listbox
   *  is itself a scroll region and a capture-phase listener sees its events too; dismissing the
   *  panel the moment a user scrolls its own project list would be a bug. And it refocuses with
   *  `preventScroll` so restoring focus does not yank the page back to the toolbar and fight the
   *  very gesture that dismissed the panel. */
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    const handleScroll = (e: Event) => {
      if (containerRef.current && e.target instanceof Node && containerRef.current.contains(e.target)) return;
      close();
      triggerRef.current?.focus({ preventScroll: true });
    };
    const handleResize = () => {
      close();
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [open]);

  const handleTriggerClick = () => {
    if (open) { closeAndRefocus(); return; }
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Captured at open rather than read during render: the panel is `position: fixed`, so it
    // needs viewport coordinates, and measuring in render would make layout a render side effect.
    setAnchor({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        type="button"
        className="vb-filters-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleTriggerClick}
        style={{
          // The view switcher's resting pill, matched exactly (minus its active fill, which
          // belongs to the selected view and would read as "this is the current view" here).
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          minHeight: '40px', padding: '8px 14px', borderRadius: '999px', boxSizing: 'border-box',
          background: 'rgba(255,255,255,0.5)',
          border: `1px solid ${count > 0 ? 'rgba(37,111,146,0.55)' : 'rgba(200,210,230,0.5)'}`,
          fontFamily: FONT, fontSize: '0.82rem', fontWeight: 700,
          color: count > 0 ? '#1f5c7a' : '#5c6b80',
          cursor: 'pointer', whiteSpace: 'nowrap',
          transition: 'border-color 150ms ease, color 150ms ease',
        }}
      >
        <SlidersHorizontal size={16} aria-hidden />
        Filters
        {count > 0 && (
          // The Board's per-column count badge, with the view selector's `#256f92` swapped in for
          // its neutral grey ground: this badge is not routine chrome reporting a number, it is
          // the signal that the view the user is looking at is currently narrowed. It has to read
          // as "on" at a glance, which a `rgba(255,255,255,0.5)` pill on a white-ish toolbar does
          // not. White on `#256f92` is 5.3:1, comfortably past AA for this size.
          <span
            aria-hidden
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: '18px', borderRadius: '999px', padding: '2px 7px',
              background: '#256f92', color: '#fff',
              fontFamily: FONT, fontSize: '0.7rem', fontWeight: 700, lineHeight: 1.2,
            }}
          >
            {count}
          </span>
        )}
        {/* The badge is `aria-hidden` and this is its spoken form, so the count reaches a screen
            reader as a sentence rather than as a bare digit appended to the word "Filters". Part
            of the button's own content rather than an `aria-label`, so the visible string
            "Filters" is always contained in the accessible name (WCAG 2.5.3). */}
        {count > 0 && (
          <span style={VISUALLY_HIDDEN}>
            {count === 1 ? ' (1 filter active)' : ` (${count} filters active)`}
          </span>
        )}
      </button>

      {anchor !== null && (
        <FiltersPanel
          filters={filters}
          onChange={onChange}
          context={context}
          projects={projects}
          anchor={anchor}
          onClose={closeAndRefocus}
        />
      )}

      <style jsx>{`
        .vb-filters-trigger:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        .vb-filters-trigger:hover {
          border-color: rgba(140,160,190,0.75);
        }
      `}</style>
    </div>
  );
}
