'use client';

import { useEffect, useRef, useState } from 'react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope,
// so a *value* import here would drag the driver into this client bundle and 500 the page.
// Same hazard documented in `StatusCell.tsx`, `WorkboardShell.tsx`, `WorkItemRow.tsx` and
// `WorkTableView.tsx`.
import type { WorkItem, WorkPriority } from '@/lib/workboard/workItems';
// `setPriority` is the single place owned-vs-academic endpoint routing lives, alongside
// `setWorkStage` (Tasks 11/16/20). Imported, never re-derived: a second copy
// of that URL decision is the drift this plan has already had to remove twice, so this cell
// must not know that academic items patch a different route from owned ones.
import { setPriority } from '../WorkItemRow';
// The module's one failure surface, shared with `StatusCell` (Task 20's report asked for it
// the moment a second cell became interactive — this is that second cell).
import { reportTableCellError } from './tableCellError';

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
        reportTableCellError(NETWORK_ERROR, () => handleChange(next));
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
        reportTableCellError(message, () => handleChange(next));
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
        className={`vb-priority-select${shown === 'high' ? ' is-high' : ''}`}
        value={shown}
        disabled={pending}
        // A table full of unlabelled "Priority" selects is unnavigable, so the name identifies
        // the row. No visible label exists for it to contradict, so WCAG 2.5.3 is not in play.
        aria-label={`Priority for "${item.title}"`}
        onChange={e => { void handleChange(e.target.value as WorkPriority); }}
        style={{
          cursor: pending ? 'progress' : 'pointer',
          // Opacity, not a colour swap: the UA's own disabled rendering greys the text below
          // §8's contrast floor, and this is a transient in-flight state.
          opacity: pending ? 0.65 : 1,
        }}
      >
        {PRIORITIES.map(p => (
          <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
        ))}
      </select>

      {/* These rules MUST live here and not in `WorkTableView` (styled-jsx scopes per
          component). `StatusCell`'s quiet select exactly, plus High's pill: the one priority
          that should catch the eye keeps a fill at rest; Normal and Low read as muted text. */}
      <style jsx>{`
        .vb-priority-select {
          appearance: none;
          -webkit-appearance: none;
          box-sizing: border-box;
          min-height: 26px;
          max-width: 100%;
          border: 1px solid transparent;
          border-radius: var(--wb-r-sm);
          padding: 3px 22px 3px 6px;
          font: 500 var(--wb-fs-13) var(--wb-font-ui);
          line-height: 1.2;
          color: var(--wb-text-muted);
          background-color: transparent;
          background-image:
            linear-gradient(45deg, transparent 50%, var(--wb-text-subtle) 50%),
            linear-gradient(135deg, var(--wb-text-subtle) 50%, transparent 50%);
          background-position: calc(100% - 13px) 55%, calc(100% - 8px) 55%;
          background-repeat: no-repeat;
          background-size: 0 0, 0 0;
        }
        .vb-priority-select.is-high {
          background-color: var(--wb-danger-bg);
          color: var(--wb-danger);
          border-radius: var(--wb-r-pill);
          font-weight: 700;
        }
        @media (hover: hover) and (pointer: fine) {
          :global(.vb-table-row:hover) .vb-priority-select:not(:disabled) {
            border-color: var(--wb-border);
            background-color: var(--wb-surface);
            background-size: 5px 5px, 5px 5px;
          }
          :global(.vb-table-row:hover) .vb-priority-select.is-high:not(:disabled) {
            background-color: var(--wb-danger-bg);
          }
        }
        .vb-priority-select:focus-visible {
          border-color: var(--wb-blue-strong);
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 1px;
          background-color: var(--wb-surface);
          background-size: 5px 5px, 5px 5px;
        }
        @media (hover: none) {
          .vb-priority-select {
            border-color: var(--wb-hairline);
            background-size: 5px 5px, 5px 5px;
          }
        }
      `}</style>
    </td>
  );
}
