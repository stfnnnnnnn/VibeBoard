'use client';

import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import WbPopover from '@/components/workboard/ui/WbPopover';
import { EXPENSE_CATEGORIES, categoryEmoji, categoryLabel } from '@/lib/finance/categories';

/* The composer's category control (Addendum B, "sentence bar"): a button that opens a tile
   picker with "Most used" first, then every other expense category. Keyboard model: a listbox
   with a roving tabindex. The filter input takes focus on open; ArrowDown (or Tab) moves into
   the tiles, arrow keys move between them by their on-screen position, Home/End jump, Enter or
   Space picks, typing goes back to the filter, Esc closes onto the button. Picking closes and
   hands focus to `onPicked` (the amount input). `chip` is the phone dock's "More ▾" chip. */
export default function CategoryPicker({ value, onChange, topCategories, onPicked, variant = 'button' }: {
  value: string;
  onChange: (category: string) => void;
  topCategories: string[];
  onPicked?: () => void;
  variant?: 'button' | 'chip';
}) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  /* Opened from the keyboard (click with detail 0): the popover appears without animating. */
  const [instant, setInstant] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(value);
  const [width, setWidth] = useState(372);

  const q = filter.trim().toLowerCase();
  const matches = (key: string) => !q || categoryLabel(key).toLowerCase().includes(q) || key.includes(q);
  const top = topCategories.filter(matches);
  const rest = EXPENSE_CATEGORIES.map(([key]) => key as string).filter(k => !topCategories.includes(k) && matches(k));
  const visible = [...top, ...rest];
  /* The tile that owns the tab stop: the active one if it is still listed, else the first. */
  const current = visible.includes(active) ? active : visible[0];

  const show = (e: MouseEvent<HTMLButtonElement>) => {
    if (open) { setOpen(false); return; }
    setInstant(e.detail === 0);
    setFilter('');
    setActive(value);
    setWidth(Math.min(372, window.innerWidth - 16));
    setOpen(true);
  };
  const close = () => setOpen(false);
  const pick = (key: string) => {
    onChange(key);
    setOpen(false);
    if (onPicked) onPicked(); else btn.current?.focus();
  };
  const optionEl = (key: string) => listRef.current?.querySelector<HTMLElement>(`[data-cat="${key}"]`) ?? null;
  const focusOption = (key: string | undefined) => {
    if (!key) return;
    setActive(key);
    optionEl(key)?.focus();
  };

  /* Up/Down go to the nearest tile (by centre) in the next row above/below, so they also cross
     between the two sections, whose rows don't line up by index. */
  const vertical = (from: string, dir: 1 | -1): string | undefined => {
    const a = optionEl(from)?.getBoundingClientRect();
    if (!a) return undefined;
    const cx = a.left + a.width / 2;
    const rows = visible
      .map(k => ({ k, r: optionEl(k)?.getBoundingClientRect() }))
      .filter((o): o is { k: string; r: DOMRect } => !!o.r && (dir > 0 ? o.r.top >= a.bottom - 1 : o.r.bottom <= a.top + 1));
    if (rows.length === 0) return undefined;
    const rowTop = dir > 0 ? Math.min(...rows.map(o => o.r.top)) : Math.max(...rows.map(o => o.r.top));
    return rows
      .filter(o => Math.abs(o.r.top - rowTop) < 2)
      .sort((x, y) => Math.abs(x.r.left + x.r.width / 2 - cx) - Math.abs(y.r.left + y.r.width / 2 - cx))[0]?.k;
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = visible.indexOf(current ?? '');
    let next: string | undefined;
    switch (e.key) {
      case 'ArrowRight': next = visible[Math.min(visible.length - 1, i + 1)]; break;
      case 'ArrowLeft': next = visible[Math.max(0, i - 1)]; break;
      case 'ArrowDown': next = vertical(current ?? '', 1); break;
      case 'ArrowUp':
        next = vertical(current ?? '', -1);
        if (!next) { e.preventDefault(); filterRef.current?.focus(); return; }
        break;
      case 'Home': next = visible[0]; break;
      case 'End': next = visible[visible.length - 1]; break;
      case 'Enter': case ' ':
        e.preventDefault();
        if (current) pick(current);
        return;
      default:
        /* Typing while on a tile goes back to the filter. */
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setFilter(f => f + e.key);
          filterRef.current?.focus();
        }
        return;
    }
    e.preventDefault();
    if (next) focusOption(next);
  };

  const onFilterKey = (e: KeyboardEvent<HTMLInputElement>) => {
    /* Shift+Tab from the first field leaves the picker: close it back onto its button. */
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); close(); btn.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusOption(current); }
    else if (e.key === 'Enter') { e.preventDefault(); if (current) pick(current); }
  };

  const tile = (key: string) => (
    <button
      key={key}
      type="button"
      role="option"
      data-cat={key}
      aria-selected={key === value}
      tabIndex={key === current ? 0 : -1}
      className={`fin-catpick__tile${key === value ? ' is-on' : ''}`}
      onClick={() => pick(key)}
      onFocus={() => setActive(key)}
    >
      <span className="fin-catpick__emoji" aria-hidden>{categoryEmoji(key)}</span>
      <span className="fin-catpick__lbl">{categoryLabel(key)}</span>
    </button>
  );

  const isTop = topCategories.includes(value);
  const chipLabel = variant === 'chip' && isTop;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={variant === 'chip' ? `fin-chip${isTop ? '' : ' is-on'}` : 'fin-catpick'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={chipLabel ? 'More categories' : `Category: ${categoryLabel(value)}`}
        onClick={show}
      >
        {chipLabel ? 'More' : <><span aria-hidden>{categoryEmoji(value)}</span> {categoryLabel(value)}</>}
        <span className="fin-catpick__caret" aria-hidden>▾</span>
      </button>
      <WbPopover open={open} anchor={btn.current} onClose={close} width={width} ariaLabel="Choose a category" instant={instant}>
        <div
          className="fin-catpick__pop"
          onBlur={e => {
            /* Tabbing out of the picker closes it (clicking the button toggles it instead). */
            const to = e.relatedTarget as Node | null;
            if (to && !e.currentTarget.contains(to) && to !== btn.current) close();
          }}
        >
          <div className="fin-field fin-catpick__filter">
            <input
              ref={filterRef}
              data-autofocus
              type="text"
              placeholder="Filter categories"
              aria-label="Filter categories"
              aria-controls={`${id}-list`}
              autoComplete="off"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              onKeyDown={onFilterKey}
            />
          </div>
          <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Categories" className="fin-catpick__list" onKeyDown={onListKey}>
            {top.length > 0 && (
              <div role="group" aria-labelledby={`${id}-top`}>
                <div className="fin-label fin-catpick__sec" id={`${id}-top`}>Most used</div>
                <div className="fin-catpick__grid">{top.map(tile)}</div>
              </div>
            )}
            {rest.length > 0 && (
              <div role="group" aria-labelledby={`${id}-all`}>
                <div className="fin-label fin-catpick__sec" id={`${id}-all`}>{topCategories.length > 0 ? 'All categories' : 'Categories'}</div>
                <div className="fin-catpick__grid">{rest.map(tile)}</div>
              </div>
            )}
            {visible.length === 0 && <p className="fin-hint fin-catpick__none">No category matches “{filter.trim()}”</p>}
          </div>
        </div>
      </WbPopover>
    </>
  );
}
