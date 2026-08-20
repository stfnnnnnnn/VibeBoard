'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import GradingSetupWizard, { type GradingPresetFull } from './GradingSetupWizard';
import TargetGradePanel from './TargetGradePanel';
import {
  loadTransmutationTable, transmute, avgTransmuted,
  type TransmutationTable,
} from '@/lib/transmutation';
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';

/* ── Types ── */

export type Urgency     = 'High' | 'Medium' | 'Low';
export type EntryStatus = 'Pending' | 'Done';
export type GradeMode   = 'finals' | 'midterm' | 'whatif';
export type SectionType = 'activities' | 'quizzes' | 'exams';
export type ViewMode    = 'grade' | 'task';

export interface EntryRow {
  id:              number;
  name:            string;
  specificType:    string;
  urgency:         Urgency;
  status:          EntryStatus;
  deadline:        string;
  accomplished_at: string;
  score:           string;
  items:           string;
  grade:           number | null;
  canvas_linked?:  boolean;
  saving?:         boolean;
}

export interface GradingConfig {
  preset_id:   number;
  has_lab:     number;
  lec_weight:  number;
  lab_weight:  number;
  grade_scale: GradeScale | null;
  preset:      GradingPresetFull;
}

/* ── Styles ── */

const GLASS: React.CSSProperties = {
  background:          'rgba(255,255,255,0.2)',
  backdropFilter:      'blur(14px)',
  WebkitBackdropFilter:'blur(14px)',
  borderRadius:        '20px',
  border:              '1px solid rgba(255,255,255,0.3)',
  boxShadow:           '0 8px 24px rgba(0,0,0,0.12)',
};

const INPUT: React.CSSProperties = {
  width:        '100%',
  padding:      '5px 8px',
  borderRadius: '8px',
  border:       '1px solid rgba(200,200,220,0.4)',
  background:   'rgba(255,255,255,0.75)',
  fontSize:     '0.82rem',
  boxSizing:    'border-box',
  fontFamily:   'inherit',
};

/* ── Grade / urgency helpers ── */

function calcGrade(score: string, items: string): number | null {
  const s = parseFloat(score);
  const i = parseFloat(items);
  if (!score || isNaN(s) || isNaN(i) || i <= 0) return null;
  return parseFloat(((s / i) * 100).toFixed(2));
}

function avgGrades(rows: EntryRow[]): number {
  const valid = rows.filter(r => r.grade !== null);
  if (!valid.length) return 0;
  return parseFloat((valid.reduce((s, r) => s + r.grade!, 0) / valid.length).toFixed(2));
}

function examAvg(rows: EntryRow[], type: string): number {
  return avgGrades(rows.filter(r => r.specificType === type));
}

function examTransmuted(rows: EntryRow[], type: string, table: TransmutationTable): number {
  return avgTransmuted(rows.filter(r => r.specificType === type), table);
}

const URGENCY_STYLE: Record<Urgency, { bg: string; text: string }> = {
  High:   { bg: 'rgba(254,226,226,0.8)', text: '#dc2626' },
  Medium: { bg: 'rgba(254,243,199,0.8)', text: '#d97706' },
  Low:    { bg: 'rgba(220,252,231,0.8)', text: '#16a34a' },
};
const STATUS_STYLE: Record<EntryStatus, { bg: string; text: string }> = {
  Done:    { bg: 'rgba(220,252,231,0.8)', text: '#16a34a' },
  Pending: { bg: 'rgba(243,244,246,0.8)', text: '#6b7280' },
};

function gradeStyle(g: number | null): { bg: string; text: string } {
  if (g === null)  return { bg: 'rgba(243,244,246,0.7)', text: '#9ca3af' };
  if (g >= 75)     return { bg: 'rgba(220,252,231,0.9)', text: '#15803d' };
  if (g >= 65)     return { bg: 'rgba(254,243,199,0.9)', text: '#b45309' };
  return                  { bg: 'rgba(254,226,226,0.9)', text: '#dc2626' };
}

/* ── Collective Final Grade: pools every category instance from every period
   into one weighted total, each at its own (independently set) local weight —
   a period's copy of a linked category is never forced to match another
   period's weight for it. `resolvedGrade`/`resolvedHasData` already fold in
   score carry-forward (a linked singleton reusing a sibling's score), so this
   function just does the pooled weighted average: a still-ungraded category
   is assumed perfect (100) as long as SOMETHING in the pool has data; if
   nothing anywhere does, the result is 0. */
type PresetCategory = GradingConfig['preset']['periods'][number]['categories'][number];

function computeCollectiveGrade(
  periods:         GradingConfig['preset']['periods'],
  resolvedGrade:   (cat: PresetCategory) => number,
  resolvedHasData: (cat: PresetCategory) => boolean,
): number {
  const allCats = periods.flatMap(p => p.categories);
  if (!allCats.some(resolvedHasData)) return 0;
  let ws = 0, tw = 0;
  for (const cat of allCats) {
    const g = resolvedHasData(cat) ? resolvedGrade(cat) : 100;
    ws += g * Number(cat.weight);
    tw += Number(cat.weight);
  }
  return tw > 0 ? ws / tw : 0;
}

/* ── Mini circular gauge for category headers ── */

function MiniGauge({ value, color }: { value: number; color: string }) {
  const pct  = Math.min(100, Math.max(0, value));
  const r    = 13;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(200,210,230,0.4)" strokeWidth="3" />
      <circle
        cx="18" cy="18" r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 18 18)"
        style={{ transition: 'stroke-dasharray 0.4s ease' }}
      />
      <text
        x="18" y="22"
        textAnchor="middle"
        fontSize={value >= 100 ? '8' : '10'}
        fontWeight="700"
        fill={color}
        fontFamily="inherit"
      >
        {value > 0 ? value.toFixed(0) : '—'}
      </text>
    </svg>
  );
}

/* ── Shared grade cell (raw + transmuted side-by-side) ── */

function GradeCell({
  raw, score, items, transTable, transmutationOn, compact,
}: {
  raw:             number | null;
  score:           string;
  items:           string;
  transTable:      TransmutationTable | null;
  transmutationOn: boolean;
  compact?:        boolean;
}) {
  const tg = (transmutationOn && transTable)
    ? transmute(score, items, transTable)
    : null;

  const displayGrade = tg !== null ? tg : raw;
  const gs           = gradeStyle(displayGrade);

  const pill = (
    <span style={{
      display: 'inline-block', padding: compact ? '2px 7px' : '3px 9px',
      borderRadius: '999px', fontWeight: 700,
      fontSize: compact ? '0.76rem' : '0.8rem',
      background: gs.bg, color: gs.text,
      minWidth: compact ? '44px' : '52px',
      textAlign: 'center',
    }}>
      {tg !== null
        ? tg
        : raw !== null
          ? raw.toFixed(2)
          : '—'}
    </span>
  );

  if (!transmutationOn || tg === null || raw === null) return pill;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flexWrap: 'nowrap' }}>
      <span style={{ fontSize: '0.7rem', color: '#aaa', whiteSpace: 'nowrap' }}>
        {raw.toFixed(1)}
      </span>
      <span style={{ color: '#ccc', fontSize: '0.7rem' }}>→</span>
      {pill}
    </div>
  );
}

/* ═══════════════════════════════════════════
   EntrySection — legacy (activities / quizzes / exams)
═══════════════════════════════════════════ */

interface EntrySectionProps {
  type:            SectionType;
  label:           string;
  icon:            string;
  entries:         EntryRow[];
  userSubjectId:   number;
  onUpdate:        (rows: EntryRow[]) => void;
  actTypes?:       string[];
  examTypes?:      string[];
  isQuiz?:         boolean;
  transTable?:     TransmutationTable | null;
  transmutationOn?: boolean;
  viewMode:        ViewMode;
}

function EntrySection({
  type, label, icon, entries, userSubjectId, onUpdate,
  actTypes, examTypes, isQuiz,
  transTable, transmutationOn = false,
  viewMode,
}: EntrySectionProps) {
  const [collapsed,      setCollapsed]      = useState(false);
  const [editingIds,     setEditingIds]     = useState<Set<number>>(new Set());
  const [editSnapshots,  setEditSnapshots]  = useState<Record<number, EntryRow>>({});

  const addRow = () => {
    const blank: EntryRow = {
      id: 0, name: '',
      specificType: actTypes?.[0] ?? examTypes?.[0] ?? '',
      urgency: 'Low', status: 'Pending',
      deadline: '', accomplished_at: '', score: '', items: '', grade: null,
    };
    onUpdate([...entries, blank]);
  };

  const setField = useCallback((idx: number, field: keyof EntryRow, val: string) => {
    const row = entries[idx];
    if (field === 'score' && row.canvas_linked) {
      const ok = window.confirm(
        `This score comes from Canvas. It will be overwritten by Canvas on the next sync — edit anyway?`
      );
      if (!ok) return;
    }
    onUpdate(entries.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, [field]: val };
      if (field === 'score' || field === 'items') {
        next.grade = calcGrade(
          field === 'score' ? val : r.score,
          field === 'items' ? val : r.items,
        );
        if (next.grade !== null) next.status = 'Done';
      }
      return next;
    }));
  }, [entries, onUpdate]);

  const saveRow = useCallback(async (idx: number): Promise<boolean> => {
    const row    = entries[idx];
    const today  = new Date().toISOString().split('T')[0];
    const validAc = row.accomplished_at && row.accomplished_at <= today ? row.accomplished_at : null;
    const doneAt  = row.status === 'Done' ? (validAc || today) : null;
    if (!row.name.trim()) { alert('Please enter a name.'); return false; }
    onUpdate(entries.map((r, i) => i === idx ? { ...r, saving: true } : r));
    try {
      const res  = await fetch('/api/studypulse/entries', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type, entry_id: row.id || null, user_subject_id: userSubjectId,
          name: row.name.trim(), specific_type: row.specificType,
          urgency: row.urgency, status: row.status, deadline: row.deadline,
          score: row.score || null, items: row.items || null, grade: row.grade,
          accomplished_at: doneAt,
        }),
      });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error ?? 'Save failed');
      onUpdate(entries.map((r, i) => i === idx ? { ...r, id: data.entry_id, saving: false, accomplished_at: doneAt ?? '' } : r));
      return true;
    } catch (err) {
      alert('Save failed: ' + (err as Error).message);
      onUpdate(entries.map((r, i) => i === idx ? { ...r, saving: false } : r));
      return false;
    }
  }, [entries, type, userSubjectId, onUpdate]);

  const enterEdit = useCallback((idx: number) => {
    const row = entries[idx];
    setEditingIds(prev => new Set([...prev, row.id]));
    setEditSnapshots(prev => ({ ...prev, [row.id]: { ...row } }));
  }, [entries]);

  const cancelEdit = useCallback((idx: number) => {
    const row  = entries[idx];
    const snap = editSnapshots[row.id];
    if (snap) onUpdate(entries.map((r, i) => i === idx ? snap : r));
    setEditingIds(prev => { const n = new Set(prev); n.delete(row.id); return n; });
    setEditSnapshots(prev => { const n = { ...prev }; delete n[row.id]; return n; });
  }, [entries, editSnapshots, onUpdate]);

  const saveAndExitEdit = useCallback(async (idx: number) => {
    const row = entries[idx];
    const ok  = await saveRow(idx);
    if (ok) {
      setEditingIds(prev => { const n = new Set(prev); n.delete(row.id); return n; });
      setEditSnapshots(prev => { const n = { ...prev }; delete n[row.id]; return n; });
    }
  }, [entries, saveRow]);

  const deleteRow = useCallback(async (idx: number) => {
    const row = entries[idx];
    if (!row.id) { onUpdate(entries.filter((_, i) => i !== idx)); return; }
    if (!confirm('Delete this entry?')) return;
    await fetch(`/api/studypulse/entries/${row.id}?type=${type}`, { method: 'DELETE' });
    onUpdate(entries.filter((_, i) => i !== idx));
  }, [entries, type, onUpdate]);

  const th = (lbl: string, w?: string, center?: boolean) => (
    <th key={lbl} style={{
      padding: '8px 10px', textAlign: center ? 'center' : 'left',
      color: '#8a9bb5', fontWeight: 600, fontSize: '0.72rem',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      width: w, borderBottom: '2px solid rgba(116,188,217,0.25)',
    }}>
      {lbl}
    </th>
  );

  return (
    <div style={{ ...GLASS, padding: '22px 24px', marginBottom: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: collapsed ? 0 : '16px' }}>
        <span style={{ fontSize: '1.15rem' }}>{icon}</span>
        <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#333', flexGrow: 1 }}>{label}</h2>
        <span style={{ background: 'rgba(242,167,192,0.25)', color: '#c0607c', borderRadius: '999px', padding: '2px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
          {entries.length}
        </span>
        <button onClick={addRow} style={{ background: 'linear-gradient(to right, #f2a7c0, #74bcd9)', color: 'white', border: 'none', borderRadius: '999px', padding: '5px 13px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
          <Plus size={12} /> Add
        </button>
        <button onClick={() => setCollapsed(c => !c)} style={{ background: 'rgba(255,255,255,0.4)', border: 'none', borderRadius: '8px', padding: '4px 8px', cursor: 'pointer', color: '#888', fontSize: '0.8rem' }}>
          {collapsed ? '▼' : '▲'}
        </button>
      </div>

      {!collapsed && (
        entries.length === 0 ? (
          <p style={{ margin: 0, textAlign: 'center', color: '#bbb', padding: '20px 0', fontSize: '0.875rem' }}>
            No entries yet — click Add to get started.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem',
              minWidth: viewMode === 'grade' ? (transmutationOn ? '540px' : '460px') : '420px' }}>
              <thead>
                <tr>
                  {th('Name', '165px')}
                  {viewMode === 'task' && th(isQuiz ? '#' : 'Type', '120px')}
                  {viewMode === 'task' && th('Urgency', '95px')}
                  {viewMode === 'task' && th('Status', '95px')}
                  {th(viewMode === 'grade' ? 'Date Accomplished' : 'Date Due', '120px')}
                  {viewMode === 'grade' && th('Score', '60px', true)}
                  {viewMode === 'grade' && th('Items', '60px', true)}
                  {viewMode === 'grade' && th(transmutationOn ? 'Raw% → Trans.' : 'Grade', transmutationOn ? '110px' : '76px', true)}
                  {th('', '76px', true)}
                </tr>
              </thead>
              <tbody>
                {entries.map((row, idx) => {
                  const us        = URGENCY_STYLE[row.urgency] ?? URGENCY_STYLE.Low;
                  const ss        = STATUS_STYLE[row.status]   ?? STATUS_STYLE.Pending;
                  const isEditing = row.id === 0 || editingIds.has(row.id);
                  return (
                    <tr key={row.id || `new-${idx}`} style={{ background: idx % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.14)', borderBottom: '1px solid rgba(200,215,235,0.25)' }}>
                      <td style={{ padding: '6px 10px' }}>
                        {isEditing
                          ? <input style={INPUT} value={row.name} onChange={e => setField(idx, 'name', e.target.value)} placeholder="Name…" />
                          : <span style={{ fontSize: '0.85rem', color: '#444', fontWeight: 500, padding: '0 2px' }}>{row.name || '—'}</span>
                        }
                      </td>
                      {viewMode === 'task' && (
                        <td style={{ padding: '6px 10px' }}>
                          {isQuiz ? (
                            <span style={{ color: '#7aa7c7', fontWeight: 700, padding: '0 6px' }}>#{idx + 1}</span>
                          ) : isEditing ? (
                            <select style={INPUT} value={row.specificType} onChange={e => setField(idx, 'specificType', e.target.value)}>
                              {(actTypes ?? examTypes ?? []).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          ) : (
                            <span style={{ fontSize: '0.82rem', color: '#555', padding: '0 2px' }}>{row.specificType || '—'}</span>
                          )}
                        </td>
                      )}
                      {viewMode === 'task' && (
                        <td style={{ padding: '6px 10px' }}>
                          {isEditing ? (
                            <select style={{ ...INPUT, background: us.bg, color: us.text, fontWeight: 600 }} value={row.urgency} onChange={e => setField(idx, 'urgency', e.target.value)}>
                              <option>High</option><option>Medium</option><option>Low</option>
                            </select>
                          ) : (
                            <span style={{ display: 'inline-block', background: us.bg, color: us.text, fontWeight: 600, borderRadius: '999px', padding: '2px 10px', fontSize: '0.78rem' }}>{row.urgency}</span>
                          )}
                        </td>
                      )}
                      {viewMode === 'task' && (
                        <td style={{ padding: '6px 10px' }}>
                          {isEditing ? (
                            <select style={{ ...INPUT, background: ss.bg, color: ss.text, fontWeight: 600 }} value={row.status} onChange={e => setField(idx, 'status', e.target.value)}>
                              <option>Pending</option><option>Done</option>
                            </select>
                          ) : (
                            <span style={{ display: 'inline-block', background: ss.bg, color: ss.text, fontWeight: 600, borderRadius: '999px', padding: '2px 10px', fontSize: '0.78rem' }}>{row.status}</span>
                          )}
                        </td>
                      )}
                      <td style={{ padding: '6px 10px' }}>
                        {viewMode === 'grade' ? (
                          <span style={{ fontSize: '0.82rem', color: row.accomplished_at ? '#555' : '#ccc', fontWeight: 500, padding: '0 2px' }}>
                            {(() => {
                              const today = new Date().toISOString().split('T')[0];
                              const ac    = row.accomplished_at && row.accomplished_at <= today ? row.accomplished_at : '';
                              return ac ? new Date(ac + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
                            })()}
                          </span>
                        ) : isEditing ? (
                          <input type="date" style={INPUT} value={row.deadline} onChange={e => setField(idx, 'deadline', e.target.value)} />
                        ) : (
                          <span style={{ fontSize: '0.82rem', color: row.deadline ? '#555' : '#ccc', padding: '0 2px' }}>
                            {row.deadline ? new Date(row.deadline + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                          </span>
                        )}
                      </td>
                      {viewMode === 'grade' && (
                        <td style={{ padding: '6px 10px' }}>
                          {isEditing
                            ? <input type="number" step="0.01" min="0" style={{ ...INPUT, textAlign: 'center' }} value={row.score} onChange={e => setField(idx, 'score', e.target.value)} placeholder="—" />
                            : <span style={{ display: 'block', textAlign: 'center', fontSize: '0.85rem', color: row.score ? '#444' : '#ccc' }}>{row.score || '—'}</span>
                          }
                        </td>
                      )}
                      {viewMode === 'grade' && (
                        <td style={{ padding: '6px 10px' }}>
                          {isEditing
                            ? <input type="number" step="0.01" min="0.01" style={{ ...INPUT, textAlign: 'center' }} value={row.items} onChange={e => setField(idx, 'items', e.target.value)} placeholder="—" />
                            : <span style={{ display: 'block', textAlign: 'center', fontSize: '0.85rem', color: row.items ? '#444' : '#ccc' }}>{row.items || '—'}</span>
                          }
                        </td>
                      )}
                      {viewMode === 'grade' && (
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                          <GradeCell raw={row.grade} score={row.score} items={row.items} transTable={transTable ?? null} transmutationOn={transmutationOn} />
                        </td>
                      )}
                      <td style={{ padding: '6px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {row.id === 0 ? (
                          <>
                            <button onClick={() => saveRow(idx)} disabled={!!row.saving} style={{ background: 'rgba(220,252,231,0.85)', color: '#16a34a', border: 'none', borderRadius: '7px', padding: '5px 9px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', marginRight: '4px' }}>
                              {row.saving ? '…' : '✓'}
                            </button>
                            <button onClick={() => deleteRow(idx)} style={{ background: 'rgba(254,226,226,0.85)', color: '#dc2626', border: 'none', borderRadius: '7px', padding: '5px 9px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>
                              ✕
                            </button>
                          </>
                        ) : isEditing ? (
                          <>
                            <button onClick={() => saveAndExitEdit(idx)} disabled={!!row.saving} style={{ background: 'rgba(220,252,231,0.85)', color: '#16a34a', border: 'none', borderRadius: '7px', padding: '5px 9px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', marginRight: '4px' }}>
                              {row.saving ? '…' : '✓'}
                            </button>
                            <button onClick={() => cancelEdit(idx)} style={{ background: 'rgba(254,226,226,0.85)', color: '#dc2626', border: 'none', borderRadius: '7px', padding: '5px 9px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>
                              ✕
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => enterEdit(idx)} title="Edit" style={{ background: 'rgba(219,234,254,0.85)', color: '#2563eb', border: 'none', borderRadius: '7px', padding: '5px 8px', cursor: 'pointer', marginRight: '4px', display: 'inline-flex', alignItems: 'center' }}>
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => deleteRow(idx)} title="Delete" style={{ background: 'rgba(254,226,226,0.85)', color: '#dc2626', border: 'none', borderRadius: '7px', padding: '5px 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   CustomEntrySection — grade_entries table
═══════════════════════════════════════════ */

interface CustomEntrySectionProps {
  catId:           number;
  periodId:        number;
  label:           string;
  weight:          number;
  isSingleton:     boolean;
  isLab:           boolean;
  userSubjectId:   number;
  initialEntries:  EntryRow[];
  onEntriesChange: (catId: number, rows: EntryRow[]) => void;
  transTable?:     TransmutationTable | null;
  transmutationOn?: boolean;
  viewMode:        ViewMode;
  /** Singleton + linked + carry_score: the linked sibling this score is currently borrowed from, until this period has its own. */
  sharedFrom?:     { periodName: string; grade: number } | null;
}

function CustomEntrySection({
  catId, periodId, label, weight, isSingleton, isLab,
  userSubjectId, initialEntries, onEntriesChange,
  transTable, transmutationOn = false,
  viewMode, sharedFrom,
}: CustomEntrySectionProps) {
  const [entries,        setEntries]        = useState<EntryRow[]>(initialEntries);
  const [collapsed,      setCollapsed]      = useState(false);
  const [editingIds,     setEditingIds]     = useState<Set<number>>(new Set());
  const [editSnapshots,  setEditSnapshots]  = useState<Record<number, EntryRow>>({});

  const updateEntries = useCallback((rows: EntryRow[]) => {
    setEntries(rows);
    onEntriesChange(catId, rows);
  }, [catId, onEntriesChange]);

  const addRow = () => {
    if (isSingleton && entries.length > 0) return;
    updateEntries([...entries, {
      id: 0, name: isSingleton ? label : '',
      specificType: '', urgency: 'Low', status: 'Pending',
      deadline: '', accomplished_at: '', score: '', items: '', grade: null,
    }]);
  };

  const setField = useCallback((idx: number, field: keyof EntryRow, val: string) => {
    const row = entries[idx];
    if (field === 'score' && row.canvas_linked) {
      const ok = window.confirm(
        `This score comes from Canvas. It will be overwritten by Canvas on the next sync — edit anyway?`
      );
      if (!ok) return;
    }
    updateEntries(entries.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, [field]: val };
      if (field === 'score' || field === 'items') {
        next.grade = calcGrade(
          field === 'score' ? val : r.score,
          field === 'items' ? val : r.items,
        );
        if (next.grade !== null) next.status = 'Done';
      }
      return next;
    }));
  }, [entries, updateEntries]);

  const saveRow = useCallback(async (idx: number): Promise<boolean> => {
    const row    = entries[idx];
    const today  = new Date().toISOString().split('T')[0];
    const validAc = row.accomplished_at && row.accomplished_at <= today ? row.accomplished_at : null;
    const doneAt  = row.status === 'Done' ? (validAc || today) : null;
    if (!row.name.trim()) { alert('Please enter a name.'); return false; }
    updateEntries(entries.map((r, i) => i === idx ? { ...r, saving: true } : r));
    try {
      const res  = await fetch('/api/studypulse/grade-entries', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          entry_id: row.id || null, user_subject_id: userSubjectId,
          cat_id: catId, period_id: periodId, is_lab: isLab ? 1 : 0,
          name: row.name.trim(), urgency: row.urgency, status: row.status,
          deadline: row.deadline, score: row.score || null,
          items: row.items || null, grade: row.grade,
          accomplished_at: doneAt,
        }),
      });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error ?? 'Save failed');
      updateEntries(entries.map((r, i) => i === idx ? { ...r, id: data.entry_id, saving: false, accomplished_at: doneAt ?? '' } : r));
      return true;
    } catch (err) {
      alert('Save failed: ' + (err as Error).message);
      updateEntries(entries.map((r, i) => i === idx ? { ...r, saving: false } : r));
      return false;
    }
  }, [entries, userSubjectId, catId, periodId, isLab, updateEntries]);

  const enterEdit = useCallback((idx: number) => {
    const row = entries[idx];
    setEditingIds(prev => new Set([...prev, row.id]));
    setEditSnapshots(prev => ({ ...prev, [row.id]: { ...row } }));
  }, [entries]);

  const cancelEdit = useCallback((idx: number) => {
    const row  = entries[idx];
    const snap = editSnapshots[row.id];
    if (snap) updateEntries(entries.map((r, i) => i === idx ? snap : r));
    setEditingIds(prev => { const n = new Set(prev); n.delete(row.id); return n; });
    setEditSnapshots(prev => { const n = { ...prev }; delete n[row.id]; return n; });
  }, [entries, editSnapshots, updateEntries]);

  const saveAndExitEdit = useCallback(async (idx: number) => {
    const row = entries[idx];
    const ok  = await saveRow(idx);
    if (ok) {
      setEditingIds(prev => { const n = new Set(prev); n.delete(row.id); return n; });
      setEditSnapshots(prev => { const n = { ...prev }; delete n[row.id]; return n; });
    }
  }, [entries, saveRow]);

  const deleteRow = useCallback(async (idx: number) => {
    const row = entries[idx];
    if (!row.id) { updateEntries(entries.filter((_, i) => i !== idx)); return; }
    if (!confirm('Delete this entry?')) return;
    await fetch(`/api/studypulse/grade-entries/${row.id}`, { method: 'DELETE' });
    updateEntries(entries.filter((_, i) => i !== idx));
  }, [entries, updateEntries]);

  const th = (lbl: string, w?: string, center?: boolean) => (
    <th key={lbl} style={{ padding: '8px 10px', textAlign: center ? 'center' : 'left', color: '#8a9bb5', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', width: w, borderBottom: '2px solid rgba(116,188,217,0.25)' }}>
      {lbl}
    </th>
  );

  const displayAvg = (transmutationOn && transTable)
    ? avgTransmuted(entries, transTable)
    : avgGrades(entries);

  const hasGrades = entries.some(r => r.grade !== null || (r.score && r.items));
  const avgGs     = gradeStyle(hasGrades ? displayAvg : null);

  return (
    <div style={{ marginBottom: '12px', background: 'rgba(255,255,255,0.12)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.2)', padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: collapsed ? 0 : '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexGrow: 1 }}>
          <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#444' }}>{label}</span>
          <span style={{ background: 'rgba(116,188,217,0.2)', color: '#3a8dba', borderRadius: '999px', padding: '2px 9px', fontSize: '0.72rem', fontWeight: 700 }}>
            {weight}%
          </span>
        </div>
        {hasGrades && (
          <MiniGauge value={displayAvg} color={avgGs.text} />
        )}
        {(!isSingleton || entries.length === 0) && (
          <button onClick={addRow} style={{ background: 'linear-gradient(to right, #f2a7c0, #74bcd9)', color: 'white', border: 'none', borderRadius: '999px', padding: '4px 11px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Plus size={11} /> {isSingleton ? 'Set Score' : 'Add'}
          </button>
        )}
        <button onClick={() => setCollapsed(c => !c)} style={{ background: 'rgba(255,255,255,0.4)', border: 'none', borderRadius: '7px', padding: '3px 7px', cursor: 'pointer', color: '#888', fontSize: '0.78rem' }}>
          {collapsed ? '▼' : '▲'}
        </button>
      </div>

      {!collapsed && entries.length === 0 && sharedFrom && (
        <div style={{
          fontSize: '0.78rem', color: '#a97b8c', background: 'rgba(242,167,192,0.12)',
          border: '1px solid rgba(242,167,192,0.3)', borderRadius: '10px',
          padding: '8px 12px', marginBottom: '4px',
        }}>
          🔗 Using {sharedFrom.periodName}&apos;s score ({sharedFrom.grade.toFixed(2)}) — add your own above to override it just for this period.
        </div>
      )}

      {!collapsed && entries.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem',
            minWidth: viewMode === 'grade' ? (transmutationOn ? '520px' : '440px') : '380px' }}>
            <thead>
              <tr>
                {th('Name', '155px')}
                {viewMode === 'task' && th('Urgency', '90px')}
                {viewMode === 'task' && th('Status', '90px')}
                {th(viewMode === 'grade' ? 'Date Accomplished' : 'Date Due', '116px')}
                {viewMode === 'grade' && th('Score', '60px', true)}
                {viewMode === 'grade' && th('Items', '60px', true)}
                {viewMode === 'grade' && th(transmutationOn ? 'Raw% → Trans.' : 'Grade', transmutationOn ? '108px' : '74px', true)}
                {th('', '68px', true)}
              </tr>
            </thead>
            <tbody>
              {entries.map((row, idx) => {
                const us        = URGENCY_STYLE[row.urgency] ?? URGENCY_STYLE.Low;
                const ss        = STATUS_STYLE[row.status]   ?? STATUS_STYLE.Pending;
                const isEditing = row.id === 0 || editingIds.has(row.id);
                return (
                  <tr key={row.id || `new-${idx}`} style={{ background: idx % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.14)', borderBottom: '1px solid rgba(200,215,235,0.2)' }}>
                    <td style={{ padding: '5px 8px' }}>
                      {isSingleton
                        ? <span style={{ color: '#555', fontWeight: 600, padding: '0 4px' }}>{row.name}</span>
                        : isEditing
                          ? <input style={INPUT} value={row.name} onChange={e => setField(idx, 'name', e.target.value)} placeholder="Name…" />
                          : <span style={{ fontSize: '0.83rem', color: '#444', fontWeight: 500, padding: '0 4px' }}>{row.name || '—'}</span>
                      }
                    </td>
                    {viewMode === 'task' && (
                      <td style={{ padding: '5px 8px' }}>
                        {isEditing ? (
                          <select style={{ ...INPUT, background: us.bg, color: us.text, fontWeight: 600 }} value={row.urgency} onChange={e => setField(idx, 'urgency', e.target.value)}>
                            <option>High</option><option>Medium</option><option>Low</option>
                          </select>
                        ) : (
                          <span style={{ display: 'inline-block', background: us.bg, color: us.text, fontWeight: 600, borderRadius: '999px', padding: '2px 10px', fontSize: '0.76rem' }}>{row.urgency}</span>
                        )}
                      </td>
                    )}
                    {viewMode === 'task' && (
                      <td style={{ padding: '5px 8px' }}>
                        {isEditing ? (
                          <select style={{ ...INPUT, background: ss.bg, color: ss.text, fontWeight: 600 }} value={row.status} onChange={e => setField(idx, 'status', e.target.value)}>
                            <option>Pending</option><option>Done</option>
                          </select>
                        ) : (
                          <span style={{ display: 'inline-block', background: ss.bg, color: ss.text, fontWeight: 600, borderRadius: '999px', padding: '2px 10px', fontSize: '0.76rem' }}>{row.status}</span>
                        )}
                      </td>
                    )}
                    <td style={{ padding: '5px 8px' }}>
                      {viewMode === 'grade' ? (
                        <span style={{ fontSize: '0.8rem', color: row.accomplished_at ? '#555' : '#ccc', fontWeight: 500, padding: '0 2px' }}>
                          {(() => {
                            const today = new Date().toISOString().split('T')[0];
                            const ac    = row.accomplished_at && row.accomplished_at <= today ? row.accomplished_at : '';
                            return ac ? new Date(ac + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
                          })()}
                        </span>
                      ) : isEditing ? (
                        <input type="date" style={INPUT} value={row.deadline} onChange={e => setField(idx, 'deadline', e.target.value)} />
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: row.deadline ? '#555' : '#ccc', padding: '0 2px' }}>
                          {row.deadline ? new Date(row.deadline + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </span>
                      )}
                    </td>
                    {viewMode === 'grade' && (
                      <td style={{ padding: '5px 8px' }}>
                        {isEditing
                          ? <input type="number" step="0.01" min="0" style={{ ...INPUT, textAlign: 'center' }} value={row.score} onChange={e => setField(idx, 'score', e.target.value)} placeholder="—" />
                          : <span style={{ display: 'block', textAlign: 'center', fontSize: '0.83rem', color: row.score ? '#444' : '#ccc' }}>{row.score || '—'}</span>
                        }
                      </td>
                    )}
                    {viewMode === 'grade' && (
                      <td style={{ padding: '5px 8px' }}>
                        {isEditing
                          ? <input type="number" step="0.01" min="0.01" style={{ ...INPUT, textAlign: 'center' }} value={row.items} onChange={e => setField(idx, 'items', e.target.value)} placeholder="—" />
                          : <span style={{ display: 'block', textAlign: 'center', fontSize: '0.83rem', color: row.items ? '#444' : '#ccc' }}>{row.items || '—'}</span>
                        }
                      </td>
                    )}
                    {viewMode === 'grade' && (
                      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                        <GradeCell raw={row.grade} score={row.score} items={row.items} transTable={transTable ?? null} transmutationOn={transmutationOn} compact />
                      </td>
                    )}
                    <td style={{ padding: '5px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {row.id === 0 ? (
                        <>
                          <button onClick={() => saveRow(idx)} disabled={!!row.saving} style={{ background: 'rgba(220,252,231,0.85)', color: '#16a34a', border: 'none', borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem', marginRight: '4px' }}>
                            {row.saving ? '…' : '✓'}
                          </button>
                          <button onClick={() => deleteRow(idx)} style={{ background: 'rgba(254,226,226,0.85)', color: '#dc2626', border: 'none', borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}>
                            ✕
                          </button>
                        </>
                      ) : isEditing ? (
                        <>
                          <button onClick={() => saveAndExitEdit(idx)} disabled={!!row.saving} style={{ background: 'rgba(220,252,231,0.85)', color: '#16a34a', border: 'none', borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem', marginRight: '4px' }}>
                            {row.saving ? '…' : '✓'}
                          </button>
                          <button onClick={() => cancelEdit(idx)} style={{ background: 'rgba(254,226,226,0.85)', color: '#dc2626', border: 'none', borderRadius: '7px', padding: '4px 8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}>
                            ✕
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => enterEdit(idx)} title="Edit" style={{ background: 'rgba(219,234,254,0.85)', color: '#2563eb', border: 'none', borderRadius: '7px', padding: '4px 7px', cursor: 'pointer', marginRight: '4px', display: 'inline-flex', alignItems: 'center' }}>
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => deleteRow(idx)} title="Delete" style={{ background: 'rgba(254,226,226,0.85)', color: '#dc2626', border: 'none', borderRadius: '7px', padding: '4px 7px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   CustomGradeCalculator — column layout
═══════════════════════════════════════════ */

function CustomGradeCalculator({
  config, catEntries, transTable, transmutationOn, gradeScale,
}: {
  config:          GradingConfig;
  catEntries:      Record<number, EntryRow[]>;
  transTable:      TransmutationTable | null;
  transmutationOn: boolean;
  gradeScale:      GradeScale | null;
}) {
  const { preset, has_lab, lec_weight, lab_weight } = config;
  const dp = transmutationOn ? 0 : 2;

  /* ── Actual category averages (derived from real entries) — 0 when ungraded, ── */
  /* ── used as-is for the breakdown display below.                             ── */
  const actualGrades = useMemo<Record<number, number>>(() => {
    const out: Record<number, number> = {};
    for (const period of preset.periods) {
      for (const cat of period.categories) {
        const rows    = catEntries[cat.cat_id] ?? [];
        const hasData = rows.some(r => r.grade !== null || (r.score && r.items));
        out[cat.cat_id] = !hasData ? 0
          : (transmutationOn && transTable)
            ? avgTransmuted(rows, transTable)
            : avgGrades(rows);
      }
    }
    return out;
  }, [preset.periods, catEntries, transmutationOn, transTable]);

  const catHasData = useMemo<Record<number, boolean>>(() => {
    const out: Record<number, boolean> = {};
    for (const period of preset.periods) {
      for (const cat of period.categories) {
        const rows = catEntries[cat.cat_id] ?? [];
        out[cat.cat_id] = rows.some(r => r.grade !== null || (r.score && r.items));
      }
    }
    return out;
  }, [preset.periods, catEntries]);

  /* A singleton category linked to another period, with carry_score on, reuses
     a linked sibling's own score until it has its own — the same physical exam,
     no re-entry required. This is real data (not an assumption), so it flows
     into the breakdown display too, not just the period/collective math. */
  const linkGroupSource = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const period of preset.periods) {
      for (const cat of period.categories) {
        if (cat.link_group && catHasData[cat.cat_id] && !(cat.link_group in out)) {
          out[cat.link_group] = actualGrades[cat.cat_id];
        }
      }
    }
    return out;
  }, [preset.periods, actualGrades, catHasData]);

  const resolvedGrades = useMemo<Record<number, number>>(() => {
    const out: Record<number, number> = {};
    for (const period of preset.periods) {
      for (const cat of period.categories) {
        if (catHasData[cat.cat_id]) { out[cat.cat_id] = actualGrades[cat.cat_id]; continue; }
        out[cat.cat_id] = (cat.is_singleton === 1 && cat.carry_score === 1 && cat.link_group && cat.link_group in linkGroupSource)
          ? linkGroupSource[cat.link_group] : 0;
      }
    }
    return out;
  }, [preset.periods, actualGrades, catHasData, linkGroupSource]);

  const resolvedHasData = useMemo<Record<number, boolean>>(() => {
    const out: Record<number, boolean> = {};
    for (const period of preset.periods) {
      for (const cat of period.categories) {
        out[cat.cat_id] = catHasData[cat.cat_id]
          || (cat.is_singleton === 1 && cat.carry_score === 1 && !!cat.link_group && cat.link_group in linkGroupSource);
      }
    }
    return out;
  }, [preset.periods, catHasData, linkGroupSource]);

  /* Grades used for the period-average math: within a period that has at least
     some data, a still-ungraded category is assumed perfect (100) so it doesn't
     drag the running grade down before work has been submitted for it. A period
     with NO data anywhere is handled separately below — it shows 0, not 100. */
  const effectiveGrades = useMemo<Record<number, number>>(() => {
    const out: Record<number, number> = {};
    for (const period of preset.periods) {
      for (const cat of period.categories) {
        out[cat.cat_id] = resolvedHasData[cat.cat_id] ? resolvedGrades[cat.cat_id] : 100;
      }
    }
    return out;
  }, [preset.periods, resolvedGrades, resolvedHasData]);

  /* ── What-If state ── */
  const [whatIf, setWhatIf]       = useState(false);
  const [wifGrades, setWifGrades] = useState<Record<number, number>>({});

  /* Seed what-if overrides whenever real grades change (e.g. transmutation flip) */
  useEffect(() => {
    if (whatIf) setWifGrades({ ...effectiveGrades });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transmutationOn, transTable]);

  const toggleWhatIf = () => {
    if (!whatIf) setWifGrades({ ...effectiveGrades });
    setWhatIf(v => !v);
  };

  /* Breakdown-display value — reflects a carried-forward score (that's real data,
     not an assumption), but stays 0 when truly ungraded, unaffected by the
     "assume perfect" rule. */
  const getG = (catId: number) =>
    whatIf ? (wifGrades[catId] ?? resolvedGrades[catId] ?? 0) : (resolvedGrades[catId] ?? 0);

  /* Period-math value — ungraded categories count as 100, unless the whole period has no data. */
  const getCalcG = (catId: number) =>
    whatIf ? (wifGrades[catId] ?? effectiveGrades[catId] ?? 100) : (effectiveGrades[catId] ?? 100);

  /* ── Period grade computation ── */
  const periodGrades = useMemo(() =>
    preset.periods.map(period => {
      const periodHasData = period.categories.some(cat => resolvedHasData[cat.cat_id]);
      if (!periodHasData && !whatIf) return 0;
      let ws = 0, tw = 0;
      for (const cat of period.categories) {
        const g = getCalcG(cat.cat_id);
        ws += g * Number(cat.weight);
        tw += Number(cat.weight);
      }
      return tw > 0 ? ws / tw : 0;
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [preset.periods, effectiveGrades, resolvedHasData, wifGrades, whatIf]);

  /* ── Final Grade (optional): the designated period is just a label anchor —
     the value is either the average of every period's grade, or the
     Collective pooled percentage across every category in every period. ── */
  const finalPeriodIdx = preset.final_period_id != null
    ? preset.periods.findIndex(p => p.period_id === preset.final_period_id)
    : -1;
  const finalGrade = preset.final_mode === 'average' && periodGrades.length > 0
    ? periodGrades.reduce((s, g) => s + g, 0) / periodGrades.length
    : preset.final_mode === 'collective'
      ? computeCollectiveGrade(
          preset.periods,
          cat => whatIf ? (wifGrades[cat.cat_id] ?? resolvedGrades[cat.cat_id] ?? 0) : resolvedGrades[cat.cat_id],
          cat => whatIf ? true : resolvedHasData[cat.cat_id],
        )
      : null;

  const colCount = preset.periods.length;

  return (
    <div style={{ ...GLASS, padding: '18px 22px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#333', flexGrow: 1 }}>
          📊 Grade Calculator
          {transmutationOn && <span style={{ marginLeft: '8px', fontSize: '0.72rem', color: '#74bcd9', fontWeight: 600 }}>— transmuted</span>}
          {whatIf && <span style={{ marginLeft: '8px', fontSize: '0.72rem', color: '#f2a7c0', fontWeight: 700 }}>— what if</span>}
        </h2>
        {whatIf && (
          <button
            onClick={() => setWifGrades({ ...effectiveGrades })}
            style={{ background: 'rgba(240,240,248,0.9)', border: '1px solid rgba(200,210,230,0.5)', borderRadius: '8px', padding: '5px 12px', fontSize: '0.76rem', fontWeight: 700, color: '#888', cursor: 'pointer' }}
          >
            ↺ Reset
          </button>
        )}
        <button
          onClick={toggleWhatIf}
          style={{
            background:   whatIf ? 'linear-gradient(to right, #f2a7c0, #a78bfa)' : 'rgba(255,255,255,0.55)',
            color:        whatIf ? 'white' : '#777',
            border:       '1px solid rgba(200,210,230,0.45)',
            borderRadius: '10px',
            padding:      '5px 14px',
            fontSize:     '0.76rem',
            fontWeight:   700,
            cursor:       'pointer',
            whiteSpace:   'nowrap',
          }}
        >
          {whatIf ? '✕ Exit What-If' : '✦ What If?'}
        </button>
      </div>

      {whatIf && (
        <p style={{ margin: '-8px 0 14px', fontSize: '0.76rem', color: '#aaa', fontStyle: 'italic' }}>
          Adjust category averages below — weights are fixed. Changes don't affect saved grades.
        </p>
      )}

      {/* ── Column grid ── */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
        gap:                 '12px',
        overflowX:           colCount > 3 ? 'auto' : 'visible',
      }}>
        {preset.periods.map((period, pi) => {
          const grade = periodGrades[pi];
          const gs    = gradeStyle(grade || null);
          const gi    = grade > 0 && gradeScale ? toGradeInfo(grade, gradeScale) : null;
          return (
            <div
              key={period.period_id}
              style={{
                background:   'rgba(255,255,255,0.4)',
                borderRadius: '14px',
                padding:      '14px 14px 10px',
                display:      'flex',
                flexDirection:'column',
                gap:          '0',
                minWidth:     colCount > 3 ? '160px' : undefined,
              }}
            >
              {/* Period header */}
              <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#8a9bb5', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>
                  {period.name}
                  {finalPeriodIdx >= 0 && pi === finalPeriodIdx && (
                    <span style={{ marginLeft: '6px', color: '#c0607c' }}>🏁 Final</span>
                  )}
                </div>
                <div style={{ fontSize: '2rem', fontWeight: 900, lineHeight: 1, color: gs.text }}>
                  {grade.toFixed(dp)}
                </div>
                {gi && (
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: gs.text, opacity: 0.85, marginTop: '2px' }}>
                    {gi.letter} · {gi.description}
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid rgba(200,215,235,0.35)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {period.categories.map(cat => {
                  const g       = getG(cat.cat_id);
                  const cgs     = gradeStyle(g || null);
                  const contrib = (g * Number(cat.weight)) / 100;
                  return (
                    <div key={cat.cat_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#444', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {cat.name}
                        </div>
                        <div style={{ fontSize: '0.65rem', color: '#aaa', fontWeight: 600 }}>{cat.weight}%</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: '52px' }}>
                        {whatIf ? (
                          <input
                            type="number" min="0" max="100" step="0.5"
                            value={wifGrades[cat.cat_id] ?? g}
                            onChange={e => setWifGrades(p => ({ ...p, [cat.cat_id]: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) }))}
                            style={{
                              width:        '56px',
                              padding:      '4px 6px',
                              borderRadius: '8px',
                              border:       '1.5px solid rgba(242,167,192,0.6)',
                              background:   'rgba(255,255,255,0.9)',
                              fontSize:     '0.8rem',
                              fontWeight:   700,
                              textAlign:    'right',
                              fontFamily:   'inherit',
                              color:        '#333',
                            }}
                          />
                        ) : (
                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: cgs.text, lineHeight: 1.2 }}>
                            {contrib.toFixed(2)}
                          </div>
                        )}
                        <div style={{ fontSize: '0.72rem', color: '#bbb', fontWeight: 500, marginTop: '1px' }}>
                          {g.toFixed(dp)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {finalGrade !== null && (() => {
        const fgs = gradeStyle(finalGrade || null);
        const fgi = finalGrade > 0 && gradeScale ? toGradeInfo(finalGrade, gradeScale) : null;
        return (
          <div style={{
            marginTop:    '14px',
            padding:      '14px 18px',
            background:   'rgba(242,167,192,0.12)',
            border:       '1px solid rgba(242,167,192,0.35)',
            borderRadius: '14px',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'space-between',
            gap:          '12px',
            flexWrap:     'wrap',
          }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#c0607c' }}>
              🏁 Final Grade <span style={{ fontWeight: 500, color: '#a97b8c' }}>
                — {preset.final_mode === 'collective' ? 'collective percentage of all categories' : 'average of all periods'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 900, color: fgs.text }}>
                {finalGrade.toFixed(dp)}
              </div>
              {fgi && (
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: fgs.text, opacity: 0.85 }}>
                  {fgi.letter} · {fgi.description}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {has_lab === 1 && (
        <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(116,188,217,0.08)', borderRadius: '10px', border: '1px solid rgba(116,188,217,0.22)' }}>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#3a8dba', fontWeight: 600 }}>
            Lab subject: overall = Lecture × {lec_weight}% + Lab × {lab_weight}%
          </p>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   Legacy GradeCalculator
═══════════════════════════════════════════ */

function GradeCalculator({
  activities, quizzes, exams, transTable, transmutationOn,
}: {
  activities:      EntryRow[];
  quizzes:         EntryRow[];
  exams:           EntryRow[];
  transTable:      TransmutationTable | null;
  transmutationOn: boolean;
}) {
  const [mode,       setMode]       = useState<GradeMode>('finals');
  const [wifWeights, setWifWeights] = useState({ Activities: 24, Quizzes: 36, Exams: 40 });
  const [wifGrades,  setWifGrades]  = useState({ Activities: 0,  Quizzes: 0,  Exams: 0  });

  const useT = transmutationOn && transTable !== null;

  const actAvg  = useMemo(() => useT ? avgTransmuted(activities, transTable!) : avgGrades(activities), [activities, useT, transTable]);
  const quizAvg = useMemo(() => useT ? avgTransmuted(quizzes,    transTable!) : avgGrades(quizzes),    [quizzes,    useT, transTable]);
  const midAvg  = useMemo(() => useT ? examTransmuted(exams, 'Midterm',    transTable!) : examAvg(exams, 'Midterm'),    [exams, useT, transTable]);
  const finAvg  = useMemo(() => useT ? examTransmuted(exams, 'Final Exam', transTable!) : examAvg(exams, 'Final Exam'), [exams, useT, transTable]);

  const finalsExam = useMemo(() =>
    parseFloat(((midAvg * 15 + finAvg * 25) / 40).toFixed(2)), [midAvg, finAvg]);

  const hasGradeData = (r: EntryRow) => r.grade !== null || (!!r.score && !!r.items);
  const actHasData   = useMemo(() => activities.some(hasGradeData), [activities]);
  const quizHasData  = useMemo(() => quizzes.some(hasGradeData),    [quizzes]);
  const midHasData   = useMemo(() => exams.some(r => r.specificType === 'Midterm'    && hasGradeData(r)), [exams]);
  const finHasData   = useMemo(() => exams.some(r => r.specificType === 'Final Exam' && hasGradeData(r)), [exams]);
  const examHasData  = midHasData || finHasData;

  const presets = useMemo(() => ({
    finals:  { Activities: { w: 24, g: actAvg }, Quizzes: { w: 36, g: quizAvg }, Exams: { w: 40, g: finalsExam } },
    midterm: { Activities: { w: 24, g: actAvg }, Quizzes: { w: 36, g: quizAvg }, Exams: { w: 40, g: midAvg    } },
  }), [actAvg, quizAvg, midAvg, finalsExam]);

  /* Component-empty flags per mode — within a mode that has some data, a
     component with zero entries is assumed perfect (100) for the Total Grade
     math, not 0, so it doesn't drag the running grade down before any work has
     been submitted for it. If NONE of the components have data yet, the total
     is 0 instead — nothing has been attempted, so it isn't "perfect." The
     breakdown row for an empty component still shows its real (0) average. */
  const componentHasData = useMemo(() => ({
    finals:  { Activities: actHasData, Quizzes: quizHasData, Exams: examHasData },
    midterm: { Activities: actHasData, Quizzes: quizHasData, Exams: midHasData  },
  }), [actHasData, quizHasData, examHasData, midHasData]);

  const effectivePreset = useCallback((modeKey: 'finals' | 'midterm') => {
    const src = presets[modeKey];
    const hd  = componentHasData[modeKey];
    return {
      Activities: { w: src.Activities.w, g: hd.Activities ? src.Activities.g : 100 },
      Quizzes:    { w: src.Quizzes.w,    g: hd.Quizzes    ? src.Quizzes.g    : 100 },
      Exams:      { w: src.Exams.w,      g: hd.Exams      ? src.Exams.g      : 100 },
    };
  }, [presets, componentHasData]);

  /* Reset what-if seeds when transmutation or underlying grades change */
  useEffect(() => {
    if (mode === 'whatif') {
      const src = effectivePreset('finals');
      setWifWeights({ Activities: src.Activities.w, Quizzes: src.Quizzes.w, Exams: src.Exams.w });
      setWifGrades({ Activities: src.Activities.g, Quizzes: src.Quizzes.g, Exams: src.Exams.g });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useT]);

  const components = ['Activities', 'Quizzes', 'Exams'] as const;
  const rows = components.map(k => {
    if (mode === 'whatif') return { label: k, weight: wifWeights[k], grade: wifGrades[k], calcGrade: wifGrades[k] };
    const g = presets[mode][k].g;
    return { label: k, weight: presets[mode][k].w, grade: g, calcGrade: componentHasData[mode][k] ? g : 100 };
  });
  const modeHasAnyData = mode === 'whatif' ? true : Object.values(componentHasData[mode]).some(Boolean);
  const total = !modeHasAnyData ? 0 : rows.reduce((s, r) => s + (r.calcGrade * r.weight) / 100, 0);
  const tgs   = gradeStyle(total);

  const handleModeChange = (m: GradeMode) => {
    if (m === 'whatif') {
      const src = presets[mode !== 'whatif' ? mode : 'finals'];
      setWifWeights({ Activities: src.Activities.w, Quizzes: src.Quizzes.w, Exams: src.Exams.w });
      setWifGrades({ Activities: src.Activities.g, Quizzes: src.Quizzes.g, Exams: src.Exams.g });
    }
    setMode(m);
  };

  const dp = transmutationOn ? 0 : 2;

  return (
    <div style={{ ...GLASS, padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#333' }}>
          📊 Grade Calculator
          {transmutationOn && <span style={{ fontSize: '0.75rem', color: '#74bcd9', fontWeight: 600, marginLeft: '8px' }}>— transmuted</span>}
        </h2>
        <div style={{ display: 'flex', gap: '6px' }}>
          {(['finals', 'midterm', 'whatif'] as GradeMode[]).map(m => (
            <button key={m} onClick={() => handleModeChange(m)} style={{ padding: '5px 14px', borderRadius: '999px', border: 'none', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', background: mode === m ? 'linear-gradient(to right, #f2a7c0, #74bcd9)' : 'rgba(255,255,255,0.45)', color: mode === m ? 'white' : '#666', transition: 'all 0.2s' }}>
              {m === 'finals' ? 'Finals' : m === 'midterm' ? 'Midterm' : 'What-If?'}
            </button>
          ))}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', minWidth: '380px' }}>
          <thead>
            <tr>
              {['Component', 'Weight (%)', transmutationOn ? 'Trans. Grade' : 'Grade', 'Weighted'].map((h, i) => (
                <th key={h} style={{ padding: '8px 12px', textAlign: i === 0 ? 'left' : 'center', color: '#8a9bb5', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid rgba(116,188,217,0.25)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const weighted = (row.grade * row.weight) / 100;
              const gs       = gradeStyle(row.grade);
              return (
                <tr key={row.label} style={{ borderBottom: '1px solid rgba(200,215,235,0.2)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: '#444' }}>{row.label}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {mode === 'whatif' ? (
                      <input type="number" min="0" max="100" step="0.01" value={row.weight} onChange={e => setWifWeights(p => ({ ...p, [row.label]: parseFloat(e.target.value) || 0 }))} style={{ ...INPUT, textAlign: 'center', width: '76px' }} />
                    ) : (
                      <span style={{ background: 'rgba(116,188,217,0.2)', color: '#3a8dba', padding: '2px 12px', borderRadius: '999px', fontWeight: 600 }}>{row.weight}%</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    {mode === 'whatif' ? (
                      <input type="number" min="0" max="100" step="0.01" value={row.grade} onChange={e => setWifGrades(p => ({ ...p, [row.label]: parseFloat(e.target.value) || 0 }))} style={{ ...INPUT, textAlign: 'center', width: '76px' }} />
                    ) : (
                      <span style={{ background: gs.bg, color: gs.text, padding: '2px 12px', borderRadius: '999px', fontWeight: 700, display: 'inline-block' }}>{row.grade.toFixed(dp)}</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, color: '#555' }}>{weighted.toFixed(dp)}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: '2px solid rgba(116,188,217,0.25)' }}>
              <td colSpan={3} style={{ padding: '12px 12px', textAlign: 'right', fontWeight: 700, color: '#444', fontSize: '0.95rem' }}>Total Grade:</td>
              <td style={{ padding: '12px 12px', textAlign: 'center' }}>
                <span style={{ background: tgs.bg, color: tgs.text, padding: '5px 20px', borderRadius: '999px', fontWeight: 800, fontSize: '1.1rem', display: 'inline-block' }}>
                  {total.toFixed(dp)}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {mode !== 'whatif' && (
        <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: '#aaa', textAlign: 'right' }}>
          {mode === 'finals'
            ? 'Finals: Activities 24% · Quizzes 36% · (Midterm 15% + Final 25%) = Exams 40%'
            : 'Midterm: Activities 24% · Quizzes 36% · Midterm Exam 40%'}
          {transmutationOn && ' · values are transmuted'}
        </p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   SubjectCardView — main export
═══════════════════════════════════════════ */

interface Props {
  subject: {
    subject_name: string;
    course_code:  string;
    units:        number;
    year_level:   string;
    trimester:    string;
  };
  userSubjectId:       number;
  initialActivities?:  EntryRow[];
  initialQuizzes?:     EntryRow[];
  initialExams?:       EntryRow[];
  gradingConfig?:      GradingConfig | null;
  initialGradeEntries?: Record<number, EntryRow[]>;
  existingPresets?:    Array<{ preset_id: number; name: string; period_count: number }>;
}

export default function SubjectCardView({
  subject, userSubjectId,
  initialActivities = [], initialQuizzes = [], initialExams = [],
  gradingConfig: initialConfig = null,
  initialGradeEntries = {},
  existingPresets = [],
}: Props) {
  const [activities, setActivities] = useState<EntryRow[]>(initialActivities);
  const [quizzes,    setQuizzes]    = useState<EntryRow[]>(initialQuizzes);
  const [exams,      setExams]      = useState<EntryRow[]>(initialExams);
  const [config,     setConfig]     = useState<GradingConfig | null>(initialConfig);
  const [showWizard, setShowWizard] = useState(false);

  /* catId → current entries (kept in sync with CustomEntrySection) */
  const [catEntries, setCatEntries] = useState<Record<number, EntryRow[]>>(() => {
    if (!initialConfig) return {};
    const init: Record<number, EntryRow[]> = {};
    for (const period of initialConfig.preset.periods) {
      for (const cat of period.categories) {
        init[cat.cat_id] = initialGradeEntries[cat.cat_id] ?? [];
      }
    }
    return init;
  });

  const handleCatEntriesChange = useCallback((catId: number, rows: EntryRow[]) => {
    setCatEntries(prev => ({ ...prev, [catId]: rows }));
  }, []);

  /* ── Target grade panel ── */
  const [showTarget, setShowTarget] = useState(false);

  /* ── View mode ── */
  const [viewMode, setViewMode] = useState<ViewMode>('grade');

  /* ── Period pill display mode ── */
  type PillMode = 'gwa' | 'raw' | 'interpretation';
  const [pillMode, setPillMode] = useState<PillMode>('gwa');
  const cyclePillMode = () => setPillMode(m => m === 'gwa' ? 'raw' : m === 'raw' ? 'interpretation' : 'gwa');

  /* ── Transmutation state ── */
  const [transmutationOn, setTransmutationOn] = useState(false);
  const [transTable,      setTransTable]      = useState<TransmutationTable | null>(null);
  const [transError,      setTransError]      = useState<string | null>(null);
  const [transLoading,    setTransLoading]    = useState(false);

  const handleTransToggle = async () => {
    if (transmutationOn) { setTransmutationOn(false); return; }
    if (transTable) { setTransmutationOn(true); return; }
    setTransLoading(true);
    setTransError(null);
    try {
      const t = await loadTransmutationTable();
      setTransTable(t);
      setTransmutationOn(true);
    } catch (e) {
      setTransError((e as Error).message);
    } finally {
      setTransLoading(false);
    }
  };

  const handleWizardComplete = (preset: GradingPresetFull) => {
    const newConfig: GradingConfig = {
      preset_id:   preset.preset_id,
      has_lab:     preset.has_lab,
      lec_weight:  preset.lec_weight,
      lab_weight:  preset.lab_weight,
      grade_scale: preset.grade_scale,
      preset,
    };
    setConfig(newConfig);
    const init: Record<number, EntryRow[]> = {};
    for (const p of preset.periods) for (const c of p.categories) init[c.cat_id] = [];
    setCatEntries(init);
    setShowWizard(false);
  };

  const isCustomMode   = config !== null;
  const totalLegacy    = activities.length + quizzes.length + exams.length;

  /* Own-entry grade/hasData per category, then resolved with score carry-forward
     (a linked singleton reusing a scored sibling's grade) — mirrors CustomGradeCalculator. */
  const headerOwnGrade = useCallback((catId: number) => {
    const rows = catEntries[catId] ?? [];
    return (transmutationOn && transTable) ? avgTransmuted(rows, transTable) : avgGrades(rows);
  }, [catEntries, transmutationOn, transTable]);
  const headerOwnHasData = useCallback(
    (catId: number) => (catEntries[catId] ?? []).some(r => r.grade !== null || (r.score && r.items)),
    [catEntries]
  );

  const headerLinkGroupSource = useMemo<Record<string, number>>(() => {
    if (!config) return {};
    const out: Record<string, number> = {};
    for (const period of config.preset.periods) {
      for (const cat of period.categories) {
        if (cat.link_group && headerOwnHasData(cat.cat_id) && !(cat.link_group in out)) {
          out[cat.link_group] = headerOwnGrade(cat.cat_id);
        }
      }
    }
    return out;
  }, [config, headerOwnGrade, headerOwnHasData]);

  const headerHasData = useCallback((catId: number, cat?: { is_singleton: number; carry_score: number; link_group: string | null }) => {
    if (headerOwnHasData(catId)) return true;
    return !!(cat && cat.is_singleton === 1 && cat.carry_score === 1 && cat.link_group && cat.link_group in headerLinkGroupSource);
  }, [headerOwnHasData, headerLinkGroupSource]);

  const headerGetGrade = useCallback((catId: number, cat?: { is_singleton: number; carry_score: number; link_group: string | null }) => {
    if (headerOwnHasData(catId)) return headerOwnGrade(catId);
    if (cat && cat.is_singleton === 1 && cat.carry_score === 1 && cat.link_group && cat.link_group in headerLinkGroupSource) {
      return headerLinkGroupSource[cat.link_group];
    }
    return 0;
  }, [headerOwnHasData, headerOwnGrade, headerLinkGroupSource]);

  /* Which period a linked singleton's score is currently borrowed from — for the
     "🔗 Using X's score" note shown on a not-yet-scored linked entry section. */
  const linkGroupSourceInfo = useMemo<Record<string, { periodName: string; grade: number }>>(() => {
    if (!config) return {};
    const out: Record<string, { periodName: string; grade: number }> = {};
    for (const period of config.preset.periods) {
      for (const cat of period.categories) {
        if (cat.link_group && headerOwnHasData(cat.cat_id) && !(cat.link_group in out)) {
          out[cat.link_group] = { periodName: period.name, grade: headerOwnGrade(cat.cat_id) };
        }
      }
    }
    return out;
  }, [config, headerOwnGrade, headerOwnHasData]);

  /* Per-period grades for the header stat pills — mirrors CustomGradeCalculator:
     within a period that has some data, an ungraded category is assumed perfect
     (100); a period with no data anywhere shows 0. */
  const headerPeriodGrades = useMemo(() => {
    if (!config) return [] as number[];
    return config.preset.periods.map(p => {
      const cats = p.categories;
      const catResolvedHasData = cats.map(c => headerHasData(c.cat_id, c));
      if (!catResolvedHasData.some(Boolean)) return 0;
      const tot  = cats.reduce((s, c) => s + Number(c.weight), 0);
      const wsum = cats.reduce((s, c, ci) => {
        const g = !catResolvedHasData[ci] ? 100 : headerGetGrade(c.cat_id, c);
        return s + g * Number(c.weight);
      }, 0);
      return tot > 0 ? wsum / tot : 0;
    });
  }, [config, headerHasData, headerGetGrade]);

  const headerFinalPeriodIdx = config?.preset.final_period_id != null
    ? config.preset.periods.findIndex(p => p.period_id === config.preset.final_period_id)
    : -1;
  const headerFinalGrade = config?.preset.final_mode === 'average' && headerPeriodGrades.length > 0
    ? headerPeriodGrades.reduce((s, g) => s + g, 0) / headerPeriodGrades.length
    : config?.preset.final_mode === 'collective'
      ? computeCollectiveGrade(
          config.preset.periods,
          cat => headerGetGrade(cat.cat_id, cat),
          cat => headerHasData(cat.cat_id, cat),
        )
      : null;

  return (
    <div
      className="vb-bg"
      style={{ minHeight: '100vh', padding: '40px 5% 60px', fontFamily: "'Inter','DM Sans','Segoe UI',sans-serif", color: '#333', overflowX: 'hidden' }}
    >
      {showWizard && (
        <GradingSetupWizard
          userSubjectId={userSubjectId}
          onComplete={handleWizardComplete}
          onCancel={() => setShowWizard(false)}
          existingPresets={existingPresets}
        />
      )}

      {/* ── Subject header ── */}
      <div style={{ ...GLASS, padding: '24px 28px', marginBottom: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>

          <div>
            <Link href="/studypulse/subjects" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#74bcd9', textDecoration: 'none', fontSize: '0.82rem', fontWeight: 600, marginBottom: '10px' }}>
              ← My Subjects
            </Link>
            <h1 className="gradient-text" style={{ margin: '0 0 2px', fontSize: '1.9rem', fontWeight: 800, lineHeight: 1.2 }}>
              {subject.subject_name}
            </h1>
            <p style={{ margin: '0 0 12px', color: '#666', fontSize: '0.95rem', fontWeight: 600 }}>
              {subject.course_code}
            </p>
            <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', alignItems: 'center' }}>
              {[`${subject.units} Unit${subject.units !== 1 ? 's' : ''}`, subject.year_level, subject.trimester].map(lbl => (
                <span key={lbl} style={{ background: 'rgba(116,188,217,0.18)', color: '#3a8dba', borderRadius: '999px', padding: '3px 12px', fontSize: '0.77rem', fontWeight: 600 }}>
                  {lbl}
                </span>
              ))}
              {isCustomMode && (
                <span style={{ background: 'rgba(242,167,192,0.2)', color: '#c0607c', borderRadius: '999px', padding: '3px 12px', fontSize: '0.77rem', fontWeight: 600 }}>
                  {config.preset.name}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Stat pills */}
            {isCustomMode
              ? [
                  ...config.preset.periods.map((p, pi) => {
                    const grade = headerPeriodGrades[pi];
                    const gs    = gradeStyle(grade || null);
                    const gi    = grade > 0 && config.grade_scale ? toGradeInfo(grade, config.grade_scale) : null;
                    const isFinal = headerFinalPeriodIdx >= 0 && pi === headerFinalPeriodIdx;
                    return (
                      <div
                        key={p.period_id}
                        onClick={cyclePillMode}
                        title="Click to cycle: GWA → Raw % → Interpretation"
                        style={{ background: 'rgba(255,255,255,0.5)', borderRadius: '14px', padding: '10px 18px', textAlign: 'center', width: '148px', flexShrink: 0, height: '72px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '5px', cursor: 'pointer', userSelect: 'none', transition: 'background 0.15s ease' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.75)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.5)')}
                      >
                        {pillMode === 'gwa' && (
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: gs.text, lineHeight: 1 }}>
                            {gi ? gi.point.toFixed(2) : grade.toFixed(2)}
                          </div>
                        )}
                        {pillMode === 'raw' && (
                          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: gs.text, lineHeight: 1 }}>
                            {grade.toFixed(2)}
                          </div>
                        )}
                        {pillMode === 'interpretation' && (
                          <div style={{ fontSize: gi ? '0.92rem' : '1.2rem', fontWeight: 800, color: gs.text, lineHeight: 1.2 }}>
                            {gi ? `${gi.letter} · ${gi.description}` : grade.toFixed(2)}
                          </div>
                        )}
                        <div style={{ fontSize: '0.7rem', color: '#999', fontWeight: 600 }}>
                          {p.name}{isFinal && <span style={{ color: '#c0607c' }}> 🏁</span>}
                        </div>
                      </div>
                    );
                  }),
                  ...(headerFinalGrade !== null ? [(() => {
                    const grade = headerFinalGrade;
                    const gs    = gradeStyle(grade || null);
                    const gi    = grade > 0 && config.grade_scale ? toGradeInfo(grade, config.grade_scale) : null;
                    return (
                      <div
                        key="final-grade"
                        onClick={cyclePillMode}
                        title={`Final Grade — ${config.preset.final_mode === 'collective' ? 'collective percentage of all categories' : 'average of all periods'}`}
                        style={{ background: 'rgba(242,167,192,0.22)', border: '1px solid rgba(242,167,192,0.5)', borderRadius: '14px', padding: '10px 18px', textAlign: 'center', width: '148px', flexShrink: 0, height: '72px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '5px', cursor: 'pointer', userSelect: 'none' }}
                      >
                        {pillMode === 'gwa' && (
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: gs.text, lineHeight: 1 }}>
                            {gi ? gi.point.toFixed(2) : grade.toFixed(2)}
                          </div>
                        )}
                        {pillMode === 'raw' && (
                          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: gs.text, lineHeight: 1 }}>
                            {grade.toFixed(2)}
                          </div>
                        )}
                        {pillMode === 'interpretation' && (
                          <div style={{ fontSize: gi ? '0.92rem' : '1.2rem', fontWeight: 800, color: gs.text, lineHeight: 1.2 }}>
                            {gi ? `${gi.letter} · ${gi.description}` : grade.toFixed(2)}
                          </div>
                        )}
                        <div style={{ fontSize: '0.7rem', color: '#c0607c', fontWeight: 700 }}>🏁 Final Grade</div>
                      </div>
                    );
                  })()] : []),
                ]
              : [
                  { label: 'Activities', count: activities.length, color: '#f2a7c0' },
                  { label: 'Quizzes',    count: quizzes.length,    color: '#74bcd9' },
                  { label: 'Exams',      count: exams.length,      color: '#a78bfa' },
                ].map(({ label, count, color }) => (
                  <div key={label} style={{ background: 'rgba(255,255,255,0.5)', borderRadius: '14px', padding: '10px 18px', textAlign: 'center', minWidth: '68px' }}>
                    <div style={{ fontSize: '1.35rem', fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
                    <div style={{ fontSize: '0.7rem', color: '#999', fontWeight: 600, marginTop: '3px' }}>{label}</div>
                  </div>
                ))}

          </div>
        </div>

        {transError && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(254,226,226,0.8)', borderRadius: '10px', color: '#dc2626', fontSize: '0.82rem', fontWeight: 600 }}>
            ⚠️ {transError}
          </div>
        )}
      </div>

      {/* ── Target grade panel ── */}
      {showTarget && (
        <TargetGradePanel
          subjectName={subject.subject_name}
          config={config}
          catEntries={catEntries}
          activities={activities}
          quizzes={quizzes}
          exams={exams}
          transTable={transTable}
          transmutationOn={transmutationOn}
          onClose={() => setShowTarget(false)}
        />
      )}

      {/* ── View toggle bar + action buttons ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {/* Grade / Task toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.28)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.35)', padding: '5px' }}>
          {(['grade', 'task'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding:      '7px 20px',
                borderRadius: '10px',
                border:       'none',
                cursor:       'pointer',
                fontWeight:   700,
                fontSize:     '0.8rem',
                fontFamily:   'inherit',
                background:   viewMode === mode ? 'rgba(255,255,255,0.9)' : 'transparent',
                color:        viewMode === mode ? '#333' : '#888',
                boxShadow:    viewMode === mode ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                transition:   'all 0.15s ease',
              }}
            >
              {mode === 'grade' ? '📊 Grade View' : '✅ Task View'}
            </button>
          ))}
        </div>

        {/* Action buttons group — right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handleTransToggle}
            disabled={transLoading}
            title={transError ?? (transmutationOn ? 'Turn off transmutation scale' : 'Turn on transmutation scale')}
            style={{
              background:   transmutationOn ? 'linear-gradient(to right, #f2a7c0, #74bcd9)' : 'rgba(255,255,255,0.5)',
              color:        transmutationOn ? 'white' : '#777',
              border:       `1px solid ${transError ? '#dc2626' : 'rgba(200,210,230,0.4)'}`,
              borderRadius: '14px',
              padding:      '8px 14px',
              cursor:       transLoading ? 'wait' : 'pointer',
              fontSize:     '0.78rem',
              fontWeight:   700,
              whiteSpace:   'nowrap',
              fontFamily:   'inherit',
            }}
          >
            {transLoading ? '⏳ Loading…' : transmutationOn ? '✦ Transmuted' : '◇ Transmute'}
          </button>

          <button
            onClick={() => setShowTarget(v => !v)}
            title="Target Grade Planner"
            style={{
              background:   showTarget ? 'linear-gradient(to right, #f2a7c0, #a78bfa)' : 'rgba(255,255,255,0.5)',
              color:        showTarget ? 'white' : '#777',
              border:       '1px solid rgba(200,210,230,0.4)',
              borderRadius: '14px',
              padding:      '8px 14px',
              cursor:       'pointer',
              fontSize:     '0.78rem',
              fontWeight:   700,
              whiteSpace:   'nowrap',
              fontFamily:   'inherit',
            }}
          >
            🎯 Target
          </button>

          <button
            onClick={() => setShowWizard(true)}
            style={{ background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(200,210,230,0.4)', borderRadius: '14px', padding: '8px 14px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: '#888', whiteSpace: 'nowrap', fontFamily: 'inherit' }}
          >
            {isCustomMode ? '⚙️ Grading' : '🎓 Setup Grading'}
          </button>

          <Link
            href={`/studypulse/canvas?subject=${userSubjectId}`}
            title="View pending Canvas Activity Bank items for this subject"
            style={{ background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(200,210,230,0.4)', borderRadius: '14px', padding: '8px 14px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: '#888', whiteSpace: 'nowrap', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
          >
            📥 Activity Bank
          </Link>
        </div>
      </div>

      {/* ── Custom grading mode ── */}
      {isCustomMode && (
        <>
          {config.preset.periods.map(period => (
            <div key={period.period_id} style={{ ...GLASS, padding: '20px 24px', marginBottom: '18px' }}>
              <h2 style={{ margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 700, color: '#333' }}>
                📅 {period.name}
                {headerFinalPeriodIdx >= 0 && config.preset.periods[headerFinalPeriodIdx]?.period_id === period.period_id && (
                  <span style={{ marginLeft: '8px', fontSize: '0.78rem', color: '#c0607c', fontWeight: 700 }}>🏁 Final</span>
                )}
              </h2>
              {period.categories.map(cat => {
                const hasOwn = (catEntries[cat.cat_id] ?? []).some(r => r.grade !== null || (r.score && r.items));
                const sharedFrom = (!hasOwn && cat.is_singleton === 1 && cat.carry_score === 1 && cat.link_group)
                  ? linkGroupSourceInfo[cat.link_group] ?? null
                  : null;
                return (
                  <CustomEntrySection
                    key={cat.cat_id}
                    catId={cat.cat_id}
                    periodId={period.period_id}
                    label={cat.name}
                    weight={Number(cat.weight)}
                    isSingleton={cat.is_singleton === 1}
                    isLab={false}
                    userSubjectId={userSubjectId}
                    initialEntries={initialGradeEntries[cat.cat_id] ?? []}
                    onEntriesChange={handleCatEntriesChange}
                    transTable={transTable}
                    transmutationOn={transmutationOn}
                    viewMode={viewMode}
                    sharedFrom={sharedFrom}
                  />
                );
              })}
            </div>
          ))}
          <CustomGradeCalculator
            config={config}
            catEntries={catEntries}
            transTable={transTable}
            transmutationOn={transmutationOn}
            gradeScale={config.grade_scale}
          />
        </>
      )}

      {/* ── Legacy mode ── */}
      {!isCustomMode && (
        <>
          {totalLegacy === 0 && !showWizard && (
            <div style={{ ...GLASS, padding: '24px 28px', marginBottom: '18px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 16px', color: '#888', fontSize: '0.92rem' }}>
                No entries yet. Set up a custom grading system or use the default layout below.
              </p>
              <button
                onClick={() => setShowWizard(true)}
                style={{ background: 'linear-gradient(to right, #f2a7c0, #74bcd9)', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}
              >
                🎓 Set Up Grading System
              </button>
            </div>
          )}
          <EntrySection
            type="activities" label="Activities" icon="✍️"
            entries={activities} userSubjectId={userSubjectId} onUpdate={setActivities}
            actTypes={['Seatwork', 'Performance Task', 'Take-Home Activity', 'Laboratory Activity', 'Technical Assessment']}
            transTable={transTable} transmutationOn={transmutationOn} viewMode={viewMode}
          />
          <EntrySection
            type="quizzes" label="Quizzes" icon="📖"
            entries={quizzes} userSubjectId={userSubjectId} onUpdate={setQuizzes}
            isQuiz transTable={transTable} transmutationOn={transmutationOn} viewMode={viewMode}
          />
          <EntrySection
            type="exams" label="Exams" icon="📚"
            entries={exams} userSubjectId={userSubjectId} onUpdate={setExams}
            examTypes={['Midterm', 'Final Exam']}
            transTable={transTable} transmutationOn={transmutationOn} viewMode={viewMode}
          />
          <GradeCalculator
            activities={activities} quizzes={quizzes} exams={exams}
            transTable={transTable} transmutationOn={transmutationOn}
          />
        </>
      )}
    </div>
  );
}
