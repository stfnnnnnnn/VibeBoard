import type { DueState } from '../dueSemantics';

/** The only due states with their own colour: §6's overdue red and §2a's darkened amber (the
 *  only AA-passing amber text colour) for completed-late. Every other state takes the surface's
 *  ordinary text colour. */
export const DUE_ACCENT: Partial<Record<DueState, string>> = {
  overdue:        'var(--wb-danger)',
  completed_late: 'var(--wb-warn)',
};

/** A due date's colour on a meta line (Table cell and phone card, Board card): the accent, else
 *  the muted meta colour. Keyed by `DueState` so a new state fails the build here. */
export const DUE_COLOR: Record<DueState, string> = {
  none:           'var(--wb-text-muted)',
  upcoming:       'var(--wb-text-muted)',
  due_today:      'var(--wb-text-muted)',
  completed:      'var(--wb-text-muted)',
  completed_late: 'var(--wb-warn)',
  overdue:        'var(--wb-danger)',
};

/** The textual half of the lateness signal, for a bare date that would otherwise convey it by
 *  colour alone. */
export const DUE_SR_SUFFIX: Partial<Record<DueState, string>> = {
  overdue:        ' (overdue)',
  completed_late: ' (completed late)',
};
