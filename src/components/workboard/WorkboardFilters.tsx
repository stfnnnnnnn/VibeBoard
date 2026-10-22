'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal, Check } from 'lucide-react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope,
// so a *value* import here would drag the driver into this client bundle and 500 the page.
// Same hazard documented in `WorkboardShell.tsx`, `DeadlineCell.tsx`, `StatusCell.tsx`,
// `PriorityCell.tsx`, `WorkItemRow.tsx` and `WorkTableView.tsx`.
import type { ProjectSummary, WorkItem, WorkPriority } from '@/lib/workboard/workItems';
// `workContexts.ts` is pool-free by design (see its module header), so the stage vocabularies,
// their labels and the context labels are all safe to import into a client component.
import {
  CONTEXT_LABELS, STAGES_BY_CONTEXT, STAGE_LABELS, LIFE_AREAS, LIFE_AREA_LABELS,
  type WorkContext, type WorkStatus, type LifeArea,
} from '@/lib/workboard/workContexts';
// The single source of truth for "overdue" on every Workboard surface. Hand-rolling a
// `due < today` comparison here would give the popover its own private definition of lateness,
// which is exactly the drift `dueSemantics.ts` exists to prevent.
import { dueStateOf } from '@/lib/workboard/dueSemantics';
// Pool-free (see the module header in `dates.ts`). The only approved way to read an item's
// calendar date — `due_at` is a DATETIME for owned rows and a DATE for academic ones.
import { dueDateOf } from '@/lib/workboard/dates';
import WbPopover from './ui/WbPopover';
import WbOverlay, { usePresence } from './ui/WbOverlay';

const FONT = 'var(--wb-font-ui)';

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
  /** '' = All areas. Life-only — see `matchesFilters`' own comment for why this and `projectId`
   *  are mutually exclusive rather than both always present. */
  lifeArea:     LifeArea | '';
  /** "YYYY-MM-DD", or null for an open-ended bound. */
  deadlineFrom: string | null;
  deadlineTo:   string | null;
  overdueOnly:  boolean;
}

export const EMPTY_FILTERS: FilterState = {
  status: '', priority: '', projectId: '', lifeArea: '', deadlineFrom: null, deadlineTo: null, overdueOnly: false,
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
  if (filters.lifeArea !== '') n += 1;
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
 * 3. **`lifeArea` and `projectId` are never both meaningful at once.** Life is the one context
 *    with no project hierarchy (`PROJECT_CONTEXTS` excludes it), so a Life item's `project_id`
 *    is always null and a Life item's `life_area` is the only one of the two that can ever
 *    narrow anything — §13's review named this directly: showing an eternally-empty "Project"
 *    section under Life read as the app not understanding its own domain. The two checks below
 *    are independent rather than a single "matches the active scope's own grouping field"
 *    branch because nothing stops both from being set in stale state (a context switch that
 *    hasn't cleared one yet); each simply matches only the items it can ever be true for.
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

  if (filters.lifeArea !== '' && item.life_area !== filters.lifeArea) return false;

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
 *  `STATUS_LABEL` verbatim; duplicated rather than exported from there because small
 *  presentational constants stay local, so no file acquires an import path it does not
 *  otherwise need. */
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
 * else in the app. Read from the `--wb-ctx-*` tokens.
 */
const CONTEXT_ACCENT: Record<WorkContext, { raw: string; darkened: string }> = {
  academic:     { raw: 'var(--wb-ctx-academic)',     darkened: 'var(--wb-ctx-academic-text)' },
  project:      { raw: 'var(--wb-ctx-project)',      darkened: 'var(--wb-ctx-project-text)' },
  organization: { raw: 'var(--wb-ctx-organization)', darkened: 'var(--wb-ctx-organization-text)' },
  life:         { raw: 'var(--wb-ctx-life)',         darkened: 'var(--wb-ctx-life-text)' },
};

/** The order context sections appear in under My Work — the same order the shell's context tabs
 *  use, so the popover's project groups and the tab row above it read left-to-right the same. */
const CONTEXT_ORDER: WorkContext[] = ['academic', 'project', 'organization', 'life'];

/** `DeadlineCell.tsx`'s control language, unchanged: the module's popovers already share one
 *  input/label/button vocabulary and a filters panel is not the place to invent a second. */
const CONTROL_STYLE: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: '32px', borderRadius: 'var(--wb-r-md)',
  padding: '4px 8px', background: 'var(--wb-hover)',
  // Longhands rather than the `border` shorthand: P2-1's dead-hover bug. A shorthand set here
  // would reset `border-color` back to this resting value on every render, beating the
  // `.vb-filters-control:hover` class rule below regardless of the class's own specificity —
  // inline always wins a shorthand-vs-longhand collision on the same box. Splitting frees the
  // class rule to override just `border-color` on hover while width/style stay put.
  borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--wb-border)',
  fontFamily: FONT, fontSize: 'var(--wb-fs-13)',
  fontWeight: 500, color: 'var(--wb-text)',
};

const SECTION_LABEL: React.CSSProperties = {
  display: 'block', fontFamily: FONT, fontSize: 'var(--wb-fs-12)', fontWeight: 700,
  color: 'var(--wb-text-muted)', marginBottom: '4px',
};

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/* ─── Phone breakpoint ─────────────────────────────────────────────────────────────────────
 * Below 768px the panel is a bottom sheet (`WbOverlay variant="drawer"`), at or above it an
 * anchored `WbPopover`. Decided in JavaScript because the two are different components, not
 * two styles of one box. `(max-width: 767px)` so it is the exact complement of the CSS
 * `@media (max-width: 767px)` rules elsewhere in the module, including at fractional widths.
 * Seeded false (the trigger server-renders); the effect corrects it after mount, long before
 * any click can open the panel.
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

/* ─── The project listbox ──────────────────────────────────────────────────────────────── */

/** One rendered section of the project list. Under a single context there is exactly one section
 *  and it has no header; under My Work there is one per context that actually owns a project. */
interface ProjectGroup {
  context:  WorkContext | null;   // null = the ungrouped single-context list
  projects: ProjectSummary[];
}

/**
 * §16b form 3, rendered exactly as specified: a `6px` dot in the context's raw hue, then the
 * context's name at 12px/700/uppercase in its darkened text colour, `gap: 5px`, and **no
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
        fontFamily: FONT, fontSize: 'var(--wb-fs-12)', fontWeight: 700,
        // §16b form 3 is "the chip with its pill removed", and the shipped chip
        // (`FocusRow.tsx`'s `contextChip` and the Board card's chip) declares **no**
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
 * this module's 2px blue-strong focus ring and their hover affordance.
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
          borderRadius: 'var(--wb-r-md)', border: 'none', textAlign: 'left',
          // Selected keeps its persistent highlight inline (a real, deliberate state that must
          // survive a hover). Unselected omits the property entirely rather than spelling out
          // `'transparent'` inline — P2-1's dead-hover bug: an inline `background` on this same
          // property, resting or not, always wins over `.vb-filters-option:hover`'s class rule
          // below regardless of which value it repeats. Omitting it here relies on this being a
          // bare `<button>` with no other background source: Tailwind's preflight (`@tailwind
          // base`, active in this app — see `globals.css`) already resets `button` to
          // `background-color: transparent`. This repo is on Tailwind 3.4 (confirmed: no
          // `@layer` in the compiled CSS output), where `@layer base` is a build-time grouping
          // with no runtime cascade-layer semantics — the reset wins here on plain specificity
          // (`button {}` is (0,0,1), `.vb-filters-option.jsx-<hash>:hover {}` is (0,3,0)), not
          // because of any layer priority. On a future Tailwind 4 upgrade, `@layer` becomes a
          // real native CSS cascade layer that always loses to any unlayered rule regardless of
          // specificity — the conclusion here would still hold, but for that reason instead.
          background: selected ? 'var(--wb-selected)' : undefined,
          fontFamily: FONT, fontSize: 'var(--wb-fs-13)',
          fontWeight: selected ? 700 : 500,
          color: selected ? 'var(--wb-blue-ink)' : 'var(--wb-text)',
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
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 2px;
        }
        @media (hover: hover) and (pointer: fine) {
          .vb-filters-option:hover {
            background: var(--wb-surface-sunken);
          }
        }
      `}</style>
    </>
  );
}

/* ─── The panel ────────────────────────────────────────────────────────────────────────── */

interface PanelProps {
  filters:  FilterState;
  onChange: (next: FilterState) => void;
  context:  WorkContext | 'all';
  projects: ProjectSummary[];
  /** The phone bottom sheet gets roomier padding than the 320px popover. */
  isPhone:  boolean;
  onClose:  () => void;
}

/**
 * The panel's contents only. Where it sits is the trigger's choice: `WbPopover` (bottom-end,
 * 320px) at or above 768px, `WbOverlay variant="drawer"` (a bottom sheet) below. Both primitives
 * own Escape, outside click, scroll dismissal and focus; the status select carries
 * `data-autofocus` so the popover moves focus to it once positioned (the overlay focuses the
 * first focusable, which is the same select).
 */
function FiltersPanel({ filters, onChange, context, projects, isPhone, onClose }: PanelProps) {
  const ids       = useId();
  const statusId  = `${ids}-status`;
  const priorityId = `${ids}-priority`;
  const areaId    = `${ids}-area`;
  const fromId    = `${ids}-from`;
  const toId      = `${ids}-to`;
  const overdueId = `${ids}-overdue`;
  const projectLabelId = `${ids}-project-label`;

  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

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

  /** §13: "Project" is not what every context calls this concept. Academic's is scoped under a
   *  course, Organization's under an org — naming the section after the domain word each context
   *  actually uses is the whole point of a context-aware filter set, not just which sections
   *  appear. My Work spans all four, so it keeps the neutral umbrella term. */
  const projectSectionLabel = context === 'academic' ? 'Academic Project'
    : context === 'organization' ? 'Initiative/Project'
    : 'Project';

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

  return (
    <div
      className="vb-filters-panel"
      style={{
        display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left', fontFamily: FONT,
        padding: isPhone ? '16px 16px 20px' : '12px',
        // Popover only (the sheet scrolls itself): keeps Clear/Done reachable on short screens.
        ...(isPhone ? null : { maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', boxSizing: 'border-box' }),
      }}
    >
      {/* Status — the context's own stage vocabulary, or My Work's normalised three. */}
      <div>
        <label htmlFor={statusId} style={SECTION_LABEL}>Status</label>
        <select
          data-autofocus
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

      {/* Life has no project hierarchy at all (`PROJECT_CONTEXTS` excludes it) — this section
          would always render "No projects in this context yet." forever, which is exactly the
          dead-end §13 flagged. Area (below) is Life's own equivalent grouping, so it replaces
          this section outright rather than sitting uselessly beside it. */}
      {context !== 'life' && (
      <div>
        <span id={projectLabelId} style={SECTION_LABEL}>{projectSectionLabel}</span>
        {!hasProjects ? (
          // Naming the scope, because under a context tab "No projects yet" would contradict the
          // project list the user can see on another tab. Hiding the listbox entirely also removes
          // the lone "All projects" row, which is the correct loss: with nothing to narrow to,
          // `projectId` is already '' (the shell clears it on every context change) and "Clear
          // filters" remains the escape hatch for any state that outlives a payload refresh.
          <p style={{ margin: 0, fontSize: 'var(--wb-fs-12)', fontWeight: 600, color: 'var(--wb-text-muted)' }}>
            {context === 'all' ? 'No projects yet.' : 'No projects in this context yet.'}
          </p>
        ) : (
          <div
            role="listbox"
            aria-labelledby={projectLabelId}
            className="vb-filters-listbox"
            style={{
              maxHeight: '164px', overflowY: 'auto', padding: '4px',
              borderRadius: 'var(--wb-r-md)', border: '1px solid var(--wb-border)',
              background: 'var(--wb-hover)',
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
      )}

      {/* Area — Life's own grouping, replacing Project rather than sitting beside its
          permanently-empty section (see the comment above). A native `<select>` is enough
          here: unlike Project, Area has no per-context grouping of its own to render. */}
      {context === 'life' && (
      <div>
        <label htmlFor={areaId} style={SECTION_LABEL}>Area</label>
        <select
          id={areaId}
          className="vb-filters-control"
          value={filters.lifeArea}
          onChange={e => set('lifeArea', e.target.value as LifeArea | '')}
          style={CONTROL_STYLE}
        >
          <option value="">All areas</option>
          {LIFE_AREAS.map(a => <option key={a} value={a}>{LIFE_AREA_LABELS[a]}</option>)}
        </select>
      </div>
      )}

      {/* Deadline range — inclusive on both ends; an undated item matches neither bound. */}
      <div>
        <span style={SECTION_LABEL}>Deadline</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor={fromId} style={{ ...SECTION_LABEL, fontWeight: 600, color: 'var(--wb-text-muted)', marginBottom: '3px' }}>
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
            <label htmlFor={toId} style={{ ...SECTION_LABEL, fontWeight: 600, color: 'var(--wb-text-muted)', marginBottom: '3px' }}>
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
          fontFamily: FONT, fontSize: 'var(--wb-fs-13)', fontWeight: 600, color: 'var(--wb-text)',
          cursor: 'pointer',
        }}
      >
        <input
          id={overdueId}
          type="checkbox"
          className="vb-filters-control"
          checked={filters.overdueOnly}
          onChange={e => set('overdueOnly', e.target.checked)}
          style={{ width: '16px', height: '16px', margin: 0, accentColor: 'var(--wb-blue-ink)', cursor: 'pointer' }}
        />
        Overdue only
      </label>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px',
        paddingTop: '10px', borderTop: '1px solid var(--wb-hairline)',
      }}>
        <button
          type="button"
          className="vb-filters-btn"
          // Disabled rather than hidden: a control that appears and disappears as the last filter
          // clears would move the Done button under the pointer mid-click.
          disabled={activeCount === 0}
          onClick={() => onChange(EMPTY_FILTERS)}
          style={{
            minHeight: '30px', padding: '6px 12px', borderRadius: 'var(--wb-r-md)',
            background: 'var(--wb-hover)', border: '1px solid var(--wb-border)',
            fontFamily: FONT, fontSize: 'var(--wb-fs-12)', fontWeight: 600, color: 'var(--wb-text-muted)',
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
            minHeight: '30px', padding: '6px 14px', borderRadius: 'var(--wb-r-md)',
            background: 'var(--wb-blue-strong)', border: '1px solid var(--wb-blue-strong)',
            fontFamily: FONT, fontSize: 'var(--wb-fs-12)', fontWeight: 700, color: 'var(--wb-inverse-text)',
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
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 2px;
        }
        @media (hover: hover) and (pointer: fine) {
          .vb-filters-control:hover:not(:disabled) {
            border-color: var(--wb-text-faint);
          }
          .vb-filters-btn:hover:not(:disabled) {
            filter: brightness(0.97);
          }
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
  /** Reports whether the phone bottom sheet is mounted, so the shell can ignore Ctrl+K under it. */
  onSheetChange?: (open: boolean) => void;
}

/**
 * Spec §23's compact Filter control beside Search — never a permanently-expanded form. The count
 * badge is the promise the brief makes explicit: a filtered board is never *silently* filtered,
 * so the number is visible the moment the panel closes.
 */
export default function WorkboardFilters({ filters, onChange, context, projects, onSheetChange }: WorkboardFiltersProps) {
  const [open, setOpen] = useState(false);
  // Keyboard-opened UI does not animate (spec 4.3 rule 3); recorded per open.
  const [instant, setInstant] = useState(false);
  // State rather than a ref so `WbPopover` re-renders with the element it anchors to.
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const isPhone = useIsPhone();
  // Crossing 768px swaps primitives, so close rather than jump; skip the mount-time correction.
  const seenPhone = useRef<boolean | null>(null);
  useEffect(() => {
    if (seenPhone.current !== null && seenPhone.current !== isPhone) setOpen(false);
    seenPhone.current = isPhone;
  }, [isPhone]);
  // The sheet stays mounted for its exit transition; the popover handles its own exit.
  const sheet = usePresence(open && isPhone ? true : null);
  const sheetMounted = sheet.value !== null;
  useEffect(() => { onSheetChange?.(sheetMounted); }, [sheetMounted, onSheetChange]);

  const count = countActiveFilters(filters);

  // Outside click / scroll-out (popover) and scrim click (sheet) are deliberate exits and do not
  // refocus; Done does. The sheet's own unmount restores focus to the trigger regardless.
  const close = () => setOpen(false);
  const closeAndRefocus = () => { setOpen(false); trigger?.focus({ preventScroll: true }); };

  const panel = (
    <FiltersPanel
      filters={filters}
      onChange={onChange}
      context={context}
      projects={projects}
      isPhone={isPhone}
      onClose={closeAndRefocus}
    />
  );

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={setTrigger}
        type="button"
        className="vb-filters-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={e => {
          if (!open) setInstant(e.detail === 0);
          setOpen(o => !o);
        }}
        style={{
          // The view switcher's resting pill, matched exactly (minus its active fill, which
          // belongs to the selected view and would read as "this is the current view" here).
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          minHeight: '40px', padding: '8px 14px', borderRadius: 'var(--wb-r-pill)', boxSizing: 'border-box',
          background: 'var(--wb-hover)',
          // Longhands, not the `border` shorthand — same P2-1 fix as `CONTROL_STYLE` above: a
          // shorthand here would re-assert this resting `border-color` on every render and beat
          // `.vb-filters-trigger:hover`'s longhand override below, no matter which count-driven
          // value is active.
          borderWidth: '1px', borderStyle: 'solid',
          borderColor: count > 0 ? 'color-mix(in srgb, var(--wb-blue-ink) 55%, transparent)' : 'var(--wb-hairline)',
          fontFamily: FONT, fontSize: 'var(--wb-fs-13)', fontWeight: 700,
          color: count > 0 ? 'var(--wb-blue-ink)' : 'var(--wb-text-muted)',
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        <SlidersHorizontal size={16} aria-hidden />
        Filters
        {count > 0 && (
          // A filled badge rather than routine chrome: it is the signal that the view the user is
          // looking at is currently narrowed, so it has to read as "on" at a glance. White on
          // blue-ink is 5.3:1, comfortably past AA for this size.
          <span
            aria-hidden
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: '18px', borderRadius: 'var(--wb-r-pill)', padding: '2px 7px',
              background: 'var(--wb-blue-ink)', color: 'var(--wb-inverse-text)',
              fontFamily: FONT, fontSize: 'var(--wb-fs-12)', fontWeight: 700, lineHeight: 1.2,
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

      {!isPhone && (
        <WbPopover
          open={open}
          anchor={trigger}
          onClose={close}
          placement="bottom-end"
          width={320}
          ariaLabel="Filter work items"
          instant={instant}
        >
          {panel}
        </WbPopover>
      )}

      {sheet.value && (
        <WbOverlay open={sheet.open} onClose={close} variant="drawer" ariaLabel="Filter work items" instant={instant}>
          {panel}
        </WbOverlay>
      )}

      <style jsx>{`
        .vb-filters-trigger:focus-visible {
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 2px;
        }
        @media (hover: hover) and (pointer: fine) {
          .vb-filters-trigger:hover {
            border-color: var(--wb-text-faint);
          }
        }
      `}</style>
    </div>
  );
}
