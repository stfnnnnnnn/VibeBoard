'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Check, Clock, Loader2 } from 'lucide-react';
import InfoTip from '@/components/studypulse/ui/InfoTip';
import { f1, shortDate, todayManila } from '@/lib/studypulse/ui/format';
import {
  LEGACY_LABEL, suggestedTarget, targetLabel,
  type BankItem, type BankTarget, type LegacyTarget, type PickerPeriod,
} from './types';

export type BankView = 'pending' | 'ignored';

/** Canvas due_at is stored as UTC; the row shows the Manila calendar date. */
function dueLabel(dueAt: string | null, today: string): string {
  if (!dueAt) return 'No due date';
  const d = new Date(dueAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return 'No due date';
  return `Due ${shortDate(todayManila(d), today)}`;
}

/** 18 → "18", 18.5 → "18.5", 18.333 → "18.33". */
const pts = (n: number) => String(Math.round(n * 100) / 100);

/**
 * One Activity Bank row (spec §6 C3, mockup v1c bank()): checkbox, name, subject chip, due date, the Canvas score,
 * then "Goes to Period › Category ⓘ · 18 / 20 → 90.0" and Add / Change… / Ignore. Ignored rows show Restore.
 * Change… opens the inline picker (period → category, or the legacy table) with "Add here".
 * The outer element collapses its grid row and fades when the row leaves (180ms, see .sp-brow-shell).
 */
export default function BankRow({
  item, view, code, selected, onSelect, busy, error, leaving, picking, onTogglePick, onAdd, onIgnore, onRestore,
  loadPeriods, rowRef,
}: {
  item: BankItem;
  view: BankView;
  /** The subject chip: the mapped subject's code, else the Canvas course name. */
  code: { label: string; mapped: boolean };
  selected: boolean;
  onSelect: (on: boolean) => void;
  busy: boolean;
  error: string | null;
  leaving: boolean;
  picking: boolean;
  onTogglePick: () => void;
  onAdd: (t: BankTarget) => void;
  onIgnore: () => void;
  onRestore: () => void;
  loadPeriods: (subjectId: number) => Promise<PickerPeriod[]>;
  rowRef: Ref<HTMLLIElement>;
}) {
  const today = todayManila();
  const target = suggestedTarget(item.suggestion);
  const s = item.suggestion;
  const guess = !!s && ('legacy' in s ? s.legacy.confidence : s.confidence) === 'guess';
  const reason = s ? ('legacy' in s ? s.legacy.reason : s.reason) : '';
  const scored = item.submission_score !== null;
  const points = item.points_possible;
  const nameId = `sp-brow-${item.id}-name`;
  const changeBtn = useRef<HTMLButtonElement>(null);

  return (
    <li ref={rowRef} tabIndex={-1} className={`sp-brow-shell${leaving ? ' is-leaving' : ''}`} aria-labelledby={nameId}
      aria-busy={busy || undefined}>
      <div className="sp-brow-clip">
        <div className={`sp-brow${selected ? ' is-sel' : ''}`}>
          {view === 'pending' ? (
            <label className="sp-brow__chk">
              <input type="checkbox" className="sp-check sp-focus-ring" checked={selected} disabled={leaving}
                onChange={e => onSelect(e.target.checked)} aria-labelledby={nameId} />
            </label>
          ) : <span aria-hidden />}

          <div className="sp-brow__main">
            <div className="sp-brow__name" id={nameId}>{item.name}</div>
            <div className="sp-brow__meta sp-num">
              <span className={`sp-chip ${code.mapped ? 'sp-chip--blue' : 'sp-chip--neutral'} sp-brow__code`} title={code.label}>{code.label}</span>
              <span className="sp-brow__due"><Clock size={13} aria-hidden /> {dueLabel(item.due_at, today)}</span>
              <span aria-hidden>·</span>
              {scored
                ? <span>Canvas score <b className="sp-brow__score">{pts(item.submission_score!)}{points ? ` / ${pts(points)}` : ' pts'}</b></span>
                : <span>Not graded on Canvas yet{points ? ` · ${pts(points)} pts` : ''}</span>}
            </div>

            {view === 'pending' && (
              <div className="sp-dest sp-num">
                {!item.user_subject_id ? (
                  <span className="sp-dest__none">Link this course to a subject on the Overview first.</span>
                ) : target ? (
                  <>
                    <span className="sp-dest__to">Goes to</span>
                    {/* The ⓘ travels with the path, so a wrapped path never leaves it alone on the next line. */}
                    <span className="sp-dest__spot">
                      <span className="sp-dest__path">
                        {guess && <span className="sp-dest__dot" aria-hidden />}
                        {targetLabel(target)}
                        {guess && <span className="sp-sr-only"> (a guess)</span>}
                      </span>
                      <InfoTip label="Why this spot?">
                        <b>Why this spot?</b>{guess && <span className="sp-dest__tipguess"> Guess.</span>} {reason}
                      </InfoTip>
                    </span>
                    <span className="sp-dest__tail">
                      <span className="sp-dest__to" aria-hidden>·</span>
                      <span className="sp-dest__prev">{preview(item)}</span>
                    </span>
                  </>
                ) : (
                  <span className="sp-dest__none">No grading spot to suggest yet. Choose one with Change…</span>
                )}
              </div>
            )}
          </div>

          <div className="sp-brow__acts">
            {view === 'pending' ? (
              <>
                <button type="button" className="sp-btn sp-btn--primary sp-btn--sm sp-focus-ring" disabled={busy || leaving || !target}
                  onClick={() => target && onAdd(target)} aria-describedby={nameId}>
                  {busy ? <Loader2 size={14} className="sp-spin" aria-hidden /> : <Check size={14} aria-hidden />} Add
                </button>
                <button ref={changeBtn} type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-focus-ring"
                  disabled={busy || leaving || !item.user_subject_id} aria-expanded={picking} onClick={onTogglePick}
                  aria-describedby={nameId}>
                  Change…
                </button>
                <button type="button" className="sp-btn sp-btn--quiet sp-btn--sm sp-focus-ring" disabled={busy || leaving}
                  onClick={onIgnore} aria-describedby={nameId}>
                  Ignore
                </button>
              </>
            ) : (
              <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-focus-ring" disabled={busy || leaving}
                onClick={onRestore} aria-describedby={nameId}>
                {busy && <Loader2 size={14} className="sp-spin" aria-hidden />} Restore
              </button>
            )}
          </div>

          {picking && item.user_subject_id && (
            <Picker item={item} target={target} busy={busy} onAdd={onAdd} loadPeriods={loadPeriods}
              onClose={() => { onTogglePick(); changeBtn.current?.focus(); }} />
          )}

          {error && <p className="sp-brow__err" role="alert">{error}</p>}
        </div>
      </div>
    </li>
  );
}

function preview(item: BankItem): string {
  const { submission_score: score, points_possible: points } = item;
  if (score === null) return 'added as Pending (no score yet)';
  if (!points) return `${pts(score)} pts, added without a percentage`;
  return `${pts(score)} / ${pts(points)} → ${f1((score / points) * 100)}`;
}

const LEGACY_OPTIONS: LegacyTarget[] = ['activities', 'quizzes', 'exams'];

/** The Change… row: period → category for a custom subject (periods loaded once per subject), or the legacy table. */
function Picker({ item, target, busy, onAdd, onClose, loadPeriods }: {
  item: BankItem;
  target: BankTarget | null;
  busy: boolean;
  onAdd: (t: BankTarget) => void;
  onClose: () => void;
  loadPeriods: (subjectId: number) => Promise<PickerPeriod[]>;
}) {
  const custom = item.subject_mode === 'custom';
  const [periods, setPeriods] = useState<PickerPeriod[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<number | null>(target?.kind === 'custom' ? target.period_id : null);
  const [catId, setCatId] = useState<number | null>(target?.kind === 'custom' ? target.cat_id : null);
  const [legacy, setLegacy] = useState<LegacyTarget>(target?.kind === 'legacy' ? target.target : 'activities');
  const first = useRef<HTMLSelectElement>(null);
  const subjectId = item.user_subject_id!;

  useEffect(() => {
    if (!custom) { first.current?.focus(); return; }
    let live = true;
    loadPeriods(subjectId).then(
      ps => {
        if (!live) return;
        setPeriods(ps);
        // Keep the suggestion when it is still there, else fall back to the first period and category.
        const p = ps.find(x => x.period_id === periodId) ?? ps[0];
        setPeriodId(p?.period_id ?? null);
        setCatId(p?.categories.find(c => c.cat_id === catId)?.cat_id ?? p?.categories[0]?.cat_id ?? null);
      },
      (err: Error) => { if (live) setLoadErr(err.message || 'Couldn’t load this subject’s grading periods.'); },
    );
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per open
  }, []);

  useEffect(() => { if (periods) first.current?.focus(); }, [periods]);

  const period = periods?.find(p => p.period_id === periodId) ?? null;
  const cat = period?.categories.find(c => c.cat_id === catId) ?? null;
  const choice: BankTarget | null = custom
    ? (period && cat ? { kind: 'custom', period_id: period.period_id, period_name: period.name, cat_id: cat.cat_id, cat_name: cat.name } : null)
    : { kind: 'legacy', target: legacy };

  const changePeriod = (id: number) => {
    const next = periods?.find(p => p.period_id === id);
    setPeriodId(id);
    // Same-named category in the new period when there is one (Quizzes → Quizzes), else its first.
    const same = next?.categories.find(c => c.name === cat?.name);
    setCatId(same?.cat_id ?? next?.categories[0]?.cat_id ?? null);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    onClose();
  };

  return (
    <div className="sp-picker" role="group" aria-label={`Choose where “${item.name}” goes`} onKeyDown={onKey}>
      <span className="sp-eyebrow">Add to</span>
      {custom ? (
        loadErr ? <span className="sp-picker__msg sp-picker__msg--err" role="alert">{loadErr}</span>
        : !periods ? <span className="sp-picker__msg"><Loader2 size={14} className="sp-spin" aria-hidden /> Loading periods…</span>
        : periods.length === 0 ? <span className="sp-picker__msg">This subject has no grading periods set up yet.</span>
        : (
          <>
            <select ref={first} className="sp-input sp-input--sm sp-focus-ring sp-picker__sel" aria-label="Period"
              value={periodId ?? ''} onChange={e => changePeriod(Number(e.target.value))}>
              {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.name}</option>)}
            </select>
            <select className="sp-input sp-input--sm sp-focus-ring sp-picker__sel" aria-label="Category"
              value={catId ?? ''} onChange={e => setCatId(Number(e.target.value))} disabled={!period?.categories.length}>
              {!period?.categories.length && <option value="">No categories</option>}
              {period?.categories.map(c => <option key={c.cat_id} value={c.cat_id}>{c.name}</option>)}
            </select>
          </>
        )
      ) : (
        <select ref={first} className="sp-input sp-input--sm sp-focus-ring sp-picker__sel" aria-label="Table"
          value={legacy} onChange={e => setLegacy(e.target.value as LegacyTarget)}>
          {LEGACY_OPTIONS.map(t => <option key={t} value={t}>{LEGACY_LABEL[t]}</option>)}
        </select>
      )}
      <span className="sp-picker__btns">
        <button type="button" className="sp-btn sp-btn--primary sp-btn--sm sp-focus-ring" disabled={busy || !choice}
          onClick={() => choice && onAdd(choice)}>
          {busy && <Loader2 size={14} className="sp-spin" aria-hidden />} Add here
        </button>
        <button type="button" className="sp-btn sp-btn--quiet sp-btn--sm sp-focus-ring" onClick={onClose}>Cancel</button>
      </span>
    </div>
  );
}
