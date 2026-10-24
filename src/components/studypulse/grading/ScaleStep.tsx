'use client';

import SpSegmented from '../ui/SpSegmented';
import { SCALE_1PT_ROWS, SCALE_4PT_ROWS, type GradeScale } from '@/lib/gradeScale';
import type { FieldErrors, SetupDraft } from './draft';
import { FieldError } from './CategoryRow';

/** Step 1: the system's name and its grade scale, with the band table the mockup shows under the switch. */
export default function ScaleStep({ draft, onChange, errors, shown, onTouch }: {
  draft: SetupDraft;
  onChange: (d: SetupDraft) => void;
  errors: FieldErrors;
  shown: (key: string) => boolean;
  onTouch: (key: string) => void;
}) {
  const rows = draft.grade_scale === '4pt' ? SCALE_4PT_ROWS : SCALE_1PT_ROWS;
  const nameErr = shown('name') ? errors.name : undefined;
  return (
    <>
      <section className="sp-gs-sec sp-gs-sec--first" aria-labelledby="gs-name-h">
        <div className="sp-gs-sec__t"><h3 id="gs-name-h">Name</h3></div>
        <label className="sp-field__label" htmlFor="gs-name">What do you call this grading system?<span className="sp-field__req" aria-hidden>*</span></label>
        <input id="gs-name" className="sp-input" value={draft.name} maxLength={100} autoComplete="off"
          placeholder="e.g. FEU Tech Standard" aria-invalid={!!nameErr} aria-describedby={nameErr ? 'gs-name-err' : 'gs-name-hint'}
          onChange={e => onChange({ ...draft, name: e.target.value })} onBlur={() => onTouch('name')} />
        {nameErr ? <FieldError id="gs-name-err">{nameErr}</FieldError>
          : <div id="gs-name-hint" className="sp-field__hint">Other subjects can reuse it later.</div>}
      </section>
      <section className="sp-gs-sec" aria-labelledby="gs-scale-h">
        <div className="sp-gs-sec__t"><h3 id="gs-scale-h">Grade scale</h3></div>
        <SpSegmented<GradeScale> label="Grade scale" value={draft.grade_scale}
          options={[{ value: '4pt', label: '4.0 is highest' }, { value: '1pt', label: '1.0 is highest' }]}
          onChange={v => onChange({ ...draft, grade_scale: v })} />
        <table className="sp-gs-scale sp-num">
          <caption className="sp-sr-only">Bands for the {draft.grade_scale === '4pt' ? '4.0' : '1.0'} scale</caption>
          <thead className="sp-sr-only"><tr><th>Minimum %</th><th>Letter</th><th>Point</th><th>Description</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.letter}>
                <td>{r.min > 0 ? `≥ ${r.min}` : 'below'}</td>
                <td><b>{r.letter}</b></td>
                <td>{r.point.toFixed(2)}</td>
                <td className="sp-tone-muted">{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {draft.grade_scale === '1pt' && (
          <p className="sp-gs-note">Letters on the 1.0 scale are equivalents. Check them against your school&apos;s table.</p>
        )}
      </section>
    </>
  );
}
