'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, SearchX, Link2, AlertTriangle, CheckCircle2, Hourglass, ArrowUp, Check } from 'lucide-react';
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
import { offerStageUndo, reportStageFailure, waitingPrompt } from '../stageChange';
import WbQuickAdd from '../ui/WbQuickAdd';
import WbBulkBar, { type BulkStatusOption } from '../ui/WbBulkBar';
import WaitingPopover from '../ui/WaitingPopover';
import { useSelection } from '../ui/useSelection';
import type { useBulkActions } from '../useBulkActions';
import { contextChip } from './FocusRow';
// The stage vocabulary. Pool-free by construction — `workContexts.ts` has no imports at all —
// so these are safe as runtime (not type-only) imports from a client component.
import {
  STAGES_BY_CONTEXT, STAGE_LABELS, CONTEXT_LABELS, isStageLegal, isWaitingStage, normaliseStage,
  waitingLabel, type WorkContext, type WorkStage, type WorkStatus,
} from '@/lib/workboard/workContexts';
// The single source of due-label/state truth. Both are pool-free — they import only
// `dates.ts`, which has no imports at all, plus a type-only `WorkItem` that erases at compile
// time.
import { dueStateOf, formatDueLabel, formatDeadlineTime } from '@/lib/workboard/dueSemantics';
import { DUE_COLOR } from '@/lib/workboard/ui/dueColors';
import { daysSince } from '@/lib/workboard/dates';
import { itemKey } from '@/lib/workboard/ui/itemKey';
import { DUR } from '@/lib/workboard/ui/tokens';
import { shortCourseCode } from '@/lib/workboard/ui/courseCode';
// A lane's status colour: the same mapping as the Table's status pill.
import { statusDot } from '@/lib/workboard/ui/statusDot';
import type { CourseOption } from '@/lib/workboard/ui/quickAdd';

/** Lane width floor and gap (refine spec §7); also the overflow test in `WorkBoardView`. */
const LANE_MIN = 280;
const LANE_GAP = 16;
/** Card bottom margin, which the drop gap has to include. */
const CARD_GAP = 10;

/** `'all'` is the shell's My Work tab — every context at once, which is exactly the case that
 *  has no single stage vocabulary to draw columns from. */
export type BoardContext = WorkContext | 'all';

/** Spec §17: My Work's columns are the three *normalised* statuses, not the union of every
 *  context's stages. Typed `WorkStatus[]` rather than `WorkStage[]` so this can only ever hold
 *  the normalised three — and assignable to `WorkStage[]` below because all three are
 *  themselves legal stages in all four contexts, which is what makes a My Work drop
 *  (`todo`/`in_progress`/`done`) incapable of producing an illegal stage for any item. */
const MY_WORK_STAGES: WorkStatus[] = ['todo', 'in_progress', 'done'];

/** "To Do" -> "To do" for the lane header (spec §7); menus keep the stage labels as they are. */
function sentenceCase(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

interface BoardColumn { key: WorkStage; label: string }

function buildColumns(context: BoardContext): BoardColumn[] {
  const stages: WorkStage[] = context === 'all' ? MY_WORK_STAGES : STAGES_BY_CONTEXT[context];
  return stages.map(key => ({ key, label: STAGE_LABELS[key] }));
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

/** Card anatomy (§10 review): every card gets the same rows in the same order regardless of
 *  which fields it happens to carry — a due line (icon only for overdue, per §6's restrained
 *  alert language) and, separately, an estimate line. Status-aware: a card completed before its
 *  deadline reads "Completed · Sep 7", never "Overdue". */
function buildMeta(item: WorkItem, todayStr: string): {
  dueText: string | null; dueColor: string; isOverdue: boolean; estimateText: string | null;
} {
  const dueLabel = formatDueLabel(item, todayStr);
  const timeLabel = formatDeadlineTime(item);
  const state = dueStateOf(item, todayStr);
  return {
    dueText: dueLabel ? (timeLabel !== '—' ? `${dueLabel} · ${timeLabel}` : dueLabel) : null,
    dueColor: DUE_COLOR[state],
    isOverdue: state === 'overdue',
    estimateText: item.estimated_hours !== null ? `~${item.estimated_hours}h` : null,
  };
}

function BoardCard({
  item, todayStr, columns, currentKey, dragging, shifted, settling, selected, onToggleSelect,
  onDragStart, onDragEnd, onMove, triggerRef,
}: {
  item: WorkItem;
  todayStr: string;
  columns: BoardColumn[];
  currentKey: WorkStage;
  dragging: boolean;
  /** Sits at or below the drop point of the column being dragged over: slides down to open the gap. */
  shifted: boolean;
  /** Just dropped: plays the settle. */
  settling: boolean;
  selected: boolean;
  onToggleSelect: () => void;
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
  const chip = contextChip(item);
  const ctxLabel = CONTEXT_LABELS[item.context];
  const ctxTitle = item.course_code ? chip.label : chip.label !== ctxLabel ? `${ctxLabel} · ${chip.label}` : ctxLabel;
  const isDone = item.work_status === 'done';
  const pillLabel = item.course_code ? shortCourseCode(item.course_code) : chip.label;
  const subtaskPct = item.subtask_total > 0 ? Math.round((item.subtask_done / item.subtask_total) * 100) : 0;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // Shift-click toggles this card only: a range across columns has no clear order.
      onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }}
      onClickCapture={e => {
        if (!e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        onToggleSelect();
      }}
      className={`vb-board-card wb-glass-item wb-glass-item--hoverable wb-card-motion${selected ? ' is-board-selected' : ''}`}
      data-dragging={dragging ? 'true' : undefined}
      data-shift={shifted ? 'down' : undefined}
      data-settle={settling ? 'true' : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
        <span
          title={item.title}
          style={{
            flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: '5px',
            font: '650 var(--wb-fs-14)/1.35 var(--wb-font-ui)',
            color: isDone ? 'var(--wb-text-muted)' : 'var(--wb-text)', overflowWrap: 'anywhere',
          }}
        >
          {/* A second, non-colour signal alongside the strikethrough (never colour or
              text-decoration alone). */}
          {isDone && <CheckCircle2 size={14} aria-hidden style={{ flexShrink: 0, marginTop: '3px', color: 'var(--wb-success-fill)' }} />}
          {/* `anywhere` (not break-word) lowers min-content, so an unbroken filename wraps
              instead of running under the menu; 3 lines max, full title in the parent's `title`. */}
          <span
            style={{
              minWidth: 0, overflowWrap: 'anywhere', textDecoration: isDone ? 'line-through' : 'none',
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}
          >
            {item.title}
          </span>
          {selected && <span className="wb-sr-only"> (selected)</span>}
        </span>
        {/* The keyboard-guaranteed "Move to" path required alongside drag (`dragging-alternative`,
            WCAG 2.2 AA) — the same move path the drop handler uses. It lists every column of the
            current set except the one the card is already in. */}
        {/* The 32px trigger keeps its hit area but takes only the title line's height in
            layout, so a one-line title has no blank row under it. Hidden by opacity only on
            fine pointers (see the styles below), so it stays a Tab stop. */}
        <div className="vb-board-card__menu" style={{ flexShrink: 0, margin: '-6px -7px -8px 0' }}>
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
      </div>

      {/* Spec §7 meta row: the context always exists, so the row always renders. A course shows
          its short code (full code in `title`); otherwise the project, org or context name. */}
      <div className="vb-board-card__meta">
        <span className="wb-gpill vb-board-card__ctx" style={{ padding: '2px 9px 2px 7px' }} title={ctxTitle}>
          <span aria-hidden className="wb-gdot" style={{ '--dot': chip.fill } as React.CSSProperties} />
          <span className="vb-board-card__ctx-label">{pillLabel}</span>
        </span>

        {/* R1: the priority stripe's replacement. Text in --wb-pink-ink: --wb-priority-high is
            only 3.3:1 on the card (pink-ink is 5.5:1); the icon keeps the priority colour. */}
        {item.priority === 'high' && (
          <span className="wb-gpill vb-board-card__high" style={{ padding: '2px 9px 2px 7px' }}>
            <ArrowUp size={12} aria-hidden style={{ flexShrink: 0, color: 'var(--wb-priority-high)' }} />
            High<span className="wb-sr-only"> priority</span>
          </span>
        )}

        {meta.dueText && (
          <span
            className={`vb-board-card__tag${meta.isOverdue ? ' vb-board-card__tag--overdue' : ''}`}
            style={meta.isOverdue ? undefined : { color: meta.dueColor }}
          >
            {meta.isOverdue && <AlertTriangle size={12} aria-hidden style={{ flexShrink: 0 }} />}
            <span>{meta.dueText}</span>
          </span>
        )}

        {item.link_count > 0 && (
          <span className="vb-board-card__tag">
            <Link2 size={12} aria-hidden />
            {item.link_count}
            <span className="wb-sr-only"> link{item.link_count === 1 ? '' : 's'}</span>
          </span>
        )}

        {meta.estimateText && <span className="vb-board-card__est">{meta.estimateText}</span>}

        {/* §18: "Waiting" — driven by `blocked_since` directly, so it shows everywhere a card can
            appear. Warn on its own tint, deliberately not the overdue red: held is not late. */}
        {item.blocked_since !== null && (
          <span className="vb-board-card__waiting">
            <Hourglass size={12} aria-hidden style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {waitingLabel(item.work_stage, item.blocked_reason)}
              {' · '}{daysSince(item.blocked_since, todayStr)}d
            </span>
          </span>
        )}
      </div>

      {item.subtask_total > 0 && (
        <div
          className="vb-board-card__prog"
          role="img"
          aria-label={`${item.subtask_done} of ${item.subtask_total} subtasks done`}
        >
          <span style={{ width: `${subtaskPct}%` }} />
        </div>
      )}

      {/* Scoped to this component: every styled element above is written in this JSX tree.
          The menu trigger is RowOverflowMenu's own element, hence :global. */}
      <style jsx>{`
        .vb-board-card {
          /* margin-bottom is CARD_GAP. */
          position: relative; margin-bottom: 10px; padding: 13px 14px; cursor: grab;
          border-radius: 16px;
          /* The hover lift's timing (.wb-glass-item--hoverable), which .wb-card-motion would
             otherwise override. The drop-gap shift keeps card-motion's timing below. */
          transition: transform var(--wb-dur-fast) var(--wb-ease);
        }
        .vb-board-card[data-shift='down'] { transition: transform var(--wb-dur) var(--wb-ease-in-out); }
        .vb-board-card[data-dragging='true'] {
          cursor: grabbing;
          transform: translateY(-2px) rotate(-0.4deg);
          box-shadow: var(--wb-glass-item-shadow-hover);
          transition: transform var(--wb-dur-fast) var(--wb-ease);
        }
        .vb-board-card.is-board-selected {
          box-shadow: 0 0 0 2px var(--wb-blue-strong), var(--wb-glass-item-shadow);
        }
        /* An open menu must sit above the next card, which a hover lift would otherwise paint over. */
        .vb-board-card:focus-within { z-index: 2; }
        .vb-board-card__meta {
          display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px;
        }
        .vb-board-card__ctx { max-width: 100%; min-width: 0; box-sizing: border-box; }
        .vb-board-card__ctx-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .vb-board-card__high { color: var(--wb-pink-ink); gap: 4px; }
        .vb-board-card__tag {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 9px; border-radius: 8px; background: rgba(255, 255, 255, 0.55);
          font: 650 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted);
        }
        .vb-board-card__tag--overdue { background: rgba(232, 85, 143, 0.14); color: var(--wb-danger); }
        .vb-board-card__est { font: 600 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted); }
        .vb-board-card__waiting {
          display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0; box-sizing: border-box;
          padding: 2px 6px; border-radius: var(--wb-r-sm); background: var(--wb-warn-bg); color: var(--wb-warn);
          font: 600 var(--wb-fs-12) var(--wb-font-ui);
        }
        .vb-board-card__prog {
          height: 4px; border-radius: 2px; margin-top: 12px; overflow: hidden;
          background: rgba(93, 104, 128, 0.12);
        }
        .vb-board-card__prog span {
          display: block; height: 100%; border-radius: 2px;
          background: linear-gradient(90deg, var(--wb-blue), var(--wb-pink-strong));
        }
        /* Fine pointers: the menu fades in on hover or focus. Opacity only, so it stays reachable
           by keyboard; touch always shows it. */
        @media (hover: hover) and (pointer: fine) {
          .vb-board-card__menu :global(.vb-row-overflow) {
            opacity: 0; transition: opacity var(--wb-dur-fast) var(--wb-ease);
          }
          .vb-board-card:hover .vb-board-card__menu :global(.vb-row-overflow),
          .vb-board-card:focus-within .vb-board-card__menu :global(.vb-row-overflow),
          .vb-board-card__menu :global(.vb-row-overflow[aria-expanded='true']) { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vb-board-card, .vb-board-card[data-shift='down'] { transition: none; }
          .vb-board-card[data-dragging='true'] { transform: none; transition: none; }
        }
      `}</style>
    </div>
  );
}

export interface WorkBoardViewProps {
  /** Already filtered by category and search — see `WorkboardShell`'s `visibleItems`. */
  items:      WorkItem[];
  /** The shell's active context tab, `'all'` for My Work. Optional and defaulting to `'all'`,
   *  which reproduces My Work's three columns. */
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
  /** The shell's context tab, for each column's quick add. */
  filter:     WorkContext | 'all';
  /** Whole-board course list for the quick adds' course picker. */
  courses:    CourseOption[];
  /** The shell's one bulk-actions instance (spec §12). */
  bulk:          ReturnType<typeof useBulkActions>;
  /** The bulk bar's Status menu: this context's stages, or the three statuses under My Work. */
  statusOptions: BulkStatusOption[];
  /** Reports the selection size up so the shell can lift the toaster above the bulk bar. */
  onSelectionCount: (n: number) => void;
}

export default function WorkBoardView({
  items, context = 'all', todayStr, isFiltered, onChanged, onNewItem, filter, courses,
  bulk, statusOptions, onSelectionCount,
}: WorkBoardViewProps) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  /** The column a drag came from: it shows no gap, since dropping back is a no-op. */
  const [dragFromCol, setDragFromCol] = useState<WorkStage | null>(null);
  /** Captured at drag start; the gap opens by this much (plus the card margin). */
  const [dragHeight, setDragHeight] = useState(0);
  const [dropTarget, setDropTarget] = useState<{ column: WorkStage; index: number } | null>(null);
  /** The card that just landed from a drag; it plays the settle for `DUR.base`. */
  const [settle, setSettle] = useState<{ key: string; column: WorkStage } | null>(null);
  const settleTimer = useRef<number | null>(null);
  /** Which column's quick add is open, keyed by column key. */
  const [addingTo, setAddingTo] = useState<string | null>(null);
  /** A move into a waiting stage (`blocked`/`submitted`) waiting on its reason (spec 10.3). */
  const [waiting, setWaiting] = useState<{
    item: WorkItem; next: WorkStage; anchor: HTMLElement | null; fromDrag: boolean;
  } | null>(null);

  /** Each rendered card's overflow-trigger button, keyed by `itemKey(item)` rather than by
   *  column — held at this top level, not inside `BoardCard`, specifically so it survives a
   *  card moving to a different column's DOM subtree (P1-5). A move re-parents the card: React
   *  unmounts the `BoardCard` under its old column and mounts a new one under the destination
   *  column, so any ref `BoardCard` held itself would be destroyed along with the old trigger.
   *
   *  A plain mutable `Map` in a ref, not state — DOM bookkeeping for imperative focus
   *  management, not a value the render output depends on. */
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  /** One column container per `WorkStage` — the fallback focus target for `focusTrigger` when
   *  the moved item has no new trigger to find (see below). */
  const columnRefs = useRef<Map<WorkStage, HTMLDivElement>>(new Map());

  function registerTrigger(key: string, el: HTMLButtonElement | null) {
    if (el) triggerRefs.current.set(key, el);
    else triggerRefs.current.delete(key);
  }

  function registerColumn(key: WorkStage, el: HTMLDivElement | null) {
    if (el) columnRefs.current.set(key, el);
    else columnRefs.current.delete(key);
  }

  /** Each column's quick-add opener: "+ Add", or the dashed empty box when the column is empty
   *  (only one exists at a time). */
  const addTriggerRefs = useRef<Map<WorkStage, HTMLButtonElement>>(new Map());
  function registerAddTrigger(key: WorkStage, el: HTMLButtonElement | null) {
    if (el) addTriggerRefs.current.set(key, el);
    else addTriggerRefs.current.delete(key);
  }
  /** Each column's add area (the quick-add row while it is open). */
  const addAreaRefs = useRef<Map<WorkStage, HTMLDivElement>>(new Map());
  function registerAddArea(key: WorkStage, el: HTMLDivElement | null) {
    if (el) addAreaRefs.current.set(key, el);
    else addAreaRefs.current.delete(key);
  }
  /** After a quick add closes, return focus to its opener — only when focus was dropped (body)
   *  or is still inside the closing row, never when the user moved it to another control. */
  function refocusAddTrigger(key: WorkStage) {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const area = addAreaRefs.current.get(key);
      if (active && active !== document.body && !(area && area.contains(active))) return;
      addTriggerRefs.current.get(key)?.focus({ preventScroll: true });
    });
  }

  /** Focuses whichever trigger button is *currently* registered under `key` — called only after
   *  a move has resolved and the board has re-rendered, so this reads the moved item's NEW
   *  trigger. `fallbackColumnKey` covers a move that pushes the item out of an active filter:
   *  it never remounts, so the destination column's own container (`tabIndex={-1}`) is focused
   *  instead of letting focus fall to `<body>`. */
  function focusTrigger(key: string, fallbackColumnKey: WorkStage) {
    const trigger = triggerRefs.current.get(key);
    if (trigger) { trigger.focus(); return; }
    columnRefs.current.get(fallbackColumnKey)?.focus();
  }

  const columns = useMemo(() => buildColumns(context), [context]);

  /** Spec §7: the board scrolls sideways only when the lanes cannot all fit at their 280px
   *  floor. A scroller clips the lanes' shadows and the cards' open menus, so it is opt-in. */
  const [boardEl, setBoardEl] = useState<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  // Layout effect: decided before paint, so a tablet never scrolls the page for one frame.
  useLayoutEffect(() => {
    if (!boardEl) return;
    const n = columns.length;
    const check = () => setOverflowing(boardEl.clientWidth < n * LANE_MIN + (n - 1) * LANE_GAP);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(boardEl);
    return () => ro.disconnect();
  }, [boardEl, columns.length]);

  const itemsByColumn = useMemo(() => {
    const by = new Map<WorkStage, WorkItem[]>(columns.map(c => [c.key, []]));
    for (const item of items) by.get(columnKeyOf(item, context))?.push(item);
    return by;
  }, [columns, items, context]);

  // Spec §12: shift-click selection feeding the same bulk bar as Table.
  const orderedKeys = useMemo(
    () => columns.flatMap(c => (itemsByColumn.get(c.key) ?? []).map(itemKey)),
    [columns, itemsByColumn],
  );
  const selection = useSelection(orderedKeys);
  useEffect(() => { onSelectionCount(selection.count); }, [selection.count, onSelectionCount]);
  useEffect(() => () => onSelectionCount(0), [onSelectionCount]);
  // Switching context clears the selection (a view switch unmounts the view, which clears it too).
  useEffect(() => { selection.clear(); }, [context]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedItems = items.filter(i => selection.isSelected(itemKey(i)));

  useEffect(() => () => { if (settleTimer.current !== null) window.clearTimeout(settleTimer.current); }, []);

  const clearDrag = () => {
    setDraggingKey(null);
    setDragFromCol(null);
    setDropTarget(null);
  };

  const handleDragStart = (e: React.DragEvent, item: WorkItem) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ source: item.source, id: item.id }));
    e.dataTransfer.effectAllowed = 'move';
    setDragHeight(e.currentTarget.getBoundingClientRect().height);
    setDraggingKey(itemKey(item));
    setDragFromCol(columnKeyOf(item, context));
  };

  /** Drop index = the first card whose (untransformed) midpoint sits below the pointer. Layout
   *  offsets, not getBoundingClientRect, so cards already sliding down for the gap do not move
   *  the target under the pointer and make it flicker. */
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, column: WorkStage) => {
    e.preventDefault();
    const col = e.currentTarget;
    const y = e.clientY - col.getBoundingClientRect().top - col.clientTop;
    const cards = Array.from(col.querySelectorAll<HTMLElement>(':scope > .vb-board-card'));
    let index = cards.findIndex(c => c.offsetTop + c.offsetHeight / 2 > y);
    if (index < 0) index = cards.length;
    setDropTarget(cur => (cur && cur.column === column && cur.index === index ? cur : { column, index }));
  };

  /** Drag drops only: keyboard moves through "Move to" never settle. Set before the refresh so
   *  the card mounts in its new column already settling; cleared `DUR.base` after it lands. */
  const startSettle = (key: string, column: WorkStage) => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = null;
    setSettle({ key, column });
  };
  const endSettle = (key: string) => {
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      setSettle(cur => (cur?.key === key ? null : cur));
    }, DUR.base);
  };

  /** Writes the move, refreshes, and offers Undo. Resolves once the board has re-rendered
   *  (P1-5), true when the move landed. */
  const commitMove = async (
    item: WorkItem, next: WorkStage, reason?: string | null, doSettle = false,
  ): Promise<boolean> => {
    const key = itemKey(item);
    const prev = stageOf(item);
    const prevReason = item.blocked_reason;
    const res = await setWorkStage(item, next, reason).catch(() => null);
    if (!res || !res.ok) {
      // A 4xx (e.g. 409 on a graded academic entry) shows the server's reason with no Retry.
      await reportStageFailure(res, {
        fallback: `Couldn't move "${item.title}"`,
        retry: () => { void commitMove(item, next, reason); },
      });
      return false;
    }
    if (doSettle) startSettle(key, next);
    try {
      await onChanged();
    } finally {
      if (doSettle) endSettle(key);
    }
    offerStageUndo(item, prev, prevReason, next, onChanged);
    return true;
  };

  /** The single move path — both the drop handler and the card's "Move to" menu land here, so
   *  the keyboard route is the drag route rather than an approximation of it. Never sends
   *  `work_status`: the endpoints derive it from the stage.
   *
   *  A move into a waiting stage asks for its reason first (§18) through the inline popover;
   *  it resolves false at once, and the popover's own confirm commits and refocuses. */
  const moveItem = async (item: WorkItem, next: WorkStage, fromDrag = false): Promise<boolean> => {
    if (columnKeyOf(item, context) === next) return false;
    // Waiting stages ask: the server stores `blocked_reason` (for `submitted`, the revision
    // note) only for `WAITING_STAGES`.
    if (isWaitingStage(next)) {
      const key = itemKey(item);
      const anchor = triggerRefs.current.get(key) ?? columnRefs.current.get(columnKeyOf(item, context)) ?? null;
      setWaiting({ item, next, anchor, fromDrag });
      return false;
    }
    return commitMove(item, next, undefined, fromDrag);
  };

  const handleDrop = async (e: React.DragEvent, next: WorkStage) => {
    e.preventDefault();
    setDropTarget(null);
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
    await moveItem(item, next, true);
  };

  if (items.length === 0 && isFiltered) {
    return (
      // The Board has no outer panel (its lanes are the panels), so the empty states bring
      // their own: muted text is under 4.5:1 on the bare background.
      <div className="wb-glass-panel" style={EMPTY_STATE}>
        <SearchX size={48} aria-hidden style={{ marginBottom: '14px', color: 'var(--wb-text-faint)' }} />
        <h2 style={EMPTY_TITLE}>No matching work items</h2>
        <p style={EMPTY_BODY}>Try a different category, search term, or filter.</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="wb-glass-panel" style={EMPTY_STATE}>
        <LayoutGrid size={56} aria-hidden style={{ marginBottom: '14px', color: 'var(--wb-text-faint)' }} />
        <h2 style={EMPTY_TITLE}>Board&apos;s empty</h2>
        <p style={{ ...EMPTY_BODY, margin: '0 0 18px' }}>
          Work items you create will show up here as cards.
        </p>
        <button type="button" className="vb-btn-pink" onClick={onNewItem} style={{ width: 'auto', padding: '10px 22px' }}>
          New item
        </button>
      </div>
    );
  }

  return (
    <div
      ref={setBoardEl}
      className="vb-board"
      data-overflow={overflowing ? 'true' : undefined}
      style={{ '--lanes': columns.length } as React.CSSProperties}
    >
      {columns.map(col => {
        const colItems = itemsByColumn.get(col.key) ?? [];
        const isOver = dropTarget?.column === col.key;
        // The gap opens only among a destination column's cards, for a card dragged from this board.
        const gapAt = isOver && draggingKey !== null && dragFromCol !== col.key && colItems.length > 0 ? dropTarget.index : null;
        const lane = statusDot(col.key);
        const overdueCount = colItems.filter(i => dueStateOf(i, todayStr) === 'overdue').length;
        const canAdd = col.key !== 'done';
        const headLabel = sentenceCase(col.label);
        return (
          <div
            key={col.key}
            ref={el => registerColumn(col.key, el)}
            // -1: an imperative focus target only, for `focusTrigger`'s fallback — never a
            // natural Tab stop.
            tabIndex={-1}
            className={`vb-board-col wb-glass-panel${isOver ? ' drag-over' : ''}`}
            onDragOver={e => handleDragOver(e, col.key)}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(cur => (cur?.column === col.key ? null : cur));
            }}
            onDrop={e => handleDrop(e, col.key)}
            style={{
              '--lane': lane.color,
              '--wb-drop-gap': `${dragHeight + CARD_GAP}px`,
            } as React.CSSProperties}
          >
            {/* Spec §7: the status-colour wash replaces the old 3px top bar. */}
            <span aria-hidden className="vb-lane-wash" />
            <div className="vb-board-col__head">
              <span
                aria-hidden
                className={lane.flat ? 'wb-gdot wb-gdot--flat' : 'wb-gdot'}
                style={{ '--dot': lane.color } as React.CSSProperties}
              />
              <span className="vb-board-col__label">{headLabel}</span>
              {/* A column can hold several overdue cards whose own red text is easy to miss,
                  so the heading says so once. Icon + number: no room for the word. */}
              {overdueCount > 0 && (
                <span className="vb-board-col__overdue" aria-label={`${overdueCount} overdue`}>
                  <AlertTriangle size={12} aria-hidden />
                  {overdueCount}
                </span>
              )}
              <span className="wb-gpill vb-board-col__count">{colItems.length}</span>
            </div>

            {colItems.length === 0 ? (
              canAdd ? (
                <button
                  type="button"
                  ref={el => registerAddTrigger(col.key, el)}
                  className="vb-board-empty wb-focus-ring"
                  onClick={() => setAddingTo(col.key)}
                >
                  Nothing here yet<span className="wb-sr-only">, add to {headLabel}</span>
                </button>
              ) : (
                <div className="vb-board-empty">
                  <Check size={16} aria-hidden />
                  Drag finished work here
                </div>
              )
            ) : (
              colItems.map((item, index) => {
                const key = itemKey(item);
                return (
                  <BoardCard
                    key={key}
                    item={item}
                    todayStr={todayStr}
                    columns={columns}
                    currentKey={col.key}
                    dragging={draggingKey === key}
                    shifted={gapAt !== null && index >= gapAt}
                    // Only the instance in the destination column: the origin card must not pulse
                    // while the refresh is in flight.
                    settling={settle?.key === key && settle.column === col.key}
                    selected={selection.isSelected(key)}
                    onToggleSelect={() => selection.toggle(key, false)}
                    onDragStart={e => handleDragStart(e, item)}
                    onDragEnd={clearDrag}
                    // Awaited (P1-5): the refocus only runs once the move and refresh have
                    // settled; the rAF lets React commit the re-render (and the new card's ref
                    // callback fire) before the lookup. A move waiting on its reason refocuses
                    // from the popover's confirm instead.
                    onMove={async next => {
                      if (await moveItem(item, next)) requestAnimationFrame(() => focusTrigger(key, next));
                    }}
                    triggerRef={el => registerTrigger(key, el)}
                  />
                );
              })
            )}

            {canAdd && (
              <div
                ref={el => registerAddArea(col.key, el)}
                className="wb-card-motion"
                data-shift={gapAt !== null ? 'down' : undefined}
              >
                {colItems.length > 0 && addingTo !== col.key && (
                  <button
                    type="button"
                    ref={el => registerAddTrigger(col.key, el)}
                    className="wb-add-trigger wb-focus-ring"
                    onClick={() => setAddingTo(col.key)}
                  >
                    + Add
                  </button>
                )}
                {/* Always mounted, so pending or failed drafts survive the input closing. */}
                <WbQuickAdd
                  open={addingTo === col.key}
                  onClose={() => {
                    setAddingTo(cur => (cur === col.key ? null : cur));
                    refocusAddTrigger(col.key);
                  }}
                  label={`Add to ${col.label}`}
                  defaults={{ dueAt: null, stage: col.key }}
                  filter={filter}
                  courses={courses}
                  onCreated={onChanged}
                />
              </div>
            )}
            {/* The lane grows by the gap at once so the shifted cards stay inside its tint. */}
            {gapAt !== null && <div aria-hidden className="vb-board-col__gap" />}
          </div>
        );
      })}

      <WaitingPopover
        open={waiting !== null}
        anchor={waiting?.anchor ?? null}
        title={waiting?.item.title ?? ''}
        prompt={waiting ? waitingPrompt(waiting.next, waiting.item.title) : undefined}
        // Opened from the "Move to" menu (keyboard-reachable): no entrance animation.
        instant={waiting !== null && !waiting.fromDrag}
        onCancel={() => {
          const a = waiting?.anchor;
          setWaiting(null);
          if (a?.isConnected) a.focus({ preventScroll: true });
        }}
        onConfirm={reason => {
          const w = waiting;
          setWaiting(null);
          if (!w) return;
          void commitMove(w.item, w.next, reason, w.fromDrag).then(moved => {
            if (moved && !w.fromDrag) requestAnimationFrame(() => focusTrigger(itemKey(w.item), w.next));
          });
        }}
      />

      {/* Portalled by `WbBulkBar` itself, so where it sits in this tree does not matter. */}
      {selection.count > 0 && (
        <WbBulkBar
          count={selection.count}
          statusOptions={statusOptions}
          busy={bulk.busy}
          onStatus={v => void bulk.setStatus(selectedItems, v)}
          onPriority={p => void bulk.setPriority(selectedItems, p)}
          onDeadline={d => void bulk.setDeadline(selectedItems, d)}
          onDelete={() => { bulk.remove(selectedItems); selection.clear(); }}
          onClear={selection.clear}
        />
      )}

      <style jsx>{`
        /* Gap and 280px floor are LANE_GAP / LANE_MIN. */
        .vb-board {
          display: grid; gap: 16px;
          grid-template-columns: repeat(var(--lanes), minmax(280px, 1fr));
        }
        /* Only when the lanes do not fit (see overflowing). The lane shadow reaches about 46px
           below a lane (20px offset, 50px blur, -24px spread); the padding keeps it inside the
           scroller and the matching negative margin gives the space back. */
        .vb-board[data-overflow='true'] { overflow-x: auto; padding-bottom: 48px; margin-bottom: -48px; }
        .vb-board-col {
          min-width: 0; min-height: 320px; padding: 12px; box-sizing: border-box;
          /* .wb-glass-panel is position: relative, the offsetParent for drop-index maths.
             isolate keeps the wash's z-index: -1 inside the lane even without backdrop-filter. */
          isolation: isolate;
        }
        .vb-lane-wash {
          position: absolute; inset: 0 0 auto 0; height: 90px; z-index: -1; pointer-events: none;
          border-radius: 22px 22px 0 0;
          background: linear-gradient(180deg, color-mix(in srgb, var(--lane) 26%, transparent), transparent);
        }
        .vb-board-col__gap { height: var(--wb-drop-gap); }
        .vb-board-col.drag-over {
          outline: 1.5px dashed var(--wb-blue);
          outline-offset: -1.5px;
        }
        .vb-board-col__head {
          display: flex; align-items: center; gap: 9px; padding: 4px 4px 12px;
        }
        .vb-board-col__label {
          font: 750 var(--wb-fs-14) var(--wb-font-head); color: var(--wb-text);
          min-width: 0; overflow-wrap: break-word; margin-right: auto;
        }
        .vb-board-col__overdue {
          display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0;
          border-radius: var(--wb-r-pill); padding: 1px 7px;
          background: var(--wb-danger-bg); color: var(--wb-danger); font: 700 var(--wb-fs-12) var(--wb-font-ui);
        }
        .vb-board-col__count { flex-shrink: 0; padding: 2px 9px; font-weight: 700; }
        .vb-board-empty {
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          width: 100%; box-sizing: border-box; text-align: center;
          border: 1.5px dashed rgba(255, 255, 255, 0.9); border-radius: 16px;
          padding: 22px 10px; background: rgba(255, 255, 255, 0.2);
          font: 600 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text-muted);
        }
        button.vb-board-empty { cursor: pointer; }
        @media (hover: hover) and (pointer: fine) {
          button.vb-board-empty:hover { border-color: var(--wb-blue); background: rgba(255, 255, 255, 0.4); }
        }
        /* The quick add row is built for full-width lists; a lane needs it to wrap. */
        .vb-board-col :global(.wb-qa) { flex-wrap: wrap; }
        .vb-board-col :global(.wb-qa__hint) { display: none; }
        .vb-board-col :global(.wb-add-trigger) { margin-top: 2px; }
        /* Reduced motion: no gap opens (the cards do not shift), so no spacer; the outline is enough. */
        @media (prefers-reduced-motion: reduce) {
          .vb-board-col__gap { display: none; }
        }
        @media (max-width: 767px) {
          /* One lane at 85% of the scroller, so a snapped lane is fully visible and the next
             one peeks in. */
          .vb-board {
            grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 85%;
            overflow-x: auto; padding-bottom: 48px; margin-bottom: -48px;
            scroll-snap-type: x mandatory;
            scrollbar-width: none;
          }
          .vb-board::-webkit-scrollbar { display: none; }
          .vb-board-col { scroll-snap-align: start; }
        }
      `}</style>
    </div>
  );
}

const EMPTY_STATE: React.CSSProperties = { textAlign: 'center', padding: '60px 20px' };
const EMPTY_TITLE: React.CSSProperties = { font: '700 var(--wb-fs-16) var(--wb-font-head)', color: 'var(--wb-text)', margin: '0 0 6px' };
const EMPTY_BODY: React.CSSProperties = { font: '500 var(--wb-fs-14) var(--wb-font-ui)', color: 'var(--wb-text-muted)', margin: 0 };
