'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/* One InfoTip open at a time: opening one announces its id on this module-level bus and every other one closes. */
const bus = new EventTarget();
const OPEN = 'sp-infotip-open';

const GAP = 8;    // trigger to popover
const MARGIN = 8; // popover to viewport edge

type Pos = { top: number; left: number; place: 'above' | 'below'; arrow: number };

/**
 * A small ⓘ toggletip (spec §5.5): a button with aria-expanded and aria-describedby, and a role="tooltip" popover.
 * The popover is portalled to <body> with fixed positioning, so it is never clipped by a card's overflow or trapped by
 * a glass panel's backdrop-filter. It sits above the button, or below when there is no room, measured on open (and
 * again on scroll or resize while open). Closes on Esc, an outside press, and when focus leaves the button.
 * `icon` swaps the ⓘ dot for a plain icon trigger (the entry table's note, spec 2026-10-24 §6.1); the popover is the same.
 */
export default function InfoTip({ label, children, tone = 'violet', icon }: {
  label: string; children: ReactNode; tone?: 'violet' | 'pink'; icon?: ReactNode;
}) {
  const id = useId();
  const popId = `${id}-tip`;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);

  const measure = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    const el = pop.current;
    if (!b || !el) return;
    // Layout size, not getBoundingClientRect: mid-entrance the popover is scaled, which would under-measure it.
    const w = el.offsetWidth, h = el.offsetHeight;
    const above = b.top - GAP - h >= MARGIN;
    const centre = b.left + b.width / 2;
    const left = Math.min(Math.max(centre - w / 2, MARGIN), Math.max(MARGIN, document.documentElement.clientWidth - MARGIN - w));
    setPos({ top: above ? b.top - GAP - h : b.bottom + GAP, left, place: above ? 'above' : 'below', arrow: Math.min(Math.max(centre - left, 12), w - 12) });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    measure();
  }, [open, measure]);

  useEffect(() => {
    const onOther = (e: Event) => { if ((e as CustomEvent<string>).detail !== id) setOpen(false); };
    bus.addEventListener(OPEN, onOther);
    return () => bus.removeEventListener(OPEN, onOther);
  }, [id]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // an Esc that closes a tip doesn't also close the menu or sheet behind it
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  const toggle = () => {
    const next = !open;
    if (next) bus.dispatchEvent(new CustomEvent(OPEN, { detail: id })); // outside the updater: no side effects there
    setOpen(next);
  };

  return (
    <span className={`sp-info sp-info--${tone}`}>
      <button ref={btn} type="button" className={`sp-info__btn${icon ? ' sp-info__btn--icon' : ''} sp-focus-ring`} aria-label={label}
        aria-expanded={open} aria-describedby={open ? popId : undefined} onClick={toggle} onBlur={() => setOpen(false)}>
        {icon ?? <span aria-hidden>i</span>}
      </button>
      {open && createPortal(
        <span ref={pop} id={popId} role="tooltip" className={`sp-tip sp-tip--${pos?.place ?? 'above'}`}
          // Pressing inside the popover (to select its text) must not blur the button and close it.
          onMouseDown={e => e.preventDefault()}
          style={(pos
            ? { top: pos.top, left: pos.left, transformOrigin: `${pos.arrow}px ${pos.place === 'above' ? '100%' : '0'}`, '--sp-tip-arrow': `${pos.arrow}px` }
            : { top: 0, left: 0 }) as CSSProperties}>
          {children}
        </span>,
        document.body,
      )}
    </span>
  );
}
