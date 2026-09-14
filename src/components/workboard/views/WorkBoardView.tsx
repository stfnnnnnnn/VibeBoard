'use client';

import { useRef, useState } from 'react';
import { LayoutGrid, SearchX } from 'lucide-react';
// Type-only imports from `workItems.ts` — that module imports `pool` (mysql2) at module
// scope for its DB-access exports, so a runtime import here would drag mysql2 into this
// client bundle (see WorkboardShell.tsx's and WorkItemRow.tsx's comments on the same hazard).
import type { WorkItem } from '@/lib/workboard/workItems';
// `setWorkStage` is the single place owned-vs-academic endpoint routing lives (Tasks 11/16) —
// imported and reused here rather than rebuilt, per this task's brief. `RowOverflowMenu` is the
// shared "more options" trigger + menu (Task 40's audit, P2-3) — this file used to carry its own
// independent `BoardCardMenu` implementation; it is now the canonical one, extracted into
// `WorkItemRow.tsx` (already this module's home for row primitives the views share) and
// imported here the same way `WorkTableView` imports `WorkTitleButton` from the same file.
import { setWorkStage, RowOverflowMenu } from '../WorkItemRow';
// The stage vocabulary. Pool-free by construction — `workContexts.ts` has no imports at all —
// so these are safe as runtime (not type-only) imports from a client component.
import {
  STAGES_BY_CONTEXT, STAGE_LABELS, isStageLegal, normaliseStage,
  type WorkContext, type WorkStage, type WorkStatus,
} from '@/lib/workboard/workContexts';
import { courseColor } from '@/lib/workboard/color';
import { dueDateOf } from '@/lib/workboard/dates';
// The single source of due-label truth. It is pool-free — it imports only `dates.ts`,
// which has no imports at all, plus a type-only `WorkItem` that erases at compile time.
import { formatDueLabel } from '@/lib/workboard/dueSemantics';

const FONT      = "'Inter','DM Sans','Segoe UI',sans-serif";
const DM_FONT   = "'DM Sans','Segoe UI',sans-serif";

const EDGE_COLOR: Record<WorkItem['priority'], string> = {
  high:   '#e0607c',
  normal: '#b8c6da',
  low:    '#d3dbe6',
};

const CATEGORY_META: Record<WorkItem['category'], { label: string; bg: string; text: string }> = {
  academic:     { label: 'Academic',     bg: 'rgba(77,171,245,0.16)',  text: '#185a7d' },
  project:      { label: 'Projects',     bg: 'rgba(139,127,214,0.16)', text: '#4f3fa0' },
  organization: { label: 'Organization', bg: 'rgba(240,163,92,0.16)',  text: '#8a5010' },
  life:         { label: 'Life',         bg: 'rgba(242,167,192,0.16)', text: '#8a4468' },
};

/** `'all'` is the shell's My Work tab — every context at once, which is exactly the case that
 *  has no single stage vocabulary to draw columns from. */
export type BoardContext = WorkContext | 'all';

/** Spec §17: My Work's columns are the three *normalised* statuses, not the union of every
 *  context's stages. Typed `WorkStatus[]` rather than `WorkStage[]` so this can only ever hold
 *  the normalised three — and assignable to `WorkStage[]` below because all three are
 *  themselves legal stages in all four contexts, which is what makes a My Work drop
 *  (`todo`/`in_progress`/`done`) incapable of producing an illegal stage for any item. */
const MY_WORK_STAGES: WorkStatus[] = ['todo', 'in_progress', 'done'];

/** A `Record<WorkStage, …>` so a stage added to `workContexts.ts` cannot reach the Board
 *  without someone deciding what its empty column says. */
const STAGE_EMPTY_TEXT: Record<WorkStage, string> = {
  backlog:         'Nothing in the backlog',
  todo:            'No work queued',
  in_progress:     'Nothing in progress',
  ready_to_submit: 'Nothing ready to submit',
  submitted:       'Nothing submitted',
  review:          'Nothing in review',
  blocked:         'Nothing blocked',
  done:            'Nothing completed yet',
};

interface BoardColumn { key: WorkStage; label: string; emptyText: string }

function buildColumns(context: BoardContext): BoardColumn[] {
  const stages: WorkStage[] = context === 'all' ? MY_WORK_STAGES : STAGES_BY_CONTEXT[context];
  return stages.map(key => ({ key, label: STAGE_LABELS[key], emptyText: STAGE_EMPTY_TEXT[key] }));
}

/** `work_stage` is typed `WorkStage` but stored in a free-form `VARCHAR(24)` — the type is a
 *  compile-time assertion over DB text, not a runtime guarantee (`workContexts.ts` says as
 *  much). Falling back to `work_status` keeps a row with an unrecognised stage visible on the
 *  board instead of silently belonging to no column at all; every `WorkStatus` is a legal
 *  stage in every context, so the fallback is always placeable. */
function stageOf(item: WorkItem): WorkStage {
  const raw: string = item.work_stage;
  return raw in STAGE_LABELS ? (raw as WorkStage) : item.work_status;
}

/** Which column a card sits in for the current column set: its own stage under a specific
 *  context, its normalised status under My Work. */
function columnKeyOf(item: WorkItem, context: BoardContext): WorkStage {
  const stage = stageOf(item);
  if (context === 'all') return normaliseStage(stage);
  // A stage outside this context's vocabulary can only come from data written before the
  // item was moved between contexts; the normalised status is always in-vocabulary.
  return isStageLegal(context, stage) ? stage : item.work_status;
}

function buildMeta(item: WorkItem, todayStr: string): { text: string | null; overdue: boolean } {
  const due = dueDateOf(item);
  // Status-aware: a card completed before its deadline reads "Completed · Sep 7",
  // never "Overdue". The old local copy keyed off the date alone.
  const dueLabel = formatDueLabel(item, todayStr);
  const estimateLabel = item.estimated_hours !== null ? `${item.estimated_hours}h` : null;
  const parts = [dueLabel, estimateLabel].filter((p): p is string => p !== null);
  const overdue = due !== null && due < todayStr && item.work_status !== 'done';
  return { text: parts.length ? parts.join(' · ') : null, overdue };
}

function itemKey(item: Pick<WorkItem, 'source' | 'id'>): string {
  return `${item.source}-${item.id}`;
}

function BoardCard({
  item, todayStr, columns, currentKey, blocked, dragging, onDragStart, onDragEnd, onMove, triggerRef,
}: {
  item: WorkItem;
  todayStr: string;
  columns: BoardColumn[];
  currentKey: WorkStage;
  /** True only in My Work, where `blocked` collapses into In Progress and would otherwise
   *  disappear; under Projects/Organization the stage has a column of its own and the badge
   *  would just repeat the heading. */
  blocked: boolean;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  /** Resolves once the move has actually landed (P1-5) — `WorkBoardView` awaits its own
   *  `moveItem` call inside this before it can safely refocus the moved item's new trigger, so
   *  this must genuinely return the promise rather than fire-and-forget it. */
  onMove: (next: WorkStage) => void | Promise<void>;
  /** Registers this card's overflow trigger into `WorkBoardView`'s board-level map, keyed by the
   *  item's stable identity — see that file's `triggerRefs` for why the ref has to live there
   *  rather than on the card: it must survive the card moving to a different column's DOM
   *  subtree, which unmounts this component and mounts a new one. */
  triggerRef: (el: HTMLButtonElement | null) => void;
}) {
  const meta = buildMeta(item, todayStr);
  const edgeColor = EDGE_COLOR[item.priority];
  const catMeta = CATEGORY_META[item.category];
  const isDone = item.work_status === 'done';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`vb-board-card${dragging ? ' dragging' : ''}`}
      style={{
        background: 'rgba(255,255,255,0.55)', borderRadius: '14px', padding: '12px 14px',
        borderTop: '1px solid rgba(255,255,255,0.4)', borderRight: '1px solid rgba(255,255,255,0.4)',
        borderBottom: '1px solid rgba(255,255,255,0.4)', borderLeft: `3px solid ${edgeColor}`,
        marginBottom: '10px', cursor: 'grab', position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
        <span
          title={item.title}
          style={{
            flex: '1 1 auto', minWidth: 0, fontFamily: FONT, fontSize: '0.88rem', fontWeight: 600,
            color: isDone ? '#9aa4b5' : '#2d3748', textDecoration: isDone ? 'line-through' : 'none',
            overflowWrap: 'break-word',
          }}
        >
          {item.title}
        </span>
        {/* The keyboard-guaranteed "Move to" path required alongside drag (`dragging-alternative`,
            WCAG 2.2 AA) — deliberately the *same* `setWorkStage` call the drop handler makes
            rather than a reduced fallback. It lists every column of the current set except the
            one the card is already in: two entries under My Work, four under Academic, five
            under Projects. */}
        <RowOverflowMenu
          triggerAriaLabel={`More options for "${item.title}"`}
          menuAriaLabel="Move to"
          items={columns.filter(c => c.key !== currentKey).map(col => ({
            key: col.key,
            label: col.label,
            onClick: () => onMove(col.key),
          }))}
          triggerRef={triggerRef}
        />
      </div>

      {(item.priority === 'high' || blocked) && (
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
        {item.priority === 'high' && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '2px 9px',
            background: 'rgba(224,96,124,0.15)', color: '#922e48', fontFamily: FONT, fontSize: '0.64rem',
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: '6px',
          }}>
            High
          </span>
        )}
        {blocked && (
          // §2a's darkened amber on its own tint — the only AA-passing amber text colour in
          // this system. Deliberately not the overdue alert red, which means "past its
          // deadline"; blocked is held, not late, and the two can be true at once.
          <span style={{
            display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '2px 9px',
            background: 'rgba(240,163,92,0.16)', color: '#8a5010', fontFamily: FONT, fontSize: '0.64rem',
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: '6px',
          }}>
            Blocked
          </span>
        )}
      </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '3px 10px',
          background: catMeta.bg, color: catMeta.text, fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700,
          textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>
          {catMeta.label}
        </span>
        {item.chip_label && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '6px',
            padding: '2px 8px 2px 6px', background: 'rgba(255,255,255,0.55)',
            border: '1px solid rgba(200,210,230,0.4)', fontFamily: FONT, fontSize: '0.68rem',
            fontWeight: 500, color: '#5c6b80', whiteSpace: 'nowrap',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: courseColor(item.chip_label), flexShrink: 0 }} />
            {item.chip_label}
          </span>
        )}
      </div>

      {meta.text && (
        <div style={{ marginTop: '6px', fontFamily: FONT, fontSize: '0.76rem', fontWeight: 500, color: meta.overdue ? '#922e48' : '#5c6b80' }}>
          {meta.text}
        </div>
      )}
    </div>
  );
}

export interface WorkBoardViewProps {
  /** Already filtered by category and search — see `WorkboardShell`'s `visibleItems`. */
  items:      WorkItem[];
  /** The shell's active context tab, `'all'` for My Work — the same value the Table view is
   *  given in Task 18, which is the task that owns the shell edit wiring `category` through.
   *  Optional and defaulting to `'all'` because the shell does not pass it yet and this task's
   *  scope is these two files: the default reproduces today's three-column behaviour exactly,
   *  and the per-context columns light up the moment the prop is supplied. */
  context?:   BoardContext;
  /** "YYYY-MM-DD" — `work.generated_at`, so cards agree with List on what "today" is. */
  todayStr:   string;
  /** True when the shell's category tab or search query is currently narrowing `items` —
   *  same distinction `WorkListView` makes, so a filtered-to-nothing board reads as "no
   *  matches" rather than "you have no work at all". */
  isFiltered?: boolean;
  onChanged:  () => void | Promise<void>;
  /** Opens the create/edit dialog in create mode — wired to this view's own empty-state button. */
  onNewItem:  () => void;
}

export default function WorkBoardView({ items, context = 'all', todayStr, isFiltered, onChanged, onNewItem }: WorkBoardViewProps) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<WorkStage | null>(null);

  /** Each rendered card's overflow-trigger button, keyed by `itemKey(item)` rather than by
   *  column — held at this top level, not inside `BoardCard`, specifically so it survives a
   *  card moving to a different column's DOM subtree (P1-5). A move re-parents the card: React
   *  unmounts the `BoardCard` under its old column and mounts a new one under the destination
   *  column, so any ref `BoardCard` held itself would be destroyed along with the old trigger.
   *  Keying by the item's stable identity (not the column) means the same map entry is simply
   *  overwritten by the new instance's own ref callback once it mounts.
   *
   *  A plain mutable `Map` in a ref, not state — this is DOM bookkeeping for imperative focus
   *  management, not a value the render output depends on, so it must not trigger a re-render
   *  when it changes. */
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  function registerTrigger(key: string, el: HTMLButtonElement | null) {
    if (el) triggerRefs.current.set(key, el);
    else triggerRefs.current.delete(key);
  }

  /** Focuses whichever trigger button is *currently* registered under `key` — called only after
   *  a move has resolved and the board has re-rendered, so this reads the moved item's NEW
   *  trigger (in its new column), never the stale one that was already destroyed by then. */
  function focusTrigger(key: string) {
    triggerRefs.current.get(key)?.focus();
  }

  const columns = buildColumns(context);

  const handleDragStart = (e: React.DragEvent, item: WorkItem) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ source: item.source, id: item.id }));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingKey(itemKey(item));
  };

  const handleDragEnd = () => {
    setDraggingKey(null);
    setDragOverCol(null);
  };

  /** The single move path — both the drop handler and the card's "Move to" menu land here, so
   *  the keyboard route is the drag route rather than an approximation of it. Never sends
   *  `work_status`: the endpoints derive it from the stage.
   *
   *  Its returned promise must resolve only once the board has actually finished refreshing
   *  (P1-5): the menu's `onMove` call above awaits this specific promise before refocusing the
   *  moved item's new trigger, so if this function ever stopped awaiting `onChanged()` — or a
   *  future caller wrapped it in something that swallowed the promise, as `BoardCard`'s old
   *  `onMove={next => moveItem(item, next)}` typing silently allowed — that refocus would fire
   *  before the move had actually landed and target a trigger that either doesn't exist yet or
   *  is about to be torn down. */
  const moveItem = async (item: WorkItem, next: WorkStage) => {
    if (columnKeyOf(item, context) === next) return;
    const res = await setWorkStage(item, next);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(body?.error ?? 'Failed to move item');
      return;
    }
    await onChanged();
  };

  const handleDrop = async (e: React.DragEvent, next: WorkStage) => {
    e.preventDefault();
    setDragOverCol(null);
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    let parsed: { source: WorkItem['source']; id: number };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const item = items.find(i => i.source === parsed.source && i.id === parsed.id);
    if (!item) return;
    await moveItem(item, next);
  };

  if (items.length === 0 && isFiltered) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <SearchX size={48} color="#9aa4b5" style={{ marginBottom: '14px' }} />
        <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
          No matching work items
        </h2>
        <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: 0 }}>
          Try a different category, search term, or filter.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <LayoutGrid size={56} color="#9aa4b5" style={{ marginBottom: '14px' }} />
        <h2 style={{ fontFamily: DM_FONT, fontSize: '1.05rem', fontWeight: 700, color: '#2d3748', margin: '0 0 6px' }}>
          Board&apos;s empty
        </h2>
        <p style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 500, color: '#5c6b80', margin: '0 0 18px' }}>
          Work items you create will show up here as cards.
        </p>
        <button type="button" className="vb-btn-pink" onClick={onNewItem} style={{ width: 'auto', padding: '10px 22px' }}>
          New Work Item
        </button>
      </div>
    );
  }

  return (
    <div className="vb-board" style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: '4px' }}>
      {columns.map(col => {
        const colItems = items.filter(i => columnKeyOf(i, context) === col.key);
        const isOver = dragOverCol === col.key;
        return (
          <div
            key={col.key}
            className={`vb-board-col${isOver ? ' drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); if (dragOverCol !== col.key) setDragOverCol(col.key); }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(cur => (cur === col.key ? null : cur));
            }}
            onDrop={e => handleDrop(e, col.key)}
            style={{
              background: 'rgba(255,255,255,0.18)', borderRadius: '18px', padding: '14px 10px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              paddingBottom: '10px', marginBottom: '10px', borderBottom: '1px solid rgba(200,210,230,0.35)',
            }}>
              <span style={{ fontFamily: DM_FONT, fontSize: '0.95rem', fontWeight: 800, color: '#2d3748' }}>
                {col.label}
              </span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '2px 9px',
                background: 'rgba(255,255,255,0.5)', color: '#5c6b80', fontFamily: FONT, fontSize: '0.7rem', fontWeight: 700,
              }}>
                {colItems.length}
              </span>
            </div>

            {colItems.length === 0 ? (
              <div style={{
                border: '1.5px dashed rgba(180,190,210,0.5)', borderRadius: '14px', minHeight: '120px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                color: '#8a94a6', fontFamily: FONT, fontSize: '0.8rem', fontWeight: 600, padding: '12px',
              }}>
                {col.emptyText}
              </div>
            ) : (
              colItems.map(item => (
                <BoardCard
                  key={itemKey(item)}
                  item={item}
                  todayStr={todayStr}
                  columns={columns}
                  currentKey={col.key}
                  blocked={context === 'all' && stageOf(item) === 'blocked'}
                  dragging={draggingKey === itemKey(item)}
                  onDragStart={e => handleDragStart(e, item)}
                  onDragEnd={handleDragEnd}
                  // Awaited, not fire-and-forgot (P1-5): the menu's item `onClick` (inside
                  // `RowOverflowMenu`) calls this and does nothing further with it, so the
                  // refocus-after-move below only runs once `moveItem` itself — the network
                  // round trip plus `onChanged`'s refresh — has actually settled. Only then is
                  // the board re-rendered with this item under its new column, so only then can
                  // `focusTrigger` find the NEW trigger rather than the one that is about to be
                  // (or already was) unmounted. The `requestAnimationFrame` gives React's commit
                  // for that re-render a chance to land — and `registerTrigger`'s own ref
                  // callback to fire — before the lookup, rather than assuming the state update
                  // inside `onChanged` has already flushed to the DOM by the time this `await`
                  // resumes.
                  onMove={async next => {
                    await moveItem(item, next);
                    requestAnimationFrame(() => focusTrigger(itemKey(item)));
                  }}
                  triggerRef={el => registerTrigger(itemKey(item), el)}
                />
              ))
            )}
          </div>
        );
      })}

      <style jsx>{`
        /* flex/min-width live here rather than in the column's inline style so this media
           query can actually override them below 768px — an inline declaration always beats a
           plain class rule regardless of the media query, per ordinary CSS specificity, and
           this file previously set flex/minWidth inline while trying to override them here,
           which meant the mobile snap-scroll rule below was silently dead. */
        .vb-board-col {
          flex: 1 1 260px;
          min-width: 260px;
        }
        .vb-board-col.drag-over {
          background: rgba(116,188,217,0.14);
          outline: 1.5px dashed rgba(116,188,217,0.6);
          outline-offset: -1.5px;
        }
        @media (max-width: 767px) {
          .vb-board {
            scroll-snap-type: x mandatory;
          }
          .vb-board-col {
            flex: 0 0 85vw;
            min-width: 0;
            scroll-snap-align: start;
          }
        }
      `}</style>

      <style jsx global>{`
        .vb-board-card {
          transition: box-shadow 120ms ease, opacity 120ms ease;
        }
        .vb-board-card.dragging {
          box-shadow: 0 10px 24px rgba(31,38,68,0.18);
          opacity: 0.9;
          transform: rotate(-1deg);
          cursor: grabbing;
        }
        @media (prefers-reduced-motion: reduce) {
          .vb-board-card.dragging {
            transform: none;
          }
          .vb-board-card {
            transition: none;
          }
        }
        /* The card's overflow trigger and its menu items are RowOverflowMenu (from
           WorkItemRow.tsx) now, not a local BoardCardMenu -- their hover/focus-visible rules
           moved with it into that component's own scoped style-jsx block, which is also what
           actually fixes P2-1's .vb-board-overflow:hover / .vb-board-menu-item:hover (both
           were previously beaten by an inline background: transparent on the same elements;
           the new component simply does not set that inline value -- see its own comments). */
      `}</style>
    </div>
  );
}
