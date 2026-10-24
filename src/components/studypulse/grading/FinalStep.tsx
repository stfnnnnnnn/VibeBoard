'use client';

import type { ReactNode } from 'react';
import SpSegmented from '../ui/SpSegmented';
import { FieldError } from './CategoryRow';
import type { FieldErrors, SetupDraft } from './draft';
import type { FinalMode } from '@/lib/studypulse/types';

function Option({ value, checked, title, onPick, children, extra }: {
  value: FinalMode; checked: boolean; title: string; onPick: () => void; children: ReactNode; extra?: ReactNode;
}) {
  return (
    <div className={`sp-gs-opt${checked ? ' is-on' : ''}`}>
      <label className="sp-gs-opt__main">
        <input type="radio" name="gs-final" value={value} checked={checked} onChange={onPick} className="sp-gs-opt__input" />
        <span className="sp-gs-opt__dot" aria-hidden />
        <span className="sp-gs-opt__text"><b>{title}</b><span>{children}</span></span>
      </label>
      {extra && <div className="sp-gs-opt__sub">{extra}</div>}
    </div>
  );
}

/** Step 3: where the final grade comes from. Two option cards, as in the mockup. */
export default function FinalStep({ draft, onChange, errors }: {
  draft: SetupDraft; onChange: (d: SetupDraft) => void; errors: FieldErrors;
}) {
  const names = draft.periods.map((p, i) => p.name.trim() || `Period ${i + 1}`);
  return (
    <section className="sp-gs-sec sp-gs-sec--first" aria-labelledby="gs-final-h">
      <div className="sp-gs-sec__t"><h3 id="gs-final-h">Final grade</h3></div>
      <div role="radiogroup" aria-labelledby="gs-final-h">
        <Option value="period" checked={draft.final_mode === 'period'} title="Shown in a period"
          onPick={() => onChange({ ...draft, final_mode: 'period' })}
          extra={draft.final_mode === 'period' && (
            <>
              <SpSegmented<number> size="sm" label="Period that shows the final grade" value={draft.final_period_index ?? -1}
                options={names.map((n, i) => ({ value: i, label: n }))}
                onChange={i => onChange({ ...draft, final_period_index: i })} />
              {errors.final && <FieldError id="gs-final-err">{errors.final}</FieldError>}
            </>
          )}>
          One period already holds the final grade. It gets a small “Final grade” tag, with no extra calculation.
        </Option>
        <Option value="average" checked={draft.final_mode === 'average'} title="Dedicated Final grade view"
          onPick={() => onChange({ ...draft, final_mode: 'average' })}
          extra={draft.final_mode === 'average' && (
            <p className="sp-gs-note">Average of all periods: ({names.join(' + ')}) ÷ <span className="sp-num">{names.length}</span>.</p>
          )}>
          Adds a “Final grade” view after the periods ({names.join(' · ')} · <b>Final grade</b>), with its own tab, tile and
          summary column. Always the average of the periods.
        </Option>
      </div>
      {draft.final_mode === null && <p className="sp-gs-note">No rule yet. Pick one so the subject page can show a final grade.</p>}
    </section>
  );
}
