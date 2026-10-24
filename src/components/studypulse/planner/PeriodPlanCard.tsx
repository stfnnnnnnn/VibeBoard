'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';
import {
  closestReachable, defaultSlotValue, outcomeTone, planOutcome, targetPresets,
  type PeriodInput, type PeriodProjection,
} from '@/lib/studypulse/projection';
import { f1 } from '@/lib/studypulse/ui/format';
import { gradeInPct } from '@/lib/studypulse/points';
import GradeBar from './GradeBar';
import PlanSandbox, { slotKey } from './PlanSandbox';
import ScenarioRow from './ScenarioRow';
import SoloWhatIf from './SoloWhatIf';

const lt = (v: number, scale: GradeScale | null) => (scale ? toGradeInfo(v, scale) : null);

export default function PeriodPlanCard({ period, proj, scale, onTarget, onExtra }: {
  period: PeriodInput; proj: PeriodProjection; scale: GradeScale | null;
  onTarget: (v: number) => void; onExtra: (catKey: string, v: number) => void;
}) {
  const T = period.target;
  const [edits, setEdits] = useState<Record<string, number>>({});
  // A draft exists only while the user types; otherwise the field shows T in the same render the stepper changes it.
  const [targetDraft, setTargetDraft] = useState<string | null>(null);
  const def = defaultSlotValue(proj);

  const plan = useMemo(() => planOutcome(proj, proj.categories.map(c =>
    Array.from({ length: c.k }, (_, i) => edits[slotKey(c.key, i)] ?? def))), [proj, edits, def]);
  const delta = plan - T;
  const tone = outcomeTone(delta);

  // Screen readers get the outcome after the user pauses (spec §8), not on every slider tick.
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setAnnounce(`Your plan: ${f1(plan)}, ${Math.abs(delta) < 0.05 ? 'on target' : delta > 0 ? `${f1(delta)} over target` : `${f1(-delta)} short of target`}`), 300);
    return () => clearTimeout(t);
  }, [plan, delta]);

  const setT = (v: number) => onTarget(Math.max(0, Math.min(100, Math.round(v * 10) / 10)));
  const tg = lt(T, scale);
  const cg = proj.current === null ? null : lt(proj.current, scale);
  const pg = lt(plan, scale);
  const items = `${proj.remaining} remaining item${proj.remaining !== 1 ? 's' : ''}`;
  const tLabel = `${T}${tg ? ` (${tg.letter})` : ''}`;
  const bestLt = lt(proj.best, scale);
  const alts = proj.need !== null && proj.need > 100 ? closestReachable(proj, T, scale) : [];

  // Removing planned slots drops their edits too, so Reset reflects what is visible and '+' starts fresh.
  const changeExtra = (catKey: string, v: number) => {
    const c = proj.categories.find(x => x.key === catKey);
    if (c && v < c.extra) {
      const k = c.k - (c.extra - v);
      setEdits(e => Object.fromEntries(Object.entries(e).filter(([key]) => {
        const at = key.lastIndexOf('#');
        return key.slice(0, at) !== catKey || Number(key.slice(at + 1)) < k;
      })));
    }
    onExtra(catKey, v);
  };

  return (
    <article className="sp-item sp-pc" aria-label={`${period.name} plan`}>
      <div className="sp-pc__top">
        <h3>{period.name}</h3>
        <span className={`sp-status sp-status--${proj.status.tone}`}>{proj.status.label}</span>
        <div className="sp-stepper">
          <span className="sp-eyebrow">Target</span>
          <div className="sp-stp sp-num">
            <button type="button" aria-label="Lower target" onClick={() => setT(T - 1)}>−</button>
            <input aria-label={`${period.name} target percent`} inputMode="decimal" enterKeyHint="done" value={targetDraft ?? String(T)}
              onChange={e => setTargetDraft(e.target.value)}
              onBlur={() => { if (targetDraft !== null) { const v = parseFloat(targetDraft); if (Number.isFinite(v)) setT(v); } setTargetDraft(null); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            <button type="button" aria-label="Raise target" onClick={() => setT(T + 1)}>+</button>
          </div>
        </div>
      </div>
      <div className="sp-quick" role="group" aria-label="Target presets">
        {targetPresets(scale).map(p => <button key={p.label} type="button" aria-pressed={p.value === T} className="sp-focus-ring" onClick={() => setT(p.value)}>{p.label} {p.value}</button>)}
      </div>

      <div className="sp-nums sp-num">
        <div>
          <div className="sp-eyebrow">Current</div>
          <div className={`sp-nums__big ${proj.current === null ? 'sp-tone-muted' : proj.current >= T ? 'sp-tone-success' : 'sp-tone-danger'}`}>
            {proj.current === null ? '—' : <>{f1(proj.current)}<small>%</small></>}
          </div>
          <div className="sp-nums__lt">{cg ? `${cg.letter} · ${cg.description}` : proj.current === null ? 'No grades yet' : ''}</div>
        </div>
        <div className="sp-nums__side">
          <div className="sp-eyebrow">Target</div>
          <div className="sp-nums__v">{T}%{tg ? ` · ${tg.letter}` : ''}</div>
          <div className="sp-nums__cov">{gradeInPct(proj)}% of the grade is in</div>
        </div>
      </div>

      <GradeBar proj={proj} target={T} plan={plan} scale={scale} />

      {proj.status.kind === 'empty' ? (
        <div className="sp-headline sp-headline--neutral"><p>Add entries, or plan items below, to see what you need.</p></div>
      ) : proj.status.kind === 'locked-in' ? (
        <div className="sp-headline sp-headline--success"><div className="sp-headline__need">Safe</div>
          <p>{proj.remaining ? <>Even a zero on everything left keeps you at <b>{f1(proj.worst)}</b>.</> : <>Everything is graded at <b>{f1(proj.current ?? 0)}</b>.</>} {tLabel} is locked in.</p></div>
      ) : proj.need === null ? (
        <div className="sp-headline sp-headline--danger"><div className="sp-headline__need sp-num">{f1(proj.current ?? 0)}%</div>
          <p>Everything is graded at <b>{f1(proj.current ?? 0)}</b>, below <b>{tLabel}</b>. Nothing left here can change it.</p></div>
      ) : proj.need > 100 ? (
        <>
          <div className="sp-headline sp-headline--danger"><div className="sp-headline__need">&gt;100%</div>
            <p>Even a perfect score on your <b>{items}</b> lands at <b>{f1(proj.best)}{bestLt ? ` (${bestLt.letter})` : ''}</b>, so {T} isn&apos;t reachable this period.</p></div>
          {alts.length > 0 && (
            <div className="sp-alt">Closest reachable:
              {alts.map((a, i) => (
                <button key={a.label} type="button" className={`sp-chip sp-chip-btn ${i === 0 ? 'sp-chip--warn' : 'sp-chip--neutral'} sp-focus-ring`} onClick={() => setT(a.min)}>
                  {a.need <= 0 ? `${a.label} already safe` : `${a.label} needs ${f1(a.need)}`}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className={`sp-headline sp-headline--${proj.need <= 85 ? 'success' : 'warn'}`}><div className="sp-headline__need sp-num">{f1(proj.need)}%</div>
          <p>Average <b>{f1(proj.need)}%</b> on your <b>{items}</b> to finish at <b>{tLabel}</b>. Reachable range: <b>{f1(proj.worst)} – {f1(proj.best)}</b>.</p></div>
      )}

      <PlanSandbox proj={proj} edits={edits} def={def}
        onSlot={(k, v) => setEdits(e => ({ ...e, [k]: v }))}
        onExtra={changeExtra}
        onReset={() => setEdits({})} />

      {proj.remaining > 0 && (
        <div className={`sp-outcome sp-outcome--${tone} sp-num`}>
          <div><div className="sp-eyebrow">Your plan</div><div className="sp-outcome__v">{f1(plan)}</div></div>
          {pg && <span className="sp-outcome__chip">{pg.letter} · {pg.description}</span>}
          <span className="sp-outcome__chip sp-outcome__delta">
            {Math.abs(delta) < 0.05 ? <><Check size={12} strokeWidth={3} aria-hidden /> On target</>
              : delta > 0 ? <><Check size={12} strokeWidth={3} aria-hidden /> +{f1(delta)} over target</>
              : `${f1(-delta)} short of target`}
          </span>
          <span className="sp-sr-only" aria-live="polite">{announce}</span>
        </div>
      )}

      <ScenarioRow proj={proj} target={T} scale={scale} />
      <SoloWhatIf proj={proj} target={T} />
    </article>
  );
}
