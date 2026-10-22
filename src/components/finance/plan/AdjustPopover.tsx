'use client';

import { useState } from 'react';
import WbPopover from '@/components/workboard/ui/WbPopover';
import { categoryLabel } from '@/lib/finance/categories';
import { formatPeso } from '@/lib/finance/format';
import type { EnvelopeModel } from '@/lib/finance/envelopes';
import { parseAmount, requestJson } from '../financeApi';
import PesoField from '../ui/PesoField';

/* This-cycle override and reset (spec §8.2), ported from the old Budget Progress
   submitOverride/resetOverride/maxFor (financetracker-log.md §28, §36). The cap can't grow
   past the cycle's unallocated money plus this category's own current cap. */
export default function AdjustPopover({ env, anchor, remainingCycleAllowance, onClose, onSaved }: {
  env: EnvelopeModel | null; anchor: HTMLElement | null; remainingCycleAllowance: number | null; onClose: () => void; onSaved: () => void;
}) {
  const [raw, setRaw] = useState(env ? String(env.cap) : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!env) return null;
  const name = env.isSavings ? 'Savings' : categoryLabel(env.category);
  const max = remainingCycleAllowance !== null ? Math.round((remainingCycleAllowance + env.cap) * 100) / 100 : null;

  const save = async () => {
    const amount = parseAmount(raw);
    if (!amount) { setError('Enter an amount greater than 0.'); return; }
    if (max !== null && amount > max + 0.01) { setError(`That would put the cycle over its total. The most you can assign here is ${formatPeso(max)}.`); return; }
    setBusy(true);
    try {
      await requestJson('/api/finance/budgets', { body: { action: 'override', category: env.category, amount, reason: reason.trim() || undefined } });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (env.budgetId === null) return;
    setBusy(true);
    try {
      await requestJson('/api/finance/budgets', { body: { action: 'reset', budget_id: env.budgetId } });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <WbPopover open={!!anchor} anchor={anchor} onClose={onClose} width={300} labelledBy="fin-adjust-title">
      <form className="fin-adjust" onSubmit={e => { e.preventDefault(); void save(); }}>
        <p className="fin-adjust__title" id="fin-adjust-title">Adjust {name}</p>
        <PesoField id="fin-adjust-amount" label="This cycle's cap" value={raw} onChange={v => { setRaw(v); setError(''); }} autoFocus />
        <label className="fin-field-label" htmlFor="fin-adjust-reason">Reason (optional)</label>
        <div className="fin-field"><input id="fin-adjust-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. org event week" /></div>
        {env.planAmount !== null && <p className="fin-hint fin-adjust__plan fin-num">Plan allocation: {formatPeso(env.planAmount)}. This cycle only, the plan won&apos;t change.</p>}
        {max !== null && <p className="fin-hint fin-num">Up to {formatPeso(max)}</p>}
        {error && <p className="fin-error" role="alert">{error}</p>}
        <div className="fin-adjust__row">
          {env.isOverride && env.planAmount !== null && env.budgetId !== null && (
            <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={busy} onClick={reset}>Reset to plan</button>
          )}
          <button type="submit" className="fin-btn fin-btn--primary fin-btn--sm fin-push" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </WbPopover>
  );
}
