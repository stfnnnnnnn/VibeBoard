'use client';

import { RefreshCw } from 'lucide-react';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { formatShortDate } from '@/lib/finance/dates';

/* Spec §8.3, Addendum B: one line, shown when the active plan's last cycle has ended. */
export default function NewCycleBanner({ lastEnd, cycle, busy, onStart, onAdjust }: {
  lastEnd: string; cycle: { start: string; end: string; days: number; amount: number }; busy: boolean;
  onStart: () => void; onAdjust: () => void;
}) {
  /* Whole pesos read cleaner ("₱5,300"); an allowance with centavos keeps them. */
  const amount = Number.isInteger(Math.round(cycle.amount * 100) / 100) ? formatPesoWhole(cycle.amount) : formatPeso(cycle.amount);
  return (
    <div className="fin-banner" role="status">
      <RefreshCw size={16} aria-hidden className="fin-banner__icon" />
      <p className="fin-banner__text">
        Cycle ended {formatShortDate(lastEnd)}{' '}
        <span className="fin-banner__sub fin-num">· next: {formatShortDate(cycle.start)} – {formatShortDate(cycle.end)}, same {amount} split</span>
      </p>
      <div className="fin-banner__actions">
        <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={onAdjust}>Adjust</button>
        <button type="button" className="fin-btn fin-btn--primary fin-btn--sm" disabled={busy} onClick={onStart}>{busy ? 'Starting…' : 'Start next cycle'}</button>
      </div>
    </div>
  );
}
