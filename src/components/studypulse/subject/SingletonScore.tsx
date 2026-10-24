'use client';

import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import type { TransmutationTable } from '@/lib/transmutation';
import type { EntryRow } from '@/lib/studypulse/types';
import { shortDate, todayManila } from '@/lib/studypulse/ui/format';
import GradePill from './GradePill';
import { useEntryEditing, type EntryPersistence, type EntryRowsChange } from './EntryTable';

/* A constant client key: the placeholder is rebuilt every render, and updaters must still find it by key. */
const BLANK_KEY = 'singleton-new';
const blank = (name: string): EntryRow => ({
  id: 0, _key: BLANK_KEY, name, specificType: '', urgency: 'Low', status: 'Pending', deadline: '', accomplished_at: '', score: '', items: '', grade: null,
});

/** A single-score category (an exam): an inline score row instead of a one-row table (spec §6.4). */
export default function SingletonScore({
  name, entries, onChange, persistence, transTable, transmutationOn,
}: {
  name: string; entries: EntryRow[]; onChange: EntryRowsChange; persistence: EntryPersistence;
  transTable: TransmutationTable | null; transmutationOn: boolean;
}) {
  const rows = entries.length ? entries.slice(0, 1) : [blank(name)];
  /* The editor only sees the first row; keep any further rows the parent holds (and deletes of row 0 drop only row 0).
     Updaters run against the parent's latest rows, seen through the same one-row window. */
  const change: EntryRowsChange = update => onChange(prev => {
    const head = prev.length ? prev.slice(0, 1) : [blank(name)];
    const next = typeof update === 'function' ? update(head) : update;
    return [...next, ...prev.slice(1)];
  });
  const ed = useEntryEditing(rows, change, persistence);
  const row = rows[0];
  const editing = ed.isEditing(row);
  const confirming = ed.isConfirming(row);
  const err = ed.errorFor(row);
  const today = todayManila();

  return (
    <div className="sp-single sp-num">
      {editing ? (
        <>
          <span>Score</span>
          <input className="sp-input sp-input--sm" type="number" step="0.01" min="0" aria-label={`${name} score`} placeholder="—" value={row.score} onChange={e => ed.setField(0, 'score', e.target.value)} />
          <span className="sp-tone-muted">/</span>
          <input className="sp-input sp-input--sm" type="number" step="0.01" min="0.01" aria-label={`${name} items`} placeholder="100" value={row.items} onChange={e => ed.setField(0, 'items', e.target.value)} />
          <input className="sp-input sp-input--sm sp-single__date" type="date" aria-label={`${name} date`} value={row.deadline} onChange={e => ed.setField(0, 'deadline', e.target.value)} />
          <button type="button" className="sp-add sp-focus-ring" aria-busy={!!row.saving} disabled={!!row.saving} onClick={() => (row.id === 0 ? ed.saveRow(0) : ed.saveAndExit(0))}>
            {row.saving ? <><Loader2 size={14} className="sp-spin" aria-hidden /> Saving…</> : <><Check size={14} aria-hidden /> Save</>}
          </button>
          {row.id !== 0 && <button type="button" className="sp-icon-btn sp-focus-ring" aria-label="Cancel" onClick={() => ed.cancelEdit(0)}><X size={15} /></button>}
          {row.id === 0 && entries.length > 0 && <button type="button" className="sp-icon-btn sp-focus-ring" aria-label={`Discard ${name} score`} onClick={() => ed.deleteRow(0)}><X size={15} /></button>}
        </>
      ) : (
        <>
          <span className="sp-frac">{row.score || '—'} <span>/ {row.items || '—'}</span></span>
          <GradePill row={row} transTable={transTable} transmutationOn={transmutationOn} />
          <span className="sp-row-actions">
            {confirming ? (
              <>
                <button type="button" autoFocus className="sp-confirm-del sp-focus-ring" aria-label={`Confirm delete ${name} score`} onClick={() => ed.deleteRow(0)}>Delete</button>
                <button type="button" className="sp-icon-btn sp-focus-ring" aria-label="Keep score" onClick={ed.cancelDelete}><X size={15} /></button>
              </>
            ) : (
              <>
                <button type="button" className="sp-icon-btn sp-focus-ring" aria-label={`Edit ${name}`} onClick={() => ed.enterEdit(0)}><Pencil size={14} /></button>
                <button type="button" className="sp-icon-btn sp-icon-btn--danger sp-focus-ring" aria-label={`Delete ${name}`} onClick={() => ed.askDelete(0)}><Trash2 size={14} /></button>
              </>
            )}
          </span>
        </>
      )}
      {row.deadline && !editing && <span className="sp-single__note sp-tone-muted">Scheduled {shortDate(row.deadline, today)}</span>}
      {editing && row.canvas_linked && <small className="sp-row-note sp-single__msg">From Canvas: the next sync overwrites the score.</small>}
      {err && <small className="sp-row-err sp-single__msg" role="alert">{err}</small>}
    </div>
  );
}
