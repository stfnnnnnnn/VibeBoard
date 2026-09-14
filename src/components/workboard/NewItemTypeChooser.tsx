'use client';

import { useEffect, useRef } from 'react';
import { CheckSquare, CalendarClock, Bell, type LucideIcon } from 'lucide-react';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";
const HEADER_FONT = "'DM Sans','Segoe UI',sans-serif";

export type NewItemType = 'task' | 'event' | 'reminder';

const OPTIONS: { type: NewItemType; label: string; blurb: string; Icon: LucideIcon }[] = [
  {
    type: 'task',
    label: 'Task',
    blurb: 'Something to do, with a due date and a stage — Academic, Projects, Organization or Life.',
    Icon: CheckSquare,
  },
  {
    type: 'event',
    label: 'Event',
    blurb: 'A block of time on a specific day — a meeting, a trip, anything with a start and an end.',
    Icon: CalendarClock,
  },
  {
    type: 'reminder',
    label: 'Reminder',
    blurb: 'A single moment to be nudged about. No stage, no duration — just a title and a time.',
    Icon: Bell,
  },
];

/**
 * The first screen of "New Work Item" (Google Calendar's own create flow is the closest
 * reference — Event/Task/Reminder ahead of any of their own fields). It exists because a Task
 * and an Event/Reminder are genuinely different rows in different tables (`workboard_work_items`
 * vs `workboard_items` — see `aggregate.ts`'s `WorkboardEventItem`), not three spellings of one
 * form: Task opens the existing, unchanged `WorkItemDialog`; Event and Reminder open
 * `WorkboardEventDialog`. This chooser is the one seam that decides which, so neither of those
 * two dialogs has to know the other exists.
 *
 * Deliberately its own small overlay rather than a step bolted onto `WorkItemDialog` — that
 * component is already large, and its Academic/Project/Organization/Life branching has nothing
 * to gain from also branching on Task-vs-Event at its root. Every "New Work Item" entry point
 * (the shell's header button, and each view's own empty-state button) opens THIS first; only
 * a Task choice goes on to open the dialog those buttons used to open directly.
 */
export default function NewItemTypeChooser({
  onChoose, onClose,
}: {
  onChoose: (type: NewItemType) => void;
  onClose:  () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    firstButtonRef.current?.focus();
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
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('button:not([disabled])'),
    ).filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

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
        aria-labelledby="newItemChooserHeading"
        onKeyDown={handleKeyDown}
        style={{
          width: 'min(420px, 100%)', boxSizing: 'border-box',
          background: '#fbfbfd', borderRadius: '20px', border: '1px solid rgba(200,210,230,0.6)',
          boxShadow: '0 20px 60px rgba(31,38,68,0.35)', padding: '22px',
        }}
      >
        <h2
          id="newItemChooserHeading"
          style={{ margin: '0 0 16px', fontFamily: HEADER_FONT, fontSize: '1.05rem', fontWeight: 800, color: '#2d3748' }}
        >
          What are you adding?
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {OPTIONS.map((opt, i) => (
            <button
              key={opt.type}
              ref={i === 0 ? firstButtonRef : undefined}
              type="button"
              className="vb-new-item-option"
              onClick={() => onChoose(opt.type)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '12px', width: '100%',
                textAlign: 'left', padding: '12px 14px', borderRadius: '14px',
                background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.6)',
                cursor: 'pointer',
              }}
            >
              <span style={{
                flexShrink: 0, width: '34px', height: '34px', borderRadius: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(116,188,217,0.16)', color: '#256f92',
              }}>
                <opt.Icon size={17} aria-hidden />
              </span>
              <span>
                <span style={{ display: 'block', fontFamily: HEADER_FONT, fontSize: '0.88rem', fontWeight: 700, color: '#2d3748' }}>
                  {opt.label}
                </span>
                <span style={{ display: 'block', fontFamily: FONT, fontSize: '0.76rem', color: '#5c6b80', marginTop: '2px' }}>
                  {opt.blurb}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <style jsx global>{`
        .vb-new-item-option:hover,
        .vb-new-item-option:focus-visible {
          border-color: rgba(116,188,217,0.75);
          background: rgba(116,188,217,0.1);
        }
        .vb-new-item-option:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
