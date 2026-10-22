'use client';

import { TIER_META } from '@/lib/finance/ui/colors';
import { categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import { formatPesoWhole } from '@/lib/finance/format';
import type { EnvelopeModel } from '@/lib/finance/envelopes';

/* One budget envelope (spec §8.2, Addenda A–B): ₱ left large, "of ₱cap", bar with a cycle-pace
   tick. The tier is the group heading above the cards, so the card has no tier chip (screen
   readers still hear it in the label). The whole card is the adjust button. */
export default function Envelope({ env, elapsedPct, onAdjust }: {
  env: EnvelopeModel; elapsedPct: number | null; onAdjust: (env: EnvelopeModel, anchor: HTMLElement) => void;
}) {
  const tier = TIER_META[env.tier];
  const name = env.isSavings ? 'Savings' : categoryLabel(env.category);
  const big = env.over
    ? (env.isSavings ? 'Fully funded' : `${formatPesoWhole(-env.left)} over`)
    : formatPesoWhole(env.left);
  const used = env.spent > 0 ? ` · ${env.pct}% ${env.isSavings ? 'funded' : 'used'}` : '';
  const of = `${env.isSavings ? 'to save' : `of ${formatPesoWhole(env.cap)}`}${used}`;
  const spoken = env.isSavings
    ? `${big}${env.over ? '' : ' to save'} of ${formatPesoWhole(env.cap)}${used}`
    : `${big}${env.over ? '' : ' left'} of ${formatPesoWhole(env.cap)}${used}`;
  const fill = env.cap > 0 ? Math.min(1, env.spent / env.cap) : 0;
  return (
    <button
      type="button"
      className={`fin-env${env.over && !env.isSavings ? ' is-over' : ''}`}
      aria-label={`${name}, ${tier.label}: ${spoken}. Adjust this cycle's cap`}
      onClick={e => onAdjust(env, e.currentTarget)}
    >
      <span className="fin-env__head">
        <span aria-hidden>{env.isSavings ? '◎' : categoryEmoji(env.category)}</span>
        <span className="fin-env__name" title={name}>{name}</span>
      </span>
      <span className="fin-env__left fin-num">{big}</span>
      <span className="fin-env__of fin-num">{of}</span>
      <span className="fin-track fin-env__track" aria-hidden>
        <span className="fin-track__fill" style={{ background: env.over && !env.isSavings ? 'var(--wb-danger)' : tier.fill, transform: `scaleX(${fill})` }} />
        {elapsedPct !== null && !env.isSavings && <span className="fin-env__tick" style={{ left: `${elapsedPct}%` }} />}
      </span>
      {(env.isOverride || env.fasterThanPlan) && (
        <span className="fin-env__flags">
          {env.isOverride && <span className="fin-pill fin-pill--warn">Adjusted</span>}
          {env.fasterThanPlan && <span className="fin-env__warn">Spending faster than plan</span>}
        </span>
      )}
    </button>
  );
}
