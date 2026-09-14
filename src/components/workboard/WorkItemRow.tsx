'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { WorkItem, WorkStatus, WorkCategory, WorkPriority } from '@/lib/workboard/workItems';
// Pool-free by construction (`workContexts.ts` has no imports at all), so a `WorkStage` value
// import cannot drag mysql2 into this client bundle the way `workItems.ts` would.
import type { WorkStage } from '@/lib/workboard/workContexts';
import { courseColor } from '@/lib/workboard/color';
import { dueStateOf, formatDueLabel, type DueState } from '@/lib/workboard/dueSemantics';

/** Owned items and Study-Pulse-sourced items have different write endpoints. This is the
 *  single place that decision is made — no view should build these URLs itself. */
function writeUrl(item: WorkItem): string {
  return item.source === 'owned'
    ? `/api/workboard/work-items/${item.id}`
    : `/api/workboard/academic/${item.source}/${item.id}`;
}

export async function setWorkStatus(item: WorkItem, next: WorkStatus): Promise<Response> {
  return fetch(writeUrl(item), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_status: next }),
  });
}

/**
 * The stage-level sibling of `setWorkStatus`, sharing its endpoint routing so the Board never
 * builds a URL of its own. Both endpoints keep `work_stage` and `work_status` in sync by
 * construction, so a stage write must NOT also send `work_status`: on the owned route a
 * status equal to the item's current one is dropped from the update set (and a body that
 * contained only that would 400 "No fields to update"), and on the academic route an explicit
 * `work_stage` deliberately outranks a bare `work_status` — sending both would just add a
 * value that loses. Sending the stage alone is the whole message on both paths.
 */
export async function setWorkStage(item: WorkItem, next: WorkStage): Promise<Response> {
  return fetch(writeUrl(item), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_stage: next }),
  });
}

/**
 * The third sibling, sharing the same endpoint routing so the Table's priority cell never
 * builds a URL of its own. `priority` is the whole message: both routes treat a PATCH body
 * as a sparse patch, so sending anything else here would put a second field's fate in this
 * function's hands.
 *
 * The two routes store it in different places, and that asymmetry is intended rather than
 * incidental. An owned item's priority is its own `workboard_work_items.priority` column. An
 * academic item has no Workboard column for it: `patchAcademicItem` maps the value through
 * `urgencyFromPriority` into **Study Pulse's own `urgency` column** — the same column
 * `priorityFromUrgency` reads it back out of — not into the `workboard_entry_meta` overlay.
 * A priority change on an academic row is therefore visible inside Study Pulse too. That is
 * the existing, deliberate mapping (Study Pulse stays the source of truth for the fields it
 * owns), but it makes this the one inline Table edit that writes outside Workboard's tables.
 */
export async function setPriority(item: WorkItem, next: WorkPriority): Promise<Response> {
  return fetch(writeUrl(item), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority: next }),
  });
}

/**
 * The fourth and last sibling, sharing the same endpoint routing so the Table's deadline cell
 * never builds a URL of its own.
 *
 * **One PATCH, both fields, always.** The date and the time are two halves of one deadline, and
 * both routes treat a body as a sparse patch — so two separate requests could interleave with
 * another edit and land in an order that stores a time against a date the user never paired it
 * with. Both keys are written out literally rather than spread from `next`, so neither can go
 * missing: on both routes an *absent* key means "leave this column alone", a `null` means
 * "clear it", and this function must never leave which of those it meant to the caller's object
 * shape. (`JSON.stringify` drops `undefined` values but keeps `null`s, which is precisely the
 * distinction that matters here.)
 *
 * `due_at` is deliberately `null` rather than `''` for a cleared date: the owned route passes
 * `due_at` straight through its `PATCHABLE` loop as `body[field] ?? null`, so an empty string
 * would reach a DATETIME column as `''` — a strict-mode error, or a `0000-00-00` row in a
 * lenient one. Only `deadline_time` is normalised from `''` to NULL by both routes.
 *
 * The two routes store the pair in different places, and the asymmetry is intended. An owned
 * item keeps both on its own row (`due_at` DATETIME at midnight, `deadline_time` TIME). An
 * academic item's *date* goes back to Study Pulse's own `deadline` column — date-only, sliced
 * to 10 characters by `patchAcademicItem`, so Study Pulse's column never acquires a time
 * component — while the *time* goes to the `workboard_entry_meta` overlay, because Study Pulse
 * has no column for it and its schema is deliberately not being changed.
 */
export async function setDeadline(
  item: WorkItem,
  next: { due_at: string | null; deadline_time: string | null },
): Promise<Response> {
  return fetch(writeUrl(item), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due_at: next.due_at, deadline_time: next.deadline_time }),
  });
}

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";

const CATEGORY_META: Record<WorkCategory, { label: string; bg: string; text: string }> = {
  academic:     { label: 'Academic',     bg: 'rgba(77,171,245,0.16)',  text: '#185a7d' },
  project:      { label: 'Projects',     bg: 'rgba(139,127,214,0.16)', text: '#4f3fa0' },
  organization: { label: 'Organization', bg: 'rgba(240,163,92,0.16)',  text: '#8a5010' },
  life:         { label: 'Life',         bg: 'rgba(242,167,192,0.16)', text: '#8a4468' },
};

const EDGE_COLOR: Record<WorkItem['priority'], string> = {
  high:   '#e0607c',
  normal: '#b8c6da',
  low:    '#d3dbe6',
};

/** The meta line's color, keyed by the same `DueState` that produced its text — so the two can
 *  never contradict each other. (They used to: the colour was computed from a bare
 *  `due < todayStr` with no status check, which painted a completed-early item's "Completed"
 *  label in the overdue alert red.) `Record<DueState, …>` means a new state cannot be added
 *  without deciding its colour here.
 *  `#922e48` is §6's overdue alert red; `#8a5010` is §2a's darkened amber, the only
 *  AA-passing amber text colour in this system (§8 forbids the raw `#f0a35c` behind text);
 *  `#5c6b80` is §1's ordinary meta-text colour. */
const META_COLOR: Record<DueState, string> = {
  none:           '#5c6b80',
  upcoming:       '#5c6b80',
  due_today:      '#5c6b80',
  completed:      '#5c6b80',
  completed_late: '#8a5010',
  overdue:        '#922e48',
};

/** The row's single meta string — due label + estimate, joined by " · " — and the colour it
 *  renders in. Computed once and reused by both the desktop (meta line under the title) and
 *  mobile (meta folded into line 2) layouts so the two never disagree about what the row is
 *  telling the user. The label itself comes from `dueSemantics`, the module that owns due
 *  wording for every Workboard surface — this file deliberately keeps no second copy. */
function buildMeta(item: WorkItem, todayStr: string): { text: string | null; color: string } {
  const dueLabel = formatDueLabel(item, todayStr);
  const estimateLabel = item.estimated_hours !== null ? `${item.estimated_hours}h` : null;
  const parts = [dueLabel, estimateLabel].filter((p): p is string => p !== null);
  return {
    text: parts.length ? parts.join(' · ') : null,
    color: META_COLOR[dueStateOf(item, todayStr)],
  };
}

function CategoryChip({ category }: { category: WorkCategory }) {
  const meta = CATEGORY_META[category];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '3px 10px',
      background: meta.bg, color: meta.text, fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700,
      textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {meta.label}
    </span>
  );
}

function ProjectChip({ label }: { label: string }) {
  const dot = courseColor(label);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '6px',
      padding: '2px 8px 2px 6px', background: 'rgba(255,255,255,0.55)',
      border: '1px solid rgba(200,210,230,0.4)', fontFamily: FONT, fontSize: '0.68rem',
      fontWeight: 500, color: '#5c6b80', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dot, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function HighPriorityPill() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '2px 9px',
      background: 'rgba(224,96,124,0.15)', color: '#922e48', fontFamily: FONT, fontSize: '0.64rem',
      fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      High
    </span>
  );
}

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/**
 * A work item's title, as the detail drawer's trigger (Task 32) — the Focus row's two layouts and
 * the Table's Work cell and phone card all render *this*, so the four surfaces cannot drift into
 * different affordances for the same thing. It lives here for the same reason `setWorkStage` and
 * its siblings do: this file is already the module's home for row primitives the views share.
 *
 * **It is a component rather than a helper returning JSX, and that is load-bearing.** styled-jsx
 * scopes a rule to the JSX tree the `<style jsx>` tag is part of; JSX built in a `const` inside a
 * component and spliced in as `{thing}` is a *separate* tree and never receives the scope class,
 * so the rules below would compile cleanly and match nothing. (That is not hypothetical: this
 * file's own `checkbox` and `overflowButton` consts used to have exactly that shape, and their
 * `.vb-row-checkbox` / `.vb-row-overflow` / `.vb-row-menu-item` rules were inert for this reason
 * — see this task's report, P1-3. They are now `RowCheckbox` and `RowOverflowMenu` below, each a
 * real component with its own `<style jsx>`, for the same reason this component is.) A component
 * with its own `<style jsx>` is the shape that works, and the shape `CardLinksButton` in
 * `WorkTableView` already uses.
 *
 * A real `<button>`, not an `onClick` on the old `<span>`: a click handler on static text is
 * neither keyboard reachable nor announced as actionable, so the drawer would exist for mouse
 * users only. The visible title is the whole accessible name bar the appended hidden sentence,
 * so WCAG 2.5.3 holds.
 *
 * Colour and text-decoration are deliberately NOT inline — an inline declaration beats any class
 * selector, so a `:hover` rule written against an inline colour compiles cleanly and never
 * applies. `CardLinksButton` carries the same note about its border colour.
 *
 * No hooks, and none are needed: everything it renders comes from its props.
 */
export function WorkTitleButton({ item, isDone, style, onOpenDetail }: {
  item:   WorkItem;
  isDone: boolean;
  /** The caller's layout box only — flex child, or a `<td>`'s inner block. */
  style:  React.CSSProperties;
  onOpenDetail: (item: WorkItem) => void;
}) {
  return (
    <>
      <button
        type="button"
        className={isDone ? 'vb-row-title vb-row-title-done' : 'vb-row-title'}
        aria-haspopup="dialog"
        title={item.title}
        onClick={() => onOpenDetail(item)}
        style={{
          ...style,
          textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          // Typography stated rather than inherited: a `<button>`'s UA style overrides the
          // inherited font, so leaving it off would drop the title to 13px Arial.
          fontFamily: FONT, fontSize: '0.88rem', fontWeight: 600,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {item.title}
        <span style={VISUALLY_HIDDEN}> Open details.</span>
      </button>

      <style jsx>{`
        .vb-row-title { color: #2d3748; transition: color 150ms ease; }
        .vb-row-title-done { color: #9aa4b5; text-decoration-line: line-through; }
        /* Underline as well as the colour shift, so "this does something" is not carried by
           colour alone. \`text-decoration-line\` rather than the shorthand, and the done rule
           last, so a completed item keeps its strike-through while hovered instead of having it
           replaced by the underline. */
        .vb-row-title:hover { color: #256f92; text-decoration-line: underline; }
        .vb-row-title-done:hover { color: #7a8496; text-decoration-line: line-through underline; }
        /* §9's ring, on the darker blue. */
        .vb-row-title:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
          border-radius: 4px;
        }
      `}</style>
    </>
  );
}

/**
 * The row's completion checkbox — same rationale as `WorkTitleButton` above, smaller control.
 * It used to be a `const` built inline in `WorkItemRow` and spliced in as `{checkbox}`, which is
 * exactly the shape that docblock warns is dead by construction: its `.vb-row-checkbox` rule
 * compiled cleanly and matched nothing (see this task's report, P1-3). Pulling it out into its
 * own component with its own `<style jsx>` fixes that the same way `WorkTitleButton` already
 * does, with no change to its markup, values, or behaviour (the `<label>` wrapper, the
 * disabled-while-pending state, the dynamic `aria-label`).
 */
function RowCheckbox({ item, isDone, pending, onToggle }: {
  item:    WorkItem;
  isDone:  boolean;
  pending: boolean;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <>
      <label style={{
        width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, cursor: pending ? 'default' : 'pointer',
      }}>
        <input
          type="checkbox"
          className="vb-row-checkbox"
          checked={isDone}
          disabled={pending}
          onChange={onToggle}
          aria-label={isDone ? `Mark "${item.title}" as not done` : `Mark "${item.title}" as done`}
          style={{ width: '20px', height: '20px', cursor: pending ? 'default' : 'pointer', accentColor: '#256f92' }}
        />
      </label>

      <style jsx>{`
        .vb-row-checkbox:focus-visible { outline: 2px solid #2a7fa8; outline-offset: 2px; border-radius: 4px; }
      `}</style>
    </>
  );
}

export interface RowOverflowMenuItem {
  key:   string;
  label: string;
  /** May return a promise; `RowOverflowMenu` itself does not await it (it has no further work
   *  to do once the menu is closed and the click is dispatched — see the component docblock for
   *  why the Board's post-move refocus specifically cannot live here). A caller that needs to
   *  do something once its own action resolves — like `WorkBoardView`'s move — awaits its own
   *  promise inside its `onClick`, on its own terms. */
  onClick: () => void | Promise<void>;
}

/**
 * A row's "more options" trigger + menu, shared by the Focus row (this file) and the Board
 * (`WorkBoardView`). Both used to carry their own independent implementation of the same
 * control (P2-3 in this task's report): the Board's `BoardCardMenu` moved focus into the menu
 * on open, supported ArrowUp/ArrowDown/Home/End, and refocused the trigger on Escape;
 * `WorkItemRow`'s did none of that, and its Escape handler dropped focus to `<body>` if the one
 * menu item held it. This is the Board's already-correct implementation, extracted here and
 * generalised over an `items` list so neither surface has to maintain its own copy — this file
 * is already established (see `WorkTitleButton` above) as the module's home for row primitives
 * the views share, and `WorkBoardView` imports this the same way `WorkTableView` imports
 * `WorkTitleButton`.
 *
 * **It is a component, not a `const` holding JSX** — the same load-bearing shape `WorkTitleButton`
 * demonstrates. The old `overflowButton` const in this file, and the old `BoardCardMenu`'s
 * sibling rules living in `WorkBoardView`'s own `<style jsx global>` block, both worked around
 * styled-jsx's scoping in ways that either broke it (the const) or opted out of it entirely
 * (`global`, which is why the Board's rules survived mechanism A but not mechanism B — see P2-1).
 * A real component with its own ordinary `<style jsx>` scopes correctly *and* keeps the
 * rules scoped to this control specifically, rather than leaking them globally.
 *
 * Escape closes the menu and refocuses the trigger immediately — nothing has moved, so the
 * trigger this component owns is still the right target. A menu item's own click does the same
 * `closeAndRefocus()` for the same reason `BoardCardMenu` always did: it is a correct default
 * for an item that does nothing further (e.g. this file's own "Edit"), and it is a harmless,
 * superseded-in-time stopgap for `WorkBoardView`'s "Move to" items, whose trigger is about to be
 * unmounted once the move resolves and the card re-renders in its new column (P1-5) — by the
 * time that happens, this component's own refocus has long since fired and simply gets
 * overridden by whatever the caller's own `onClick` focuses afterward. This component has no
 * visibility into which column an item ends up in, so it cannot be the one to make that later
 * correction; only the caller, which owns the item's identity and the board-level trigger
 * registry, can (see `WorkBoardView`'s `triggerRefs`/`registerTrigger`/`focusTrigger`).
 */
export function RowOverflowMenu({ triggerAriaLabel, menuAriaLabel, items, triggerRef }: {
  triggerAriaLabel: string;
  menuAriaLabel:    string;
  items:            RowOverflowMenuItem[];
  /** Lets a caller track this row's trigger DOM node by the item's own stable identity across
   *  re-renders and reparenting — a card moving to a different column's subtree, specifically.
   *  Optional because only `WorkBoardView` needs it; the Focus row's own usage has nothing to
   *  reparent so it simply omits this prop. */
  triggerRef?: (el: HTMLButtonElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerElRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const closeAndRefocus = () => {
    setOpen(false);
    triggerElRef.current?.focus();
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const focusable = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    const currentIndex = focusable.findIndex(el => el === document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusable[(currentIndex + 1 + focusable.length) % focusable.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusable[(currentIndex - 1 + focusable.length) % focusable.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusable[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      focusable[focusable.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeAndRefocus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={el => { triggerElRef.current = el; triggerRef?.(el); }}
        type="button"
        className="vb-row-overflow"
        aria-label={triggerAriaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={triggerAriaLabel}
        onClick={() => setOpen(o => !o)}
        style={{
          width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', borderRadius: '8px', color: '#5c6b80', cursor: 'pointer', flexShrink: 0,
          // No inline `background: 'transparent'` here (P2-1): this app's global button reset
          // (`globals.css`'s `@tailwind base`, i.e. Tailwind Preflight) already sets
          // `background-color: transparent` on every `<button>`, so the resting state is
          // identical either way — but an inline value would out-specificity the `:hover` rule
          // below the same way it did on this exact element before this fix.
        }}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={menuAriaLabel}
          className="vb-row-overflow-menu"
          onKeyDown={handleMenuKeyDown}
          style={{
            position: 'absolute', right: 0, top: '36px', zIndex: 20, minWidth: '160px',
            background: '#fff', borderRadius: '10px', border: '1px solid rgba(200,210,230,0.6)',
            boxShadow: '0 8px 24px rgba(31,38,68,0.18)', padding: '4px', overflow: 'hidden',
          }}
        >
          {items.map((item, i) => (
            <button
              key={item.key}
              ref={el => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              className="vb-row-overflow-menu-item"
              onClick={() => { closeAndRefocus(); item.onClick(); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                border: 'none', borderRadius: '6px', cursor: 'pointer',
                fontFamily: FONT, fontSize: '0.82rem', fontWeight: 600, color: '#2d3748',
                // Same no-inline-background note as the trigger above.
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <style jsx>{`
        .vb-row-overflow:focus-visible { outline: 2px solid #2a7fa8; outline-offset: 2px; }
        .vb-row-overflow:hover:not(:disabled) { background: rgba(200,210,230,0.3); }
        .vb-row-overflow-menu-item:hover { background: rgba(116,188,217,0.12); }
        .vb-row-overflow-menu-item:focus-visible { outline: 2px solid #2a7fa8; outline-offset: -2px; }
      `}</style>
    </div>
  );
}

export interface WorkItemRowProps {
  item:       WorkItem;
  /** "YYYY-MM-DD" — `work.generated_at`, so every row in the payload agrees on "today". */
  todayStr:   string;
  /** `>=1024px` single-line layout vs the `<1024px` two-line layout (direction doc §3 vs §10). */
  isDesktop:  boolean;
  /** Suppresses the row's bottom divider — the last row in a section has none. */
  isLast:     boolean;
  onChanged:  () => void | Promise<void>;
  /** Opens the create/edit dialog (Task 13) in edit mode for this item. */
  onEdit:     (item: WorkItem) => void;
  /** Opens the detail drawer (Task 32) for this item — the title's own action.
   *
   *  Deliberately *additional* to `onEdit`, not a replacement for it: the overflow menu's "Edit"
   *  still opens the edit dialog, which is where the fields the drawer shows read-only (title,
   *  deadline, estimate, note) are actually changed. Two complementary entry points, one per
   *  question the user is asking — "what is this?" and "change this". */
  onOpenDetail: (item: WorkItem) => void;
}

export default function WorkItemRow({ item, todayStr, isDesktop, isLast, onChanged, onEdit, onOpenDetail }: WorkItemRowProps) {
  const [pending, setPending] = useState(false);
  const meta = buildMeta(item, todayStr);
  const edgeColor = EDGE_COLOR[item.priority];
  const divider = isLast ? 'none' : '1px solid rgba(200,210,230,0.35)';

  const isDone = item.work_status === 'done';

  const handleToggle = async () => {
    if (pending) return;
    setPending(true);
    try {
      // List never shows done items (groupByTimeframe excludes them), so here the toggle is
      // always todo/in_progress -> done. But this row is shared with Board (Task 15), whose
      // Done column shows completed items and must let the user un-complete one — hence the
      // real toggle rather than a hardcoded 'done', even though List only ever exercises one
      // branch of it today.
      const next: WorkStatus = isDone ? 'todo' : 'done';
      const res = await setWorkStatus(item, next);
      if (res.ok) {
        await onChanged();
      } else {
        console.error('Failed to update work item status', await res.text().catch(() => res.statusText));
      }
    } finally {
      setPending(false);
    }
  };

  const checkbox = (
    <RowCheckbox item={item} isDone={isDone} pending={pending} onToggle={handleToggle} />
  );

  /** The row's title, in whichever layout is rendering — see `WorkTitleButton` above for why it
   *  is a component rather than a `const` holding JSX like `checkbox` and `overflowButton`. */
  const titleButton = (style: React.CSSProperties) => (
    <WorkTitleButton item={item} isDone={isDone} style={style} onOpenDetail={onOpenDetail} />
  );

  // Rendered per the direction doc's §3 row structure (6 of 6 elements). Task 13 wires this
  // up to a single "Edit" action opening the create/edit dialog. `RowOverflowMenu` (above) is
  // the Board's own overflow control (Task 15's "Move to →" submenu), shared here rather than
  // rebuilt — see its docblock for why the two used to drift (P2-3) and no longer do.
  const overflowButton = (
    <RowOverflowMenu
      triggerAriaLabel="More options"
      menuAriaLabel="More options"
      items={[{ key: 'edit', label: 'Edit', onClick: () => onEdit(item) }]}
    />
  );

  return (
    <div
      className="vb-work-row"
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', width: '100%',
        padding: '8px 4px', minHeight: isDesktop ? '56px' : '82px', borderBottom: divider,
        borderRadius: '8px', boxSizing: 'border-box',
      }}
    >
      <span
        aria-hidden
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px', background: edgeColor, borderRadius: '2px' }}
      />

      {isDesktop ? (
        <>
          <div style={{ marginLeft: '3px' }}>{checkbox}</div>

          <div style={{ marginLeft: '12px', minWidth: 0, maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {titleButton({ display: 'block', width: '100%' })}
            {meta.text && (
              <span style={{ fontFamily: FONT, fontSize: '0.76rem', fontWeight: 500, color: meta.color }}>
                {meta.text}
              </span>
            )}
          </div>

          <div style={{ flex: 1, minWidth: '12px' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <CategoryChip category={item.category} />
            {item.chip_label && <ProjectChip label={item.chip_label} />}
          </div>

          <div style={{ marginLeft: '12px', display: 'flex', alignItems: 'center' }}>
            {item.priority === 'high' && <HighPriorityPill />}
          </div>

          <div style={{ marginLeft: '8px' }}>{overflowButton}</div>
        </>
      ) : (
        <div style={{ marginLeft: '3px', display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {checkbox}
            {titleButton({ marginLeft: '12px', flex: 1, minWidth: 0 })}
            {item.priority === 'high' && <span style={{ marginLeft: '8px' }}><HighPriorityPill /></span>}
            <div style={{ marginLeft: 'auto', paddingLeft: '8px' }}>{overflowButton}</div>
          </div>

          <div style={{ marginLeft: '52px', marginTop: '6px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
            <CategoryChip category={item.category} />
            {item.chip_label && <ProjectChip label={item.chip_label} />}
            {meta.text && (
              <span style={{ fontFamily: FONT, fontSize: '0.76rem', fontWeight: 500, color: meta.color }}>
                {meta.text}
              </span>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .vb-work-row { background: transparent; transition: background 120ms ease; }
        .vb-work-row:hover, .vb-work-row:focus-within { background: rgba(116,188,217,0.06); }
      `}</style>
    </div>
  );
}
