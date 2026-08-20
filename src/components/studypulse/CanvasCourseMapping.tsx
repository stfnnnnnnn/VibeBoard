'use client';

import { useState } from 'react';

interface CanvasCourse {
  id: number;
  canvas_course_id: number;
  name: string;
  course_code: string | null;
  term: string | null;
  mapping_status: 'pending' | 'linked' | 'created' | 'ignored';
  user_subject_id: number | null;
}

interface ExistingSubject {
  user_subject_id: number;
  subject_name: string;
}

const GLASS: React.CSSProperties = {
  background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  borderRadius: '20px', border: '1px solid rgba(255,255,255,0.35)', boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
};

export default function CanvasCourseMapping({
  courses, existingSubjects, onChange,
}: {
  courses: CanvasCourse[];
  existingSubjects: ExistingSubject[];
  onChange: () => void;
}) {
  const pending = courses.filter(c => c.mapping_status === 'pending');
  const [linkChoice, setLinkChoice] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const act = async (courseId: number, body: object) => {
    setBusy(courseId);
    try {
      const res  = await fetch(`/api/canvas/courses/${courseId}/map`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? 'Failed'); return; }
      onChange();
    } finally {
      setBusy(null);
    }
  };

  if (pending.length === 0) return null;

  return (
    <div style={{ ...GLASS, padding: '20px 24px', marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 800, color: '#333' }}>
        New Canvas Courses ({pending.length})
      </h3>
      {pending.map(course => (
        <div key={course.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid rgba(200,215,235,0.3)', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: '#444', flexGrow: 1 }}>
            {course.name} {course.course_code && <span style={{ color: '#999', fontWeight: 500 }}>({course.course_code})</span>}
          </span>
          <select value={linkChoice[course.id] ?? ''} onChange={e => setLinkChoice(prev => ({ ...prev, [course.id]: e.target.value }))}
            style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(180,190,215,0.5)' }}>
            <option value="">Link to existing subject…</option>
            {existingSubjects.map(s => <option key={s.user_subject_id} value={s.user_subject_id}>{s.subject_name}</option>)}
          </select>
          <button disabled={busy === course.id || !linkChoice[course.id]}
            onClick={() => act(course.id, { mode: 'link', user_subject_id: Number(linkChoice[course.id]) })}
            style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#74bcd9', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
            Link
          </button>
          <button disabled={busy === course.id}
            onClick={() => act(course.id, {
              mode: 'create', subject_name: course.name, course_code: course.course_code ?? course.name,
              units: 3, year_level: '1st Year', trimester: '1st Trimester',
            })}
            style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#f2a7c0', color: 'white', fontWeight: 700, cursor: 'pointer' }}>
            Create Subject
          </button>
          <button disabled={busy === course.id} onClick={() => act(course.id, { mode: 'ignore' })}
            style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: 'rgba(240,240,245,0.9)', color: '#888', fontWeight: 700, cursor: 'pointer' }}>
            Ignore
          </button>
        </div>
      ))}
    </div>
  );
}
