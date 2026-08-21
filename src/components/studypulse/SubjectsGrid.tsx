'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, ArrowRight, GraduationCap, Layers, Home } from 'lucide-react';

export interface SubjectCard {
  user_subject_id:  number;
  subject_name:     string;
  course_code:      string;
  units:            number;
  year_level:       string;
  trimester:        string;
  completed_tasks:  number;
  total_tasks:      number;
  progress_percent: number;
}

/* ─── Static form options ─── */

const YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
const TERMS       = ['1st Term', '2nd Term', '3rd Term'];
const TRIMESTERS  = ['1st Trimester', '2nd Trimester', '3rd Trimester'];
const UNIT_OPTIONS = [0, 1, 2, 3];

/* ─── Layout constants ─── */

const dashboardWrapper: React.CSSProperties = {
  padding:    '32px 40px 64px',
  maxWidth:   '1400px',
  width:      '100%',
  margin:     '0 auto',
};

const label = (text: string, required = false) => (
  <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#7a8699', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
    {text}{required && <span style={{ color: '#e88aa8', marginLeft: '3px' }}>*</span>}
  </span>
);

/* ─── Grade/progress ring — brand-gradient donut with a glass center ─── */
function GradeRing({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div
      style={{
        position:   'relative',
        width:      '52px',
        height:     '52px',
        borderRadius: '50%',
        flexShrink: 0,
        background: `conic-gradient(from -90deg, #f2a7c0 0%, #74bcd9 ${clamped}%, rgba(120,130,150,0.16) ${clamped}%)`,
      }}
    >
      <div style={{
        position:       'absolute',
        inset:          '5px',
        borderRadius:   '50%',
        background:     'rgba(255,255,255,0.88)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontSize:       '0.7rem',
        fontWeight:     800,
        color:          '#33465e',
      }}>
        {clamped}%
      </div>
    </div>
  );
}

export default function SubjectsGrid({ initialSubjects }: { initialSubjects: SubjectCard[] }) {
  const router = useRouter();
  const [subjects, setSubjects] = useState(initialSubjects);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    course_code:  '',
    subject_name: '',
    year_level:   '',
    term:         '',
    semester:     '',   // trimester
    units:        '3',
  });

  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.course_code || !form.subject_name || !form.year_level || !form.semester) {
      setMessage('All required fields must be filled in.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const res  = await fetch('/api/studypulse/subjects', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          course_code:  form.course_code,
          subject_name: form.subject_name,
          year_level:   form.year_level,
          trimester:    form.semester,
          units:        form.units,
        }),
      });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error);
      /* Go straight to the new subject with the ?new=1 signal — SubjectCardView
         consumes it to auto-open the grading setup wizard. No need to reset or
         close the form: we're leaving this page. */
      router.push(`/studypulse/${data.user_subject_id}?new=1`);
    } catch (err) {
      setMessage((err as Error).message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm('Delete this subject? This cannot be undone.')) return;
    await fetch(`/api/studypulse/subjects/${id}`, { method: 'DELETE' });
    setSubjects(prev => prev.filter(s => s.user_subject_id !== id));
  };

  return (
    <div
      className="vb-bg"
      style={{ margin: 0, fontFamily: "'Segoe UI', sans-serif", minHeight: '100vh', color: '#333' }}
    >
      <style jsx>{`
        .sp-pill:hover { background: rgba(255,255,255,0.85) !important; }
        .subject-card {
          transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
        }
        @media (hover: hover) and (pointer: fine) {
          .subject-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 20px 40px rgba(31, 38, 68, 0.16);
            border-color: rgba(255, 255, 255, 0.55);
          }
          .subject-card:hover .card-arrow {
            opacity: 1;
            transform: translateX(0);
          }
          .subject-card:hover .card-delete {
            opacity: 0.7;
          }
        }
        .card-arrow {
          opacity: 0;
          transform: translateX(-4px);
          transition: opacity 180ms ease, transform 180ms ease;
        }
        .card-delete {
          opacity: 0.45;
          transition: opacity 150ms ease, background 150ms ease, color 150ms ease, transform 100ms ease;
        }
        .card-delete:hover, .card-delete:focus-visible {
          opacity: 1 !important;
          background: rgba(254, 226, 226, 0.9) !important;
          color: #dc2626 !important;
        }
        .card-delete:active { transform: scale(0.92); }

        .toggle-icon { transition: transform 220ms cubic-bezier(0.23, 1, 0.32, 1); }
        .toggle-icon.open { transform: rotate(135deg); }

        .add-toggle-btn { transition: transform 150ms ease, box-shadow 150ms ease; }
        .add-toggle-btn:active { transform: scale(0.97); }

        .add-form-shell {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 280ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .add-form-shell.open { grid-template-rows: 1fr; }
        .add-form-inner { overflow: hidden; min-height: 0; }
        .add-form-content {
          opacity: 0;
          transition: opacity 180ms ease;
        }
        .add-form-shell.open .add-form-content {
          opacity: 1;
          transition-delay: 90ms;
        }

        .submit-btn { transition: transform 120ms ease, opacity 150ms ease; }
        .submit-btn:active:not(:disabled) { transform: scale(0.97); }

        @media (prefers-reduced-motion: reduce) {
          .subject-card, .card-arrow, .card-delete, .toggle-icon, .add-toggle-btn,
          .add-form-shell, .add-form-content, .submit-btn {
            transition-duration: 1ms !important;
          }
          .subject-card:hover { transform: none; }
        }
      `}</style>

      <div style={dashboardWrapper}>

        {/* ── Title row ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px', marginBottom: '4px' }}>
          <h1
            className="gradient-text"
            style={{ fontSize: 'clamp(1.9rem, 4vw, 2.8rem)', fontWeight: 800, margin: 0, fontFamily: "'DM Sans', 'Segoe UI', sans-serif", letterSpacing: '-0.01em' }}
          >
            My Subjects
          </h1>
          <button
            onClick={() => router.push('/studypulse')}
            className="sp-pill"
            style={{
              marginLeft:    'auto',
              background:    'rgba(255,255,255,0.55)',
              border:        '1px solid rgba(255,255,255,0.45)',
              borderRadius:  '999px',
              padding:       '9px 16px',
              cursor:        'pointer',
              display:       'flex',
              alignItems:    'center',
              gap:           '7px',
              fontSize:      '0.85rem',
              fontWeight:    700,
              color:         '#5c6b80',
              transition:    'background 150ms ease',
            }}
          >
            <Home size={15} color="#74bcd9" strokeWidth={2.2} /> Dashboard
          </button>
        </div>

        <p style={{ fontSize: '0.92rem', color: '#5c6b80', margin: '0 0 24px', fontWeight: 500 }}>
          {subjects.length} subject{subjects.length !== 1 ? 's' : ''} this trimester
        </p>

        {/* ── Toggle add-subject form button ── */}
        <button
          className="add-toggle-btn"
          onClick={() => setShowForm(f => !f)}
          style={{
            marginBottom: '18px',
            padding:      '11px 20px 11px 16px',
            background:   'linear-gradient(90deg, #f0679d, #74bcd9)',
            border:       'none',
            color:        'white',
            borderRadius: '999px',
            cursor:       'pointer',
            fontWeight:   700,
            fontSize:     '0.92rem',
            fontFamily:   "'Segoe UI', sans-serif",
            display:      'inline-flex',
            alignItems:   'center',
            gap:          '8px',
            boxShadow:    '0 8px 22px rgba(240,103,157,0.24)',
          }}
        >
          <Plus size={18} className={`toggle-icon${showForm ? ' open' : ''}`} />
          {showForm ? 'Cancel' : 'Add New Subject'}
        </button>

        {/* ── Add subject form (grid-rows expand/collapse, no JS height measuring) ── */}
        <div className={`add-form-shell${showForm ? ' open' : ''}`}>
          <div className="add-form-inner">
            <form onSubmit={handleAdd} className="add-form-content" style={{
              background:      'rgba(255,255,255,0.55)',
              backdropFilter:  'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border:          '1px solid rgba(255,255,255,0.5)',
              borderRadius:    '20px',
              padding:         '26px 28px',
              marginBottom:    '28px',
              boxShadow:       '0 8px 30px rgba(116,188,217,0.14)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <Layers size={20} color="#e88aa8" />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: '#3a4258' }}>
                  New Subject Details
                </h3>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '4px' }}>
                <div>
                  {label('Course Code', true)}
                  <input placeholder="e.g. CS101" value={form.course_code} onChange={e => set('course_code', e.target.value)} required className="vb-input" />
                </div>
                <div>
                  {label('Subject Name', true)}
                  <input placeholder="e.g. Data Structures" value={form.subject_name} onChange={e => set('subject_name', e.target.value)} required className="vb-input" />
                </div>
                <div>
                  {label('Year Level', true)}
                  <select value={form.year_level} onChange={e => set('year_level', e.target.value)} required className="vb-input">
                    <option value="">Select</option>
                    {YEAR_LEVELS.map(y => <option key={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  {label('Term')}
                  <select value={form.term} onChange={e => set('term', e.target.value)} className="vb-input">
                    <option value="">Select term</option>
                    {TERMS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  {label('Trimester', true)}
                  <select value={form.semester} onChange={e => set('semester', e.target.value)} required className="vb-input">
                    <option value="">Select trimester</option>
                    {TRIMESTERS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  {label('Units')}
                  <select value={form.units} onChange={e => set('units', e.target.value)} className="vb-input">
                    {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u} Unit{u !== 1 ? 's' : ''}</option>)}
                  </select>
                </div>
              </div>

              {message && (
                <div style={{ marginTop: '14px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(254,226,226,0.7)', border: '1px solid rgba(220,38,38,0.18)', color: '#b91c1c', fontSize: '0.85rem', fontWeight: 600 }}>
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="submit-btn vb-btn-pink"
                style={{ width: 'auto', padding: '11px 30px', marginTop: '18px', borderRadius: '12px' }}
              >
                {submitting ? 'Adding…' : 'Add Subject'}
              </button>
            </form>
          </div>
        </div>

        {/* ── Subject cards grid ── */}
        {subjects.length > 0 ? (
          <div style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap:                 '20px',
          }}>
            {subjects.map((sub, idx) => (
              <div
                key={sub.user_subject_id}
                className="subject-card animate-fade-in-up"
                style={{
                  background:          'rgba(255,255,255,0.4)',
                  backdropFilter:      'blur(14px)',
                  WebkitBackdropFilter:'blur(14px)',
                  borderRadius:        '20px',
                  border:              '1px solid rgba(255,255,255,0.4)',
                  padding:             '20px',
                  boxShadow:           '0 8px 24px rgba(31,38,68,0.09)',
                  position:            'relative',
                  cursor:              'pointer',
                  userSelect:          'none',
                  display:             'flex',
                  flexDirection:       'column',
                  gap:                 '14px',
                  animationDelay:      `${Math.min(idx, 12) * 45}ms`,
                }}
                onClick={() => router.push(`/studypulse/${sub.user_subject_id}`)}
                onContextMenu={e => handleDelete(e, sub.user_subject_id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.72rem', fontWeight: 800, color: '#e88aa8',
                      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px',
                    }}>
                      {sub.course_code}
                    </div>
                    <div style={{
                      fontSize: '1.08rem', fontWeight: 700, color: '#2e3648', lineHeight: 1.25,
                      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {sub.subject_name}
                    </div>
                  </div>
                  <GradeRing pct={sub.progress_percent} />
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {sub.year_level && (
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                      background: 'rgba(242,167,192,0.18)', color: '#c65f83',
                    }}>
                      {sub.year_level}
                    </span>
                  )}
                  {sub.trimester && (
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                      background: 'rgba(116,188,217,0.18)', color: '#3a8dba',
                    }}>
                      {sub.trimester}
                    </span>
                  )}
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid rgba(200,210,230,0.35)',
                }}>
                  <span style={{ fontSize: '0.78rem', color: '#7a8699', fontWeight: 600 }}>
                    {sub.total_tasks > 0
                      ? `${sub.completed_tasks}/${sub.total_tasks} tasks done`
                      : 'No entries yet'}
                    {sub.units ? ` · ${sub.units} unit${sub.units !== 1 ? 's' : ''}` : ''}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      className="card-delete"
                      onClick={e => handleDelete(e, sub.user_subject_id)}
                      aria-label={`Delete ${sub.subject_name}`}
                      title="Delete subject"
                      style={{
                        width: '26px', height: '26px', borderRadius: '8px',
                        background: 'transparent', border: 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#8a94a6', cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                    <ArrowRight size={16} className="card-arrow" color="#74bcd9" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            background:      'rgba(255,255,255,0.5)',
            backdropFilter:  'blur(14px)',
            border:          '1px solid rgba(255,255,255,0.45)',
            borderRadius:    '20px',
            textAlign:       'center',
            padding:         '56px 24px',
            boxShadow:       '0 8px 24px rgba(31,38,68,0.07)',
          }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', position: 'relative', margin: '0 auto 18px' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid rgba(116,188,217,0.22)' }} />
              <div style={{
                position: 'absolute', inset: '6px', borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(242,167,192,0.18), rgba(116,188,217,0.18))',
                border: '2.5px solid rgba(116,188,217,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <GraduationCap size={26} color="#3a8dba" strokeWidth={2.1} />
              </div>
            </div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#3a4258', margin: '0 0 6px' }}>
              No subjects yet
            </h3>
            <p style={{ fontSize: '0.88rem', color: '#7a8699', margin: '0 0 20px' }}>
              Add your first subject to start tracking grades and tasks.
            </p>
            <button
              className="add-toggle-btn"
              onClick={() => setShowForm(true)}
              style={{
                padding: '10px 24px', background: 'linear-gradient(90deg, #f0679d, #74bcd9)',
                border: 'none', color: 'white', borderRadius: '999px', cursor: 'pointer',
                fontWeight: 700, fontSize: '0.88rem', display: 'inline-flex', alignItems: 'center', gap: '8px',
              }}
            >
              <Plus size={16} /> Add New Subject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
