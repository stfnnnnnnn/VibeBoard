'use client';

import type { CSSProperties } from 'react';
import { FIELD_LABEL, FIELD_INPUT } from './dialogStyles';
import { ACADEMIC_SOURCE_OPTIONS, type AcademicSourcePath, type SubjectOption } from './dialogTypes';
import { Field, HINT_P, ERROR_P } from './SharedFields';

const OPTION_TITLE: CSSProperties = { display: 'block', font: '700 var(--wb-fs-14) var(--wb-font-head)', color: 'var(--wb-text)' };
const OPTION_BLURB: CSSProperties = { display: 'block', marginTop: 2, font: '500 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-text-muted)' };

/** Academic's first step in create mode: which of the three paths the new item takes. */
export function AcademicSourceStep({
  path, onChange, error,
}: {
  path: AcademicSourcePath | '';
  onChange: (next: AcademicSourcePath) => void;
  error: string | null;
}) {
  return (
    <fieldset style={{ border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
      <legend style={{ ...FIELD_LABEL, marginBottom: 4, padding: 0 }}>Where does this come from?</legend>
      <p style={{ ...HINT_P, margin: '0 0 10px' }}>
        Graded work appears in Study Pulse and counts toward your grade. An independent
        activity is study work that only lives here.
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {ACADEMIC_SOURCE_OPTIONS.map(opt => {
          const active = path === opt.value;
          return (
            <label
              key={opt.value}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
                padding: '10px 12px', borderRadius: 'var(--wb-r-lg)',
                background: active ? 'var(--wb-selected)' : 'var(--wb-surface)',
                border: `1px solid ${active ? 'var(--wb-blue)' : 'var(--wb-border)'}`,
              }}
            >
              <input
                type="radio"
                className="wb-focus-ring"
                name="academicSource"
                value={opt.value}
                checked={active}
                onChange={() => onChange(opt.value)}
                style={{ marginTop: 3, accentColor: 'var(--wb-blue-strong)', flexShrink: 0 }}
              />
              <span>
                <span style={OPTION_TITLE}>{opt.label}</span>
                <span style={OPTION_BLURB}>{opt.blurb}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error && <p role="alert" data-field-error="" style={ERROR_P}>{error}</p>}
    </fieldset>
  );
}

/** The Course select shared by all three academic paths. */
export function AcademicCourseField({
  subjectId, subjects, subjectsLoading, subjectsError, courseLocked, onSubjectChange, error,
}: {
  subjectId: number | '';
  subjects: SubjectOption[] | null;
  subjectsLoading: boolean;
  subjectsError: string | null;
  /** On the link path, once an item is picked the course is a fact about that item. */
  courseLocked: boolean;
  onSubjectChange: (next: number | '') => void;
  error: string | null;
}) {
  return (
    <Field
      label="Course"
      hint={courseLocked ? 'Set by the item you picked — clear the item to change it.' : undefined}
      error={error}
    >
      <select
        className="wb-focus-ring"
        style={FIELD_INPUT}
        value={subjectId === '' ? '' : String(subjectId)}
        disabled={courseLocked || subjectsLoading}
        onChange={e => onSubjectChange(e.target.value === '' ? '' : Number(e.target.value))}
      >
        <option value="">{subjectsLoading ? 'Loading courses…' : 'Choose a course…'}</option>
        {(subjects ?? []).map(s => (
          <option key={s.user_subject_id} value={s.user_subject_id}>
            {s.course_code} — {s.subject_name}
          </option>
        ))}
      </select>
      {subjectsError && <p role="alert" style={ERROR_P}>{subjectsError}</p>}
    </Field>
  );
}
