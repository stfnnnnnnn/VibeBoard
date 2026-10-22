'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays } from 'lucide-react';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';

export type PeriodSelection = number | 'all';

type Ind = { x: number; y: number; w: number; h: number; ready: boolean };

/** Single-select period filter plus "Both"/"All" with a sliding indicator (spec §6.3).
    A group of toggle buttons (aria-pressed), not a tablist: "All" shows several period sections at once,
    which a tab (one tab, one panel) can't express. Arrow keys, Home and End still move the selection. */
export default function PeriodTabs({ periods, value, onChange }: {
  periods: Array<{ id: number; name: string; current: number | null }>;
  value: PeriodSelection;
  onChange: (v: PeriodSelection) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [ind, setInd] = useState<Ind>({ x: 0, y: 0, w: 0, h: 0, ready: false });
  const order: PeriodSelection[] = [...periods.map(p => p.id), 'all'];
  const active = Math.max(0, order.indexOf(value));
  const lastActive = useRef<number | null>(null);

  useLayoutEffect(() => {
    // The slide is switched on by the first real selection change, never by first paint, a font swap or a resize.
    const changed = lastActive.current !== null && lastActive.current !== active;
    lastActive.current = active;
    const measure = (slide: boolean) => {
      const t = tabs.current[active];
      if (!t) return;
      // y/h too: when the tabs wrap onto two rows the indicator follows the active tab's row.
      const x = t.offsetLeft, y = t.offsetTop, w = t.offsetWidth, h = t.offsetHeight;
      setInd(prev => {
        const ready = prev.ready || slide;
        return prev.x === x && prev.y === y && prev.w === w && prev.h === h && prev.ready === ready ? prev : { x, y, w, h, ready };
      });
    };
    measure(changed);
    const ro = new ResizeObserver(() => measure(false));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [active, periods]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const last = order.length - 1;
    const n = e.key === 'ArrowRight' ? (i + 1) % order.length
      : e.key === 'ArrowLeft' ? (i - 1 + order.length) % order.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1;
    if (n < 0) return;
    e.preventDefault();
    onChange(order[n]);
    tabs.current[n]?.focus();
  };

  return (
    <div ref={wrap} className="sp-ptabs" role="group" aria-label="Show grading period">
      <span className={`sp-pind${ind.ready ? ' is-ready' : ''}`} style={{ width: ind.w, height: ind.h, transform: `translate(${ind.x}px, ${ind.y}px)` }} aria-hidden />
      {periods.map((p, i) => {
        const tone = gradeTone(p.current);
        return (
          <button key={p.id} ref={el => { tabs.current[i] = el; }} type="button" aria-pressed={value === p.id}
            className="sp-ptab sp-focus-ring" onClick={() => onChange(p.id)} onKeyDown={e => onKey(e, i)}>
            <CalendarDays size={15} aria-hidden />{p.name}
            <span className={`sp-ptab__g sp-num${tone !== 'none' ? ` sp-ptab__g--${tone}` : ''}`}>{p.current === null ? '—' : f1(p.current)}</span>
          </button>
        );
      })}
      <span className="sp-ptab-sep" aria-hidden />
      <button ref={el => { tabs.current[periods.length] = el; }} type="button" aria-pressed={value === 'all'}
        className="sp-ptab sp-focus-ring" onClick={() => onChange('all')} onKeyDown={e => onKey(e, periods.length)}>
        {periods.length === 2 ? 'Both' : 'All'}
      </button>
    </div>
  );
}
