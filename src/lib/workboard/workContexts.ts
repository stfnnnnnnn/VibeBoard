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
  submitted:       'Submitted',
  review:          'Review',
  blocked:         'Blocked',
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
      return 'in_progress';
    case 'submitted':
    case 'done':
      return 'done';
  }
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
