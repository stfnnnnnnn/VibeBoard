'use client';

import { useCallback, useEffect, useRef, type FormEvent, type RefObject } from 'react';
import { ArrowRight, Layers } from 'lucide-react';
import SpSegmented from '../ui/SpSegmented';
import SubjectCard from './SubjectCard';

export const YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
export const TERMS = ['1st Term', '2nd Term', '3rd Term'];
export const TRIMESTERS = ['1st Trimester', '2nd Trimester', '3rd Trimester'];
export const UNIT_OPTIONS = ['0', '1', '2', '3'];

export interface SubjectFormValues {
  course_code: string; section: string; subject_name: string;
  year_level: string; term: string; semester: string; units: string;
}
export const BLANK_FORM: SubjectFormValues = { course_code: '', section: '', subject_name: '', year_level: '', term: '', semester: '', units: '3' };

const short = (v: string) => v.split(' ')[0]; // "3rd Year" -> "3rd"

export default function SubjectForm({
  open, editing, form, set, submitting, message, onSubmit, onCancel, returnFocusRef,
}: {
  open: boolean;
  editing: boolean;
  form: SubjectFormValues;
  set: (k: keyof SubjectFormValues, v: string) => void;
  submitting: boolean;
  message: string;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  /** Where focus goes when the form is dismissed (Esc or Cancel) while focus is inside it. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Opening (create or edit) puts the caret in the first field. preventScroll: the edit path scrolls to the top itself.
  useEffect(() => {
    if (open) codeRef.current?.focus({ preventScroll: true });
  }, [open, editing]);

  // Closing would leave focus on an element that is about to go inert, so hand it back to the toggle first.
  const dismiss = useCallback(() => {
    const inside = !!formRef.current?.contains(document.activeElement);
    onCancel();
    if (inside) returnFocusRef?.current?.focus();
  }, [onCancel, returnFocusRef]);

  useEffect(() => {
    if (!open) return;
    // Something else (an open picker, a dialog) may have handled this Esc already.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  const req = <span className="sp-field__req" aria-hidden>*</span>;

  return (
    <div className={`sp-form-shell${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="sp-form-shell__inner">
        <form ref={formRef} className="sp-form-shell__content" onSubmit={onSubmit} inert={!open ? true : undefined}>
          <div className="sp-panel sp-sheet">
            <div className="sp-sheet__main">
              <h3 className="sp-sheet__title"><span className="sp-badge"><Layers size={16} /></span>{editing ? 'Edit subject' : 'New subject'}</h3>
              <p className="sp-sheet__lede">{editing ? 'Changes apply to this subject only.' : "You'll set up its grading system right after this."}</p>

              <div className="sp-fgroup">
                <div className="sp-fgroup__title"><span className="sp-eyebrow">Course</span></div>
                <div className="sp-frow sp-frow--2">
                  <label className="sp-field">
                    <span className="sp-field__label">Course code{req}</span>
                    <input ref={codeRef} className="sp-input sp-input--mono" placeholder="e.g. CS101" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={form.course_code} onChange={e => set('course_code', e.target.value)} required />
                  </label>
                  <label className="sp-field">
                    <span className="sp-field__label">Block section</span>
                    <input className="sp-input sp-input--mono" placeholder="e.g. TN37" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={form.section} onChange={e => set('section', e.target.value)} />
                    <span className="sp-field__hint">Optional. Shown as a tag on the card.</span>
                  </label>
                </div>
                <label className="sp-field" style={{ display: 'block', marginTop: 14 }}>
                  <span className="sp-field__label">Subject name{req}</span>
                  <input className="sp-input sp-input--lg" placeholder="e.g. Data Structures" value={form.subject_name} onChange={e => set('subject_name', e.target.value)} required />
                </label>
              </div>

              <div className="sp-fgroup">
                <div className="sp-fgroup__title"><span className="sp-eyebrow">When</span></div>
                <div className="sp-frow--segs">
                  <div className="sp-field"><span className="sp-field__label">Year level{req}</span>
                    <SpSegmented label="Year level" value={form.year_level} onChange={v => set('year_level', v)} options={YEAR_LEVELS.map(y => ({ value: y, label: short(y) }))} />
                  </div>
                  <div className="sp-field"><span className="sp-field__label">Trimester{req}</span>
                    <SpSegmented label="Trimester" value={form.semester} onChange={v => set('semester', v)} options={TRIMESTERS.map(t => ({ value: t, label: short(t) }))} />
                  </div>
                  <div className="sp-field"><span className="sp-field__label">Term</span>
                    <SpSegmented label="Term" value={form.term} onChange={v => set('term', v)} options={[{ value: '', label: '—' }, ...TERMS.map(t => ({ value: t, label: short(t) }))]} />
                  </div>
                  <div className="sp-field"><span className="sp-field__label">Units</span>
                    <SpSegmented label="Units" value={form.units} onChange={v => set('units', v)} options={UNIT_OPTIONS.map(u => ({ value: u, label: u }))} />
                  </div>
                </div>
              </div>

              {message && <div className="sp-form-error" role="alert">{message}</div>}

              <div className="sp-sheet__foot" style={{ marginTop: 18 }}>
                <button type="submit" className="sp-btn sp-btn--primary sp-focus-ring" disabled={submitting}>
                  {editing ? (submitting ? 'Saving…' : 'Save changes') : (submitting ? 'Creating…' : <>Create &amp; set up grading <ArrowRight size={15} /></>)}
                </button>
                <button type="button" className="sp-btn sp-btn--quiet sp-focus-ring" onClick={dismiss}>Cancel</button>
                <span className="sp-sheet__kbd"><kbd className="sp-kbd">Enter</kbd> to {editing ? 'save' : 'create'} · <kbd className="sp-kbd">Esc</kbd> to close</span>
              </div>
            </div>
            <aside className="sp-sheet__side" aria-label="Preview">
              <div className="sp-eyebrow" style={{ marginBottom: 12 }}>Preview</div>
              <SubjectCard preview sub={{
                course_code: form.course_code.toUpperCase(), subject_name: form.subject_name, section: form.section.toUpperCase() || null,
                year_level: form.year_level, trimester: form.semester, units: Number(form.units) || 0,
                current_grade: null, grade_scale: null,
              }} />
              <p className="sp-sheet__note">This is how the subject will look in your list.</p>
            </aside>
          </div>
        </form>
      </div>
    </div>
  );
}
