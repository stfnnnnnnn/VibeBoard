'use client';

import { useState } from 'react';
import { parseAmount, requestJson } from '../financeApi';
import PesoField from '../ui/PesoField';

export default function NewGoalForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const amount = parseAmount(target);
    if (!name.trim()) { setError('Give the goal a name.'); return; }
    if (!amount) { setError('Target amount must be greater than 0.'); return; }
    setBusy(true); setError('');
    try {
      await requestJson('/api/finance/goals', { body: { goal_name: name.trim(), wishlist_amount: amount, target_date: date || undefined } });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the goal.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="fin-editor" onSubmit={e => { e.preventDefault(); void save(); }} aria-label="New goal">
      <div className="fin-editor__grid">
        <div>
          <label className="fin-field-label" htmlFor="fin-goal-name">Goal name</label>
          <div className="fin-field"><input id="fin-goal-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Concert ticket" autoFocus /></div>
        </div>
        <PesoField id="fin-goal-target" label="Target" value={target} onChange={setTarget} />
        <div>
          <label className="fin-field-label" htmlFor="fin-goal-date">Target date (optional)</label>
          <div className="fin-field"><input id="fin-goal-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        </div>
      </div>
      {error && <p className="fin-error" role="alert">{error}</p>}
      <div className="fin-editor__actions">
        <button type="button" className="fin-btn fin-btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="fin-btn fin-btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Add goal'}</button>
      </div>
    </form>
  );
}
