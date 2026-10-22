/** The domain term is "context". The database column is still `category` (spec: no
 *  destructive rename) — this module is the single translation point. */
export type WorkContext = 'academic' | 'project' | 'organization' | 'life';

export const WORK_CONTEXTS: WorkContext[] = ['academic', 'project', 'organization', 'life'];

export const CONTEXT_LABELS: Record<WorkContext, string> = {
  academic:     'Academic',
  project:      'Projects',
  organization: 'Organization',
  life:         'Life',
};

export type LifeArea = 'personal' | 'household' | 'errands' | 'finance' | 'health' | 'other';
export const LIFE_AREAS: LifeArea[] = ['personal', 'household', 'errands', 'finance', 'health', 'other'];
export const LIFE_AREA_LABELS: Record<LifeArea, string> = {
  personal: 'Personal', household: 'Household', errands: 'Errands',
  finance: 'Finance', health: 'Health', other: 'Other',
};

/** The normalised three-value status every v2 consumer still reads. */
export type WorkStatus = 'todo' | 'in_progress' | 'done';

/** Per-context vocabularies. Stored as VARCHAR(24) so adding a state later is not a
 *  migration — which is exactly why the service layer must validate legality. */
export type WorkStage =
  | 'backlog' | 'todo' | 'in_progress' | 'ready_to_submit'
  | 'submitted' | 'review' | 'blocked' | 'done';

export const STAGES_BY_CONTEXT: Record<WorkContext, WorkStage[]> = {
  academic:     ['todo', 'in_progress', 'ready_to_submit', 'submitted', 'done'],
  project:      ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'],
  organization: ['todo', 'in_progress', 'review', 'blocked', 'done'],
  life:         ['todo', 'in_progress', 'done'],
};

export const STAGE_LABELS: Record<WorkStage, string> = {
  backlog:         'Backlog',
  todo:            'To Do',
  in_progress:     'In Progress',
  ready_to_submit: 'Ready to Submit',
  // Still the same DB value ('submitted') and the same slot in Academic's stage sequence —
  // only the label changed, at the user's request, to name the state that actually needs
  // action (feedback came back asking for changes) rather than the transient "handed in,
  // waiting" moment `STAGE_EMPTY_TEXT`'s "Nothing submitted" once described. It is an
  // active state (normalises to `in_progress`), never done and never overdue.
  submitted:       'For Revision',
  review:          'Review',
  // "Blocked" is retired from every piece of copy this stage produces, at the user's explicit
  // request — the column heading, `STAGE_EMPTY_TEXT.blocked` ("Nothing for revision"), and the
  // card's own fallback badge text (`BoardCard`'s "For revision" when no reason is given) all
  // say "for revision" now. The underlying mechanism (`blocked_reason`/`blocked_since`, the
  // "what is this waiting on?" prompt, the card's "Waiting on X · Nd" badge when a reason IS
  // given, Focus's Waiting section) is untouched — only the bare word "Blocked" was replaced,
  // not the waiting-on/duration language built around it.
  blocked:         'For Revision',
  done:            'Done',
};

/**
 * Collapses a per-context stage to the normalised three-value status that
 * `work_status` stores and every v2 consumer reads. My Work's Board uses these three
 * columns directly (spec §17); `blocked` additionally renders a badge so the state is
 * not lost in the normalised view.
 */
export function normaliseStage(stage: WorkStage): WorkStatus {
  switch (stage) {
    case 'backlog':
    case 'todo':
      return 'todo';
    case 'in_progress':
    case 'ready_to_submit':
    case 'review':
    case 'blocked':
    // "For Revision" is its own active state (user decision, 2026-10-07): pending work,
    // never done — see `isRevisionStage` for its overdue exemption.
    case 'submitted':
      return 'in_progress';
    case 'done':
      return 'done';
  }
}

/** Stages that carry a reason (`blocked_reason`) and a server-stamped `blocked_since`:
 *  Project/Organization's `blocked` ("waiting on") and Academic's `submitted` ("For
 *  Revision" — the revision note). The column names predate the second stage. */
export const WAITING_STAGES: readonly WorkStage[] = ['blocked', 'submitted'];

export function isWaitingStage(stage: string | null | undefined): boolean {
  return stage != null && (WAITING_STAGES as readonly string[]).includes(stage);
}

/** Revision stages are active but never overdue, however far past the due date. Only
 *  `submitted` ("For Revision"); `blocked` keeps normal overdue behaviour. */
export function isRevisionStage(stage: string | null | undefined): boolean {
  return stage === 'submitted';
}

/** The one normalisation of a client-sent `blocked_reason`: trimmed, empty → null, capped at
 *  255 (the column width). Anything that is not a string is null. */
export function normaliseWaitingReason(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 255) : null;
}

/** The waiting badge's text, minus the " · Nd" suffix: "Waiting on X" for `blocked`,
 *  "Revise: X" for `submitted`, "For revision" with no reason. */
export function waitingLabel(stage: WorkStage, reason: string | null): string {
  if (!reason) return 'For revision';
  return stage === 'submitted' ? `Revise: ${reason}` : `Waiting on ${reason}`;
}

/** A stage must belong to its context's vocabulary. Callers reject with 400 rather than
 *  storing a nonsense state — the column is a free string, so this is the only guard. */
export function isStageLegal(context: WorkContext, stage: string): stage is WorkStage {
  return (STAGES_BY_CONTEXT[context] as string[]).includes(stage);
}

/** The default stage for a newly-created item in a given context. */
export function defaultStage(context: WorkContext): WorkStage {
  return 'todo';
}

/** Projects (unlike work items) have no 'life' context — a project is academic,
 *  standalone, or organizational. */
export const PROJECT_CONTEXTS = ['academic', 'project', 'organization'] as const;
export type ProjectContext = typeof PROJECT_CONTEXTS[number];

/**
 * Validates the conditional parent rule for a Workboard project: an academic project
 * requires a course and forbids an organization; an organization project requires an
 * organization and forbids a course; a standalone project forbids both. Returns an
 * error message, or null when the parent shape is legal. Pool-free by design — both
 * the POST and PATCH routes call this so the rule can never diverge between them.
 */
export function validateProjectParent(
  context: string,
  userSubjectId: number | null | undefined,
  organizationId: number | null | undefined,
): string | null {
  if (!(PROJECT_CONTEXTS as readonly string[]).includes(context)) {
    return 'context must be academic, project, or organization';
  }
  if (context === 'academic' && !userSubjectId) {
    return 'An academic project requires a course';
  }
  if (context === 'organization' && !organizationId) {
    return 'An organization project requires an organization';
  }
  if (context === 'project' && (userSubjectId || organizationId)) {
    return 'A standalone project cannot have a course or organization parent';
  }
  if (context === 'academic' && organizationId) {
    return 'An academic project cannot have an organization parent';
  }
  if (context === 'organization' && userSubjectId) {
    return 'An organization project cannot have a course parent';
  }
  return null;
}

/**
 * Whole-branch review Finding I-2, gap 1: a work item's context implies which parent field
 * is required, and this has only ever been enforced client-side (`WorkItemDialog.tsx`) —
 * "the server is the weak half of this seam", flagged at Tasks 26/28/29 and never closed.
 * Deliberately narrow: this closes only the one unambiguous requirement those tasks already
 * established (academic needs a course), not the broader "which fields are legal for which
 * context" question (e.g. whether life should forbid a project) — that is less settled
 * (Task 28's own ruling: an organization item's own organization can legitimately be absent)
 * and risks rejecting a real save if guessed at rather than derived from shipped behavior.
 */
export function validateWorkItemCategoryParent(
  category: string,
  userSubjectId: number | null | undefined,
): string | null {
  if (category === 'academic' && !userSubjectId) {
    return 'An academic work item requires a course';
  }
  return null;
}

/**
 * Whole-branch review Finding I-2, gap 2: a work item's own `organization_id`/
 * `user_subject_id` and its linked project's own must agree when the item independently
 * sets one — the review's concrete example is `organization_id = 5` beside a `project_id`
 * whose own `organization_id` is `7`. The legitimate client flow (`WorkItemDialog.tsx`'s
 * Academic/Organization project pickers, Tasks 26/28) only ever offers a project already
 * scoped to the chosen course/organization, so a real save never disagrees; this exists for
 * a caller that bypasses the dialog. Skipped entirely when the item doesn't independently
 * set the field being cross-checked — this is not a requirement that the item redundantly
 * restate the project's own parent, only that it not contradict it.
 */
export function validateWorkItemProjectConsistency(
  itemUserSubjectId:     number | null | undefined,
  itemOrganizationId:    number | null | undefined,
  projectUserSubjectId:  number | null,
  projectOrganizationId: number | null,
): string | null {
  if (itemUserSubjectId != null && itemUserSubjectId !== projectUserSubjectId) {
    return "This item's course does not match its project's course";
  }
  if (itemOrganizationId != null && itemOrganizationId !== projectOrganizationId) {
    return "This item's organization does not match its project's organization";
  }
  return null;
}
