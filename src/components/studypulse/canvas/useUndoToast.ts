'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastInput {
  message: string;
  /** Shows an Undo button; the toast closes once it resolves, or shows the error if it throws. */
  undo?: () => Promise<void>;
  /** Shows a link instead of (or beside) Undo, e.g. "View in Workboard". */
  link?: { href: string; label: string };
}

export interface ToastState extends ToastInput {
  id: number;
  leaving: boolean;
  undoing: boolean;
}

const LIFETIME_MS = 5000;
const EXIT_MS = 160; // matches .sp-toast's exit transition

/**
 * One toast at a time (spec §6 C5): show() replaces whatever is up and restarts the 5 s clock. The clock pauses while
 * the pointer or focus is on the toast and while the tab is hidden, so an Undo is never pulled out from under the user.
 */
export function useUndoToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef(0);   // when the running clock fires
  const remaining = useRef(0);  // left on a paused clock
  const paused = useRef(false);
  const undoing = useRef(false);  // an Undo request is in flight: the clock stays stopped

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const dismiss = useCallback(() => {
    clear();
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setToast(t => (t ? { ...t, leaving: true } : t));
    exitTimer.current = setTimeout(() => setToast(t => (t?.leaving ? null : t)), EXIT_MS);
  }, []);

  const start = useCallback((ms: number) => {
    clear();
    deadline.current = Date.now() + ms;
    timer.current = setTimeout(dismiss, ms);
  }, [dismiss]);

  const show = useCallback((input: ToastInput) => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    seq.current += 1;
    undoing.current = false;
    setToast({ ...input, id: seq.current, leaving: false, undoing: false });
    paused.current = false;
    start(LIFETIME_MS);
  }, [start]);

  const pause = useCallback(() => {
    if (paused.current || !timer.current) return;
    paused.current = true;
    remaining.current = Math.max(0, deadline.current - Date.now());
    clear();
  }, []);

  const resume = useCallback(() => {
    if (!paused.current) return;
    paused.current = false;
    if (undoing.current) return;
    start(Math.max(remaining.current, 1500));
  }, [start]);

  const runUndo = useCallback(async () => {
    const current = toast;
    if (!current?.undo || undoing.current) return;
    undoing.current = true;
    clear();
    setToast(t => (t && t.id === current.id ? { ...t, undoing: true } : t));
    try {
      await current.undo();
      undoing.current = false;
      dismiss();
    } catch (err) {
      show({ message: (err as Error).message || 'Couldn’t undo that. Try again.' });
    }
  }, [toast, dismiss, show]);

  useEffect(() => {
    const onVis = () => (document.hidden ? pause() : resume());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clear();
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [pause, resume]);

  return { toast, show, dismiss, pause, resume, runUndo };
}

export type UndoToastApi = ReturnType<typeof useUndoToast>;
