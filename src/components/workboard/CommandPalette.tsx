'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, List, Table2, Columns3, GanttChart, Layers, Plus } from 'lucide-react';
import WbOverlay from './ui/WbOverlay';
import { contextChip } from './views/FocusRow';
import type { ViewKey } from './WorkboardShell';
import type { WorkItem } from '@/lib/workboard/workItems';
import type { WorkContext } from '@/lib/workboard/workContexts';
import { dueStateOf, formatDeadline, formatDueLabel } from '@/lib/workboard/dueSemantics';
import { itemKey } from '@/lib/workboard/ui/itemKey';
import {
  buildPaletteGroups, type PaletteRow, type PaletteScope, type PaletteViewKey,
} from '@/lib/workboard/ui/paletteSearch';

export interface CommandPaletteProps {
  open: boolean;
  instant: boolean;
  items: WorkItem[];
  today: string;
  recentKeys: string[];
  onClose: () => void;
  onOpenItem: (item: WorkItem) => void;
  onGoView: (v: ViewKey) => void;
  onGoContext: (c: WorkContext | 'all') => void;
  onCreateTask: (title: string) => void;
  onCreateEvent: (title: string) => void;
  onCreateReminder: () => void;
  onShowAllInTable: (query: string) => void;
}

const SCOPES: { key: PaletteScope; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'items', label: 'Items' },
  { key: 'goto', label: 'Go to' }, { key: 'create', label: 'Create' },
];

const VIEW_ICON: Record<PaletteViewKey, typeof List> = {
  list: List, table: Table2, board: Columns3, timeline: GanttChart,
};

/** The due cell is a fixed 84px column, so the label is the short form of `formatDueLabel`
 *  ("Tomorrow", "Oct 20", "⚠ Jul 7"); the full label rides along as the cell's title. */
function compactDue(item: WorkItem, today: string): { text: string; full: string | null; overdue: boolean } {
  const state = dueStateOf(item, today);
  const full = formatDueLabel(item, today);
  if (state === 'overdue') return { text: `⚠ ${formatDeadline(item) ?? 'Overdue'}`, full, overdue: true };
  if (state === 'completed' || state === 'completed_late') return { text: 'Done', full, overdue: false };
  if (full === null) return { text: '—', full: null, overdue: false };
  const short = full.replace(/^Due /, '');
  return { text: short.charAt(0).toUpperCase() + short.slice(1), full, overdue: false };
}

function highlight(title: string, start: number, len: number): ReactNode {
  if (start < 0 || len === 0) return title;
  return (
    <>
      {title.slice(0, start)}
      <mark>{title.slice(start, start + len)}</mark>
      {title.slice(start + len)}
    </>
  );
}

/** Spec 13's Ctrl+K palette. Pure presentation over `buildPaletteGroups`; the shell owns what
 *  every row does. Focus never leaves the input: rows and chips are mouse targets only, and the
 *  input's keys (arrows, Enter, Tab) drive everything, with the active row exposed through
 *  `aria-activedescendant`. */
export default function CommandPalette({
  open, instant, items, today, recentKeys, onClose, onOpenItem, onGoView, onGoContext,
  onCreateTask, onCreateEvent, onCreateReminder, onShowAllInTable,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<PaletteScope>('all');
  const [active, setActive] = useState(0);

  const groups = useMemo(
    () => buildPaletteGroups({ query, scope, items, recentKeys }),
    [query, scope, items, recentKeys],
  );
  const flat = useMemo(() => groups.flatMap(g => g.rows), [groups]);
  // A refresh behind the open palette can shrink the list; clamp rather than lose the highlight.
  const current = flat.length === 0 ? -1 : Math.min(active, flat.length - 1);

  const hasQuery = query.trim() !== '';
  const itemsInScope = scope === 'all' || scope === 'items';
  const itemsGroup = groups.find(g => g.heading === 'Items');
  const itemCount = itemsGroup?.count ?? 0;
  const showNoMatch = hasQuery && itemsInScope && itemsGroup === undefined;
  const scopeLabel = SCOPES.find(s => s.key === scope)?.label ?? 'All';

  const toTop = () => { if (listRef.current) listRef.current.scrollTop = 0; };
  const changeQuery = (q: string) => { setQuery(q); setActive(0); toTop(); };
  const changeScope = (s: PaletteScope) => { setScope(s); setActive(0); toTop(); };

  /** Keyboard moves scroll the row into view; hover moves never do (the row is under the pointer).
   *  Index 0 scrolls to the very top so its group heading shows too. */
  const moveTo = (i: number) => {
    setActive(i);
    if (i === 0) toTop();
    else listRef.current?.querySelector(`#wb-pal-opt-${i}`)?.scrollIntoView({ block: 'nearest' });
  };

  const run = (row: PaletteRow) => {
    switch (row.kind) {
      case 'item':         onOpenItem(row.item); break;
      case 'goto-view':    onGoView(row.view); break;
      case 'goto-context': onGoContext(row.context); break;
      case 'show-all':     onShowAllInTable(query.trim()); break;
      case 'create':
        if (row.type === 'task') onCreateTask(row.title);
        else if (row.type === 'event') onCreateEvent(row.title);
        else onCreateReminder();
        break;
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      moveTo((Math.max(current, 0) + step + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        if (hasQuery) { onCreateTask(query.trim()); onClose(); }
        return;
      }
      if (current >= 0) run(flat[current]);
    } else if (e.key === 'Tab') {
      // Tab is the scope switch here, so WbOverlay's focus trap must not also see it.
      e.preventDefault();
      e.stopPropagation();
      const i = SCOPES.findIndex(s => s.key === scope);
      changeScope(SCOPES[(i + (e.shiftKey ? -1 : 1) + SCOPES.length) % SCOPES.length].key);
    }
  };

  const firstCreateWithTitle = flat.findIndex(r => r.kind === 'create' && r.title !== '');

  let index = -1;
  const renderRow = (row: PaletteRow) => {
    index += 1;
    const i = index;
    const selected = i === current;
    let icon: ReactNode;
    let iconClass = 'wb-pal__ic';
    let iconStyle: React.CSSProperties | undefined;
    let label: ReactNode;
    let ctx: ReactNode = null;
    let due: ReactNode = null;
    let keyHint: ReactNode = null;
    let rowKey: string;

    switch (row.kind) {
      case 'item': {
        const chip = contextChip(row.item);
        const d = compactDue(row.item, today);
        rowKey = `item-${itemKey(row.item)}`;
        icon = <span aria-hidden>◻</span>;
        iconStyle = { background: `color-mix(in srgb, ${chip.fill} 14%, transparent)`, color: chip.text };
        label = highlight(row.item.title, row.matchStart, row.matchLen);
        ctx = (
          <>
            <span className="wb-pal__dot" style={{ background: chip.fill }} aria-hidden />
            <span className="wb-pal__ctx-label" style={{ color: chip.text }}>{chip.label}</span>
          </>
        );
        due = <span className={`wb-pal__due${d.overdue ? ' wb-pal__due--overdue' : ''}`} title={d.full ?? undefined}>{d.text}</span>;
        if (selected) keyHint = <span className="wb-kbd">↵</span>;
        break;
      }
      case 'goto-view': {
        const Icon = VIEW_ICON[row.view];
        rowKey = `view-${row.view}`;
        icon = <Icon size={14} aria-hidden />;
        label = row.label;
        break;
      }
      case 'goto-context':
        rowKey = `ctx-${row.context}`;
        icon = <Layers size={14} aria-hidden />;
        label = row.label;
        break;
      case 'create':
        rowKey = `create-${row.type}`;
        iconClass += ' wb-pal__ic--create';
        icon = <Plus size={14} aria-hidden />;
        label = row.title ? `New ${row.type} “${row.title}”` : `New ${row.type}`;
        if (i === firstCreateWithTitle) keyHint = <><span className="wb-kbd">Ctrl</span><span className="wb-kbd">↵</span></>;
        break;
      case 'show-all':
        rowKey = 'show-all';
        icon = <Table2 size={14} aria-hidden />;
        label = `Show all ${row.count} in Table`;
        break;
    }

    return (
      <div
        key={rowKey}
        id={`wb-pal-opt-${i}`}
        role="option"
        aria-selected={selected}
        className="wb-pal__row"
        // Keep focus (and the caret) in the input.
        onMouseDown={e => e.preventDefault()}
        onPointerMove={e => { if (e.pointerType === 'mouse' && i !== current) setActive(i); }}
        onClick={() => run(row)}
      >
        <span className={iconClass} style={iconStyle}>{icon}</span>
        <span className="wb-pal__t">{label}</span>
        <span className="wb-pal__ctx">{ctx}</span>
        {due ?? <span className="wb-pal__due" />}
        <span className="wb-pal__k">{keyHint}</span>
      </div>
    );
  };

  return (
    <WbOverlay
      open={open}
      instant={instant}
      variant="palette"
      ariaLabel="Command palette"
      onClose={onClose}
      initialFocusRef={inputRef}
    >
      <div className="wb-pal__in">
        <Search size={18} aria-hidden />
        <input
          ref={inputRef}
          type="search"
          className="wb-pal__input"
          value={query}
          onChange={e => changeQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search items, views, or type to create…"
          aria-label="Search items, views, or type to create"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls="wb-pal-list"
          aria-autocomplete="list"
          aria-activedescendant={current >= 0 ? `wb-pal-opt-${current}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="wb-kbd" aria-hidden>Esc</span>
      </div>

      <div className="wb-pal__scope" role="group" aria-label="Search scope">
        {SCOPES.map(s => (
          <button
            key={s.key}
            type="button"
            className="wb-pal__chip"
            aria-pressed={scope === s.key}
            // Tab already cycles these from the input; as tab stops they would only trap focus.
            tabIndex={-1}
            onMouseDown={e => e.preventDefault()}
            onClick={() => changeScope(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Announces Tab's scope changes; the initial value is not read, only changes. */}
      <span className="wb-sr-only" aria-live="polite">{`${scopeLabel} scope`}</span>

      <div className="wb-pal__list" ref={listRef}>
        {/* Outside the listbox (only options and groups belong in it), where the Items group would sit. */}
        {showNoMatch && <div className="wb-pal__empty">No items match “{query.trim()}”</div>}
        <div id="wb-pal-list" role="listbox" aria-label={`${scopeLabel} results`}>
          {groups.map(g => (
            <div key={g.heading} role="group" aria-label={g.heading}>
              <div className="wb-pal__gr" aria-hidden>{`${g.heading}${g.count !== undefined ? ` · ${g.count}` : ''}`}</div>
              {g.rows.map(renderRow)}
            </div>
          ))}
        </div>
      </div>

      <div className="wb-pal__ft" aria-hidden>
        <span><span className="wb-kbd">↑</span> <span className="wb-kbd">↓</span> move</span>
        <span><span className="wb-kbd">↵</span> open</span>
        <span className="wb-pal__ft-hint--wide"><span className="wb-kbd">Tab</span> scope</span>
        <span className="wb-pal__ft-end">
          {hasQuery && itemsInScope
            ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`
            : <><span className="wb-kbd">Ctrl</span><span className="wb-kbd">K</span></>}
        </span>
      </div>
    </WbOverlay>
  );
}
