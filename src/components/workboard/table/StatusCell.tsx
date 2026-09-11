'use client';

import { useEffect, useRef, useState } from 'react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope,
// so a *value* import here would drag the driver into this client bundle and 500 the page.
// Same hazard documented in `WorkboardShell.tsx`, `WorkItemRow.tsx` and `WorkTableView.tsx`.
import type { WorkItem } from '@/lib/workboard/workItems';
// `setWorkStage` is the single place owned-vs-academic endpoint routing lives (Tasks 11/16).
// Imported, never re-derived: a second copy of that URL decision is the drift this plan has
// already had to remove twice, so this cell must not know that academic items patch a
// different route from owned ones.
import { setWorkStage } from '../WorkItemRow';
// Pool-free by construction (`workContexts.ts` has no imports at all), so these are safe as
// runtime imports from a client component.
import { STAGES_BY_CONTEXT, STAGE_LABELS, type WorkStage } from '@/lib/workboard/workContexts';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";

/** `context` is read straight from the free-form `category` column, so the lookup below can
 *  miss on a legacy or hand-edited row — the same miss `cellValue` guards with `?? DASH`.
 *  These three are legal stages in every context, so a row with an unrecognised context still
 *  gets a usable, non-empty vocabulary rather than a select with no options at all. */
const FALLBACK_STAGES: readonly WorkStage[] = ['todo', 'in_progress', 'done'];

const GENERIC_ERROR = 'Could not change the status. Please try again.';
const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

/** `work_stage` is typed `WorkStage` but stored in a free-form `VARCHAR(24)`, so the type is a
 *  compile-time assertion over DB text rather than a runtime guarantee. Falling back to
 *  `work_status` keeps a row with an unrecognised stage showing a real label instead of a
 *  blank control; every `WorkStatus` is itself a legal stage in every context. Same helper,
 *  same reasoning, as `WorkTableView`'s and `WorkBoardView`'s — neither is exported. */
function stageOf(item: WorkItem): WorkStage {
  const raw: string = item.work_stage;
  return raw in STAGE_LABELS ? (raw as WorkStage) : item.work_status;
}

export interface StatusCellProps {
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
 * The Table's one interactive cell (spec §9 forbids `contenteditable`, so this is a real
 * `<select>` — keyboard operable and screen-reader announced for free, with none of the
 * ARIA a custom listbox would need).
 *
 * The options are the **item's own** context's stages, not the table's: an Academic row
 * offers five and a Life row three even when they sit side by side in the My Work table.
 * The Board differs only because its columns are one shared axis that cannot vary per row;
 * a cell has no such constraint, and the Status column's *displayed* value has always
 * followed the item's own stage. Vocabulary follows the work, not the view.
 */
export default function StatusCell({ item, style, onChanged }: StatusCellProps) {
  const stage = stageOf(item);

  const [pending, setPending] = useState(false);
  // `disabled={pending}` (ruling 5) is what stops the race, but browsers blur an element the
  // instant it becomes disabled — a keyboard user who just changed this select is dropped to
  // `document.body` for the round trip, and nothing puts them back by default. `wasFocused`
  // records whether *this* select owned focus at the moment it disabled, so re-enabling
  // restores it there and only there — a user who tabbed away in the meantime, or a select
  // that disabled from some other row's action, must not steal focus back.
  const selectRef = useRef<HTMLSelectElement>(null);
  const wasFocused = useRef(false);
  /** The optimistic override, tagged with the stage it was applied *over*. Reconciliation is
   *  therefore pure — no effect, no render-phase `setState`: once the refreshed payload
   *  arrives with a different `stage`, the tag no longer matches and the override falls away
   *  on its own, with no frame in which the old value flashes back. A refresh that silently
   *  fails (`refreshWork` only calls `setWork` when the GET is `ok`) leaves the tag matching,
   *  so the cell keeps showing the value the server accepted rather than springing back to a
   *  value that is no longer true. */
  const [optimistic, setOptimistic] = useState<{ over: WorkStage; value: WorkStage } | null>(null);

  const shown = optimistic !== null && optimistic.over === stage ? optimistic.value : stage;

  const stages = STAGES_BY_CONTEXT[item.context] ?? FALLBACK_STAGES;
  // A stored stage outside its context's vocabulary is possible (free-form column; an item
  // moved between contexts by a hand-edit). A `<select>` whose `value` matches no `<option>`
  // renders the *first* option instead, which would report the row's status as something it
  // is not — so the stray value gets an option of its own, disabled, so it displays honestly
  // but cannot be chosen back and rejected with a 400.
  const stray = stages.includes(shown) ? null : shown;

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

  const handleChange = async (next: WorkStage) => {
    // Belt-and-braces behind `disabled={pending}`: ruling 5's guarantee that a fast double
    // change cannot produce two racing PATCHes whose responses land out of order.
    if (pending || next === shown) return;

    wasFocused.current = document.activeElement === selectRef.current;
    setOptimistic({ over: stage, value: next });
    setPending(true);
    try {
      // `.catch(() => null)` rather than a `try` around the whole body: only `fetch` itself
      // rejecting counts as a network failure here. Letting `onChanged`'s own rejection reach
      // a shared catch would report "could not change the status" for a write that succeeded.
      const res = await setWorkStage(item, next).catch(() => null);

      if (res === null) {
        setOptimistic(null);
        alert(NETWORK_ERROR);
        return;
      }
      if (!res.ok) {
        // Ruling 2: revert AND say why. Both PATCH routes answer a rejected stage with
        // `{ error: '"review" is not a valid stage for academic work' }`, which is far more
        // use than a generic failure — but an HTML error page or an empty 500 body is not
        // JSON, hence the fallback. A `console.error` alone is what the v2 review flagged.
        const body: unknown = await res.json().catch(() => null);
        const message =
          typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : GENERIC_ERROR;
        setOptimistic(null);
        alert(message);
        return;
      }
      // Ruling 3's reconcile half: the optimistic value made the control feel instant, this
      // makes the stats, the workload chart and every other view agree with it.
      await onChanged();
    } finally {
      setPending(false);
    }
  };

  return (
    <td
      style={{
        ...style,
        // The only override. The shared `7px` vertical padding is sized for a line of text;
        // around a 26px control it would push this row past the Work cell's 31px and inflate
        // the module's densest surface. `2px` keeps the cell at ~30px — no taller than it was
        // as plain text — and is the same move the sticky header already makes for its sort
        // button. The control itself stays ≥24px tall, so WCAG 2.2 Target Size still holds.
        padding: '2px 12px',
      }}
    >
      <select
        ref={selectRef}
        className="vb-status-select"
        value={shown}
        disabled={pending}
        // A table full of unlabelled "Status" selects is unnavigable, so the name identifies
        // the row. No visible label exists for it to contradict, so WCAG 2.5.3 is not in play.
        aria-label={`Status for "${item.title}"`}
        onChange={e => { void handleChange(e.target.value as WorkStage); }}
        style={{
          // The dialog's control language (`CONTROL_STYLE` in `WorkItemDialog.tsx`),
          // compressed for a table cell: same background, same border, same text colour,
          // smaller radius and type. Deliberately NOT `appearance: none` — the native
          // disclosure arrow is the affordance that says this cell is editable at all.
          boxSizing: 'border-box', minHeight: '26px', borderRadius: '8px',
          padding: '2px 4px 2px 7px', background: 'rgba(255,255,255,0.6)',
          border: '1px solid rgba(200,210,230,0.6)', fontFamily: FONT, fontSize: '0.76rem',
          fontWeight: 600, color: '#2d3748', lineHeight: 1.2,
          cursor: pending ? 'progress' : 'pointer',
          // Opacity, not a colour swap: the UA's own disabled rendering greys the text below
          // §8's contrast floor, and this is a transient in-flight state, not a permanently
          // unavailable control.
          opacity: pending ? 0.65 : 1,
        }}
      >
        {stray !== null && (
          <option value={stray} disabled>{STAGE_LABELS[stray]}</option>
        )}
        {stages.map(s => (
          <option key={s} value={s}>{STAGE_LABELS[s]}</option>
        ))}
      </select>

      {/* These rules MUST live here and not in `WorkTableView`. Each component gets its own
          styled-jsx scope hash, so a `.vb-status-select` rule written in the view would
          compile cleanly and match nothing — the trap three tasks in this plan have hit. */}
      <style jsx>{`
        /* §9's ring, on the darker blue — :focus-visible so a mouse click does not leave a
           ring nobody asked for, while keyboard arrival through the column always does. */
        .vb-status-select:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        .vb-status-select:hover:not(:disabled) {
          border-color: rgba(140,160,190,0.75);
        }
      `}</style>
    </td>
  );
}
