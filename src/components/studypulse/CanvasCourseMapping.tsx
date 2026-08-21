'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, PlusCircle, EyeOff } from 'lucide-react';
import { parseCanvasCourseCode } from '@/lib/canvas/normalize';

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
  background:           'rgba(255,255,255,0.4)',
  backdropFilter:       'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  borderRadius:         '22px',
  border:               '1px solid rgba(255,255,255,0.4)',
  boxShadow:            '0 8px 24px rgba(31,38,68,0.09)',
};

const chip = (bg: string, color: string): React.CSSProperties => ({
  background: bg, color, borderRadius: '999px', padding: '3px 10px',
  fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
});

const pillBtn: React.CSSProperties = {
  border: 'none', borderRadius: '999px', padding: '8px 15px', fontWeight: 700,
  fontSize: '0.82rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
};

export default function CanvasCourseMapping({
  courses, existingSubjects, onChange,
}: {
  courses: CanvasCourse[];
  existingSubjects: ExistingSubject[];
  onChange: () => void;
}) {
  const router = useRouter();
  const pending = courses.filter(c => c.mapping_status === 'pending');
  const [linkChoice, setLinkChoice] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const act = async (courseId: number, body: { mode: 'link' | 'create' | 'ignore' } & Record<string, unknown>) => {
    setBusy(courseId);
    try {
      const res  = await fetch(`/api/canvas/courses/${courseId}/map`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? 'Failed'); return; }
      /* 'create' just made a brand-new, ungraded subject — take the student
         straight to it with the ?new=1 signal so the grading setup wizard opens.
         'link' and 'ignore' create nothing, so they keep refreshing in place. */
      if (body.mode === 'create' && data.user_subject_id) {
        router.push(`/studypulse/${data.user_subject_id}?new=1`);
        return;
      }
      onChange();
    } catch (err) {
      alert('Map failed: ' + (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const createSubject = (course: CanvasCourse) => {
    const parsed = parseCanvasCourseCode(course.course_code);
    act(course.id, {
      mode: 'create',
      subject_name: course.name,
      course_code:  parsed.courseCode || course.course_code || course.name,
      section:      parsed.section,
      units: 3, year_level: '1st Year', trimester: parsed.termLabel ?? '1st Trimester',
    });
  };

  if (pending.length === 0) return null;

  return (
    <div style={{ ...GLASS, padding: '22px 26px', marginBottom: '20px' }}>
      <style jsx>{`
        .ccm-row { transition: transform 150ms ease, box-shadow 150ms ease; }
        .ccm-row:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(116,188,217,0.16); }
        .ccm-select:focus { outline: none; border-color: #74bcd9; }
        .ccm-link:hover   { background: rgba(116,188,217,0.85) !important; }
        .ccm-create:hover { filter: brightness(1.04); }
        .ccm-ignore:hover { background: rgba(255,255,255,0.85) !important; }
      `}</style>
      <h3 style={{
        margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 800, color: '#2d3748',
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      }}>
        New Canvas Courses <span style={{ color: '#8a94a6', fontWeight: 700 }}>({pending.length})</span>
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {pending.map(course => {
          const parsed = parseCanvasCourseCode(course.course_code);
          return (
          <div key={course.id} className="ccm-row" style={{
            background: 'rgba(255,255,255,0.55)', borderRadius: '16px', padding: '14px 18px',
            display: 'flex', flexDirection: 'column', gap: '12px',
          }}>
            <div>
              <div style={{ fontWeight: 700, color: '#333', fontSize: '0.92rem' }}>{course.name}</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                {parsed.courseCode && <span style={chip('rgba(116,188,217,0.16)', '#2a7fa8')}>{parsed.courseCode}</span>}
                {parsed.termLabel && <span style={chip('rgba(242,167,192,0.18)', '#a0507a')}>{parsed.termLabel}{parsed.schoolYear ? ` · SY ${parsed.schoolYear}` : ''}</span>}
                {parsed.section && <span style={chip('rgba(120,130,150,0.14)', '#5c6b80')}>Block {parsed.section}</span>}
                {!parsed.termLabel && course.course_code && !parsed.courseCode && (
                  <span style={{ fontSize: '0.78rem', color: '#999' }}>{course.course_code}</span>
                )}
              </div>
            </div>

            {/* Actions always live on their own row, in the same order, regardless of how
                much text the name/chips above take up — nothing here should shift position
                depending on the course's content. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <select value={linkChoice[course.id] ?? ''} onChange={e => setLinkChoice(prev => ({ ...prev, [course.id]: e.target.value }))}
                className="ccm-select"
                style={{ padding: '7px 12px', borderRadius: '10px', border: '1px solid rgba(180,190,215,0.5)', fontSize: '0.82rem', background: 'rgba(255,255,255,0.8)' }}>
                <option value="">Link to existing subject…</option>
                {existingSubjects.map(s => <option key={s.user_subject_id} value={s.user_subject_id}>{s.subject_name}</option>)}
              </select>
              <button className="ccm-link" disabled={busy === course.id || !linkChoice[course.id]}
                onClick={() => act(course.id, { mode: 'link', user_subject_id: Number(linkChoice[course.id]) })}
                style={{ ...pillBtn, background: '#74bcd9', color: 'white', opacity: !linkChoice[course.id] ? 0.5 : 1, cursor: !linkChoice[course.id] ? 'not-allowed' : 'pointer' }}>
                <Link2 size={13} /> Link
              </button>
              <button className="ccm-create" disabled={busy === course.id}
                onClick={() => createSubject(course)}
                style={{ ...pillBtn, background: 'linear-gradient(to right, #f2a7c0, #74bcd9)', color: 'white', boxShadow: '0 4px 14px rgba(242,167,192,0.3)' }}>
                <PlusCircle size={13} /> Create Subject
              </button>
              <button className="ccm-ignore" disabled={busy === course.id} onClick={() => act(course.id, { mode: 'ignore' })}
                style={{ ...pillBtn, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.5)', color: '#8a94a6', marginLeft: 'auto' }}>
                <EyeOff size={13} /> Ignore
              </button>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
