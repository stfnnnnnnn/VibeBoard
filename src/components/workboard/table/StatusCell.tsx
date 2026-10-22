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
import {
  STAGES_BY_CONTEXT, STAGE_LABELS, isWaitingStage, type WorkStage,
} from '@/lib/workboard/workContexts';
// The pill's glow-dot colour, shared with the Board's lane headers.
import { statusDot } from '@/lib/workboard/ui/statusDot';
// The module's one failure surface, shared with every interactive cell: an error toast with Retry.
import { reportTableCellError } from './tableCellError';
// Shared with the Board move and the drawer: the waiting prompt, 4xx-vs-retry, and Undo.
import { offerStageUndo, reportStageFailure, waitingPrompt } from '../stageChange';
import WaitingPopover from '../ui/WaitingPopover';

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
  const cellRef = useRef<HTMLTableCellElement>(null);
  /** A change into a waiting stage, held until `WaitingPopover` supplies its reason (spec 10.3). */
  const [askingFor, setAskingFor] = useState<WorkStage | null>(null);
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
  const dot = statusDot(shown);

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

  const commitChange = async (next: WorkStage, reason?: string | null) => {
    // Belt-and-braces behind `disabled={pending}`: ruling 5's guarantee that a fast double
    // change cannot produce two racing PATCHes whose responses land out of order.
    if (pending || next === shown) return;

    wasFocused.current = document.activeElement === selectRef.current;
    const prev = stage;
    const prevReason = item.blocked_reason;
    setOptimistic({ over: stage, value: next });
    setPending(true);
    try {
      // `.catch(() => null)` rather than a `try` around the whole body: only `fetch` itself
      // rejecting counts as a network failure here. Letting `onChanged`'s own rejection reach
      // a shared catch would report "could not change the status" for a write that succeeded.
      const res = await setWorkStage(item, next, reason).catch(() => null);

      if (res === null || !res.ok) {
        // Ruling 2: revert AND say why. A 4xx carries the server's reason and no Retry; a
        // network failure or 5xx keeps Retry (see `reportStageFailure`).
        setOptimistic(null);
        await reportStageFailure(res, {
          fallback: GENERIC_ERROR, network: NETWORK_ERROR,
          retry: () => commitChange(next, reason), report: reportTableCellError,
        });
        return;
      }
      // Ruling 3's reconcile half: the optimistic value made the control feel instant, this
      // makes the stats, the workload chart and every other view agree with it.
      await onChanged();
      // The override is tagged with `prev`, so it would match again once Undo restores it.
      offerStageUndo(item, prev, prevReason, next, onChanged, {
        report: reportTableCellError, beforeUndo: () => setOptimistic(null),
      });
    } finally {
      setPending(false);
    }
  };

  const handleChange = (next: WorkStage) => {
    if (pending || next === shown) return;
    // Waiting stages ask for their reason first; cancelling cancels the change.
    if (isWaitingStage(next)) { setAskingFor(next); return; }
    void commitChange(next);
  };

  return (
    <td
      ref={cellRef}
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
      {/* Refine spec §6: the trigger reads as a glass pill with its status dot. The native
          select still fills the whole pill, so every pixel of it opens the menu; the dot sits on
          top with no pointer events. */}
      <span
        className="wb-gpill vb-status-pill"
        // Opacity, not a colour swap: the UA's own disabled rendering greys the text below
        // §8's contrast floor, and this is a transient in-flight state.
        style={{ opacity: pending ? 0.65 : 1 }}
      >
        <span
          aria-hidden
          className={dot.flat ? 'wb-gdot wb-gdot--flat vb-status-dot' : 'wb-gdot vb-status-dot'}
          style={{ '--dot': dot.color } as React.CSSProperties}
        />
        <select
          ref={selectRef}
          className="vb-status-select"
          value={shown}
          disabled={pending}
          // A table full of unlabelled "Status" selects is unnavigable, so the name identifies
          // the row. No visible label exists for it to contradict, so WCAG 2.5.3 is not in play.
          aria-label={`Status for "${item.title}"`}
          onChange={e => handleChange(e.target.value as WorkStage)}
          style={{ cursor: pending ? 'progress' : 'pointer' }}
        >
          {stray !== null && (
            <option value={stray} disabled>{STAGE_LABELS[stray]}</option>
          )}
          {stages.map(s => (
            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
          ))}
        </select>
      </span>

      <WaitingPopover
        open={askingFor !== null}
        anchor={cellRef.current}
        title={item.title}
        prompt={askingFor !== null ? waitingPrompt(askingFor, item.title) : undefined}
        onCancel={() => {
          setAskingFor(null);
          selectRef.current?.focus({ preventScroll: true });
        }}
        onConfirm={reason => {
          const next = askingFor;
          setAskingFor(null);
          // Back on the select before the popover unmounts, so focus never drops to body.
          selectRef.current?.focus({ preventScroll: true });
          if (next !== null) void commitChange(next, reason);
        }}
      />

      {/* These rules MUST live here and not in `WorkTableView`: each component gets its own
          styled-jsx scope hash. The caret stays hidden until the row is hovered or the select
          takes focus (ruling R7). Every visual declaration is here rather than
          inline, because an inline border or background would beat these rules. */}
      <style jsx>{`
        /* The pill (.wb-gpill) draws the fill, border and highlight; the select inside it is
           transparent and carries the padding, so the whole pill is the click target. */
        .vb-status-pill {
          position: relative;
          padding: 0;
          max-width: 100%;
          box-sizing: border-box;
        }
        .vb-status-dot {
          position: absolute;
          left: 10px;
          top: 50%;
          margin-top: -4px;
          pointer-events: none;
        }
        .vb-status-select {
          appearance: none;
          -webkit-appearance: none;
          box-sizing: border-box;
          min-height: 26px;
          max-width: 100%;
          border: 0;
          border-radius: 999px;
          padding: 3px 20px 3px 25px;
          font: inherit;
          line-height: 1.2;
          color: inherit;
          background-color: transparent;
          /* A down caret from two token-coloured half-squares; hidden until hover or focus. */
          background-image:
            linear-gradient(45deg, transparent 50%, var(--wb-text-subtle) 50%),
            linear-gradient(135deg, var(--wb-text-subtle) 50%, transparent 50%);
          background-position: calc(100% - 13px) 55%, calc(100% - 8px) 55%;
          background-repeat: no-repeat;
          background-size: 0 0, 0 0;
        }
        @media (hover: hover) and (pointer: fine) {
          :global(.vb-table-row:hover) .vb-status-pill {
            background: var(--wb-surface);
          }
          :global(.vb-table-row:hover) .vb-status-select:not(:disabled) {
            background-size: 5px 5px, 5px 5px;
          }
        }
        .vb-status-select:focus-visible {
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 2px;
          background-size: 5px 5px, 5px 5px;
        }
        @media (hover: none) {
          .vb-status-select {
            background-size: 5px 5px, 5px 5px;
          }
        }
      `}</style>
    </td>
  );
}
