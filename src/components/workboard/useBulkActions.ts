'use client';

import { useEffect, useState } from 'react';
import type { WorkItem, WorkPriority } from '@/lib/workboard/workItems';
import { STAGES_BY_CONTEXT, STAGE_LABELS, isStageLegal, isWaitingStage, type WorkContext, type WorkStage } from '@/lib/workboard/workContexts';
import { runBulk, summariseBulk } from '@/lib/workboard/ui/bulk';
import { scheduleDelete, flushAll } from '@/lib/workboard/ui/deferredDelete';
import { itemKey } from '@/lib/workboard/ui/itemKey';
import { patchItem, deleteOwnedItem } from './workApi';
import { toastUndo, toastError, toastInfo, UNDO_MS } from './ui/WbToaster';
import type { BulkStatusOption } from './ui/WbBulkBar';

/** Status options for the bulk bar: the context's own stages, or under My Work the three
 *  normalised statuses, which every context accepts. */
export function bulkStatusOptions(context: WorkContext | 'all'): BulkStatusOption[] {
  const stages: WorkStage[] = context === 'all' ? ['todo', 'in_progress', 'done'] : STAGES_BY_CONTEXT[context];
  return stages.map(s => ({ value: s, label: STAGE_LABELS[s] }));
}

type Snapshot = { item: WorkItem; body: Record<string, unknown> };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function useBulkActions({ refresh, hide, unhide }: {
  refresh: () => Promise<void>;
  hide: (keys: string[]) => void;
  unhide: (keys: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);

  // Leaving the Workboard (client navigation) unmounts the Undo toast without onExpire, so send
  // any deletes still waiting. Third trigger of the one clock, with expiry and pagehide.
  useEffect(() => () => flushAll(), []);

  const apply = async (
    sel: WorkItem[],
    verb: string,
    build: (item: WorkItem) => Record<string, unknown> | null,
    snapshot: (item: WorkItem) => Record<string, unknown>,
  ): Promise<void> => {
    setBusy(true);
    const before: Snapshot[] = sel.map(item => ({ item, body: snapshot(item) }));
    // runBulk never rejects, and a failed refresh must not leave the bar disabled.
    const r = await runBulk(sel, item => { const body = build(item); return body ? patchItem(item, body) : null; });
    await refresh().catch(() => {});
    setBusy(false);
    const message = summariseBulk(verb, r);
    if (r.failed.length > 0) {
      toastError(message, () => apply(r.failed, verb, build, snapshot));
      return;
    }
    if (r.ok.length === 0) { toastInfo(message); return; }
    const okKeys = new Set(r.ok.map(itemKey));
    toastUndo(message, async () => {
      const undo = await runBulk(before.filter(b => okKeys.has(itemKey(b.item))), b => patchItem(b.item, b.body));
      if (undo.failed.length > 0) toastError(`Couldn't undo ${plural(undo.failed.length, 'item')}`);
      await refresh().catch(() => {});
    });
  };

  const setStatus = (sel: WorkItem[], value: string) => apply(
    sel, 'updated',
    item => (isStageLegal(item.context, value) ? { work_stage: value } : null),
    // Same as the single-item path: restoring a waiting stage restores its reason too.
    // blocked_since is re-stamped by the server on the restore, an accepted limitation.
    item => (isWaitingStage(item.work_stage)
      ? { work_stage: item.work_stage, blocked_reason: item.blocked_reason }
      : { work_stage: item.work_stage }),
  );

  const setPriority = (sel: WorkItem[], p: WorkPriority) => apply(
    sel, 'updated', () => ({ priority: p }), item => ({ priority: item.priority }),
  );

  const setDeadline = (sel: WorkItem[], dueAt: string | null) => apply(
    sel, 'updated',
    item => (dueAt === null ? { due_at: null, deadline_time: null } : { due_at: dueAt, deadline_time: item.deadline_time }),
    item => ({ due_at: item.due_at, deadline_time: item.deadline_time }),
  );

  /** Plan ruling R3: owned items only; deletes wait out the Undo window (spec 12). */
  const remove = (sel: WorkItem[]) => {
    const owned = sel.filter(i => i.source === 'owned');
    const skipped = sel.length - owned.length;
    if (owned.length === 0) { toastError('Academic items are deleted from Study Pulse, not here'); return; }
    const keys = owned.map(itemKey);
    hide(keys);
    const handles = owned.map(item => scheduleDelete(
      itemKey(item),
      keepalive => deleteOwnedItem(item.id, { keepalive }),
    ));
    const message = `${plural(owned.length, 'item')} deleted${skipped ? ` · ${plural(skipped, 'academic item')} skipped` : ''}`;
    let expired = false;
    // No timer: the toast is the only clock (a separate timer keeps running while Sonner pauses
    // on hover or a hidden tab). The DELETEs go on expiry, or on pagehide with keepalive.
    const onUndo = async () => {
      const sentKeys: string[] = [];
      const keptKeys: string[] = [];
      handles.forEach((h, i) => (h.cancel() ? keptKeys : sentKeys).push(keys[i]));
      unhide(keptKeys);
      if (sentKeys.length === 0) return;
      toastError(`${sentKeys.length} ${sentKeys.length === 1 ? 'item was' : 'items were'} already deleted`);
      await refresh().catch(() => {});
      unhide(sentKeys);
    };
    toastUndo(message, onUndo, {
      duration: UNDO_MS,
      // Sonner can report both auto-close and dismiss; flush once, then reveal any row whose
      // DELETE failed (a no-op for rows the refresh removed).
      onExpire: () => {
        if (expired) return;
        expired = true;
        void (async () => {
          const settled = await Promise.allSettled(handles.map(h => h.flush()));
          const failed = settled.filter(s => s.status === 'rejected' || (s.value instanceof Response && !s.value.ok)).length;
          await refresh().catch(() => {});
          unhide(keys);
          if (failed > 0) toastError(`Couldn't delete ${plural(failed, 'item')}`);
        })();
      },
    });
  };

  return { setStatus, setPriority, setDeadline, remove, busy };
}
