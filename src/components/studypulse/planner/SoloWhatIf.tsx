import { ChevronDown, Calculator } from 'lucide-react';
import { soloNeed, type PeriodProjection } from '@/lib/studypulse/projection';
import { f1 } from '@/lib/studypulse/ui/format';

export default function SoloWhatIf({ proj, target }: { proj: PeriodProjection; target: number }) {
  if (proj.remaining === 0) return null;
  return (
    <details className="sp-wi">
      <summary className="sp-focus-ring"><Calculator size={15} aria-hidden /> What if only one category changes? <ChevronDown size={15} className="sp-chev" aria-hidden /></summary>
      <div className="sp-wi__body sp-num">
        <div className="sp-wi__lead">Every other remaining item holds your current average{proj.current !== null ? ` (${f1(proj.current)})` : ''}.</div>
        {proj.categories.map((c, i) => {
          const x = soloNeed(proj, target, i);
          const [cls, txt] = x === null ? ['sp-tone-muted', 'locked']
            : x > 100 ? ['sp-tone-danger', 'out of reach']
            : x <= 0 ? ['sp-tone-success', 'already safe']
            : [x <= 85 ? 'sp-tone-success' : 'sp-tone-warn', `need ${f1(x)}${c.k > 1 ? ' avg' : ''}`];
          return <div key={c.key} className="sp-wi__item"><b>{c.name}</b><span className="sp-wi__left">· {c.k} left</span><span className={`r ${cls}`}>{txt}</span></div>;
        })}
      </div>
    </details>
  );
}
