'use client';

import { useEffect, useRef, useState } from 'react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope,
// so a *value* import here would drag the driver into this client bundle and 500 the page.
// Same hazard documented in `StatusCell.tsx`, `WorkboardShell.tsx`, `WorkItemRow.tsx` and
// `WorkTableView.tsx`.
import type { WorkItem, WorkPriority } from '@/lib/workboard/workItems';
// `setPriority` is the single place owned-vs-academic endpoint routing lives, alongside
// `setWorkStatus`/`setWorkStage` (Tasks 11/16/20). Imported, never re-derived: a second copy
// of that URL decision is the drift this plan has already had to remove twice, so this cell
// must not know that academic items patch a different route from owned ones.
import { setPriority } from '../WorkItemRow';
// The module's one failure surface, shared with `StatusCell` (Task 20's report asked for it
// the moment a second cell became interactive — this is that second cell).
import { reportTableCellError } from './tableCellError';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";

/** Fixed and identical in every context. Unlike stages there is no `PRIORITIES_BY_CONTEXT`
 *  and no fallback list: high/normal/low is the whole vocabulary for an Academic row and a
 *  Life row alike, and it is exactly what both PATCH routes whitelist. */
const PRIORITIES: readonly WorkPriority[] = ['high', 'normal', 'low'];

/** Same three labels the edit dialog and `WorkTableView`'s old read-only cell used, so the
 *  word in the cell does not change now that the cell is editable. */
const PRIORITY_LABEL: Record<WorkPriority, string> = {
  high:   'High',
  normal: 'Normal',
  low:    'Low',
};

/** Turning the Priority column into a control removes §4's High pill from it. The pill was
 *  the column's "this one is urgent" signal, so the colour moves onto the select's own text
 *  rather than being dropped: `#922e48` is §6's alert red, the same value the pill used for
 *  its text and the only AA-passing one in that family (§8). Colour is not carrying the
 *  meaning alone — the control's value literally reads "High", and §4's coloured left edge
 *  on the row's first cell is untouched — so this is a third cue, not a sole one. */
const TEXT_COLOR: Record<WorkPriority, string> = {
  high:   '#922e48',
  normal: '#2d3748',
  low:    '#2d3748',
};

const GENERIC_ERROR = 'Could not change the priority. Please try again.';
const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

export interface PriorityCellProps {
  item:      WorkItem;
  /** The row's shared `<td>` styling, computed once by `WorkTableView` so every cell agrees
   *  about dividers, alignment and typography. This cell overrides only its vertical padding
   *  (see below) — everything else is taken as given. */
  style:     React.CSSProperties;
  /** Re-pulls the work payload after a successful write, so the row reconciles with the
   *  server rather than living on its optimistic value forever. */
  onChanged: () => void | Promise<void>;
}

/**
 * The Table's second interactive cell, built on `StatusCell`'s shape rather than a new one:
 * same tagged optimistic override, same `pending` disable, same focus restoration, same
 * message extraction. Every one of those closed a defect the review process found on the
 * sibling cell, so the similarity is the point.
 *
 * One difference is real and deliberate: `StatusCell` emits a stray stored stage as its own
 * disabled option, because `work_stage` is a free-form `VARCHAR(24)` a hand-edit can put
 * anything into, and a `<select>` whose `value` matches no `<option>` silently renders the
 * *first* one — reporting the row as something it is not. Priority has no such hole: owned
 * rows store it in `ENUM('high','normal','low')`, and academic rows reach this component
 * through `priorityFromUrgency`, which maps every unrecognised urgency (including NULL) to
 * `'normal'`. `shown` is therefore always one of the three options, so a stray branch here
 * would be unreachable code rather than a guard.
 *
 * **A priority write on an academic row leaves Workboard.** `patchAcademicItem` routes
 * `priority` through `urgencyFromPriority` into Study Pulse's own `urgency` column (not the
 * `workboard_entry_meta` overlay), so a change made here is visible in Study Pulse's UI too.
 * That is the existing, intended mapping — the same one that reads the value back — but it
 * makes this the one inline Table edit that writes outside Workboard's own tables.
 */
export default function PriorityCell({ item, style, onChanged }: PriorityCellProps) {
  const priority = item.priority;

  const [pending, setPending] = useState(false);
  // `disabled={pending}` is what stops the race, but browsers blur an element the instant it
  // becomes disabled — a keyboard user who just changed this select is dropped to
  // `document.body` for the round trip, and nothing puts them back by default. `wasFocused`
  // records whether *this* select owned focus at the moment it disabled, so re-enabling
  // restores it there and only there — a user who tabbed away in the meantime, or a select
  // that disabled from some other row's action, must not steal focus back.
  const selectRef = useRef<HTMLSelectElement>(null);
  const wasFocused = useRef(false);
  /** The optimistic override, tagged with the priority it was applied *over*. Reconciliation
   *  is therefore pure — no effect, no render-phase `setState`: once the refreshed payload
   *  arrives with a different `priority`, the tag no longer matches and the override falls
   *  away on its own, with no frame in which the old value flashes back. A refresh that
   *  silently fails (`refreshWork` only calls `setWork` when the GET is `ok`) leaves the tag
   *  matching, so the cell keeps showing the value the server accepted rather than springing
   *  back to a value that is no longer true. */
  const [optimistic, setOptimistic] = useState<{ over: WorkPriority; value: WorkPriority } | null>(null);

  const shown = optimistic !== null && optimistic.over === priority ? optimistic.value : priority;

  // Runs on every `pending` transition, not only false→true→false in one breath, because
  // React may batch across the round trip. Firing only when the select was the one focused
  // when it disabled means an unrelated row's request finishing, or a user who has since
  // tabbed elsewhere, cannot steal focus onto this cell.
  useEffect(() => {
    if (!pending && wasFocused.current) {
      selectRef.current?.focus();
      wasFocused.current = false;
    }
  }, [pending]);

  const handleChange = async (next: WorkPriority) => {
    // Belt-and-braces behind `disabled={pending}`: a fast double change cannot produce two
    // racing PATCHes whose responses land out of order.
    if (pending || next === shown) return;

    wasFocused.current = document.activeElement === selectRef.current;
    setOptimistic({ over: priority, value: next });
    setPending(true);
    try {
      // `.catch(() => null)` rather than a `try` around the whole body: only `fetch` itself
      // rejecting counts as a network failure here. Letting `onChanged`'s own rejection reach
      // a shared catch would report "could not change the priority" for a write that
      // succeeded. `onChanged` throwing still unwinds through the `finally` below, so there
      // is no exit — success, non-ok, fetch rejection, thrown `onChanged` — that leaves
      // `pending` stuck true and the control permanently disabled.
      const res = await setPriority(item, next).catch(() => null);

      if (res === null) {
        setOptimistic(null);
        reportTableCellError(NETWORK_ERROR);
        return;
      }
      if (!res.ok) {
        // Revert AND say why. Both PATCH routes answer a rejected priority with
        // `{ error: 'Invalid priority' }`, and the academic route answers an entry that is
        // not this user's with `{ error: 'That item was not found' }` — both far more use
        // than a generic failure. An HTML error page or an empty 500 body is not JSON,
        // hence the fallback. A `console.error` alone is what the v2 review flagged.
        const body: unknown = await res.json().catch(() => null);
        const message =
          typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : GENERIC_ERROR;
        setOptimistic(null);
        reportTableCellError(message);
        return;
      }
      // The reconcile half: the optimistic value made the control feel instant, this makes
      // the row's priority edge, the stats and every other view agree with it.
      await onChanged();
    } finally {
      setPending(false);
    }
  };

  return (
    <td
      style={{
        ...style,
        // The only override, and the same one `StatusCell` makes. The shared `7px` vertical
        // padding is sized for a line of text; around a 26px control it would push this row
        // past the Work cell's 31px and inflate the module's densest surface. `2px` keeps the
        // cell at ~30px — no taller than it was as a pill — while the control itself stays
        // ≥24px tall, so WCAG 2.2 Target Size still holds.
        padding: '2px 12px',
      }}
    >
      <select
        ref={selectRef}
        className="vb-priority-select"
        value={shown}
        disabled={pending}
        // A table full of unlabelled "Priority" selects is unnavigable, so the name identifies
        // the row. No visible label exists for it to contradict, so WCAG 2.5.3 is not in play.
        aria-label={`Priority for "${item.title}"`}
        onChange={e => { void handleChange(e.target.value as WorkPriority); }}
        style={{
          // `StatusCell`'s control language exactly — itself the dialog's `CONTROL_STYLE`
          // compressed for a table cell — so the Table's two editable columns read as one
          // control, not two. Deliberately NOT `appearance: none`: the native disclosure
          // arrow is the affordance that says this cell is editable at all.
          boxSizing: 'border-box', minHeight: '26px', borderRadius: '8px',
          padding: '2px 4px 2px 7px',
          // High gets the pill's own tint back, not just its text colour: the Deadline
          // column sits immediately to the right and paints the same #922e48 for an
          // overdue date, so a high-priority overdue row would otherwise show two
          // identically-red words with nothing but a select border between them. The
          // tint is what separated "priority" from "lateness" before this was a control.
          background: shown === 'high' ? 'rgba(224,96,124,0.15)' : 'rgba(255,255,255,0.6)',
          border: '1px solid rgba(200,210,230,0.6)', fontFamily: FONT, fontSize: '0.76rem',
          fontWeight: shown === 'high' ? 700 : 600, color: TEXT_COLOR[shown], lineHeight: 1.2,
          cursor: pending ? 'progress' : 'pointer',
          // Opacity, not a colour swap: the UA's own disabled rendering greys the text below
          // §8's contrast floor, and this is a transient in-flight state, not a permanently
          // unavailable control.
          opacity: pending ? 0.65 : 1,
        }}
      >
        {PRIORITIES.map(p => (
          <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
        ))}
      </select>

      {/* These rules MUST live here and not in `WorkTableView`. Each component gets its own
          styled-jsx scope hash, so a `.vb-priority-select` rule written in the view would
          compile cleanly and match nothing — the trap three tasks in this plan have hit. */}
      <style jsx>{`
        /* §9's ring, on the darker blue — :focus-visible so a mouse click does not leave a
           ring nobody asked for, while keyboard arrival through the column always does. */
        .vb-priority-select:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        .vb-priority-select:hover:not(:disabled) {
          border-color: rgba(140,160,190,0.75);
        }
      `}</style>
    </td>
  );
}
