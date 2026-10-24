'use client';

import { useState } from 'react';

import type { GradingCategory, GradingPeriod, GradingPresetFull, GradeScale } from '@/lib/studypulse/types';

/** Legacy wizard choice; the wizard is replaced in Task 8. */
type WizardFinalMode = 'average' | 'collective';

// The shared preset types now live in src/lib/studypulse/types.ts; re-exported so existing imports
// keep compiling until this file is removed (grading-system plan, Task 8).
export type { GradingCategory, GradingPeriod, GradeScale, FinalMode, GradingPresetFull } from '@/lib/studypulse/types';

const GLASS: React.CSSProperties = {
  background:          'rgba(255,255,255,0.92)',
  backdropFilter:      'blur(16px)',
  WebkitBackdropFilter:'blur(16px)',
  borderRadius:        '20px',
  border:              '1px solid rgba(255,255,255,0.5)',
  boxShadow:           '0 12px 40px rgba(0,0,0,0.18)',
};

const INPUT: React.CSSProperties = {
  width:        '100%',
  padding:      '9px 12px',
  borderRadius: '9px',
  border:       '1px solid rgba(180,190,210,0.5)',
  background:   'rgba(255,255,255,0.85)',
  fontSize:     '0.88rem',
  boxSizing:    'border-box',
  fontFamily:   'inherit',
};

const BTN_PRIMARY: React.CSSProperties = {
  background:   'linear-gradient(to right, #f2a7c0, #74bcd9)',
  color:        'white',
  border:       'none',
  borderRadius: '10px',
  padding:      '10px 22px',
  fontWeight:   700,
  fontSize:     '0.9rem',
  cursor:       'pointer',
};

const BTN_GHOST: React.CSSProperties = {
  background:   'rgba(240,240,245,0.9)',
  color:        '#555',
  border:       '1px solid rgba(200,200,220,0.4)',
  borderRadius: '10px',
  padding:      '10px 22px',
  fontWeight:   600,
  fontSize:     '0.9rem',
  cursor:       'pointer',
};

const DEFAULT_FEU: GradingPeriod[] = [
  {
    name: 'Midterm',
    categories: [
      { name: 'Quizzes',      weight: 36, is_singleton: false },
      { name: 'Tasks',        weight: 24, is_singleton: false },
      { name: 'Midterm Exam', weight: 40, is_singleton: true  },
    ],
  },
  {
    name: 'Finals',
    categories: [
      { name: 'Quizzes',      weight: 36, is_singleton: false },
      { name: 'Tasks',        weight: 24, is_singleton: false },
      { name: 'Midterm Exam', weight: 15, is_singleton: true  },
      { name: 'Final Exam',   weight: 25, is_singleton: true  },
    ],
  },
];

interface Props {
  userSubjectId: number;
  onComplete:    (preset: GradingPresetFull) => void;
  onCancel?:     () => void;
  existingPresets?: Array<{ preset_id: number; name: string; period_count: number }>;
}

export default function GradingSetupWizard({
  userSubjectId, onComplete, onCancel, existingPresets = [],
}: Props) {
  const [step, setStep]       = useState<'choose' | 'scale' | 'method' | 'build' | 'final' | 'lab' | 'saving'>('choose');
  const [useExisting, setUseExisting] = useState<number | null>(null);
  const [presetName, setPresetName]   = useState('');
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [gradeScale,  setGradeScale]  = useState<GradeScale>('4pt');
  const [periods, setPeriods] = useState<GradingPeriod[]>(DEFAULT_FEU);
  const [finalEnabled,    setFinalEnabled]    = useState(false);
  const [finalPeriodIdx,  setFinalPeriodIdx]  = useState<number | null>(null);
  const [finalMode,       setFinalMode]       = useState<WizardFinalMode>('average');
  const [hasLab,  setHasLab] = useState(false);
  const [lecW,    setLecW]   = useState(70);
  const [labW,    setLabW]   = useState(30);
  const [error,   setError]  = useState('');

  /* ── Period helpers ── */
  const addPeriod = () =>
    setPeriods(p => [...p, { name: '', categories: [{ name: '', weight: 100, is_singleton: false }] }]);

  const removePeriod = (pi: number) =>
    setPeriods(p => p.filter((_, i) => i !== pi));

  const updatePeriodName = (pi: number, val: string) =>
    setPeriods(p => p.map((x, i) => i === pi ? { ...x, name: val } : x));

  const addCat = (pi: number) =>
    setPeriods(p => p.map((x, i) => i !== pi ? x : {
      ...x, categories: [...x.categories, { name: '', weight: 0, is_singleton: false }],
    }));

  const removeCat = (pi: number, ci: number) =>
    setPeriods(p => p.map((x, i) => i !== pi ? x : {
      ...x, categories: x.categories.filter((_, j) => j !== ci),
    }));

  /* Editing a linked category's name stays in sync across periods (still the same
     item); weight is always independently editable per period, never propagated. */
  const updateCat = (pi: number, ci: number, field: keyof GradingCategory, val: string | boolean | number | null) => {
    setPeriods(p => {
      const linkGroup = p[pi]?.categories[ci]?.link_group;
      const propagate = linkGroup && (field === 'name' || field === 'carry_score');
      return p.map(x => ({
        ...x,
        categories: x.categories.map(c => {
          if (c === p[pi].categories[ci]) return { ...c, [field]: val };
          if (propagate && c.link_group === linkGroup) return { ...c, [field]: val };
          return c;
        }),
      }));
    });
  };

  /* Toggle A: link a category so it's mirrored (same name) into every other period.
     Weight stays independent per period; singleton items default to carrying their
     score forward until a period has entered its own. */
  const toggleLinkedAcrossPeriods = (pi: number, ci: number, on: boolean) => {
    setPeriods(p => {
      const src = p[pi].categories[ci];
      if (!on) {
        return p.map((x, i) => i !== pi ? x : {
          ...x, categories: x.categories.map((c, j) => j !== ci ? c : { ...c, link_group: null }),
        });
      }
      const groupId = src.link_group ?? `lg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return p.map((x, i) => {
        if (i === pi) {
          return {
            ...x,
            categories: x.categories.map((c, j) => j !== ci ? c : { ...c, link_group: groupId, carry_score: c.carry_score ?? true }),
          };
        }
        const alreadyLinked = x.categories.some(c => c.link_group === groupId);
        if (alreadyLinked) return x;
        return {
          ...x,
          categories: [...x.categories, {
            name: src.name, weight: src.weight, is_singleton: src.is_singleton,
            link_group: groupId, carry_score: true,
          }],
        };
      });
    });
  };

  /* ── Validation ── */
  const validatePeriods = (): string => {
    for (const p of periods) {
      if (!p.name.trim()) return 'Each period must have a name.';
      const total = p.categories.reduce((s, c) => s + Number(c.weight), 0);
      if (Math.abs(total - 100) > 0.01) return `"${p.name}" category weights must sum to 100% (currently ${total}%).`;
      for (const c of p.categories) {
        if (!c.name.trim()) return `All categories in "${p.name}" must have a name.`;
      }
    }
    if (hasLab && Math.abs(lecW + labW - 100) > 0.01) return 'Lecture + Lab weights must sum to 100%.';
    return '';
  };

  /* ── Save: pick existing preset ── */
  const saveExistingPreset = async () => {
    if (!useExisting) return;
    setStep('saving');
    try {
      await fetch(`/api/studypulse/subjects/${userSubjectId}/grading`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ preset_id: useExisting, has_lab: hasLab, lec_weight: lecW, lab_weight: labW }),
      });
      const r    = await fetch(`/api/studypulse/subjects/${userSubjectId}/grading`);
      const data = await r.json();
      onComplete(data.config.preset);
    } catch {
      setError('Failed to save. Please try again.');
      setStep('lab');
    }
  };

  /* ── Save: new preset ── */
  const saveNewPreset = async () => {
    const err = validatePeriods();
    if (err) { setError(err); return; }
    if (!presetName.trim()) { setError('Please enter a name for this grading system.'); return; }
    setError('');
    setStep('saving');
    try {
      const res  = await fetch('/api/studypulse/grading', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:        presetName.trim(),
          is_default:  setAsDefault,
          has_lab:     hasLab,
          lec_weight:  lecW,
          lab_weight:  labW,
          grade_scale: gradeScale,
          periods,
          final_period_index: finalEnabled ? finalPeriodIdx : null,
          final_mode:         finalEnabled ? finalMode      : null,
        }),
      });
      const data = await res.json();
      if (!data.preset_id) throw new Error(data.error ?? 'Unknown error');

      await fetch(`/api/studypulse/subjects/${userSubjectId}/grading`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ preset_id: data.preset_id, has_lab: hasLab, lec_weight: lecW, lab_weight: labW }),
      });

      const r2  = await fetch(`/api/studypulse/subjects/${userSubjectId}/grading`);
      const cfg = await r2.json();
      onComplete(cfg.config.preset);
    } catch (e) {
      setError((e as Error).message);
      setStep('lab');
    }
  };

  /* ── Overlay ── */
  return (
    <div style={{
      position:   'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(20,20,40,0.55)',
      display:    'flex', alignItems: 'center', justifyContent: 'center',
      padding:    '16px',
    }}>
      <div style={{ ...GLASS, width: '100%', maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto', padding: '32px 36px' }}>

        {/* Header */}
        <h2 style={{ margin: '0 0 6px', fontSize: '1.3rem', fontWeight: 800, color: '#2d3748' }}>
          🎓 Grading System Setup
        </h2>
        <p style={{ margin: '0 0 24px', color: '#777', fontSize: '0.88rem' }}>
          Configure how grades are calculated for this subject.
        </p>

        {/* ───── STEP: choose ───── */}
        {step === 'choose' && (
          <>
            {existingPresets.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <p style={{ fontWeight: 700, color: '#444', marginBottom: '10px', fontSize: '0.92rem' }}>
                  Use an existing grading system:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {existingPresets.map(p => (
                    <label key={p.preset_id} style={{
                      display:       'flex', alignItems: 'center', gap: '12px',
                      padding:       '12px 16px',
                      background:    useExisting === p.preset_id ? 'rgba(116,188,217,0.15)' : 'rgba(240,245,255,0.8)',
                      border:        `2px solid ${useExisting === p.preset_id ? '#74bcd9' : 'rgba(200,210,230,0.5)'}`,
                      borderRadius:  '12px',
                      cursor:        'pointer',
                    }}>
                      <input type="radio" name="existing"
                        checked={useExisting === p.preset_id}
                        onChange={() => setUseExisting(p.preset_id)}
                        style={{ accentColor: '#74bcd9' }}
                      />
                      <span style={{ fontWeight: 700, color: '#334' }}>{p.name}</span>
                      <span style={{ color: '#999', fontSize: '0.8rem' }}>{p.period_count} period{p.period_count !== 1 ? 's' : ''}</span>
                    </label>
                  ))}
                </div>
                {useExisting && (
                  <button
                    style={{ ...BTN_PRIMARY, marginTop: '16px' }}
                    onClick={() => setStep('lab')}
                  >
                    Use Selected →
                  </button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '20px 0 8px' }}>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(180,190,210,0.4)' }} />
                  <span style={{ color: '#aaa', fontSize: '0.82rem' }}>or</span>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(180,190,210,0.4)' }} />
                </div>
              </div>
            )}

            <p style={{ fontWeight: 700, color: '#444', marginBottom: '10px', fontSize: '0.92rem' }}>
              Create a new grading system:
            </p>
            <input
              style={INPUT}
              placeholder='e.g. "FEU Tech Standard", "DLSU Semestral"'
              value={presetName}
              onChange={e => setPresetName(e.target.value)}
            />
            <p style={{ color: '#888', fontSize: '0.78rem', margin: '6px 0 16px' }}>
              The FEU Tech default (Midterm + Finals) is pre-filled. Customize as needed.
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button style={BTN_PRIMARY} onClick={() => { if (!presetName.trim()) { setError('Please enter a name for this grading system.'); return; } setError(''); setUseExisting(null); setStep('scale'); }}>
                Next: Grade Scale →
              </button>
              {onCancel && (
                <button style={BTN_GHOST} onClick={onCancel}>Cancel</button>
              )}
            </div>
            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '10px' }}>{error}</p>}
          </>
        )}

        {/* ───── STEP: scale ───── */}
        {step === 'scale' && (
          <>
            <p style={{ fontWeight: 700, color: '#444', marginBottom: '8px', fontSize: '0.95rem' }}>
              What grading scale does this subject use?
            </p>
            <p style={{ color: '#888', fontSize: '0.82rem', margin: '0 0 20px' }}>
              This determines how percentage averages are converted to institutional grade points.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              {/* 4.0 option */}
              <button
                onClick={() => setGradeScale('4pt')}
                style={{
                  padding:      '16px 20px',
                  borderRadius: '14px',
                  border:       `2px solid ${gradeScale === '4pt' ? '#74bcd9' : 'rgba(200,210,230,0.5)'}`,
                  background:   gradeScale === '4pt' ? 'rgba(116,188,217,0.12)' : 'rgba(240,245,255,0.8)',
                  textAlign:    'left',
                  cursor:       'pointer',
                }}
              >
                <div style={{ fontWeight: 800, color: gradeScale === '4pt' ? '#2a7fa8' : '#334', fontSize: '1rem', marginBottom: '4px' }}>
                  4.0 is Highest
                </div>
                <div style={{ fontSize: '0.78rem', color: '#777', lineHeight: 1.5 }}>
                  A (4.0) · B+ (3.5) · B (3.0) · C+ (2.5) · C (2.0) · D+ (1.5) · D (1.0) · F (0.5)
                </div>
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[['97–100','A','Excellent'],['93–96','B+','Superior'],['89–92','B','Very Good'],['85–88','C+','Good'],['80–84','C','Satisfactory'],['75–79','D+','Fair'],['70–74','D','Pass'],['<70','F','Failed']].map(([range, letter, desc]) => (
                    <span key={letter} style={{ background: 'rgba(116,188,217,0.15)', borderRadius: '6px', padding: '2px 8px', fontSize: '0.7rem', color: '#3a8dba', fontWeight: 600 }}>
                      {range} → {letter} ({desc})
                    </span>
                  ))}
                </div>
              </button>

              {/* 1.0 option */}
              <button
                onClick={() => setGradeScale('1pt')}
                style={{
                  padding:      '16px 20px',
                  borderRadius: '14px',
                  border:       `2px solid ${gradeScale === '1pt' ? '#f2a7c0' : 'rgba(200,210,230,0.5)'}`,
                  background:   gradeScale === '1pt' ? 'rgba(242,167,192,0.1)' : 'rgba(240,245,255,0.8)',
                  textAlign:    'left',
                  cursor:       'pointer',
                }}
              >
                <div style={{ fontWeight: 800, color: gradeScale === '1pt' ? '#c0607c' : '#334', fontSize: '1rem', marginBottom: '4px' }}>
                  1.0 is Highest (5-point scale)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#777', lineHeight: 1.5 }}>
                  1.00 (Excellent) → 1.25 → 1.50 → 1.75 → 2.00 → 2.25 → 2.50 → 2.75 → 3.00 (Passed) · Below 75% = 5.00 (Failed)
                </div>
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[['96–100','1.00','Excellent'],['94–95','1.25','Very Good'],['92–93','1.50','Very Good'],['89–91','1.75','Good'],['87–88','2.00','Good'],['84–86','2.25','Good'],['82–83','2.50','Fair'],['79–81','2.75','Fair'],['75–78','3.00','Passed'],['<75','5.00','Failed']].map(([range, gp, desc]) => (
                    <span key={gp} style={{ background: 'rgba(242,167,192,0.15)', borderRadius: '6px', padding: '2px 8px', fontSize: '0.7rem', color: '#c0607c', fontWeight: 600 }}>
                      {range} → {gp} ({desc})
                    </span>
                  ))}
                </div>
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button style={BTN_PRIMARY} onClick={() => setStep('method')}>
                Next: Final Grade Method →
              </button>
              <button style={BTN_GHOST} onClick={() => setStep('choose')}>← Back</button>
            </div>
          </>
        )}

        {/* ───── STEP: method ───── */}
        {step === 'method' && (
          <>
            <p style={{ fontWeight: 700, color: '#444', marginBottom: '8px', fontSize: '0.95rem' }}>
              How should your overall Final Grade be computed?
            </p>
            <p style={{ color: '#888', fontSize: '0.82rem', margin: '0 0 20px' }}>
              You'll choose whether to actually show a Final Grade a bit later — this just decides the math it'll use if you do.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              <button
                onClick={() => setFinalMode('average')}
                style={{
                  padding:      '16px 20px',
                  borderRadius: '14px',
                  border:       `2px solid ${finalMode === 'average' ? '#74bcd9' : 'rgba(200,210,230,0.5)'}`,
                  background:   finalMode === 'average' ? 'rgba(116,188,217,0.12)' : 'rgba(240,245,255,0.8)',
                  textAlign:    'left',
                  cursor:       'pointer',
                }}
              >
                <div style={{ fontWeight: 800, color: finalMode === 'average' ? '#2a7fa8' : '#334', fontSize: '1rem', marginBottom: '4px' }}>
                  Average of all periods
                </div>
                <div style={{ fontSize: '0.78rem', color: '#777', lineHeight: 1.5 }}>
                  Mean of every period's own grade — e.g. (Midterm + Finals) / 2. Simple, treats each period as one equal unit.
                </div>
              </button>

              <button
                onClick={() => setFinalMode('collective')}
                style={{
                  padding:      '16px 20px',
                  borderRadius: '14px',
                  border:       `2px solid ${finalMode === 'collective' ? '#f2a7c0' : 'rgba(200,210,230,0.5)'}`,
                  background:   finalMode === 'collective' ? 'rgba(242,167,192,0.1)' : 'rgba(240,245,255,0.8)',
                  textAlign:    'left',
                  cursor:       'pointer',
                }}
              >
                <div style={{ fontWeight: 800, color: finalMode === 'collective' ? '#c0607c' : '#334', fontSize: '1rem', marginBottom: '4px' }}>
                  Collective percentage
                </div>
                <div style={{ fontSize: '0.78rem', color: '#777', lineHeight: 1.5 }}>
                  Every category from every period is pooled into one weighted total, instead of averaging period grades.
                  When you build your periods next, you can mark categories that repeat across periods (like Quizzes) so they're
                  not double-counted, and give single-score items (like an exam) a different weight in the collective total.
                </div>
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button style={BTN_PRIMARY} onClick={() => setStep('build')}>
                Next: Build Periods →
              </button>
              <button style={BTN_GHOST} onClick={() => setStep('scale')}>← Back</button>
            </div>
          </>
        )}

        {/* ───── STEP: build ───── */}
        {step === 'build' && (
          <>
            {periods.map((period, pi) => {
                const total = period.categories.reduce((s, c) => s + Number(c.weight), 0);
                const ok    = Math.abs(total - 100) < 0.01;
                return (
                  <div key={pi} style={{
                    background:   'rgba(240,245,255,0.7)',
                    border:       '1px solid rgba(180,195,220,0.4)',
                    borderRadius: '14px',
                    padding:      '18px 20px',
                    marginBottom: '16px',
                  }}>
                    {/* Period header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                      <input
                        style={{ ...INPUT, flex: 1, minWidth: '120px', fontWeight: 700, fontSize: '0.95rem' }}
                        value={period.name}
                        onChange={e => updatePeriodName(pi, e.target.value)}
                        placeholder="Period name (e.g. Midterm, Finals)"
                      />
                      <span style={{
                        padding: '3px 10px', borderRadius: '999px', fontSize: '0.76rem', fontWeight: 700, whiteSpace: 'nowrap',
                        background: ok ? 'rgba(220,252,231,0.9)' : 'rgba(254,226,226,0.9)',
                        color:      ok ? '#15803d'               : '#dc2626',
                      }}>
                        {total.toFixed(0)}% / 100%
                      </span>
                      {periods.length > 1 && (
                        <button
                          onClick={() => removePeriod(pi)}
                          style={{ background: 'rgba(254,226,226,0.8)', color: '#dc2626', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontWeight: 700 }}
                        >✕</button>
                      )}
                    </div>

                    {/* Categories */}
                    {period.categories.map((cat, ci) => (
                      <div key={ci} style={{
                        background: 'rgba(255,255,255,0.55)', borderRadius: '10px', padding: '8px 10px', marginBottom: '8px',
                      }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
                          <input
                            style={{ ...INPUT, flex: 1, padding: '7px 10px' }}
                            value={cat.name}
                            onChange={e => updateCat(pi, ci, 'name', e.target.value)}
                            placeholder="Category name (e.g. Quizzes)"
                          />
                          <input
                            type="number" min="0" max="100" step="0.01"
                            style={{ ...INPUT, width: '58px', padding: '7px 6px', textAlign: 'center' }}
                            value={cat.weight}
                            onChange={e => updateCat(pi, ci, 'weight', parseFloat(e.target.value) || 0)}
                          />
                          <span style={{ color: '#888', fontSize: '0.78rem' }}>%</span>
                          {period.categories.length > 1 && (
                            <button
                              onClick={() => removeCat(pi, ci)}
                              style={{ background: 'rgba(254,226,226,0.8)', color: '#dc2626', border: 'none', borderRadius: '7px', padding: '5px 9px', cursor: 'pointer', fontSize: '0.78rem', flexShrink: 0 }}
                            >✕</button>
                          )}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', rowGap: '4px', columnGap: '12px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', color: '#666', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={cat.is_singleton}
                              onChange={e => updateCat(pi, ci, 'is_singleton', e.target.checked)}
                              style={{ accentColor: '#74bcd9' }}
                            />
                            Single score
                          </label>

                          {periods.length > 1 && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', color: '#666', whiteSpace: 'nowrap', cursor: 'pointer' }}
                              title="Auto-creates this same category (same name) in the other period(s). Each period keeps its own weight.">
                              <input
                                type="checkbox"
                                checked={!!cat.link_group}
                                onChange={e => toggleLinkedAcrossPeriods(pi, ci, e.target.checked)}
                                style={{ accentColor: '#74bcd9' }}
                              />
                              Same in other periods
                            </label>
                          )}

                          {cat.is_singleton && cat.link_group && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.74rem', color: '#666', whiteSpace: 'nowrap', cursor: 'pointer' }}
                              title="Reuses this score in the linked period(s) until you enter one there directly.">
                              <input
                                type="checkbox"
                                checked={cat.carry_score !== false}
                                onChange={e => updateCat(pi, ci, 'carry_score', e.target.checked)}
                                style={{ accentColor: '#f2a7c0' }}
                              />
                              Carry score to other periods
                            </label>
                          )}
                        </div>
                      </div>
                    ))}
                    <button onClick={() => addCat(pi)} style={{ ...BTN_GHOST, padding: '6px 14px', fontSize: '0.8rem', marginTop: '4px' }}>
                      + Add Category
                    </button>
                  </div>
                );
              })}

            <button onClick={addPeriod} style={{ ...BTN_GHOST, marginBottom: '20px' }}>
              + Add Period
            </button>

            {/* Set as default toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={setAsDefault}
                onChange={e => setSetAsDefault(e.target.checked)}
                style={{ accentColor: '#f2a7c0', width: '16px', height: '16px' }}
              />
              <span style={{ fontSize: '0.88rem', color: '#555', fontWeight: 600 }}>
                Set as my default grading system (auto-apply to new subjects)
              </span>
            </label>

            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '12px' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button style={BTN_PRIMARY} onClick={() => {
                const e = validatePeriods();
                if (e) { setError(e); return; }
                setError('');
                if (finalPeriodIdx === null || finalPeriodIdx >= periods.length) {
                  setFinalPeriodIdx(periods.length - 1);
                }
                setStep('final');
              }}>
                Next: Final Grade →
              </button>
              <button style={BTN_GHOST} onClick={() => setStep('method')}>← Back</button>
            </div>
          </>
        )}

        {/* ───── STEP: final ───── */}
        {step === 'final' && (
          <>
            <p style={{ fontWeight: 700, color: '#444', marginBottom: '8px', fontSize: '0.95rem' }}>
              Do you want a Final Grade summary?
            </p>
            <p style={{ color: '#888', fontSize: '0.82rem', margin: '0 0 20px' }}>
              Optional. Combines your periods into one overall grade, shown alongside the per-period grades.
            </p>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              {[false, true].map(v => (
                <button
                  key={String(v)}
                  onClick={() => setFinalEnabled(v)}
                  style={{
                    padding:      '12px 28px',
                    borderRadius: '12px',
                    border:       `2px solid ${finalEnabled === v ? '#74bcd9' : 'rgba(200,210,230,0.5)'}`,
                    background:   finalEnabled === v ? 'rgba(116,188,217,0.15)' : 'rgba(240,245,255,0.8)',
                    color:        finalEnabled === v ? '#2a7fa8' : '#666',
                    fontWeight:   700,
                    cursor:       'pointer',
                    fontSize:     '0.92rem',
                  }}
                >
                  {v ? '✅ Yes' : '❌ No, just show periods'}
                </button>
              ))}
            </div>

            {finalEnabled && (
              <div style={{ background: 'rgba(116,188,217,0.08)', border: '1px solid rgba(116,188,217,0.3)', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px' }}>
                <p style={{ margin: '0 0 10px', fontWeight: 600, color: '#3a8dba', fontSize: '0.88rem' }}>
                  Which period is the final one?
                </p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
                  {periods.map((p, pi) => (
                    <button
                      key={pi}
                      onClick={() => setFinalPeriodIdx(pi)}
                      style={{
                        padding:      '7px 16px',
                        borderRadius: '999px',
                        border:       `2px solid ${finalPeriodIdx === pi ? '#74bcd9' : 'rgba(200,210,230,0.5)'}`,
                        background:   finalPeriodIdx === pi ? 'rgba(116,188,217,0.2)' : 'rgba(255,255,255,0.7)',
                        color:        finalPeriodIdx === pi ? '#2a7fa8' : '#666',
                        fontWeight:   700,
                        fontSize:     '0.84rem',
                        cursor:       'pointer',
                      }}
                    >
                      {p.name || `Period ${pi + 1}`}
                    </button>
                  ))}
                </div>
                <p style={{ margin: 0, fontSize: '0.76rem', color: '#888' }}>
                  This just marks where the 🏁 Final Grade badge is shown — the math uses the{' '}
                  <strong>{finalMode === 'average' ? 'Average' : 'Collective'}</strong> method you picked earlier.
                </p>
              </div>
            )}

            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '12px' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button style={BTN_PRIMARY} onClick={() => {
                if (finalEnabled && finalPeriodIdx === null) { setError('Please pick which period is the final one.'); return; }
                setError('');
                setStep('lab');
              }}>
                Next: Lab Option →
              </button>
              <button style={BTN_GHOST} onClick={() => setStep('build')}>← Back</button>
            </div>
          </>
        )}

        {/* ───── STEP: lab ───── */}
        {(step === 'lab') && (
          <>
            <p style={{ fontWeight: 700, color: '#444', marginBottom: '16px' }}>
              Does this subject have a laboratory component?
            </p>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
              {[false, true].map(v => (
                <button
                  key={String(v)}
                  onClick={() => setHasLab(v)}
                  style={{
                    padding:      '12px 28px',
                    borderRadius: '12px',
                    border:       `2px solid ${hasLab === v ? '#74bcd9' : 'rgba(200,210,230,0.5)'}`,
                    background:   hasLab === v ? 'rgba(116,188,217,0.15)' : 'rgba(240,245,255,0.8)',
                    color:        hasLab === v ? '#2a7fa8' : '#666',
                    fontWeight:   700,
                    cursor:       'pointer',
                    fontSize:     '0.92rem',
                  }}
                >
                  {v ? '✅ Yes, has Lab' : '❌ No Lab'}
                </button>
              ))}
            </div>

            {hasLab && (
              <div style={{ background: 'rgba(116,188,217,0.08)', border: '1px solid rgba(116,188,217,0.3)', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px' }}>
                <p style={{ margin: '0 0 14px', fontWeight: 600, color: '#3a8dba', fontSize: '0.88rem' }}>
                  Overall grade = Lecture × {lecW}% + Lab × {labW}%
                </p>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                    <span style={{ fontSize: '0.78rem', color: '#666', fontWeight: 600 }}>Lecture Weight %</span>
                    <input
                      type="number" min="0" max="100" step="1"
                      style={INPUT}
                      value={lecW}
                      onChange={e => { const v = parseInt(e.target.value) || 0; setLecW(v); setLabW(100 - v); }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                    <span style={{ fontSize: '0.78rem', color: '#666', fontWeight: 600 }}>Lab Weight %</span>
                    <input
                      type="number" min="0" max="100" step="1"
                      style={INPUT}
                      value={labW}
                      onChange={e => { const v = parseInt(e.target.value) || 0; setLabW(v); setLecW(100 - v); }}
                    />
                  </label>
                </div>
                {Math.abs(lecW + labW - 100) > 0.01 && (
                  <p style={{ color: '#dc2626', fontSize: '0.8rem', margin: '8px 0 0' }}>Weights must sum to 100%.</p>
                )}
              </div>
            )}

            {error && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '12px' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                style={BTN_PRIMARY}
                onClick={useExisting ? saveExistingPreset : saveNewPreset}
              >
                Save & Apply ✓
              </button>
              <button style={BTN_GHOST} onClick={() => setStep(useExisting ? 'choose' : 'final')}>← Back</button>
            </div>
          </>
        )}

        {step === 'saving' && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#888' }}>
            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⏳</div>
            Saving grading system…
          </div>
        )}
      </div>
    </div>
  );
}
