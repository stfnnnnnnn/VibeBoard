'use client';

import { useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import WbOverlay from './ui/WbOverlay';
import { FIELD_GROUP, FIELD_HINT, FIELD_INPUT, FIELD_LABEL } from './dialog/dialogStyles';
// Pool-free (see its module header).
import { addDays, manilaNowDatetime } from '@/lib/workboard/dates';
// Type-only — `aggregate.ts` reaches `pool` (mysql2) at module scope for its *value* exports
// (`getWorkboardWeek`), but `import type` is erased entirely, so none of that reaches this
// client bundle. Same shape `WorkboardShell.tsx`'s own `WorkboardWeek` import already uses.
import type { WorkboardEventItem } from '@/lib/workboard/aggregate';

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} style={FIELD_LABEL}>{label}</label>
      {children}
      {hint && <p style={{ ...FIELD_HINT, marginBottom: 0 }}>{hint}</p>}
    </div>
  );
}

const ROW: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

export type EventDialogTarget =
  /** `initialTitle` (ruling R6): pre-fills the title; an event lands on today 09:00-10:00, a
   *  reminder on the next whole hour today (tomorrow 09:00 if that crosses midnight). */
  | { mode: 'create'; itemType: 'event' | 'reminder'; initialTitle?: string }
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
 * `NewItemTypeChooser` routes here for (Task stays on `WorkItemDialog`). The overlay mechanics
 * (scrim, Escape, outside click, Tab trap, opener-focus restore, scroll lock) come from
 * `WbOverlay`; the form styles from the pool-free `dialog/dialogStyles.ts`.
 *
 * Event and Reminder share this one component because they share a table and an API
 * (`workboard_items`/`/api/workboard/items`) — only the middle of the form (a start/end range
 * vs. a single remind-at moment) differs, exactly mirroring the shape `WorkboardEventItem`
 * itself already draws between the two.
 */
export default function WorkboardEventDialog({
  open = true, instant = false, target, onClose, onSaved,
}: {
  /** Defaults to true so a plain conditional render keeps working; pass usePresence's flag to play the exit. */
  open?: boolean;
  /** Opened from the keyboard: no enter animation (spec 4.3). */
  instant?: boolean;
  target: EventDialogTarget;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const editingItem = target.mode === 'edit' ? target.item : null;
  const itemType = target.mode === 'edit' ? target.item.item_type : target.itemType;

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  // R6: a create carrying a title (e.g. from the palette) also gets a default time, in Manila time.
  const prefill = target.mode === 'create' && target.initialTitle !== undefined;
  const now = prefill ? manilaNowDatetime() : '';
  const today = now.slice(0, 10);
  const nextHour = prefill ? Number(now.slice(11, 13)) + 1 : 0;
  const reminderDefault = nextHour >= 24
    ? { date: addDays(today, 1), time: '09:00' }
    : { date: today, time: `${String(nextHour).padStart(2, '0')}:00` };

  const [title, setTitle] = useState(
    editingItem?.title ?? (target.mode === 'create' ? target.initialTitle ?? '' : ''),
  );
  const [location, setLocation] = useState(editingItem?.location ?? '');
  const [note, setNote] = useState(editingItem?.note ?? '');

  const startSplit = prefill ? { date: today, time: '09:00' } : splitDatetime(editingItem?.starts_at ?? null);
  const endSplit = prefill ? { date: today, time: '10:00' } : splitDatetime(editingItem?.ends_at ?? null);
  const remindSplit = prefill ? reminderDefault : splitDatetime(editingItem?.remind_at ?? null);
  const [startDate, setStartDate] = useState(startSplit.date);
  const [startTime, setStartTime] = useState(startSplit.time);
  const [endDate, setEndDate] = useState(endSplit.date);
  const [endTime, setEndTime] = useState(endSplit.time);
  const [remindDate, setRemindDate] = useState(remindSplit.date);
  const [remindTime, setRemindTime] = useState(remindSplit.time);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function handleFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      // requestSubmit keeps native `required` validation in the path, same as clicking Create.
      formRef.current?.requestSubmit();
    }
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
    <WbOverlay
      open={open}
      instant={instant}
      onClose={onClose}
      variant="modal"
      labelledBy="eventDialogHeading"
      initialFocusRef={firstFieldRef}
      panelStyle={{ width: 'min(480px, calc(100vw - 32px))', padding: 20 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 id="eventDialogHeading" style={{ margin: 0, font: '800 var(--wb-fs-20) var(--wb-font-head)', color: 'var(--wb-text)' }}>
          {heading}
        </h2>
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          className="wb-pressable"
          style={{
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', borderRadius: 'var(--wb-r-md)',
            color: 'var(--wb-text-muted)', cursor: 'pointer',
          }}
        >
          <X size={18} />
        </button>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} style={FIELD_GROUP}>
        {formError && (
          <p
            role="alert"
            style={{
              margin: 0, padding: '8px 12px', borderRadius: 'var(--wb-r-md)',
              background: 'var(--wb-danger-bg)', color: 'var(--wb-danger)',
              font: '600 var(--wb-fs-13) var(--wb-font-ui)',
            }}
          >
            {formError}
          </p>
        )}

        <Field label="Title" htmlFor={fid('title')}>
          <input
            id={fid('title')}
            ref={firstFieldRef}
            type="text"
            style={FIELD_INPUT}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={itemType === 'event' ? 'What\'s the event?' : 'What should this remind you of?'}
            required
          />
        </Field>

        {itemType === 'event' ? (
          <>
            <div style={ROW}>
              <Field label="Start date" htmlFor={fid('sd')}>
                <input id={fid('sd')} type="date" style={FIELD_INPUT} value={startDate} onChange={e => setStartDate(e.target.value)} required />
              </Field>
              <Field label="Start time" htmlFor={fid('st')}>
                <input id={fid('st')} type="time" style={FIELD_INPUT} value={startTime} onChange={e => setStartTime(e.target.value)} required />
              </Field>
            </div>
            <div style={ROW}>
              <Field label="End date" htmlFor={fid('ed')}>
                <input id={fid('ed')} type="date" style={FIELD_INPUT} value={endDate} onChange={e => setEndDate(e.target.value)} required />
              </Field>
              <Field label="End time" htmlFor={fid('et')}>
                <input id={fid('et')} type="time" style={FIELD_INPUT} value={endTime} onChange={e => setEndTime(e.target.value)} required />
              </Field>
            </div>
            <Field label="Location" htmlFor={fid('loc')} hint="Optional.">
              <input id={fid('loc')} type="text" style={FIELD_INPUT} value={location} onChange={e => setLocation(e.target.value)} />
            </Field>
          </>
        ) : (
          <div style={ROW}>
            <Field label="Date" htmlFor={fid('rd')}>
              <input id={fid('rd')} type="date" style={FIELD_INPUT} value={remindDate} onChange={e => setRemindDate(e.target.value)} required />
            </Field>
            <Field label="Time" htmlFor={fid('rt')}>
              <input id={fid('rt')} type="time" style={FIELD_INPUT} value={remindTime} onChange={e => setRemindTime(e.target.value)} required />
            </Field>
          </div>
        )}

        <Field label="Note" htmlFor={fid('note')} hint="Optional.">
          <textarea
            id={fid('note')}
            style={{ ...FIELD_INPUT, minHeight: 72, resize: 'vertical' }}
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </Field>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 4 }}>
          {editingItem ? (
            <button
              type="button"
              className="wb-pressable"
              onClick={() => void handleDelete()}
              disabled={busy}
              aria-busy={deleting || undefined}
              style={{
                minHeight: 38, padding: '8px 16px', borderRadius: 'var(--wb-r-lg)',
                background: 'var(--wb-danger-bg)', border: '1px solid color-mix(in srgb, var(--wb-danger) 35%, transparent)',
                font: '700 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-danger)',
                cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.6 : 1,
              }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          ) : <span />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="wb-add-trigger"
              onClick={onClose}
              disabled={busy}
              style={{ minHeight: 38, padding: '8px 14px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="vb-btn-pink wb-pressable"
              disabled={busy}
              aria-busy={submitting || undefined}
              aria-keyshortcuts="Control+Enter"
            >
              {submitting ? 'Saving…' : target.mode === 'create' ? 'Create' : 'Save changes'}
            </button>
          </div>
        </div>
      </form>
    </WbOverlay>
  );
}
