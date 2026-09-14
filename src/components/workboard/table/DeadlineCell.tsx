'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Clock, X } from 'lucide-react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope,
// so a *value* import here would drag the driver into this client bundle and 500 the page.
// Same hazard documented in `StatusCell.tsx`, `PriorityCell.tsx`, `WorkboardShell.tsx`,
// `WorkItemRow.tsx` and `WorkTableView.tsx`.
import type { WorkItem } from '@/lib/workboard/workItems';
// `setDeadline` is the single place owned-vs-academic endpoint routing lives, alongside
// `setWorkStatus`/`setWorkStage`/`setPriority` (Tasks 11/16/20/21). Imported, never re-derived:
// a second copy of that URL decision is the drift this plan has already had to remove twice.
import { setDeadline } from '../WorkItemRow';
// The module's one failure surface, shared with `StatusCell` and `PriorityCell`.
import { reportTableCellError } from './tableCellError';
// The module that owns due wording for every Workboard surface. Both cells keep rendering
// through it rather than formatting a date or a time of their own — in particular
// `formatDeadlineTime`, which is the one place that guarantees an absent time reads as an em
// dash and never as midnight.
import {
  dueStateOf, formatDeadline, formatDeadlineTime, type DueState,
} from '@/lib/workboard/dueSemantics';
// Pool-free by design (see the module header in `dates.ts`). `dueDateOf` is what turns a stored
// DATETIME into the "YYYY-MM-DD" an `<input type="date">` accepts.
import { dueDateOf } from '@/lib/workboard/dates';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";

const DASH = '—';

const GENERIC_ERROR = 'Could not change the deadline. Please try again.';
const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

/** Both cells' `<td>` padding. The shared `7px` vertical padding is sized for a line of text;
 *  around a 26px control it would push the row past the Work cell's 31px. Same override, for
 *  the same reason, as `StatusCell`'s and `PriorityCell`'s. */
const CELL_PADDING = '2px 12px';

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** The textual half of the lateness signal, moved here verbatim from `WorkTableView` along with
 *  the cell that renders it. In Focus the colour is a *second* cue because `formatDueLabel`
 *  already puts "Overdue" in the string; this cell is a bare date, so without this the state
 *  would be conveyed by colour alone. It now sits inside the trigger button, which means it is
 *  also part of the button's accessible name rather than a stray string beside it. */
const DEADLINE_SR_SUFFIX: Partial<Record<DueState, string>> = {
  overdue:        ' (overdue)',
  completed_late: ' (completed late)',
};

/** The Deadline cell's colour, keyed by the same `DueState` the rest of the module uses, so the
 *  Table cannot contradict Focus about whether a date is late. Values are `WorkItemRow.tsx`'s
 *  `META_COLOR` exactly: §6's overdue red, §2a's darkened amber (the only AA-passing amber text
 *  colour in this system) for completed-late, §1's ordinary meta colour otherwise. */
const DEADLINE_COLOR: Record<DueState, string> = {
  none:           '#5c6b80',
  upcoming:       '#5c6b80',
  due_today:      '#5c6b80',
  completed:      '#5c6b80',
  completed_late: '#8a5010',
  overdue:        '#922e48',
};

/** The two halves of a deadline, always travelling together. */
export interface DeadlineValues {
  /** "YYYY-MM-DD" (or a DATETIME string the reader slices), or null for no deadline. */
  due_at:        string | null;
  /** "HH:MM" or "HH:MM:SS", or null for no time. Meaningless without a date. */
  deadline_time: string | null;
}

/** Which of the two `<td>`s a given `DeadlineCell` instance is rendering. */
export type DeadlineColumn = 'deadline' | 'time';

interface AnchorRect { left: number; right: number; top: number; bottom: number }

interface OpenState {
  /** `itemKey` of the row being edited. */
  key:    string;
  item:   WorkItem;
  /** Which cell's trigger opened it — the popover renders inside that cell, anchored there. */
  origin: DeadlineColumn;
  anchor: AnchorRect;
}

/** The optimistic override, tagged with the values it was applied *over* — the same pure
 *  reconciliation `StatusCell` and `PriorityCell` use, widened from one field to two. Once the
 *  refreshed payload arrives with different stored values the tag no longer matches and the
 *  override falls away on its own, with no effect, no render-phase `setState`, and no frame in
 *  which the old value flashes back. A refresh that silently fails (`refreshWork` only calls
 *  `setWork` when the GET is `ok`) leaves the tag matching, so the cells keep showing the values
 *  the server accepted rather than springing back to values that are no longer true. */
interface OptimisticEntry {
  over:  DeadlineValues;
  value: DeadlineValues;
}

/**
 * The editor's single home. Both the Deadline cell and the Time cell take *this* object, so
 * there is exactly one open-state for the whole table — two views of one editor rather than two
 * editors that can disagree, and two popovers cannot be open at once because there is only one
 * `open` slot to be in.
 *
 * Writes, unlike the popover, stay **per row**. That is deliberate: `StatusCell` and
 * `PriorityCell` each hold their own `pending` flag, so two rows can be in flight at once there,
 * and a single shared slot here would have had to either grey out every deadline trigger in the
 * table for the length of one PATCH or silently drop a save started on a second row while the
 * first was still landing. Keyed collections keep the sibling cells' behaviour exactly, at the
 * cost of one `Set` and one `Map`.
 */
export interface DeadlineEditor {
  open:        OpenState | null;
  /** `itemKey`s whose saves are in flight. Membership disables *both* of that row's triggers, so
   *  the date cannot be re-opened from the Time cell mid-write, while every other row stays
   *  live. */
  pendingKeys: ReadonlySet<string>;
  openAt:      (item: WorkItem, origin: DeadlineColumn, trigger: HTMLElement) => void;
  close:       () => void;
  save:        (item: WorkItem, next: DeadlineValues) => Promise<void>;
  /** The values the row should *render* right now — stored, or the optimistic override. */
  shown:       (item: WorkItem) => DeadlineValues;
}

/** `WorkTableView` keeps a private copy of this; a shared export is not worth a module of its
 *  own for one template literal, and the two must agree only with themselves. */
function itemKey(item: Pick<WorkItem, 'source' | 'id'>): string {
  return `${item.source}-${item.id}`;
}

/** Compares stored values against a draft. Both sides are normalised to the shapes the two
 *  native inputs use ("YYYY-MM-DD" and "HH:MM"), because the stored forms are not those: an
 *  owned `due_at` is a DATETIME string and a stored `deadline_time` carries seconds, so a naive
 *  `===` would report every unchanged deadline as an edit and fire a pointless PATCH. */
function sameDeadline(a: DeadlineValues, b: DeadlineValues): boolean {
  const date = (v: DeadlineValues) => dueDateOf(v);
  const time = (v: DeadlineValues) => (v.deadline_time ? v.deadline_time.slice(0, 5) : null);
  return date(a) === date(b) && time(a) === time(b);
}

/**
 * Called **once** by `WorkTableView`, above its empty-state returns. Lifting the state here is
 * what makes the Deadline and Time columns one editor: each row renders two `DeadlineCell`
 * instances, and both read this object, so a click in either cell opens the same popover over
 * the same item and a save from it updates both columns together.
 */
export function useDeadlineEditor(onChanged: () => void | Promise<void>): DeadlineEditor {
  const [open, setOpen] = useState<OpenState | null>(null);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [optimistic, setOptimistic] = useState<ReadonlyMap<string, OptimisticEntry>>(() => new Map());

  const openAt = useCallback((item: WorkItem, origin: DeadlineColumn, trigger: HTMLElement) => {
    const r = trigger.getBoundingClientRect();
    setOpen({
      key: itemKey(item), item, origin,
      // Captured at open rather than read during render: the popover is `position: fixed` (see
      // `DeadlinePopover`), so it needs viewport coordinates, and measuring in render would
      // make layout a render-phase side effect.
      anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
    });
  }, []);

  const close = useCallback(() => setOpen(null), []);

  /** Immutable helpers — React only re-renders on a new reference, so the collections are
   *  replaced rather than mutated in place. Both take the updater form and therefore need no
   *  dependencies, which is what keeps them (and `save`, which closes over them) stable. */
  const setPendingFor = useCallback((key: string, on: boolean) => setPendingKeys(current => {
    const nextKeys = new Set(current);
    if (on) nextKeys.add(key); else nextKeys.delete(key);
    return nextKeys;
  }), []);
  const dropOptimistic = useCallback((key: string) => setOptimistic(current => {
    const nextMap = new Map(current);
    nextMap.delete(key);
    return nextMap;
  }), []);

  const save = useCallback(async (item: WorkItem, next: DeadlineValues) => {
    const key = itemKey(item);
    // Belt-and-braces behind this row's triggers being `disabled={pending}`: a fast second save
    // on the same row cannot produce two racing PATCHes whose responses land out of order.
    // Scoped to the row, exactly like `StatusCell`'s `if (pending)` — a save on a *different*
    // row is a different write to a different item and is allowed to proceed.
    if (pendingKeys.has(key)) return;

    // Tagged with the item's *stored* values, not the shown ones — same as `StatusCell` tagging
    // with `stage` rather than `shown`. Reverting is therefore a single entry deletion, which
    // drops **both** fields back to their pre-edit values at once (ruling 1); there is no path
    // that can revert the date and strand the time.
    const over: DeadlineValues = { due_at: item.due_at, deadline_time: item.deadline_time };
    setOptimistic(current => new Map(current).set(key, { over, value: next }));
    setPendingFor(key, true);
    try {
      // `.catch(() => null)` rather than a `try` around the whole body: only `fetch` itself
      // rejecting counts as a network failure here. Letting `onChanged`'s own rejection reach a
      // shared catch would report "could not change the deadline" for a write that succeeded.
      // `onChanged` throwing still unwinds through the `finally` below, so no exit — success,
      // non-ok, fetch rejection, thrown `onChanged` — leaves this row in `pendingKeys` and its
      // two triggers permanently disabled.
      const res = await setDeadline(item, next).catch(() => null);

      if (res === null) {
        dropOptimistic(key);
        reportTableCellError(NETWORK_ERROR);
        return;
      }
      if (!res.ok) {
        // Revert AND say why. Both PATCH routes answer a malformed time with
        // `{ error: 'deadline_time must be HH:MM or HH:MM:SS' }`, and the academic route answers
        // an entry that is not this user's with `{ error: 'That item was not found' }` — both far
        // more use than a generic failure. An HTML error page or an empty 500 body is not JSON,
        // hence the fallback. A `console.error` alone is what the v2 review flagged.
        const body: unknown = await res.json().catch(() => null);
        const message =
          typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : GENERIC_ERROR;
        dropOptimistic(key);
        reportTableCellError(message);
        return;
      }
      // The reconcile half: the optimistic values made both cells feel instant, this makes the
      // overdue stat, the workload chart and every other view agree with them.
      await onChanged();
    } finally {
      setPendingFor(key, false);
    }
  }, [pendingKeys, onChanged, setPendingFor, dropOptimistic]);

  const shown = useCallback((item: WorkItem): DeadlineValues => {
    const current: DeadlineValues = { due_at: item.due_at, deadline_time: item.deadline_time };
    const entry = optimistic.get(itemKey(item));
    if (entry === undefined) return current;
    // The tag check, on both fields: the override survives only while the payload still holds
    // the values it was applied over. A successful entry is deliberately left in place once it
    // stops matching (rather than being swept on reconcile) for the same reason `StatusCell`
    // keeps its slot: a refresh that silently fails must not spring the cells back to values the
    // server no longer holds. A later save on the same row replaces the entry outright.
    if (entry.over.due_at !== current.due_at) return current;
    if (entry.over.deadline_time !== current.deadline_time) return current;
    return entry.value;
  }, [optimistic]);

  return { open, pendingKeys, openAt, close, save, shown };
}

/* ─── The popover ──────────────────────────────────────────────────────────────────────── */

const PANEL_WIDTH = 244;
/** Gap between the trigger and the panel, and the panel and the viewport edge. */
const GAP = 6;
const MARGIN = 8;

const INPUT_STYLE: React.CSSProperties = {
  flex: 1, minWidth: 0, boxSizing: 'border-box', minHeight: '32px', borderRadius: '8px',
  padding: '4px 8px', background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(200,210,230,0.6)', fontFamily: FONT, fontSize: '0.82rem',
  fontWeight: 500, color: '#2d3748',
};

const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontFamily: FONT, fontSize: '0.7rem', fontWeight: 700,
  color: '#5c6b80', marginBottom: '4px',
};

/**
 * A real popover, not a permanently-expanded row: it exists only while `editor.open` names this
 * cell, and it closes on save, on Escape, and on an outside click (ruling 3 — the outside-click
 * and scroll listeners live in `DeadlineCell`, which owns the container both this panel and the
 * trigger sit inside, exactly as `WorkBoardView`'s "Move to" menu does).
 *
 * `position: fixed`, not absolute: the table lives inside a `max-height: 68vh; overflow: auto`
 * scroll container, which would clip an absolutely-positioned panel on any row near the bottom.
 * Fixed positioning escapes that (no ancestor here establishes a containing block with a
 * transform), at the cost of needing the anchor in viewport coordinates and of closing on
 * scroll — which `DeadlineCell` does.
 *
 * Solid white rather than §11's glass recipe: that recipe is for *outer* panels (the rail, the
 * view containers). Every overlay in this module — `WorkItemRow`'s row menu, `WorkBoardView`'s
 * "Move to" menu — is already solid `#fff` with `0 8px 24px rgba(31,38,68,0.18)`, because a
 * translucent surface floating over dense table rows lets the row text bleed through the
 * controls. This matches those two so the module's overlays read as one object.
 */
function DeadlinePopover({
  item, values, anchor, onCancel, onSave, panelRef,
}: {
  item:     WorkItem;
  values:   DeadlineValues;
  anchor:   AnchorRect;
  onCancel: () => void;
  onSave:   (next: DeadlineValues) => void;
  /** Owned by `DeadlineCell`, not created here — its own outside-click/scroll dismissal needs
   *  to test this exact node, and a ref this component created internally would be invisible
   *  outside it. See the portal note below for why that stopped being optional. */
  panelRef: React.RefObject<HTMLFormElement | null>;
}) {
  const ids = useId();
  const dateId = `${ids}-date`;
  const timeId = `${ids}-time`;

  const dateRef  = useRef<HTMLInputElement>(null);

  // Drafts, seeded from the values the cell is *showing* (stored or optimistic) and normalised
  // to the shapes the native inputs accept: `<input type="date">` wants "YYYY-MM-DD" and
  // `<input type="time">` "HH:MM". `''` is the native "empty" value for both, and is what this
  // component uses to mean "cleared".
  const [date, setDate] = useState<string>(dueDateOf(values) ?? '');
  const [time, setTime] = useState<string>(values.deadline_time ? values.deadline_time.slice(0, 5) : '');

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // A time set against a date that is about to be cleared is about to be discarded (ruling 2),
  // so say so before the save rather than after it.
  const willDropTime = date === '' && time !== '';

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();

    let left = anchor.left;
    if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - MARGIN - width;
    if (left < MARGIN) left = MARGIN;

    // Below the trigger by default, flipped above when the viewport has no room — the case that
    // matters for the last rows of a tall table.
    let top = anchor.bottom + GAP;
    if (top + height > window.innerHeight - MARGIN) {
      const above = anchor.top - height - GAP;
      top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - MARGIN - height);
    }
    setPos({ left, top });
    // `willDropTime` is a dependency because the hint line changes the panel's height, which
    // changes where a flipped-above panel has to sit.
  }, [anchor, willDropTime]);

  // Opening moves focus into the editor; `DeadlineCell` moves it back to the trigger on every
  // exit. `opacity: 0` rather than `visibility: hidden` for the pre-measurement frame precisely
  // so this can run: a `visibility: hidden` element is not focusable.
  useEffect(() => { dateRef.current?.focus(); }, []);

  const submit = () => {
    // Ruling 2, and the only place it is decided. Clearing the date clears the time in the *same*
    // PATCH — deadline time has no meaning without a date, and a stored time orphaned with no
    // date is a state this editor must never be able to produce. Clearing only the time sends
    // `deadline_time: null` and leaves `due_at` exactly as it was.
    const next: DeadlineValues = date === ''
      ? { due_at: null, deadline_time: null }
      : { due_at: date, deadline_time: time === '' ? null : time };

    // Nothing moved: close without a request, the same guard as `StatusCell`'s `next === shown`.
    if (sameDeadline(values, next)) { onCancel(); return; }
    onSave(next);
  };

  // Portalled to `document.body` rather than rendered where this component sits in the table:
  // this panel is `position: fixed` specifically so its viewport-relative coordinates (computed
  // above from `window.innerWidth`/`innerHeight`) place it correctly — but `position: fixed`
  // resolves against the nearest ancestor that establishes a containing block for it, and any
  // ancestor with `backdrop-filter` (or `transform`/`filter`/`perspective`/`contain`) is exactly
  // such an ancestor. The Table's own view-content wrapper has `backdropFilter: 'blur(14px)'`
  // (`WorkboardShell.tsx`'s `GLASS`), so without the portal this panel's "viewport-relative"
  // coordinates were actually being resolved against THAT wrapper's box, landing it in the wrong
  // place. `WorkItemDetail.tsx`'s own docblock already names this exact mechanism for why its
  // drawer deliberately isn't glass; this is the same bug, on a popover that can't avoid its
  // ancestor's styling the way a whole panel can, so it escapes structurally instead. A portal
  // changes only where this renders in the DOM — the React tree (event bubbling, context,
  // styled-jsx's build-time scoping below) is unaffected.
  return createPortal(
    <form
      ref={panelRef}
      role="dialog"
      aria-label={`Deadline for "${item.title}"`}
      className="vb-deadline-pop"
      onSubmit={e => { e.preventDefault(); submit(); }}
      onKeyDown={e => {
        // Ruling 3. `stopPropagation` so the table's scroll region never sees it; the cell puts
        // focus back on the trigger that opened this.
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
      }}
      style={{
        position: 'fixed',
        left: pos?.left ?? anchor.left,
        top:  pos?.top  ?? anchor.bottom + GAP,
        // Hidden until measured, but still focusable — see the focus effect above.
        opacity: pos === null ? 0 : 1,
        pointerEvents: pos === null ? 'none' : 'auto',
        zIndex: 40, width: `${PANEL_WIDTH}px`, boxSizing: 'border-box',
        background: '#fff', borderRadius: '12px', border: '1px solid rgba(200,210,230,0.6)',
        boxShadow: '0 8px 24px rgba(31,38,68,0.18)', padding: '12px',
        display: 'flex', flexDirection: 'column', gap: '10px',
        textAlign: 'left', whiteSpace: 'normal', fontFamily: FONT,
      }}
    >
      <div>
        <label htmlFor={dateId} style={LABEL_STYLE}>Date</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            ref={dateRef}
            id={dateId}
            type="date"
            className="vb-deadline-input"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={INPUT_STYLE}
          />
          <button
            type="button"
            className="vb-deadline-clear"
            // The first of ruling 2's two independent gestures. An explicit control rather than
            // relying on the native input's own clear affordance, which Chrome draws, Firefox
            // draws differently and Safari does not draw at all.
            aria-label="Clear date"
            title="Clear date"
            disabled={date === ''}
            onClick={() => setDate('')}
            style={clearButtonStyle(date === '')}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      </div>

      <div>
        <label htmlFor={timeId} style={LABEL_STYLE}>Time</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            id={timeId}
            type="time"
            className="vb-deadline-input"
            value={time}
            // Disabled, not silently ignored: the domain says a time has no meaning without a
            // date, so with the date cleared this control has nothing to attach to. The draft is
            // deliberately *not* wiped — retyping a date brings the time back, so clearing a date
            // to correct a typo does not cost the user their time as well.
            disabled={date === ''}
            onChange={e => setTime(e.target.value)}
            style={{ ...INPUT_STYLE, opacity: date === '' ? 0.55 : 1 }}
          />
          <button
            type="button"
            className="vb-deadline-clear"
            // The second gesture, and the one with the smaller consequence: it sends
            // `deadline_time: null` and leaves the date alone.
            aria-label="Clear time"
            title="Clear time"
            disabled={time === '' || date === ''}
            onClick={() => setTime('')}
            style={clearButtonStyle(time === '' || date === '')}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      </div>

      {willDropTime && (
        // `role="status"` so a screen-reader user who cleared the date hears the consequence
        // rather than only sighted users seeing it. §8's AA-passing meta colour, not a lighter
        // shade — this sentence is load-bearing, not decorative filler.
        <p role="status" style={{
          margin: 0, fontFamily: FONT, fontSize: '0.7rem', fontWeight: 600,
          color: '#8a5010', lineHeight: 1.35,
        }}>
          Saving clears the time too — a time needs a date.
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '2px' }}>
        <button
          type="button"
          className="vb-deadline-btn"
          onClick={onCancel}
          style={{
            minHeight: '30px', padding: '6px 12px', borderRadius: '8px',
            background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.6)',
            fontFamily: FONT, fontSize: '0.76rem', fontWeight: 600, color: '#5c6b80',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="vb-deadline-btn"
          style={{
            minHeight: '30px', padding: '6px 14px', borderRadius: '8px',
            background: '#2a7fa8', border: '1px solid #2a7fa8',
            fontFamily: FONT, fontSize: '0.76rem', fontWeight: 700, color: '#fff',
            cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>

      {/* These rules MUST live in the component that renders the elements they target. Each
          component gets its own styled-jsx scope hash, so a `.vb-deadline-input` rule written in
          `DeadlineCell` or in `WorkTableView` would compile cleanly and match nothing — the trap
          three tasks in this plan have hit. */}
      <style jsx>{`
        /* §9's ring, on the darker blue. :focus-visible so a mouse click does not leave a ring
           nobody asked for, while keyboard arrival always does. */
        .vb-deadline-input:focus-visible,
        .vb-deadline-clear:focus-visible,
        .vb-deadline-btn:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        .vb-deadline-input:hover:not(:disabled),
        .vb-deadline-clear:hover:not(:disabled) {
          border-color: rgba(140,160,190,0.75);
        }
        .vb-deadline-btn:hover {
          filter: brightness(0.97);
        }
      `}</style>
    </form>,
    document.body,
  );
}

/** 26×26 clears the WCAG 2.2 Target Size (Minimum) floor of 24px with a little margin, which is
 *  the right bar for a secondary control inside an already-open editor. */
function clearButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    flex: '0 0 26px', width: '26px', height: '26px', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', borderRadius: '8px',
    background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.6)',
    color: '#5c6b80', cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1, padding: 0,
  };
}

/* ─── The cells ────────────────────────────────────────────────────────────────────────── */

export interface DeadlineCellProps {
  item:     WorkItem;
  /** Which of the two `<td>`s this instance renders. Both go through this one component so the
   *  popover, its positioning and its focus handling exist once rather than twice. */
  column:   DeadlineColumn;
  /** The row's shared `<td>` styling, computed once by `WorkTableView`. This cell overrides only
   *  its vertical padding and (for the Deadline column) its colour. */
  style:    React.CSSProperties;
  /** "YYYY-MM-DD" — used only by the Deadline column, for `dueStateOf`. Taken by both so the two
   *  render calls in `WorkTableView` have one prop shape. */
  todayStr: string;
  /** The editor's single home, from `useDeadlineEditor`. Shared by every cell in the table. */
  editor:   DeadlineEditor;
}

/**
 * The Table's third interactive cell — and the first that is a popover editor rather than a
 * plain `<select>`. Spec §9 forbids `contenteditable`, so the two values are edited through
 * native `<input type="date">` and `<input type="time">` controls, which are keyboard operable
 * and screen-reader announced for free.
 *
 * **The Deadline cell and the Time cell are one editor.** This component renders both: an
 * instance with `column="deadline"` draws the date trigger, an instance with `column="time"`
 * draws the time trigger, and both read the same `DeadlineEditor`. Clicking either opens the
 * same popover over the same item, and saving writes `due_at` and `deadline_time` together in
 * one PATCH. There is exactly one `open` slot in the editor, so two popovers cannot be open at
 * once and the two columns cannot drift apart.
 *
 * The failure-handling shape is `StatusCell`'s and `PriorityCell`'s, unchanged: tagged optimistic
 * override, `pending` with a `finally` on every exit, `wasFocused` restoring keyboard focus after
 * the trigger re-enables, and JSON-error-with-fallback through `reportTableCellError`.
 */
export default function DeadlineCell({ item, column, style, todayStr, editor }: DeadlineCellProps) {
  const key     = itemKey(item);
  const values  = editor.shown(item);
  const pending = editor.pendingKeys.has(key);
  // This instance owns the popover only when the editor is open on this row *and* this column
  // was the one that opened it — so the panel renders anchored to the trigger the user clicked.
  const isOrigin = editor.open !== null && editor.open.key === key && editor.open.origin === column;

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef   = useRef<HTMLButtonElement>(null);
  // Owned here, not inside `DeadlinePopover`, because the popover is now portalled to
  // `document.body` (see its own comment) and is therefore no longer a DOM descendant of
  // `containerRef` — the outside-click handler below must test this ref independently instead
  // of relying on DOM containment to cover both the trigger and the panel in one check.
  const panelRef      = useRef<HTMLFormElement>(null);
  // `disabled={pending}` is what stops the race, but browsers blur an element the instant it
  // becomes disabled — a keyboard user who just saved is dropped to `document.body` for the round
  // trip, and nothing puts them back by default. `wasFocused` records whether *this* trigger
  // owned focus at the moment it disabled, so re-enabling restores it there and only there.
  const wasFocused = useRef(false);

  // Runs on every `pending` transition, not only false→true→false in one breath, because React
  // may batch across the round trip. Firing only when this trigger was the focused one means an
  // unrelated row's request finishing cannot steal focus onto this cell.
  useEffect(() => {
    if (!pending && wasFocused.current) {
      triggerRef.current?.focus();
      wasFocused.current = false;
    }
  }, [pending]);

  // Ruling 3's outside-click and scroll dismissal, owned by the cell because the cell owns
  // both refs the check needs. `containerRef` covers the trigger (including the "inside" test
  // that stops a click on it from closing and immediately reopening, same shape as
  // `WorkBoardView`'s "Move to" menu); `panelRef` covers the popover separately, since it is
  // portalled to `document.body` and is no longer `containerRef`'s DOM descendant the way it
  // was before the portal fix — DOM containment alone can no longer answer "inside or outside"
  // for both pieces at once.
  // `close` alone, not the whole `editor`: the hook returns a fresh object every render, so
  // depending on `editor` would tear down and re-attach these listeners on every parent render.
  // `close` is a `useCallback` with no dependencies, so it is stable for the table's lifetime.
  const closeEditor = editor.close;
  useEffect(() => {
    if (!isOrigin) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      closeEditor();
    };
    // Capture phase: the table's own scroll container is what usually moves, and its scroll
    // events do not bubble to `window`. A fixed panel would otherwise stay put while its row
    // slid away underneath it.
    //
    // Unlike the outside-click case, this dismissal is not the user choosing to leave the
    // control, so focus is returned to the trigger — exactly as Escape and Save already do —
    // rather than left to fall to `document.body`, where the next Tab would restart at the
    // top of the page. `triggerRef` is a stable ref container, so reading `.current` here is
    // safe even though this closure is recreated only when the effect's own deps change.
    const handleScroll = () => {
      closeEditor();
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isOrigin, closeEditor]);

  const closeAndRefocus = () => {
    editor.close();
    triggerRef.current?.focus();
  };

  const handleSave = (next: DeadlineValues) => {
    editor.close();
    // Ruling 3: focus returns to whichever trigger opened the popover. It is about to be blurred
    // again by `disabled={pending}`, which is what `wasFocused` exists to undo.
    triggerRef.current?.focus();
    wasFocused.current = document.activeElement === triggerRef.current;
    void editor.save(item, next);
  };

  const handleTriggerClick = () => {
    if (pending) return;
    if (isOrigin) { closeAndRefocus(); return; }
    if (triggerRef.current) editor.openAt(item, column, triggerRef.current);
  };

  // Both columns render from the *shown* values, so an in-flight edit updates the date and the
  // time together. `dueStateOf`, `formatDeadline` and `formatDeadlineTime` all take a `WorkItem`,
  // so the override is applied by overlaying the two fields rather than by re-implementing any
  // of the three here — in particular `formatDeadlineTime`, which is the single guarantee that
  // an absent time reads as an em dash and never as midnight.
  const shownItem: WorkItem = { ...item, due_at: values.due_at, deadline_time: values.deadline_time };

  const isDeadline = column === 'deadline';
  const dueState   = dueStateOf(shownItem, todayStr);
  const dateLabel  = formatDeadline(shownItem);
  const timeLabel  = formatDeadlineTime(shownItem);

  const label = isDeadline ? (dateLabel ?? DASH) : timeLabel;
  const color = isDeadline ? DEADLINE_COLOR[dueState] : '#5c6b80';

  // The accessible name is composed from the button's own content rather than an `aria-label`,
  // so the visible string is always contained in it (WCAG 2.5.3) and the overdue suffix keeps
  // working exactly as it did when this was static text. An em dash alone would name the button
  // "—", hence the spelled-out absent state.
  const srAbsent =
    isDeadline
      ? (dateLabel === null ? ' No deadline set.' : (DEADLINE_SR_SUFFIX[dueState] ?? ''))
      : (timeLabel === DASH ? ' No time set.' : '');
  const srAction = isDeadline
    ? ` Edit deadline for "${item.title}".`
    : ` Edit deadline time for "${item.title}".`;

  return (
    <td style={{ ...style, padding: CELL_PADDING, color, fontWeight: 600 }}>
      <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          ref={triggerRef}
          type="button"
          className="vb-deadline-trigger"
          disabled={pending}
          aria-haspopup="dialog"
          aria-expanded={isOrigin}
          onClick={handleTriggerClick}
          style={{
            // `StatusCell`'s control language exactly — itself the dialog's `CONTROL_STYLE`
            // compressed for a table cell — so the Table's editable columns read as one control
            // rather than four unrelated ones.
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            boxSizing: 'border-box', minHeight: '26px', borderRadius: '8px',
            padding: '2px 8px', background: 'rgba(255,255,255,0.6)',
            border: '1px solid rgba(200,210,230,0.6)', fontFamily: FONT, fontSize: '0.76rem',
            fontWeight: 600, color: 'inherit', lineHeight: 1.2,
            cursor: pending ? 'progress' : 'pointer',
            // Opacity, not a colour swap: the UA's own disabled rendering greys the text below
            // §8's contrast floor, and this is a transient in-flight state, not a permanently
            // unavailable control.
            opacity: pending ? 0.65 : 1,
          }}
        >
          {isDeadline
            ? <Calendar size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.75 }} />
            : <Clock    size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.75 }} />}
          {label}
          {(srAbsent || srAction) && (
            <span style={VISUALLY_HIDDEN}>{srAbsent}{srAction}</span>
          )}
        </button>

        {isOrigin && editor.open !== null && (
          <DeadlinePopover
            item={item}
            values={values}
            anchor={editor.open.anchor}
            onCancel={closeAndRefocus}
            onSave={handleSave}
            panelRef={panelRef}
          />
        )}
      </div>

      {/* Scoped to this component, which is the one that renders the trigger. */}
      <style jsx>{`
        /* §9's ring, on the darker blue — :focus-visible so a mouse click does not leave a ring
           nobody asked for, while keyboard arrival through the column always does. */
        .vb-deadline-trigger:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        .vb-deadline-trigger:hover:not(:disabled) {
          border-color: rgba(140,160,190,0.75);
        }
      `}</style>
    </td>
  );
}
