'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import SpSegmented from '../ui/SpSegmented';
import { FieldError } from './CategoryRow';
import type { FieldErrors } from './draft';
import { api, loadConfig, type LabLink, type SubjectOption } from './api';
import { periodNamesMatch } from '@/lib/studypulse/labLink';

export interface LabState { on: boolean; partner: number | null; lecture: number }
/** PUT lab-link's 400 when the period names differ carries both lists. */
type LabPutReply = { lecture_periods?: string[]; lab_periods?: string[] };
export type PeriodCheck =
  | { kind: 'idle' } | { kind: 'checking' } | { kind: 'match' } | { kind: 'nosetup' }
  | { kind: 'mismatch'; lecture: string[]; lab: string[] };

/** Field errors for the lab step (keys start with "lab", so stepOfError puts them on step 4). */
export function labErrors(lab: LabState, role: LabLink['role'] | null, check: PeriodCheck): FieldErrors {
  const e: FieldErrors = {};
  if (!lab.on || role === 'lab') return e;
  if (lab.partner == null) e['lab.partner'] = 'Pick the lab subject';
  if (!Number.isInteger(lab.lecture) || lab.lecture < 1 || lab.lecture > 99) e['lab.weight'] = 'Use a whole number from 1 to 99';
  if (check.kind === 'mismatch') e['lab.periods'] = 'The two subjects need the same periods, in the same order';
  if (check.kind === 'nosetup') e['lab.periods'] = 'Set up grading on the lab subject first';
  return e;
}

/** Lab-link data for the sheet: the current link, the partner list, the period pre-check against the partner's
    setup, and save (PUT or DELETE). `periodNames` are this subject's draft period names. */
export function useLab(userSubjectId: number, periodNames: string[]) {
  const [link, setLink] = useState<LabLink | null>(null);
  const [initial, setInitial] = useState<LabState>({ on: false, partner: null, lecture: 70 });
  const [lab, setLabRaw] = useState<LabState>(initial);
  const [subjects, setSubjects] = useState<SubjectOption[] | null>(null);
  const [partner, setPartner] = useState<{ id: number; names: string[] | null } | null>(null);
  const [serverCheck, setServerCheck] = useState<PeriodCheck | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<{ link: LabLink | null }>(`/api/studypulse/subjects/${userSubjectId}/lab-link`).then(r => {
      if (!live || !r.ok || !r.data.link) return;
      const l = r.data.link;
      const s: LabState = { on: true, partner: l.role === 'lecture' ? l.partner_user_subject_id : null, lecture: l.lecture_weight };
      setLink(l); setInitial(s); setLabRaw(s);
    });
    api<SubjectOption[]>('/api/studypulse/subjects').then(r => {
      if (live && r.ok && Array.isArray(r.data)) setSubjects(r.data.filter(s => s.user_subject_id !== userSubjectId));
    });
    return () => { live = false; };
  }, [userSubjectId]);

  useEffect(() => {
    if (!lab.on || lab.partner == null || partner?.id === lab.partner) return;
    let live = true;
    const id = lab.partner;
    loadConfig(id).then(cfg => { if (live) setPartner({ id, names: cfg ? cfg.preset.periods.map(p => p.name) : null }); });
    return () => { live = false; };
  }, [lab.on, lab.partner, partner?.id]);

  const role = link?.role ?? null;
  const namesKey = JSON.stringify(periodNames);
  const check = useMemo<PeriodCheck>(() => {
    if (serverCheck) return serverCheck;
    if (!lab.on || lab.partner == null || role === 'lab') return { kind: 'idle' };
    if (partner?.id !== lab.partner) return { kind: 'checking' };
    if (!partner.names) return { kind: 'nosetup' };
    const mine = JSON.parse(namesKey) as string[];
    return periodNamesMatch(mine, partner.names) ? { kind: 'match' } : { kind: 'mismatch', lecture: mine, lab: partner.names };
  }, [serverCheck, lab.on, lab.partner, role, partner, namesKey]);

  const setLab = (l: LabState) => { setLabRaw(l); setServerCheck(null); setServerError(null); };
  const dirty = role === 'lab' ? lab.on !== initial.on : JSON.stringify(lab) !== JSON.stringify(initial);
  const errors = labErrors(lab, role, check);

  /** Saves the link if it changed. Resolves true on success (or nothing to do). */
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    const url = `/api/studypulse/subjects/${userSubjectId}/lab-link`;
    const r = lab.on && role !== 'lab'
      ? await api<LabPutReply>(url, 'PUT', { lab_user_subject_id: lab.partner, lecture_weight: lab.lecture })
      : await api<LabPutReply>(url, 'DELETE');
    if (r.ok) {
      setInitial(lab);
      if (!lab.on) setLink(null);
      return true;
    }
    if (r.status === 400 && r.data.lecture_periods && r.data.lab_periods) {
      setServerCheck({ kind: 'mismatch', lecture: r.data.lecture_periods, lab: r.data.lab_periods });
    }
    setServerError(r.data.error ?? 'Could not save the lab link');
    return false;
  };

  return { lab, setLab, link, role, subjects, check, errors, dirty, save, serverError };
}

function PeriodChip({ check }: { check: PeriodCheck }) {
  if (check.kind === 'checking') return <span className="sp-chip sp-chip--neutral"><Loader2 size={12} className="sp-spin" aria-hidden /> Checking periods</span>;
  if (check.kind === 'match') return <span className="sp-chip sp-chip--success"><Check size={12} strokeWidth={3} aria-hidden /> Periods match</span>;
  if (check.kind === 'mismatch') return <span className="sp-chip sp-chip--danger"><AlertTriangle size={12} aria-hidden /> Periods differ</span>;
  if (check.kind === 'nosetup') return <span className="sp-chip sp-chip--warn"><AlertTriangle size={12} aria-hidden /> No grading setup</span>;
  return null;
}

/** Step 4: link a separate lab subject; each period combines Lecture × w + Lab × (100 − w). */
export default function LabStep({ lab, onChange, role, link, subjects, check, errors, serverError }: {
  lab: LabState;
  onChange: (l: LabState) => void;
  role: LabLink['role'] | null;
  link: LabLink | null;
  subjects: SubjectOption[] | null;
  check: PeriodCheck;
  errors: FieldErrors;
  serverError: string | null;
}) {
  if (role === 'lab' && link) {
    return (
      <section className="sp-gs-sec sp-gs-sec--first" aria-labelledby="gs-lab-h">
        <div className="sp-gs-sec__t"><h3 id="gs-lab-h">Linked lab subject</h3></div>
        <p className="sp-gs-note">
          This subject is the lab of <b>{link.partner_code} · {link.partner_name}</b> (Lecture <span className="sp-num">{link.lecture_weight}</span>% ·
          Lab <span className="sp-num">{100 - link.lecture_weight}</span>%). Change the split from the lecture subject.
        </p>
        <SpSegmented<'keep' | 'unlink'> size="sm" label="Lab link" value={lab.on ? 'keep' : 'unlink'}
          options={[{ value: 'keep', label: 'Keep link' }, { value: 'unlink', label: 'Unlink' }]}
          onChange={v => onChange({ ...lab, on: v === 'keep' })} />
        {serverError && <FieldError id="gs-lab-srv">{serverError}</FieldError>}
      </section>
    );
  }
  const partnerName = subjects?.find(s => s.user_subject_id === lab.partner);
  return (
    <section className="sp-gs-sec sp-gs-sec--first" aria-labelledby="gs-lab-h">
      <div className="sp-gs-sec__t"><h3 id="gs-lab-h">Linked lab subject</h3></div>
      <div className="sp-gs-lab-row">
        <SpSegmented<'on' | 'off'> size="sm" label="Linked lab" value={lab.on ? 'on' : 'off'}
          options={[{ value: 'on', label: 'Linked' }, { value: 'off', label: 'No lab' }]}
          onChange={v => onChange({ ...lab, on: v === 'on' })} />
        {lab.on && (
          <>
            <label className="sp-sr-only" htmlFor="gs-lab-partner">Lab subject</label>
            <select id="gs-lab-partner" className="sp-input sp-input--sm sp-gs-select" value={lab.partner ?? ''}
              aria-invalid={!!errors['lab.partner']} aria-describedby={errors['lab.partner'] ? 'gs-lab-perr' : undefined}
              onChange={e => onChange({ ...lab, partner: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{subjects ? 'Choose the lab subject' : 'Loading subjects'}</option>
              {subjects?.map(s => <option key={s.user_subject_id} value={s.user_subject_id}>{s.course_code} · {s.subject_name}</option>)}
            </select>
          </>
        )}
      </div>
      {lab.on && errors['lab.partner'] && <FieldError id="gs-lab-perr">{errors['lab.partner']}</FieldError>}
      {lab.on && (
        <>
          <div className="sp-gs-lab-row sp-gs-lab-row--split">
            <label className="sp-gs-note" htmlFor="gs-lab-lec">Lecture</label>
            <span className={`sp-gs-wbox sp-num${errors['lab.weight'] ? ' is-bad' : ''}`}>
              <input id="gs-lab-lec" type="number" inputMode="numeric" min={1} max={99} step={1}
                value={Number.isFinite(lab.lecture) ? lab.lecture : ''} aria-invalid={!!errors['lab.weight']}
                aria-describedby={errors['lab.weight'] ? 'gs-lab-werr' : undefined}
                onChange={e => onChange({ ...lab, lecture: e.target.value === '' ? NaN : Number(e.target.value) })} />
              <span aria-hidden>%</span>
            </span>
            <span className="sp-gs-note" aria-hidden>Lab</span>
            <span className="sp-gs-wbox sp-gs-wbox--ro sp-num">
              <output htmlFor="gs-lab-lec" aria-label="Lab weight, percent">{Number.isFinite(lab.lecture) ? 100 - lab.lecture : '–'}</output><span aria-hidden>%</span>
            </span>
            <span aria-live="polite"><PeriodChip check={check} /></span>
          </div>
          {errors['lab.weight'] && <FieldError id="gs-lab-werr">{errors['lab.weight']}</FieldError>}
          {errors['lab.periods'] && <FieldError id="gs-lab-per">{errors['lab.periods']}</FieldError>}
          {check.kind === 'mismatch' && (
            <p className="sp-gs-note">
              This subject: <b>{check.lecture.join(' · ') || 'none'}</b>. {partnerName?.course_code ?? 'Lab'}: <b>{check.lab.join(' · ') || 'none'}</b>.
            </p>
          )}
          <p className="sp-gs-note">Two separate subjects with their own categories, combined per period. Counted as one grade in the GWA.</p>
        </>
      )}
      {serverError && <FieldError id="gs-lab-srv">{serverError}</FieldError>}
    </section>
  );
}
