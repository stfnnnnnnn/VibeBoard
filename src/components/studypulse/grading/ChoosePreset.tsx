'use client';

import { Loader2 } from 'lucide-react';
import SpSegmented from '../ui/SpSegmented';
import { FieldError } from './CategoryRow';
import { MoveTable, type MoveRow, type Target } from './ReviewStep';

export type EntryMode = 'edit' | 'another' | 'new';
export type NewKind = 'feu' | 'blank';
export interface PresetOption { preset_id: number; name: string; period_count: number }

/** The three entry modes. "Edit current" only exists with a config; "Use another system" only with other presets. */
export function ModePicker({ mode, onMode, hasCurrent, hasOthers, newKind, onNewKind }: {
  mode: EntryMode; onMode: (m: EntryMode) => void; hasCurrent: boolean; hasOthers: boolean;
  newKind: NewKind; onNewKind: (k: NewKind) => void;
}) {
  const options = [
    ...(hasCurrent ? [{ value: 'edit' as const, label: 'Edit current' }] : []),
    ...(hasOthers ? [{ value: 'another' as const, label: 'Use another system' }] : []),
    { value: 'new' as const, label: 'Start new' },
  ];
  return (
    <div className="sp-gs-modes">
      {options.length > 1 && <SpSegmented<EntryMode> label="How to set up grading" value={mode} options={options} onChange={onMode} />}
      {mode === 'new' && (
        <SpSegmented<NewKind> size="sm" label="Start from" value={newKind} onChange={onNewKind}
          options={[{ value: 'feu', label: 'FEU template' }, { value: 'blank', label: 'Blank' }]} />
      )}
    </div>
  );
}

/** "Use another system": pick a preset, then say where this subject's entries go (pre-filled by name). */
export default function ChoosePreset({ presets, picked, onPick, loading, moves, choices, targets, onMove, error }: {
  presets: PresetOption[];
  picked: number | null;
  onPick: (id: number) => void;
  loading: boolean;
  moves: MoveRow[];
  choices: Record<string, string>;
  targets: Target[];
  onMove: (id: string, choice: string) => void;
  error: string | null;
}) {
  return (
    <>
      <section className="sp-gs-sec sp-gs-sec--first" aria-labelledby="gs-pick-h">
        <div className="sp-gs-sec__t"><h3 id="gs-pick-h">Pick a grading system</h3></div>
        <div role="radiogroup" aria-labelledby="gs-pick-h">
          {presets.map(p => (
            <div key={p.preset_id} className={`sp-gs-opt${picked === p.preset_id ? ' is-on' : ''}`}>
              <label className="sp-gs-opt__main">
                <input type="radio" name="gs-preset" value={p.preset_id} checked={picked === p.preset_id}
                  onChange={() => onPick(p.preset_id)} className="sp-gs-opt__input" />
                <span className="sp-gs-opt__dot" aria-hidden />
                <span className="sp-gs-opt__text">
                  <b>{p.name}</b>
                  <span className="sp-num">{p.period_count} {p.period_count === 1 ? 'period' : 'periods'}</span>
                </span>
              </label>
            </div>
          ))}
        </div>
      </section>
      {picked != null && (
        <section className="sp-gs-sec" aria-labelledby="gs-map-h" aria-busy={loading}>
          <div className="sp-gs-sec__t"><h3 id="gs-map-h">Your entries</h3></div>
          {loading
            ? <p className="sp-gs-note"><Loader2 size={13} className="sp-spin" aria-hidden /> Loading its categories</p>
            : moves.length === 0
              ? <p className="sp-gs-note">Nothing to move: this subject has no entries in its current categories.</p>
              : (
                <>
                  <p className="sp-gs-note">Each old category with entries needs a home in the new system. Matching names are filled in for you.</p>
                  <MoveTable moves={moves} choices={choices} targets={targets} onMove={onMove} />
                </>
              )}
        </section>
      )}
      {error && <FieldError id="gs-choose-err">{error}</FieldError>}
    </>
  );
}
