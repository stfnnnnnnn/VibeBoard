import { isRevisionStage, isWaitingStage, normaliseStage, type WorkStage } from '../workContexts';

/** A stage's glow-dot colour (refine spec §3), shared by the Table's status pill and the Board's
 *  lane headers. Revision and waiting are checked first because `normaliseStage` folds both into
 *  `in_progress`. To do is the one flat (no outer glow) dot. */
export function statusDot(stage: WorkStage): { color: string; flat: boolean } {
  if (isRevisionStage(stage)) return { color: 'var(--wb-st-revision)', flat: false };
  if (isWaitingStage(stage))  return { color: 'var(--wb-st-waiting)',  flat: false };
  switch (normaliseStage(stage)) {
    case 'in_progress': return { color: 'var(--wb-st-progress)', flat: false };
    case 'done':        return { color: 'var(--wb-st-done)',     flat: false };
    // `todo`, and an unrecognised stored stage (for which `normaliseStage` returns undefined).
    default:            return { color: 'var(--wb-st-todo)',     flat: true };
  }
}
