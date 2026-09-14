'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
// Type-only — `aggregate.ts` reaches `pool` (mysql2) at module scope for its *value* exports
// (`getWorkboardWeek`), but `import type` is erased entirely, so none of that reaches this
// client bundle. Same shape `WorkboardShell.tsx`'s own `WorkboardWeek` import already uses.
import type { WorkboardEventItem } from '@/lib/workboard/aggregate';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";
const HEADER_FONT = "'DM Sans','Segoe UI',sans-serif";

const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontFamily: FONT, fontSize: '0.78rem', fontWeight: 700,
  color: '#5c6b80', marginBottom: '6px',
};

const CONTROL_STYLE: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: '40px', borderRadius: '10px',
  padding: '8px 12px', background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(200,210,230,0.6)', fontFamily: FONT, fontSize: '0.85rem',
  fontWeight: 500, color: '#2d3748',
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={LABEL_STYLE}>{label}</label>
      {children}
      {hint && <p style={{ margin: '6px 0 0', fontFamily: FONT, fontSize: '0.72rem', color: '#8a94a6' }}>{hint}</p>}
    </div>
  );
}

export type EventDialogTarget =
  | { mode: 'create'; itemType: 'event' | 'reminder' }
  | { mode: 'edit'; item: WorkboardEventItem };

const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

async function messageFrom(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  return typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : fallback;
}

/** Splits a stored "YYYY-MM-DD HH:MM:SS" (or null) into the separate date/time draft strings
 *  this dialog's native `<input type="date">`/`<input type="time">` pair needs — the same
 *  two-input shape every other Workboard editor uses (`DeadlineCell`, `WorkItemDialog`), never
 *  a combined `datetime-local` control. */
function splitDatetime(value: string | null): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  return { date: value.slice(0, 10), time: value.slice(11, 16) };
}

/** The inverse of `splitDatetime`, built explicitly with a space separator rather than trusting
 *  a `T`-joined ISO string to reach MySQL's DATETIME parser unchanged across versions. Returns
 *  null when either half is missing — the caller's validation is what guarantees that never
 *  happens for a field this function is actually asked to combine. */
function toMysqlDatetime(date: string, time: string): string | null {
  if (!date || !time) return null;
  return `${date} ${time}:00`;
}

/**
 * Create or edit a Workboard Event or Reminder — `workboard_items`' two kinds, which
 * `NewItemTypeChooser` routes here for (Task stays on the unchanged `WorkItemDialog`). Follows
 * that dialog's exact overlay shape (backdrop, Escape, outside-click, Tab trap, opener-focus
 * restore) as its own independent copy rather than a shared import, the same reasoning
 * `WorkboardShell.tsx`'s `GLASS` gives for its own triplicated constant: this file must never
 * gain a reason to import anything that reaches `pool` (mysql2) at module scope, and importing
 * from the much larger `WorkItemDialog.tsx` would tie this dialog's bundle to that one's.
 *
 * Event and Reminder share this one component because they share a table and an API
 * (`workboard_items`/`/api/workboard/items`) — only the middle of the form (a start/end range
 * vs. a single remind-at moment) differs, exactly mirroring the shape `WorkboardEventItem`
 * itself already draws between the two.
 */
export default function WorkboardEventDialog({
  target, onClose, onSaved,
}: {
  target: EventDialogTarget;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const editingItem = target.mode === 'edit' ? target.item : null;
  const itemType = target.mode === 'edit' ? target.item.item_type : target.itemType;

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(editingItem?.title ?? '');
  const [location, setLocation] = useState(editingItem?.location ?? '');
  const [note, setNote] = useState(editingItem?.note ?? '');

  const startSplit = splitDatetime(editingItem?.starts_at ?? null);
  const endSplit = splitDatetime(editingItem?.ends_at ?? null);
  const remindSplit = splitDatetime(editingItem?.remind_at ?? null);
  const [startDate, setStartDate] = useState(startSplit.date);
  const [startTime, setStartTime] = useState(startSplit.time);
  const [endDate, setEndDate] = useState(endSplit.date);
  const [endTime, setEndTime] = useState(endSplit.time);
  const [remindDate, setRemindDate] = useState(remindSplit.date);
  const [remindTime, setRemindTime] = useState(remindSplit.time);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function handleBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'),
    ).filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || deleting) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setFormError('A title is required.'); return; }

    let startsAt: string | null = null;
    let endsAt: string | null = null;
    let remindAt: string | null = null;

    if (itemType === 'event') {
      startsAt = toMysqlDatetime(startDate, startTime);
      endsAt = toMysqlDatetime(endDate, endTime);
      if (!startsAt || !endsAt) { setFormError('Start and end date/time are both required.'); return; }
      if (endsAt <= startsAt) { setFormError('End must be after start.'); return; }
    } else {
      remindAt = toMysqlDatetime(remindDate, remindTime);
      if (!remindAt) { setFormError('A reminder date and time are required.'); return; }
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const body = {
        title: trimmedTitle, location: location.trim() || null, note: note.trim() || null,
        starts_at: startsAt, ends_at: endsAt, remind_at: remindAt,
      };
      const res = editingItem
        ? await fetch(`/api/workboard/items/${editingItem.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          }).catch(() => null)
        : await fetch('/api/workboard/items', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, item_type: itemType }),
          }).catch(() => null);

      if (res === null) { setFormError(NETWORK_ERROR); return; }
      if (!res.ok) { setFormError(await messageFrom(res, 'Could not save. Please try again.')); return; }
      await onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editingItem || submitting || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workboard/items/${editingItem.id}`, { method: 'DELETE' }).catch(() => null);
      if (res === null) { setFormError(NETWORK_ERROR); return; }
      if (!res.ok) { setFormError(await messageFrom(res, 'Could not delete. Please try again.')); return; }
      await onSaved();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  const heading = target.mode === 'create'
    ? (itemType === 'event' ? 'New Event' : 'New Reminder')
    : (itemType === 'event' ? 'Edit Event' : 'Edit Reminder');
  const busy = submitting || deleting;

  return (
    <div
      className="vb-dialog-backdrop"
      onMouseDown={handleBackdropMouseDown}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,24,38,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="eventDialogHeading"
        onKeyDown={handleKeyDown}
        style={{
          width: 'min(480px, 100%)', maxHeight: '88vh', overflowY: 'auto', boxSizing: 'border-box',
          background: '#fbfbfd', borderRadius: '20px', border: '1px solid rgba(200,210,230,0.6)',
          boxShadow: '0 20px 60px rgba(31,38,68,0.35)', padding: '24px', position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '18px' }}>
          <h2 id="eventDialogHeading" style={{ margin: 0, fontFamily: HEADER_FONT, fontSize: '1.1rem', fontWeight: 800, color: '#2d3748' }}>
            {heading}
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            style={{
              width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: '8px', color: '#5c6b80', cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <Field label="Title">
            <input
              ref={firstFieldRef}
              type="text"
              style={CONTROL_STYLE}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={itemType === 'event' ? 'What\'s the event?' : 'What should this remind you of?'}
              required
            />
          </Field>

          {itemType === 'event' ? (
            <>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <Field label="Start date">
                    <input type="date" style={CONTROL_STYLE} value={startDate} onChange={e => setStartDate(e.target.value)} required />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Start time">
                    <input type="time" style={CONTROL_STYLE} value={startTime} onChange={e => setStartTime(e.target.value)} required />
                  </Field>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <Field label="End date">
                    <input type="date" style={CONTROL_STYLE} value={endDate} onChange={e => setEndDate(e.target.value)} required />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="End time">
                    <input type="time" style={CONTROL_STYLE} value={endTime} onChange={e => setEndTime(e.target.value)} required />
                  </Field>
                </div>
              </div>
              <Field label="Location" hint="Optional.">
                <input type="text" style={CONTROL_STYLE} value={location} onChange={e => setLocation(e.target.value)} />
              </Field>
            </>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <Field label="Date">
                  <input type="date" style={CONTROL_STYLE} value={remindDate} onChange={e => setRemindDate(e.target.value)} required />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Time">
                  <input type="time" style={CONTROL_STYLE} value={remindTime} onChange={e => setRemindTime(e.target.value)} required />
                </Field>
              </div>
            </div>
          )}

          <Field label="Note" hint="Optional.">
            <textarea
              style={{ ...CONTROL_STYLE, minHeight: '72px', resize: 'vertical' }}
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </Field>

          {formError && (
            <p role="alert" style={{ margin: '0 0 16px', fontFamily: FONT, fontSize: '0.78rem', fontWeight: 600, color: '#922e48' }}>
              {formError}
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
            {editingItem ? (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={busy}
                style={{
                  minHeight: '38px', padding: '8px 16px', borderRadius: '10px',
                  background: 'rgba(224,96,124,0.12)', border: '1px solid rgba(224,96,124,0.4)',
                  fontFamily: FONT, fontSize: '0.82rem', fontWeight: 700, color: '#922e48',
                  cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.6 : 1,
                }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            ) : <span />}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                style={{
                  minHeight: '38px', padding: '8px 18px', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.6)',
                  fontFamily: FONT, fontSize: '0.82rem', fontWeight: 600, color: '#5c6b80', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                style={{
                  minHeight: '38px', padding: '8px 20px', borderRadius: '10px',
                  background: '#c0507c', border: '1px solid #c0507c',
                  fontFamily: FONT, fontSize: '0.82rem', fontWeight: 700, color: '#fff',
                  cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.7 : 1,
                }}
              >
                {submitting ? 'Saving…' : target.mode === 'create' ? 'Create' : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
