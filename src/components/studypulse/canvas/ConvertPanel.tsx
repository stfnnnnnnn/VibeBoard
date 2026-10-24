'use client';

import { useEffect, useId, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import InfoTip from '@/components/studypulse/ui/InfoTip';
import {
  DEST_LABEL, DESTINATIONS,
  type AnnouncementItem, type Destination, type PickerPeriod, type ScheduleBlockOption,
} from './types';

/* Ported from the old CanvasAnnouncementBank: the same drafts, the same validation (in the same order, with the same
   messages, shown inline instead of alert()) and the same include payload, plus a per-destination `note` (spec §6.1). */
interface EventDraft { title: string; location: string; starts_at: string; ends_at: string; user_subject_id: number | null }
interface ReminderDraft { title: string; remind_at: string }
interface ScheduleChangeDraft { block_id: number | null; override_date: string; modality: 'online_sync' | 'online_async' | 'cancelled' }
type LegacyTable = 'activities' | 'quizzes' | 'exams';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NOTE_MAX = 1000;
const NOTE_WARN = 900; // the counter appears near the limit

/** Where each destination's note ends up (the ⓘ beside "Note"). */
const NOTE_WHERE: Record<Destination, string> = {
  task: 'It shows under Notes on the Workboard item, and next to the entry in StudyPulse.',
  event: 'It shows under Notes on the Workboard event.',
  reminder: 'It shows under Notes on the Workboard reminder.',
  schedule_change: 'It is saved with the schedule change for that class meeting.',
};

/** A pre-fill longer than the limit (an announcement full of "Bring …" lines) is cut at the last whole sentence that
 *  fits, so the form never opens already over 1,000 characters. */
function fitNote(s: string): string {
  if (s.length <= NOTE_MAX) return s;
  const head = s.slice(0, NOTE_MAX + 1);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  return cut > 0 ? s.slice(0, cut + 1) : s.slice(0, NOTE_MAX).trimEnd();
}

/** "2026-10-30 13:00" (what the drafts hold, as before) → the datetime-local input's "2026-10-30T13:00". */
const dtValue = (v: string) => v.replace(' ', 'T');

export type DestinationPayload = Record<string, unknown>;

/**
 * "Turn this into" (spec §6 C4, mockup v1c annView()): destination tabs, each with a real include checkbox and a
 * "Suggested" mark; the active tab's short form, ending in a Note; then Include/Remove, Dismiss and Convert (n).
 * Keyed by announcement in the parent, so every draft starts fresh for each announcement, as the old Include did.
 */
export default function ConvertPanel({ item, loadPeriods, loadBlocks, busy, serverError, onConvert, onDismiss }: {
  item: AnnouncementItem;
  loadPeriods: (subjectId: number) => Promise<PickerPeriod[]>;
  loadBlocks: () => Promise<ScheduleBlockOption[]>;
  busy: 'convert' | 'dismiss' | null;
  serverError: string | null;
  onConvert: (destinations: DestinationPayload[]) => void;
  onDismiss: () => void;
}) {
  const uid = useId();
  const customMode = item.subject_mode === 'custom';
  const subjectId = item.user_subject_id!;
  const [checked, setChecked] = useState<Set<Destination>>(() => new Set(item.suggested_destinations));
  const [active, setActive] = useState<Destination>(item.suggested_destinations[0] ?? 'task');
  const [error, setError] = useState<string | null>(null);

  // Task sub-form (legacy/custom picker — same fields as before)
  const [targetType, setTargetType] = useState<LegacyTable>(item.suggested_category.kind === 'legacy' ? item.suggested_category.target : 'activities');
  const [deadline, setDeadline] = useState('');
  const [periods, setPeriods] = useState<PickerPeriod[] | null>(null);
  const [periodsErr, setPeriodsErr] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [catId, setCatId] = useState<number | null>(null);

  // Event / Reminder / Schedule change sub-forms
  const [eventDraft, setEventDraft] = useState<EventDraft>({ title: item.title, location: '', starts_at: '', ends_at: '', user_subject_id: item.user_subject_id });
  const [reminderDraft, setReminderDraft] = useState<ReminderDraft>({ title: item.title, remind_at: '' });
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleChangeDraft>({ block_id: null, override_date: '', modality: 'online_sync' });
  const [blocks, setBlocks] = useState<ScheduleBlockOption[] | null>(null);
  const [blocksErr, setBlocksErr] = useState(false);

  // One note per destination, each pre-filled from the announcement (spec §6.1).
  const [notes, setNotes] = useState<Record<Destination, string>>(() => {
    const n = fitNote(item.suggested_note);
    return { task: n, event: n, reminder: n, schedule_change: n };
  });

  useEffect(() => {
    let live = true;
    if (customMode) {
      loadPeriods(subjectId).then(
        ps => { if (live) setPeriods(ps); },
        (err: Error) => { if (live) setPeriodsErr(err.message || 'Couldn’t load this subject’s grading periods.'); },
      );
    }
    loadBlocks().then(
      bs => { if (live) setBlocks(bs); },
      err => { console.error('Failed to load schedule blocks:', err); if (live) { setBlocks([]); setBlocksErr(true); } },
    );
    return () => { live = false; };
  }, [customMode, subjectId, loadPeriods, loadBlocks]);

  const toggle = (d: Destination) => {
    setError(null);
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  };

  /** Picking a period auto-preselects a category matching the suggestion, if that period has one. */
  const handlePeriodChange = (newPeriodId: number) => {
    setPeriodId(newPeriodId);
    const period = periods?.find(p => p.period_id === newPeriodId);
    const suggestion = item.suggested_category.kind === 'custom' ? item.suggested_category.categoryName : null;
    const match = suggestion ? period?.categories.find(c => c.name === suggestion) : null;
    setCatId(match ? match.cat_id : null);
  };

  /** The old confirmInclude's checks and body, in the same order. A failed check opens that destination's tab. */
  const convert = () => {
    const destinations: DestinationPayload[] = [];
    const fail = (d: Destination | null, msg: string) => { setError(msg); if (d) setActive(d); };
    const noteOf = (d: Destination) => notes[d] || null;
    for (const d of DESTINATIONS) {
      if (checked.has(d) && notes[d].trim().length > NOTE_MAX) { fail(d, `The ${DEST_LABEL[d].toLowerCase()} note is over 1,000 characters.`); return; }
    }

    if (checked.has('task')) {
      if (!deadline) { fail('task', 'Choose a deadline for the Task destination'); return; }
      if (customMode) {
        if (periodId == null || catId == null) { fail('task', 'Choose a grading period and category for the Task destination'); return; }
        destinations.push({ type: 'task', target_type: 'grade_entries', period_id: periodId, cat_id: catId, deadline, note: noteOf('task') });
      } else {
        destinations.push({ type: 'task', target_type: targetType, deadline, note: noteOf('task') });
      }
    }
    if (checked.has('event')) {
      if (!eventDraft.title || !eventDraft.starts_at || !eventDraft.ends_at) { fail('event', 'Fill in the Event title, start, and end time'); return; }
      destinations.push({
        type: 'event', title: eventDraft.title, location: eventDraft.location || null,
        starts_at: eventDraft.starts_at, ends_at: eventDraft.ends_at, user_subject_id: eventDraft.user_subject_id, note: noteOf('event'),
      });
    }
    if (checked.has('reminder')) {
      if (!reminderDraft.title) { fail('reminder', 'Fill in the Reminder title'); return; }
      destinations.push({ type: 'reminder', title: reminderDraft.title, remind_at: reminderDraft.remind_at || null, note: noteOf('reminder') });
    }
    if (checked.has('schedule_change')) {
      if (!scheduleDraft.block_id || !scheduleDraft.override_date) { fail('schedule_change', 'Choose a class meeting and date for the Schedule Change destination'); return; }
      destinations.push({
        type: 'schedule_change', block_id: scheduleDraft.block_id, override_date: scheduleDraft.override_date,
        modality: scheduleDraft.modality, note: noteOf('schedule_change'),
      });
    }
    if (destinations.length === 0) { fail(null, 'Check at least one destination'); return; }
    setError(null);
    onConvert(destinations);
  };

  const n = checked.size;
  const shownError = error ?? serverError;
  const tabId = (d: Destination) => `${uid}-dt-${d}`;
  const formId = `${uid}-form`;
  const field = (d: string) => `${uid}-${d}`;
  const period = periods?.find(p => p.period_id === periodId) ?? null;
  const note = notes[active];
  const disabled = busy !== null;

  return (
    <section className="sp-turn" aria-labelledby={`${uid}-h`}>
      <div className="sp-turn__head">
        <h3 id={`${uid}-h`}>Turn this into</h3>
        <span className="sp-turn__lead">Pick one or more. Suggested ones are marked.</span>
      </div>

      <div className="sp-dtabs" role="group" aria-label="Destinations">
        {DESTINATIONS.map(d => {
          const on = checked.has(d);
          const sug = item.suggested_destinations.includes(d);
          return (
            <div key={d} className={`sp-dtab${active === d ? ' is-active' : ''}${on ? ' is-in' : ''}`}>
              <label className="sp-dtab__chk">
                <input type="checkbox" className="sp-check sp-focus-ring" checked={on} disabled={disabled}
                  onChange={() => { toggle(d); if (!on) setActive(d); }}
                  aria-label={`Include the ${DEST_LABEL[d].toLowerCase()} in this conversion`} />
              </label>
              <button type="button" id={tabId(d)} className="sp-dtab__btn sp-focus-ring" aria-controls={formId}
                aria-current={active === d ? 'true' : undefined} onClick={() => setActive(d)}>
                {DEST_LABEL[d]}
                {sug && <span className="sp-dtab__sug">Suggested</span>}
              </button>
            </div>
          );
        })}
      </div>

      <div id={formId} role="group" aria-labelledby={tabId(active)} className="sp-dform">
        {active === 'task' && (
          customMode ? (
            <>
              <label className="sp-dform__f">Due
                <input type="date" className="sp-input sp-input--sm sp-focus-ring" value={deadline} onChange={e => setDeadline(e.target.value)} />
              </label>
              {periodsErr ? <p className="sp-dform__msg sp-dform__msg--err" role="alert">{periodsErr}</p>
              : !periods ? <p className="sp-dform__msg"><Loader2 size={14} className="sp-spin" aria-hidden /> Loading grading periods…</p>
              : periods.length === 0 ? <p className="sp-dform__msg">This subject has no grading periods set up yet.</p>
              : (
                <div className="sp-dform__pair">
                  <label className="sp-dform__f">Period
                    <select className="sp-input sp-input--sm sp-focus-ring" value={periodId ?? ''} onChange={e => handlePeriodChange(Number(e.target.value))}>
                      <option value="" disabled>Period…</option>
                      {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="sp-dform__f">Category
                    <select className="sp-input sp-input--sm sp-focus-ring" value={catId ?? ''} onChange={e => setCatId(Number(e.target.value))} disabled={periodId == null}>
                      <option value="" disabled>Category…</option>
                      {(period?.categories ?? []).map(c => <option key={c.cat_id} value={c.cat_id}>{c.name}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </>
          ) : (
            <>
              <label className="sp-dform__f">Due
                <input type="date" className="sp-input sp-input--sm sp-focus-ring" value={deadline} onChange={e => setDeadline(e.target.value)} />
              </label>
              <label className="sp-dform__f">Add to
                <select className="sp-input sp-input--sm sp-focus-ring" value={targetType} onChange={e => setTargetType(e.target.value as LegacyTable)}>
                  <option value="activities">Activity</option>
                  <option value="quizzes">Quiz</option>
                  <option value="exams">Exam</option>
                </select>
              </label>
            </>
          )
        )}

        {active === 'event' && (
          <>
            <label className="sp-dform__f sp-dform__full">Title
              <input className="sp-input sp-input--sm sp-focus-ring" value={eventDraft.title} onChange={e => setEventDraft(prev => ({ ...prev, title: e.target.value }))} />
            </label>
            <label className="sp-dform__f">Starts
              <input type="datetime-local" className="sp-input sp-input--sm sp-focus-ring" value={dtValue(eventDraft.starts_at)}
                onChange={e => setEventDraft(prev => ({ ...prev, starts_at: e.target.value.replace('T', ' ') }))} />
            </label>
            <label className="sp-dform__f">Ends
              <input type="datetime-local" className="sp-input sp-input--sm sp-focus-ring" value={dtValue(eventDraft.ends_at)}
                onChange={e => setEventDraft(prev => ({ ...prev, ends_at: e.target.value.replace('T', ' ') }))} />
            </label>
            <label className="sp-dform__f sp-dform__full">Location
              <input className="sp-input sp-input--sm sp-focus-ring" placeholder="Room or link" value={eventDraft.location}
                onChange={e => setEventDraft(prev => ({ ...prev, location: e.target.value }))} />
            </label>
          </>
        )}

        {active === 'reminder' && (
          <>
            <label className="sp-dform__f sp-dform__full">Remind me to
              <input className="sp-input sp-input--sm sp-focus-ring" value={reminderDraft.title} onChange={e => setReminderDraft(prev => ({ ...prev, title: e.target.value }))} />
            </label>
            <label className="sp-dform__f">When
              <input type="datetime-local" className="sp-input sp-input--sm sp-focus-ring" value={dtValue(reminderDraft.remind_at)}
                onChange={e => setReminderDraft(prev => ({ ...prev, remind_at: e.target.value.replace('T', ' ') }))} />
            </label>
          </>
        )}

        {active === 'schedule_change' && (
          <>
            <label className="sp-dform__f sp-dform__full">Class meeting
              <select className="sp-input sp-input--sm sp-focus-ring" value={scheduleDraft.block_id ?? ''}
                onChange={e => setScheduleDraft(prev => ({ ...prev, block_id: Number(e.target.value) }))}>
                <option value="" disabled>{blocks === null ? 'Loading your classes…' : blocks.length ? 'Class meeting…' : 'No classes in your schedule'}</option>
                {(blocks ?? []).map(b => (
                  <option key={b.block_id} value={b.block_id}>{b.course_code}{b.section ? ` (${b.section})` : ''} — {DAY_NAMES[b.day_of_week]}</option>
                ))}
              </select>
            </label>
            {blocksErr && <p className="sp-dform__msg sp-dform__msg--err sp-dform__full" role="alert">Couldn’t load your class schedule. Reopen this announcement to try again.</p>}
            <label className="sp-dform__f">Date
              <input type="date" className="sp-input sp-input--sm sp-focus-ring" value={scheduleDraft.override_date}
                onChange={e => setScheduleDraft(prev => ({ ...prev, override_date: e.target.value }))} />
            </label>
            <label className="sp-dform__f">Becomes
              <select className="sp-input sp-input--sm sp-focus-ring" value={scheduleDraft.modality}
                onChange={e => setScheduleDraft(prev => ({ ...prev, modality: e.target.value as ScheduleChangeDraft['modality'] }))}>
                <option value="online_sync">Online (synchronous)</option>
                <option value="online_async">Online (asynchronous)</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </>
        )}

        {/* Every form ends with the Note (spec §6.1): one value per destination, pre-filled from the announcement. */}
        <div className="sp-dform__f sp-dform__full">
          <span className="sp-dform__lbl">
            <label htmlFor={field('note')}>Note</label>
            {item.suggested_note && <span className="sp-dform__from">From the announcement</span>}
            <InfoTip label="Where this note shows">
              {item.suggested_note ? 'Extra details from the announcement, like what to bring or the coverage, land here. ' : 'Anything to remember, like what to bring or the coverage. '}
              {NOTE_WHERE[active]}
            </InfoTip>
          </span>
          <textarea id={field('note')} className="sp-input sp-input--sm sp-dform__note sp-focus-ring" rows={2} maxLength={NOTE_MAX}
            placeholder="Anything to remember: what to bring, coverage, room…" value={note}
            aria-describedby={note.length >= NOTE_WARN ? field('count') : undefined}
            onChange={e => { const v = e.target.value; setNotes(prev => ({ ...prev, [active]: v })); }} />
          {note.length >= NOTE_WARN && (
            <span id={field('count')} className={`sp-dform__count sp-num${note.length > NOTE_MAX ? ' is-over' : ''}`}>
              {note.length.toLocaleString('en-US')} / 1,000
            </span>
          )}
        </div>
      </div>

      {shownError && <p className="sp-turn__err" role="alert">{shownError}</p>}

      <div className="sp-turn__foot">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-focus-ring" disabled={disabled} onClick={() => toggle(active)}>
          {checked.has(active) ? 'Remove from this conversion' : `Include this ${DEST_LABEL[active].toLowerCase()}`}
        </button>
        <span className="sp-turn__end">
          <button type="button" className="sp-btn sp-btn--quiet sp-btn--sm sp-focus-ring" disabled={disabled} onClick={onDismiss}>
            {busy === 'dismiss' && <Loader2 size={14} className="sp-spin" aria-hidden />} Dismiss
          </button>
          <button type="button" className="sp-btn sp-btn--primary sp-btn--sm sp-focus-ring sp-num" disabled={disabled || n === 0} onClick={convert}>
            {busy === 'convert' ? <Loader2 size={14} className="sp-spin" aria-hidden /> : <Check size={14} aria-hidden />} Convert{n ? ` (${n})` : ''}
          </button>
        </span>
      </div>
    </section>
  );
}
