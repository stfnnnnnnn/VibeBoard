'use client';

import { useState } from 'react';

interface BankItem {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  submission_status: string | null;
  submission_score: number | null;
  course_name: string;
  user_subject_id: number | null;
}

const GLASS: React.CSSProperties = {
  background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  borderRadius: '20px', border: '1px solid rgba(255,255,255,0.35)', boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
};

export default function CanvasActivityBank({ items, onChange }: { items: BankItem[]; onChange: () => void }) {
  const [includingId, setIncludingId] = useState<number | null>(null);
  const [targetType, setTargetType]   = useState<'activities' | 'quizzes' | 'exams'>('activities');
  const [busy, setBusy]               = useState<number | null>(null);

  const confirmInclude = async (bankId: number) => {
    setBusy(bankId);
    try {
      const res  = await fetch(`/api/canvas/bank/${bankId}/include`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: targetType }),
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
    <div style={{ ...GLASS, padding: '20px 24px', marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 800, color: '#333' }}>
        Activity Bank ({items.length})
      </h3>
      {items.map(item => (
        <div key={item.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(200,215,235,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: '#444', flexGrow: 1 }}>{item.name}</span>
            <span style={{ fontSize: '0.78rem', color: '#999' }}>{item.course_name}</span>
            <span style={{ fontSize: '0.78rem', color: '#999' }}>
              {item.due_at ? `Due ${new Date(item.due_at).toLocaleDateString()}` : 'No due date'}
            </span>
            <button disabled={busy === item.id || !item.user_subject_id} onClick={() => setIncludingId(includingId === item.id ? null : item.id)}
              style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#74bcd9', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
              Include
            </button>
            <button disabled={busy === item.id} onClick={() => ignore(item.id)}
              style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: 'rgba(240,240,245,0.9)', color: '#888', fontWeight: 700, cursor: 'pointer' }}>
              Ignore
            </button>
          </div>
          {includingId === item.id && (
            <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <select value={targetType} onChange={e => setTargetType(e.target.value as typeof targetType)}
                style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(180,190,215,0.5)' }}>
                <option value="activities">Activity</option>
                <option value="quizzes">Quiz</option>
                <option value="exams">Exam</option>
              </select>
              <button disabled={busy === item.id} onClick={() => confirmInclude(item.id)}
                style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: '#f2a7c0', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
                Confirm Include
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
