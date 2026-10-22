'use client';

import type { PeriodProjection } from '@/lib/studypulse/projection';
import { f1 } from '@/lib/studypulse/ui/format';
import SlotField from './SlotField';

export const slotKey = (catKey: string, i: number) => `${catKey}#${i}`;

export function slotNames(c: PeriodProjection['categories'][number]): Array<{ name: string; planned: boolean }> {
  const out = c.pendingNames.map(name => ({ name, planned: false }));
  for (let j = 0; j < c.extra; j++) out.push({ name: `${c.noun} ${c.n + c.pendingNames.length + j + 1}`, planned: true });
  return out;
}

export default function PlanSandbox({ proj, edits, def, onSlot, onExtra, onReset }: {
  proj: PeriodProjection;
  edits: Record<string, number>;
  def: number;
  onSlot: (key: string, v: number) => void;
  onExtra: (catKey: string, v: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="sp-sec">
      <div className="sp-sec__h"><h4>Plan your remaining items</h4>
        <button type="button" className="sp-link sp-focus-ring" onClick={onReset} disabled={!Object.keys(edits).length}>Reset to required</button>
      </div>
      <p className="sp-sec__sub">Each slot starts at the required average. Drag or type to see what happens.</p>
      {proj.categories.map(c => (
        <div key={c.key} className="sp-cp">
          <div className="sp-cp__top">
            <span className="sp-cp__name"><span className="sp-cat__swatch" style={{ background: c.color }} aria-hidden />{c.name}</span>
            <span className="sp-cp__meta sp-num">{c.weight}% · {c.n} graded · {c.avg === null ? 'not graded yet' : `${f1(c.avg)} avg`}</span>
            {c.singleton ? <span className="sp-cp__count">single score</span> : (
              <span className="sp-cp__count">Remaining
                <span className="sp-stp sp-stp--mini sp-num">
                  <button type="button" aria-label={`Fewer planned ${c.name}`} disabled={c.extra === 0} onClick={() => onExtra(c.key, c.extra - 1)}>−</button>
                  <b aria-live="polite">{c.k}</b>
                  <button type="button" aria-label={`More planned ${c.name}`} disabled={c.extra >= 50} onClick={() => onExtra(c.key, c.extra + 1)}>+</button>
                </span>
              </span>
            )}
          </div>
          {c.k === 0 ? (
            <div className="sp-cp__locked">{c.avg === null ? 'Nothing logged or planned here yet.' : `Nothing left here. Its ${f1(c.avg)} is locked in.`}</div>
          ) : (
            <div className="sp-slots">
              {slotNames(c).map((s, i) => {
                const k = slotKey(c.key, i);
                return <SlotField key={k} name={s.name} planned={s.planned} dirty={k in edits} value={edits[k] ?? def} onChange={v => onSlot(k, v)} />;
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
