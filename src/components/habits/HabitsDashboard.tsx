'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Home, Plus, Minus, Check, Undo2, Pencil, Trash2, Flame, Trophy,
  AlertTriangle, X, RotateCcw, Loader2, Sparkles,
} from 'lucide-react';
import type {
  HabitWithComputed, HabitsSummary, HabitCategory, HabitPriority, HabitType,
  ScheduleMode, TrackingType, WeekProgress, HabitHistoryResponse, HabitHistoryWeek,
} from '@/lib/habits';

/* ─── Static vocab (mirrors the DB enums / SET column) ─── */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const WEEKDAY_SHORT: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

const CATEGORY_OPTIONS: HabitCategory[] = ['academic', 'household', 'health', 'social', 'organizational', 'life goals'];
const CATEGORY_COLORS: Record<HabitCategory, string> = {
  academic: '#6c8efb', health: '#42c38b', household: '#ffb46e',
  'life goals': '#f58fb1', organizational: '#51c4d3', social: '#f28585',
};
const CATEGORY_LABELS: Record<HabitCategory, string> = {
  academic: 'Academic', health: 'Health', household: 'Household',
  'life goals': 'Life Goals', organizational: 'Organizational', social: 'Social',
};

const PRIORITY_OPTIONS: HabitPriority[] = ['core', 'normal', 'optional'];
const PRIORITY_LABELS: Record<HabitPriority, string> = { core: 'Core', normal: 'Normal', optional: 'Optional' };

const TYPE_OPTIONS: HabitType[] = ['habit', 'routine'];

const ACTIVE_TOGGLE_STYLE = { background: '#74bcd9', color: '#fff', borderColor: '#74bcd9' };

type FilterValue = 'today' | 'all' | string; // 'category:x' | 'priority:x' | 'day:x'

/* ─── Priority badge — three tiers of visual weight, not one loud badge for all ─── */
function PriorityBadge({ priority }: { priority: HabitPriority }) {
  if (priority === 'core') {
    return (
      <span style={{
        fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase',
        padding: '4px 9px', borderRadius: 999, background: '#74bcd9', color: '#fff', whiteSpace: 'nowrap',
      }}>
        Core
      </span>
    );
  }
  if (priority === 'normal') {
    return (
      <span style={{
        fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase',
        padding: '3px 8px', borderRadius: 999, border: '1px solid rgba(0,0,0,0.15)', color: '#777', whiteSpace: 'nowrap',
      }}>
        Normal
      </span>
    );
  }
  return (
    <span style={{ fontSize: '0.64rem', fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#aaa', whiteSpace: 'nowrap' }}>
      Optional
    </span>
  );
}

/* ─── Form state ─── */

interface FormState {
  habit_id: number | null;
  task_name: string;
  purpose: string;
  priority: HabitPriority;
  task_category: HabitCategory | '';
  habit_type: HabitType | '';
  schedule_mode: ScheduleMode;
  days_of_week: string[];
  weekly_target: string;
  tracking_type: TrackingType;
  target_value: string;
  minimum_value: string;
  unit_label: string;
  step_value: string;
}
const EMPTY_FORM: FormState = {
  habit_id: null, task_name: '', purpose: '', priority: 'normal', task_category: '', habit_type: '',
  schedule_mode: 'fixed', days_of_week: [], weekly_target: '3',
  tracking_type: 'boolean', target_value: '', minimum_value: '', unit_label: '', step_value: '1',
};

/* ─── Component ─── */

export default function HabitsDashboard({ firstName }: { firstName: string }) {
  const [habits, setHabits] = useState<HabitWithComputed[] | null>(null);
  const [summary, setSummary] = useState<HabitsSummary | null>(null);
  const [filter, setFilter] = useState<FilterValue>('today');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [detailHabit, setDetailHabit] = useState<HabitWithComputed | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    const [hRes, sRes] = await Promise.all([fetch('/api/habits'), fetch('/api/habits/summary')]);
    if (!hRes.ok || !sRes.ok) {
      setLoadError(true);
      return;
    }
    const hData = await hRes.json();
    const sData = await sRes.json();
    setLoadError(false);
    setHabits(hData.habits ?? []);
    setSummary(sData);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Filtering (client-side) ── */
  const filtered = useMemo(() => {
    if (!habits) return [];
    if (filter === 'all') return habits;
    if (filter === 'today') return habits.filter(h => h.is_today);
    const [kind, value] = filter.split(':');
    if (kind === 'category') return habits.filter(h => h.task_category === value);
    if (kind === 'priority') return habits.filter(h => h.priority === value);
    if (kind === 'day') return habits.filter(h => h.days_of_week.includes(value as typeof WEEKDAYS[number]));
    return habits;
  }, [habits, filter]);

  /* ── Modal ── */
  const openAdd = () => { setForm(EMPTY_FORM); setFormError(null); setModalOpen(true); };
  const openEdit = (h: HabitWithComputed) => {
    setForm({
      habit_id: h.habit_id, task_name: h.task_name, purpose: h.purpose,
      priority: h.priority, task_category: h.task_category, habit_type: h.habit_type,
      schedule_mode: h.schedule_mode, days_of_week: h.days_of_week, weekly_target: String(h.times_per_week),
      tracking_type: h.tracking_type,
      target_value: h.target_value != null ? String(h.target_value) : '',
      minimum_value: h.minimum_value != null ? String(h.minimum_value) : '',
      unit_label: h.unit_label ?? '',
      step_value: String(h.step_value ?? 1),
    });
    setFormError(null);
    setModalOpen(true);
  };
  const closeModal = () => { setModalOpen(false); setFormError(null); };
  const toggleDay = (day: string) => {
    setForm(f => ({
      ...f,
      days_of_week: f.days_of_week.includes(day) ? f.days_of_week.filter(d => d !== day) : [...f.days_of_week, day],
    }));
  };

  const submitForm = async () => {
    if (!form.task_name.trim() || !form.purpose.trim() || !form.task_category || !form.habit_type) {
      setFormError('Fill in every field before saving.');
      return;
    }
    if (form.schedule_mode === 'fixed' && form.days_of_week.length === 0) {
      setFormError('Pick at least one day.');
      return;
    }
    if (form.schedule_mode === 'flexible' && (!form.weekly_target || Number(form.weekly_target) < 1)) {
      setFormError('Set how many times per week.');
      return;
    }
    if (form.tracking_type === 'numeric' && (!form.target_value || Number(form.target_value) <= 0 || !form.unit_label.trim())) {
      setFormError('Set a target amount and a unit.');
      return;
    }
    if (form.tracking_type === 'numeric' && form.minimum_value && Number(form.minimum_value) > Number(form.target_value)) {
      setFormError("Minimum can't be greater than the target.");
      return;
    }
    setSaving(true);
    setFormError(null);
    const body: Record<string, unknown> = {
      task_name: form.task_name, purpose: form.purpose, priority: form.priority,
      task_category: form.task_category, habit_type: form.habit_type,
      schedule_mode: form.schedule_mode, tracking_type: form.tracking_type,
    };
    if (form.schedule_mode === 'fixed') body.days_of_week = form.days_of_week;
    else body.weekly_target = Number(form.weekly_target);
    if (form.tracking_type === 'numeric') {
      body.target_value = Number(form.target_value);
      body.unit_label = form.unit_label.trim();
      body.step_value = form.step_value ? Number(form.step_value) : 1;
      if (form.minimum_value) body.minimum_value = Number(form.minimum_value);
    }
    const res = await fetch(form.habit_id ? `/api/habits/${form.habit_id}` : '/api/habits', {
      method: form.habit_id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setFormError(data.error ?? 'Something went wrong. Try again.'); return; }
    setModalOpen(false);
    await load();
  };

  /* ── Row actions ── */
  const withBusy = async (id: number, fn: () => Promise<void>) => {
    setBusyId(id);
    try { await fn(); } finally { setBusyId(null); }
  };

  const doCheckin = (id: number) => withBusy(id, async () => {
    await fetch(`/api/habits/${id}/checkin`, { method: 'POST' });
    await load();
  });
  const doUndo = (id: number) => withBusy(id, async () => {
    await fetch(`/api/habits/${id}/checkin`, { method: 'DELETE' });
    await load();
  });
  const doDelete = (id: number) => withBusy(id, async () => {
    if (!confirm('Delete this ritual? This also clears its check-in history and streak.')) return;
    await fetch(`/api/habits/${id}`, { method: 'DELETE' });
    await load();
  });
  const doResetStreak = (id: number) => withBusy(id, async () => {
    if (!confirm('Reset the streak for this ritual back to zero?')) return;
    await fetch(`/api/habits/${id}/streak`, { method: 'DELETE' });
    await load();
    setModalOpen(false);
  });

  const loading = habits === null;

  return (
    <div
      className="vb-bg"
      style={{ minHeight: '100vh', padding: '48px 5% 64px', fontFamily: "'Inter','DM Sans','Segoe UI',sans-serif", color: '#333' }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 6 }}>
        <div>
          <h1 className="gradient-text" style={{ fontSize: 'clamp(1.9rem,4vw,2.75rem)', fontWeight: 800, margin: 0, lineHeight: 1.1 }}>
            {firstName}&apos;s Rituals
          </h1>
          {summary && (
            <p style={{ margin: '8px 0 0', fontSize: '0.95rem', color: '#555' }}>
              {summary.today_total === 0
                ? 'Nothing scheduled today.'
                : <><strong>{summary.today_completed} of {summary.today_total}</strong> today&apos;s rituals done.</>}
            </p>
          )}
        </div>
        <Link href="/dashboard" className="ht-home-btn" aria-label="Back to dashboard">
          <Home size={20} />
        </Link>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', margin: '22px 0 20px' }}>
        <select
          className="ht-select"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          aria-label="Filter rituals"
        >
          <optgroup label="View">
            <option value="today">Today</option>
            <option value="all">All rituals</option>
          </optgroup>
          <optgroup label="Category">
            {CATEGORY_OPTIONS.map(c => <option key={c} value={`category:${c}`}>{CATEGORY_LABELS[c]}</option>)}
          </optgroup>
          <optgroup label="Priority">
            {PRIORITY_OPTIONS.map(p => <option key={p} value={`priority:${p}`}>{PRIORITY_LABELS[p]}</option>)}
          </optgroup>
          <optgroup label="Day">
            {WEEKDAYS.map(d => <option key={d} value={`day:${d}`}>{d}</option>)}
          </optgroup>
        </select>

        <button className="vb-btn-pink" style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: 8 }} onClick={openAdd}>
          <Plus size={16} /> New Ritual
        </button>
      </div>

      {/* ── Habit grid ── */}
      {loadError ? (
        <div className="glass" style={{ borderRadius: 20, padding: '36px 28px', textAlign: 'center', color: '#555' }}>
          <AlertTriangle size={22} style={{ marginBottom: 8, opacity: 0.7 }} />
          <p style={{ margin: 0, fontWeight: 600 }}>Couldn&apos;t load your rituals. Try refreshing.</p>
        </div>
      ) : loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><Loader2 className="ht-spin" size={28} /></div>
      ) : filtered.length === 0 ? (
        <div className="glass" style={{ borderRadius: 20, padding: '36px 28px', textAlign: 'center', color: '#555' }}>
          <Sparkles size={22} style={{ marginBottom: 8, opacity: 0.7 }} />
          <p style={{ margin: 0, fontWeight: 600 }}>No rituals match this filter.</p>
          <p style={{ margin: '4px 0 0', fontSize: '0.9rem' }}>Try &quot;Today&quot; or &quot;All rituals&quot;, or add a new one.</p>
        </div>
      ) : (
        <div className="ht-grid">
          {filtered.map(h => (
            <HabitCard
              key={h.habit_id}
              habit={h}
              busy={busyId === h.habit_id}
              onCheckin={() => doCheckin(h.habit_id)}
              onUndo={() => doUndo(h.habit_id)}
              onEdit={() => openEdit(h)}
              onDelete={() => doDelete(h.habit_id)}
              onAmountCommitted={load}
              onOpenDetail={() => setDetailHabit(h)}
            />
          ))}
        </div>
      )}

      {/* ── Analytics ── */}
      {summary && summary.total_habits > 0 && (
        <div style={{ marginTop: 44 }}>
          <div className="glass" style={{ borderRadius: 20, padding: '24px 26px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <h2 className="gradient-text" style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>This Week&apos;s Rhythm</h2>
              <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#74bcd9' }}>
                {summary.weekly_expected.expected > 0
                  ? Math.min(100, Math.round((summary.weekly_expected.actual / summary.weekly_expected.expected) * 100))
                  : '—'}
                {summary.weekly_expected.expected > 0 ? '%' : ''}
              </span>
            </div>
            <div style={{ height: 10, borderRadius: 6, background: 'rgba(0,0,0,0.07)', overflow: 'hidden', marginBottom: 10 }}>
              <div style={{
                width: `${summary.weekly_expected.expected > 0 ? Math.min(100, Math.round((summary.weekly_expected.actual / summary.weekly_expected.expected) * 100)) : 0}%`,
                height: '100%', borderRadius: 6, background: 'linear-gradient(90deg,#f2a7c0,#74bcd9)',
              }} />
            </div>
            <p style={{ margin: '0 0 14px', fontSize: '0.88rem', color: '#555' }}>
              {summary.weekly_expected.expected > 0
                ? `${summary.weekly_expected.actual} of ${Math.max(summary.weekly_expected.actual, Math.round(summary.weekly_expected.expected))} expected occurrences this week`
                : 'Nothing due yet this week'}
            </p>

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: '0.85rem' }}>
              {summary.total_habits - summary.at_risk > 0 && (
                <span style={{ color: '#444' }}>
                  <Check size={14} color="#42c38b" style={{ verticalAlign: -2, marginRight: 4 }} />
                  {summary.total_habits - summary.at_risk} ritual{summary.total_habits - summary.at_risk === 1 ? '' : 's'} on pace
                </span>
              )}
              {summary.at_risk > 0 && (
                <span style={{ color: '#444' }}>
                  <AlertTriangle size={14} color="#f75b67" style={{ verticalAlign: -2, marginRight: 4 }} />
                  {summary.at_risk} ritual{summary.at_risk === 1 ? '' : 's'} need{summary.at_risk === 1 ? 's' : ''} attention
                </span>
              )}
              <span style={{ color: '#888' }}>
                <Trophy size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                {summary.longest_streak}-day best streak
              </span>
            </div>

            {(summary.on_pace || summary.needs_attention) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                {summary.on_pace && (
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#444' }}>
                    <span style={{ color: '#42c38b', fontWeight: 700 }}>✓ On pace:</span>{' '}
                    <strong>{summary.on_pace.task_name}</strong> — {summary.on_pace.week_actual}/{summary.on_pace.week_target} this week
                    {summary.on_pace.week_target - summary.on_pace.week_actual > 0 && ` · ${summary.on_pace.week_target - summary.on_pace.week_actual} remaining`}
                  </p>
                )}
                {summary.needs_attention && (
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#444' }}>
                    <span style={{ color: '#c0392b', fontWeight: 700 }}>⚠ Needs attention:</span>{' '}
                    <strong>{summary.needs_attention.task_name}</strong> — {summary.needs_attention.week_actual}/{summary.needs_attention.week_target} this week
                    {summary.needs_attention.week_target - summary.needs_attention.week_actual > 0 && ` · ${summary.needs_attention.week_target - summary.needs_attention.week_actual} remaining`}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="glass" style={{ borderRadius: 20, padding: '20px 24px', marginTop: 16 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 700, color: '#444' }}>Daily rhythm — last 7 days</h3>
            <div style={{ display: 'flex', gap: 4 }}>
              {summary.weekly_rhythm.map(d => {
                const glyph = d.scheduled === 0 ? '○' : d.percent >= 100 ? '●' : d.percent > 0 ? '◐' : '○';
                const glyphColor = d.scheduled === 0
                  ? 'rgba(0,0,0,0.15)'
                  : d.percent > 0
                    ? '#74bcd9'
                    : '#f75b67';
                return (
                  <div
                    key={d.date}
                    onClick={() => setSelectedDay(prev => prev === d.date ? null : d.date)}
                    title={`${d.weekday} ${d.date}: ${d.scheduled > 0 ? `${d.percent}% fulfilled` : 'nothing scheduled'}`}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', padding: '4px 0' }}
                  >
                    <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#777', minHeight: 12 }}>
                      {d.scheduled > 0 ? `${d.percent}%` : '—'}
                    </div>
                    <div style={{ fontSize: '1.3rem', lineHeight: 1, color: glyphColor }}>{glyph}</div>
                    <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#999' }}>{WEEKDAY_SHORT[d.weekday]}</div>
                  </div>
                );
              })}
            </div>

            {selectedDay && habits && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 8 }}>
                  {new Date(selectedDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                </div>
                {(() => {
                  const dayHabits = habits
                    .filter(h => h.schedule_mode === 'fixed')
                    .map(h => ({ habit: h, day: h.chain?.find(c => c.date === selectedDay) }))
                    .filter((x): x is { habit: HabitWithComputed; day: NonNullable<HabitWithComputed['chain']>[number] } => !!x.day?.scheduled);
                  if (!dayHabits.length) return <div style={{ fontSize: '0.82rem', color: '#888' }}>Nothing scheduled this day.</div>;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {dayHabits.map(({ habit, day }) => (
                        <div key={habit.habit_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                          <span style={{ color: day.completed ? '#42c38b' : '#c0392b' }}>{day.completed ? '✓' : '○'}</span>
                          <span>{habit.task_name}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {summary.category_consistency.length > 0 && (
            <div className="glass" style={{ borderRadius: 20, padding: '20px 24px', marginTop: 16 }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 700, color: '#444' }}>Consistency by category — this week</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {summary.category_consistency.map(c => (
                  <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 110, fontSize: '0.82rem', fontWeight: 600, color: '#444' }}>{CATEGORY_LABELS[c.category]}</div>
                    <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                      <div style={{ width: `${c.percent}%`, height: '100%', borderRadius: 6, background: CATEGORY_COLORS[c.category] }} />
                    </div>
                    <div style={{ width: 60, textAlign: 'right', fontSize: '0.78rem', color: '#888' }}>{c.completed}/{c.scheduled}</div>
                    <div style={{ width: 36, textAlign: 'right', fontSize: '0.8rem', fontWeight: 700, color: '#444' }}>{c.percent}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Add/Edit modal ── */}
      {modalOpen && (
        <div className="ht-modal-backdrop" onClick={closeModal}>
          <div className="ht-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{form.habit_id ? 'Edit Ritual' : 'New Ritual'}</h3>
              <button className="ht-icon-btn" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </div>

            <label className="ht-label">Name</label>
            <input className="vb-input" value={form.task_name} onChange={e => setForm(f => ({ ...f, task_name: e.target.value }))} placeholder="e.g. Morning run" />

            <label className="ht-label">Purpose</label>
            <textarea className="vb-input" rows={2} style={{ resize: 'none' }} value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="Why does this matter to you?" />

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label className="ht-label">Priority</label>
                <select className="vb-input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as HabitPriority }))}>
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="ht-label">Category</label>
                <select className="vb-input" value={form.task_category} onChange={e => setForm(f => ({ ...f, task_category: e.target.value as HabitCategory }))}>
                  <option value="" disabled>Choose</option>
                  {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </select>
              </div>
            </div>

            <label className="ht-label">Type</label>
            <select className="vb-input" value={form.habit_type} onChange={e => setForm(f => ({ ...f, habit_type: e.target.value as HabitType }))}>
              <option value="" disabled>Choose</option>
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>

            <label className="ht-label">Schedule</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="ht-toggle-btn" style={form.schedule_mode === 'fixed' ? ACTIVE_TOGGLE_STYLE : undefined}
                onClick={() => setForm(f => ({ ...f, schedule_mode: 'fixed' }))}>Fixed days</button>
              <button type="button" className="ht-toggle-btn" style={form.schedule_mode === 'flexible' ? ACTIVE_TOGGLE_STYLE : undefined}
                onClick={() => setForm(f => ({ ...f, schedule_mode: 'flexible' }))}>Flexible</button>
            </div>

            {form.schedule_mode === 'fixed' ? (
              <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
                {WEEKDAYS.map(d => (
                  <button
                    key={d} type="button"
                    onClick={() => toggleDay(d)}
                    className="ht-day-btn"
                    style={form.days_of_week.includes(d) ? ACTIVE_TOGGLE_STYLE : undefined}
                  >
                    {WEEKDAY_SHORT[d]}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <label className="ht-label">Times per week</label>
                <input type="number" min={1} max={7} className="vb-input" value={form.weekly_target}
                  onChange={e => setForm(f => ({ ...f, weekly_target: e.target.value }))} />
              </>
            )}

            <label className="ht-label">Tracking</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="ht-toggle-btn" style={form.tracking_type === 'boolean' ? ACTIVE_TOGGLE_STYLE : undefined}
                onClick={() => setForm(f => ({ ...f, tracking_type: 'boolean' }))}>Yes/No</button>
              <button type="button" className="ht-toggle-btn" style={form.tracking_type === 'numeric' ? ACTIVE_TOGGLE_STYLE : undefined}
                onClick={() => setForm(f => ({ ...f, tracking_type: 'numeric' }))}>Track an amount</button>
            </div>

            {form.tracking_type === 'numeric' && (
              <>
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label className="ht-label">Target</label>
                    <input type="number" min={0} step="any" className="vb-input" value={form.target_value}
                      onChange={e => setForm(f => ({ ...f, target_value: e.target.value }))} placeholder="e.g. 30" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="ht-label">Unit</label>
                    <input className="vb-input" value={form.unit_label}
                      onChange={e => setForm(f => ({ ...f, unit_label: e.target.value }))} placeholder="e.g. minutes" />
                  </div>
                </div>
                <label className="ht-label">Minimum (optional)</label>
                <input type="number" min={0} step="any" className="vb-input" value={form.minimum_value}
                  onChange={e => setForm(f => ({ ...f, minimum_value: e.target.value }))} placeholder="A lower, forgiving bar" />
                <details style={{ marginTop: 8 }}>
                  <summary className="ht-disclosure">Increment</summary>
                  <input type="number" min={0} step="any" className="vb-input" style={{ marginTop: 8 }} value={form.step_value}
                    onChange={e => setForm(f => ({ ...f, step_value: e.target.value }))} placeholder="1" />
                </details>
              </>
            )}

            {formError && (
              <p style={{ color: '#c0392b', fontSize: '0.85rem', margin: '12px 0 0', fontWeight: 600 }}>{formError}</p>
            )}

            {form.habit_id && (
              <button
                type="button"
                onClick={() => doResetStreak(form.habit_id as number)}
                style={{ marginTop: 14, background: 'none', border: 'none', color: '#a35', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}
              >
                <RotateCcw size={13} /> Reset streak
              </button>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" onClick={closeModal} className="ht-btn-ghost">Cancel</button>
              <button type="button" onClick={submitForm} disabled={saving} className="vb-btn-pink" style={{ width: 'auto', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
                {saving && <Loader2 className="ht-spin" size={14} />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {detailHabit && <HabitDetailModal habit={detailHabit} onClose={() => setDetailHabit(null)} />}

      <style jsx global>{`
        .ht-home-btn {
          display: flex; align-items: center; justify-content: center;
          width: 44px; height: 44px; border-radius: 14px;
          background: rgba(255,255,255,0.4); color: #74bcd9;
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          transition: transform 0.2s ease;
        }
        .ht-home-btn:hover { transform: translateY(-2px); }

        .ht-select {
          padding: 0.65rem 2.2rem 0.65rem 1rem;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.5);
          background: rgba(255,255,255,0.55);
          font-size: 0.92rem; font-weight: 600; color: #333;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          cursor: pointer;
        }

        .ht-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
        }

        .ht-card {
          display: flex; flex-direction: column; gap: 10px;
          background: rgba(255,255,255,0.55);
          backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
          border-radius: 18px;
          padding: 18px 18px 16px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.08);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          cursor: pointer;
        }
        .ht-card:hover { transform: translateY(-3px); box-shadow: 0 10px 24px rgba(0,0,0,0.12); }

        .ht-btn {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 7px 8px; border: none; border-radius: 10px; cursor: pointer;
          font-size: 0.78rem; font-weight: 700;
          transition: transform 0.12s ease, filter 0.15s ease;
        }
        .ht-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .ht-btn-check { background: #42c38b; color: #fff; }
        .ht-btn-check.checked { background: #e7e7f2; color: #444; }
        .ht-btn-edit { background: rgba(0,0,0,0.06); color: #555; }
        .ht-btn-delete { background: rgba(247,91,103,0.12); color: #c0392b; }

        .ht-icon-btn {
          background: none; border: none; cursor: pointer; color: #777;
          display: flex; align-items: center; justify-content: center;
          padding: 4px; border-radius: 8px;
        }
        .ht-icon-btn:hover { background: rgba(0,0,0,0.06); }

        .ht-btn-ghost {
          padding: 10px 18px; border-radius: 12px; border: none;
          background: rgba(0,0,0,0.06); color: #444; font-weight: 700; font-size: 0.9rem;
          cursor: pointer;
        }

        .ht-modal-backdrop {
          position: fixed; inset: 0; z-index: 999;
          background: rgba(0,0,0,0.42); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; padding: 20px;
        }
        .ht-modal {
          background: rgba(255,255,255,0.97);
          border-radius: 20px; padding: 26px 28px; width: 100%; max-width: 420px;
          max-height: 90vh; overflow-y: auto;
          box-shadow: 0 20px 50px rgba(0,0,0,0.3);
          cursor: default;
        }
        .ht-label {
          display: block; font-size: 0.78rem; font-weight: 700; color: #666;
          margin: 12px 0 6px;
        }
        .ht-day-btn {
          flex: 1; padding: 7px 0; font-size: 0.66rem; font-weight: 700;
          border-radius: 8px; border: 1px solid #ddd; background: #f4f4f6; color: #555;
          cursor: pointer; transition: background 0.15s ease;
        }
        .ht-toggle-btn {
          padding: 7px 16px; font-size: 0.78rem; font-weight: 700;
          border-radius: 10px; border: 1px solid #ddd; background: #f4f4f6; color: #555;
          cursor: pointer; transition: background 0.15s ease;
        }
        .ht-disclosure {
          font-size: 0.78rem; font-weight: 700; color: #74bcd9; cursor: pointer;
        }

        .ht-amount-wrap {
          display: flex; flex-direction: column; gap: 6px;
          padding: 8px 10px; border-radius: 12px; background: rgba(0,0,0,0.03);
          cursor: default;
        }
        .ht-amount-wrap.met { background: rgba(66,195,139,0.15); }
        .ht-amount-wrap.minimum-met { background: rgba(247,159,36,0.12); }
        .ht-step-btn {
          width: 26px; height: 26px; border-radius: 8px; border: 1px solid #ddd;
          background: #fff; color: #555; display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
        }
        .ht-amount-field {
          width: 56px; text-align: center; font-size: 0.9rem; font-weight: 700; color: #333;
          border: 1px solid #ddd; border-radius: 8px; padding: 4px 2px;
        }
        .ht-amount-bar {
          height: 6px; border-radius: 4px; background: rgba(0,0,0,0.08); overflow: hidden;
        }
        .ht-amount-fill {
          height: 100%; border-radius: 4px; background: #b7c3cc; transition: width 0.3s ease, background 0.3s ease;
        }
        .ht-amount-wrap.met .ht-amount-fill { background: linear-gradient(90deg,#f2a7c0,#74bcd9); }
        .ht-amount-wrap.minimum-met .ht-amount-fill { background: #f79f24; }

        .ht-spin { animation: ht-spin 0.8s linear infinite; }
        @keyframes ht-spin { to { transform: rotate(360deg); } }

        @media (prefers-reduced-motion: reduce) {
          .ht-card, .ht-home-btn, .ht-btn { transition: none !important; }
          .ht-spin { animation-duration: 1.6s; }
        }
      `}</style>
    </div>
  );
}

/* ─── Habit card ─── */

function HabitCard({
  habit, busy, onCheckin, onUndo, onEdit, onDelete, onAmountCommitted, onOpenDetail,
}: {
  habit: HabitWithComputed; busy: boolean;
  onCheckin: () => void; onUndo: () => void; onEdit: () => void; onDelete: () => void;
  onAmountCommitted: () => void; onOpenDetail: () => void;
}) {
  const canAct = habit.is_today || habit.checked_in_today;
  const isFlexible = habit.schedule_mode === 'flexible';
  const isNumeric = habit.tracking_type === 'numeric';

  return (
    <div className="ht-card" style={{ borderTop: `4px solid ${CATEGORY_COLORS[habit.task_category]}` }} onClick={onOpenDetail}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1.02rem', color: '#333' }}>{habit.task_name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: CATEGORY_COLORS[habit.task_category], display: 'inline-block' }} />
            <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#888' }}>
              {CATEGORY_LABELS[habit.task_category]}
            </span>
          </div>
        </div>
        <PriorityBadge priority={habit.priority} />
      </div>

      <p style={{
        margin: 0, fontSize: '0.83rem', color: '#555', lineHeight: 1.4,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {habit.purpose}
      </p>

      <div style={{ fontSize: '0.74rem', color: '#888' }}>
        {habit.habit_type === 'habit' ? 'Habit' : 'Routine'} ·{' '}
        {isFlexible ? `${habit.times_per_week}× weekly` : habit.days_of_week.map(d => WEEKDAY_SHORT[d]).join(', ')}
        {isNumeric && habit.target_value != null && (
          habit.minimum_value != null
            ? ` · Target ${habit.target_value} ${habit.unit_label} · Minimum ${habit.minimum_value} ${habit.unit_label}`
            : ` · ${habit.target_value} ${habit.unit_label} each`
        )}
      </div>

      {isFlexible ? <WeekDots progress={habit.week_progress!} /> : <ChainRow chain={habit.chain!} />}

      {!isFlexible && (
        <div style={{ fontSize: '0.74rem', color: habit.checked_in_today ? '#42c38b' : habit.is_today ? '#f79f24' : '#999' }}>
          {habit.checked_in_today ? 'Done today ✓' : habit.is_today ? 'Scheduled today — not yet done' : 'Not scheduled today'}
        </div>
      )}

      {isFlexible && (
        <div style={{ fontSize: '0.74rem', color: '#666' }}>
          {Math.max(0, habit.week_progress!.target - habit.week_progress!.completed)} remaining · {habit.week_days_remaining} day{habit.week_days_remaining === 1 ? '' : 's'} left this week
          {habit.week_progress!.completed < habit.week_progress!.target && habit.pace === 'behind' && (
            <span style={{ color: '#c0392b', fontWeight: 700, marginLeft: 6 }}>⚠ Behind pace</span>
          )}
          {habit.week_progress!.completed < habit.week_progress!.target && habit.pace === 'ahead' && (
            <span style={{ color: '#42c38b', fontWeight: 700, marginLeft: 6 }}>Ahead of pace</span>
          )}
        </div>
      )}

      {!isFlexible && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#555' }}>
          <Flame size={13} color="#e0679d" />
          <strong>{habit.current_streak}</strong>-day streak
          {habit.longest_streak != null && habit.current_streak != null && habit.longest_streak > habit.current_streak && (
            <span style={{ opacity: 0.6 }}>· best {habit.longest_streak}</span>
          )}
        </div>
      )}

      {isNumeric && canAct && (
        <div onClick={e => e.stopPropagation()}>
          <AmountInput
            habitId={habit.habit_id}
            amount={habit.today_amount ?? 0}
            target={habit.target_value ?? 0}
            minimum={habit.minimum_value}
            unit={habit.unit_label ?? ''}
            step={habit.step_value}
            onCommitted={onAmountCommitted}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 4 }} onClick={e => e.stopPropagation()}>
        {!isNumeric && (
          <button
            className={`ht-btn ht-btn-check${habit.checked_in_today ? ' checked' : ''}`}
            disabled={!canAct || busy}
            title={!canAct ? 'Not scheduled today' : undefined}
            onClick={habit.checked_in_today ? onUndo : onCheckin}
            style={{ opacity: canAct ? 1 : 0.45, cursor: canAct ? 'pointer' : 'not-allowed' }}
          >
            {busy ? <Loader2 className="ht-spin" size={13} /> : habit.checked_in_today ? <Undo2 size={13} /> : <Check size={13} />}
            {habit.checked_in_today ? 'Undo' : 'Done'}
          </button>
        )}
        <button className="ht-btn ht-btn-edit" onClick={onEdit}><Pencil size={13} /> Edit</button>
        <button className="ht-btn ht-btn-delete" onClick={onDelete}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

/* ─── The "chain" — signature streak visualization (fixed-schedule habits) ─── */
function ChainRow({ chain }: { chain: HabitWithComputed['chain'] }) {
  const days = chain!;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', padding: '2px 0' }}>
      {days.map((day, i) => {
        const prev = days[i - 1];
        const linked = i > 0 && prev.scheduled && prev.completed && day.scheduled && day.completed;
        const isToday = i === days.length - 1;
        const isLast = i === days.length - 1;
        return (
          <div
            key={day.date}
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'flex-end',
              flex: isLast ? '0 0 auto' : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              {i > 0 && (
                <div style={{ flex: 1, height: 2, minWidth: 6, background: linked ? 'linear-gradient(90deg,#f2a7c0,#74bcd9)' : 'rgba(0,0,0,0.1)' }} />
              )}
              <div
                title={`${day.weekday} ${day.date}${!day.scheduled ? ' — not scheduled' : day.completed ? ' — done' : isToday ? ' — not done yet' : ' — missed'}`}
                style={{
                  width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
                  ...(!day.scheduled
                    ? { border: '1px solid rgba(0,0,0,0.15)', background: 'transparent', opacity: 0.5 }
                    : day.completed
                      ? { background: 'linear-gradient(135deg,#f2a7c0,#74bcd9)', boxShadow: '0 0 0 2px rgba(255,255,255,0.6)' }
                      : isToday
                        ? { border: '2px dashed #74bcd9', background: 'rgba(255,255,255,0.6)' }
                        : { border: '2px solid rgba(247,91,103,0.55)', background: 'transparent' }),
                }}
              />
            </div>
            <div style={{ width: 15, textAlign: 'center', fontSize: '0.6rem', color: '#999', fontWeight: 700, marginTop: 2 }}>
              {day.weekday[0]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Week dots — flexible-schedule habits ─── */
function WeekDots({ progress }: { progress: WeekProgress }) {
  const dots = Array.from({ length: progress.target }, (_, i) => i < progress.completed);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '2px 0' }}>
      {dots.map((done, i) => (
        <div
          key={i}
          title={done ? 'Done' : 'Remaining'}
          style={{
            width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
            ...(done
              ? { background: 'linear-gradient(135deg,#f2a7c0,#74bcd9)', boxShadow: '0 0 0 2px rgba(255,255,255,0.6)' }
              : { border: '1px solid rgba(0,0,0,0.15)', background: 'transparent', opacity: 0.5 }),
          }}
        />
      ))}
    </div>
  );
}

/* ─── Amount input — numeric-tracking habits, with an optional minimum
   giving the fill bar a third zone (below-minimum / at-minimum / at-target). ─── */
function AmountInput({
  habitId, amount, target, minimum, unit, step, onCommitted,
}: {
  habitId: number; amount: number; target: number; minimum: number | null; unit: string; step: number; onCommitted: () => void;
}) {
  const [value, setValue] = useState(amount);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setValue(amount), [amount]);

  const commit = (next: number) => {
    const clamped = Math.max(0, next);
    setValue(clamped);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      await fetch(`/api/habits/${habitId}/amount`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: clamped }),
      });
      onCommitted();
    }, 500);
  };

  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const met = target > 0 && value >= target;
  const minimumMet = !met && minimum != null && value >= minimum;
  const remaining = Math.max(0, target - value);

  return (
    <div className={`ht-amount-wrap${met ? ' met' : minimumMet ? ' minimum-met' : ''}`}>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        Today
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="ht-step-btn" onClick={() => commit(value - step)} aria-label={`Decrease by ${step}`}>
          <Minus size={13} />
        </button>
        <input
          type="number"
          className="ht-amount-field"
          value={value}
          onChange={e => setValue(Number(e.target.value))}
          onBlur={() => commit(value)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        <span style={{ fontSize: '0.78rem', color: '#666', fontWeight: 600 }}>{unit}</span>
        <button type="button" className="ht-step-btn" onClick={() => commit(value + step)} aria-label={`Increase by ${step}`}>
          <Plus size={13} />
        </button>
      </div>
      <div className="ht-amount-bar"><div className="ht-amount-fill" style={{ width: `${pct}%` }} /></div>
      <div style={{ fontSize: '0.72rem', color: '#777' }}>
        {met ? 'Target reached ✓' : `${remaining} ${unit} remaining`}
      </div>
    </div>
  );
}

/* ─── History mini chart — 12 weeks, one bar per week ─── */
function HistoryChart({ weeks }: { weeks: HabitHistoryWeek[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 70 }}>
      {weeks.map(w => (
        <div key={w.week_start} title={`Week of ${w.week_start}: ${w.completed}/${w.target}`} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{
            width: '100%', height: `${Math.max(4, w.percent)}%`, borderRadius: 3,
            background: w.percent >= 100 ? 'linear-gradient(180deg,#f2a7c0,#74bcd9)' : 'rgba(116,188,217,0.4)',
          }} />
        </div>
      ))}
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.03)', borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#999', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#333' }}>{value}</div>
    </div>
  );
}

/* ─── Read-only habit detail view — 12-week history, best week, streak,
   total check-ins, start date, recent check-ins. No editing surface. ─── */
function HabitDetailModal({ habit, onClose }: { habit: HabitWithComputed; onClose: () => void }) {
  const [history, setHistory] = useState<HabitHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/habits/${habit.habit_id}/history?weeks=12`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load history');
        return res.json();
      })
      .then(data => { if (!cancelled) setHistory(data); })
      .catch(() => { if (!cancelled) setHistoryError(true); });
    return () => { cancelled = true; };
  }, [habit.habit_id]);

  return (
    <div className="ht-modal-backdrop" onClick={onClose}>
      <div className="ht-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{habit.task_name}</h3>
            <div style={{ fontSize: '0.78rem', color: '#888', marginTop: 2 }}>
              {CATEGORY_LABELS[habit.task_category]} · {habit.schedule_mode === 'flexible' ? `${habit.times_per_week}× weekly` : 'Fixed days'}
            </div>
          </div>
          <button className="ht-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div style={{ marginBottom: 16 }}>
          {habit.schedule_mode === 'flexible' ? <WeekDots progress={habit.week_progress!} /> : <ChainRow chain={habit.chain!} />}
        </div>

        {historyError ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: '#555' }}>
            <AlertTriangle size={22} style={{ marginBottom: 8, opacity: 0.7 }} />
            <p style={{ margin: 0, fontWeight: 600 }}>Couldn&apos;t load history.</p>
          </div>
        ) : !history ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '30px 0' }}><Loader2 className="ht-spin" size={22} /></div>
        ) : (
          <>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#666', margin: '0 0 8px' }}>Last 12 weeks</div>
            <HistoryChart weeks={history.weeks} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '16px 0' }}>
              <DetailStat label="Best week" value={history.best_week ? `${history.best_week.completed}/${history.best_week.target}` : '—'} />
              <DetailStat
                label={habit.schedule_mode === 'flexible' ? 'Current streak' : 'Streak'}
                value={habit.schedule_mode === 'flexible'
                  ? `${history.weekly_streak ?? 0} week${history.weekly_streak === 1 ? '' : 's'}`
                  : `${habit.current_streak ?? 0} day${habit.current_streak === 1 ? '' : 's'}`}
              />
              <DetailStat label="Total check-ins" value={String(history.total_checkins)} />
              <DetailStat label="Started" value={new Date(history.started_at).toLocaleDateString()} />
            </div>

            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#666', margin: '0 0 8px' }}>Recent check-ins</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {history.recent.length === 0 ? (
                <div style={{ fontSize: '0.82rem', color: '#999' }}>No check-ins yet.</div>
              ) : history.recent.map(r => (
                <div key={r.date} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#555' }}>
                  <span>{r.date}</span>
                  <span>{r.completed ? '✓' : '○'}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
