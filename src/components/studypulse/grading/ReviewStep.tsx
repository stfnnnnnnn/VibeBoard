'use client';

import { AlertTriangle } from 'lucide-react';
import { FieldError } from './CategoryRow';
import type { UsageSubject } from './api';

export type Scope = 'all' | 'copy';
/** A category whose entries need a new home. `count` is this subject's entries; null when only other subjects have some. */
export interface MoveRow { id: string; label: string; count: number | null }
export interface Target { value: string; label: string }
export interface SummaryItem { key: string; message: string; step: number; stepName: string }

/** Old category -> new home (or delete) selects; shared by Review and "Use another system". */
export function MoveTable({ moves, choices, targets, onMove }: {
  moves: MoveRow[]; choices: Record<string, string>; targets: Target[]; onMove: (id: string, choice: string) => void;
}) {
  return (
    <div className="sp-gs-map">
      {moves.map(m => {
        const choice = choices[m.id] ?? '';
        const n = m.count;
        return (
          <div key={m.id} className="sp-gs-map__row">
            <label className="sp-gs-map__from" htmlFor={`gs-mv-${m.id}`}>
              <b>{m.label}</b>
              <span className="sp-gs-note sp-num">{n == null ? 'Has entries in other subjects' : `${n} ${n === 1 ? 'entry' : 'entries'}`}</span>
            </label>
            <select id={`gs-mv-${m.id}`} className={`sp-input sp-input--sm sp-gs-select${choice === '' ? ' is-empty' : ''}`}
              value={choice} aria-invalid={choice === ''} onChange={e => onMove(m.id, e.target.value)}>
              <option value="" disabled>Choose where they go</option>
              {targets.map(t => <option key={t.value} value={t.value}>Move to {t.label}</option>)}
              <option value="delete">{n == null ? 'Delete its entries' : `Delete its ${n} ${n === 1 ? 'entry' : 'entries'}`}</option>
            </select>
          </div>
        );
      })}
    </div>
  );
}

/** Step 5: what will change, the "used by N subjects" choice, where removed categories' entries go, and any
    problem still blocking Save (each one links back to its step). */
export default function ReviewStep({
  intro, changes, usage, scope, onScope, moves, choices, targets, onMove, problems, onGo, formError, mapTitle,
}: {
  intro: string;
  changes: string[];
  usage: UsageSubject[] | null;
  scope: Scope | null;
  onScope: (s: Scope) => void;
  moves: MoveRow[];
  choices: Record<string, string>;
  targets: Target[];
  onMove: (id: string, choice: string) => void;
  problems: SummaryItem[];
  onGo: (step: number, key: string) => void;
  formError: string | null;
  mapTitle: string;
}) {
  const shared = usage && usage.length > 1 ? usage : null;
  return (
    <>
      <section className="sp-gs-sec sp-gs-sec--first" aria-labelledby="gs-rev-h">
        <div className="sp-gs-sec__t"><h3 id="gs-rev-h">Review</h3></div>
        <p className="sp-gs-note">{intro}</p>
        {changes.length > 0
          ? <ul className="sp-gs-changes">{changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          : <p className="sp-gs-note">No changes yet.</p>}
      </section>

      {shared && (
        <section className="sp-gs-sec" aria-labelledby="gs-scope-h">
          <div className="sp-gs-sec__t"><h3 id="gs-scope-h">This grading system is used by <span className="sp-num">{shared.length}</span> subjects</h3></div>
          <p className="sp-gs-note">{shared.map(s => s.code).join(' · ')}. Existing entries stay attached either way.</p>
          <div role="radiogroup" aria-labelledby="gs-scope-h">
            {([['all', `Apply to all ${shared.length}`, 'Every subject above gets the new setup.'],
               ['copy', 'Save a copy for this subject only', 'The others keep the current setup.']] as const).map(([v, title, sub]) => (
              <div key={v} className={`sp-gs-opt${scope === v ? ' is-on' : ''}`}>
                <label className="sp-gs-opt__main">
                  <input type="radio" name="gs-scope" value={v} checked={scope === v} onChange={() => onScope(v)} className="sp-gs-opt__input" />
                  <span className="sp-gs-opt__dot" aria-hidden />
                  <span className="sp-gs-opt__text"><b>{title}</b><span>{sub}</span></span>
                </label>
              </div>
            ))}
          </div>
        </section>
      )}

      {moves.length > 0 && (
        <section className="sp-gs-sec" aria-labelledby="gs-moves-h">
          <div className="sp-gs-sec__t"><h3 id="gs-moves-h">{mapTitle}</h3></div>
          <MoveTable moves={moves} choices={choices} targets={targets} onMove={onMove} />
        </section>
      )}

      {problems.length > 0 && (
        <section className="sp-gs-sec" aria-labelledby="gs-prob-h">
          <div className="sp-gs-problems">
            <h3 id="gs-prob-h"><AlertTriangle size={15} aria-hidden /> Fix {problems.length === 1 ? 'this' : 'these'} before saving</h3>
            <ul>
              {problems.map(p => (
                <li key={p.key}>
                  {p.step !== 4 && <button type="button" className="sp-link sp-focus-ring" onClick={() => onGo(p.step, p.key)}>{p.stepName}</button>}
                  <span>{p.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {formError && <FieldError id="gs-form-err">{formError}</FieldError>}
    </>
  );
}
