'use client';

import {
  createContext, useContext, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { DUR, prefersReducedMotion } from '@/lib/workboard/ui/tokens';

export type OverlayVariant = 'modal' | 'drawer' | 'palette';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Keeps the last non-null value mounted for `exitMs` after it becomes null, so an overlay
 *  rendered as `{value && <X/>}` can still play its exit transition (plan ruling R4). */
export function usePresence<T>(value: T | null, exitMs: number = DUR.fast): { value: T | null; open: boolean } {
  const [kept, setKept] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) { setKept(value); return; }
    if (kept === null) return;
    const t = window.setTimeout(() => setKept(null), prefersReducedMotion() ? 0 : exitMs);
    return () => window.clearTimeout(t);
  }, [value, kept, exitMs]);
  return { value: value ?? kept, open: value !== null };
}

type Phase = 'enter' | 'open' | 'closed';

/** Scroll lock shared by every mounted overlay. Overlays overlap (one opens while the last is still
 *  in its usePresence exit window), so a per-overlay save/restore unmounts out of order and can leave
 *  the page scrollable behind an open overlay, or locked after all have closed. Counted instead:
 *  the first lock saves and sets, the last unlock restores. */
let lockCount = 0;
/** Each mounted panel's opener chain, outermost first. An overlay opened from inside another
 *  (chooser to dialog, palette to drawer, drawer to Edit) extends that panel's chain, since the
 *  button that opened it may leave the DOM with its panel. On close, focus goes to the deepest
 *  opener still connected and not inside a closing panel, so it never falls to body while an
 *  earlier opener (the row title behind a drawer) still exists. */
const openers = new WeakMap<HTMLElement, HTMLElement[]>();

function restorable(el: HTMLElement): boolean {
  return el.isConnected && el.closest(".wb-overlay-panel[data-state='closed']") === null;
}

let savedOverflow = '';
function lockScroll() {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}
function unlockScroll() {
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount === 0) document.body.style.overflow = savedOverflow;
}

/** The element popovers opened inside an overlay portal into: an empty layer at the end of the
 *  panel, so they sit inside the focus trap and the `aria-modal` subtree. Null outside any
 *  overlay, where `WbPopover` falls back to `document.body`. The open panel carries no
 *  transform or filter (workboard.css), so `position: fixed` inside it still resolves against
 *  the viewport. */
const OverlayLayerContext = createContext<HTMLElement | null>(null);

export function useOverlayLayer(): HTMLElement | null {
  return useContext(OverlayLayerContext);
}

export interface WbOverlayProps {
  open: boolean;
  onClose: () => void;
  variant: OverlayVariant;
  labelledBy?: string;
  ariaLabel?: string;
  /** true when opened from the keyboard: no enter animation (spec 4.3 rule 3). */
  instant?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  children: ReactNode;
}

export default function WbOverlay({
  open, onClose, variant, labelledBy, ariaLabel, instant = false,
  initialFocusRef, panelClassName, panelStyle, children,
}: WbOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement[]>([]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [phase, setPhase] = useState<Phase>(instant ? 'open' : 'enter');
  // State, not a ref, so popovers re-render with the layer once it has mounted.
  const [layer, setLayer] = useState<HTMLElement | null>(null);

  // enter -> open on the next frame (plan ruling R5); open -> closed when the parent closes.
  useLayoutEffect(() => {
    if (!open) { setPhase('closed'); return; }
    if (instant) { setPhase('open'); return; }
    setPhase('enter');
    let id2 = 0;
    const id1 = requestAnimationFrame(() => { id2 = requestAnimationFrame(() => setPhase('open')); });
    return () => { cancelAnimationFrame(id1); cancelAnimationFrame(id2); };
  }, [open, instant]);

  // Remember the opener, move focus in, lock scroll; undo all three on unmount.
  useEffect(() => {
    const panel = panelRef.current;
    const active = document.activeElement as HTMLElement | null;
    const host = active?.closest<HTMLElement>('.wb-overlay-panel') ?? null;
    const inherited = host !== null && host !== panel ? openers.get(host) ?? [] : [];
    openerRef.current = active && active !== document.body ? [...inherited, active] : inherited;
    if (panel) openers.set(panel, openerRef.current);
    lockScroll();
    const focusTarget = initialFocusRef?.current
      ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      ?? panelRef.current;
    focusTarget?.focus({ preventScroll: true });
    return () => {
      unlockScroll();
      if (panel) openers.delete(panel);
      // Only when focus would otherwise be lost (on body, or inside this departing panel), so
      // an overlay opened from this one keeps its focus; and only to an opener still in the DOM.
      const active = document.activeElement;
      const lost = active === null || active === document.body || (panel !== null && panel.contains(active));
      if (!lost) return;
      const opener = [...openerRef.current].reverse().find(el => !panel?.contains(el) && restorable(el));
      opener?.focus?.({ preventScroll: true });
    };
  }, [initialFocusRef]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(n => n.offsetParent !== null || n === document.activeElement);
    if (nodes.length === 0) { e.preventDefault(); return; }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const onPanel = document.activeElement === panelRef.current;
    if (e.shiftKey && (onPanel || document.activeElement === first)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (onPanel || document.activeElement === last)) { e.preventDefault(); first.focus(); }
  };

  // No mounted gate: overlays only open after user interaction, so there is no SSR markup to
  // mismatch, and the panel must exist when the focus effect runs on the first commit.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className="wb-overlay-scrim"
        data-state={phase}
        data-instant={instant ? 'true' : undefined}
        onMouseDown={() => { if (open) onCloseRef.current(); }}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        tabIndex={-1}
        className={`wb-overlay-panel wb-overlay-panel--${variant}${panelClassName ? ` ${panelClassName}` : ''}`}
        data-state={phase}
        data-instant={instant ? 'true' : undefined}
        style={panelStyle}
        onKeyDown={onKeyDown}
      >
        <OverlayLayerContext.Provider value={layer}>
          {children}
        </OverlayLayerContext.Provider>
        <div ref={setLayer} className="wb-overlay-layer" />
      </div>
    </>,
    document.body,
  );
}
