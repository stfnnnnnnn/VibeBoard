'use client';

import { FIELD_INPUT } from './dialogStyles';
import { WORK_SOURCE_LABEL, type LinkableItem } from './dialogTypes';
import { Field, HINT_P, ERROR_P, INFO_CARD, INFO_TITLE, INFO_BODY, INFO_LINK, RETRY_BTN } from './SharedFields';

/** Path 1, "Link an existing item": shows what the course already has on the board. Writes nothing. */
export default function AcademicLinkExisting({
  chosenCourseId, courseRows, loadingRows, linkableError, linkedItemKey, setLinkedItemKey, pickedItem, onRetry,
}: {
  chosenCourseId: number | null;
  courseRows: LinkableItem[] | undefined;
  loadingRows: boolean;
  linkableError: string | null;
  linkedItemKey: string;
  setLinkedItemKey: (v: string) => void;
  pickedItem: LinkableItem | null;
  onRetry: (courseId: number) => void;
}) {
  if (chosenCourseId === null) {
    return <p style={{ ...HINT_P, marginTop: 0 }}>Pick a course to see what it already has on your board.</p>;
  }
  return (
    <>
      <Field label="Item" hint="Picking one changes nothing — it is already on your board.">
        <select
          className="wb-focus-ring"
          style={FIELD_INPUT}
          value={linkedItemKey}
          disabled={loadingRows || linkableError !== null || (courseRows?.length ?? 0) === 0}
          onChange={e => setLinkedItemKey(e.target.value)}
        >
          <option value="">
            {loadingRows
              ? 'Loading…'
              // A failed load leaves `courseRows` undefined too, which must not read as "this
              // course truly has nothing".
              : linkableError !== null
                ? 'Could not load'
                : (courseRows?.length ?? 0) === 0
                  ? 'Nothing on your board for this course yet'
                  : 'Choose an item…'}
          </option>
          {(courseRows ?? []).map(r => (
            <option key={r.key} value={r.key}>
              {WORK_SOURCE_LABEL[r.source]} · {r.title}
              {r.due_at ? ` · due ${r.due_at.slice(0, 10)}` : ''}
            </option>
          ))}
        </select>
        {linkableError && (
          <p role="alert" style={ERROR_P}>
            {linkableError}{' '}
            <button type="button" className="wb-focus-ring wb-dialog-link" onClick={() => onRetry(chosenCourseId)} style={RETRY_BTN}>
              Try again
            </button>
          </p>
        )}
      </Field>

      {pickedItem && (
        <div style={INFO_CARD}>
          <p style={INFO_TITLE}>{pickedItem.title}</p>
          <p style={INFO_BODY}>
            {pickedItem.source === 'owned'
              ? 'Already here — an independent activity you added to Workboard. There is nothing to create.'
              : 'Already here — Study Pulse puts this on your board automatically. There is nothing to create.'}
          </p>
          <a href={`/studypulse/${chosenCourseId}`} className="wb-focus-ring wb-dialog-link" style={INFO_LINK}>
            Open in Study Pulse →
          </a>
        </div>
      )}
    </>
  );
}
