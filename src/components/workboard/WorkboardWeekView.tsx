'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Bell, CalendarClock } from 'lucide-react';

interface ClassOccurrence {
  block_id: number; user_subject_id: number | null; course_code: string; subject_name: string | null;
  section: string | null; date: string; start_time: string; end_time: string; venue: string | null;
  is_online: boolean; override: { modality: 'online' | 'cancelled' | null; note: string | null } | null;
}
interface DeadlineItem {
  source_table: string; entry_id: number; user_subject_id: number; subject_name: string | null;
  course_code: string | null; name: string; deadline: string;
}
interface WorkboardEventItem {
  id: number; user_subject_id: number | null; subject_name: string | null; item_type: 'event' | 'reminder';
  title: string; location: string | null; starts_at: string | null; ends_at: string | null;
  remind_at: string | null; note: string | null;
}
interface ConflictWarning { type: 'overlap' | 'deadline_cluster'; date: string; message: string; item_labels: string[] }
interface DayLoad { date: string; score: number; level: 'low' | 'medium' | 'high'; class_hours: number; deadline_count: number; event_count: number }
interface WorkboardWeek {
  week_start: string; class_occurrences: ClassOccurrence[]; deadlines: DeadlineItem[];
  events: WorkboardEventItem[]; reminders: WorkboardEventItem[]; conflicts: ConflictWarning[]; heatmap: DayLoad[];
}

const GLASS: React.CSSProperties = {
  background: 'rgba(255,255,255,0.4)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
  borderRadius: '22px', border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 8px 24px rgba(31,38,68,0.09)',
};
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GRID_START = 7 * 60;   // 7 AM
const GRID_END   = 21 * 60;  // 9 PM
const HOUR_HEIGHT = 48;
const LEVEL_COLOR: Record<DayLoad['level'], string> = { low: '#74bcd9', medium: '#f2a7c0', high: '#e0607c' };

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function addDaysLocal(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function courseColor(code: string): string {
  const palette = ['#74bcd9', '#f2a7c0', '#8b7fd6', '#4dabf5', '#f0a35c'];
  let h = 0; for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export default function WorkboardWeekView({ initialWeek }: { initialWeek: WorkboardWeek }) {
  const [week, setWeek] = useState<WorkboardWeek>(initialWeek);
  const [loading, setLoading] = useState(false);

  const dayDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysLocal(week.week_start, i)), [week.week_start]);

  const goToWeek = async (weekStart: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workboard/week?start=${weekStart}`);
      const data: WorkboardWeek = await res.json();
      setWeek(data);
    } finally {
      setLoading(false);
    }
  };

  const eventsByDay = (date: string) => week.events.filter(e => e.starts_at && e.ends_at && e.starts_at.slice(0, 10) === date);
  const classesByDay = (date: string) => week.class_occurrences.filter(c => c.date === date);
  const deadlinesByDay = (date: string) => week.deadlines.filter(d => d.deadline === date);

  const gridHeight = ((GRID_END - GRID_START) / 60) * HOUR_HEIGHT;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => goToWeek(addDaysLocal(week.week_start, -7))} disabled={loading}
            style={{ ...GLASS, border: 'none', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ChevronLeft size={18} />
          </button>
          <span style={{ fontWeight: 700, color: '#5c6b80', fontSize: '0.9rem' }}>
            {week.week_start} – {dayDates[6]}
          </span>
          <button onClick={() => goToWeek(addDaysLocal(week.week_start, 7))} disabled={loading}
            style={{ ...GLASS, border: 'none', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {week.conflicts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px' }}>
          {week.conflicts.map((c, i) => (
            <div key={i} style={{ ...GLASS, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(224,96,124,0.12)' }}>
              <AlertTriangle size={16} color="#c0607c" />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#a0405a' }}>
                {c.type === 'overlap' ? 'Schedule Conflict' : 'Deadline Cluster'} — {c.message} ({c.date})
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', marginBottom: '18px' }}>
        {week.heatmap.map(h => (
          <div key={h.date} style={{ ...GLASS, padding: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#8a94a6', textTransform: 'uppercase' }}>{h.date.slice(5)}</div>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: LEVEL_COLOR[h.level], margin: '4px auto' }} />
            <div style={{ fontSize: '0.68rem', color: '#8a94a6' }}>{h.level}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
        <div style={{ ...GLASS, flex: '1 1 700px', padding: '14px', overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '46px repeat(7, 1fr)', minWidth: '860px' }}>
            <div />
            {dayDates.map((date, i) => (
              <div key={date} style={{ textAlign: 'center', paddingBottom: '8px', fontWeight: 800, fontSize: '0.72rem', color: '#5c6b80', textTransform: 'uppercase' }}>
                {DAY_LABELS[i]}
              </div>
            ))}

            <div style={{ position: 'relative', height: `${gridHeight}px` }}>
              {Array.from({ length: (GRID_END - GRID_START) / 60 + 1 }, (_, i) => GRID_START + i * 60).map(m => (
                <div key={m} style={{ position: 'absolute', top: `${((m - GRID_START) / 60) * HOUR_HEIGHT - 6}px`, right: '8px', fontSize: '0.62rem', color: '#9aa4b5' }}>
                  {m % 720 === 0 ? 12 : Math.floor(m / 60) % 12}{m < 720 ? 'a' : 'p'}
                </div>
              ))}
            </div>

            {dayDates.map(date => (
              <div key={date} style={{ position: 'relative', height: `${gridHeight}px`, borderLeft: '1px solid rgba(200,210,230,0.32)' }}>
                {classesByDay(date).map(c => {
                  const cancelled = c.override?.modality === 'cancelled';
                  const top = ((toMinutes(c.start_time) - GRID_START) / 60) * HOUR_HEIGHT;
                  const height = ((toMinutes(c.end_time) - toMinutes(c.start_time)) / 60) * HOUR_HEIGHT;
                  const color = courseColor(c.course_code);
                  return (
                    <div key={`c${c.block_id}`} title={c.override?.note ?? undefined} style={{
                      position: 'absolute', top: `${top + 1}px`, height: `${Math.max(height - 2, 24)}px`, left: '2px', right: '2px',
                      background: `${color}16`, border: `1.5px solid ${color}55`, borderLeft: `3px solid ${color}`,
                      borderRadius: '8px', padding: '3px 6px', opacity: cancelled ? 0.5 : 1,
                    }}>
                      <span style={{ fontSize: '0.66rem', fontWeight: 800, color, textDecoration: cancelled ? 'line-through' : 'none' }}>
                        {c.course_code}{c.override?.modality ? ` (${c.override.modality})` : ''}
                      </span>
                    </div>
                  );
                })}
                {eventsByDay(date).map(e => {
                  const top = ((toMinutes(e.starts_at!.slice(11, 16)) - GRID_START) / 60) * HOUR_HEIGHT;
                  const height = ((toMinutes(e.ends_at!.slice(11, 16)) - toMinutes(e.starts_at!.slice(11, 16))) / 60) * HOUR_HEIGHT;
                  return (
                    <div key={`e${e.id}`} style={{
                      position: 'absolute', top: `${top + 1}px`, height: `${Math.max(height - 2, 24)}px`, left: '2px', right: '2px',
                      background: 'rgba(242,167,192,0.18)', border: '1.5px dashed #f2a7c099', borderLeft: '3px solid #f2a7c0',
                      borderRadius: '8px', padding: '3px 6px',
                    }}>
                      <span style={{ fontSize: '0.66rem', fontWeight: 800, color: '#a0507a' }}>{e.title}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '46px repeat(7, 1fr)', marginTop: '10px', borderTop: '1px solid rgba(200,210,230,0.32)', paddingTop: '8px', minWidth: '860px' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#8a94a6', display: 'flex', alignItems: 'center' }}>
              <CalendarClock size={13} />
            </div>
            {dayDates.map(date => (
              <div key={date} style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '4px' }}>
                {deadlinesByDay(date).map(d => (
                  <div key={`${d.source_table}-${d.entry_id}`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#e0607c', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.66rem', color: '#5c6b80', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...GLASS, flex: '0 0 240px', padding: '14px' }}>
          <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px', color: '#2d3748' }}>
            <Bell size={16} color="#74bcd9" /> Reminders
          </h3>
          {week.reminders.length === 0 && <p style={{ fontSize: '0.8rem', color: '#8a94a6', margin: 0 }}>No reminders.</p>}
          {week.reminders.map(r => (
            <div key={r.id} style={{ fontSize: '0.8rem', color: '#5c6b80', marginBottom: '8px' }}>
              {r.title}{r.remind_at ? ` — ${r.remind_at.slice(0, 10)}` : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
