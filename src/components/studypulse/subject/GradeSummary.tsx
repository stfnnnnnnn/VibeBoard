'use client';

import { useMemo, useState } from 'react';
import { Calculator, Flag, RotateCcw } from 'lucide-react';
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';
import { projectPeriod, subjectFinal, type CategoryStats, type PeriodInput, type PeriodProjection } from '@/lib/studypulse/projection';
import type { FinalMode } from '@/lib/studypulse/types';
import { legacyMidtermPeriod } from '@/lib/studypulse/periodModel';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import SpSegmented from '../ui/SpSegmented';

const TONE = { success: 'sp-tone-success', warn: 'sp-tone-warn', danger: 'sp-tone-danger', none: 'sp-tone-muted' } as const;
const letterLine = (v: number | null, scale: GradeScale | null) => (v !== null && scale ? (() => { const g = toGradeInfo(v, scale); return `${g.letter} · ${g.description}`; })() : '');
/* Period values and the final read at one decimal even when transmuted: they are weighted means, and the header
   tiles, period tabs, period chips and planner all show the same one-decimal number (T12 consistency check). */
const dp = (v: number) => f1(v);
/* A category's points toward the period value. The value is graded-only and renormalised over the graded
   weight (D11), so each contribution is avg × weight / Σ graded weight; the shown contributions sum to it. */
type ContribCat = Pick<CategoryStats, 'n' | 'weight' | 'avg'>;
const gradedWeight = (cats: ContribCat[]) => cats.reduce((s, c) => s + (c.n > 0 && c.weight > 0 ? c.weight : 0), 0);
const contribution = (c: ContribCat, gw: number) => (c.avg === null || gw <= 0 || c.weight <= 0 ? 0 : (c.avg * c.weight) / gw);

/** Custom-preset summary: per-period current (graded-only, spec D11) with a category breakdown and an optional what-if. */
export default function GradeSummary({ periods, projections, finalMode, finalGrade, finalPeriodKey, scale, transmutationOn, lab }: {
  periods: PeriodInput[]; projections: PeriodProjection[];
  finalMode: FinalMode | null;
  finalGrade: number | null; finalPeriodKey: string | null;
  scale: GradeScale | null; transmutationOn: boolean;
  lab: { has: boolean; lec: number; lab: number };
}) {
  const [whatIf, setWhatIf] = useState(false);
  const [wif, setWif] = useState<Record<string, number>>({});

  /* What-if runs through the same engine as the normal view: an edited category's graded list becomes
     [the typed average]; untouched categories keep their real entries at full precision, and an
     untouched ungraded one stays ungraded (it doesn't count). So with no edits, every period value and
     the final grade equal the normal view exactly, in either final mode. */
  const wifPeriods = useMemo(() => (!whatIf ? periods : periods.map(p => ({
    ...p, categories: p.categories.map(c => (c.key in wif ? { ...c, graded: [wif[c.key]] } : c)),
  }))), [periods, whatIf, wif]);
  const wifProj = useMemo(() => (!whatIf ? projections : wifPeriods.map(projectPeriod)), [whatIf, wifPeriods, projections]);
  const periodValues = wifProj.map(p => p.current);
  const shownFinal = !whatIf ? finalGrade : subjectFinal(wifPeriods, finalMode, finalPeriodKey);
  /* Hint for an empty input: the period's current, else the mean of graded periods. Display only. */
  const graded = projections.map(p => p.current).filter((v): v is number => v !== null);
  const fallback = graded.length ? graded.reduce((s, v) => s + v, 0) / graded.length : null;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const editWif = (key: string, raw: string) => setWif(prev => {
    const next = { ...prev };
    if (raw.trim() === '') delete next[key];
    else next[key] = Math.min(100, Math.max(0, parseFloat(raw) || 0));
    return next;
  });

  return (
    <section className="sp-panel sp-sum" aria-label="Grade summary">
      <div className="sp-sum__head">
        <h2 className="sp-sum__title"><Calculator size={17} className="sp-tone-muted" aria-hidden /> Grade summary
          {transmutationOn && <span className="sp-chip sp-chip--blue">transmuted</span>}
          {whatIf && <span className="sp-chip sp-chip--pink">what if</span>}
        </h2>
        {whatIf && <button type="button" className="sp-btn sp-btn--quiet sp-focus-ring" onClick={() => setWif({})}><RotateCcw size={14} /> Reset</button>}
        <button type="button" aria-pressed={whatIf} className={`sp-btn ${whatIf ? 'sp-btn--dark' : 'sp-btn--ghost'} sp-focus-ring`} onClick={() => { setWhatIf(v => !v); setWif({}); }}>
          {whatIf ? 'Exit what-if' : 'What if?'}
        </button>
      </div>
      {whatIf && <p className="sp-sum__note sp-sum__note--lead">Adjust category averages. Empty fields are ungraded and don&apos;t count until you type a value. Weights stay fixed and nothing is saved. For item-by-item planning, use the Target planner.</p>}

      <div className="sp-sum__grid sp-num">
        {periods.map((p, pi) => {
          const v = periodValues[pi];
          return (
            <div key={p.key} className="sp-item sp-sum__col">
              <div className="sp-eyebrow sp-sum__colhead">{p.name}{finalPeriodKey === p.key && <> <Flag size={11} aria-hidden /></>}</div>
              <div className={`sp-sum__big ${TONE[gradeTone(v)]}`}>{v === null ? '—' : dp(v)}</div>
              <div className={`sp-sum__lt ${TONE[gradeTone(v)]}`}>{letterLine(v, scale) || (v === null ? 'No grades yet' : '')}</div>
              <div className="sp-sum__rows">
                {p.categories.map(c => {
                  const stats = projections[pi].categories.find(x => x.key === c.key);
                  const avg = stats?.avg ?? null;
                  const gw = gradedWeight(projections[pi].categories);
                  const hint = projections[pi].current ?? fallback;
                  return (
                    <div key={c.key} className="sp-sum__row">
                      <span><b>{c.name}</b><small>{c.weight}%</small></span>
                      {whatIf ? (
                        <input className="sp-input sp-input--sm" type="number" min={0} max={100} step={0.5} aria-label={`${c.name} average`}
                          value={c.key in wif ? wif[c.key] : avg === null ? '' : r1(avg)}
                          placeholder={hint === null ? '—' : String(r1(hint))}
                          onChange={e => editWif(c.key, e.target.value)} />
                      ) : (
                        <span className="sp-sum__val">
                          <b className={TONE[gradeTone(avg)]}>{avg === null || !stats ? '—' : contribution(stats, gw).toFixed(2)}</b>
                          <small>{avg === null ? 'not graded' : dp(avg)}</small>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {finalMode === 'average' && (
        <div className="sp-sum__final sp-num">
          <span className="sp-tone-muted sp-sum__final-label"><Flag size={14} aria-hidden /> Final grade · average of periods</span>
          <span><b className={`sp-sum__final-val ${TONE[gradeTone(shownFinal)]}`}>{shownFinal === null ? '—' : dp(shownFinal)}</b> <span className="sp-tone-muted">{letterLine(shownFinal, scale)}</span></span>
        </div>
      )}
      {lab.has && <p className="sp-sum__note">Lab subject: overall = Lecture × {lab.lec}% + Lab × {lab.lab}%</p>}
    </section>
  );
}

/** Legacy subjects: Finals / Midterm views from the projection engine, plus the old editable what-if. */
export function LegacyGradeSummary({ overall, overallProj, transmutationOn }: {
  overall: PeriodInput; overallProj: PeriodProjection; transmutationOn: boolean;
}) {
  type Mode = 'finals' | 'midterm' | 'whatif';
  const [mode, setMode] = useState<Mode>('finals');
  const midProj = useMemo(() => projectPeriod(legacyMidtermPeriod(overall)), [overall]);
  /* What-if seeds come from the view the user switched from. An ungraded category stands in at that
     view's current grade, so the seeded rows reproduce it exactly (weights sum to 100). Seeds keep full
     precision for the math; inputs show them rounded until edited. Until any row is edited, the total
     IS that view's current, so entering what-if never moves the number. */
  type From = 'finals' | 'midterm';
  type Row = { label: string; weight: number; grade: number; edited: boolean; gradeEdited: boolean };
  const seedFor = (from: From): Row[] => {
    const p = from === 'midterm' ? midProj : overallProj;
    const v = (key: string) => p.categories.find(c => c.key === key)?.avg ?? p.current ?? 0;
    const exams = from === 'midterm' ? v('legacy-midterm') : (15 * v('legacy-midterm') + 25 * v('legacy-final')) / 40;
    return [
      { label: 'Activities', weight: 24, grade: v('legacy-activities'), edited: false, gradeEdited: false },
      { label: 'Quizzes', weight: 36, grade: v('legacy-quizzes'), edited: false, gradeEdited: false },
      { label: 'Exams', weight: 40, grade: exams, edited: false, gradeEdited: false },
    ];
  };
  const [from, setFrom] = useState<From>('finals');
  const [wif, setWif] = useState<Row[]>(() => seedFor('finals'));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const editRow = (i: number, patch: Partial<Row>) => setWif(prev => prev.map((x, j) => (j === i ? { ...x, ...patch, edited: true, gradeEdited: x.gradeEdited || 'grade' in patch } : x)));

  const proj = mode === 'midterm' ? midProj : overallProj;
  const total = mode !== 'whatif' ? proj.current
    : wif.some(r => r.edited) ? wif.reduce((s, r) => s + (r.grade * r.weight) / 100, 0)
    : (from === 'midterm' ? midProj : overallProj).current;
  const rows = mode === 'whatif' ? null : proj.categories;

  return (
    <section className="sp-panel sp-sum" aria-label="Grade summary">
      <div className="sp-sum__head">
        <h2 className="sp-sum__title"><Calculator size={17} className="sp-tone-muted" aria-hidden /> Grade summary {transmutationOn && <span className="sp-chip sp-chip--blue">transmuted</span>}</h2>
        <SpSegmented size="sm" label="Calculator view" value={mode} onChange={m => { if (m === 'whatif' && mode !== 'whatif') { setFrom(mode); setWif(seedFor(mode)); } setMode(m); }}
          options={[{ value: 'finals', label: 'Finals' }, { value: 'midterm', label: 'Midterm' }, { value: 'whatif', label: 'What if?' }]} />
      </div>
      <div className="sp-item sp-sum__col sp-sum__col--solo sp-num">
        <div className={`sp-sum__big ${TONE[gradeTone(total)]}`}>{total === null ? '—' : dp(total)}</div>
        <div className={`sp-sum__lt ${TONE[gradeTone(total)]}`}>{letterLine(total, '4pt') || 'No grades yet'}</div>
        <div className="sp-sum__rows">
          {rows ? rows.map(c => (
            <div key={c.key} className="sp-sum__row"><span><b>{c.name}</b><small>{c.weight}%</small></span>
              <span className="sp-sum__val"><b className={TONE[gradeTone(c.avg)]}>{c.avg === null ? '—' : contribution(c, gradedWeight(rows)).toFixed(2)}</b><small>{c.avg === null ? 'not graded' : dp(c.avg)}</small></span></div>
          )) : wif.map((r, i) => (
            <div key={r.label} className="sp-sum__row"><span><b>{r.label}</b>
              <small><input className="sp-input sp-input--sm" type="number" min={0} max={100} step={0.01} aria-label={`${r.label} weight`} value={r.weight}
                onChange={e => editRow(i, { weight: parseFloat(e.target.value) || 0 })} /></small></span>
              <input className="sp-input sp-input--sm" type="number" min={0} max={100} step={0.01} aria-label={`${r.label} grade`} value={r.gradeEdited ? r.grade : r1(r.grade)}
                onChange={e => editRow(i, { grade: parseFloat(e.target.value) || 0 })} /></div>
          ))}
        </div>
      </div>
      {mode !== 'whatif' && (
        <p className="sp-sum__note">{mode === 'finals' ? 'Finals: Activities 24% · Quizzes 36% · Midterm 15% + Final 25%' : 'Midterm: Activities 24% · Quizzes 36% · Midterm Exam 40%'}. Only graded work counts.</p>
      )}
    </section>
  );
}
