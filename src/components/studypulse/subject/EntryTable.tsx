'use client';

import { useCallback, useState } from 'react';
import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import type { TransmutationTable } from '@/lib/transmutation';
import type { EntryRow } from '@/lib/studypulse/types';
import { calcGrade } from '@/lib/studypulse/grades';
import { dueNote, shortDate, submittedNote, todayManila } from '@/lib/studypulse/ui/format';
import GradePill from './GradePill';

export interface EntryPersistence {
  /** Create or update; resolves to the entry id. Throws with a message on failure. */
  save: (row: EntryRow, doneAt: string | null) => Promise<number>;
  remove: (row: EntryRow) => Promise<void>;
}
export type TypeColumn = { kind: 'select'; options: string[] } | { kind: 'index' };

const NOTE_CLASS = { muted: 'sp-tone-muted', warn: 'sp-tone-warn', danger: 'sp-tone-danger' } as const;

/** A new rows list, or an updater applied to the parent's latest rows (so post-await writes never use a stale list). */
export type EntryRowsUpdate = EntryRow[] | ((prev: EntryRow[]) => EntryRow[]);
export type EntryRowsChange = (update: EntryRowsUpdate) => void;

let newRowSeq = 0;
/** Client-only identity for a row that has no DB id yet. It is kept after the first save, so the React key never changes. */
export const newRowKey = () => `new-${++newRowSeq}`;
/** Stable row identity: the client key for rows created here, else the DB id. */
export const rowKey = (r: EntryRow) => r._key ?? `id-${r.id}`;
/** Replace the row with key `key` (and only it) by `fn(row)`; a row deleted meanwhile is left alone. */
const patchByKey = (key: string, fn: (r: EntryRow) => EntryRow) => (prev: EntryRow[]) => prev.map(r => (rowKey(r) === key ? fn(r) : r));

/** Row editing for the entry tables and the single-score row. No alert()/confirm(): a failed or invalid save leaves an
    inline error on the row (`errorFor`), and deleting a saved row takes a second, inline confirmation (`askDelete`). */
export function useEntryEditing(entries: EntryRow[], onChange: EntryRowsChange, persistence: EntryPersistence) {
  const [editingIds, setEditingIds] = useState<Set<number>>(new Set());
  const [snapshots, setSnapshots] = useState<Record<number, EntryRow>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const setError = (key: string, msg: string | null) => setErrors(prev => {
    if (!msg && !(key in prev)) return prev;
    const n = { ...prev };
    if (msg) n[key] = msg; else delete n[key];
    return n;
  });
  const clearEdit = (id: number) => {
    setEditingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    setSnapshots(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const setField = useCallback((idx: number, field: keyof EntryRow, val: string) => {
    const row = entries[idx];
    setError(rowKey(row), null);
    onChange(patchByKey(rowKey(row), r => {
      const next = { ...r, [field]: val };
      if (field === 'score' || field === 'items') {
        next.grade = calcGrade(field === 'score' ? val : r.score, field === 'items' ? val : r.items);
        if (next.grade !== null) next.status = 'Done';
      }
      return next;
    }));
  }, [entries, onChange]);

  const saveRow = useCallback(async (idx: number): Promise<boolean> => {
    const row = entries[idx];
    const key = rowKey(row);
    const today = todayManila();
    const validAc = row.accomplished_at && row.accomplished_at <= today ? row.accomplished_at : null;
    const doneAt = row.status === 'Done' ? (validAc || today) : null;
    if (!row.name.trim()) { setError(key, 'Enter a name first.'); return false; }
    setError(key, null);
    onChange(patchByKey(key, r => ({ ...r, saving: true })));
    try {
      const id = await persistence.save(row, doneAt);
      onChange(patchByKey(key, r => ({ ...r, id, saving: false, accomplished_at: doneAt ?? '' })));
      return true;
    } catch (err) {
      setError(key, `Couldn't save: ${(err as Error).message}`);
      onChange(patchByKey(key, r => ({ ...r, saving: false })));
      return false;
    }
  }, [entries, onChange, persistence]);

  const enterEdit = (idx: number) => {
    const row = entries[idx];
    setConfirming(null);
    setEditingIds(prev => new Set([...prev, row.id]));
    setSnapshots(prev => ({ ...prev, [row.id]: { ...row } }));
  };
  const cancelEdit = (idx: number) => {
    const row = entries[idx];
    const snap = snapshots[row.id];
    if (snap) onChange(patchByKey(rowKey(row), () => snap));
    setError(rowKey(row), null);
    clearEdit(row.id);
  };
  const saveAndExit = async (idx: number) => { const id = entries[idx].id; if (await saveRow(idx)) clearEdit(id); };
  /** An unsaved row is dropped at once; a saved one first asks inline (see isConfirming / deleteRow). */
  const askDelete = (idx: number) => {
    const row = entries[idx];
    if (!row.id) { const key = rowKey(row); onChange(prev => prev.filter(r => rowKey(r) !== key)); return; }
    setConfirming(rowKey(row));
  };
  const cancelDelete = () => setConfirming(null);
  const deleteRow = async (idx: number) => {
    const row = entries[idx];
    const key = rowKey(row);
    setConfirming(null);
    try {
      if (row.id) await persistence.remove(row);
      setError(key, null);
      onChange(prev => prev.filter(r => rowKey(r) !== key));
    } catch (err) {
      setError(key, `Couldn't delete: ${(err as Error).message}`);
    }
  };
  const isEditing = (row: EntryRow) => row.id === 0 || editingIds.has(row.id);
  const isConfirming = (row: EntryRow) => confirming === rowKey(row);
  const errorFor = (row: EntryRow) => errors[rowKey(row)] ?? null;

  return { setField, saveRow, enterEdit, cancelEdit, saveAndExit, askDelete, cancelDelete, deleteRow, isEditing, isConfirming, errorFor };
}

export default function EntryTable({
  entries, onChange, persistence, typeColumn, transTable, transmutationOn,
}: {
  entries: EntryRow[];
  onChange: EntryRowsChange;
  persistence: EntryPersistence;
  typeColumn?: TypeColumn;
  transTable: TransmutationTable | null;
  transmutationOn: boolean;
}) {
  const ed = useEntryEditing(entries, onChange, persistence);
  const today = todayManila();

  return (
    <div className="sp-table-wrap">
      <table className="sp-et sp-num">
        <thead>
          <tr>
            <th className="sp-et__name">Name</th>
            {typeColumn && <th>{typeColumn.kind === 'index' ? '#' : 'Type'}</th>}
            <th>Due</th>
            <th>Submitted</th>
            <th className="r">Score</th>
            <th className="r">{transmutationOn ? 'Raw → Trans.' : 'Grade'}</th>
            <th className="r sp-et__actions"><span className="sp-sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((row, idx) => {
            const editing = ed.isEditing(row);
            const done = row.status === 'Done' || row.grade !== null;
            const due = dueNote(row.deadline, today, done);
            const ac = row.accomplished_at && row.accomplished_at <= today ? row.accomplished_at : '';
            const sub = submittedNote(row.deadline, ac);
            const confirming = ed.isConfirming(row);
            const err = ed.errorFor(row);
            return (
              <tr key={rowKey(row)} className={editing ? 'is-editing' : confirming ? 'is-confirming' : undefined}>
                <td>
                  {editing
                    ? <input className="sp-input sp-input--sm" aria-label="Name" value={row.name} placeholder="Name…" onChange={e => ed.setField(idx, 'name', e.target.value)} />
                    // The badge sits inline after the last word of the name, never in a column of its own (spec §5.6).
                    : <span className="sp-en"><span className="sp-en__name">{row.name || '—'}{row.canvas_linked && <span className="sp-src">Canvas</span>}</span></span>}
                  {editing && row.canvas_linked && <small className="sp-row-note">From Canvas: the next sync overwrites the score.</small>}
                  {err && <small className="sp-row-err" role="alert">{err}</small>}
                </td>
                {typeColumn && (
                  <td>
                    {typeColumn.kind === 'index' ? <span className="sp-tone-muted">#{idx + 1}</span>
                      : editing ? (
                        <select className="sp-input sp-input--sm" aria-label="Type" value={row.specificType} onChange={e => ed.setField(idx, 'specificType', e.target.value)}>
                          {typeColumn.options.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      ) : <span className="sp-date">{row.specificType || '—'}</span>}
                  </td>
                )}
                <td>
                  {editing
                    ? <input type="date" className="sp-input sp-input--sm" aria-label="Due date" value={row.deadline} onChange={e => ed.setField(idx, 'deadline', e.target.value)} />
                    : <span className="sp-date">{row.deadline ? shortDate(row.deadline, today) : '—'}{due && <small className={NOTE_CLASS[due.tone]}>{due.text}</small>}</span>}
                </td>
                <td><span className="sp-date">{ac ? shortDate(ac, today) : '—'}{sub && <small className={NOTE_CLASS[sub.tone]}>{sub.text}</small>}</span></td>
                <td className="r">
                  {editing ? (
                    <span className="sp-score-pair">
                      <input type="number" step="0.01" min="0" className="sp-input sp-input--sm" aria-label="Score" value={row.score} placeholder="—" onChange={e => ed.setField(idx, 'score', e.target.value)} />
                      <span className="sp-tone-muted">/</span>
                      <input type="number" step="0.01" min="0.01" className="sp-input sp-input--sm" aria-label="Items" value={row.items} placeholder="—" onChange={e => ed.setField(idx, 'items', e.target.value)} />
                    </span>
                  ) : <span className="sp-frac">{row.score || '—'} <span>/ {row.items || '—'}</span></span>}
                </td>
                <td className="r"><GradePill row={row} transTable={transTable} transmutationOn={transmutationOn} /></td>
                <td className="r">
                  <span className="sp-row-actions">
                    {editing ? (
                      <>
                        <button type="button" className="sp-icon-btn sp-icon-btn--ok sp-focus-ring" aria-label={row.saving ? 'Saving' : 'Save'} aria-busy={!!row.saving} disabled={!!row.saving} onClick={() => (row.id === 0 ? ed.saveRow(idx) : ed.saveAndExit(idx))}>
                          {row.saving ? <Loader2 size={15} className="sp-spin" aria-hidden /> : <Check size={15} aria-hidden />}
                        </button>
                        <button type="button" className="sp-icon-btn sp-focus-ring" aria-label="Cancel" onClick={() => (row.id === 0 ? ed.deleteRow(idx) : ed.cancelEdit(idx))}><X size={15} /></button>
                      </>
                    ) : confirming ? (
                      <>
                        {/* Focus moves here so the confirmation is announced and Enter completes it. */}
                        <button type="button" autoFocus className="sp-confirm-del sp-focus-ring" aria-label={`Confirm delete ${row.name}`} onClick={() => ed.deleteRow(idx)}>Delete</button>
                        <button type="button" className="sp-icon-btn sp-focus-ring" aria-label="Keep entry" onClick={ed.cancelDelete}><X size={15} /></button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="sp-icon-btn sp-focus-ring" aria-label={`Edit ${row.name}`} onClick={() => ed.enterEdit(idx)}><Pencil size={14} /></button>
                        <button type="button" className="sp-icon-btn sp-icon-btn--danger sp-focus-ring" aria-label={`Delete ${row.name}`} onClick={() => ed.askDelete(idx)}><Trash2 size={14} /></button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
