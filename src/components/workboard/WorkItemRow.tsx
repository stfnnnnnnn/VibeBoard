'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { WorkItem, WorkPriority } from '@/lib/workboard/workItems';
// Pool-free by construction (`workContexts.ts` has no imports at all), so a `WorkStage` value
// import cannot drag mysql2 into this client bundle the way `workItems.ts` would.
import type { WorkStage } from '@/lib/workboard/workContexts';
import { patchItem } from './workApi';

/**
 * A stage write through `patchItem`'s endpoint routing, so no view builds a URL of its own.
 * Both endpoints keep `work_stage` and `work_status` in sync by construction, so a stage write must NOT also send `work_status`: on the owned route a
 * status equal to the item's current one is dropped from the update set (and a body that
 * contained only that would 400 "No fields to update"), and on the academic route an explicit
 * `work_stage` deliberately outranks a bare `work_status` — sending both would just add a
 * value that loses. Sending the stage alone is the whole message on both paths.
 *
 * `blockedReason` is optional and meaningful only when `next` is a waiting stage
 * (`isWaitingStage`: `blocked`, or Academic's `submitted`, where it is the revision note) —
 * both routes stamp `blocked_since` themselves the moment the stage becomes waiting, and store
 * this string alongside it (§18). Passed through for any `next`: the routes ignore it outside
 * a waiting stage, so there's nothing this function needs to gate itself.
 */
export async function setWorkStage(item: WorkItem, next: WorkStage, blockedReason?: string | null): Promise<Response> {
  return patchItem(item, blockedReason !== undefined ? { work_stage: next, blocked_reason: blockedReason } : { work_stage: next });
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
  return patchItem(item, { priority: next });
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
  return patchItem(item, { due_at: next.due_at, deadline_time: next.deadline_time });
}

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";

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
 * — see this task's report, P1-3. `RowOverflowMenu` below is now a real component with its own
 * `<style jsx>`, for the same reason this component is.) A component
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
        .vb-row-title { color: var(--wb-text); transition: color var(--wb-dur-fast) var(--wb-ease); }
        .vb-row-title-done { color: var(--wb-text-faint); text-decoration-line: line-through; }
        /* Underline as well as the colour shift, so "this does something" is not carried by
           colour alone. \`text-decoration-line\` rather than the shorthand, and the done rule
           last, so a completed item keeps its strike-through while hovered instead of having it
           replaced by the underline. */
        @media (hover: hover) and (pointer: fine) {
          .vb-row-title:hover { color: var(--wb-blue-ink); text-decoration-line: underline; }
          .vb-row-title-done:hover { color: color-mix(in srgb, var(--wb-text-faint) 70%, var(--wb-text)); text-decoration-line: line-through underline; }
        }
        /* §9's ring, on the darker blue. */
        .vb-row-title:focus-visible {
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 2px;
          border-radius: 4px;
        }
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
 * A row's "more options" trigger + menu, shared by the Focus row (`FocusRow`) and the Board
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
          border: 'none', borderRadius: '8px', color: 'var(--wb-text-muted)', cursor: 'pointer', flexShrink: 0,
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
            background: 'var(--wb-surface)', borderRadius: '10px', border: '1px solid rgba(200,210,230,0.6)',
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
                fontFamily: FONT, fontSize: '0.82rem', fontWeight: 600, color: 'var(--wb-text)',
                // Same no-inline-background note as the trigger above.
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <style jsx>{`
        .vb-row-overflow:focus-visible { outline: 2px solid var(--wb-blue-strong); outline-offset: 2px; }
        .vb-row-overflow-menu-item:focus-visible { outline: 2px solid var(--wb-blue-strong); outline-offset: -2px; }
        @media (hover: hover) and (pointer: fine) {
          .vb-row-overflow:hover:not(:disabled) { background: rgba(200,210,230,0.3); }
          .vb-row-overflow-menu-item:hover { background: rgba(116,188,217,0.12); }
        }
      `}</style>
    </div>
  );
}
