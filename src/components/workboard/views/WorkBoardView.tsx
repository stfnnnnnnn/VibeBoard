'use client';

import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, MoreVertical, SearchX } from 'lucide-react';
// Type-only imports from `workItems.ts` — that module imports `pool` (mysql2) at module
// scope for its DB-access exports, so a runtime import here would drag mysql2 into this
// client bundle (see WorkboardShell.tsx's and WorkItemRow.tsx's comments on the same hazard).
import type { WorkItem, WorkStatus } from '@/lib/workboard/workItems';
// `setWorkStatus` is the single place owned-vs-academic endpoint routing lives (Task 11) —
// imported and reused here rather than rebuilt, per this task's brief.
import { setWorkStatus } from '../WorkItemRow';
import { courseColor } from '@/lib/workboard/color';
import { addDays, dueDateOf } from '@/lib/workboard/dates';

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

const COLUMNS: { key: WorkStatus; label: string; emptyText: string }[] = [
  { key: 'todo',        label: 'To Do',        emptyText: 'No work queued' },
  { key: 'in_progress', label: 'In Progress',  emptyText: 'Nothing in progress' },
  { key: 'done',        label: 'Done',         emptyText: 'Nothing completed yet' },
];

/** "Due today" / "Due tomorrow" / "Overdue" / "Due Sep 12" — same convention as
 *  `WorkItemRow.tsx`'s `formatDueLabel`, duplicated here (it isn't exported there) rather
 *  than imported, following `WorkboardRail.tsx`'s precedent: this file must stay independent
 *  of any module that could later grow a `pool` import. */
function formatDueLabel(due: string, todayStr: string): string {
  if (due < todayStr) return 'Overdue';
  if (due === todayStr) return 'Due today';
  if (due === addDays(todayStr, 1)) return 'Due tomorrow';
  const d = new Date(`${due}T00:00:00Z`);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `Due ${month} ${d.getUTCDate()}`;
}

function buildMeta(item: WorkItem, todayStr: string): { text: string | null; overdue: boolean } {
  const due = dueDateOf(item);
  const dueLabel = due !== null ? formatDueLabel(due, todayStr) : null;
  const estimateLabel = item.estimated_hours !== null ? `${item.estimated_hours}h` : null;
  const parts = [dueLabel, estimateLabel].filter((p): p is string => p !== null);
  const overdue = due !== null && due < todayStr && item.work_status !== 'done';
  return { text: parts.length ? parts.join(' · ') : null, overdue };
}

function itemKey(item: Pick<WorkItem, 'source' | 'id'>): string {
  return `${item.source}-${item.id}`;
}

/** Card overflow menu — the keyboard-guaranteed "Move to" path required alongside drag
 *  (`dragging-alternative`, WCAG 2.2 AA). Unlike `WorkItemRow`'s single-action menu, this one
 *  holds up to two items (the columns the card isn't already in), so arrow-key movement and
 *  open-focus matter here in a way they didn't yet for a one-item menu. */
function BoardCardMenu({
  item, onMove,
}: {
  item: WorkItem;
  onMove: (next: WorkStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const targets = COLUMNS.filter(c => c.key !== item.work_status);

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
    triggerRef.current?.focus();
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
        ref={triggerRef}
        type="button"
        className="vb-board-overflow"
        aria-label={`More options for "${item.title}"`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More options"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', borderRadius: '8px', color: '#5c6b80',
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Move to"
          className="vb-board-menu"
          onKeyDown={handleMenuKeyDown}
          style={{
            position: 'absolute', right: 0, top: '36px', zIndex: 20, minWidth: '160px',
            background: '#fff', borderRadius: '10px', border: '1px solid rgba(200,210,230,0.6)',
            boxShadow: '0 8px 24px rgba(31,38,68,0.18)', padding: '4px', overflow: 'hidden',
          }}
        >
          <div style={{ padding: '6px 10px 4px', fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700, color: '#8a94a6', textTransform: 'uppercase' }}>
            Move to
          </div>
          {targets.map((col, i) => (
            <button
              key={col.key}
              ref={el => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              className="vb-board-menu-item"
              onClick={() => { closeAndRefocus(); onMove(col.key); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                background: 'transparent', border: 'none', borderRadius: '6px', cursor: 'pointer',
                fontFamily: FONT, fontSize: '0.82rem', fontWeight: 600, color: '#2d3748',
              }}
            >
              {col.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BoardCard({
  item, todayStr, dragging, onDragStart, onDragEnd, onMove,
}: {
  item: WorkItem;
  todayStr: string;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMove: (next: WorkStatus) => void;
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
        <BoardCardMenu item={item} onMove={onMove} />
      </div>

      {item.priority === 'high' && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '2px 9px',
          background: 'rgba(224,96,124,0.15)', color: '#922e48', fontFamily: FONT, fontSize: '0.64rem',
          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: '6px',
        }}>
          High
        </span>
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

export default function WorkBoardView({ items, todayStr, isFiltered, onChanged, onNewItem }: WorkBoardViewProps) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<WorkStatus | null>(null);

  const byColumn = (status: WorkStatus) => items.filter(i => i.work_status === status);

  const handleDragStart = (e: React.DragEvent, item: WorkItem) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ source: item.source, id: item.id }));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingKey(itemKey(item));
  };

  const handleDragEnd = () => {
    setDraggingKey(null);
    setDragOverCol(null);
  };

  const moveItem = async (item: WorkItem, next: WorkStatus) => {
    if (item.work_status === next) return;
    const res = await setWorkStatus(item, next);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(body?.error ?? 'Failed to move item');
      return;
    }
    await onChanged();
  };

  const handleDrop = async (e: React.DragEvent, next: WorkStatus) => {
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
          Try a different category or search term.
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
      {COLUMNS.map(col => {
        const colItems = byColumn(col.key);
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
                  dragging={draggingKey === itemKey(item)}
                  onDragStart={e => handleDragStart(e, item)}
                  onDragEnd={handleDragEnd}
                  onMove={next => moveItem(item, next)}
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
        .vb-board-overflow:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        .vb-board-overflow:hover {
          background: rgba(200,210,230,0.3);
        }
        .vb-board-menu-item:hover {
          background: rgba(116,188,217,0.12);
        }
        .vb-board-menu-item:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: -2px;
        }
      `}</style>
    </div>
  );
}
