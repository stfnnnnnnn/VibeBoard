import type { ReactNode } from 'react';
import { CalendarDays, Flag } from 'lucide-react';
import type { PeriodInput, PeriodProjection } from '@/lib/studypulse/projection';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import { gradeInPct } from '@/lib/studypulse/points';

/** `isFinal`: this period holds the subject's final grade (the 'period' rule). `hidden` keeps the panel mounted (its edit and collapse state live on) but out of layout, focus and the a11y tree. */
export default function PeriodPanel({ period, proj, isFinal, hidden = false, children }: {
  period: PeriodInput; proj: PeriodProjection; isFinal: boolean; hidden?: boolean; children: ReactNode;
}) {
  const tone = gradeTone(proj.current);
  const total = period.categories.reduce((s, c) => s + Math.max(0, c.weight), 0) || 1;
  return (
    <section className="sp-panel sp-period" aria-label={period.name} hidden={hidden}>
      <div className="sp-period__head">
        <h2 className="sp-period__title"><CalendarDays size={18} className="sp-tone-muted" aria-hidden />{period.name}</h2>
        {isFinal && <span className="sp-chip sp-chip--pink"><Flag size={12} aria-hidden /> Final grade</span>}
        <span className={`sp-chip sp-chip--${tone === 'none' ? 'neutral' : tone} sp-num`}>
          {proj.current === null ? 'No grades yet' : `${f1(proj.current)} · ${gradeInPct(proj)}% of grade in`}
        </span>
        <div className="sp-period__weights">
          <div className="sp-wbar" aria-hidden>
            {period.categories.map(c => <i key={c.key} style={{ width: `${(Math.max(0, c.weight) / total) * 100}%`, background: c.color }} />)}
          </div>
          <div className="sp-legend sp-num">
            {period.categories.map(c => <span key={c.key}><i style={{ background: c.color }} aria-hidden />{c.name} {c.weight}</span>)}
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}
