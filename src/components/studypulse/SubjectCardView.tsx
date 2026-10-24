'use client';

import { Suspense, useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GraduationCap } from 'lucide-react';
import GradingSetup, { type SavedInfo } from './grading/GradingSetup';
import TargetPlanner from './planner/TargetPlanner';
import { usePlannerPrefs } from './planner/usePlannerPrefs';
import CategorySection from './subject/CategorySection';
import type { EntryPersistence, EntryRowsUpdate } from './subject/EntryTable';
import SubjectHeader, { type HeaderTile } from './subject/SubjectHeader';
import SubjectToolbar from './subject/SubjectToolbar';
import PeriodTabs, { type PeriodSelection } from './subject/PeriodTabs';
import PeriodPanel from './subject/PeriodPanel';
import GradeSummary, { LegacyGradeSummary } from './subject/GradeSummary';
import LabSection from './subject/LabSection';
import { loadTransmutationTable, type TransmutationTable } from '@/lib/transmutation';
import type { GradeScale } from '@/lib/gradeScale';
import { buildCustomPeriods, buildLegacyPeriods, nounFor } from '@/lib/studypulse/periodModel';
import { normalizeFinalMode, projectPeriod, type PeriodInput } from '@/lib/studypulse/projection';
import { combinePeriods, overallOfCurrents } from '@/lib/studypulse/labLink';
import { categoryColor } from '@/lib/studypulse/ui/colors';

/* ── Types ── */

import type { EntryRow, FinalMode, GradingConfig } from '@/lib/studypulse/types';
export type { EntryRow, GradingConfig, Urgency, EntryStatus } from '@/lib/studypulse/types';

/** This subject's lecture/lab link, loaded by the page (spec §3.5). `partnerCurrents` are the partner's raw period
    grades in period order; `lectureFinal` is the lecture's final rule, which a lab page follows so both pages agree. */
export interface LabLinkData {
  role: 'lecture' | 'lab';
  partner: { id: number; code: string; name: string };
  lectureWeight: number;
  units: number | null;
  periodsMatch: boolean;
  partnerCurrents: (number | null)[];
  lectureFinal: { mode: FinalMode | null; periodIndex: number | null } | null;
}
export type GradeMode   = 'finals' | 'midterm' | 'whatif';
export type SectionType = 'activities' | 'quizzes' | 'exams';

/** This subject's grade entries grouped by cat_id, re-read after the setup sheet moved entries between categories.
    Same row shape the page builds (canvas_linked is not in this route's rows; the caller carries it over by id). */
async function fetchCatEntries(userSubjectId: number): Promise<Record<number, EntryRow[]> | null> {
  try {
    const res = await fetch(`/api/studypulse/grade-entries?subject_id=${userSubjectId}`);
    if (!res.ok) return null;
    const { entries } = await res.json() as { entries: Array<Record<string, unknown>> };
    const out: Record<number, EntryRow[]> = {};
    const day = (v: unknown) => (v ? String(v).split('T')[0] : '');
    for (const e of entries) {
      (out[Number(e.cat_id)] ??= []).push({
        id: Number(e.entry_id), name: String(e.name ?? ''), specificType: '',
        urgency: (e.urgency as EntryRow['urgency']) ?? 'Low', status: (e.status as EntryRow['status']) ?? 'Pending',
        deadline: day(e.deadline), accomplished_at: day(e.accomplished_at),
        score: e.score != null ? String(e.score) : '', items: e.items != null ? String(e.items) : '',
        grade: e.grade != null ? Number(e.grade) : null, canvas_linked: false,
      });
    }
    return out;
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════
   SubjectCardView — main export
═══════════════════════════════════════════ */

interface Props {
  subject: {
    subject_name: string;
    course_code:  string;
    section?:     string | null;
    units:        number;
    year_level:   string;
    trimester:    string;
  };
  userSubjectId:       number;
  initialActivities?:  EntryRow[];
  initialQuizzes?:     EntryRow[];
  initialExams?:       EntryRow[];
  gradingConfig?:      GradingConfig | null;
  initialGradeEntries?: Record<number, EntryRow[]>;
  existingPresets?:    Array<{ preset_id: number; name: string; period_count: number }>;
  labLink?:            LabLinkData | null;
}

/* The inner component calls useSearchParams() (to detect the ?new=1 signal a
   just-created subject is linked with), which Next requires to sit inside a
   <Suspense> boundary. Self-wrap here — same shape as CanvasClientShell — so the
   server-component page can keep rendering <SubjectCardView> unchanged. */
export default function SubjectCardView(props: Props) {
  return (
    <Suspense fallback={<div className="vb-bg sp-page" />}>
      <SubjectCardViewInner {...props} />
    </Suspense>
  );
}

function SubjectCardViewInner({
  subject, userSubjectId,
  initialActivities = [], initialQuizzes = [], initialExams = [],
  gradingConfig: initialConfig = null,
  initialGradeEntries = {},
  existingPresets = [],
  labLink = null,
}: Props) {
  const [activities, setActivities] = useState<EntryRow[]>(initialActivities);
  const [quizzes,    setQuizzes]    = useState<EntryRow[]>(initialQuizzes);
  const [exams,      setExams]      = useState<EntryRow[]>(initialExams);
  const [config,     setConfig]     = useState<GradingConfig | null>(initialConfig);
  const [showSetup, setShowSetup] = useState(false);

  /* ── Auto-open the grading setup for a just-created subject ──
     Both creation paths (manual add on the subjects grid, and Canvas "Create
     Subject") land here with ?new=1. Fire once on mount, then strip the param so
     a refresh — or any later visit to this subject — doesn't re-open the setup.
     The param is dropped with history.replaceState rather than router.replace:
     it's a pure URL-bar rewrite with no Next navigation, no re-render and no RSC
     re-fetch, so it can't disturb the setup we just opened in the same effect. */
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    setShowSetup(true);
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete('new');
    const qs = rest.toString();
    window.history.replaceState(null, '', `/studypulse/${userSubjectId}${qs ? `?${qs}` : ''}`);
  // Mount-only: the ?new=1 signal is consumed exactly once per fresh-creation visit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* catId → current entries — the single source of truth for every custom category section */
  const [catEntries, setCatEntries] = useState<Record<number, EntryRow[]>>(() => {
    if (!initialConfig) return {};
    const init: Record<number, EntryRow[]> = {};
    for (const period of initialConfig.preset.periods) {
      for (const cat of period.categories) {
        init[cat.cat_id] = initialGradeEntries[cat.cat_id] ?? [];
      }
    }
    return init;
  });

  /* Updaters resolve against the category's latest rows, so an async save never writes back a stale list. */
  const handleCatEntriesChange = useCallback((catId: number, update: EntryRowsUpdate) => {
    setCatEntries(prev => ({ ...prev, [catId]: typeof update === 'function' ? update(prev[catId] ?? []) : update }));
  }, []);

  /* Persistence for the category sections — the exact requests the old entry sections made. */
  const customPersistence = useCallback((catId: number, periodId: number): EntryPersistence => ({
    save: async (row, doneAt) => {
      const res = await fetch('/api/studypulse/grade-entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_id: row.id || null, user_subject_id: userSubjectId, cat_id: catId, period_id: periodId, is_lab: 0,
          name: row.name.trim(), urgency: row.urgency, status: row.status, deadline: row.deadline,
          score: row.score || null, items: row.items || null, grade: row.grade, accomplished_at: doneAt,
        }),
      });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error ?? 'Save failed');
      return data.entry_id as number;
    },
    remove: async row => {
      const res = await fetch(`/api/studypulse/grade-entries/${row.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
    },
  }), [userSubjectId]);

  const legacyPersistence = useCallback((type: SectionType): EntryPersistence => ({
    save: async (row, doneAt) => {
      const res = await fetch('/api/studypulse/entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, entry_id: row.id || null, user_subject_id: userSubjectId, name: row.name.trim(), specific_type: row.specificType,
          urgency: row.urgency, status: row.status, deadline: row.deadline, score: row.score || null,
          items: row.items || null, grade: row.grade, accomplished_at: doneAt,
        }),
      });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error ?? 'Save failed');
      return data.entry_id as number;
    },
    remove: async row => {
      const res = await fetch(`/api/studypulse/entries/${row.id}?type=${type}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
    },
  }), [userSubjectId]);

  /* ── Target grade planner ── */
  const [plannerOpen, setPlannerOpen] = useState(false);
  const { prefs, setTarget, setExtra, saveError, retry } = usePlannerPrefs(userSubjectId);

  /* ── Period tabs: one period, or every period ("Both"/"All"). Back to "all"
     whenever the active preset changes (including right after the setup sheet saves). ── */
  const [periodSel, setPeriodSel] = useState<PeriodSelection>('all');
  useEffect(() => { setPeriodSel('all'); }, [config?.preset_id]);

  /* ── Transmutation state ── */
  const [transmutationOn, setTransmutationOn] = useState(false);
  const [transTable,      setTransTable]      = useState<TransmutationTable | null>(null);
  const [transError,      setTransError]      = useState<string | null>(null);
  const [transLoading,    setTransLoading]    = useState(false);

  const handleTransToggle = async () => {
    if (transmutationOn) { setTransmutationOn(false); return; }
    if (transTable) { setTransmutationOn(true); return; }
    setTransLoading(true);
    setTransError(null);
    try {
      const t = await loadTransmutationTable();
      setTransTable(t);
      setTransmutationOn(true);
    } catch (e) {
      setTransError((e as Error).message);
    } finally {
      setTransLoading(false);
    }
  };

  /* This subject's entry count per category, so the setup sheet knows which removed categories need a home. */
  const entryCounts = useMemo(() => {
    const out: Record<number, number> = {};
    for (const [id, rows] of Object.entries(catEntries)) {
      const n = rows.filter(r => r.id > 0).length;
      if (n) out[Number(id)] = n;
    }
    return out;
  }, [catEntries]);

  /* The setup sheet saved (it already re-read the config via GET subjects/[id]/grading). Rows already loaded stay
     with every category that survived (edits keep cat_ids); after a copy or a map the entries changed category, so
     they are fetched again. Either way the server components are refreshed. */
  const router = useRouter();
  const handleSetupSaved = useCallback(async (newConfig: GradingConfig | null, info: SavedInfo) => {
    if (newConfig) {
      setConfig(newConfig);
      const fresh = info.entriesMoved ? await fetchCatEntries(userSubjectId) : null;
      setCatEntries(prev => {
        const byId = new Map(Object.values(prev).flat().map(r => [r.id, r]));
        const init: Record<number, EntryRow[]> = {};
        for (const p of newConfig.preset.periods) {
          for (const c of p.categories) {
            init[c.cat_id] = fresh
              ? (fresh[c.cat_id] ?? []).map(r => ({ ...r, canvas_linked: byId.get(r.id)?.canvas_linked ?? r.canvas_linked }))
              : prev[c.cat_id] ?? [];
          }
        }
        return init;
      });
    }
    if (info.entriesMoved || info.labChanged) router.refresh();
  }, [router, userSubjectId]);

  const isCustomMode   = config !== null;
  const totalLegacy    = activities.length + quizzes.length + exams.length;

  /* ── Period model + projection: one source for the header tiles, the period
     tabs and the period chips. `current` is graded-only (spec D11): an ungraded
     category no longer counts as 100. ── */
  const projTable = transmutationOn ? transTable : null;
  const periods = useMemo<PeriodInput[]>(() => (config
    ? buildCustomPeriods(config.preset, catEntries, prefs, projTable)
    : buildLegacyPeriods(activities, quizzes, exams, prefs, projTable)
  ), [config, catEntries, activities, quizzes, exams, prefs, projTable]);
  const projections = useMemo(() => periods.map(projectPeriod), [periods]);
  /* Normalised again here: a preset saved by the old wizard can still carry 'collective'. */
  const finalMode = normalizeFinalMode(config?.preset.final_mode);
  const finalPeriodId = config?.preset.final_period_id ?? null;
  const scale: GradeScale | null = config ? config.grade_scale : '4pt';

  /* ── Linked lab (spec §3.5): the header tiles, the period tabs and the final view show lecture + lab combined per
     period. The period panels, the summary's period columns and the entry tables stay this subject's own. Nothing is
     combined when the period names stopped matching. ── */
  const ownCurrents = projections.map(p => p.current);
  const linked = config && labLink?.periodsMatch && labLink.partnerCurrents.length === ownCurrents.length ? labLink : null;
  const combine = linked
    ? (own: (number | null)[]) => (linked.role === 'lecture'
      ? combinePeriods(own, linked.partnerCurrents, linked.lectureWeight)
      : combinePeriods(linked.partnerCurrents, own, linked.lectureWeight))
    : null;
  const shown = combine ? combine(ownCurrents) : ownCurrents;

  /* ── The final rule: this preset's, except that a linked lab follows its lecture's (as the subject cards do). ── */
  const ownFinalIdx = config && finalPeriodId !== null ? config.preset.periods.findIndex(p => p.period_id === finalPeriodId) : -1;
  const rule = linked?.role === 'lab' && linked.lectureFinal
    ? linked.lectureFinal
    : { mode: finalMode, periodIndex: ownFinalIdx >= 0 ? ownFinalIdx : null };
  const finalIdx = rule.mode === 'period' ? rule.periodIndex : null;
  const finalKey = finalIdx !== null ? periods[finalIdx]?.key ?? null : null;
  const shownFinal = config && rule.mode ? overallOfCurrents(shown, periods.map(p => p.key), rule.mode, finalKey) : null;
  const averageRule = !!config && rule.mode === 'average';

  // The reset effect above lands a render late; derive too, so a stale selection never renders an empty page.
  const sel: PeriodSelection = periodSel === 'final'
    ? (averageRule ? 'final' : 'all')
    : periodSel !== 'all' && config?.preset.periods.some(p => p.period_id === periodSel) ? periodSel : 'all';

  /* 'period' rule: no extra tile, a "Final grade" tag on the designated period's tile. 'average': a Final grade tile. */
  const tiles: HeaderTile[] = config
    ? [
        ...config.preset.periods.map((p, i) => ({ key: `p${p.period_id}`, label: p.name, value: shown[i] ?? null, finalTag: i === finalIdx })),
        ...(averageRule ? [{ key: 'final', label: 'Final grade', value: shownFinal, final: true }] : []),
      ]
    : [{ key: 'overall', label: 'Overall', value: projections[0]?.current ?? null }];

  return (
    <div className="vb-bg sp-page">
      <div className="sp-wrap">
        {showSetup && (
          <GradingSetup
            userSubjectId={userSubjectId}
            config={config}
            existingPresets={existingPresets}
            entryCounts={entryCounts}
            onSaved={handleSetupSaved}
            onClose={() => setShowSetup(false)}
          />
        )}

        <SubjectHeader subject={subject} presetName={config?.preset.name ?? null} tiles={tiles} scale={scale} transError={transError}
          lab={config && labLink ? { role: labLink.role, partnerId: labLink.partner.id, partnerCode: labLink.partner.code, partnerName: labLink.partner.name, lectureWeight: labLink.lectureWeight } : null} />
        <SubjectToolbar
          tabs={isCustomMode ? (
            <PeriodTabs value={sel} onChange={setPeriodSel} final={averageRule ? { current: shownFinal } : null}
              periods={config.preset.periods.map((p, i) => ({ id: p.period_id, name: p.name, current: shown[i] ?? null }))} />
          ) : undefined}
          transmutationOn={transmutationOn} transLoading={transLoading} transError={transError} onToggleTrans={handleTransToggle}
          plannerOpen={plannerOpen} onTogglePlanner={() => setPlannerOpen(v => !v)}
          isCustom={isCustomMode} onGrading={() => setShowSetup(true)} userSubjectId={userSubjectId} />

        {/* ── Target planner: always mounted so it can animate open and closed ── */}
        <TargetPlanner open={plannerOpen} periods={periods} projections={projections} scale={scale} transmutationOn={transmutationOn}
          onClose={() => setPlannerOpen(false)} onTarget={setTarget} onExtra={setExtra} saveError={saveError} onRetry={retry} />

        {/* ── Custom grading mode. Every period panel stays mounted and the unselected ones are `hidden`
             (display: none, so nothing inside is focusable): a row being edited keeps its Save/Cancel state
             and snapshot across tab switches, and collapse state survives too. ── */}
        {isCustomMode && (
          <>
            {config.preset.periods.map((period, pi) => (
              <PeriodPanel key={period.period_id} period={periods[pi]} proj={projections[pi]} isFinal={pi === finalIdx}
                hidden={sel === 'final' || (sel !== 'all' && sel !== period.period_id)}>
                {period.categories.map((cat, ci) => {
                  return (
                    <CategorySection
                      key={cat.cat_id}
                      name={cat.name}
                      weight={Number(cat.weight)}
                      color={categoryColor(ci)}
                      noun={cat.is_singleton === 1 ? cat.name : nounFor(cat.name)}
                      singleton={cat.is_singleton === 1}
                      entries={catEntries[cat.cat_id] ?? []}
                      onChange={rows => handleCatEntriesChange(cat.cat_id, rows)}
                      persistence={customPersistence(cat.cat_id, period.period_id)}
                      transTable={transTable}
                      transmutationOn={transmutationOn}
                      model={periods[pi]?.categories[ci] ?? null}
                    />
                  );
                })}
              </PeriodPanel>
            ))}
            {labLink && (
              <LabSection role={labLink.role} partner={labLink.partner} lectureWeight={labLink.lectureWeight} units={labLink.units}
                matched={!!linked}
                rows={periods.map((p, i) => {
                  const other = labLink.partnerCurrents[i] ?? null;
                  return {
                    key: p.key, name: p.name, combined: shown[i] ?? null,
                    lecture: labLink.role === 'lecture' ? ownCurrents[i] : other,
                    lab: labLink.role === 'lab' ? ownCurrents[i] : other,
                  };
                })} />
            )}
            <GradeSummary periods={periods} projections={projections} finalMode={rule.mode}
              finalPeriodKey={finalKey} scale={scale} transmutationOn={transmutationOn}
              lab={{ has: config.has_lab === 1, lec: config.lec_weight, lab: config.lab_weight }}
              view={sel === 'final' ? 'final' : 'all'} combine={combine} />
          </>
        )}

        {/* ── Legacy mode ── */}
        {!isCustomMode && (
          <>
            {totalLegacy === 0 && !showSetup && (
              <div className="sp-panel sp-legacy-empty">
                <p className="sp-tone-muted">No entries yet. Set up a custom grading system, or use the default layout below.</p>
                <button type="button" className="sp-btn sp-btn--primary sp-focus-ring" onClick={() => setShowSetup(true)}><GraduationCap size={16} /> Set up grading system</button>
              </div>
            )}
            <div className="sp-panel sp-legacy-panel">
              <CategorySection name="Activities" weight={24} color={categoryColor(0)} noun="Activity" singleton={false}
                entries={activities} onChange={setActivities} persistence={legacyPersistence('activities')}
                typeColumn={{ kind: 'select', options: ['Seatwork', 'Performance Task', 'Take-Home Activity', 'Laboratory Activity', 'Technical Assessment'] }}
                defaultType="Seatwork" transTable={transTable} transmutationOn={transmutationOn} />
              <CategorySection name="Quizzes" weight={36} color={categoryColor(1)} noun="Quiz" singleton={false}
                entries={quizzes} onChange={setQuizzes} persistence={legacyPersistence('quizzes')}
                typeColumn={{ kind: 'index' }} transTable={transTable} transmutationOn={transmutationOn} />
              <CategorySection name="Exams" weight={40} color={categoryColor(2)} noun="Exam" singleton={false}
                entries={exams} onChange={setExams} persistence={legacyPersistence('exams')}
                typeColumn={{ kind: 'select', options: ['Midterm', 'Final Exam'] }}
                defaultType="Midterm" transTable={transTable} transmutationOn={transmutationOn} />
            </div>
            <LegacyGradeSummary overall={periods[0]} overallProj={projections[0]} transmutationOn={transmutationOn} />
          </>
        )}
      </div>
    </div>
  );
}
