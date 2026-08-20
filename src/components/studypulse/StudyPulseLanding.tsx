'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, Home, RefreshCw, Layers3, TrendingUp, Award, CalendarClock, CalendarDays, GraduationCap } from 'lucide-react';

/* ─── Types ─── */
export interface TrimesterData {
  ay_start_year: number | null;
  ay_end_year:   number | null;
  term_system:   'Semestral' | 'Trimestral' | 'Quarterly' | null;
  current_term:  string | null;
  academic_year: string | null;
  start_date:    string;
  end_date:      string;
}

interface OverviewStats {
  subjectCount:   number;
  daysRemaining:  number | string;
  midtermGPA:     number;
  finalGPA:       number;
  trimesterLabel: string;
  completion: {
    activity: { pct: number; avgGrade: number };
    quiz:     { pct: number; avgGrade: number };
    exam:     { pct: number; avgGrade: number };
  };
  dynamicCategories: { name: string; pct: number; avgGrade: number }[];
}

interface FilteredStats { col1: number; col2: number; col3: number; col4: number; }

const FILTER_LABELS: Record<string, [string, string, string, string]> = {
  activities: ['Accomplished Activities', 'Pending Activities',  'Total',         'Average Grade'],
  quizzes:    ['Accomplished Quizzes',    'Upcoming Quizzes',   'Total',         'Average Grade'],
  exams:      ['Accomplished Exams',      'Upcoming Exams',     'Total',         'Average Grade'],
  duedate:    ['Pending Tasks',           'Pending Quizzes',    'Pending Exams', 'Total Pending'],
  urgency:    ['Urgent Activities',       'Urgent Quizzes',     'Urgent Exams',  'Total Urgent'],
};

const FILTER_ICONS: Record<string, string> = {
  activities: '📋', quizzes: '❓', exams: '📄', duedate: '📅', urgency: '⚡',
};

const TERM_OPTIONS: Record<string, string[]> = {
  Semestral:  ['1st Semester',  '2nd Semester'],
  Trimestral: ['1st Trimester', '2nd Trimester', '3rd Trimester'],
  Quarterly:  ['1st Quarter',   '2nd Quarter',   '3rd Quarter',  '4th Quarter'],
};

/* ─── Shared tokens — matches the glass system used across Study Pulse ─── */
const GLASS: React.CSSProperties = {
  background:           'rgba(255,255,255,0.4)',
  backdropFilter:       'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border:               '1px solid rgba(255,255,255,0.4)',
  boxShadow:            '0 8px 24px rgba(31,38,68,0.09)',
};
const GLASS_STRONG: React.CSSProperties = {
  background:           'rgba(255,255,255,0.92)',
  backdropFilter:       'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border:               '1px solid rgba(255,255,255,0.5)',
  boxShadow:            '0 12px 40px rgba(0,0,0,0.18)',
};
const PILL: React.CSSProperties = {
  background: 'rgba(255,255,255,0.55)', borderRadius: '999px', padding: '9px 18px',
  fontWeight: 700, fontSize: '0.86rem', display: 'flex', alignItems: 'center',
  gap: '7px', cursor: 'pointer', border: '1px solid rgba(200,210,230,0.45)',
  color: '#5c6b80', transition: 'all 0.18s ease', fontFamily: "'Inter', sans-serif",
};
const PILL_ACTIVE: React.CSSProperties = {
  ...PILL,
  background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
  border: 'none', color: '#fff', boxShadow: '0 6px 16px rgba(116,188,217,0.35)',
};

/* ─── Grade ring — conic brand gradient with a glass center ─── */
function GradeRing({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div style={{
      width: '44px', height: '44px', borderRadius: '50%', flexShrink: 0,
      background: `conic-gradient(from -90deg, ${color} 0%, ${color} ${clamped}%, rgba(120,130,150,0.14) ${clamped}%)`,
      boxShadow: '0 2px 8px rgba(31,38,68,0.1)',
    }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: '50%', margin: 0,
        background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: '0.72rem', fontWeight: 800, color: '#33465e',
        transform: 'scale(0.78)',
      }}>
        {clamped}%
      </div>
    </div>
  );
}

/* ─── Setup Modal ─── */
function SetupModal({ onSave }: { onSave: (t: TrimesterData) => void }) {
  const thisYear = new Date().getFullYear();

  const [ayStart,      setAyStart]      = useState(thisYear);
  const [ayEnd,        setAyEnd]        = useState(thisYear + 1);
  const [termSystem,   setTermSystem]   = useState<'Semestral' | 'Trimestral' | 'Quarterly'>('Trimestral');
  const [currentTerm,  setCurrentTerm]  = useState('');
  const [startDate,    setStartDate]    = useState('');
  const [endDate,      setEndDate]      = useState('');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');

  /* Auto-advance end year when start changes */
  const handleStartYear = (v: number) => {
    setAyStart(v);
    setAyEnd(v + 1);
    setCurrentTerm('');
    setStartDate('');
    setEndDate('');
  };

  /* Reset term when system changes */
  const handleTermSystem = (v: 'Semestral' | 'Trimestral' | 'Quarterly') => {
    setTermSystem(v);
    setCurrentTerm('');
  };

  const yearOptions = Array.from({ length: 8 }, (_, i) => thisYear - 3 + i);
  const dateMin = `${ayStart}-01-01`;
  const dateMax = `${ayEnd}-12-31`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTerm) { setError('Please select a current term.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/studypulse/trimester', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ay_start_year: ayStart,
          ay_end_year:   ayEnd,
          term_system:   termSystem,
          current_term:  currentTerm,
          start_date:    startDate,
          end_date:      endDate,
        }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        onSave({
          ay_start_year: ayStart,
          ay_end_year:   ayEnd,
          term_system:   termSystem,
          current_term:  currentTerm,
          academic_year: `AY ${ayStart}-${ayEnd}`,
          start_date:    startDate,
          end_date:      endDate,
        });
      } else {
        setError(data.error ?? 'Something went wrong. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%', height: '44px', padding: '0 14px',
    border: '1px solid rgba(180,190,210,0.5)', borderRadius: '10px', fontSize: '15px',
    color: '#333', backgroundColor: 'rgba(255,255,255,0.85)', boxSizing: 'border-box',
    fontFamily: "'Inter', sans-serif", appearance: 'none',
  };
  const label: React.CSSProperties = { fontWeight: 600, fontSize: '13px', color: '#555', marginBottom: '4px', display: 'block' };
  const group: React.CSSProperties = { display: 'flex', flexDirection: 'column' };
  const row: React.CSSProperties   = { display: 'flex', gap: '12px' };

  const systemBtn = (sys: 'Semestral' | 'Trimestral' | 'Quarterly', lbl: string) => (
    <button
      key={sys}
      type="button"
      onClick={() => handleTermSystem(sys)}
      style={{
        flex: 1, padding: '10px 4px', borderRadius: '10px', fontSize: '13px',
        fontWeight: 700, cursor: 'pointer', fontFamily: "'Inter', sans-serif",
        border: termSystem === sys ? '2px solid #74bcd9' : '1px solid rgba(200,210,230,0.5)',
        background: termSystem === sys ? 'rgba(116,188,217,0.14)' : 'rgba(255,255,255,0.7)',
        color: termSystem === sys ? '#2a7fa8' : '#666',
        transition: 'all 0.15s',
        whiteSpace: 'pre-line',
      }}
    >
      {lbl}
    </button>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(20,20,40,0.55)',
      display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999,
      overflowY: 'auto', padding: '20px',
    }}>
      <form onSubmit={handleSubmit} style={{
        ...GLASS_STRONG,
        borderRadius: '20px',
        padding: '32px 28px',
        width: '100%', maxWidth: '460px',
        fontFamily: "'Inter', sans-serif", display: 'flex', flexDirection: 'column', gap: '20px',
        animation: 'fadeIn 0.25s ease-in-out',
      }}>
        <div>
          <h2 style={{ fontSize: '22px', color: '#2d3748', fontWeight: 800, margin: '0 0 4px' }}>
            🎓 Academic Setup
          </h2>
          <p style={{ fontSize: '14px', color: '#777', margin: 0 }}>
            Configure your academic year and term schedule.
          </p>
        </div>

        {/* ── Academic Year ── */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#74bcd9', letterSpacing: '0.08em', marginBottom: '10px' }}>
            ACADEMIC YEAR
          </div>
          <div style={row}>
            <div style={{ ...group, flex: 1 }}>
              <span style={label}>Start Year</span>
              <select value={ayStart} onChange={e => handleStartYear(Number(e.target.value))} style={field}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div style={{ ...group, flex: 1 }}>
              <span style={label}>End Year</span>
              <select value={ayEnd} onChange={e => { setAyEnd(Number(e.target.value)); setCurrentTerm(''); setStartDate(''); setEndDate(''); }} style={field}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div style={{
            marginTop: '8px', padding: '8px 12px', background: 'rgba(116,188,217,0.1)',
            borderRadius: '8px', fontSize: '13px', color: '#2a7fa8', fontWeight: 600,
          }}>
            Academic Year: <strong>AY {ayStart}–{ayEnd}</strong>
          </div>
        </div>

        {/* ── Term System ── */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#74bcd9', letterSpacing: '0.08em', marginBottom: '10px' }}>
            TERM SYSTEM
          </div>
          <div style={row}>
            {systemBtn('Semestral',  'Semestral\n2 terms')}
            {systemBtn('Trimestral', 'Trimestral\n3 terms')}
            {systemBtn('Quarterly',  'Quarterly\n4 terms')}
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>
            {termSystem === 'Semestral'  && 'Two semesters per academic year'}
            {termSystem === 'Trimestral' && 'Three trimesters per academic year'}
            {termSystem === 'Quarterly'  && 'Four quarters per academic year'}
          </div>
        </div>

        {/* ── Current Term ── */}
        <div style={group}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#74bcd9', letterSpacing: '0.08em', marginBottom: '10px' }}>
            CURRENT TERM
          </div>
          <select value={currentTerm} onChange={e => setCurrentTerm(e.target.value)} required style={field}>
            <option value="" disabled>Select current term…</option>
            {TERM_OPTIONS[termSystem].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* ── Term Dates ── */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#74bcd9', letterSpacing: '0.08em', marginBottom: '10px' }}>
            TERM DATES <span style={{ fontWeight: 400, color: '#bbb' }}>(within AY {ayStart}–{ayEnd})</span>
          </div>
          <div style={row}>
            <div style={{ ...group, flex: 1 }}>
              <span style={label}>Start Date</span>
              <input type="date" required value={startDate} min={dateMin} max={dateMax}
                onChange={e => { setStartDate(e.target.value); if (endDate && e.target.value > endDate) setEndDate(''); }}
                style={field} />
            </div>
            <div style={{ ...group, flex: 1 }}>
              <span style={label}>End Date</span>
              <input type="date" required value={endDate} min={startDate || dateMin} max={dateMax}
                onChange={e => setEndDate(e.target.value)}
                style={field} />
            </div>
          </div>
        </div>

        {error && (
          <div style={{ color: '#c0392b', fontSize: '13px', padding: '10px 12px', background: 'rgba(254,226,226,0.7)', borderRadius: '8px' }}>
            ❌ {error}
          </div>
        )}

        <button type="submit" disabled={saving} style={{
          width: '100%', background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
          color: '#fff', padding: '13px 0', border: 'none', fontSize: '15px',
          fontWeight: 700, borderRadius: '12px', cursor: 'pointer',
          opacity: saving ? 0.75 : 1, fontFamily: "'Inter', sans-serif",
          letterSpacing: '0.02em', boxShadow: '0 6px 18px rgba(116,188,217,0.3)',
        }}>
          {saving ? 'Saving…' : '✅ Save & Continue'}
        </button>
      </form>
    </div>
  );
}

/* ─── Main component ─── */
export default function StudyPulseLanding({
  initialTrimester,
  firstName,
}: {
  initialTrimester: TrimesterData | null;
  firstName: string;
}) {
  const router = useRouter();

  /* Show modal if no trimester set OR if old-format row (missing new columns) */
  const needsSetup = !initialTrimester || initialTrimester.ay_start_year == null;

  const [trimester,    setTrimester]    = useState<TrimesterData | null>(needsSetup ? null : initialTrimester);
  const [stats,        setStats]        = useState<OverviewStats | null>(null);
  const [filtered,     setFiltered]     = useState<FilteredStats | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoadingStats(true);
    const res  = await fetch('/api/studypulse/stats');
    const data = await res.json();
    setStats(data);
    setLoadingStats(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleFilterClick = async (filter: string) => {
    if (activeFilter === filter) { setActiveFilter(null); setFiltered(null); return; }
    setActiveFilter(filter);
    const res  = await fetch(`/api/studypulse/stats?filter=${filter}`);
    const data = await res.json();
    setFiltered(data);
  };

  const handleResetTrimester = async () => {
    await fetch('/api/studypulse/trimester', { method: 'DELETE' });
    setTrimester(null);
    setStats(null);
  };

  const trimesterLabel = stats?.trimesterLabel
    || (trimester ? `${trimester.current_term} — ${trimester.academic_year}` : '');

  const overviewTiles = [
    { value: loadingStats ? '—' : (stats?.midtermGPA ?? 0),      label: 'Midterm GPA Estimate', icon: <TrendingUp size={18} color="#c0607c" strokeWidth={2.2} /> },
    { value: loadingStats ? '—' : (stats?.finalGPA ?? 0),        label: 'Final GPA Estimate',   icon: <Award size={18} color="#2a7fa8" strokeWidth={2.2} /> },
    { value: loadingStats ? '—' : (stats?.subjectCount ?? 0),    label: 'Subjects',             icon: <Layers3 size={18} color="#9b6dd6" strokeWidth={2.2} /> },
    { value: loadingStats ? '—' : (stats?.daysRemaining ?? 'N/A'), label: 'Days left',           icon: <CalendarClock size={18} color="#2a7fa8" strokeWidth={2.2} /> },
  ];

  const EXTRA_ROW_COLORS = ['#f2a7c0', '#74bcd9', '#a78bfa'];
  const progressRows = [
    ['Activity', '#f2a7c0', stats?.completion.activity],
    ['Quiz',     '#74bcd9', stats?.completion.quiz],
    ['Exam',     '#a78bfa', stats?.completion.exam],
    ...(stats?.dynamicCategories ?? []).map((c, i) =>
      [c.name, EXTRA_ROW_COLORS[i % EXTRA_ROW_COLORS.length], { pct: c.pct, avgGrade: c.avgGrade }] as const
    ),
  ] as [string, string, { pct: number; avgGrade: number } | undefined][];

  return (
    <div className="vb-bg" style={{ margin: 0, fontFamily: "'Inter', sans-serif", minHeight: '100vh', color: '#333' }}>

      {!trimester && (
        <SetupModal onSave={(t) => { setTrimester(t); fetchStats(); }} />
      )}

      <style jsx>{`
        .sp-pill:hover { background: rgba(255,255,255,0.8); }
        .sp-tile {
          transition: transform 180ms ease, box-shadow 180ms ease;
        }
        .sp-tile:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 28px rgba(116,188,217,0.16);
        }
      `}</style>

      <div style={{ maxWidth: '1280px', padding: '32px', width: '100%', margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px', marginBottom: '22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 className="gradient-text" style={{
              fontSize: 'clamp(1.9rem, 4vw, 2.6rem)', fontWeight: 800, margin: 0,
              fontFamily: "'DM Sans', 'Segoe UI', sans-serif", letterSpacing: '-0.01em',
            }}>
              Study Pulse
            </h1>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginLeft: 'auto' }}>
            <button className="sp-pill" onClick={() => router.push('/studypulse/gwa-calculator')} style={PILL}>
              <Calculator size={15} /> GWA Calculator
            </button>
            <button className="sp-pill" onClick={() => router.push('/studypulse/subjects')} style={PILL}>
              <Layers3 size={15} /> My Subjects
            </button>
            <button className="sp-pill" onClick={() => router.push('/studypulse/schedule')} style={PILL}>
              <CalendarDays size={15} /> Schedule
            </button>
            <button className="sp-pill" onClick={() => router.push('/studypulse/canvas')} style={PILL}>
              <GraduationCap size={15} /> Canvas
            </button>
            <button
              className="sp-pill"
              onClick={() => router.push('/dashboard')}
              aria-label="Dashboard"
              title="Dashboard"
              style={{ ...PILL, padding: '9px 12px' }}
            >
              <Home size={16} />
            </button>
          </div>
        </div>

        {/* ── Filter controls ── */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px', alignItems: 'center' }}>
          {Object.keys(FILTER_LABELS).map(f => (
            <button key={f} className="sp-pill" onClick={() => handleFilterClick(f)} style={activeFilter === f ? PILL_ACTIVE : PILL}>
              <span>{FILTER_ICONS[f]}</span>
              {f === 'activities' && 'Tasks'}
              {f === 'exams'      && 'Exams'}
              {f === 'quizzes'    && 'Quizzes'}
              {f === 'duedate'    && 'Due Date'}
              {f === 'urgency'    && 'Urgency'}
            </button>
          ))}
          <button className="sp-pill" onClick={handleResetTrimester} style={{ ...PILL, marginLeft: 'auto' }}>
            <RefreshCw size={14} /> Update Setup
          </button>
        </div>

        {/* ── Overview panel ── */}
        <div style={{ ...GLASS, borderRadius: '24px', padding: '30px 32px', marginBottom: '20px' }}>
          <h2 style={{
            fontSize: '1.3rem', fontWeight: 800, margin: '0 0 22px', color: '#2d3748',
            fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
          }}>
            {firstName}&apos;s {trimesterLabel || 'Overview'}
          </h2>

          {activeFilter && filtered ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
              {FILTER_LABELS[activeFilter].map((lbl, i) => (
                <div key={i} className="sp-tile" style={{ ...GLASS, borderRadius: '16px', padding: '18px', textAlign: 'center' }}>
                  <h3 className="gradient-text" style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 4px' }}>
                    {[filtered.col1, filtered.col2, filtered.col3, filtered.col4][i]}
                  </h3>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#5c6b80' }}>{lbl}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
              {overviewTiles.map(({ value, label: lbl, icon }) => (
                <div key={lbl} className="sp-tile" style={{ ...GLASS, borderRadius: '16px', padding: '18px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>{icon}</div>
                  <h3 className="gradient-text" style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 4px' }}>
                    {value}
                  </h3>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#5c6b80' }}>{lbl}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Progress + Grade rows (concept unchanged, restyled) ── */}
        <div style={{ ...GLASS, borderRadius: '24px', padding: '26px 28px', marginBottom: '32px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {progressRows.map(([lbl, color, data]) => (
            <div key={lbl} style={{
              background: 'rgba(255,255,255,0.55)', padding: '15px 20px', borderRadius: '16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '1.5rem', boxShadow: `0 4px 16px ${color}1a`,
            }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#3a4258', whiteSpace: 'nowrap', flexShrink: 0, minWidth: '78px' }}>
                  {lbl} Progress
                </span>
                <div style={{ flex: 1, height: '10px', background: 'rgba(120,130,150,0.14)', borderRadius: '999px', overflow: 'hidden', maxWidth: '1000px' }}>
                  <div style={{
                    height: '100%', borderRadius: '999px',
                    background: `linear-gradient(to right, ${color}, ${color}cc)`,
                    width: loadingStats ? '0%' : `${data?.pct ?? 0}%`,
                    transition: 'width 0.4s ease-in-out',
                  }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#5c6b80', whiteSpace: 'nowrap', flexShrink: 0, minWidth: '38px', textAlign: 'right' }}>
                  {loadingStats ? '—' : `${data?.pct ?? 0}%`}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: '92px' }}>
                <span style={{ fontWeight: 700, fontSize: '0.78rem', color: '#8a94a6', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Grade</span>
                {loadingStats
                  ? <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'rgba(120,130,150,0.14)' }} />
                  : <GradeRing pct={data?.avgGrade ?? 0} color={color} />
                }
              </div>
            </div>
          ))}
        </div>

      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
