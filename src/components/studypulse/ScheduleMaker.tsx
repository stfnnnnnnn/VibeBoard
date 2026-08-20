'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Home, Download, Loader2, MapPin, Wifi, X } from 'lucide-react';

export interface ScheduleBlock {
  block_id:        number;
  user_subject_id: number | null;
  course_code:     string;
  section:         string | null;
  subject_name:    string | null;
  day_of_week:     number; // 0=Mon .. 5=Sat
  start_time:      string; // "HH:MM"
  end_time:        string;
  venue:           string | null;
  is_online:       boolean;
}

export interface ScheduleSubject {
  user_subject_id: number;
  subject_name:    string;
  course_code:     string;
  units:           number;
}

/* ─── Grid constants — fixed 7 AM–9 PM so the whole week reads at a glance
   without scrolling, per the compact-on-one-screen requirement. ─── */

const DAY_LABELS  = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GRID_START  = 7 * 60;   // 07:00
const GRID_END    = 21 * 60;  // 21:00
const HOUR_HEIGHT = 38;

/* Drawn from the locked pink/blue/purple family — every course gets a stable
   color from its code so recurring meetings read as one thread across days. */
const COURSE_COLORS = ['#e0679d', '#3a8dba', '#9b6dd6', '#c65f83', '#2a7fa8', '#7c5cc9'];

function courseColor(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  return COURSE_COLORS[hash % COURSE_COLORS.length];
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatHour(totalMin: number): string {
  const h24 = Math.floor(totalMin / 60);
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${period}`;
}

interface Positioned extends ScheduleBlock { col: number; cols: number; }

/* Greedy interval-packing per day: overlapping blocks split the column width;
   separate clusters each get the full width. */
function packDay(dayBlocks: ScheduleBlock[]): Positioned[] {
  const sorted = [...dayBlocks].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  const clusters: ScheduleBlock[][] = [];
  let cluster: ScheduleBlock[] = [];
  let clusterEnd = -1;

  for (const b of sorted) {
    const start = toMinutes(b.start_time);
    if (cluster.length === 0 || start < clusterEnd) {
      cluster.push(b);
      clusterEnd = Math.max(clusterEnd, toMinutes(b.end_time));
    } else {
      clusters.push(cluster);
      cluster = [b];
      clusterEnd = toMinutes(b.end_time);
    }
  }
  if (cluster.length) clusters.push(cluster);

  const result: Positioned[] = [];
  for (const c of clusters) {
    const colEnds: number[] = [];
    const withCol: { block: ScheduleBlock; col: number }[] = [];
    for (const b of c) {
      const start = toMinutes(b.start_time);
      const end   = toMinutes(b.end_time);
      let col = colEnds.findIndex(e => e <= start);
      if (col === -1) { col = colEnds.length; colEnds.push(end); }
      else colEnds[col] = end;
      withCol.push({ block: b, col });
    }
    const finalCols = colEnds.length;
    for (const { block, col } of withCol) result.push({ ...block, col, cols: finalCols });
  }
  return result;
}

const GLASS: React.CSSProperties = {
  background:           'rgba(255,255,255,0.42)',
  backdropFilter:       'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border:               '1px solid rgba(255,255,255,0.4)',
  boxShadow:            '0 8px 24px rgba(31,38,68,0.08)',
};

const dashboardWrapper: React.CSSProperties = {
  padding:  '20px 32px 28px',
  maxWidth: '1400px',
  width:    '100%',
  margin:   '0 auto',
};

const smallLabel = (text: string) => (
  <span style={{ display: 'block', fontSize: '0.66rem', fontWeight: 700, color: '#8a94a6', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
    {text}
  </span>
);

interface MeetingRow {
  key:        string;
  day:        string;
  start_time: string;
  end_time:   string;
  venue:      string;
  is_online:  boolean;
}

let meetingKeySeq = 0;
const blankMeeting = (): MeetingRow => ({ key: `m${meetingKeySeq++}`, day: '', start_time: '', end_time: '', venue: '', is_online: false });

export default function ScheduleMaker({ initialBlocks, subjects }: { initialBlocks: ScheduleBlock[]; subjects: ScheduleSubject[] }) {
  const router = useRouter();
  const [blocks, setBlocks]     = useState(initialBlocks);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting]   = useState(false);
  const [message, setMessage] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  const [subjectChoice, setSubjectChoice] = useState('');
  const [customCode, setCustomCode]       = useState('');
  const [section, setSection]             = useState('');
  const [meetings, setMeetings]           = useState<MeetingRow[]>([blankMeeting()]);

  const isCustom = subjectChoice === '__custom__';

  const updateMeeting = (key: string, patch: Partial<MeetingRow>) =>
    setMeetings(prev => prev.map(m => (m.key === key ? { ...m, ...patch } : m)));

  const [now, setNow] = useState<{ day: number; min: number } | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const jsDay = d.getDay(); // 0=Sun..6=Sat
      const day = jsDay === 0 ? -1 : jsDay - 1; // map to 0=Mon..5=Sat, -1 = Sunday (not shown)
      setNow({ day, min: d.getHours() * 60 + d.getMinutes() });
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = isCustom ? customCode.trim() : subjects.find(s => String(s.user_subject_id) === subjectChoice)?.course_code ?? '';
    if (!code) { setMessage('Select a subject or enter a custom course code.'); return; }
    const cleanMeetings = meetings.filter(m => m.day !== '' && m.start_time && m.end_time);
    if (cleanMeetings.length === 0) { setMessage('Add at least one complete meeting day.'); return; }
    for (const m of cleanMeetings) {
      if (m.start_time >= m.end_time) { setMessage('End time must be after start time for every meeting.'); return; }
    }

    setSubmitting(true);
    setMessage('');
    try {
      const res  = await fetch('/api/studypulse/schedule', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_subject_id: isCustom ? null : Number(subjectChoice),
          course_code:      code,
          section:          section || null,
          meetings: cleanMeetings.map(m => ({
            day:        Number(m.day),
            start_time: m.start_time,
            end_time:   m.end_time,
            venue:      m.venue || null,
            is_online:  m.is_online,
          })),
        }),
      });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error);

      const subj = subjects.find(s => String(s.user_subject_id) === subjectChoice);
      const newBlocks: ScheduleBlock[] = (data.block_ids as number[]).map((id, i) => ({
        block_id:        id,
        user_subject_id: isCustom ? null : Number(subjectChoice),
        course_code:     code,
        section:         section || null,
        subject_name:    subj?.subject_name ?? null,
        day_of_week:     Number(cleanMeetings[i].day),
        start_time:      cleanMeetings[i].start_time,
        end_time:        cleanMeetings[i].end_time,
        venue:           cleanMeetings[i].venue || null,
        is_online:       cleanMeetings[i].is_online,
      }));
      setBlocks(prev => [...prev, ...newBlocks]);
      setSubjectChoice(''); setCustomCode(''); setSection(''); setMeetings([blankMeeting()]);
      setShowForm(false);
    } catch (err) {
      setMessage((err as Error).message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    setBlocks(prev => prev.filter(b => b.block_id !== id));
    await fetch(`/api/studypulse/schedule/${id}`, { method: 'DELETE' });
  };

  const handleClearAll = async () => {
    if (!confirm('Remove every class block from your schedule? This cannot be undone.')) return;
    setBlocks([]);
    await fetch('/api/studypulse/schedule', { method: 'DELETE' });
  };

  const handleSaveImage = async () => {
    if (!gridRef.current) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(gridRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const link = document.createElement('a');
      link.download = 'my-schedule.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setExporting(false);
    }
  };

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = GRID_START; m <= GRID_END; m += 60) marks.push(m);
    return marks;
  }, []);

  const gridHeight = ((GRID_END - GRID_START) / 60) * HOUR_HEIGHT;

  const blocksByDay = useMemo(() => {
    const map: Positioned[][] = [[], [], [], [], [], []];
    for (let d = 0; d < 6; d++) map[d] = packDay(blocks.filter(b => b.day_of_week === d));
    return map;
  }, [blocks]);

  const nowTop = now && now.day >= 0 && now.min >= GRID_START && now.min <= GRID_END
    ? ((now.min - GRID_START) / 60) * HOUR_HEIGHT
    : null;

  return (
    <div className="vb-bg" style={{ margin: 0, fontFamily: "'Inter', sans-serif", minHeight: '100vh', color: '#333' }}>
      <style jsx>{`
        .sp-pill:hover { background: rgba(255,255,255,0.85) !important; }
        .sched-block { transition: filter 130ms ease, box-shadow 130ms ease; }
        @media (hover: hover) and (pointer: fine) {
          .sched-block:hover { filter: brightness(0.97); box-shadow: 0 6px 16px rgba(31,38,68,0.18); }
          .sched-block:hover .block-delete { opacity: 1; }
        }
        .block-delete { opacity: 0; transition: opacity 130ms ease, background 130ms ease, color 130ms ease; }
        .block-delete:hover { background: rgba(254,226,226,0.95) !important; color: #dc2626 !important; }

        .add-toggle-btn { transition: transform 150ms ease, box-shadow 150ms ease; }
        .add-toggle-btn:active { transform: scale(0.97); }

        .add-form-shell {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 260ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .add-form-shell.open { grid-template-rows: 1fr; }
        .add-form-inner { overflow: hidden; min-height: 0; }
        .add-form-content { opacity: 0; transition: opacity 180ms ease; }
        .add-form-shell.open .add-form-content { opacity: 1; transition-delay: 90ms; }

        .toggle-icon { transition: transform 220ms cubic-bezier(0.23, 1, 0.32, 1); }
        .toggle-icon.open { transform: rotate(135deg); }

        .sched-spin { animation: schedSpin 0.9s linear infinite; }
        @keyframes schedSpin { to { transform: rotate(360deg); } }

        .meeting-row-remove:hover { background: rgba(254,226,226,0.9) !important; color: #dc2626 !important; }

        @media (prefers-reduced-motion: reduce) {
          .sched-block, .block-delete, .add-toggle-btn, .add-form-shell, .add-form-content, .toggle-icon, .sched-spin {
            transition-duration: 1ms !important;
            animation: none !important;
          }
        }
      `}</style>

      <div style={dashboardWrapper}>

        {/* ── Header: title, count, and actions in one compact row ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', marginBottom: '14px' }}>
          <h1 className="gradient-text" style={{ fontSize: 'clamp(1.4rem, 2.6vw, 1.9rem)', fontWeight: 800, margin: 0, fontFamily: "'DM Sans', 'Segoe UI', sans-serif", letterSpacing: '-0.01em' }}>
            My Schedule
          </h1>
          <span style={{ fontSize: '0.82rem', color: '#8a94a6', fontWeight: 600 }}>
            {blocks.length} block{blocks.length !== 1 ? 's' : ''} this week
          </span>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginLeft: 'auto' }}>
            <button
              className="add-toggle-btn"
              onClick={() => setShowForm(f => !f)}
              style={{
                padding: '9px 16px 9px 13px', background: 'linear-gradient(90deg, #f0679d, #74bcd9)',
                border: 'none', color: 'white', borderRadius: '999px', cursor: 'pointer', fontWeight: 700,
                fontSize: '0.84rem', display: 'inline-flex', alignItems: 'center', gap: '6px',
                boxShadow: '0 6px 16px rgba(240,103,157,0.24)',
              }}
            >
              <Plus size={16} className={`toggle-icon${showForm ? ' open' : ''}`} />
              {showForm ? 'Cancel' : 'Add Class'}
            </button>

            <button
              onClick={handleSaveImage}
              disabled={exporting || blocks.length === 0}
              className="sp-pill"
              style={{
                background: 'rgba(116,188,217,0.12)', color: '#2a7fa8', border: '1.5px solid rgba(116,188,217,0.35)',
                borderRadius: '999px', padding: '8px 15px', cursor: exporting || blocks.length === 0 ? 'default' : 'pointer',
                fontWeight: 700, fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '6px',
                opacity: exporting || blocks.length === 0 ? 0.5 : 1,
              }}
            >
              {exporting ? <Loader2 size={14} className="sched-spin" /> : <Download size={14} />} Save Image
            </button>

            {blocks.length > 0 && (
              <button
                onClick={handleClearAll}
                style={{
                  background: 'rgba(254,226,226,0.6)', color: '#c0392b',
                  border: '1.5px solid rgba(220,38,38,0.22)', borderRadius: '999px', padding: '8px 15px',
                  cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '6px',
                }}
              >
                <Trash2 size={13} /> Clear
              </button>
            )}

            <button
              onClick={() => router.push('/studypulse')}
              className="sp-pill"
              style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.45)', borderRadius: '999px', padding: '8px 15px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: '#5c6b80' }}
            >
              <Home size={14} color="#74bcd9" strokeWidth={2.2} /> Dashboard
            </button>
          </div>
        </div>

        {/* ── Add Class form: one row per meeting, each with its own day/time/venue/modality ── */}
        <div className={`add-form-shell${showForm ? ' open' : ''}`}>
          <div className="add-form-inner">
            <div className="add-form-content" style={{
              background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.5)', borderRadius: '18px', padding: '20px 22px', marginBottom: '16px',
              boxShadow: '0 8px 24px rgba(116,188,217,0.14)',
            }}>
              <form onSubmit={handleAdd}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '16px' }}>
                  <div>
                    {smallLabel('Subject')}
                    <select value={subjectChoice} onChange={e => setSubjectChoice(e.target.value)} required className="vb-input">
                      <option value="">Select subject</option>
                      {subjects.map(s => (
                        <option key={s.user_subject_id} value={s.user_subject_id}>{s.course_code} — {s.subject_name}</option>
                      ))}
                      <option value="__custom__">Custom (type below)</option>
                    </select>
                  </div>
                  {isCustom && (
                    <div>
                      {smallLabel('Course Code')}
                      <input placeholder="e.g. CS101" value={customCode} onChange={e => setCustomCode(e.target.value)} required={isCustom} className="vb-input" />
                    </div>
                  )}
                  <div>
                    {smallLabel('Section')}
                    <input placeholder="e.g. TN41" value={section} onChange={e => setSection(e.target.value)} className="vb-input" />
                  </div>
                </div>

                {smallLabel('Meeting days — each can have its own time, venue, and mode')}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                  {meetings.map(m => (
                    <div key={m.key} style={{
                      display: 'grid', gridTemplateColumns: '108px 90px 90px 1fr auto auto', gap: '8px', alignItems: 'center',
                      background: 'rgba(255,255,255,0.6)', borderRadius: '12px', padding: '8px 10px', border: '1px solid rgba(200,210,230,0.4)',
                    }}>
                      <select value={m.day} onChange={e => updateMeeting(m.key, { day: e.target.value })} className="vb-input" style={{ height: '38px', padding: '0 8px' }}>
                        <option value="">Day</option>
                        {DAY_SHORT.map((d, i) => <option key={d} value={i}>{d}</option>)}
                      </select>
                      <input type="time" value={m.start_time} onChange={e => updateMeeting(m.key, { start_time: e.target.value })} min="07:00" max="21:00" className="vb-input" style={{ height: '38px', padding: '0 8px' }} />
                      <input type="time" value={m.end_time} onChange={e => updateMeeting(m.key, { end_time: e.target.value })} min="07:00" max="21:00" className="vb-input" style={{ height: '38px', padding: '0 8px' }} />
                      <input placeholder="Venue (e.g. F612)" value={m.venue} onChange={e => updateMeeting(m.key, { venue: e.target.value })} className="vb-input" style={{ height: '38px', padding: '0 10px' }} />
                      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.76rem', fontWeight: 700, color: m.is_online ? '#2a7fa8' : '#9aa4b5', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                        <input type="checkbox" checked={m.is_online} onChange={e => updateMeeting(m.key, { is_online: e.target.checked })} />
                        Online
                      </label>
                      <button
                        type="button"
                        className="meeting-row-remove"
                        onClick={() => setMeetings(prev => prev.length > 1 ? prev.filter(x => x.key !== m.key) : prev)}
                        disabled={meetings.length === 1}
                        style={{ width: '30px', height: '30px', borderRadius: '8px', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa4b5', cursor: meetings.length === 1 ? 'default' : 'pointer', opacity: meetings.length === 1 ? 0.35 : 1 }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setMeetings(prev => [...prev, blankMeeting()])}
                  style={{ background: 'rgba(116,188,217,0.12)', color: '#2a7fa8', border: '1.5px dashed rgba(116,188,217,0.4)', borderRadius: '10px', padding: '8px 14px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Plus size={13} /> Add another meeting day
                </button>

                {message && (
                  <div style={{ marginTop: '12px', padding: '9px 13px', borderRadius: '10px', background: 'rgba(254,226,226,0.7)', border: '1px solid rgba(220,38,38,0.18)', color: '#b91c1c', fontSize: '0.82rem', fontWeight: 600 }}>
                    {message}
                  </div>
                )}

                <div>
                  <button type="submit" disabled={submitting} className="vb-btn-pink" style={{ width: 'auto', padding: '10px 26px', marginTop: '16px', borderRadius: '11px' }}>
                    {submitting ? 'Adding…' : 'Add to Schedule'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* ── Weekly grid — fixed 7 AM to 9 PM ── */}
        <div ref={gridRef} style={{ ...GLASS, borderRadius: '18px', padding: '12px 14px', overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '46px repeat(6, 1fr)', minWidth: '760px' }}>
            <div />
            {DAY_LABELS.map((d, i) => (
              <div key={d} style={{ textAlign: 'center', paddingBottom: '8px' }}>
                <span style={{
                  fontWeight: 800, fontSize: '0.72rem', color: now?.day === i ? '#c0607c' : '#5c6b80',
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  borderBottom: now?.day === i ? '2px solid transparent' : 'none',
                  backgroundImage: now?.day === i ? 'linear-gradient(90deg,#f0679d,#74bcd9)' : 'none',
                  backgroundSize: '100% 2px', backgroundRepeat: 'no-repeat', backgroundPosition: '0 100%',
                  paddingBottom: '4px',
                }}>
                  {d}
                </span>
              </div>
            ))}

            <div style={{ position: 'relative', height: `${gridHeight}px` }}>
              {hourMarks.map(m => (
                <div key={m} style={{ position: 'absolute', top: `${((m - GRID_START) / 60) * HOUR_HEIGHT - 6}px`, right: '8px', fontSize: '0.62rem', fontWeight: 700, color: '#9aa4b5' }}>
                  {formatHour(m)}
                </div>
              ))}
            </div>

            {DAY_LABELS.map((_, dayIdx) => (
              <div key={dayIdx} style={{
                position: 'relative', height: `${gridHeight}px`, borderLeft: '1px solid rgba(200,210,230,0.32)',
                background: now?.day === dayIdx ? 'rgba(116,188,217,0.05)' : 'transparent',
              }}>
                {hourMarks.map(m => (
                  <div key={m} style={{ position: 'absolute', top: `${((m - GRID_START) / 60) * HOUR_HEIGHT}px`, left: 0, right: 0, borderTop: '1px solid rgba(200,210,230,0.22)' }} />
                ))}

                {nowTop !== null && now?.day === dayIdx && (
                  <div style={{ position: 'absolute', top: `${nowTop}px`, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg,#f0679d,#74bcd9)', zIndex: 2, borderRadius: '2px' }}>
                    <div style={{ position: 'absolute', left: '-3px', top: '-3px', width: '8px', height: '8px', borderRadius: '50%', background: '#f0679d' }} />
                  </div>
                )}

                {blocksByDay[dayIdx].map(b => {
                  const top    = ((toMinutes(b.start_time) - GRID_START) / 60) * HOUR_HEIGHT;
                  const height = ((toMinutes(b.end_time) - toMinutes(b.start_time)) / 60) * HOUR_HEIGHT;
                  const color  = courseColor(b.course_code);
                  const widthPct = 100 / b.cols;
                  return (
                    <div
                      key={b.block_id}
                      className="sched-block"
                      title={`${b.subject_name ?? b.course_code} · ${b.is_online ? 'Online' : 'Face-to-face'}${b.venue ? ' · ' + b.venue : ''}`}
                      style={{
                        position: 'absolute', top: `${top + 1}px`, height: `${Math.max(height - 2, 24)}px`,
                        left: `calc(${b.col * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`,
                        background: `${color}16`,
                        border: b.is_online ? `1.5px dashed ${color}99` : `1.5px solid ${color}55`,
                        borderLeft: `3px solid ${color}`,
                        borderRadius: '8px', padding: '3px 6px', overflow: 'hidden',
                        cursor: 'default',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '3px' }}>
                        <span style={{ fontSize: '0.68rem', fontWeight: 800, color, lineHeight: 1.1 }}>
                          {b.course_code}{b.section ? ` (${b.section})` : ''}
                        </span>
                        <button
                          className="block-delete"
                          onClick={() => handleDelete(b.block_id)}
                          aria-label={`Remove ${b.course_code}`}
                          style={{ width: '14px', height: '14px', flexShrink: 0, borderRadius: '4px', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a94a6', cursor: 'pointer', fontSize: '10px', lineHeight: 1 }}
                        >
                          ×
                        </button>
                      </div>
                      {height >= 32 && (
                        <div style={{ fontSize: '0.6rem', color: '#5c6b80', fontWeight: 600, marginTop: '1px', display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {b.start_time}–{b.end_time}
                          {b.venue && (
                            <>
                              <span style={{ opacity: 0.5 }}>·</span>
                              {b.is_online ? <Wifi size={9} /> : <MapPin size={9} />} {b.venue}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {blocks.length === 0 && (
            <div style={{ textAlign: 'center', padding: '30px 20px', color: '#8a94a6', fontSize: '0.85rem', fontWeight: 500 }}>
              No classes added yet. Use &quot;Add Class&quot; to build your week.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '14px', marginTop: '10px', fontSize: '0.72rem', color: '#9aa4b5', fontWeight: 600 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '14px', height: '0', borderTop: '1.5px solid #9aa4b5' }} /> Face-to-face
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '14px', height: '0', borderTop: '1.5px dashed #9aa4b5' }} /> Online
          </span>
        </div>
      </div>
    </div>
  );
}
