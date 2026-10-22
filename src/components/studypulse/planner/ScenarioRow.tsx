import { Check } from 'lucide-react';
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';
import { scenarios, type PeriodProjection } from '@/lib/studypulse/projection';
import { f1 } from '@/lib/studypulse/ui/format';

export default function ScenarioRow({ proj, target, scale }: { proj: PeriodProjection; target: number; scale: GradeScale | null }) {
  if (proj.remaining === 0) return null;
  return (
    <div className="sp-sec">
      <div className="sp-sec__h"><h4>If you average this on everything left</h4></div>
      <div className="sp-scen sp-num">
        {scenarios(proj).map(s => {
          // Same tolerance as the outcome's "On target" (|delta| < 0.05): a result that displays as the target counts.
          const hit = s.result >= target - 0.05;
          return (
            <div key={s.input} className={`sp-sc${hit ? ' sp-sc--hit' : ''}`}>
              <div className="sp-sc__in">{s.input}%</div>
              <div className="sp-sc__out">{f1(s.result)}</div>
              <div className="sp-sc__lt">
                {scale ? toGradeInfo(s.result, scale).letter : ''}
                {hit && <><Check size={12} strokeWidth={3} aria-hidden /><span className="sp-sr-only">meets target</span></>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
