'use client';

import { AlertCircle, Target, X } from 'lucide-react';
import type { GradeScale } from '@/lib/gradeScale';
import type { PeriodInput, PeriodProjection } from '@/lib/studypulse/projection';
import PeriodPlanCard from './PeriodPlanCard';

export default function TargetPlanner({ open, periods, projections, scale, transmutationOn, onClose, onTarget, onExtra, saveError, onRetry }: {
  open: boolean; periods: PeriodInput[]; projections: PeriodProjection[]; scale: GradeScale | null; transmutationOn: boolean;
  onClose: () => void; onTarget: (periodKey: string, v: number) => void; onExtra: (catKey: string, v: number) => void;
  saveError: boolean; onRetry: () => void;
}) {
  return (
    <div className={`sp-tp-shell${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="sp-tp-shell__inner">
        <section className="sp-panel sp-tp sp-tp-shell__content" aria-label="Target planner" inert={!open ? true : undefined}>
          <div className="sp-tp__head">
            <h2 className="sp-tp__title"><span className="sp-badge"><Target size={16} /></span>Target planner</h2>
            {scale && <span className="sp-chip sp-chip--blue">{scale === '4pt' ? '4.0 scale' : '1.0 scale'}{transmutationOn ? ' · transmuted' : ''}</span>}
            {saveError && (
              <span className="sp-tp__save" role="status"><AlertCircle size={14} /> Couldn&apos;t save.
                <button type="button" className="sp-link sp-tp__retry sp-focus-ring" onClick={onRetry}>Retry</button></span>
            )}
            <button type="button" className="sp-btn sp-btn--quiet sp-tp__close sp-focus-ring" onClick={onClose}><X size={15} /> Close</button>
          </div>
          <div className="sp-tp__grid">
            {periods.map((p, i) => (
              <PeriodPlanCard key={p.key} period={p} proj={projections[i]} scale={scale}
                onTarget={v => onTarget(p.key, v)} onExtra={onExtra} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
