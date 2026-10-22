'use client';

import { useState, type CSSProperties } from 'react';
import { previewSpend, verdictZones, type Verdict } from '@/lib/finance/verdict';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { EXPENSE_CATEGORIES } from '@/lib/finance/categories';
import type { PaceSeries } from '@/lib/finance/pace';
import PaceChart from '../hero/PaceChart';
import { parseAmount, requestJson } from '../financeApi';
import type { SafeToSpendResponse } from '../types';

const VERDICT_TEXT: Record<Verdict, { label: string; pill: string }> = {
  comfortable: { label: 'Affordable', pill: 'fin-pill--success' },
  tight: { label: 'Affordable, but tight', pill: 'fin-pill--warn' },
  not_recommended: { label: 'Not recommended', pill: 'fin-pill--danger' },
};

/* The typed amount shown with thousands separators ("2,500"; "2,500.50" keeps its cents).
   Focus strips the commas again so editing stays plain digits. */
function groupDigits(n: number): string {
  return formatPeso(n).replace('₱', '').replace(/\.00$/, '');
}

/* What-if B (spec §10.3): drag or type an amount and the pace chart redraws live. All maths
   is client-side; Record it re-checks with /api/finance/what-if before writing. */
export default function WhatIfPreview({ sts, series, initial, onRecord, onSaveForIt }: {
  sts: SafeToSpendResponse | null; series: PaceSeries | null; initial: { amount: number; category: string };
  onRecord: (amount: number, category: string) => Promise<void>; onSaveForIt: (amount: number, category: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(initial.amount);
  const [raw, setRaw] = useState(() => groupDigits(initial.amount));
  const [category, setCategory] = useState(initial.category);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!sts || !series) return null;

  const balance = Math.max(0, Math.floor(sts.current_balance));
  const preview = previewSpend(sts, amount);
  const zones = verdictZones(sts);
  const zoneStyle = {
    '--fin-z1': `${balance ? (zones.tightFrom / balance) * 100 : 0}%`,
    '--fin-z2': `${balance ? (zones.notFrom / balance) * 100 : 0}%`,
  } as CSSProperties;
  const verdict = VERDICT_TEXT[preview.verdict];
  /* Only zones that actually occupy part of the track get a label (decision D3). */
  const zoneLabels = [
    { label: 'Comfortable', width: zones.tightFrom },
    { label: 'Tight', width: zones.notFrom - zones.tightFrom },
    { label: 'Not recommended', width: balance - zones.notFrom },
  ].filter(z => z.width > 0);
  /* The true deficit (decision D3): `raw` is unclamped, so a negative figure is how far over. */
  const { before, after } = preview;
  // Deficits under ₱1 keep their cents so the line never reads "₱0 over".
  const over = (raw: number) => (-raw < 1 ? formatPeso(-raw) : formatPesoWhole(-raw));
  const safeLine = before.raw < 0
    ? amount > 0 ? `Already ${over(before.raw)} over · would be ${over(after.raw)} over` : `Already ${over(before.raw)} over`
    : after.raw < 0
      ? `Safe to spend ${formatPesoWhole(before.safe)} → ${over(after.raw)} over`
      : `Safe to spend ${formatPesoWhole(before.safe)} → ${formatPesoWhole(after.safe)}`;

  const record = async () => {
    setBusy(true); setError('');
    try {
      const server = await requestJson<{ after: { safe_to_spend: number } }>('/api/finance/what-if', { body: { type: 'expense', amount } });
      if (Math.abs(server.after.safe_to_spend - preview.after.safe) > 1) {
        setError('Your numbers just changed. Check the preview again before recording.');
        return;
      }
      await onRecord(amount, category);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  const saveForIt = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await onSaveForIt(amount, category);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="fin-card fin-whatif" aria-labelledby="fin-whatif-title">
      <div className="fin-card__head">
        <h2 className="fin-card__title" id="fin-whatif-title">What if I spend…</h2>
        <select className="fin-chip fin-chip--select is-on" aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}>
          {EXPENSE_CATEGORIES.map(([k, l, emoji]) => <option key={k} value={k}>{emoji} {l}</option>)}
        </select>
        <label className="fin-whatif__amount fin-push">
          <span aria-hidden>₱</span>
          <span className="fin-whatif__sizer" data-value={raw || '0'}>
            <input inputMode="decimal" aria-label="Amount" className="fin-num" value={raw}
              /* Stripping the commas rewrites the value, which drops any selection, so the whole
                 amount is re-selected: typing after focus replaces it instead of appending. */
              onFocus={e => { const el = e.currentTarget; setRaw(r => r.replace(/,/g, '')); requestAnimationFrame(() => { if (document.activeElement === el) el.select(); }); }}
              onBlur={() => { const n = parseAmount(raw); if (n !== null) setRaw(groupDigits(n)); }}
              onChange={e => { setRaw(e.target.value); const n = parseAmount(e.target.value); setAmount(n ?? 0); }} />
          </span>
        </label>
      </div>
      {balance > 0 ? (
        <>
          <input type="range" className="fin-slider" style={zoneStyle} min={0} max={balance} step={50} value={Math.min(amount, balance)}
            aria-label="Amount to preview" aria-valuetext={`${formatPeso(amount)}, ${verdict.label}`}
            onChange={e => { const n = Number(e.target.value); setAmount(n); setRaw(groupDigits(n)); }} />
          <div className="fin-slider__zones" aria-hidden>{zoneLabels.map(z => <span key={z.label}>{z.label}</span>)}</div>
        </>
      ) : (
        <p className="fin-hint">Nothing left to spend until your next allowance.</p>
      )}
      <PaceChart series={series} tall whatIf={amount > 0 ? { amount, afterPerDay: preview.after.perDay } : null}
        label={`Preview: spending ${formatPeso(amount)} today changes your daily budget to ${formatPesoWhole(preview.after.perDay)}`} />
      <div className="fin-whatif__verdict">
        {amount > 0 && <span className={`fin-pill ${verdict.pill}`}>{verdict.label}</span>}
        <span className="fin-hint fin-num fin-whatif__line">
          {safeLine} ·{' '}
          {preview.billsCovered ? 'bills still covered ✓' : <span className="fin-whatif__risk">bills at risk</span>}
        </span>
        <span className="fin-push fin-whatif__acts">
          <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={busy || amount <= 0} onClick={record}>Record it</button>
          <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={saving || amount <= 0} onClick={saveForIt}>Save for it instead →</button>
        </span>
      </div>
      {error && <p className="fin-error" role="alert">{error}</p>}
    </section>
  );
}
