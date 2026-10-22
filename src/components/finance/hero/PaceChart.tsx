'use client';

import { useLayoutEffect, useRef } from 'react';
import { axisLabels, type PaceSeries } from '@/lib/finance/pace';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { formatDay } from '@/lib/finance/dates';
import { DUR, EASE, prefersReducedMotion } from '@/lib/workboard/ui/tokens';

export interface PaceChartProps {
  series: PaceSeries;
  /** What-if B: a hypothetical purchase stacked on today's bar, plus the new per-day line. */
  whatIf?: { amount: number; afterPerDay: number } | null;
  label: string;
  tall?: boolean;
}

/* One column per day of the cycle against the current per-day budget (spec §5.3, Addenda A–B):
   only days with spending draw a bar; past days with none stay empty, future days get a faint
   baseline tick ("still to come"), and today is a dot on the baseline until it has a bar of
   its own (the bar's ring marks it then). Every item names its column. Bars grow
   with a scaleY keyframe on mount (spec §11 rule 3). Afterwards a bar whose height changes
   (a log, an undo, a rescale, the What-if slider) moves from the height on screen to the
   new one: a FLIP scaleY from old/new to 1, which also picks up mid-animation, so dragging
   the slider glides instead of restarting from zero. The hypothetical purchase never
   rescales the chart: its bar caps at the top with an amount label. */
export default function PaceChart({ series, whatIf = null, label, tall = false }: PaceChartProps) {
  const { bars, perDay, max } = series;
  const labels = axisLabels(bars);
  const today = bars.find(b => b.isToday)?.date ?? '';
  const pct = (v: number) => Math.min(100, (v / max) * 100);
  const columns = { gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` };
  const midIndex = Math.round((bars.length - 1) / 2);
  const barEls = useRef(new Map<string, HTMLSpanElement>());
  const lastHeights = useRef(new Map<string, number>());
  const heights = new Map<string, number>();

  useLayoutEffect(() => {
    const reduce = prefersReducedMotion();
    heights.forEach((h, date) => {
      const old = lastHeights.current.get(date);
      const el = barEls.current.get(date);
      if (old === undefined || old === h || !el || reduce || typeof el.animate !== 'function') return;
      const t = getComputedStyle(el).transform;
      const scaleNow = t && t !== 'none' ? new DOMMatrixReadOnly(t).d : 1;
      const from = (old * scaleNow) / h;
      el.getAnimations().forEach(a => a.cancel());
      if (Math.abs(from - 1) < 0.001) return; // already showing the new height
      el.animate([{ transform: `scaleY(${from})` }, { transform: 'scaleY(1)' }], { duration: DUR.slow, easing: EASE });
    });
    lastHeights.current = heights;
  });

  return (
    <figure className={`fin-pace${tall ? ' fin-pace--tall' : ''}`} aria-label={label}>
      <div className="fin-pace__plot" style={columns}>
        <div className={`fin-pace__line${whatIf ? ' is-old' : ''}`} style={{ bottom: `${pct(perDay)}%` }}>
          <span className="fin-num">{formatPesoWhole(perDay)}/day</span>
        </div>
        {whatIf && (
          <div className="fin-pace__line is-after" style={{ bottom: `${pct(whatIf.afterPerDay)}%` }}>
            <span className="fin-num">{formatPesoWhole(whatIf.afterPerDay)}/day after</span>
          </div>
        )}
        {bars.map((b, i) => {
          const extra = b.isToday && whatIf ? whatIf.amount : 0;
          const total = b.amount + extra;
          /* Future days: a decorative tick, no tab stop. A past day with no spending: an empty slot.
             Today without spending: the dot. */
          if (b.future) return <span key={b.date} className="fin-pace__future" style={{ gridColumn: i + 1 }} aria-hidden />;
          if (total <= 0) return b.isToday ? <span key={b.date} className="fin-pace__today" style={{ gridColumn: i + 1 }} aria-hidden /> : null;
          const height = Math.max(pct(total), 4);
          const stripe = extra > 0 ? Math.min(100, (pct(extra) / height) * 100) : 0;
          const tip = `${formatDay(b.date, today)}: ${formatPeso(b.amount)} spent`;
          heights.set(b.date, height);
          return (
            <span
              key={b.date}
              ref={el => { if (el) barEls.current.set(b.date, el); else barEls.current.delete(b.date); }}
              role="img"
              tabIndex={0}
              aria-label={tip}
              data-tip={tip}
              className={`fin-pace__bar${b.over ? ' is-over' : ''}${b.isToday ? ' is-today' : ''}`}
              style={{ height: `${height}%`, gridColumn: i + 1 }}
            >
              {stripe > 0 && <span className="fin-pace__stripe" style={{ height: `${stripe}%` }} aria-hidden />}
              {total > max && <span className="fin-pace__cap fin-num" aria-hidden>{formatPesoWhole(total)} ↑</span>}
            </span>
          );
        })}
      </div>
      <div className="fin-pace__axis" style={columns} aria-hidden>
        {labels.map((l, i) => (
          <span key={bars[i].date} className={`${bars[i].isToday ? 'is-today' : ''}${i === midIndex ? ' is-mid' : ''}${i === bars.length - 1 ? ' is-end' : ''}`}>{l ?? ''}</span>
        ))}
      </div>
    </figure>
  );
}
