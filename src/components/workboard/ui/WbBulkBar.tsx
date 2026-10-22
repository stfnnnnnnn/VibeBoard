'use client';

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import WbPopover from './WbPopover';

export type BulkStatusOption = { value: string; label: string };
type Menu = 'status' | 'priority' | 'deadline';

export interface WbBulkBarProps {
  count: number;
  statusOptions: BulkStatusOption[];
  onStatus: (v: string) => void;
  onPriority: (v: 'high' | 'normal' | 'low') => void;
  onDeadline: (dueAt: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
  busy?: boolean;
}

const PRIORITIES = [
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
] as const;

/** Arrow/Home/End roving focus between a menu's items (same keys as WorkItemRow's overflow menu). */
function menuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, onTab: () => void) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  if (items.length === 0) return;
  const i = items.findIndex(el => el === document.activeElement);
  let next: HTMLButtonElement | undefined;
  if (e.key === 'ArrowDown') next = items[(i + 1 + items.length) % items.length];
  else if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
  else if (e.key === 'Home') next = items[0];
  else if (e.key === 'End') next = items[items.length - 1];
  else if (e.key === 'Tab') { e.preventDefault(); onTab(); return; }
  if (!next) return;
  e.preventDefault();
  next.focus();
}

/** Spec 12: the dark floating pill, bottom-centre, shown while anything is selected. */
export default function WbBulkBar({ count, statusOptions, onStatus, onPriority, onDeadline, onDelete, onClear, busy }: WbBulkBarProps) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<'enter' | 'open'>('enter');
  const [menu, setMenu] = useState<Menu | null>(null);
  // Opened with Enter/Space (a click with detail 0): no entrance animation (spec 4.3 rule 3).
  const [menuInstant, setMenuInstant] = useState(false);
  const [date, setDate] = useState('');
  const statusRef = useRef<HTMLButtonElement>(null);
  const priorityRef = useRef<HTMLButtonElement>(null);
  const deadlineRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const triggers: Record<Menu, RefObject<HTMLButtonElement | null>> = { status: statusRef, priority: priorityRef, deadline: deadlineRef };

  useEffect(() => {
    setMounted(true);
    const id = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(id);
  }, []);

  // Publishes the bar's height so WbToaster can sit above it on phones, where it may wrap.
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!mounted || !el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--wb-bulkbar-h', `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--wb-bulkbar-h'); };
  }, [mounted]);

  // Esc clears the selection only when no menu is open (an open menu's own Esc closes it first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menu === null && !e.defaultPrevented) onClear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, onClear]);

  if (!mounted) return null;

  // While busy the actions are aria-disabled rather than disabled, so a focused trigger keeps focus.
  const toggle = (m: Menu) => {
    if (busy) return;
    if (m === 'deadline') setDate('');
    setMenu(cur => (cur === m ? null : m));
  };
  const close = () => setMenu(null);
  /** Tab out of a menu: close it and put focus back on its trigger, as `pick` does. */
  const closeTo = (m: Menu) => { setMenu(null); triggers[m].current?.focus({ preventScroll: true }); };
  /** Close, hand focus back to the menu's trigger, then act. */
  const pick = (m: Menu, fn: () => void) => {
    setMenu(null);
    triggers[m].current?.focus({ preventScroll: true });
    fn();
  };
  const trigger = (m: Menu, label: string, popup: 'menu' | 'dialog') => (
    <button ref={triggers[m]} type="button" className="wb-bulkbar__btn wb-pressable" aria-disabled={busy || undefined}
      aria-haspopup={popup} aria-expanded={menu === m} onClick={e => { setMenuInstant(e.detail === 0); toggle(m); }}>
      {label}<span className="wb-bulkbar__caret" aria-hidden> ▾</span>
    </button>
  );

  return createPortal(
    <div ref={barRef} className="wb-bulkbar" data-state={phase} role="toolbar" aria-label={`${count} selected`} aria-busy={busy || undefined}>
      <span className="wb-bulkbar__count" aria-live="polite">{count}<span className="wb-bulkbar__count-label"> selected</span></span>
      {trigger('status', 'Status', 'menu')}
      {trigger('priority', 'Priority', 'menu')}
      {trigger('deadline', 'Deadline', 'dialog')}
      <button type="button" className="wb-bulkbar__btn wb-bulkbar__btn--danger wb-pressable" aria-disabled={busy || undefined}
        onClick={() => { if (!busy) onDelete(); }}>Delete</button>
      <button type="button" className="wb-bulkbar__btn wb-bulkbar__btn--icon wb-pressable" aria-label="Clear selection" onClick={onClear}>
        <X size={16} aria-hidden />
      </button>

      <WbPopover open={menu === 'status'} anchor={statusRef.current} onClose={close} role="menu" ariaLabel="Set status" instant={menuInstant}>
        <div className="wb-bulkmenu" onKeyDown={e => menuKeyDown(e, () => closeTo('status'))}>
          {statusOptions.map(o => (
            <button key={o.value} type="button" role="menuitem" className="wb-bulkmenu__item" onClick={() => pick('status', () => onStatus(o.value))}>{o.label}</button>
          ))}
        </div>
      </WbPopover>
      <WbPopover open={menu === 'priority'} anchor={priorityRef.current} onClose={close} role="menu" ariaLabel="Set priority" instant={menuInstant}>
        <div className="wb-bulkmenu" onKeyDown={e => menuKeyDown(e, () => closeTo('priority'))}>
          {PRIORITIES.map(p => (
            <button key={p.value} type="button" role="menuitem" className="wb-bulkmenu__item" onClick={() => pick('priority', () => onPriority(p.value))}>{p.label}</button>
          ))}
        </div>
      </WbPopover>
      <WbPopover open={menu === 'deadline'} anchor={deadlineRef.current} onClose={close} ariaLabel="Set deadline" width={220} instant={menuInstant}>
        <div className="wb-bulkmenu wb-bulkmenu--date">
          <input type="date" data-autofocus className="wb-bulkmenu__date" value={date} onChange={e => setDate(e.target.value)} aria-label="New deadline" />
          <button type="button" className="wb-bulkmenu__item" disabled={!date} onClick={() => pick('deadline', () => onDeadline(date))}>Apply</button>
          <button type="button" className="wb-bulkmenu__item" onClick={() => pick('deadline', () => onDeadline(null))}>Clear deadline</button>
        </div>
      </WbPopover>
    </div>,
    document.body,
  );
}
