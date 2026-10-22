'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface Selection {
  selected: Set<string>;
  isSelected: (k: string) => boolean;
  /** shift extends from the last anchor over `orderedKeys` (spec 7). */
  toggle: (k: string, shift: boolean) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
  count: number;
  allState: boolean | 'mixed';
}

export function useSelection(orderedKeys: string[]): Selection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);

  // Drop keys that left the visible set (filtered out, deleted).
  useEffect(() => {
    setSelected(prev => {
      const visible = new Set(orderedKeys);
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) { if (visible.has(k)) next.add(k); else changed = true; }
      return changed ? next : prev;
    });
  }, [orderedKeys]);

  const toggle = useCallback((k: string, shift: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (shift && anchor.current !== null) {
        const a = orderedKeys.indexOf(anchor.current);
        const b = orderedKeys.indexOf(k);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(orderedKeys[i]);
          return next;
        }
      }
      if (next.has(k)) next.delete(k); else next.add(k);
      anchor.current = k;
      return next;
    });
  }, [orderedKeys]);

  const setAll = useCallback((on: boolean) => {
    setSelected(on ? new Set(orderedKeys) : new Set());
    anchor.current = null;
  }, [orderedKeys]);

  const clear = useCallback(() => { setSelected(new Set()); anchor.current = null; }, []);

  // Count only keys still in `orderedKeys`: the prune effect runs after render, so stale keys
  // would otherwise make the header checkbox flash "all" for a frame.
  const count = useMemo(() => orderedKeys.reduce((n, k) => (selected.has(k) ? n + 1 : n), 0), [orderedKeys, selected]);
  const allState: boolean | 'mixed' = count === 0 ? false : count === orderedKeys.length ? true : 'mixed';

  return useMemo(() => ({
    selected, isSelected: (k: string) => selected.has(k), toggle, setAll, clear, count, allState,
  }), [selected, toggle, setAll, clear, count, allState]);
}
