'use client';

import { useState, useMemo } from 'react';
import { CheckCircle2, EyeOff, Clock, Megaphone } from 'lucide-react';
import type { SuggestedCategory } from '@/lib/canvas/classify';

export interface AnnouncementItem {
  id: number;
  title: string;
  message: string | null;
  posted_at: string | null;
  course_name: string;
  user_subject_id: number | null;
  subject_mode?: 'legacy' | 'custom';
  bank_status: 'pending' | 'included' | 'ignored' | 'removed_upstream';
  suggested_category: SuggestedCategory;
  html_url: string | null;
}

interface GradingCategory { cat_id: number; name: string; }
interface GradingPeriod { period_id: number; name: string; categories: GradingCategory[]; }

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

const FILTER_PILL: React.CSSProperties = {
  border: '1px solid rgba(200,210,230,0.5)', borderRadius: '999px', padding: '6px 14px',
  fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', background: 'rgba(255,255,255,0.5)', color: '#5c6b80',
};
const FILTER_PILL_ACTIVE: React.CSSProperties = {
  ...FILTER_PILL, background: 'linear-gradient(to right, #f2a7c0, #74bcd9)', color: 'white', border: 'none',
};

function stripHtml(html: string | null): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function suggestionLabel(s: SuggestedCategory): string | null {
  if (s.kind === 'legacy') return s.target === 'activities' ? 'Activity' : s.target === 'quizzes' ? 'Quiz' : 'Exam';
  if (s.kind === 'custom') return s.categoryName;
  return null;
}

const FILTERS = ['all', 'needs_review', 'converted', 'dismissed'] as const;
type Filter = typeof FILTERS[number];
const FILTER_LABELS: Record<Filter, string> = {
  all: 'All', needs_review: 'Needs Review', converted: 'Converted', dismissed: 'Dismissed',
};

export default function CanvasAnnouncementBank({ items, onChange }: { items: AnnouncementItem[]; onChange: () => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [includingId, setIncludingId] = useState<number | null>(null);
  const [targetType, setTargetType] = useState<'activities' | 'quizzes' | 'exams'>('activities');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const [periodsBySubject, setPeriodsBySubject] = useState<Record<number, GradingPeriod[]>>({});
  const [loadingSubjectId, setLoadingSubjectId] = useState<number | null>(null);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [catId, setCatId] = useState<number | null>(null);

  const filtered = useMemo(() => items.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'needs_review') return item.bank_status === 'pending';
    if (filter === 'converted') return item.bank_status === 'included';
    return item.bank_status === 'ignored'; // dismissed
  }), [items, filter]);

  const openInclude = async (item: AnnouncementItem) => {
    if (includingId === item.id) { setIncludingId(null); return; }
    setIncludingId(item.id);
    setPeriodId(null);
    setCatId(null);
    setDeadline('');
    setTargetType(item.suggested_category.kind === 'legacy' ? item.suggested_category.target : 'activities');

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

  /** Picking a period auto-preselects a category matching the suggestion, if that period has one. */
  const handlePeriodChange = (item: AnnouncementItem, newPeriodId: number) => {
    setPeriodId(newPeriodId);
    const subjectId = item.user_subject_id!;
    const period = periodsBySubject[subjectId]?.find(p => p.period_id === newPeriodId);
    const suggestion = item.suggested_category.kind === 'custom' ? item.suggested_category.categoryName : null;
    const match = suggestion ? period?.categories.find(c => c.name === suggestion) : null;
    setCatId(match ? match.cat_id : null);
  };

  const confirmInclude = async (item: AnnouncementItem) => {
    const customMode = item.subject_mode === 'custom';
    if (!deadline) { alert('Choose a deadline first'); return; }
    if (customMode && (periodId == null || catId == null)) {
      alert('Choose a grading period and category first');
      return;
    }
    setBusy(item.id);
    try {
      const res = await fetch(`/api/canvas/announcements/${item.id}/include`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          customMode
            ? { target_type: 'grade_entries', period_id: periodId, cat_id: catId, deadline }
            : { target_type: targetType, deadline },
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

  const dismiss = async (announcementId: number) => {
    setBusy(announcementId);
    try {
      const res = await fetch(`/api/canvas/announcements/${announcementId}/ignore`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error ?? 'Failed to dismiss');
        return;
      }
      onChange();
    } catch (err) {
      alert('Dismiss failed: ' + (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) {
    return (
      <div id="announcements" style={{ ...GLASS, padding: '22px 26px', marginBottom: '20px' }}>
        <h3 style={{
          margin: '0 0 8px', fontSize: '1.05rem', fontWeight: 800, color: '#2d3748',
          fontFamily: "'DM Sans', 'Segoe UI', sans-serif", display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <Megaphone size={18} color="#74bcd9" /> Announcements
        </h3>
        <p style={{ color: '#8a94a6', fontSize: '0.85rem', margin: 0 }}>No announcements synced yet.</p>
      </div>
    );
  }

  return (
    <div id="announcements" style={{ ...GLASS, padding: '22px 26px', marginBottom: '20px' }}>
      <style jsx>{`
        .cab2-row { transition: transform 150ms ease, box-shadow 150ms ease; }
        .cab2-row:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(116,188,217,0.16); }
        .cab2-include:hover:not(:disabled) { filter: brightness(1.04); }
        .cab2-dismiss:hover:not(:disabled) { background: rgba(255,255,255,0.85) !important; }
        .cab2-select:focus { outline: none; border-color: #74bcd9; }
      `}</style>
      <h3 style={{
        margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 800, color: '#2d3748',
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif", display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        <Megaphone size={18} color="#74bcd9" /> Announcements <span style={{ color: '#8a94a6', fontWeight: 700 }}>({items.length})</span>
      </h3>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={filter === f ? FILTER_PILL_ACTIVE : FILTER_PILL}>
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <p style={{ color: '#8a94a6', fontSize: '0.85rem', margin: 0 }}>Nothing here.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filtered.map(item => {
          const customMode = item.subject_mode === 'custom';
          const actionable = item.bank_status === 'pending' || item.bank_status === 'ignored';
          const periods = item.user_subject_id ? periodsBySubject[item.user_subject_id] : undefined;
          const loading = item.user_subject_id != null && loadingSubjectId === item.user_subject_id;
          const selectedPeriod = periods?.find(p => p.period_id === periodId) ?? null;
          const suggestion = suggestionLabel(item.suggested_category);
          const messageText = stripHtml(item.message);
          return (
          <div key={item.id} className="cab2-row" style={{
            background: 'rgba(255,255,255,0.55)', borderRadius: '16px', padding: '14px 18px',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {item.html_url ? (
                  <a href={item.html_url} target="_blank" rel="noreferrer"
                    style={{ fontWeight: 700, color: '#333', flexGrow: 1, fontSize: '0.92rem', textDecoration: 'none' }}>
                    {item.title}
                  </a>
                ) : (
                  <span style={{ fontWeight: 700, color: '#333', flexGrow: 1, fontSize: '0.92rem' }}>{item.title}</span>
                )}
                <span style={{
                  fontSize: '0.72rem', fontWeight: 700, color: '#2a7fa8',
                  background: 'rgba(116,188,217,0.16)', borderRadius: '999px', padding: '3px 10px',
                }}>
                  {item.course_name}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#8a94a6', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={12} /> {item.posted_at ? new Date(item.posted_at).toLocaleDateString() : 'Unknown date'}
                </span>
              </div>
              {messageText && (
                <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: '#666', lineHeight: 1.4 }}>
                  {messageText.slice(0, 160)}{messageText.length > 160 ? '…' : ''}
                </p>
              )}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                {suggestion && (
                  <span style={{ background: 'rgba(242,167,192,0.18)', color: '#a0507a', borderRadius: '999px', padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                    Suggests: {suggestion}
                  </span>
                )}
                {item.bank_status === 'included' && (
                  <span style={{ background: 'rgba(120,200,150,0.2)', color: '#2f8a5a', borderRadius: '999px', padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                    Added
                  </span>
                )}
                {item.bank_status === 'ignored' && (
                  <span style={{ background: 'rgba(120,130,150,0.14)', color: '#5c6b80', borderRadius: '999px', padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                    Dismissed
                  </span>
                )}
                {item.bank_status === 'removed_upstream' && (
                  <span style={{ background: 'rgba(120,130,150,0.14)', color: '#5c6b80', borderRadius: '999px', padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                    No longer on Canvas
                  </span>
                )}
              </div>
            </div>
            {actionable && item.user_subject_id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="cab2-include" disabled={busy === item.id} onClick={() => openInclude(item)}
                  style={{ ...pillBtn, color: 'white', background: 'linear-gradient(to right, #74bcd9, #4dabf5)' }}>
                  <CheckCircle2 size={13} /> Include
                </button>
                <button className="cab2-dismiss" disabled={busy === item.id} onClick={() => dismiss(item.id)}
                  style={{ ...pillBtn, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.5)', color: '#8a94a6' }}>
                  <EyeOff size={13} /> Keep as Announcement
                </button>
              </div>
            )}
            {includingId === item.id && !customMode && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="cab2-select" style={selectStyle} />
                <select value={targetType} onChange={e => setTargetType(e.target.value as typeof targetType)} className="cab2-select" style={selectStyle}>
                  <option value="activities">Activity</option>
                  <option value="quizzes">Quiz</option>
                  <option value="exams">Exam</option>
                </select>
                <button disabled={busy === item.id || !deadline} onClick={() => confirmInclude(item)} className="cab2-include"
                  style={{
                    ...pillBtn, color: 'white',
                    background: !deadline ? 'rgba(242,167,192,0.5)' : 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                    cursor: !deadline ? 'not-allowed' : 'pointer',
                  }}>
                  Confirm Include
                </button>
              </div>
            )}
            {includingId === item.id && customMode && (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {loading && <span style={{ fontSize: '0.8rem', color: '#8a94a6' }}>Loading grading periods…</span>}
                {!loading && periods && periods.length === 0 && (
                  <span style={{ fontSize: '0.8rem', color: '#a0507a', fontWeight: 600 }}>
                    This subject has no grading periods configured yet.
                  </span>
                )}
                {!loading && periods && periods.length > 0 && (
                  <>
                    <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="cab2-select" style={selectStyle} />
                    <select value={periodId ?? ''} onChange={e => handlePeriodChange(item, Number(e.target.value))} className="cab2-select" style={selectStyle}>
                      <option value="" disabled>Period…</option>
                      {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.name}</option>)}
                    </select>
                    <select value={catId ?? ''} onChange={e => setCatId(Number(e.target.value))} disabled={!selectedPeriod} className="cab2-select" style={selectStyle}>
                      <option value="" disabled>Category…</option>
                      {selectedPeriod?.categories.map(c => <option key={c.cat_id} value={c.cat_id}>{c.name}</option>)}
                    </select>
                    <button
                      disabled={busy === item.id || periodId == null || catId == null || !deadline}
                      onClick={() => confirmInclude(item)} className="cab2-include"
                      style={{
                        ...pillBtn, color: 'white',
                        background: (periodId == null || catId == null || !deadline) ? 'rgba(242,167,192,0.5)' : 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                        cursor: (periodId == null || catId == null || !deadline) ? 'not-allowed' : 'pointer',
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
