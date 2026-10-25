'use client';

import type { MouseEvent, ReactNode } from 'react';
import { Check, Circle, Layers, X } from 'lucide-react';
import { linkAcross, renameLinked, setSingleton, singletonLocked, type FieldErrors, type SetupDraft, type UiCategory } from './draft';
import { focusNeighbour } from './focusTrap';

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return <div id={id} className="sp-field__err" role="alert">{children}</div>;
}

/** A toggle chip from the mockup: ✓/○ plus a label; `tone` colours it when on. Fixed chips are plain text. */
function Flag({ on, tone, label, onToggle, icon }: {
  on: boolean; tone?: 'link' | 'cum' | 'carry'; label: string; onToggle?: () => void; icon?: ReactNode;
}) {
  const cls = `sp-gs-flag${on ? ' is-on' : ''}${tone ? ` sp-gs-flag--${tone}` : ''}`;
  const mark = on ? <Check size={12} strokeWidth={3} aria-hidden /> : <Circle size={11} strokeWidth={2.5} aria-hidden />;
  if (!onToggle) return <span className={`${cls} sp-gs-flag--fixed`}>{icon ?? mark}{label}</span>;
  return (
    <button type="button" className={`${cls} sp-focus-ring`} aria-pressed={on} onClick={onToggle}>
      {mark}{label}
    </button>
  );
}

/** One category inside a period card (step 2): name, weight, remove, and the flags row. */
export default function CategoryRow({ draft, pi, ci, onChange, errors, shown, onTouch }: {
  draft: SetupDraft; pi: number; ci: number;
  onChange: (d: SetupDraft) => void;
  errors: FieldErrors;
  shown: (key: string) => boolean;
  onTouch: (key: string) => void;
}) {
  const period = draft.periods[pi];
  const c = period.categories[ci];
  const k = `p${pi}.c${ci}`;
  const id = `gs-${c.key}`;
  const nameErr = shown(`${k}.name`) ? errors[`${k}.name`] : undefined;
  const weightErr = shown(`${k}.weight`) ? errors[`${k}.weight`] : undefined;
  const groupErr = errors[`${k}.group`];
  const multi = draft.periods.length > 1;
  const linked = !!c.link_group;
  const later = linked && pi > 0;
  const first = draft.periods[0]?.name.trim() || 'the first period';
  const twinElsewhere = draft.periods.some((p, i) => i !== pi && p.categories.some(o => o.name.trim().toLowerCase() === c.name.trim().toLowerCase() && c.name.trim() !== ''));

  const set = (fields: Partial<UiCategory>) => onChange({
    ...draft,
    periods: draft.periods.map((p, i) => i !== pi ? p : { ...p, categories: p.categories.map((o, j) => j === ci ? { ...o, ...fields } : o) }),
  });
  // Focus the neighbouring row's name first: the X being clicked leaves the DOM with this row.
  const remove = (e: MouseEvent<HTMLButtonElement>) => {
    const row = e.currentTarget.closest('.sp-gs-crow');
    focusNeighbour(row, '.sp-gs-crow', 'input', row?.parentElement?.querySelector<HTMLElement>('.sp-gs-addcat') ?? null);
    onChange({
      ...draft,
      periods: draft.periods.map((p, i) => i !== pi ? p : { ...p, categories: p.categories.filter((_, j) => j !== ci) }),
    });
  };
  const described = [nameErr && `${id}-nerr`, groupErr && `${id}-gerr`].filter(Boolean).join(' ') || undefined;

  return (
    <div className="sp-gs-crow">
      <div className="sp-gs-crow__top">
        <label className="sp-sr-only" htmlFor={`${id}-n`}>Category name in {period.name || `period ${pi + 1}`}</label>
        <input id={`${id}-n`} className="sp-input sp-input--sm sp-gs-crow__name" value={c.name} maxLength={50} autoComplete="off"
          placeholder="Category name" aria-invalid={!!nameErr} aria-describedby={described}
          onChange={e => onChange(renameLinked(draft, pi, ci, e.target.value))} onBlur={() => onTouch(`${k}.name`)} />
        <span className={`sp-gs-wbox sp-num${weightErr ? ' is-bad' : ''}`}>
          <label className="sp-sr-only" htmlFor={`${id}-w`}>Weight of {c.name || 'this category'}, percent</label>
          <input id={`${id}-w`} type="number" inputMode="decimal" min={0} max={100} step="any"
            value={Number.isFinite(c.weight) ? c.weight : ''} aria-invalid={!!weightErr}
            aria-describedby={weightErr ? `${id}-werr` : undefined}
            onChange={e => set({ weight: e.target.value === '' ? NaN : Number(e.target.value) })}
            onBlur={() => onTouch(`${k}.weight`)} />
          <span aria-hidden>%</span>
        </span>
        <button type="button" className="sp-icon-btn sp-gs-remove sp-focus-ring" onClick={remove}
          disabled={period.categories.length <= 1} aria-label={`Remove ${c.name.trim() || 'this category'} from ${period.name.trim() || 'this period'}`}>
          <X size={16} aria-hidden />
        </button>
      </div>
      {nameErr && <FieldError id={`${id}-nerr`}>{nameErr}</FieldError>}
      {weightErr && <FieldError id={`${id}-werr`}>{weightErr}</FieldError>}
      <div className="sp-gs-flags" role="group" aria-label={`Options for ${c.name.trim() || 'this category'}`}>
        {!singletonLocked(draft, pi, ci)
          ? <Flag on={c.is_singleton} label={c.is_singleton ? 'Single score' : 'Multiple entries'}
              onToggle={() => onChange(setSingleton(draft, pi, ci, !c.is_singleton))} />
          : <Flag on={c.is_singleton} label={c.is_singleton ? 'Single score' : 'Multiple entries'}
              icon={c.is_singleton ? <Check size={12} strokeWidth={3} aria-hidden /> : <Layers size={12} aria-hidden />} />}
        {multi && (
          <Flag on={linked} tone="link"
            label={linked ? 'Linked across periods' : twinElsewhere ? 'Not linked (same name, separate scores)' : 'Link across periods'}
            onToggle={() => onChange(linkAcross(draft, pi, ci, !linked))} />
        )}
        {later && !c.is_singleton && (
          <Flag on={c.include_earlier} tone="cum" label={`Include ${first}'s entries`}
            onToggle={() => set({ include_earlier: !c.include_earlier })} />
        )}
        {later && c.is_singleton && (
          <Flag on={c.carry_score} tone="carry" label={`Reuse ${first}'s raw score`}
            onToggle={() => set({ carry_score: !c.carry_score })} />
        )}
      </div>
      {groupErr && <FieldError id={`${id}-gerr`}>{groupErr}</FieldError>}
    </div>
  );
}
