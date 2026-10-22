'use client';

import type { CSSProperties } from 'react';
import { CheckSquare, CalendarClock, Bell, Check, type LucideIcon } from 'lucide-react';
import WbOverlay from './ui/WbOverlay';

export type NewItemType = 'task' | 'event' | 'reminder';

/** Each type gets its own accent rather than one shared blue for all three (§17's review), as
 *  `--wb-*` tokens: blue for Task, pink for Event, the Projects purple for Reminder. `text` is the
 *  darker pair the icon glyph sits in, for contrast against the accent's wash. */
const ACCENT: Record<NewItemType, { raw: string; text: string; className: string }> = {
  task:     { raw: 'var(--wb-blue)',        text: 'var(--wb-blue-ink)',          className: 'vb-new-item-option--task' },
  event:    { raw: 'var(--wb-pink)',        text: 'var(--wb-ctx-life-text)',     className: 'vb-new-item-option--event' },
  reminder: { raw: 'var(--wb-ctx-project)', text: 'var(--wb-ctx-project-text)', className: 'vb-new-item-option--reminder' },
};

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
 * form: Task opens `WorkItemDialog`; Event and Reminder open `WorkboardEventDialog`. This chooser
 * is the one seam that decides which, so neither of those two dialogs has to know the other exists.
 *
 * Overlay mechanics (scrim, Escape, focus trap and restore, scroll lock) come from `WbOverlay`.
 * Each option carries its own accent (see `ACCENT`), and on pointer hover / keyboard focus adds a
 * small lift (2px translate, a soft shadow) on top of its own tint — restrained on purpose (no
 * gradients, no scale) but enough to read as a considered surface rather than a stock list.
 */
export default function NewItemTypeChooser({
  open = true, instant = false, onChoose, onClose,
}: {
  /** Defaults to true so a plain conditional render keeps working; pass usePresence's flag to play the exit. */
  open?: boolean;
  /** Opened from the keyboard: no enter animation (spec 4.3). */
  instant?: boolean;
  onChoose: (type: NewItemType) => void;
  onClose:  () => void;
}) {
  return (
    <WbOverlay
      open={open}
      instant={instant}
      onClose={onClose}
      variant="modal"
      labelledBy="newItemChooserHeading"
      panelStyle={{ width: 'min(520px, calc(100vw - 32px))', padding: 20 }}
    >
      <h2
        id="newItemChooserHeading"
        style={{
          margin: '0 0 4px', font: '800 var(--wb-fs-11) var(--wb-font-head)', color: 'var(--wb-text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}
      >
        What are you adding?
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {OPTIONS.map(opt => {
          const accent = ACCENT[opt.type];
          return (
            <button
              key={opt.type}
              type="button"
              className={`vb-new-item-option wb-pressable ${accent.className}`}
              onClick={() => onChoose(opt.type)}
              style={{
                // Read by the hover/focus rules below, so one rule set serves all three accents.
                ['--accent' as string]: accent.raw,
                display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%',
                textAlign: 'left', padding: '12px 14px', borderRadius: 'var(--wb-r-xl)',
                background: 'var(--wb-hover)', border: '1px solid var(--wb-border)',
                cursor: 'pointer',
              } as CSSProperties}
            >
              <span style={{
                flexShrink: 0, width: 34, height: 34, borderRadius: 'var(--wb-r-lg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `color-mix(in srgb, ${accent.raw} 16%, transparent)`, color: accent.text,
              }}>
                <opt.Icon size={17} aria-hidden />
              </span>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ display: 'block', font: '700 var(--wb-fs-14) var(--wb-font-head)', color: 'var(--wb-text)' }}>
                  {opt.label}
                </span>
                <span style={{ display: 'block', font: '400 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-text-muted)', marginTop: 2 }}>
                  {opt.blurb}
                </span>
              </span>
              {/* A quiet "this is a real choice" affordance rather than a bare hover state; it
                  never fills, so it reads as the option's chrome rather than a stuck checkbox. */}
              <span
                aria-hidden
                className="vb-new-item-check"
                style={{
                  flexShrink: 0, width: 18, height: 18, borderRadius: 'var(--wb-r-sm)', marginTop: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1.5px solid color-mix(in srgb, ${accent.raw} 35%, transparent)`, color: accent.text,
                }}
              >
                <Check size={12} aria-hidden />
              </span>
            </button>
          );
        })}
      </div>

      <style jsx global>{`
        .vb-new-item-option {
          transition: transform var(--wb-dur-fast) var(--wb-ease);
        }
        .vb-new-item-option:focus-visible {
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 2px;
        }
        .vb-new-item-check {
          opacity: 0;
          transition: opacity var(--wb-dur-fast) var(--wb-ease);
        }
        .vb-new-item-option:focus-visible .vb-new-item-check { opacity: 1; }
        /* No lift on keyboard focus: moving focus must not move the cards (spec 4.3 rule 3). */
        .vb-new-item-option:focus-visible {
          border-color: color-mix(in srgb, var(--accent) 55%, transparent);
          background: color-mix(in srgb, var(--accent) 9%, transparent);
          box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 16%, transparent);
        }
        /* Restrained lift, not a bounce: 2px and a soft shadow, the same small-elevation language
           as the Board card hover. Pointer-only, so touch never sticks in the hover state. */
        @media (hover: hover) and (pointer: fine) {
          .vb-new-item-option:hover .vb-new-item-check { opacity: 1; }
          .vb-new-item-option:hover {
            border-color: color-mix(in srgb, var(--accent) 55%, transparent);
            background: color-mix(in srgb, var(--accent) 9%, transparent);
            transform: translateY(-2px);
            box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 16%, transparent);
          }
          /* Keep the lift while pressing; wb-pressable's bare scale would drop it. Specificity
             (0,5,0) beats the shared .wb-pressable press rule (0,4,0) regardless of load order. */
          .vb-new-item-option.wb-pressable:hover:active:not(:disabled) {
            transform: translateY(-2px) scale(0.97);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .vb-new-item-option, .vb-new-item-check { transition: none; }
          .vb-new-item-option:hover, .vb-new-item-option:focus-visible,
          .vb-new-item-option.wb-pressable:hover:active:not(:disabled) { transform: none; }
        }
      `}</style>
    </WbOverlay>
  );
}
