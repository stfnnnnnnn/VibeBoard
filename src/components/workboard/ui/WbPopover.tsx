'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { prefersReducedMotion } from '@/lib/workboard/ui/tokens';
import { useOverlayLayer } from './WbOverlay';

export type PopoverPlacement = 'bottom-start' | 'bottom-end';

interface Position { top: number; left: number; origin: string }

const GAP = 6;
const EDGE = 8;
/** Exit duration (spec 4.5: 140ms enter, 100ms exit). */
const EXIT_MS = 100;

function computePosition(anchor: HTMLElement, panel: HTMLElement, placement: PopoverPlacement): Position {
  const a = anchor.getBoundingClientRect();
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const below = vh - a.bottom - GAP;
  const flipUp = below < h + EDGE && a.top > below;
  const top = flipUp ? Math.max(EDGE, a.top - GAP - h) : Math.min(vh - EDGE - h, a.bottom + GAP);
  let left = placement === 'bottom-end' ? a.right - w : a.left;
  left = Math.min(Math.max(EDGE, left), vw - EDGE - w);
  const originX = placement === 'bottom-end' ? 'right' : 'left';
  const originY = flipUp ? 'bottom' : 'top';
  return { top, left, origin: `${originY} ${originX}` };
}

/** The nearest ancestor that scrolls (overflow auto/scroll), or null. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(p);
    if (/(auto|scroll)/.test(overflowY + overflowX)) return p;
  }
  return null;
}

/** False once the anchor has scrolled fully out of the viewport or its scroll container. */
function anchorVisible(anchor: HTMLElement): boolean {
  const a = anchor.getBoundingClientRect();
  const intersects = (r: { top: number; bottom: number; left: number; right: number }) =>
    a.bottom > r.top && a.top < r.bottom && a.right > r.left && a.left < r.right;
  if (!intersects({ top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth })) return false;
  const parent = scrollParentOf(anchor);
  return parent === null || intersects(parent.getBoundingClientRect());
}

export interface WbPopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  placement?: PopoverPlacement;
  width?: number;
  ariaLabel?: string;
  labelledBy?: string;
  role?: 'dialog' | 'menu' | 'listbox';
  instant?: boolean;
  children: ReactNode;
}

export default function WbPopover({
  open, anchor, onClose, placement = 'bottom-start', width, ariaLabel, labelledBy,
  role = 'dialog', instant = false, children,
}: WbPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Inside a WbOverlay, portal into its layer so the popover joins the trap and aria-modal tree.
  const layer = useOverlayLayer();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [pos, setPos] = useState<Position | null>(null);
  const [phase, setPhase] = useState<'enter' | 'open' | 'closed'>('enter');
  // Stays true for EXIT_MS after `open` goes false so the exit transition can play.
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) { setPresent(true); return; }
    if (!present) return;
    const t = window.setTimeout(() => { setPresent(false); setPos(null); }, prefersReducedMotion() ? 0 : EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open, present]);

  const place = useCallback(() => {
    if (anchor && panelRef.current) setPos(computePosition(anchor, panelRef.current, placement));
  }, [anchor, placement]);

  useLayoutEffect(() => {
    if (!open) { setPhase('closed'); return; }
    place();
    if (instant) { setPhase('open'); return; }
    setPhase('enter');
    const id = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(id);
  }, [open, place, instant]);

  // Move focus in once the panel is positioned (a hidden panel cannot take focus) so Esc works in
  // browsers where clicking a button does not focus it: the first [data-autofocus] or menuitem,
  // else the panel itself. Content that focused itself keeps focus.
  const hasPos = pos !== null;
  useLayoutEffect(() => {
    if (!open || !hasPos) return;
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    const first = panel.querySelector<HTMLElement>('[data-autofocus], [role="menuitem"]');
    (first ?? panel).focus({ preventScroll: true });
  }, [open, hasPos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only the popover holding focus (or whose anchor does) closes, so nested popovers close one at a time.
      if (!panelRef.current?.contains(document.activeElement) && document.activeElement !== anchor) return;
      e.stopImmediatePropagation();
      onCloseRef.current();
      anchor?.focus({ preventScroll: true });
    };
    // Follow the anchor while it is on screen; close once it scrolls out of view rather than
    // leaving the panel floating over unrelated content.
    const onScroll = () => {
      if (anchor && !anchorVisible(anchor)) { onCloseRef.current(); return; }
      place();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, anchor, place]);

  if ((!open && !present) || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      tabIndex={-1}
      aria-label={labelledBy ? undefined : ariaLabel}
      aria-labelledby={labelledBy}
      className="wb-popover"
      data-state={pos ? phase : 'enter'}
      data-instant={instant ? 'true' : undefined}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        transformOrigin: pos?.origin ?? 'top left',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    layer ?? document.body,
  );
}
