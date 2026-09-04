# Habit Tracker v12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate the ritual card's current-state line to be second in visual weight only to its name, reserve the brand gradient for the hero's `RhythmRing` alone, and reorganize the create/edit modal into human-framed, description-card-driven sections.

**Architecture:** Pure presentation pass, entirely within `src/components/habits/HabitsDashboard.tsx` — no data, API, or schema changes, no new dependency. No new components this time (unlike v10/v11); every change is a targeted edit to `HabitCard`, `ChainRow`, `WeekDots`, `AmountInput`, `HistoryChart`, and the modal JSX/CSS already in the file.

**Tech Stack:** Next.js 15 App Router, TypeScript, no test framework installed (verification is `tsc --noEmit` plus reasoning about the JSX/CSS, since no browser-automation tool is available in this environment).

**Spec:** `docs/superpowers/specs/2026-09-04-habit-tracker-v12-design.md` — read it before Task 1. It documents which parts of the originating critique are already out of scope (this is the second and final sub-project of that decomposition) and a bug caught during its own self-review (the flexible-pace line's first draft dropped the "not yet met target" gate).

## Global Constraints

- No data, API, or schema change anywhere in this plan — confined entirely to `src/components/habits/HabitsDashboard.tsx`.
- No new dependency.
- The chain's 4-state model, unscheduled-dot sizing, pulse animation, and halo logic (all v10 work) are untouched — only the completed-node and connector-line *color* changes (gradient → flat).
- The card's category dot/label, note, and meta line keep their existing styling — not part of this pass.
- The card's color wash (`backgroundImage: linear-gradient(180deg, ${categoryColor}1f 0%, ...)`) is untouched — it's a single-hue category-identity effect, not the two-tone brand gradient this plan flattens elsewhere.
- `RhythmRing`'s `#ht-ring-gradient` SVG gradient definition and its one consuming `<circle>` are untouched — it remains the only place the brand gradient survives.
- The `Name`/`Note (optional)`/`Priority`/`Category` modal fields keep their existing `ht-label` treatment — only the Schedule and Tracking sections get the new section-header treatment.
- `ACTIVE_TOGGLE_STYLE` and `.ht-day-btn` (the day-of-week picker) are untouched — only `.ht-toggle-btn`'s two call sites (schedule-mode and tracking-type toggles) move to the new `.ht-choice-card`.

---

### Task 1: Cards, chain & modal redesign

**Files:**
- Modify: `src/components/habits/HabitsDashboard.tsx` (full-file replacement)

**Interfaces:**
- No external interface changes — every edit is internal to existing, non-exported components in this one file.

- [ ] **Step 1: Replace the entire file**

```tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Home, Plus, Minus, Check, Undo2, Flame, Trophy,
  AlertTriangle, X, RotateCcw, Loader2, Sparkles, MoreHorizontal, Pencil, Trash2, Pause, Play,
} from 'lucide-react';
import type {
  HabitWithComputed, HabitsSummary, HabitCategory, HabitPriority,
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

const ACTIVE_TOGGLE_STYLE = { background: '#74bcd9', color: '#fff', borderColor: '#74bcd9' };

const HEADING_FONT: React.CSSProperties = { fontFamily: "'DM Sans','Segoe UI',sans-serif", letterSpacing: '-0.01em' };

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

/* ─── Radial rhythm ring — the page's one circular meter, reserved for the single
   most important number. Counts up from 0 on mount/update; skips the count-up
   under prefers-reduced-motion, jumping straight to the final value. This is
   also the ONLY place the brand gradient survives (see #ht-ring-gradient below) —
   every other bar/dot/node in the file uses a flat #74bcd9 as of v12. ─── */
function RhythmRing({ percent, size = 96, strokeWidth = 8 }: { percent: number | null; size?: number; strokeWidth?: number }) {
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    if (percent === null) { setAnimated(0); return; }
    const prefersReduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) { setAnimated(percent); return; }
    let raf: number;
    let start: number | null = null;
    const duration = 800;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(Math.round(percent * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [percent]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animated / 100) * circumference;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={strokeWidth} />
        {percent !== null && (
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none"
            stroke="url(#ht-ring-gradient)" strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
          />
        )}
        <defs>
          <linearGradient id="ht-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f2a7c0" />
            <stop offset="100%" stopColor="#74bcd9" />
          </linearGradient>
        </defs>
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        ...HEADING_FONT, fontSize: '1.5rem', fontWeight: 800, color: '#74bcd9',
      }}>
        {percent === null ? '—' : `${animated}%`}
      </div>
    </div>
  );
}

/* ─── Form state ─── */

interface FormState {
  habit_id: number | null;
  task_name: string;
  note: string;
  priority: HabitPriority;
  task_category: HabitCategory | '';
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
  habit_id: null, task_name: '', note: '', priority: 'normal', task_category: '',
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
      habit_id: h.habit_id, task_name: h.task_name, note: h.note ?? '',
      priority: h.priority, task_category: h.task_category,
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
    if (!form.task_name.trim() || !form.task_category) {
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
      task_name: form.task_name, note: form.note.trim() || undefined, priority: form.priority,
      task_category: form.task_category,
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

  const doPause = (id: number) => withBusy(id, async () => {
    await fetch(`/api/habits/${id}/pause`, { method: 'POST' });
    await load();
  });
  const doResume = (id: number) => withBusy(id, async () => {
    await fetch(`/api/habits/${id}/pause`, { method: 'DELETE' });
    await load();
  });

  const loading = habits === null;

  return (
    <div
      className="vb-bg"
      style={{ minHeight: '100vh', padding: '48px 5% 64px', fontFamily: "'Inter','DM Sans','Segoe UI',sans-serif", color: '#332b45' }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 6 }}>
        <div>
          <h1 className="gradient-text" style={{ ...HEADING_FONT, fontSize: 'clamp(1.9rem,4vw,2.75rem)', fontWeight: 800, margin: 0, lineHeight: 1.1 }}>
            {firstName}&apos;s Rituals
          </h1>
          {summary && (
            <p style={{ margin: '8px 0 0', fontSize: '0.95rem', color: '#555' }}>
              {summary.today_total === 0
                ? 'Nothing scheduled today.'
                : <><strong>Today:</strong> {summary.today_completed}/{summary.today_total} done</>}
            </p>
          )}
        </div>
        <Link href="/dashboard" className="ht-home-btn" aria-label="Back to dashboard">
          <Home size={20} />
        </Link>
      </div>

      {/* ── Analytics ── */}
      {summary && summary.total_habits > 0 && (
        <div style={{ marginTop: 28 }}>
          <div className="glass" style={{ borderRadius: 20, padding: '20px 24px' }}>
            <h2 className="gradient-text" style={{ ...HEADING_FONT, fontSize: '1.15rem', fontWeight: 800, margin: '0 0 12px' }}>This Week&apos;s Rhythm</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <RhythmRing
                percent={summary.weekly_expected.expected > 0 ? Math.min(100, Math.round((summary.weekly_expected.actual / summary.weekly_expected.expected) * 100)) : null}
                size={72}
                strokeWidth={7}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...HEADING_FONT, fontSize: '0.95rem', fontWeight: 700, color: '#332b45' }}>
                  {summary.weekly_expected.expected > 0
                    ? <>{summary.weekly_expected.actual}/{Math.max(summary.weekly_expected.actual, Math.round(summary.weekly_expected.expected))} completed</>
                    : 'Nothing due yet this week'}
                </span>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.85rem' }}>
                  {summary.total_habits - summary.at_risk > 0 && (
                    <span style={{ color: '#444' }}>
                      <Check size={13} color="#42c38b" style={{ verticalAlign: -2, marginRight: 4 }} />
                      {summary.total_habits - summary.at_risk} on pace
                    </span>
                  )}
                  {summary.at_risk > 0 && (
                    <span style={{ color: '#444' }}>
                      <AlertTriangle size={13} color="#f75b67" style={{ verticalAlign: -2, marginRight: 4 }} />
                      {summary.at_risk} need{summary.at_risk === 1 ? 's' : ''} attention
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
              {summary.needs_attention && (() => {
                const na = summary.needs_attention!;
                const fullHabit = habits?.find(h => h.habit_id === na.habit_id);
                const todayIncomplete = !!fullHabit && fullHabit.is_today && !fullHabit.checked_in_today;
                return (
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#444' }}>
                    <span style={{ color: '#c0392b', fontWeight: 700 }}>⚠ Needs attention:</span>{' '}
                    <strong>{na.task_name}</strong> —{' '}
                    {todayIncomplete
                      ? "today's occurrence is still incomplete"
                      : `${na.week_actual}/${na.week_target} completed this week`}
                  </p>
                );
              })()}
              <span style={{ color: '#888', fontSize: '0.82rem', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
                <Trophy size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                Best chain · {summary.longest_streak} day{summary.longest_streak === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          <div
            className="ht-analytics-row"
            style={summary.category_consistency.length === 0 ? { gridTemplateColumns: '1fr' } : undefined}
          >
            <DailyRhythmPanel summary={summary} habits={habits} selectedDay={selectedDay} setSelectedDay={setSelectedDay} doCheckin={doCheckin} />
            {summary.category_consistency.length > 0 && (
              <CategoryConsistencyPanel categoryConsistency={summary.category_consistency} />
            )}
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', margin: '32px 0 20px' }}>
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

      {/* ── Today's Rituals heading ── */}
      <h2 style={{ ...HEADING_FONT, fontSize: '1.1rem', fontWeight: 800, color: '#332b45', margin: '0 0 14px' }}>
        Today&apos;s Rituals{filter === 'today' && !loading && !loadError ? ` · ${filtered.length} scheduled` : ''}
      </h2>

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
          {filtered.map((h, index) => (
            <HabitCard
              key={h.habit_id}
              habit={h}
              index={index}
              busy={busyId === h.habit_id}
              onCheckin={() => doCheckin(h.habit_id)}
              onUndo={() => doUndo(h.habit_id)}
              onEdit={() => openEdit(h)}
              onDelete={() => doDelete(h.habit_id)}
              onPauseToggle={() => (h.task_status === 'paused' ? doResume(h.habit_id) : doPause(h.habit_id))}
              onAmountCommitted={load}
              onOpenDetail={() => setDetailHabit(h)}
            />
          ))}
        </div>
      )}

      {/* ── Add/Edit modal ── */}
      {modalOpen && (
        <div className="ht-modal-backdrop" onClick={closeModal}>
          <div className="ht-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ ...HEADING_FONT, margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{form.habit_id ? 'Edit Ritual' : 'New Ritual'}</h3>
              <button className="ht-icon-btn" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </div>

            <label className="ht-label">Name</label>
            <input className="vb-input" value={form.task_name} onChange={e => setForm(f => ({ ...f, task_name: e.target.value }))} placeholder="e.g. Morning run" />

            <label className="ht-label">Note (optional)</label>
            <textarea className="vb-input" rows={2} style={{ resize: 'none' }} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Add a note, if you'd like" />

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

            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#999', marginBottom: 4 }}>Schedule</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#444', marginBottom: 10 }}>When should this happen?</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button type="button" className={`ht-choice-card${form.schedule_mode === 'fixed' ? ' active' : ''}`}
                  onClick={() => setForm(f => ({ ...f, schedule_mode: 'fixed' }))}>
                  <div className="ht-choice-card-title">Fixed days</div>
                  <div className="ht-choice-card-desc">Specific weekdays every week</div>
                </button>
                <button type="button" className={`ht-choice-card${form.schedule_mode === 'flexible' ? ' active' : ''}`}
                  onClick={() => setForm(f => ({ ...f, schedule_mode: 'flexible' }))}>
                  <div className="ht-choice-card-title">Flexible</div>
                  <div className="ht-choice-card-desc">Any days, as long as you hit your target</div>
                </button>
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
            </div>

            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#999', marginBottom: 4 }}>Tracking</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#444', marginBottom: 10 }}>How will you measure it?</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button type="button" className={`ht-choice-card${form.tracking_type === 'boolean' ? ' active' : ''}`}
                  onClick={() => setForm(f => ({ ...f, tracking_type: 'boolean' }))}>
                  <div className="ht-choice-card-title">Check-in</div>
                  <div className="ht-choice-card-desc">Simply mark it done</div>
                </button>
                <button type="button" className={`ht-choice-card${form.tracking_type === 'numeric' ? ' active' : ''}`}
                  onClick={() => setForm(f => ({ ...f, tracking_type: 'numeric' }))}>
                  <div className="ht-choice-card-title">Amount</div>
                  <div className="ht-choice-card-desc">Track minutes, pages, glasses, etc.</div>
                </button>
              </div>

              {form.tracking_type === 'numeric' && (
                <>
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
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
            </div>

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
          font-size: 0.92rem; font-weight: 600; color: #332b45;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          cursor: pointer;
        }

        .ht-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
        }

        .ht-analytics-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
          margin-top: 16px;
        }
        @media (min-width: 720px) {
          .ht-analytics-row { grid-template-columns: 1.4fr 1fr; }
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

        @keyframes ht-card-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ht-card-enter { animation: ht-card-in 0.4s ease-out backwards; }

        .ht-day-cell {
          border-radius: 10px;
          transition: background 0.15s ease;
        }
        .ht-day-cell:hover { background: rgba(116,188,217,0.08); }

        .ht-chain-node {
          transition: background 0.35s ease, box-shadow 0.35s ease, border-color 0.35s ease, transform 0.3s ease;
        }
        @keyframes ht-pulse {
          0%, 100% { box-shadow: 0 0 0 2px #fff, 0 0 0 4px rgba(116,188,217,0.55); }
          50% { box-shadow: 0 0 0 2px #fff, 0 0 0 7px rgba(116,188,217,0.25); }
        }
        .ht-chain-node-pulse { animation: ht-pulse 1.8s ease-in-out infinite; }

        .ht-progress-fill {
          transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes ht-fade-slide {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ht-fade-slide { animation: ht-fade-slide 0.25s ease-out; }

        .ht-btn {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 7px 8px; border: none; border-radius: 10px; cursor: pointer;
          font-size: 0.78rem; font-weight: 700;
          transition: transform 0.12s ease, filter 0.15s ease, background-color 0.3s ease;
        }
        .ht-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .ht-btn-check { background: #42c38b; color: #fff; }
        .ht-btn-check.checked { background: #e7e7f2; color: #444; }

        .ht-icon-btn {
          background: none; border: none; cursor: pointer; color: #777;
          display: flex; align-items: center; justify-content: center;
          padding: 4px; border-radius: 8px;
        }
        .ht-icon-btn:hover { background: rgba(0,0,0,0.06); }

        @keyframes ht-menu-in {
          from { opacity: 0; transform: scale(0.92) translateY(-4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .ht-card-menu {
          position: absolute; right: 0; top: calc(100% + 4px); z-index: 20;
          background: #fff; border-radius: 10px; box-shadow: 0 6px 18px rgba(0,0,0,0.15);
          display: flex; flex-direction: column; min-width: 110px; overflow: hidden;
          animation: ht-menu-in 0.15s ease-out;
          transform-origin: top right;
        }
        .ht-card-menu button {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 12px; text-align: left; border: none; background: none; cursor: pointer;
          font-size: 0.8rem; font-weight: 600; color: #444;
        }
        .ht-card-menu button:hover { background: rgba(0,0,0,0.05); }

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
        .ht-choice-card {
          text-align: left; padding: 12px 14px; border-radius: 12px; border: 1.5px solid #ddd;
          background: #f9f9fb; cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease;
        }
        .ht-choice-card.active { border-color: #74bcd9; background: rgba(116,188,217,0.08); }
        .ht-choice-card-title { font-size: 0.85rem; font-weight: 800; color: #332b45; margin-bottom: 3px; }
        .ht-choice-card-desc { font-size: 0.72rem; color: #777; line-height: 1.3; }
        .ht-disclosure {
          font-size: 0.78rem; font-weight: 700; color: #74bcd9; cursor: pointer;
        }

        .ht-amount-wrap {
          display: flex; flex-direction: column; gap: 6px;
          padding: 8px 10px; border-radius: 12px; background: rgba(0,0,0,0.03);
          cursor: default;
        }
        .ht-amount-wrap.met { background: rgba(66,195,139,0.15); }
        .ht-amount-wrap.minimum-met { background: rgba(184,83,44,0.12); }
        .ht-step-btn {
          width: 26px; height: 26px; border-radius: 8px; border: 1px solid #ddd;
          background: #fff; color: #555; display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
        }
        .ht-amount-field {
          width: 56px; text-align: center; font-size: 0.9rem; font-weight: 700; color: #332b45;
          border: 1px solid #ddd; border-radius: 8px; padding: 4px 2px;
        }
        .ht-amount-bar {
          height: 6px; border-radius: 4px; background: rgba(0,0,0,0.08); overflow: hidden;
        }
        .ht-amount-fill {
          height: 100%; border-radius: 4px; background: #b7c3cc; transition: width 0.3s ease, background 0.3s ease;
        }
        .ht-amount-wrap.met .ht-amount-fill { background: #74bcd9; }
        .ht-amount-wrap.minimum-met .ht-amount-fill { background: #b8532c; }

        .ht-spin { animation: ht-spin 0.8s linear infinite; }
        @keyframes ht-spin { to { transform: rotate(360deg); } }

        @media (prefers-reduced-motion: reduce) {
          .ht-card, .ht-home-btn, .ht-btn, .ht-chain-node, .ht-progress-fill, .ht-amount-fill { transition: none !important; }
          .ht-fade-slide, .ht-card-enter, .ht-card-menu, .ht-chain-node-pulse { animation: none !important; }
          .ht-spin { animation-duration: 1.6s; }
        }
      `}</style>
    </div>
  );
}

/* ─── Daily rhythm panel — a 7-day heat-strip with a real 4-state glyph model
   (completed / partial / missed / nothing-scheduled), and a day-click drill-down
   below acting as the detail half of a master/detail relationship. ─── */
function DailyRhythmPanel({
  summary, habits, selectedDay, setSelectedDay, doCheckin,
}: {
  summary: HabitsSummary; habits: HabitWithComputed[] | null;
  selectedDay: string | null; setSelectedDay: (updater: (prev: string | null) => string | null) => void;
  doCheckin: (id: number) => void;
}) {
  return (
    <div className="glass" style={{ borderRadius: 20, padding: '20px 24px' }}>
      <h3 style={{ ...HEADING_FONT, margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 700, color: '#444' }}>Daily rhythm — last 7 days</h3>
      <div style={{ display: 'flex', gap: 4 }}>
        {summary.weekly_rhythm.map(d => {
          const glyph = d.scheduled === 0 ? '·' : d.percent >= 100 ? '●' : d.percent > 0 ? '◐' : '○';
          const glyphColor = d.scheduled === 0
            ? 'rgba(0,0,0,0.2)'
            : d.percent > 0
              ? '#74bcd9'
              : '#f75b67';
          const isSelected = selectedDay === d.date;
          return (
            <div
              key={d.date}
              onClick={() => setSelectedDay(prev => prev === d.date ? null : d.date)}
              title={`${d.weekday} ${d.date}: ${d.scheduled > 0 ? `${d.percent}% fulfilled` : 'nothing scheduled'}`}
              className="ht-day-cell"
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', padding: '8px 4px', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10 }}
            >
              <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#777', minHeight: 12 }}>
                {d.scheduled > 0 ? `${d.percent}%` : '—'}
              </div>
              <div style={{ fontSize: '1.3rem', lineHeight: 1, color: glyphColor }}>{glyph}</div>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#999' }}>{WEEKDAY_SHORT[d.weekday]}</div>
              <div style={{ width: 16, height: 3, borderRadius: 2, background: isSelected ? '#74bcd9' : 'transparent' }} />
            </div>
          );
        })}
      </div>

      {selectedDay && habits && (() => {
        const todayStr = summary.weekly_rhythm[summary.weekly_rhythm.length - 1]?.date;
        const isToday = selectedDay === todayStr;
        const dayHabits = habits
          .filter(h => h.schedule_mode === 'fixed')
          .map(h => ({ habit: h, day: h.chain?.find(c => c.date === selectedDay) }))
          .filter((x): x is { habit: HabitWithComputed; day: NonNullable<HabitWithComputed['chain']>[number] } => !!x.day?.scheduled);
        return (
          <div key={selectedDay} className="ht-fade-slide" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 8 }}>
              {new Date(selectedDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
            {!dayHabits.length ? (
              <div style={{ fontSize: '0.82rem', color: '#888' }}>Nothing scheduled this day.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dayHabits.map(({ habit, day }) => (
                  <div key={habit.habit_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                    <span style={{ color: day.completed ? '#42c38b' : '#c0392b' }}>{day.completed ? '✓' : '○'}</span>
                    <span style={{ flex: 1 }}>{habit.task_name}</span>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: CATEGORY_COLORS[habit.task_category], display: 'inline-block' }} />
                    <span style={{ fontSize: '0.72rem', color: '#888' }}>{CATEGORY_LABELS[habit.task_category]}</span>
                    {isToday && !day.completed && habit.tracking_type === 'boolean' && (
                      <button
                        type="button"
                        onClick={() => doCheckin(habit.habit_id)}
                        style={{ fontSize: '0.7rem', fontWeight: 700, padding: '3px 9px', borderRadius: 8, border: 'none', background: '#74bcd9', color: '#fff', cursor: 'pointer' }}
                      >
                        Check in
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/* ─── Category consistency panel — kept deliberately quieter than the hero:
   shorter bars, lower fill opacity, smaller type. Category color remains
   pure identity (the fill hue), unchanged. ─── */
function CategoryConsistencyPanel({ categoryConsistency }: { categoryConsistency: HabitsSummary['category_consistency'] }) {
  return (
    <div className="glass" style={{ borderRadius: 20, padding: '16px 20px' }}>
      <h3 style={{ ...HEADING_FONT, margin: '0 0 12px', fontSize: '0.85rem', fontWeight: 700, color: '#666' }}>Consistency by category — this week</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {categoryConsistency.map(c => (
          <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 90, fontSize: '0.76rem', fontWeight: 600, color: '#666' }}>{CATEGORY_LABELS[c.category]}</div>
            <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
              <div className="ht-progress-fill" style={{ width: `${c.percent}%`, height: '100%', borderRadius: 4, background: CATEGORY_COLORS[c.category], opacity: 0.8 }} />
            </div>
            <div style={{ width: 50, textAlign: 'right', fontSize: '0.72rem', color: '#999' }}>{c.completed}/{c.scheduled}</div>
            <div style={{ width: 32, textAlign: 'right', fontSize: '0.74rem', fontWeight: 700, color: '#666' }}>{c.percent}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Habit card ─── */

function HabitCard({
  habit, index, busy, onCheckin, onUndo, onEdit, onDelete, onPauseToggle, onAmountCommitted, onOpenDetail,
}: {
  habit: HabitWithComputed; index: number; busy: boolean;
  onCheckin: () => void; onUndo: () => void; onEdit: () => void; onDelete: () => void; onPauseToggle: () => void;
  onAmountCommitted: () => void; onOpenDetail: () => void;
}) {
  const isFlexible = habit.schedule_mode === 'flexible';
  const isNumeric = habit.tracking_type === 'numeric';
  const isPaused = habit.task_status === 'paused';
  const canAct = !isPaused && (habit.is_today || habit.checked_in_today);
  const categoryColor = CATEGORY_COLORS[habit.task_category];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <div
      className="ht-card ht-card-enter"
      style={{
        borderTop: `4px solid ${categoryColor}`,
        backgroundImage: `linear-gradient(180deg, ${categoryColor}1f 0%, rgba(255,255,255,0) 160px)`,
        position: 'relative',
        zIndex: menuOpen ? 30 : 'auto',
        animationDelay: `${Math.min(index, 10) * 40}ms`,
      }}
      onClick={onOpenDetail}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ ...HEADING_FONT, fontWeight: 800, fontSize: '1.02rem', color: '#332b45' }}>{habit.task_name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: categoryColor, display: 'inline-block' }} />
            <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#888' }}>
              {CATEGORY_LABELS[habit.task_category]}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isPaused && (
            <span style={{
              fontSize: '0.64rem', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase',
              padding: '3px 8px', borderRadius: 999, background: 'rgba(0,0,0,0.08)', color: '#777', whiteSpace: 'nowrap',
            }}>
              Paused
            </span>
          )}
          <PriorityBadge priority={habit.priority} />
        </div>
      </div>

      {habit.note && (
        <p style={{
          margin: 0, fontSize: '0.83rem', color: '#555', lineHeight: 1.4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {habit.note}
        </p>
      )}

      <div style={{ fontSize: '0.74rem', color: '#888' }}>
        {isFlexible ? 'Flexible' : 'Fixed'} ·{' '}
        {isFlexible ? `${habit.times_per_week}× weekly` : habit.days_of_week.map(d => WEEKDAY_SHORT[d]).join(', ')}
        {isNumeric && habit.target_value != null && (
          habit.minimum_value != null
            ? ` · Target ${habit.target_value} ${habit.unit_label} · Minimum ${habit.minimum_value} ${habit.unit_label}`
            : ` · ${habit.target_value} ${habit.unit_label} each`
        )}
      </div>

      {isFlexible ? <WeekDots progress={habit.week_progress!} /> : <ChainRow chain={habit.chain!} />}

      {!isFlexible && (
        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: habit.checked_in_today ? '#42c38b' : habit.is_today ? '#c0392b' : '#999' }}>
          {habit.checked_in_today
            ? '✓ Done today'
            : habit.is_today
              ? <>⚠ Scheduled today <span style={{ fontWeight: 500, color: '#777' }}>— not yet done</span></>
              : 'Not scheduled today'}
        </div>
      )}

      {isFlexible && (() => {
        const notYetMet = habit.week_progress!.completed < habit.week_progress!.target;
        const isBehind = notYetMet && habit.pace === 'behind';
        const isAhead = notYetMet && habit.pace === 'ahead';
        return (
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: isBehind ? '#c0392b' : isAhead ? '#42c38b' : '#555' }}>
            {isBehind && '⚠ '}
            {Math.max(0, habit.week_progress!.target - habit.week_progress!.completed)} remaining{' '}
            <span style={{ fontWeight: 500, color: '#777' }}>
              · {habit.week_days_remaining} day{habit.week_days_remaining === 1 ? '' : 's'} left this week
              {isBehind && ' — behind pace'}
              {isAhead && ' — ahead of pace'}
            </span>
          </div>
        );
      })()}

      {!isFlexible && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#555' }}>
          <Flame size={13} color="#b8532c" />
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
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="ht-icon-btn"
            onClick={() => setMenuOpen(o => !o)}
            disabled={busy}
            aria-label="More actions"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="ht-card-menu">
              <button type="button" onClick={() => { setMenuOpen(false); onEdit(); }}><Pencil size={14} /> Edit</button>
              <button type="button" onClick={() => { setMenuOpen(false); onPauseToggle(); }}>{isPaused ? <Play size={14} /> : <Pause size={14} />} {isPaused ? 'Resume' : 'Pause'}</button>
              <button type="button" onClick={() => { setMenuOpen(false); onDelete(); }}><Trash2 size={14} /> Delete</button>
            </div>
          )}
        </div>
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
                <div style={{ flex: 1, height: 2, minWidth: 6, background: linked ? '#74bcd9' : 'rgba(0,0,0,0.1)' }} />
              )}
              <div
                title={`${day.weekday} ${day.date}${!day.scheduled ? ' — not scheduled' : day.completed ? ' — done' : isToday ? ' — not done yet' : ' — missed'}`}
                style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >
                <div
                  className={`ht-chain-node${isToday && day.scheduled && !day.completed ? ' ht-chain-node-pulse' : ''}`}
                  style={{
                    borderRadius: '50%',
                    transform: (day.scheduled && day.completed) ? 'scale(1.1)' : 'scale(1)',
                    ...(!day.scheduled
                      ? { width: 5, height: 5, background: 'rgba(0,0,0,0.25)' }
                      : day.completed
                        ? { width: 18, height: 18, background: '#74bcd9' }
                        : isToday
                          ? { width: 18, height: 18, border: '2px dashed #74bcd9', background: 'rgba(255,255,255,0.6)' }
                          : { width: 18, height: 18, border: '2px solid rgba(247,91,103,0.55)', background: 'transparent' }),
                    boxShadow: isToday && day.scheduled
                      ? '0 0 0 2px #fff, 0 0 0 4px rgba(116,188,217,0.55)'
                      : day.scheduled && day.completed
                        ? '0 0 0 2px rgba(255,255,255,0.6)'
                        : 'none',
                  }}
                />
              </div>
            </div>
            <div style={{ width: 18, textAlign: 'center', fontSize: '0.7rem', color: '#777', fontWeight: 700, marginTop: 2 }}>
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
              ? { background: '#74bcd9', boxShadow: '0 0 0 2px rgba(255,255,255,0.6)' }
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
            background: w.percent >= 100 ? '#74bcd9' : 'rgba(116,188,217,0.4)',
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
      <div style={{ ...HEADING_FONT, fontSize: '0.95rem', fontWeight: 800, color: '#332b45' }}>{value}</div>
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
            <h3 style={{ ...HEADING_FONT, margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{habit.task_name}</h3>
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
```

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors, project-wide.

- [ ] **Step 3: Verify by reading (no browser-automation tool in this environment)**

1. Confirm `HabitCard`'s fixed-schedule status line reads `fontSize: '0.88rem', fontWeight: 700`, with the three-way ternary (`checked_in_today` / `is_today` / else) producing exactly `'✓ Done today'`, `<>⚠ Scheduled today <span>...</span></>`, `'Not scheduled today'` — same three conditions as before, only the text/JSX structure and font weight changed.
2. Confirm `HabitCard`'s flexible remaining/pace block computes `notYetMet`, `isBehind`, `isAhead` once via the IIFE, and that `isBehind`/`isAhead` both require `notYetMet` to be true — this is the exact gate the spec's self-review caught was missing in an earlier draft. Confirm the rendered numbers (`remaining`, `week_days_remaining`) are computed identically to before this task.
3. Grep the whole file for `f2a7c0` (the pink stop-color used only in the brand gradient) and confirm the ONLY remaining hit is inside `RhythmRing`'s `<linearGradient id="ht-ring-gradient">` definition — every other prior occurrence (`ChainRow`'s completed node, `ChainRow`'s linked connector, `WeekDots`' completed dot, `.ht-amount-wrap.met .ht-amount-fill`, `HistoryChart`'s `>=100%` bar) must now read a plain `'#74bcd9'` with no `linear-gradient(...)` wrapper.
4. Confirm the chain's 4-state model (unscheduled 5px dot, completed, today-pending with pulse, missed) and its halo/pulse logic are otherwise completely unchanged — only the `background`/`boxShadow`-independent fill color of the completed state and the connector-line color changed, not any conditional.
5. Confirm the modal's Schedule and Tracking areas each render an eyebrow label (`fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase'`) followed by a human-framed question (`fontSize: '0.85rem', fontWeight: 600`) followed by a `.ht-choice-card` grid — and that the `Name`/`Note (optional)`/`Priority`/`Category` fields above them still use the plain `ht-label` class, unchanged.
6. Confirm both `.ht-choice-card` grids' `onClick` handlers set `schedule_mode`/`tracking_type` on `form` with the same string values (`'fixed'`/`'flexible'`, `'boolean'`/`'numeric'`) the old `.ht-toggle-btn` pills set, and that `active` gating reads `form.schedule_mode`/`form.tracking_type` correctly.
7. Grep the file for `ht-toggle-btn` and confirm zero remaining references (CSS or JSX) — its two callers both moved to `.ht-choice-card`, and the CSS rule itself is deleted, not merely unreferenced.
8. Confirm `.ht-day-btn`, `ACTIVE_TOGGLE_STYLE`, and the day-of-week picker are byte-for-byte unchanged.
9. Confirm `DailyRhythmPanel`, `CategoryConsistencyPanel`, the hero's JSX, and every other v10/v11 element not named in this plan's Global Constraints are unchanged from the v11-shipped file — this task should produce a diff confined to `HabitCard`, `ChainRow`, `WeekDots`, `AmountInput`, `HistoryChart`, the modal's Schedule/Tracking blocks, and the CSS block (`.ht-toggle-btn` removed, `.ht-choice-card*` added, the `.ht-amount-wrap.met .ht-amount-fill` gradient flattened).

- [ ] **Step 4: Verify against the real local dev DB**

Using a locally-signed session token (recipe: `next-auth/jwt`'s `encode({ token: { sub: '<user_id>', name }, secret: 'vibeboard-dev-secret-replace-in-production', salt: 'authjs.session-token' })`, cookie `authjs.session-token`; `user_id` 2 owns real habit data locally): confirm `GET /api/habits` still returns `schedule_mode`, `tracking_type`, `pace`, `week_progress`, `week_days_remaining`, `is_today`, `checked_in_today` in the shapes this redesign consumes, and that `POST /api/habits`/`PATCH /api/habits/:id` still accept `schedule_mode`/`tracking_type` field names matching what the modal's `submitForm` posts. This pass changes no computation — per the standing ruling from v10/v11 (this task touches no backend code, so a static read of `src/lib/habits.ts`'s types and `submitForm`'s body-construction logic is an acceptable substitute for a live call) — a live call is optional extra confidence, not required.

- [ ] **Step 5: Commit**

```bash
git add src/components/habits/HabitsDashboard.tsx
git commit -m "Cards, chain & modal redesign: elevated current-state line, brand gradient reserved for the hero ring, sectioned modal with human-framed questions and description-card toggles"
```

---

### Task 2: Update the migration log

**Files:**
- Modify: `habittracker-log.md`

- [ ] **Step 1: Append a new section**

Read the current file first to match its exact heading/tone/detail-level conventions (the v11 section, post-fix, is the most recent and closest in style — note it was the second docs task this session, after v10, to need special care around not overclaiming a layout detail; scrutinize this new section's ENTIRE text against the real code, not just a "Verification" subsection, the same discipline that let v10's and v11's fixed section clear review). Append a new `## Habit Tracker v12 — Cards, chain & modal` section covering: this is the second and final sub-project of the critique decomposition begun in v11; the card's current-state line elevation (fixed-schedule status and flexible-schedule remaining/pace both bump to `0.88rem`/`700`, with the icon-led two-part treatment when actionable, explicitly noting the flexible line's `notYetMet` gate is preserved from before — and mentioning the bug the spec's own self-review caught and fixed, since that's a genuinely notable fact about how this version was produced, not just what shipped); the gradient restraint (five flattenings, `RhythmRing` alone keeps it); the modal's new section-header treatment with human-framed questions; the `.ht-choice-card` description-card toggles replacing `.ht-toggle-btn` (now removed as dead code); and an explicit statement that this is a pure presentation pass with zero data/API/schema changes, verified via `tsc --noEmit` and structural code reading — no browser-automation tool is available in this environment, so nothing in this pass was visually rendered by either the implementer or its reviewer. Also note this closes out the two-part decomposition that began with the external design critique after v10 shipped.

- [ ] **Step 2: Commit**

```bash
git add habittracker-log.md
git commit -m "Document Habit Tracker v12 shipment in the migration log"
```
