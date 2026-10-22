'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Link2 } from 'lucide-react';
import type { ClassOccurrence } from '@/lib/workboard/aggregate';
import { validateOverrideModality, type OverrideModality } from '@/lib/workboard/dates';
import { reportTableCellError } from '@/components/workboard/table/tableCellError';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";

export interface AnchorRect { left: number; right: number; top: number; bottom: number }

export type ModalityChoice = 'online_sync' | 'online_async' | 'cancelled' | 'rescheduled' | '';

const OVERRIDE_NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';
const OVERRIDE_SAVE_ERROR    = 'Could not save this schedule change. Please try again.';
const OVERRIDE_REMOVE_ERROR  = 'Could not remove this schedule change. Please try again.';

const POP_WIDTH  = 280;
const POP_GAP    = 6;
const POP_MARGIN = 8;

/** The recurring block's OWN modality — distinct from `ModalityChoice`, which is this week's
 *  one-day exception. Every occurrence has one of these three, never "no exception" the way an
 *  override's modality can be null, so this is a plain three-entry map rather than an
 *  `Exclude<...>` over the override vocabulary. */
const BASE_MODALITY_LABEL: Record<ClassOccurrence['modality'], string> = {
  face_to_face: 'Face to face', online_sync: 'Online (synchronous)', online_async: 'Online (asynchronous)',
};

/** "8:00am–9:30am" — this component's own copy rather than a shared import: `WorkTimelineView`
 *  and `ScheduleMaker` each already have one, in slightly different styles (12-hour AM/PM vs.
 *  raw 24-hour), and this shared popover shouldn't take on a dependency on either caller's. */
function formatTimeRange(start: string, end: string): string {
  const fmt = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}

const DETAIL_LABEL_STYLE: React.CSSProperties = {
  fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700, color: '#8a94a6', flexShrink: 0,
};
const DETAIL_VALUE_STYLE: React.CSSProperties = {
  fontFamily: FONT, fontSize: '0.72rem', fontWeight: 600, color: '#2d3748',
  textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' }}>
      <span style={DETAIL_LABEL_STYLE}>{label}</span>
      <span style={DETAIL_VALUE_STYLE}>{children}</span>
    </div>
  );
}

const POP_INPUT_STYLE: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: '30px', borderRadius: '8px',
  padding: '4px 8px', background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(200,210,230,0.6)', fontFamily: FONT, fontSize: '0.78rem',
  fontWeight: 500, color: '#2d3748',
};
const POP_LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontFamily: FONT, fontSize: '0.68rem', fontWeight: 700,
  color: '#5c6b80', marginBottom: '3px',
};

/** "Sat 9/19" — compact enough for a ghost/make-up card's one extra line. UTC-parsed so it
 *  agrees with every other date-string display in this module (`ClassOverridePopover`'s own
 *  title, `ClassCard`'s ghost/make-up suffix in WorkTimelineView.tsx). */
export function formatShortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC',
  });
}

/** The sibling popovers' message extraction, verbatim (`DeadlineCell`, `LinksPopover`): the
 *  server's own words when it has any, a generic sentence when the body is an HTML error page
 *  or an empty 500. */
async function messageFrom(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  return typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : fallback;
}

/**
 * The single-day schedule-exception editor: cancel a meeting, mark it online, note a one-day
 * room change, or move it to a make-up slot on another day and time.
 *
 * Shared between Workboard's Timeline (a real calendar week, so a click already carries a
 * concrete date) and StudyPulse's ScheduleMaker (a recurring weekly template with no date of
 * its own — its caller computes "this week's occurrence" of the clicked day before opening
 * this popover, the one adaptation the two callers don't share).
 *
 * One occurrence in, one override out, regardless of which of a class's renderings was clicked
 * to get here: a plain occurrence has no `override` yet, so Save issues a `POST` (creating one,
 * keyed to `occurrence.block_id`/`occurrence.date`); a ghost or a make-up already has one
 * (`occurrence.override.id`), so Save issues a `PATCH` to that same row.
 *
 * Portalled because both callers can sit inside a `backdrop-filter` wrapper that would trap a
 * `position: fixed` child's viewport-relative coordinates against that wrapper's box instead of
 * the real viewport. Dismissal (Escape, outside click, scroll/resize) mirrors `DeadlineCell`'s/
 * `LinksPopover`'s. `trigger` is the clicked element itself rather than a ref object — neither
 * caller reparents the clicked card while this popover is open.
 */
export function ClassOverridePopover({
  occurrence, anchor, trigger, onClose, onSaved,
}: {
  occurrence: ClassOccurrence;
  anchor:     AnchorRect;
  trigger:    HTMLElement;
  onClose:    () => void;
  onSaved:    () => void;
}) {
  const ids = useId();
  const modalityId = `${ids}-modality`;
  const dateId     = `${ids}-date`;
  const startId    = `${ids}-start`;
  const endId      = `${ids}-end`;
  const roomId     = `${ids}-room`;
  const noteId     = `${ids}-note`;

  const panelRef = useRef<HTMLDivElement>(null);
  const existing = occurrence.override;

  const [modality, setModality]   = useState<ModalityChoice>((existing?.modality ?? '') as ModalityChoice);
  const [movedDate, setMovedDate] = useState(existing?.moved_date ?? '');
  // Defaults to the occurrence's OWN time when there is no override yet — moving a class to a
  // different day almost always keeps its usual time, so the common case needs only the date
  // field touched rather than all three.
  const [movedStart, setMovedStart] = useState(existing?.moved_start_time ?? occurrence.start_time);
  const [movedEnd, setMovedEnd]     = useState(existing?.moved_end_time ?? occurrence.end_time);
  // Left blank rather than pre-filled with the base room — an empty value means "no change,
  // still whatever the regular schedule says," not "no room at all."
  const [room, setRoom] = useState(existing?.room ?? '');
  const [note, setNote] = useState(existing?.note ?? '');

  const [formError, setFormError]   = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving]     = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const dismiss = () => { onClose(); trigger.focus(); };

  // Room only means something while the occurrence still meets in person — cancelled or online
  // has nowhere to note a room for, and a make-up (rescheduled) meets in person at its new slot
  // unless told otherwise, so it keeps the field too.
  const showRoom = modality === '' || modality === 'rescheduled';

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const { width, height } = panel.getBoundingClientRect();
    let left = anchor.left;
    if (left + width > window.innerWidth - POP_MARGIN) left = window.innerWidth - POP_MARGIN - width;
    if (left < POP_MARGIN) left = POP_MARGIN;
    let top = anchor.bottom + POP_GAP;
    if (top + height > window.innerHeight - POP_MARGIN) {
      const above = anchor.top - height - POP_GAP;
      top = above >= POP_MARGIN ? above : Math.max(POP_MARGIN, window.innerHeight - POP_MARGIN - height);
    }
    setPos({ left, top });
    // Re-measures when `modality` changes: choosing "Rescheduled" (or toggling Room's own
    // visibility) changes the panel's height and can require flipping it above the trigger.
  }, [anchor, modality]);

  useEffect(() => { panelRef.current?.focus(); }, []);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      // A click on the trigger belongs to the trigger — without this the popover would close
      // here and the caller's own click handler would immediately reopen it.
      if (trigger.contains(target)) return;
      onClose();
    };
    const handleScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      dismiss();
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', dismiss);
    };
    // `trigger` and `onClose` are stable for this popover's whole lifetime — it is unmounted and
    // a fresh instance created the moment either would change (a different card is clicked).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (submitting || removing) return;
    const validated = validateOverrideModality({
      modality: modality === '' ? null : modality,
      moved_date: movedDate, moved_start_time: movedStart, moved_end_time: movedEnd,
    });
    if ('error' in validated) { setFormError(validated.error); return; }
    setFormError(null);
    setSubmitting(true);
    try {
      const body = { ...validated, note: note.trim() || null, room: showRoom ? (room.trim() || null) : null };
      const res = existing
        ? await fetch(`/api/workboard/schedule-overrides/${existing.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          }).catch(() => null)
        : await fetch('/api/workboard/schedule-overrides', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, block_id: occurrence.block_id, override_date: occurrence.date }),
          }).catch(() => null);

      if (res === null) { reportTableCellError(OVERRIDE_NETWORK_ERROR); return; }
      if (!res.ok) { setFormError(await messageFrom(res, OVERRIDE_SAVE_ERROR)); return; }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    if (!existing || submitting || removing) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/workboard/schedule-overrides/${existing.id}`, { method: 'DELETE' }).catch(() => null);
      if (res === null) { reportTableCellError(OVERRIDE_NETWORK_ERROR); return; }
      if (!res.ok) { setFormError(await messageFrom(res, OVERRIDE_REMOVE_ERROR)); return; }
      onSaved();
    } finally {
      setRemoving(false);
    }
  };

  const busy = submitting || removing;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Edit ${occurrence.course_code} on ${formatShortDate(occurrence.date)}`}
      tabIndex={-1}
      className="vb-tl-override-pop"
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); } }}
      style={{
        position: 'fixed',
        left: pos?.left ?? 0, top: pos?.top ?? 0,
        opacity: pos === null ? 0 : 1, pointerEvents: pos === null ? 'none' : 'auto',
        zIndex: 40, width: `${POP_WIDTH}px`, boxSizing: 'border-box',
        background: '#fff', borderRadius: '12px', border: '1px solid rgba(200,210,230,0.6)',
        boxShadow: '0 8px 24px rgba(31,38,68,0.18)', padding: '12px',
        display: 'flex', flexDirection: 'column', gap: '10px', fontFamily: FONT,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ minWidth: 0 }}>
          <span style={{
            display: 'block', fontFamily: FONT, fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.04em',
            textTransform: 'uppercase', color: '#5c6b80',
          }}>
            {occurrence.course_code}{occurrence.section ? ` (${occurrence.section})` : ''} · {formatShortDate(occurrence.date)}
          </span>
          {occurrence.subject_name && (
            <span style={{
              display: 'block', fontFamily: FONT, fontSize: '0.76rem', fontWeight: 700, color: '#2d3748',
              marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {occurrence.subject_name}
            </span>
          )}
        </span>
        <button
          type="button" aria-label="Close" onClick={dismiss} className="vb-tl-override-icon-btn"
          style={{
            flex: '0 0 26px', width: '26px', height: '26px', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', borderRadius: '8px',
            background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.6)',
            color: '#5c6b80', cursor: 'pointer', padding: 0,
          }}
        >
          <X size={13} aria-hidden />
        </button>
      </div>

      {/* Everything about this class, always visible — the popover opening IS the "expand", so
          there is no second click behind which any of this hides. Pulled straight off
          `occurrence`: the base recurring schedule's own fields plus the subject metadata
          `getWorkboardWeek`'s query joins in alongside `subject_name` (trimester, year level,
          units) — nothing here is re-fetched. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px 10px',
        borderRadius: '8px', background: 'rgba(116,188,217,0.08)', border: '1px solid rgba(116,188,217,0.2)',
      }}>
        <DetailRow label="Time">{formatTimeRange(occurrence.start_time, occurrence.end_time)}</DetailRow>
        <DetailRow label="Modality">{BASE_MODALITY_LABEL[occurrence.modality]}</DetailRow>
        {occurrence.venue && <DetailRow label="Room">{occurrence.venue}</DetailRow>}
        {occurrence.instructor && <DetailRow label="Instructor">{occurrence.instructor}</DetailRow>}
        {occurrence.meeting_link && (
          <DetailRow label="Link">
            <a
              href={occurrence.meeting_link} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#2a7fa8', textDecoration: 'none' }}
            >
              <Link2 size={11} aria-hidden /> Join
            </a>
          </DetailRow>
        )}
        {occurrence.year_level && <DetailRow label="Year">{occurrence.year_level}</DetailRow>}
        {occurrence.trimester && <DetailRow label="Trimester">{occurrence.trimester}</DetailRow>}
        {occurrence.units !== null && <DetailRow label="Units">{occurrence.units}</DetailRow>}
      </div>

      <div>
        <label htmlFor={modalityId} style={POP_LABEL_STYLE}>This occurrence</label>
        <select
          id={modalityId} className="vb-tl-override-input" value={modality}
          onChange={e => setModality(e.target.value as ModalityChoice)}
          style={POP_INPUT_STYLE}
        >
          <option value="">Face to face class</option>
          <option value="online_sync">Online (synchronous)</option>
          <option value="online_async">Online (asynchronous)</option>
          <option value="cancelled">Cancelled</option>
          <option value="rescheduled">Rescheduled (make-up class)</option>
        </select>
      </div>

      {modality === 'rescheduled' && (
        <>
          <div>
            <label htmlFor={dateId} style={POP_LABEL_STYLE}>Moved to</label>
            <input
              id={dateId} type="date" className="vb-tl-override-input"
              value={movedDate} onChange={e => setMovedDate(e.target.value)} style={POP_INPUT_STYLE}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor={startId} style={POP_LABEL_STYLE}>Start</label>
              <input
                id={startId} type="time" className="vb-tl-override-input"
                value={movedStart} onChange={e => setMovedStart(e.target.value)} style={POP_INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor={endId} style={POP_LABEL_STYLE}>End</label>
              <input
                id={endId} type="time" className="vb-tl-override-input"
                value={movedEnd} onChange={e => setMovedEnd(e.target.value)} style={POP_INPUT_STYLE}
              />
            </div>
          </div>
        </>
      )}

      {showRoom && (
        <div>
          <label htmlFor={roomId} style={POP_LABEL_STYLE}>Room</label>
          <input
            id={roomId} type="text" className="vb-tl-override-input"
            placeholder={occurrence.venue ? `Default: ${occurrence.venue}` : 'e.g. F612'}
            value={room} onChange={e => setRoom(e.target.value)} style={POP_INPUT_STYLE}
          />
        </div>
      )}

      <div>
        <label htmlFor={noteId} style={POP_LABEL_STYLE}>Note (optional)</label>
        <textarea
          id={noteId} className="vb-tl-override-input" value={note} onChange={e => setNote(e.target.value)}
          rows={2} style={{ ...POP_INPUT_STYLE, minHeight: '48px', resize: 'vertical' }}
        />
      </div>

      {formError && (
        // `role="alert"` so a screen-reader user hears why Save did nothing, the same as every
        // other write-failure surface in this module.
        <p role="alert" style={{ margin: 0, fontFamily: FONT, fontSize: '0.72rem', fontWeight: 600, color: '#922e48' }}>
          {formError}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
        {existing ? (
          <button
            type="button" onClick={() => void remove()} disabled={busy} className="vb-tl-override-btn"
            style={{
              minHeight: '30px', padding: '6px 10px', borderRadius: '8px',
              background: 'rgba(224,96,124,0.12)', border: '1px solid rgba(224,96,124,0.4)',
              fontFamily: FONT, fontSize: '0.74rem', fontWeight: 700, color: '#922e48',
              cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.6 : 1,
            }}
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
        ) : <span />}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button" onClick={dismiss} disabled={busy} className="vb-tl-override-btn"
            style={{
              minHeight: '30px', padding: '6px 12px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.6)',
              fontFamily: FONT, fontSize: '0.76rem', fontWeight: 600, color: '#5c6b80', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button" onClick={() => void submit()} disabled={busy} className="vb-tl-override-btn"
            style={{
              minHeight: '30px', padding: '6px 14px', borderRadius: '8px',
              background: '#2a7fa8', border: '1px solid #2a7fa8',
              fontFamily: FONT, fontSize: '0.76rem', fontWeight: 700, color: '#fff',
              cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.7 : 1,
            }}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <style jsx>{`
        .vb-tl-override-input:focus-visible,
        .vb-tl-override-icon-btn:focus-visible,
        .vb-tl-override-btn:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
        .vb-tl-override-input:hover:not(:disabled),
        .vb-tl-override-icon-btn:hover:not(:disabled) {
          border-color: rgba(140,160,190,0.75);
        }
        .vb-tl-override-btn:hover:not(:disabled) {
          filter: brightness(0.97);
        }
      `}</style>
    </div>,
    document.body,
  );
}
