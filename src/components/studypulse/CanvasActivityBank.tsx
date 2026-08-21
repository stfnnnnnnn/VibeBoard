'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';

interface BankItem {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  submission_status: string | null;
  submission_score: number | null;
  course_name: string;
  user_subject_id: number | null;
  /** 'custom' = the mapped subject uses a grading preset; Include asks for a period+category instead of Activity/Quiz/Exam. */
  subject_mode?: 'legacy' | 'custom';
}

interface GradingCategory {
  cat_id: number;
  name: string;
}

interface GradingPeriod {
  period_id: number;
  name: string;
  categories: GradingCategory[];
}

const GLASS: React.CSSProperties = {
  background:           'rgba(255,255,255,0.4)',
  backdropFilter:       'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  borderRadius:         '22px',
  border:               '1px solid rgba(255,255,255,0.4)',
  boxShadow:            '0 8px 24px rgba(31,38,68,0.09)',
};

const selectStyle: React.CSSProperties = {
  padding: '7px 12px', borderRadius: '10px', border: '1px solid rgba(180,190,215,0.5)',
  fontSize: '0.82rem', background: 'rgba(255,255,255,0.8)',
};

const pillBtn: React.CSSProperties = {
  border: 'none', borderRadius: '999px', padding: '8px 15px', fontWeight: 700,
  fontSize: '0.82rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
};

export default function CanvasActivityBank({ items, onChange }: { items: BankItem[]; onChange: () => void }) {
  const [includingId, setIncludingId] = useState<number | null>(null);
  const [targetType, setTargetType]   = useState<'activities' | 'quizzes' | 'exams'>('activities');
  const [busy, setBusy]               = useState<number | null>(null);

  // Custom-mode Include: periods+categories are fetched per subject (once, cached) and the
  // user's in-progress period/category choice is tracked per open panel.
  const [periodsBySubject, setPeriodsBySubject] = useState<Record<number, GradingPeriod[]>>({});
  const [loadingSubjectId, setLoadingSubjectId]  = useState<number | null>(null);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [catId, setCatId]       = useState<number | null>(null);

  const openInclude = async (item: BankItem) => {
    if (includingId === item.id) { setIncludingId(null); return; }
    setIncludingId(item.id);
    setPeriodId(null);
    setCatId(null);

    const subjectId = item.user_subject_id;
    if (item.subject_mode === 'custom' && subjectId && !periodsBySubject[subjectId]) {
      setLoadingSubjectId(subjectId);
      try {
        const res  = await fetch(`/api/studypulse/subjects/${subjectId}/grading`);
        const data = await res.json();
        const periods: GradingPeriod[] = data.config?.preset?.periods ?? [];
        setPeriodsBySubject(prev => ({ ...prev, [subjectId]: periods }));
      } catch (err) {
        alert('Failed to load grading periods: ' + (err as Error).message);
      } finally {
        setLoadingSubjectId(null);
      }
    }
  };

  const confirmInclude = async (item: BankItem) => {
    const customMode = item.subject_mode === 'custom';
    if (customMode && (periodId == null || catId == null)) {
      alert('Choose a grading period and category first');
      return;
    }
    setBusy(item.id);
    try {
      const res  = await fetch(`/api/canvas/bank/${item.id}/include`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          customMode
            ? { target_type: 'grade_entries', period_id: periodId, cat_id: catId }
            : { target_type: targetType },
        ),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? 'Failed'); return; }
      setIncludingId(null);
      onChange();
    } catch (err) {
      alert('Include failed: ' + (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const ignore = async (bankId: number) => {
    setBusy(bankId);
    try {
      const res = await fetch(`/api/canvas/bank/${bankId}/ignore`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error ?? 'Failed to ignore item');
        return;
      }
      onChange();
    } catch (err) {
      alert('Ignore failed: ' + (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <div style={{ ...GLASS, padding: '22px 26px', marginBottom: '20px' }}>
      <style jsx>{`
        .cab-row { transition: transform 150ms ease, box-shadow 150ms ease; }
        .cab-row:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(116,188,217,0.16); }
        .cab-include:hover:not(:disabled) { filter: brightness(1.04); }
        .cab-ignore:hover:not(:disabled)  { background: rgba(255,255,255,0.85) !important; }
        .cab-select:focus { outline: none; border-color: #74bcd9; }
      `}</style>
      <h3 style={{
        margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 800, color: '#2d3748',
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      }}>
        Activity Bank <span style={{ color: '#8a94a6', fontWeight: 700 }}>({items.length})</span>
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {items.map(item => {
          const customMode = item.subject_mode === 'custom';
          const includeOff = busy === item.id || !item.user_subject_id;
          const periods    = item.user_subject_id ? periodsBySubject[item.user_subject_id] : undefined;
          const loading    = item.user_subject_id != null && loadingSubjectId === item.user_subject_id;
          const selectedPeriod = periods?.find(p => p.period_id === periodId) ?? null;
          return (
          <div key={item.id} className="cab-row" style={{
            background: 'rgba(255,255,255,0.55)', borderRadius: '16px', padding: '14px 18px',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: '#333', flexGrow: 1, fontSize: '0.92rem' }}>{item.name}</span>
              <span style={{
                fontSize: '0.72rem', fontWeight: 700, color: '#2a7fa8',
                background: 'rgba(116,188,217,0.16)', borderRadius: '999px', padding: '3px 10px',
              }}>
                {item.course_name}
              </span>
              <span style={{ fontSize: '0.78rem', color: '#8a94a6', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={12} />
                {item.due_at ? new Date(item.due_at).toLocaleDateString() : 'No due date'}
              </span>
            </div>
            {/* Actions always live on their own row, right-aligned, regardless of how much
                text the name/badges above take up — nothing here should shift position
                depending on the item's content. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="cab-include" disabled={includeOff} onClick={() => openInclude(item)}
                style={{
                  ...pillBtn, color: 'white',
                  background: includeOff ? 'rgba(116,188,217,0.4)' : 'linear-gradient(to right, #74bcd9, #4dabf5)',
                  cursor: includeOff ? 'not-allowed' : 'pointer',
                }}>
                <CheckCircle2 size={13} /> Include
              </button>
              <button className="cab-ignore" disabled={busy === item.id} onClick={() => ignore(item.id)}
                style={{ ...pillBtn, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.5)', color: '#8a94a6' }}>
                <XCircle size={13} /> Ignore
              </button>
            </div>
            {includingId === item.id && !customMode && (
              <div style={{ marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <select value={targetType} onChange={e => setTargetType(e.target.value as typeof targetType)} className="cab-select" style={selectStyle}>
                  <option value="activities">Activity</option>
                  <option value="quizzes">Quiz</option>
                  <option value="exams">Exam</option>
                </select>
                <button disabled={busy === item.id} onClick={() => confirmInclude(item)} className="cab-include"
                  style={{ ...pillBtn, background: 'linear-gradient(to right, #f2a7c0, #74bcd9)', color: 'white', boxShadow: '0 4px 14px rgba(242,167,192,0.3)' }}>
                  Confirm Include
                </button>
              </div>
            )}
            {includingId === item.id && customMode && (
              <div style={{ marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                {loading && <span style={{ fontSize: '0.8rem', color: '#8a94a6' }}>Loading grading periods…</span>}
                {!loading && periods && periods.length === 0 && (
                  <span style={{ fontSize: '0.8rem', color: '#a0507a', fontWeight: 600 }}>
                    This subject has no grading periods configured yet.
                  </span>
                )}
                {!loading && periods && periods.length > 0 && (
                  <>
                    <select value={periodId ?? ''} onChange={e => { setPeriodId(Number(e.target.value)); setCatId(null); }} className="cab-select" style={selectStyle}>
                      <option value="" disabled>Period…</option>
                      {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.name}</option>)}
                    </select>
                    <select value={catId ?? ''} onChange={e => setCatId(Number(e.target.value))} disabled={!selectedPeriod} className="cab-select" style={selectStyle}>
                      <option value="" disabled>Category…</option>
                      {selectedPeriod?.categories.map(c => <option key={c.cat_id} value={c.cat_id}>{c.name}</option>)}
                    </select>
                    <button disabled={busy === item.id || periodId == null || catId == null} onClick={() => confirmInclude(item)} className="cab-include"
                      style={{
                        ...pillBtn, color: 'white',
                        background: (periodId == null || catId == null) ? 'rgba(242,167,192,0.5)' : 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                        cursor: (periodId == null || catId == null) ? 'not-allowed' : 'pointer',
                        boxShadow: (periodId == null || catId == null) ? 'none' : '0 4px 14px rgba(242,167,192,0.3)',
                      }}>
                      Confirm Include
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
