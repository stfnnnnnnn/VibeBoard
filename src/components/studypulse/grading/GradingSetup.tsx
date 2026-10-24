'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, X } from 'lucide-react';
import type { GradingConfig } from '@/lib/studypulse/types';
import {
  blankDraft, deletedCategories, describeChanges, draftToPayload, feuTemplate, stepOfError, toDraft, validateDraft,
  type SetupDraft,
} from './draft';
import { api, loadConfig, type UsageSubject } from './api';
import ScaleStep from './ScaleStep';
import PeriodsStep from './PeriodsStep';
import FinalStep from './FinalStep';
import LabStep, { useLab } from './LabStep';
import ReviewStep, { type Scope, type SummaryItem } from './ReviewStep';
import ChoosePreset, { ModePicker, type EntryMode, type NewKind, type PresetOption } from './ChoosePreset';
import { useMoves } from './useMoves';
import { focusOrder, inertOthers, tabTarget } from './focusTrap';

const STEPS = ['Scale', 'Periods & categories', 'Final grade', 'Linked lab', 'Review'] as const;
const sig = (d: SetupDraft) => JSON.stringify(draftToPayload(d));

export interface SavedInfo { entriesMoved: boolean; labChanged: boolean }

/** The grading setup sheet (spec §4): a right-hand drawer (full screen on a phone) with three entry modes and a
    five-step editor. Saves through PUT /grading/[id] (edit), POST /grading + POST subjects/[id]/grading (new), or
    POST subjects/[id]/grading with a map (another system); the lab link saves separately afterwards. */
export default function GradingSetup({ userSubjectId, config, existingPresets, entryCounts, onSaved, onClose }: {
  userSubjectId: number;
  config: GradingConfig | null;
  existingPresets: PresetOption[];
  /** This subject's entries per cat_id. */
  entryCounts: Record<number, number>;
  onSaved: (config: GradingConfig | null, info: SavedInfo) => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState<GradingConfig | null>(config?.preset ? config : null);
  const others = existingPresets.filter(p => p.preset_id !== current?.preset_id);
  const [mode, setMode] = useState<EntryMode>(current ? 'edit' : 'new');
  const [newKind, setNewKind] = useState<NewKind>('feu');
  const [editDraft, setEditDraft] = useState<SetupDraft | null>(() => current ? toDraft(current.preset) : null);
  const [editBase, setEditBase] = useState(() => editDraft ? sig(editDraft) : '');
  const [newDraft, setNewDraft] = useState<SetupDraft>(feuTemplate);
  const [newBase, setNewBase] = useState(() => sig(newDraft));
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [visited, setVisited] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [usage, setUsage] = useState<UsageSubject[] | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  /** A control to focus after the next render, when the one that had focus is about to unmount. */
  const pendingFocus = useRef<'cancel' | 'next' | null>(null);

  const editing = mode === 'edit' && !!editDraft;
  const draft = editing ? editDraft! : newDraft;
  const setDraft = (d: SetupDraft) => (editing ? setEditDraft(d) : setNewDraft(d));
  const lab = useLab(userSubjectId, draft.periods.map(p => p.name.trim()));
  const moves = useMoves({ mode, current, draft, entryCounts, others });

  useEffect(() => {
    if (!current) return;
    let live = true;
    api<{ subjects: UsageSubject[] }>(`/api/studypulse/grading/${current.preset_id}/usage`)
      .then(r => { if (live && r.ok) setUsage(r.data.subjects); });
    return () => { live = false; };
  }, [current]);
  const shared = (usage?.length ?? 0) > 1;

  /* Modal behaviour. On open: focus the title, lock page scroll, make everything outside the sheet inert, and take
     Esc / Tab at the document (capture), so they work wherever focus is, even on <body> after a control unmounted.
     On close: undo all of it and return focus to the opener. */
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const undoInert = rootRef.current ? inertOthers(rootRef.current) : () => {};
    panelRef.current?.querySelector<HTMLElement>('#gs-title')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      undoInert();
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  /* After every render: a requested hand-off first, else if the focused control unmounted (focus fell to <body>),
     bring focus back to the title so the keyboard stays inside the sheet. */
  useEffect(() => {
    const want = pendingFocus.current === 'cancel' ? cancelRef.current : pendingFocus.current === 'next' ? nextRef.current : null;
    pendingFocus.current = null;
    if (want) { want.focus(); return; }
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.querySelector<HTMLElement>('#gs-title')?.focus({ preventScroll: true });
  });
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (wasConfirming.current) cancelRef.current?.focus(); // the bar's buttons are gone; Cancel sits where they were
    wasConfirming.current = confirming;
  }, [confirming]);

  const errors = useMemo(() => ({ ...validateDraft(draft), ...lab.errors }), [draft, lab.errors]);
  const gradingDirty = mode === 'new' || (editing && sig(editDraft!) !== editBase);
  const dirty = (editing && sig(editDraft!) !== editBase) || (mode === 'new' && sig(newDraft) !== newBase)
    || (mode === 'another' && moves.picked != null) || lab.dirty;

  const shown = (key: string) => {
    if (submitted || touched.has(key) || visited.has(stepOfError(key))) return true;
    const m = /^(p\d+)\.sum$/.exec(key);
    return !!m && [...touched].some(t => t.startsWith(`${m[1]}.`));
  };
  const touch = (key: string) => setTouched(t => (t.has(key) ? t : new Set(t).add(key)));
  const goStep = (s: number) => { setVisited(v => new Set(v).add(step)); setStep(s); if (s === 4) setSubmitted(true); };

  // "Use another system" saves no draft and no lab link, so only its entry map can block it.
  const problems: SummaryItem[] = [
    ...(mode === 'another' ? [] : Object.entries(errors))
      .map(([key, message]) => ({ key, message, step: stepOfError(key), stepName: STEPS[stepOfError(key)] })),
    ...(mode === 'another' && moves.picked == null ? [{ key: 'pick', message: 'Pick a grading system', step: 4, stepName: 'Review' }] : []),
    ...moves.problems.map(p => ({ ...p, step: 4, stepName: 'Review' })),
    ...(editing && shared && !scope ? [{ key: 'scope', message: 'Choose whether this applies to every subject or only this one', step: 4, stepName: 'Review' }] : []),
  ];
  const stepHasError = (s: number) => problems.some(p => p.step === s) && (submitted || visited.has(s));
  const nothingToSave = mode === 'edit' && !gradingDirty && !lab.dirty;
  const canSave = !saving && !moves.loading && problems.length === 0 && !nothingToSave;

  const requestClose = () => { if (saving) return; if (dirty) setConfirming(true); else onClose(); };
  keyRef.current = (e: KeyboardEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (confirming) setConfirming(false); else requestClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const order = focusOrder(panel, panel.querySelector<HTMLElement>('#gs-title'));
    const target = tabTarget<HTMLElement>(order, document.activeElement as HTMLElement | null, e.shiftKey);
    if (target) { e.preventDefault(); target.focus(); }
  };

  const switchMode = (m: EntryMode) => { setMode(m); setStep(0); setFormError(null); };
  const switchKind = (k: NewKind) => { const d = k === 'feu' ? feuTemplate() : blankDraft(); setNewKind(k); setNewDraft(d); setNewBase(sig(d)); };

  /** After the grading part saved: reload the config, tell the page, and re-base the sheet on what was saved. */
  const afterGradingSaved = async (entriesMoved: boolean) => {
    const cfg = await loadConfig(userSubjectId);
    onSaved(cfg, { entriesMoved, labChanged: false });
    setCurrent(cfg);
    if (cfg) { const d = toDraft(cfg.preset); setEditDraft(d); setEditBase(sig(d)); setMode('edit'); }
    moves.reset();
    return cfg;
  };

  const save = async () => {
    if (!canSave) { setSubmitted(true); return; }
    setSaving(true); setFormError(null);
    try {
      if (mode === 'another') {
        const r = await moves.saveAnother(userSubjectId);
        if (!r.ok) { setFormError(r.error); return; }
        await afterGradingSaved(r.moved);
        onClose();
        return;
      }
      let latest = current;
      if (gradingDirty) {
        const r = editing
          ? await moves.saveEdit(userSubjectId, current!.preset_id, draftToPayload(draft), shared ? scope! : 'all')
          : await moves.saveNew(userSubjectId, draft);
        if (!r.ok) { setFormError(r.error); setStep(4); return; }
        latest = await afterGradingSaved(r.moved);
      }
      if (lab.dirty) {
        const ok = await lab.save();
        if (!ok) { setStep(3); setVisited(v => new Set(v).add(3)); return; }
        onSaved(latest, { entriesMoved: false, labChanged: true });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const title = current ? current.preset.name : 'Set up grading';
  const usedBy = usage && usage.length ? ` · used by ${usage.length} subject${usage.length === 1 ? '' : 's'}` : '';
  const showSteps = mode !== 'another';

  return (
    <div ref={rootRef} className="sp-gs-root">
      <div className="sp-gs-scrim" aria-hidden onMouseDown={requestClose} />
      <div ref={panelRef} className="sp-gs" role="dialog" aria-modal="true" aria-labelledby="gs-title" tabIndex={-1}>
        <header className="sp-gs__head">
          <div className="sp-gs__titles">
            <h2 id="gs-title" tabIndex={-1}>Grading system</h2>
            <p className="sp-gs-note">{current ? <>{title}<span className="sp-num">{usedBy}</span></> : 'Choose how this subject is graded'}</p>
          </div>
          <button type="button" className="sp-icon-btn sp-focus-ring" aria-label="Close grading setup" onClick={requestClose}><X size={18} aria-hidden /></button>
        </header>
        <ModePicker mode={mode} onMode={switchMode} hasCurrent={!!current} hasOthers={others.length > 0} newKind={newKind} onNewKind={switchKind} />
        {showSteps && (
          <nav aria-label="Setup steps">
            <ol className="sp-gs-steps">
              {STEPS.map((s, i) => (
                <li key={s}>
                  <button type="button" className="sp-gs-step sp-focus-ring" aria-current={step === i ? 'step' : undefined} onClick={() => goStep(i)}>
                    <span className="sp-num">{i + 1}</span> {s}
                    {stepHasError(i) && <><span className="sp-gs-step__dot" aria-hidden /><span className="sp-sr-only">, has a problem</span></>}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="sp-gs__body">
          {mode === 'another' ? (
            <ChoosePreset presets={others} picked={moves.picked} onPick={moves.pick} loading={moves.loading}
              moves={moves.rows} choices={moves.choices} targets={moves.targets} onMove={moves.choose} error={formError} />
          ) : step === 0 ? <ScaleStep draft={draft} onChange={setDraft} errors={errors} shown={shown} onTouch={touch} />
            : step === 1 ? <PeriodsStep draft={draft} onChange={setDraft} errors={errors} shown={shown} onTouch={touch} />
              : step === 2 ? <FinalStep draft={draft} onChange={setDraft} errors={errors} />
                : step === 3 ? <LabStep lab={lab.lab} onChange={lab.setLab} role={lab.role} link={lab.link} subjects={lab.subjects}
                    check={lab.check} errors={lab.errors} serverError={lab.serverError} />
                  : <ReviewStep
                      intro={editing ? 'Saving changes this grading system in place. Entries in kept categories stay where they are.'
                        : `Creates “${draft.name.trim() || 'Untitled'}” and uses it for this subject.`}
                      changes={[
                        ...(editing ? describeChanges(current!.preset, draft) : draft.periods.map(p => `${p.name.trim() || 'Untitled period'}: ${p.categories.map(c => `${c.name.trim() || 'Untitled'} ${c.weight}%`).join(' · ')}`)),
                        ...(lab.dirty ? [lab.lab.on && lab.role !== 'lab' ? `Linked lab: ${lab.subjects?.find(s => s.user_subject_id === lab.lab.partner)?.course_code ?? 'subject'} (Lecture ${lab.lab.lecture}% · Lab ${100 - lab.lab.lecture}%)` : 'Lab link removed'] : []),
                      ]}
                      usage={editing ? usage : null} scope={scope} onScope={setScope}
                      moves={moves.rows} choices={moves.choices} targets={moves.targets} onMove={moves.choose}
                      mapTitle={editing ? 'Removed categories with entries' : 'Where this subject’s entries go'}
                      problems={problems} formError={formError}
                      onGo={(s, key) => { setStep(s); if (s !== 4) touch(key); }} />}
          {editing && step === 1 && deletedCategories(current!.preset, draft).length > 0 && (
            <p className="sp-gs-note sp-gs-note--warn">Removed categories keep their entries until you choose where they go in Review.</p>
          )}
        </div>
        <footer className="sp-gs__foot">
          {confirming ? (
            <div className="sp-gs-confirm" role="alertdialog" aria-labelledby="gs-discard">
              <span id="gs-discard">Discard your changes?</span>
              <button ref={keepRef} type="button" className="sp-btn sp-btn--ghost sp-focus-ring" onClick={() => setConfirming(false)}>Keep editing</button>
              <button type="button" className="sp-btn sp-btn--danger sp-focus-ring" onClick={onClose}>Discard</button>
            </div>
          ) : (
            <>
              <button ref={cancelRef} type="button" className="sp-btn sp-btn--quiet sp-focus-ring" onClick={requestClose} disabled={saving}>Cancel</button>
              <div className="sp-gs__foot-right">
                {showSteps && step > 0 && (
                  <button type="button" className="sp-btn sp-btn--ghost sp-focus-ring" onClick={() => { if (step === 1) pendingFocus.current = 'next'; goStep(step - 1); }}><ArrowLeft size={15} aria-hidden /> Back</button>
                )}
                {showSteps && step < 4 ? (
                  <button ref={nextRef} type="button" className="sp-btn sp-btn--primary sp-focus-ring" onClick={() => goStep(step + 1)}>Next <ArrowRight size={15} aria-hidden /></button>
                ) : (
                  <button type="button" className="sp-btn sp-btn--primary sp-focus-ring" onClick={save} disabled={!canSave} aria-busy={saving}>
                    {saving ? <Loader2 size={15} className="sp-spin" aria-hidden /> : <Check size={15} aria-hidden />}
                    {saving ? 'Saving' : mode === 'another' ? 'Switch system' : mode === 'new' ? 'Create and use' : 'Save changes'}
                  </button>
                )}
              </div>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
