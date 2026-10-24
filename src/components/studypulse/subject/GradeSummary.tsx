'use client';

import { useMemo, useState } from 'react';
import { Calculator, Flag, RotateCcw } from 'lucide-react';
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';
import { projectPeriod, type CategoryStats, type PeriodInput, type PeriodProjection } from '@/lib/studypulse/projection';
import type { FinalMode } from '@/lib/studypulse/types';
import { legacyMidtermPeriod } from '@/lib/studypulse/periodModel';
import { fmtWeight, gradeInPct, periodPoints, pointsOf, whatIfOverrides, type WhatIfEdit } from '@/lib/studypulse/points';
import type { TransmutationTable } from '@/lib/transmutation';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import SpSegmented from '../ui/SpSegmented';
import InfoTip from '../ui/InfoTip';
import CategoryInfo from './CategoryInfo';

const TONE = { success: 'sp-tone-success', warn: 'sp-tone-warn', danger: 'sp-tone-danger', none: 'sp-tone-muted' } as const;
const letterLine = (v: number | null, scale: GradeScale | null) => (v !== null && scale ? (() => { const g = toGradeInfo(v, scale); return `${g.letter} · ${g.description}`; })() : '');
/* Period values and the final read at one decimal even when transmuted: they are weighted means, and the header
   tiles, period tabs, period chips and planner all show the same one-decimal number (T12 consistency check). */
const dp = (v: number) => f1(v);
type SumView = 'pct' | 'pts';
const VIEW_OPTIONS = [{ value: 'pct' as const, label: 'Percent' }, { value: 'pts' as const, label: 'Points' }];
const ENTER_OPTIONS = [{ value: 'pct' as const, label: 'Percent' }, { value: 'raw' as const, label: 'Raw score' }];

/** A category's value in the summary (spec §5.4): its average and the points it has earned out of its raw weight.
    Percent view leads with "80.0%" over "32.0 of 40 pts"; Points view leads with "32.0 / 40" over "80.0%". */
function PointsCell({ avg, weight, view }: { avg: number | null; weight: number; view: SumView }) {
  if (avg === null) return <span className="sp-sum__val"><b className="sp-sum__dash">—</b><small>not graded</small></span>;
  const pts = f1(pointsOf(avg, weight) as number), w = fmtWeight(weight), tone = TONE[gradeTone(avg)];
  return view === 'pct'
    ? <span className="sp-sum__val"><b className={tone}>{f1(avg)}%</b><small>{pts} of {w} pts</small></span>
    : <span className="sp-sum__val"><b className={tone}>{pts}<span className="sp-sum__of"> / {w}</span></b><small>{f1(avg)}%</small></span>;
}

/** The big period number with its "x of y pts earned" ⓘ. The tip sits outside the number's box, so the number stays
    centred in its column whether or not the tip is there. */
function PeriodBig({ name, value, cats }: { name: string; value: number | null; cats: Pick<CategoryStats, 'n' | 'weight' | 'avg'>[] }) {
  const pts = periodPoints(cats);
  return (
    <div className={`sp-sum__big ${TONE[gradeTone(value)]}`}>
      <span className="sp-sum__bignum">{value === null ? '—' : dp(value)}
        {value !== null && (
          <span className="sp-sum__bigtip">
            <InfoTip label={`About ${name}: points earned`}>
              <b>{f1(pts.earned)} of {fmtWeight(pts.gradedWeight)} pts earned</b> so far. {gradeInPct({ categories: cats })}% of this period&apos;s grade is in; ungraded categories don&apos;t count against you yet.
            </InfoTip>
          </span>
        )}
      </span>
    </div>
  );
}

const meanOf = (vs: (number | null)[]) => { const xs = vs.filter((v): v is number => v !== null); return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null; };

/** Custom-preset summary: per-period current (graded-only, spec D11) with a category breakdown and an optional what-if.
    Each category shows its average and the points it earned out of its raw weight (Percent · Points swaps which leads).
    With the 'average' final rule a Final grade column lists each period's grade and their mean; `view="final"` (the
    Final grade tab) shows that column alone. `combine` maps this subject's period values to the values the final view
    shows (lecture + lab combined); the period columns themselves stay this subject's own. */
export default function GradeSummary({ periods, projections, finalMode, finalPeriodKey, scale, transmutationOn, transTable, lab, view = 'all', combine }: {
  periods: PeriodInput[]; projections: PeriodProjection[];
  finalMode: FinalMode | null;
  /** The designated period's key under the 'period' rule (its card says "Final grade"); null otherwise. */
  finalPeriodKey: string | null;
  scale: GradeScale | null; transmutationOn: boolean;
  /** The table in force (null when Transmute is off): raw what-if scores are transmuted with it, like real entries. */
  transTable: TransmutationTable | null;
  lab: { has: boolean; lec: number; lab: number };
  view?: 'all' | 'final';
  combine?: ((own: (number | null)[]) => (number | null)[]) | null;
}) {
  const [sumView, setSumView] = useState<SumView>('pct');
  const [whatIf, setWhatIf] = useState(false);
  const [enterAs, setEnterAs] = useState<'pct' | 'raw'>('pct');
  /* What the user typed, per category: a percent, or a raw score / items pair. Kept as typed (full precision); the
     overrides are derived from it, so a raw pair re-transmutes if Transmute is toggled mid what-if. */
  const [edits, setEdits] = useState<Record<string, WhatIfEdit>>({});
  const wif = useMemo(() => whatIfOverrides(edits, transTable), [edits, transTable]);

  /* What-if runs through the same engine as the normal view: an edited category's graded list becomes
     [the typed average]; untouched categories keep their real entries at full precision, and an
     untouched ungraded one stays ungraded (it doesn't count). So with no edits, every period value and
     the final grade equal the normal view exactly, in either final mode. */
  const wifPeriods = useMemo(() => (!whatIf ? periods : periods.map(p => ({
    ...p, categories: p.categories.map(c => (c.key in wif ? { ...c, graded: [wif[c.key]] } : c)),
  }))), [periods, whatIf, wif]);
  const wifProj = useMemo(() => (!whatIf ? projections : wifPeriods.map(projectPeriod)), [whatIf, wifPeriods, projections]);
  const periodValues = wifProj.map(p => p.current);
  /* The final column: each period's grade (combined with the lab when linked) and their mean. With no edits this equals
     the header's Final grade tile exactly; in what-if it follows the typed values. */
  const finalValues = combine ? combine(periodValues) : periodValues;
  const shownFinal = meanOf(finalValues);
  const showFinal = finalMode === 'average';
  /* Overrides are per category: an earlier period's what-if does not reach a later period's reused/carried values. */
  const hasCarry = periods.some(p => p.categories.some(c => c.carried || c.reused));
  /* Hint for an empty input: the period's current, else the mean of graded periods. Display only. */
  const graded = projections.map(p => p.current).filter((v): v is number => v !== null);
  const fallback = graded.length ? graded.reduce((s, v) => s + v, 0) / graded.length : null;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const setEdit = (key: string, e: WhatIfEdit | null) => setEdits(prev => {
    const next = { ...prev };
    if (e) next[key] = e; else delete next[key];
    return next;
  });
  const editRaw = (key: string, field: 'score' | 'items', v: string) => setEdits(prev => {
    const cur = prev[key];
    const pair = { ...(cur?.kind === 'raw' ? { score: cur.score, items: cur.items } : { score: '', items: '' }), [field]: v };
    const next = { ...prev };
    if (pair.score.trim() === '' && pair.items.trim() === '') delete next[key]; else next[key] = { kind: 'raw', ...pair };
    return next;
  });
  const toggleWhatIf = () => { setWhatIf(v => !v); setEdits({}); };

  return (
    <section className="sp-panel sp-sum" aria-label="Grade summary">
      <div className="sp-sum__head">
        <h2 className="sp-sum__title"><Calculator size={17} className="sp-tone-muted" aria-hidden /> Grade summary
          {transmutationOn && <span className="sp-chip sp-chip--blue">transmuted</span>}
          {whatIf && <span className="sp-chip sp-chip--pink">what if</span>}
        </h2>
        {/* The category rows (so the toggle and the what-if inputs) live in the period columns. The final view still
            shows a running what-if (chip + values) and keeps Exit, so it can always be left from here. What-if rows
            show both units under their input, so the toggle steps aside while one runs. */}
        {view === 'all' && !whatIf && <SpSegmented size="sm" label="Show categories as" value={sumView} onChange={setSumView} options={VIEW_OPTIONS} />}
        {whatIf && view === 'all' && <button type="button" className="sp-btn sp-btn--quiet sp-focus-ring" onClick={() => setEdits({})}><RotateCcw size={14} /> Reset</button>}
        {(view === 'all' || whatIf) && (
          <button type="button" aria-pressed={whatIf} className={`sp-btn ${whatIf ? 'sp-btn--dark' : 'sp-btn--ghost'} sp-focus-ring`} onClick={toggleWhatIf}>
            {whatIf ? 'Exit what-if' : 'What if?'}
          </button>
        )}
      </div>
      {whatIf && view === 'all' && (
        <div className="sp-sum__wifbar">
          <span className="sp-sum__wiflabel" aria-hidden>Enter as</span>
          <SpSegmented size="sm" label="Enter what-if values as" value={enterAs} onChange={setEnterAs} options={ENTER_OPTIONS} />
          <p className="sp-sum__note sp-sum__note--inline">
            {enterAs === 'pct' ? 'Type a category average.' : `Type a score out of its items${transTable ? '; it is transmuted like your entries' : ''}.`}{' '}
            Untouched fields keep your real grades, and an ungraded category doesn&apos;t count until you type a value. Weights stay fixed and nothing is saved. For item-by-item planning, use the Target planner.
          </p>
          {hasCarry && <p className="sp-sum__note sp-sum__note--inline">Reused and carried scores in later periods use your real grades.</p>}
        </div>
      )}

      <div className={`sp-sum__grid sp-num${view === 'final' ? ' sp-sum__grid--final' : ''}`}>
        {view === 'all' && periods.map((p, pi) => {
          const v = periodValues[pi];
          const proj = wifProj[pi];
          const hint = projections[pi].current ?? fallback;
          return (
            <div key={p.key} className="sp-item sp-sum__col">
              <div className="sp-eyebrow sp-sum__colhead">{p.name}{finalPeriodKey === p.key && <> · <span className="sp-sum__fg">Final grade</span></>}</div>
              <PeriodBig name={p.name} value={v} cats={proj.categories} />
              <div className={`sp-sum__lt ${TONE[gradeTone(v)]}`}>{letterLine(v, scale) || (v === null ? 'No grades yet' : '')}</div>
              <div className="sp-sum__rows">
                {p.categories.map(c => {
                  const avg = proj.categories.find(x => x.key === c.key)?.avg ?? null;
                  const realAvg = projections[pi].categories.find(x => x.key === c.key)?.avg ?? null;
                  const e = edits[c.key];
                  return (
                    <div key={c.key} className="sp-sum__row">
                      <span className="sp-sum__name"><b>{c.name}</b><CategoryInfo cat={c} /><small>{fmtWeight(c.weight)}%</small></span>
                      {whatIf ? (
                        <span className="sp-sum__val">
                          {enterAs === 'pct' ? (
                            <span className="sp-sum__in">
                              <input className="sp-input sp-input--sm" type="number" inputMode="decimal" min={0} max={100} step="any" aria-label={`What-if ${p.name} ${c.name} average, percent`}
                                value={e?.kind === 'pct' ? e.text : c.key in wif ? r1(wif[c.key]) : realAvg === null ? '' : r1(realAvg)}
                                placeholder={hint === null ? '—' : String(r1(hint))}
                                onChange={ev => setEdit(c.key, ev.target.value.trim() === '' ? null : { kind: 'pct', text: ev.target.value })} />
                              <span aria-hidden>%</span>
                            </span>
                          ) : (
                            <span className="sp-sum__in">
                              <input className="sp-input sp-input--sm sp-sum__raw" type="number" inputMode="decimal" min={0} step="any" aria-label={`What-if ${p.name} ${c.name} score`}
                                value={e?.kind === 'raw' ? e.score : ''} placeholder="score" onChange={ev => editRaw(c.key, 'score', ev.target.value)} />
                              <span aria-hidden>/</span>
                              <input className="sp-input sp-input--sm sp-sum__raw" type="number" inputMode="decimal" min={0} step="any" aria-label={`What-if ${p.name} ${c.name} items`}
                                value={e?.kind === 'raw' ? e.items : ''} placeholder="items" onChange={ev => editRaw(c.key, 'items', ev.target.value)} />
                            </span>
                          )}
                          <small>{avg === null ? 'not graded' : `${f1(avg)}% · ${f1(pointsOf(avg, c.weight) as number)} of ${fmtWeight(c.weight)} pts`}</small>
                        </span>
                      ) : <PointsCell avg={avg} weight={c.weight} view={sumView} />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {showFinal && (
          <div className="sp-item sp-sum__col sp-sum__col--final">
            <div className="sp-eyebrow sp-sum__colhead"><Flag size={11} aria-hidden /> Final grade · average of periods</div>
            <div className={`sp-sum__big ${TONE[gradeTone(shownFinal)]}`}>{shownFinal === null ? '—' : dp(shownFinal)}</div>
            <div className={`sp-sum__lt ${TONE[gradeTone(shownFinal)]}`}>{letterLine(shownFinal, scale) || (shownFinal === null ? 'No grades yet' : '')}</div>
            <div className="sp-sum__rows">
              {periods.map((p, pi) => (
                <div key={p.key} className="sp-sum__row">
                  <span className="sp-sum__name"><b>{p.name}</b>{combine && <small>lecture + lab</small>}</span>
                  <span className="sp-sum__val"><b className={TONE[gradeTone(finalValues[pi] ?? null)]}>{finalValues[pi] == null ? '—' : dp(finalValues[pi] as number)}</b>{finalValues[pi] == null && <small>not graded yet</small>}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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
  const [sumView, setSumView] = useState<SumView>('pct');
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
        {mode !== 'whatif' && <SpSegmented size="sm" label="Show categories as" value={sumView} onChange={setSumView} options={VIEW_OPTIONS} />}
      </div>
      <div className="sp-item sp-sum__col sp-sum__col--solo sp-num">
        {rows ? <PeriodBig name={mode === 'midterm' ? 'Midterm' : 'Finals'} value={total} cats={rows} />
          : <div className={`sp-sum__big ${TONE[gradeTone(total)]}`}>{total === null ? '—' : dp(total)}</div>}
        <div className={`sp-sum__lt ${TONE[gradeTone(total)]}`}>{letterLine(total, '4pt') || 'No grades yet'}</div>
        <div className="sp-sum__rows">
          {rows ? rows.map(c => (
            <div key={c.key} className="sp-sum__row"><span className="sp-sum__name"><b>{c.name}</b><small>{fmtWeight(c.weight)}%</small></span>
              <PointsCell avg={c.avg} weight={c.weight} view={sumView} /></div>
          )) : wif.map((r, i) => (
            <div key={r.label} className="sp-sum__row"><span className="sp-sum__name"><b>{r.label}</b>
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
