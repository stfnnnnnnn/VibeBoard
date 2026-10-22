'use client';

// The stage-change helpers the Board move, the Table's Status cell and the drawer's status
// select share, so the three paths prompt, fail and undo the same way (spec 10.3, 14).
// Type-only import: `workItems.ts` reaches `pool` at module scope.
import type { WorkItem } from '@/lib/workboard/workItems';
import { STAGE_LABELS, isWaitingStage, type WorkStage } from '@/lib/workboard/workContexts';
import { setWorkStage } from './WorkItemRow';
import { shortWaitingTitle } from './ui/WaitingPopover';
import { toastError, toastUndo } from './ui/WbToaster';

type Report = (message: string, retry?: () => void | Promise<void>) => void;

/** Report what the server said when it said something, else a generic sentence. */
export async function messageFrom(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  return typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : fallback;
}

/** `WaitingPopover`'s prompt for a move into `next`: the revision wording for `submitted`,
 *  the popover's default ("What is … waiting on?") otherwise. */
export function waitingPrompt(next: WorkStage, title: string): string | undefined {
  return next === 'submitted' ? `What needs revising on “${shortWaitingTitle(title)}”?` : undefined;
}

/** A failed stage write. `res` is null when `fetch` itself rejected. Retry is offered only when
 *  the same request could succeed: a network failure or a 5xx. A 4xx is the server refusing
 *  this change (e.g. 409 for a graded academic entry leaving For Revision), so the user gets
 *  the server's reason and no Retry that could never work. */
export async function reportStageFailure(
  res: Response | null,
  opts: { fallback: string; network?: string; retry: () => void | Promise<void>; report?: Report },
): Promise<void> {
  const report = opts.report ?? toastError;
  if (res === null) { report(opts.network ?? opts.fallback, opts.retry); return; }
  const message = await messageFrom(res, opts.fallback);
  report(message, res.status >= 500 ? opts.retry : undefined);
}

/** The Undo toast after a stage change landed. Undo restores the previous stage, and the
 *  previous `blocked_reason` when that stage was itself a waiting stage. `beforeUndo` lets a
 *  control drop its optimistic override before the restore is written. */
export function offerStageUndo(
  item: WorkItem,
  prev: WorkStage,
  prevReason: string | null,
  next: WorkStage,
  onChanged: () => void | Promise<void>,
  opts: { report?: Report; beforeUndo?: () => void } = {},
): void {
  const undo = async () => {
    opts.beforeUndo?.();
    const res = await setWorkStage(item, prev, isWaitingStage(prev) ? prevReason : undefined).catch(() => null);
    if (!res || !res.ok) {
      await reportStageFailure(res, { fallback: `Couldn't undo move of "${item.title}"`, retry: undo, report: opts.report });
      return;
    }
    await onChanged();
  };
  toastUndo(`Moved to ${STAGE_LABELS[next]}`, undo);
}
