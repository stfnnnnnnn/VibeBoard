'use client';

import { CheckCircle2, Link2, SearchX, Table2 } from 'lucide-react';
// Type-only import from `workItems.ts` — that module imports `pool` (mysql2) at module scope,
// so a *value* import here would drag the driver into this client bundle and 500 the page.
// Same hazard documented in `WorkboardShell.tsx`, `WorkItemRow.tsx` and `WorkBoardView.tsx`.
import type { WorkItem } from '@/lib/workboard/workItems';
// Pool-free by construction (`workContexts.ts` has no imports at all), so these are safe as
// runtime imports from a client component.
import { CONTEXT_LABELS, STAGE_LABELS, type WorkContext, type WorkStage } from '@/lib/workboard/workContexts';
// Task 17's column projections. Also pool-free: its only runtime imports are `workContexts`
// and `dueSemantics`, and `dueSemantics` reaches only the import-free `dates.ts`.
import { COLUMNS_BY_CONTEXT, cellValue, type TableColumn } from '@/lib/workboard/tableColumns';
import { dueStateOf, type DueState } from '@/lib/workboard/dueSemantics';

const FONT    = "'Inter','DM Sans','Segoe UI',sans-serif";
const DM_FONT = "'DM Sans','Segoe UI',sans-serif";

/** `'all'` is the shell's My Work tab — every context at once. Mirrors `WorkBoardView`'s
 *  `BoardContext`, and takes the same value from the same shell state. */
export type TableContext = WorkContext | 'all';

/** Direction doc §4: the coloured left edge renders on every row, always, keyed by priority.
 *  Values copied from `WorkItemRow.tsx`/`WorkBoardView.tsx` so "that pink-red edge means high"
 *  reads identically across Focus, Board and Table. */
const EDGE_COLOR: Record<WorkItem['priority'], string> = {
  high:   '#e0607c',
  normal: '#b8c6da',
  low:    '#d3dbe6',
};

/** §4's second half: a pill renders if and only if `priority === 'high'`. `normal`/`low` still
 *  need *something* in a column literally headed "Priority" — an em dash there would report a
 *  real, set value as absent, which is the one thing §7's "never blank" rule exists to prevent —
 *  so they render as plain meta text rather than as a muted pill. The rule §4 is protecting is
 *  "no pill on two-thirds of rows", and plain text does not reintroduce that noise. */
const PRIORITY_LABEL: Record<WorkItem['priority'], string> = {
  high:   'High',
  normal: 'Normal',
  low:    'Low',
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

const DASH = '—';

const DIVIDER = '1px solid rgba(200,210,230,0.35)';

/** `work_stage` is typed `WorkStage` but stored in a free-form `VARCHAR(24)`, so the type is a
 *  compile-time assertion over DB text rather than a runtime guarantee. Falling back to
 *  `work_status` keeps a row with an unrecognised stage showing a real label instead of a blank
 *  Status cell; every `WorkStatus` is itself a legal stage in every context. Deliberately a
 *  local copy of `WorkBoardView`'s helper of the same name — that one is not exported, and this
 *  view needs no other part of the Board's column machinery. */
function stageOf(item: WorkItem): WorkStage {
  const raw: string = item.work_stage;
  return raw in STAGE_LABELS ? (raw as WorkStage) : item.work_status;
}

function itemKey(item: Pick<WorkItem, 'source' | 'id'>): string {
  return `${item.source}-${item.id}`;
}

export interface WorkTableViewProps {
  /** Already filtered by category and search — see `WorkboardShell`'s `visibleItems`. */
  items:       WorkItem[];
  /** The shell's active context tab, `'all'` for My Work. Drives the whole column set: the user
   *  never configures a column (spec §7, §34), the context decides them. */
  context:     TableContext;
  /** "YYYY-MM-DD" — `work.generated_at`, so every row agrees with Focus on what "today" is. */
  todayStr:    string;
  /** True when the shell's context tab *or* its search box is currently narrowing `items` —
   *  the same signal `WorkListView`/`WorkBoardView` take, kept so the three views' prop shapes
   *  stay recognisably the same. */
  isFiltered?: boolean;
  /** True when the search box specifically is narrowing `items`. This view needs the narrower
   *  signal because it has three empty states, not two: `isFiltered` alone cannot tell "this
   *  context has no work yet" (offer the create button) apart from "your search matched nothing
   *  inside this context" (offering a create button there would be wrong advice), since
   *  `isFiltered` is true for *any* non-My-Work tab. */
  isSearching?: boolean;
  /** Kept for the prop shape Tasks 19–24 will use for inline mutations. Unused today: this task
   *  renders non-interactive cells only. */
  onChanged:   () => void | Promise<void>;
  /** Opens the create/edit dialog in create mode — wired to this view's own empty states. */
  onNewItem:   () => void;
}

// `onChanged` is deliberately not destructured — it is part of the contract Tasks 19–24 build
// on, but this task renders nothing that mutates, so pulling it out would only be an unused
// binding.
export default function WorkTableView({
  items, context, todayStr, isFiltered, isSearching, onNewItem,
}: WorkTableViewProps) {
  // Never sorted or filtered in place — `COLUMNS_BY_CONTEXT`'s arrays and their `TableColumn`
  // objects are `readonly` precisely because the same object is shared across contexts, and a
  // write through one would corrupt the others for the rest of the session.
  const columns: readonly TableColumn[] = COLUMNS_BY_CONTEXT[context];

  // Three distinct empty states, resolved in this order:
  //   1. nothing is narrowing the view at all      -> the board itself is empty
  //   2. a search is running                       -> nothing matched it
  //   3. only the context tab is narrowing         -> that context has no work yet
  // The `context === 'all'` disjunct in test 2 is unreachable at runtime (if `isFiltered` is
  // true and `isSearching` is false, the tab must be a real context) but it is what narrows
  // `context` from `TableContext` to `WorkContext` for case 3's `CONTEXT_LABELS` lookup, so the
  // label cannot be indexed with `'all'`.
  if (items.length === 0) {
    if (!isFiltered) {
      // Nothing at all. `WorkListView`'s copy, unchanged — this is the board-level statement
      // "you have no work", not a Table-flavoured one.
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <CheckCircle2 size={56} color="#74bcd9" style={{ marginBottom: '14px' }} />
          <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
            Nothing on your plate
          </h2>
          <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: '0 0 18px' }}>
            Add your first work item to get started.
          </p>
          <button type="button" className="vb-btn-pink" onClick={onNewItem} style={{ width: 'auto', padding: '10px 22px' }}>
            New Work Item
          </button>
        </div>
      );
    }

    if (isSearching || context === 'all') {
      // Wording taken verbatim from `WorkListView`/`WorkBoardView`'s filtered empty state.
      return (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <SearchX size={48} color="#9aa4b5" style={{ marginBottom: '14px' }} />
          <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
            No matching work items
          </h2>
          <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: 0 }}>
            Try a different category or search term.
          </p>
        </div>
      );
    }

    // Only the context tab is narrowing, and `context` has narrowed to `WorkContext` with it —
    // the two tests above are what make the `CONTEXT_LABELS` lookup below type-check.
    // New to Table: a context the user has simply not put any work into yet. Distinct from the
    // two states above because the fix *is* available from this view — direction doc §5e only
    // grants an action button when that is true — so this one offers New Work Item.
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <Table2 size={48} color="#9aa4b5" style={{ marginBottom: '14px' }} />
        <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
          Nothing in {CONTEXT_LABELS[context]} yet
        </h2>
        <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: '0 0 18px' }}>
          Work items you add under this context will appear here as rows.
        </p>
        <button type="button" className="vb-btn-pink" onClick={onNewItem} style={{ width: 'auto', padding: '10px 22px' }}>
          New Work Item
        </button>
      </div>
    );
  }

  return (
    // The scroll container, not the page, is what the sticky header sticks inside — and it is
    // focusable with a name because a scrollable region must be reachable by keyboard alone.
    <div
      className="vb-table-scroll"
      role="region"
      aria-label="Work items table"
      tabIndex={0}
      style={{ maxHeight: '68vh', overflow: 'auto', borderRadius: '12px' }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
        <caption
          style={{
            position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
            overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
          }}
        >
          {context === 'all' ? 'All work items' : `${CONTEXT_LABELS[context]} work items`}
        </caption>
        <thead>
          <tr>
            {columns.map(col => (
              // `position: sticky` lives on the `<th>`, never on `<thead>` — sticky on a
              // table section is unreliable across browsers, on the cells it is not.
              <th
                key={col.key}
                scope="col"
                style={{
                  position: 'sticky', top: 0, zIndex: 1,
                  textAlign: col.align === 'right' ? 'right' : 'left',
                  padding: '9px 12px', whiteSpace: 'nowrap',
                  background: 'rgba(255,255,255,0.95)',
                  borderBottom: '1px solid rgba(200,210,230,0.55)',
                  fontFamily: DM_FONT, fontSize: '0.68rem', fontWeight: 800,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  // §8: a column header is load-bearing information, so it takes the
                  // AA-passing meta colour, not one of the lighter decorative shades.
                  color: '#5c6b80',
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, rowIdx) => {
            const isLast  = rowIdx === items.length - 1;
            const isDone  = item.work_status === 'done';
            const divider = isLast ? 'none' : DIVIDER;

            return (
              <tr key={itemKey(item)} className="vb-table-row">
                {columns.map((col, colIdx) => {
                  const value = cellValue(item, col.key);

                  const base: React.CSSProperties = {
                    // Denser than Focus's 56px row (§27: tighter than Rituals or Finance) — the
                    // table has no per-row card and no checkbox column to pad around.
                    padding: '7px 12px',
                    borderBottom: divider,
                    // §4's priority edge, drawn as the first cell's left border rather than an
                    // absolutely-positioned span: a `<td>` is not a positioning context by
                    // default, and a border keeps the markup free of decorative elements.
                    borderLeft: colIdx === 0 ? `3px solid ${EDGE_COLOR[item.priority]}` : undefined,
                    textAlign: col.align === 'right' ? 'right' : 'left',
                    verticalAlign: 'middle',
                    whiteSpace: 'nowrap',
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    color: '#5c6b80',
                  };

                  // `cellValue` returns a string for every value column and `null` for exactly
                  // the four that need a component (`work`, `status`, `priority`, `links`).
                  // Switching on the key rather than on `value === null` is what buys the
                  // exhaustiveness check below: a thirteenth `ColumnKey` fails the build here
                  // instead of silently rendering an em dash.
                  switch (col.key) {
                    case 'work':
                      return (
                        <td key={col.key} style={{ ...base, whiteSpace: 'normal' }}>
                          {/* Truncation lives on an inner block, not the cell: `max-width` on a
                              `<td>` under `table-layout: auto` is only a hint, on a block child
                              it is honoured. Task 22 turns this into the detail-view trigger. */}
                          <span
                            title={item.title}
                            style={{
                              display: 'block', maxWidth: '340px', overflow: 'hidden',
                              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              fontSize: '0.88rem', fontWeight: 600,
                              color: isDone ? '#9aa4b5' : '#2d3748',
                              textDecoration: isDone ? 'line-through' : 'none',
                            }}
                          >
                            {item.title}
                          </span>
                        </td>
                      );

                    case 'status':
                      // Plain text, not a pill: Task 19 replaces this with the existing status
                      // select, and a pill here would only have to be unbuilt.
                      return (
                        <td key={col.key} style={{ ...base, fontWeight: 600 }}>
                          {STAGE_LABELS[stageOf(item)]}
                        </td>
                      );

                    case 'priority':
                      return (
                        <td key={col.key} style={base}>
                          {item.priority === 'high' ? (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', borderRadius: '999px',
                              padding: '2px 9px', background: 'rgba(224,96,124,0.15)', color: '#922e48',
                              fontSize: '0.64rem', fontWeight: 700, textTransform: 'uppercase',
                              letterSpacing: '0.03em',
                            }}>
                              {PRIORITY_LABEL.high}
                            </span>
                          ) : (
                            PRIORITY_LABEL[item.priority]
                          )}
                        </td>
                      );

                    case 'links':
                      return (
                        <td key={col.key} style={base}>
                          {item.link_count > 0 ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                              <Link2 size={13} aria-hidden />
                              {item.link_count}
                            </span>
                          ) : DASH}
                        </td>
                      );

                    case 'deadline':
                      return (
                        <td key={col.key} style={{ ...base, color: DEADLINE_COLOR[dueStateOf(item, todayStr)], fontWeight: 600 }}>
                          {value ?? DASH}
                        </td>
                      );

                    case 'context':
                    case 'course':
                    case 'organization':
                    case 'area':
                    case 'project':
                    case 'time':
                    case 'estimate':
                      // `cellValue` already guarantees a non-empty string for all seven — the
                      // `?? DASH` is belt-and-braces against a future signature change, never a
                      // reachable path today.
                      return <td key={col.key} style={base}>{value ?? DASH}</td>;

                    default: {
                      const unhandled: never = col.key;
                      return <td key={unhandled} style={base}>{DASH}</td>;
                    }
                  }
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <style jsx>{`
        /* Both rules target elements rendered by *this* component, so they carry this
           component's styled-jsx scope hash — a rule for a child component's markup placed
           here would compile fine and match nothing. */
        .vb-table-row:hover {
          background: rgba(255,255,255,0.45);
        }
        .vb-table-scroll:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
