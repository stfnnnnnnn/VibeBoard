'use client';

import { FIELD_INPUT } from './dialogStyles';
import { LEGACY_TARGETS, WORK_SOURCE_LABEL, type LegacyTarget, type SubjectGrading } from './dialogTypes';
import { Field, HINT_P, ERROR_P, RETRY_BTN } from './SharedFields';

/** Path 2, "New graded work": the target picker for the chosen course's grading mode. */
export default function AcademicNewGraded({
  chosenCourseId, gradingError, courseGrading,
  gradingTarget, setGradingTarget, gradingPeriodId, onGradingPeriodChange, gradingCatId, setGradingCatId,
  onRetry, error,
}: {
  chosenCourseId: number | null;
  gradingError: string | null;
  /** `undefined` means "not loaded" — never "legacy": the two are told apart by `gradingError`. */
  courseGrading: SubjectGrading | undefined;
  gradingTarget: LegacyTarget; setGradingTarget: (v: LegacyTarget) => void;
  gradingPeriodId: number | ''; onGradingPeriodChange: (v: number | '') => void;
  gradingCatId: number | ''; setGradingCatId: (v: number | '') => void;
  onRetry: (courseId: number) => void;
  /** A submit-time validation message about the target (period/category, unloaded setup). */
  error: string | null;
}) {
  // Categories are read off the selected period, so no period means no categories.
  const periodCategories = courseGrading?.periods.find(p => p.period_id === gradingPeriodId)?.categories ?? [];
  const errorLine = error ? <p role="alert" data-field-error="" style={ERROR_P}>{error}</p> : null;

  if (chosenCourseId === null) {
    return <p style={{ ...HINT_P, marginTop: 0 }}>Pick a course to choose what this counts toward.</p>;
  }
  if (gradingError !== null) {
    // Checked before the empty-cache branch and before anything reads a mode: a failed load
    // leaves the cache empty too, and an empty cache must never fall through to the legacy
    // picker — every submission through it would be rejected for a custom-mode course.
    return (
      <div>
        <p role="alert" style={{ ...ERROR_P, marginTop: 0 }}>
          {gradingError}{' '}
          <button type="button" className="wb-focus-ring wb-dialog-link" onClick={() => onRetry(chosenCourseId)} style={RETRY_BTN}>
            Try again
          </button>
        </p>
        {error !== gradingError && errorLine}
      </div>
    );
  }
  if (courseGrading === undefined) {
    // Not cached and not failed, so it is in flight (or about to be — the fetching effect
    // runs after the paint that follows picking a course).
    return (
      <div>
        <p style={{ ...HINT_P, marginTop: 0 }}>Loading this course’s grading setup…</p>
        {errorLine}
      </div>
    );
  }
  if (courseGrading.mode === 'legacy') {
    return (
      <Field label="Counts as" hint="This course is graded on the standard Activity / Quiz / Exam categories." error={error}>
        <select
          className="wb-focus-ring"
          style={FIELD_INPUT}
          value={gradingTarget}
          onChange={e => setGradingTarget(e.target.value as LegacyTarget)}
        >
          {LEGACY_TARGETS.map(t => <option key={t} value={t}>{WORK_SOURCE_LABEL[t]}</option>)}
        </select>
      </Field>
    );
  }
  return (
    <>
      <Field
        label="Grading period"
        hint={courseGrading.periods.length === 0
          ? 'This course’s grading preset has no periods set up — add them in Study Pulse first.'
          : undefined}
      >
        <select
          className="wb-focus-ring"
          style={FIELD_INPUT}
          value={gradingPeriodId === '' ? '' : String(gradingPeriodId)}
          disabled={courseGrading.periods.length === 0}
          onChange={e => onGradingPeriodChange(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">Choose a period…</option>
          {courseGrading.periods.map(p => (
            <option key={p.period_id} value={p.period_id}>{p.name}</option>
          ))}
        </select>
      </Field>

      <Field
        label="Category"
        hint={gradingPeriodId === '' ? 'Choose a grading period first.' : undefined}
        error={error}
      >
        <select
          className="wb-focus-ring"
          style={FIELD_INPUT}
          value={gradingCatId === '' ? '' : String(gradingCatId)}
          disabled={gradingPeriodId === '' || periodCategories.length === 0}
          onChange={e => setGradingCatId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">
            {gradingPeriodId !== '' && periodCategories.length === 0
              ? 'This period has no categories'
              : 'Choose a category…'}
          </option>
          {periodCategories.map(c => (
            <option key={c.cat_id} value={c.cat_id}>{c.name}</option>
          ))}
        </select>
      </Field>
    </>
  );
}
