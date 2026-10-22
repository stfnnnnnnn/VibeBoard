'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { goalMarkerDate, goalState, stackLabelRows, timelineLayout } from '@/lib/finance/goals';
import { formatFullDate, formatMonthYear } from '@/lib/finance/dates';
import type { GoalProjection } from '../types';
import { GOAL_STATE_META } from './GoalNotes';

/* A slim dot strip of when each goal lands, with a Today line (spec §10.1, Addendum A).
   Close markers stack their labels into up to 3 rows (14px apart, finance.css): rows start
   from timelineLayout's percentage guess, then are re-stacked from the labels' measured pixel
   extents (and the Today label's) whenever the strip resizes, so labels never collide. The strip
   is decorative (the ring cards carry every date); screen readers get the ordered list
   instead. It is hidden for more than 6 goals and, via CSS, on phones. */
export default function GoalTimeline({ goals, today }: { goals: GoalProjection[]; today: string }) {
  const layout = timelineLayout(goals, today);
  const stripRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Record<number, number> | null>(null);
  const markerKey = layout.markers.map(m => `${m.goal_id}:${m.pos.toFixed(2)}`).join(',');

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const restack = () => {
      const lbls = [...strip.querySelectorAll<HTMLElement>('.fin-tl__lbl')]
        .map(el => ({ id: Number(el.dataset.goal), r: el.getBoundingClientRect() }))
        .sort((a, b) => a.r.left - b.r.left);
      const now = strip.querySelector<HTMLElement>('.fin-tl__now span')?.getBoundingClientRect();
      const rows = stackLabelRows(lbls.map(l => l.r), now ? [{ left: now.left, right: now.right, row: 0 }] : []);
      const next: Record<number, number> = {};
      lbls.forEach((l, i) => { next[l.id] = rows[i]; });
      setMeasured(prev => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    restack();
    const ro = new ResizeObserver(restack);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [markerKey]);
  const rowOf = (m: { goal_id: number; row: number }) => measured?.[m.goal_id] ?? m.row;
  const byId = new Map(goals.map(g => [g.goal_id, g]));
  const sorted = goals.map(g => ({ g, date: goalMarkerDate(g) })).filter(x => x.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const describe = (g: GoalProjection, date: string) => {
    const state = goalState(g, today);
    return `${g.goal_name}: ${g.target_date ? `target ${formatFullDate(date)}` : `projected ${formatMonthYear(date)}`}${state === 'date_passed' ? ' (passed)' : ''}, ${Math.floor(g.progress_percent)}% saved`;
  };
  const srList = sorted.length > 0 && <ol className="fin-sr-only">{sorted.map(({ g, date }) => <li key={g.goal_id}>{describe(g, date!)}</li>)}</ol>;

  if (layout.useList || layout.markers.length === 0) return <>{srList}</>;

  const rows = Math.max(...layout.markers.map(rowOf));
  return (
    <div className="fin-tl-wrap">
      <div className="fin-tl" ref={stripRef} style={{ '--fin-tl-rows': rows } as CSSProperties} aria-hidden>
        <div className="fin-tl__axis" />
        {layout.ticks.map(t => <span key={t.date} className="fin-tl__tick" style={{ left: `${t.pos}%` }}>{t.label}</span>)}
        <div className="fin-tl__now" style={{ left: `${layout.todayPos}%` }}><span>Today</span></div>
        {layout.markers.map(m => {
          const g = byId.get(m.goal_id)!;
          const meta = GOAL_STATE_META[goalState(g, today)];
          /* Edge labels anchor to the dot's side so they can't overflow the strip. */
          const edge = m.pos < 12 ? ' is-start' : m.pos > 88 ? ' is-end' : '';
          return (
            <span key={m.goal_id} title={g.goal_name}>
              <span className="fin-tl__dot" style={{ left: `${m.pos}%`, background: meta.dot }} />
              <span className={`fin-tl__lbl${edge}`} data-goal={m.goal_id} style={{ left: `${m.pos}%`, color: meta.ink, '--fin-tl-row': rowOf(m) } as CSSProperties}>{g.goal_name}</span>
            </span>
          );
        })}
      </div>
      {srList}
    </div>
  );
}
