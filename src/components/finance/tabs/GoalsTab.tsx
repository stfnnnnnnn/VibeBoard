'use client';

import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import { prefersReducedMotion } from '@/lib/workboard/ui/tokens';
import { formatPesoWhole } from '@/lib/finance/format';
import type { PaceSeries } from '@/lib/finance/pace';
import GoalTimeline from '../goals/GoalTimeline';
import GoalNotes from '../goals/GoalNotes';
import NewGoalForm from '../goals/NewGoalForm';
import Wishlist from '../whatif/Wishlist';
import WhatIfPreview from '../whatif/WhatIfPreview';
import type { GoalProjection, SafeToSpendResponse, WishItem } from '../types';

export default function GoalsTab({ goals, today, sts, series, wishlist, onChanged, onAddToGoal, onRecord, onSaveForIt }: {
  goals: GoalProjection[] | null; today: string; sts: SafeToSpendResponse | null; series: PaceSeries | null; wishlist: WishItem[] | null;
  onChanged: () => void; onAddToGoal: (g: GoalProjection) => void;
  onRecord: (amount: number, category: string) => Promise<void>; onSaveForIt: (amount: number, category: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  /* n = 0 is the default seed; it is derived from sts at render so landing on ?tab=goals before
     sts loads still seeds the right amount (WhatIfPreview reads `initial` only on mount). */
  const [seed, setSeed] = useState<{ amount: number; category: string; n: number } | null>(null);
  const initial = seed ?? { amount: Math.min(2500, Math.max(0, Math.floor((sts?.current_balance ?? 0) / 2))), category: 'leisure', n: 0 };
  const whatIfRef = useRef<HTMLDivElement>(null);
  const totalSaved = (goals ?? []).reduce((s, g) => s + g.saved, 0);

  return (
    <>
      <section className="fin-card" aria-labelledby="fin-goals-title">
        <div className="fin-card__head">
          <h2 className="fin-card__title" id="fin-goals-title">Goals</h2>
          {goals && goals.length > 0 && <span className="fin-hint fin-num">{formatPesoWhole(totalSaved)} saved across {goals.length} goal{goals.length === 1 ? '' : 's'}</span>}
          <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm fin-push" aria-expanded={creating} onClick={() => setCreating(c => !c)}><Plus size={14} aria-hidden /> New goal</button>
        </div>
        {creating && <NewGoalForm onCreated={() => { setCreating(false); onChanged(); }} onCancel={() => setCreating(false)} />}
        {goals === null ? (
          <WbSkeleton height={170} radius={12} />
        ) : goals.length === 0 ? (
          !creating && <div className="fin-empty"><p>No goals yet. Add one to start saving toward it.</p></div>
        ) : (
          <>
            <GoalTimeline goals={goals} today={today} />
            <GoalNotes goals={goals} today={today} onAdd={onAddToGoal} onChanged={onChanged} />
          </>
        )}
      </section>

      <section className="fin-card" aria-labelledby="fin-wish-title">
        <div className="fin-card__head">
          <h2 className="fin-card__title" id="fin-wish-title">Can I afford it?</h2>
          <span className="fin-hint">Verdicts update as your money changes</span>
        </div>
        <Wishlist items={wishlist} snapshot={sts} onChanged={onChanged}
          onCheck={(amount, category) => {
            setSeed(s => ({ amount, category, n: (s?.n ?? 0) + 1 }));
            whatIfRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
          }} />
      </section>

      <div ref={whatIfRef}>
        <WhatIfPreview key={seed ? seed.n : `default-${sts ? 'ready' : 'wait'}`} sts={sts} series={series} initial={initial} onRecord={onRecord} onSaveForIt={onSaveForIt} />
      </div>
    </>
  );
}
