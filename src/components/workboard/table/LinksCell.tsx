'use client';

import { useRef, useState } from 'react';
import { Link2, Plus, ExternalLink } from 'lucide-react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope,
// so a *value* import here would drag the driver into this client bundle and 500 the page.
// Same hazard documented in `StatusCell.tsx`, `PriorityCell.tsx`, `DeadlineCell.tsx`,
// `WorkboardShell.tsx`, `WorkItemRow.tsx` and `WorkTableView.tsx`.
import type { WorkItem } from '@/lib/workboard/workItems';
import type { WorkLink } from '@/lib/workboard/links';
// The editor, and the shared owner-links store it and this cell both read. `LinksPopover` is a
// client component with no `@/lib/db` reach of its own, so these are safe as value imports.
import LinksPopover, { cachedOwnerLinks, loadOwnerLinks, useOwnerLinks } from '../LinksPopover';

/** `"Canvas · GitHub · +2"` — the separator is a middle dot with hair space either side, the
 *  same one the Focus row's meta line uses. */
const SEPARATOR = ' · ';

/** Two labels, then a count. Three would push a Links column wider than the Work column on a
 *  row with verbose labels, and the popover is one click away for the rest. */
const MAX_LABELS = 2;

/** Both cells' `<td>` padding, for the same reason `StatusCell`, `PriorityCell` and
 *  `DeadlineCell` all override it: the shared `7px` vertical padding is sized for a line of
 *  text and would push a row carrying a 26px control past the Work cell's 31px. */
const CELL_PADDING = '2px 12px';

/** Bounds how far the column can grow when a cell upgrades from its count to its labels. The
 *  text ellipses rather than wrapping, so a verbose label cannot reflow the table. */
const SUMMARY_MAX_WIDTH = '190px';

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/**
 * The Links column's text, in the two states it can be in. Empty string for "nothing to show" —
 * the caller renders its own "+ Link" invitation rather than this function spelling out an
 * absence, since a zero-links row isn't a summary of anything, it's a different control.
 *
 * **When the labels are known, they are the truth.** The cache is updated the instant an add or
 * a delete succeeds inside the popover, while `link_count` has to wait for the whole work
 * payload to be re-pulled — so deriving from the list when it exists is what makes a delete
 * move this cell immediately instead of a beat later.
 *
 * **When they are not, the count is all there is.** The payload carries `link_count` and no
 * labels (deliberately — one COUNT subquery per item beats one list query per row), so a row
 * nobody has shown interest in yet reads `"3 links"`. It is honest, it is the same information
 * the column carried before this task, and it costs no request.
 *
 * Exported because it is the one piece of this cell that is pure and worth asserting against
 * directly.
 */
export function summariseLinks(linkCount: number, links: readonly WorkLink[] | undefined): string {
  if (links !== undefined) {
    if (links.length === 0) return '';
    const labels = links.slice(0, MAX_LABELS).map(link => link.label);
    const rest = links.length - labels.length;
    return (rest > 0 ? [...labels, `+${rest}`] : labels).join(SEPARATOR);
  }
  if (linkCount <= 0) return '';
  return linkCount === 1 ? '1 link' : `${linkCount} links`;
}

export interface LinksCellProps {
  item:      WorkItem;
  /** The row's shared `<td>` styling, computed once by `WorkTableView` so every cell agrees
   *  about dividers, alignment and typography. This cell overrides only its vertical padding. */
  style:     React.CSSProperties;
  /** Re-pulls the work payload after a successful add or delete, so `link_count` — which the
   *  Links column can also be *sorted* by — agrees with what the popover just wrote. */
  onChanged: () => void | Promise<void>;
}

/**
 * The Table's fourth and last interactive cell.
 *
 * Unlike its three siblings it is not an editor in its own right: it renders a summary and a
 * trigger, and `LinksPopover` — a standalone component the detail panel reuses unchanged — does
 * the editing. There is deliberately no optimistic override here either, because links are a
 * list that is created and destroyed rather than a single value being swapped: the shared
 * owner-links store plays that role, updated the moment a write succeeds and read by this cell
 * through `useOwnerLinks`.
 *
 * **Reading the labels is lazy.** The cell renders from `link_count` alone on first paint — no
 * request, nothing blocking the table — and upgrades to the `"Canvas · GitHub · +2"` form once
 * that owner's list is in the store. It gets there on user intent: a pointer entering the
 * trigger, or focus landing on it, primes the fetch that opening the popover would have made
 * anyway. Fetching every row's list up front would be exactly the per-row query that
 * `link_count` exists to avoid, and fetching only on open would mean the labelled form almost
 * never appeared.
 *
 * The trigger is live at zero links too. It is the only way to attach a first link from the
 * Table, so an em dash here is still a button — with a spelled-out accessible name, since "—"
 * is not one.
 */
export default function LinksCell({ item, style, onChanged }: LinksCellProps) {
  const [open, setOpen] = useState(false);
  // Keyboard-opened UI does not animate (spec 4.3); a keyboard-synthesised click has `detail` 0.
  const [instant, setInstant] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const links   = useOwnerLinks(item.source, item.id);
  const summary = summariseLinks(item.link_count, links);
  // The store wins here too, for the same reason it does in `summariseLinks`.
  const count   = links?.length ?? item.link_count;
  const isEmpty = count === 0;
  // Only once the actual label is known — a still-loading "1 link" fallback isn't a label worth
  // pairing with an external-link glyph, since there's no link text there for the glyph to sit
  // beside yet.
  const showExternalGlyph = links !== undefined && links.length === 1;

  /** Primes the store on intent. Cheap to call repeatedly: `loadOwnerLinks` returns the cached
   *  value without a request, and joins an in-flight one rather than issuing a second.
   *
   *  Failure is deliberately silent *here* — a hover is not a request for data, and an `alert`
   *  on mouse-over would be noise. The popover re-issues the load when it opens and reports
   *  what went wrong then (ruling 6), which is the fetch the user actually asked for. */
  const prefetch = () => {
    // Nothing to label, so nothing worth a request: a zero-link row's summary is already final,
    // and the popover will load the (empty) list itself if the user opens it to add one.
    if (item.link_count === 0) return;
    if (cachedOwnerLinks(item.source, item.id) !== undefined) return;
    void loadOwnerLinks(item.source, item.id);
  };

  return (
    <td style={{ ...style, padding: CELL_PADDING }}>
      <button
        ref={triggerRef}
        type="button"
        className={`vb-links-trigger${isEmpty ? ' vb-links-trigger--empty' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onClick={e => { setInstant(e.detail === 0); setOpen(current => !current); }}
      >
        {isEmpty ? (
          <Plus size={12} aria-hidden style={{ flexShrink: 0 }} />
        ) : (
          <Link2 size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.75 }} />
        )}
        <span style={{
          display: 'block', maxWidth: SUMMARY_MAX_WIDTH, overflow: 'hidden',
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
          // `WorkSource`, so an academic row resolves through the academic path with no
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

      {/* Scoped to this component, which is the one that renders the trigger. Quiet like the
          other cells: no border or fill until the row is hovered or the trigger takes focus. An
          empty cell keeps its "+ Link" invitation as blue text rather than a dashed box. */}
      <style jsx>{`
        .vb-links-trigger {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          box-sizing: border-box;
          min-height: 26px;
          border: 1px solid transparent;
          border-radius: var(--wb-r-sm);
          padding: 3px 6px;
          background: transparent;
          font: 600 var(--wb-fs-13) var(--wb-font-ui);
          line-height: 1.2;
          color: var(--wb-text-muted);
          cursor: pointer;
        }
        .vb-links-trigger--empty {
          gap: 4px;
          font-weight: 700;
          color: var(--wb-blue-ink);
        }
        @media (hover: hover) and (pointer: fine) {
          :global(.vb-table-row:hover) .vb-links-trigger {
            border-color: var(--wb-border);
            background: var(--wb-surface);
          }
          :global(.vb-table-row:hover) .vb-links-trigger--empty {
            border-style: dashed;
            border-color: var(--wb-blue);
            background: var(--wb-selected);
          }
        }
        .vb-links-trigger:focus-visible {
          border-color: var(--wb-blue-strong);
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 1px;
          background: var(--wb-surface);
        }
        @media (hover: none) {
          .vb-links-trigger { border-color: var(--wb-hairline); }
        }
      `}</style>
    </td>
  );
}
