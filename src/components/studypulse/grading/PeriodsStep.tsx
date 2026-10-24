'use client';

import { Plus, Trash2 } from 'lucide-react';
import CategoryRow, { FieldError } from './CategoryRow';
import { newCategory, newPeriod, periodSum, removePeriod, type FieldErrors, type SetupDraft } from './draft';

/** Step 2: one card per period (name, live weight total, categories with their flags). */
export default function PeriodsStep({ draft, onChange, errors, shown, onTouch }: {
  draft: SetupDraft;
  onChange: (d: SetupDraft) => void;
  errors: FieldErrors;
  shown: (key: string) => boolean;
  onTouch: (key: string) => void;
}) {
  const setPeriod = (pi: number, name: string) =>
    onChange({ ...draft, periods: draft.periods.map((p, i) => i === pi ? { ...p, name } : p) });
  const addCategory = (pi: number) =>
    onChange({ ...draft, periods: draft.periods.map((p, i) => i === pi ? { ...p, categories: [...p.categories, newCategory()] } : p) });

  return (
    <section className="sp-gs-sec sp-gs-sec--first" aria-labelledby="gs-periods-h">
      <div className="sp-gs-sec__t">
        <h3 id="gs-periods-h">Periods &amp; categories</h3>
        <span className="sp-gs-note">Weights add up to 100 per period</span>
      </div>
      {errors.periods && <FieldError id="gs-periods-err">{errors.periods}</FieldError>}
      {draft.periods.map((p, pi) => {
        const sum = periodSum(p);
        const ok = Math.abs(sum - 100) <= 0.01;
        const nameErr = shown(`p${pi}.name`) ? errors[`p${pi}.name`] : undefined;
        const sumErr = shown(`p${pi}.sum`) ? errors[`p${pi}.sum`] : undefined;
        const isFinal = draft.final_mode === 'period' && draft.final_period_index === pi;
        return (
          <div key={p.key} className="sp-item sp-gs-pcol" role="group" aria-label={p.name.trim() || `Period ${pi + 1}`}>
            <div className="sp-gs-pcol__h">
              <label className="sp-sr-only" htmlFor={`gs-${p.key}`}>Name of period {pi + 1}</label>
              <input id={`gs-${p.key}`} className="sp-input sp-input--sm sp-gs-pcol__name" value={p.name} maxLength={50}
                autoComplete="off" placeholder={`Period ${pi + 1} name`} aria-invalid={!!nameErr}
                aria-describedby={nameErr ? `gs-${p.key}-err` : undefined}
                onChange={e => setPeriod(pi, e.target.value)} onBlur={() => onTouch(`p${pi}.name`)} />
              {isFinal && <span className="sp-chip sp-chip--pink">Final grade</span>}
              <span className={`sp-chip sp-num sp-gs-wsum ${ok ? 'sp-chip--success' : 'sp-chip--danger'}`}
                aria-label={`Weights total ${sum} percent${ok ? '' : ', needs 100'}`}>{sum}%</span>
              {draft.periods.length > 1 && (
                <button type="button" className="sp-icon-btn sp-gs-remove sp-focus-ring"
                  aria-label={`Remove period ${p.name.trim() || pi + 1}`} onClick={() => onChange(removePeriod(draft, pi))}>
                  <Trash2 size={15} aria-hidden />
                </button>
              )}
            </div>
            {nameErr && <FieldError id={`gs-${p.key}-err`}>{nameErr}</FieldError>}
            {p.categories.map((c, ci) => (
              <CategoryRow key={c.key} draft={draft} pi={pi} ci={ci} onChange={onChange} errors={errors} shown={shown} onTouch={onTouch} />
            ))}
            {errors[`p${pi}.empty`] && <FieldError id={`gs-${p.key}-empty`}>{errors[`p${pi}.empty`]}</FieldError>}
            {sumErr && <FieldError id={`gs-${p.key}-sum`}>{sumErr}</FieldError>}
            <button type="button" className="sp-add sp-focus-ring sp-gs-addcat" onClick={() => addCategory(pi)}>
              <Plus size={14} aria-hidden /> Add category
            </button>
          </div>
        );
      })}
      <button type="button" className="sp-btn sp-btn--ghost sp-focus-ring" onClick={() => onChange({ ...draft, periods: [...draft.periods, newPeriod('')] })}>
        <Plus size={15} aria-hidden /> Add period
      </button>
    </section>
  );
}
