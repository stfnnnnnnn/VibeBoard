import type { CSSProperties } from 'react';
import { Check, TrendingDown } from 'lucide-react';
import type { GradeScale } from '@/lib/gradeScale';
import { scaleThresholds, type PeriodProjection, type Threshold } from '@/lib/studypulse/projection';
import { f1 } from '@/lib/studypulse/ui/format';

/** Domain is 50–100 (spec §6.5.3): every grade decision happens there, so the letter bands get room. */
export const barPos = (v: number) => Math.max(0, Math.min(100, (v - 50) * 2));

/** Thin the axis labels so none collide on a narrow card (dataviz: selective labels, never overlap).
    Priority: the target's own band, then the passing line (lowest), then the top band, then the rest
    high to low. Wider labels ("1.25") need more room than letters ("B+"). */
function visibleTicks(ticks: Threshold[], hit: string | undefined): Threshold[] {
  const gap = ticks.some(t => t.label.length > 2) ? 12 : 8;
  const order = [...ticks.filter(t => t.label === hit), ticks[ticks.length - 1], ticks[0], ...ticks].filter(Boolean);
  const kept: Threshold[] = [];
  for (const t of order) {
    if (kept.includes(t)) continue;
    if (kept.every(k => Math.abs(barPos(k.min) - barPos(t.min)) >= gap)) kept.push(t);
  }
  return kept;
}

/** Keeps an edge label inside the track: anchor shifts and the caret follows the true position. */
const anchor = (p: number) => (p > 88 ? 80 : p < 12 ? 20 : 50);

export default function GradeBar({ proj, target, plan, scale }: {
  proj: PeriodProjection; target: number; plan: number; scale: GradeScale | null;
}) {
  const cur = proj.current;
  const ok = cur !== null && cur >= target;
  const lo = barPos(proj.worst), hi = barPos(proj.best);
  const tp = barPos(target);
  const cp = cur === null ? 0 : barPos(cur);
  const all = scaleThresholds(scale).filter(t => t.min >= 50);
  const hit = all.filter(t => t.min <= target)[0]?.label;
  const ticks = visibleTicks(all, hit);
  const pinA = anchor(tp);
  const curA = cp > 80 ? 85 : cp < 12 ? 15 : 50;
  // Nothing left to plan: the outcome card is hidden too, so the ring would only mark a meaningless 0.
  const hasPlan = proj.remaining > 0;

  return (
    <div className="sp-gbar sp-num" role="img"
      aria-label={`Current ${cur === null ? 'none' : f1(cur)}, target ${target}, reachable ${f1(proj.worst)} to ${f1(proj.best)}${hasPlan ? `, your plan ${f1(plan)}` : ''}`}>
      <div className="sp-gbar__track">
        <div className="sp-gbar__range" style={{ transform: `translateX(${lo}%)` }}>
          <div className="sp-gbar__range-in" style={{ transform: `scaleX(${Math.max(0, hi - lo) / 100})` }} />
        </div>
        <div className={`sp-gbar__fill sp-gbar__fill--${ok ? 'success' : 'danger'}`} style={{ transform: `scaleX(${cp / 100})` }} />
      </div>
      <div className="sp-gbar__tmark" style={{ left: `${tp}%` }} />
      {cur !== null && (
        <div className={`sp-gbar__cur ${ok ? 'sp-tone-success' : 'sp-tone-danger'}`}
          style={{ left: `${cp}%`, transform: `translateX(-${curA}%)` }}>
          {ok ? <Check size={12} strokeWidth={3} aria-hidden /> : <TrendingDown size={12} strokeWidth={3} aria-hidden />}
          {f1(cur)} now
        </div>
      )}
      {hasPlan && (
        <div className="sp-gbar__plan-clip">
          <div className="sp-gbar__plan-layer" style={{ transform: `translateX(${barPos(plan)}%)` }}><span className="sp-gbar__plan" /></div>
        </div>
      )}
      <span className="sp-gbar__axis0">50</span>
      <div className="sp-gbar__ticks">
        {ticks.map(t => <span key={t.label} className={t.label === hit ? 'is-hit' : undefined} style={{ left: `${barPos(t.min)}%` }}>{t.label}</span>)}
      </div>
      <div className="sp-gbar__pin" style={{ left: `${tp}%`, transform: `translateX(-${pinA}%)`, '--caret': `${pinA}%` } as CSSProperties}>
        Target {target}
      </div>
    </div>
  );
}
