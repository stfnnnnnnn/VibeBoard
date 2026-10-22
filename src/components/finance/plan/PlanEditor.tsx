'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { ALLOC_CATEGORIES } from '@/lib/finance/categories';
import { formatPeso } from '@/lib/finance/format';
import { templateToRows } from '@/lib/finance/envelopes';
import type { Tier } from '@/lib/finance/ui/colors';
import { parseAmount, requestJson } from '../financeApi';
import PesoField from '../ui/PesoField';
import type { AllocTemplate } from '../types';

type Row = { category: string; priority_tier: Tier; allocation_type: 'fixed' | 'percent'; value: number };

export default function PlanEditor({ template, initialCycle, allowanceCeiling, focusAllowance = false, onSaved, onCancel }: {
  template: AllocTemplate | null;
  initialCycle: { amount: number; start: string; end: string } | null;
  /* Decision D2: the most this cycle may be given, for a given period start (re-evaluated
     whenever "Period from" changes). null = unknown, no client-side ceiling. */
  allowanceCeiling: (periodStart: string) => number | null;
  focusAllowance?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [rows, setRows] = useState<Row[]>(template ? templateToRows(template.items) : [{ category: 'food', priority_tier: 'flexible', allocation_type: 'percent', value: 10 }]);
  const [allowance, setAllowance] = useState(initialCycle ? String(initialCycle.amount) : template?.last_allowance_amount != null ? String(template.last_allowance_amount) : '');
  const [from, setFrom] = useState(initialCycle?.start ?? template?.last_period_start ?? '');
  const [to, setTo] = useState(initialCycle?.end ?? template?.last_period_end ?? '');
  const [error, setError] = useState(() => {
    const ceil = initialCycle ? allowanceCeiling(initialCycle.start) : null;
    return initialCycle && ceil !== null && initialCycle.amount > ceil
      ? `That's more than the ${formatPeso(ceil)} you have available. Lower the allowance to start this cycle.` : '';
  });
  const ceiling = allowanceCeiling(from);
  const [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!name.trim()) { setError('Enter a plan name.'); return; }
    if (!rows.length) { setError('Add at least one category.'); return; }
    let amount: number | null = null;
    if (allowance.trim()) {
      amount = parseAmount(allowance);
      if (!amount) { setError('Allowance amount must be greater than 0.'); return; }
      if (ceiling !== null && amount > ceiling) { setError(`That's more than the ${formatPeso(ceiling)} you have available.`); return; }
      if (!from || !to) { setError('Pick a start and end date for the allowance period.'); return; }
      if (to < from) { setError('The end date must be after the start date.'); return; }
    }
    setBusy(true);
    setError('');
    try {
      await requestJson('/api/finance/allocation-templates', {
        body: {
          action: 'save', template_id: template?.template_id, name: name.trim(), items: rows,
          allowance_amount: amount ?? undefined, period_start: amount ? from : undefined, period_end: amount ? to : undefined,
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the plan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="fin-editor" onSubmit={e => { e.preventDefault(); void save(); }} aria-label={template ? `Edit ${template.name}` : 'New plan'}>
      <div className="fin-editor__grid">
        <div>
          <label className="fin-field-label" htmlFor="fin-plan-name">Plan name</label>
          <div className="fin-field"><input id="fin-plan-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Normal school week" /></div>
        </div>
        <PesoField id="fin-plan-allowance" label={ceiling !== null ? `Allowance (up to ${formatPeso(ceiling)} available)` : 'Allowance (optional)'} value={allowance} onChange={setAllowance} autoFocus={focusAllowance} />
        <div>
          <label className="fin-field-label" htmlFor="fin-plan-from">Period from</label>
          <div className="fin-field"><input id="fin-plan-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        </div>
        <div>
          <label className="fin-field-label" htmlFor="fin-plan-to">Period to</label>
          <div className="fin-field"><input id="fin-plan-to" type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></div>
        </div>
      </div>
      <p className="fin-hint fin-editor__note">Set an allowance and period to create this cycle&apos;s envelopes right away.</p>

      <div className="fin-editor__rows" role="table" aria-label="Split">
        <div className="fin-editor__row fin-editor__row--head" role="row">
          <span role="columnheader">Category</span><span role="columnheader">Tier</span><span role="columnheader">Type</span><span role="columnheader">Value</span><span />
        </div>
        {rows.map((row, i) => (
          <div className="fin-editor__row" role="row" key={i}>
            <div className="fin-field" role="cell">
              <select aria-label="Category" value={row.category} onChange={e => update(i, { category: e.target.value, priority_tier: e.target.value === 'savings' ? 'target' : row.priority_tier })}>
                {ALLOC_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="fin-field" role="cell">
              <select aria-label="Tier" value={row.priority_tier} onChange={e => update(i, { priority_tier: e.target.value as Tier })}>
                <option value="required">Essential</option><option value="target">Committed</option><option value="flexible">Flexible</option>
              </select>
            </div>
            <div className="fin-field" role="cell">
              <select aria-label="Allocation type" value={row.allocation_type} onChange={e => update(i, { allocation_type: e.target.value as Row['allocation_type'] })}>
                <option value="percent">% of allowance</option><option value="fixed">Fixed ₱</option>
              </select>
            </div>
            <div className="fin-field" role="cell">
              <span className="fin-field__prefix" aria-hidden>{row.allocation_type === 'fixed' ? '₱' : '%'}</span>
              <input aria-label="Value" inputMode="decimal" value={String(row.value)} onChange={e => update(i, { value: parseFloat(e.target.value) || 0 })} />
            </div>
            <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm fin-btn--icon" role="cell" aria-label="Remove row" onClick={() => setRows(rs => rs.filter((_, ri) => ri !== i))}><X size={14} aria-hidden /></button>
          </div>
        ))}
      </div>
      <p className="fin-hint">Essential = can&apos;t be trimmed · Committed = savings &amp; recurring · Flexible = first to trim</p>
      <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={() => setRows(rs => [...rs, { category: 'food', priority_tier: 'flexible', allocation_type: 'percent', value: 10 }])}>
        <Plus size={14} aria-hidden /> Add category
      </button>
      {error && <p className="fin-error" role="alert">{error}</p>}
      <div className="fin-editor__actions">
        <button type="button" className="fin-btn fin-btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="fin-btn fin-btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</button>
      </div>
    </form>
  );
}
