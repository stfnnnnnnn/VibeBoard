'use client';

import { useState, useMemo, useCallback } from 'react';
import { avgTransmuted, type TransmutationTable } from '@/lib/transmutation';
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';
import type { EntryRow, GradingConfig } from './SubjectCardView';

function avgGrades(rows: EntryRow[]): number {
  const v = rows.filter(r => r.grade !== null);
  if (!v.length) return 0;
  return v.reduce((s, r) => s + r.grade!, 0) / v.length;
}

function avg(rows: EntryRow[], transmuted: boolean, table: TransmutationTable | null): number {
  return transmuted && table ? avgTransmuted(rows, table) : avgGrades(rows);
}

const GLASS: React.CSSProperties = {
  background:          'rgba(255,255,255,0.22)',
  backdropFilter:      'blur(14px)',
  WebkitBackdropFilter:'blur(14px)',
  borderRadius:        '20px',
  border:              '1px solid rgba(255,255,255,0.35)',
  boxShadow:           '0 8px 28px rgba(0,0,0,0.12)',
};

const INPUT_S: React.CSSProperties = {
  padding:      '6px 10px',
  borderRadius: '8px',
  border:       '1px solid rgba(180,190,215,0.5)',
  background:   'rgba(255,255,255,0.85)',
  fontSize:     '0.84rem',
  fontFamily:   'inherit',
  width:        '72px',
  textAlign:    'center',
};

function ProgressBar({ current, target }: { current: number; target: number }) {
  const pct     = Math.min(100, (current / 100) * 100);
  const tpct    = Math.min(100, (target  / 100) * 100);
  const onTrack = current >= target;
  const bar     = onTrack ? '#16a34a' : current >= target * 0.88 ? '#d97706' : '#dc2626';

  return (
    <div style={{ position: 'relative', height: '22px', borderRadius: '999px', background: 'rgba(200,210,230,0.35)', overflow: 'visible', marginTop: '8px' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: `linear-gradient(to right, ${bar}88, ${bar})`, borderRadius: '999px', transition: 'width 0.4s ease' }} />
      <div style={{ position: 'absolute', left: `${tpct}%`, top: '-5px', bottom: '-5px', width: '3px', background: '#f2a7c0', borderRadius: '2px', transform: 'translateX(-50%)', zIndex: 2 }} />
      <span style={{ position: 'absolute', left: `${Math.max(4, pct - 2)}%`, top: '50%', transform: 'translateY(-50%)', fontSize: '0.72rem', fontWeight: 700, color: 'white', textShadow: '0 1px 2px rgba(0,0,0,0.4)', pointerEvents: 'none' }}>
        {current.toFixed(1)}%
      </span>
    </div>
  );
}

export interface TargetGradePanelProps {
  subjectName:     string;
  config:          GradingConfig | null;
  catEntries:      Record<number, EntryRow[]>;
  activities:      EntryRow[];
  quizzes:         EntryRow[];
  exams:           EntryRow[];
  transTable:      TransmutationTable | null;
  transmutationOn: boolean;
  onClose:         () => void;
}

interface PeriodSummary {
  key:          string;
  name:         string;
  currentGrade: number;
  targetGrade:  number;
}

export default function TargetGradePanel({
  subjectName, config, catEntries,
  activities, quizzes, exams,
  transTable, transmutationOn,
  onClose,
}: TargetGradePanelProps) {
  const isCustom     = config !== null;
  const gradeScale: GradeScale | null = config?.grade_scale ?? null;
  const defaultTarget = 85;

  const [targets, setTargets] = useState<Record<string, number>>(() => {
    if (!config) return { overall: defaultTarget };
    const init: Record<string, number> = {};
    for (const p of config.preset.periods) init[String(p.period_id)] = defaultTarget;
    return init;
  });

  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiError,    setAiError]    = useState<string | null>(null);

  /* Compute current grade per period. Mirrors the "assume perfect" rule used by
     CustomGradeCalculator/GradeCalculator in SubjectCardView.tsx: within a period
     (or mode) that has at least some data, a still-ungraded category is assumed
     100 so it doesn't drag the running grade down before work has been submitted
     for it. A period/mode with NO data anywhere shows 0, not a false "perfect." */
  const periods = useMemo((): PeriodSummary[] => {
    const hasGradeData = (r: EntryRow) => r.grade !== null || (!!r.score && !!r.items);

    if (isCustom && config) {
      return config.preset.periods.map(period => {
        const key = String(period.period_id);
        const catHasData = period.categories.map(cat => (catEntries[cat.cat_id] ?? []).some(hasGradeData));
        const periodHasData = catHasData.some(Boolean);

        let ws = 0, tw = 0;
        period.categories.forEach((cat, i) => {
          const rows = catEntries[cat.cat_id] ?? [];
          const g    = catHasData[i] ? avg(rows, transmutationOn, transTable) : 100;
          ws += g * Number(cat.weight);
          tw += Number(cat.weight);
        });

        return {
          key,
          name:         period.name,
          currentGrade: periodHasData && tw > 0 ? ws / tw : 0,
          targetGrade:  targets[key] ?? defaultTarget,
        };
      });
    }

    /* Legacy */
    const actHasData  = activities.some(hasGradeData);
    const quizHasData = quizzes.some(hasGradeData);
    const midHasData  = exams.some(e => e.specificType === 'Midterm'    && hasGradeData(e));
    const finHasData  = exams.some(e => e.specificType === 'Final Exam' && hasGradeData(e));
    const examHasData = midHasData || finHasData;

    const actAvg = avg(activities, transmutationOn, transTable);
    const qAvg   = avg(quizzes,    transmutationOn, transTable);
    const midAvg = avg(exams.filter(e => e.specificType === 'Midterm'),    transmutationOn, transTable);
    const finAvg = avg(exams.filter(e => e.specificType === 'Final Exam'), transmutationOn, transTable);
    const finEx  = (midAvg * 15 + finAvg * 25) / 40;

    const modeHasAnyData = actHasData || quizHasData || examHasData;
    const overall = !modeHasAnyData ? 0 :
      ((actHasData ? actAvg : 100) * 24 + (quizHasData ? qAvg : 100) * 36 + (examHasData ? finEx : 100) * 40) / 100;

    return [{
      key:          'overall',
      name:         'Overall Grade',
      currentGrade: overall,
      targetGrade:  targets['overall'] ?? defaultTarget,
    }];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCustom, config, catEntries, activities, quizzes, exams, transmutationOn, transTable, targets]);

  const handleAiAnalysis = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    setAiResponse(null);
    try {
      const payload = {
        subjectName,
        transmuted: transmutationOn,
        periods: periods.map(p => ({
          name:         p.name,
          currentGrade: p.currentGrade,
          targetGrade:  p.targetGrade,
          categories:   [],
        })),
      };
      const res  = await fetch('/api/studypulse/target-analysis', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'AI request failed');
      setAiResponse(data.analysis);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiLoading(false);
    }
  }, [subjectName, transmutationOn, periods]);

  return (
    <div style={{ ...GLASS, padding: '24px 28px', marginBottom: '22px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '22px' }}>
        <span style={{ fontSize: '1.2rem' }}>🎯</span>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#333', flexGrow: 1 }}>
          Target Grade Planner
          {transmutationOn && <span style={{ marginLeft: '8px', fontSize: '0.72rem', color: '#74bcd9', fontWeight: 600 }}>✦ transmuted</span>}
          {gradeScale && <span style={{ marginLeft: '8px', fontSize: '0.72rem', color: '#f2a7c0', fontWeight: 600 }}>{gradeScale === '4pt' ? '4.0 scale' : '1.0 scale'}</span>}
        </h2>
        <button onClick={onClose} style={{ background: 'rgba(240,240,245,0.9)', border: 'none', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', color: '#888', fontWeight: 700, fontSize: '0.82rem' }}>
          ✕ Close
        </button>
      </div>

      {/* Period cards */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(periods.length, 3)}, minmax(0,1fr))`, gap: '14px', marginBottom: '24px' }}>
        {periods.map(p => {
          const onTrack = p.currentGrade >= p.targetGrade;
          const gap     = p.targetGrade - p.currentGrade;
          const gi      = p.currentGrade > 0 && gradeScale ? toGradeInfo(p.currentGrade, gradeScale) : null;
          const tgi     = gradeScale ? toGradeInfo(p.targetGrade, gradeScale) : null;

          return (
            <div key={p.key} style={{ background: 'rgba(255,255,255,0.45)', borderRadius: '16px', padding: '16px 18px' }}>
              {/* Period name + target input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, color: '#444', fontSize: '0.95rem', flexGrow: 1 }}>{p.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600 }}>Target %:</span>
                  <input
                    type="number" min="0" max="100" step="1"
                    style={INPUT_S}
                    value={p.targetGrade}
                    onChange={e => setTargets(prev => ({ ...prev, [p.key]: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) }))}
                  />
                </div>
              </div>

              {/* Grade display row */}
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '20px' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#aaa', fontWeight: 600, marginBottom: '2px' }}>CURRENT</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, color: onTrack ? '#16a34a' : p.currentGrade > 0 ? '#d97706' : '#aaa', lineHeight: 1 }}>
                    {p.currentGrade > 0 ? p.currentGrade.toFixed(1) : '—'}
                    {p.currentGrade > 0 && <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>%</span>}
                  </div>
                  {gi && (
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#666', marginTop: '2px' }}>
                      {gi.letter} · {gi.description}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.7rem', color: '#aaa', fontWeight: 600, marginBottom: '2px' }}>TARGET</div>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: '#f2a7c0', lineHeight: 1 }}>
                    {p.targetGrade}%
                  </div>
                  {tgi && (
                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#c0607c', marginTop: '2px' }}>
                      {tgi.letter} · {tgi.description}
                    </div>
                  )}
                </div>
              </div>

              <ProgressBar current={p.currentGrade} target={p.targetGrade} />

              {/* Status badge */}
              <div style={{ marginTop: '10px', fontSize: '0.78rem', fontWeight: 700, color: onTrack ? '#16a34a' : '#d97706', textAlign: 'center' }}>
                {p.currentGrade === 0
                  ? 'No grades yet — enter scores to track progress.'
                  : onTrack
                    ? `✓ On track — ${(p.currentGrade - p.targetGrade).toFixed(1)}% above target`
                    : `${gap.toFixed(1)}% needed to reach target`
                }
              </div>
            </div>
          );
        })}
      </div>

      {/* AI Analysis */}
      <div style={{ borderTop: '1px solid rgba(200,215,235,0.3)', paddingTop: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
          <span style={{ fontWeight: 700, color: '#444', fontSize: '0.95rem' }}>🤖 AI Study Advisor</span>
          <button
            onClick={handleAiAnalysis}
            disabled={aiLoading}
            style={{
              marginLeft:   'auto',
              background:   aiLoading ? 'rgba(200,210,230,0.5)' : 'linear-gradient(to right, #f2a7c0, #74bcd9)',
              color:        aiLoading ? '#888' : 'white',
              border:       'none',
              borderRadius: '10px',
              padding:      '8px 18px',
              fontWeight:   700,
              fontSize:     '0.82rem',
              cursor:       aiLoading ? 'wait' : 'pointer',
            }}
          >
            {aiLoading ? '⏳ Analyzing…' : '✨ Get Projection'}
          </button>
        </div>

        {aiError && (
          <div style={{ padding: '12px 16px', background: 'rgba(254,226,226,0.8)', borderRadius: '10px', color: '#dc2626', fontSize: '0.82rem', fontWeight: 600 }}>
            ⚠️ {aiError}
          </div>
        )}

        {!aiResponse && !aiError && !aiLoading && (
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#bbb', fontStyle: 'italic' }}>
            Set your target above, then click "Get Projection" for a personalized study plan.
          </p>
        )}

        {aiResponse && (
          <div style={{ background: 'rgba(255,255,255,0.55)', borderRadius: '14px', padding: '16px 20px', fontSize: '0.88rem', lineHeight: 1.7, color: '#333', border: '1px solid rgba(116,188,217,0.25)' }}>
            {aiResponse.split('\n\n').map((para, i) => (
              <p key={i} style={{ margin: i === 0 ? 0 : '10px 0 0' }}>{para}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
