/** Delete-after-undo-window (spec 12). The row hides immediately; `run` fires on `flush()`
 *  (the Undo toast expiring), after `delayMs` if one is given, or on pagehide with keepalive so
 *  a closed tab still deletes. With no `delayMs` the caller's toast is the only clock. */
type Entry = { timer: number | null; run: (keepalive: boolean) => Promise<unknown>; inflight?: Promise<unknown> };

export interface DeleteHandle {
  /** True only if the delete had not been sent yet and is now cancelled. */
  cancel: () => boolean;
  /** Sends now; resolves when this entry's request settles (at once if it was cancelled or replaced). */
  flush: () => Promise<unknown>;
}

const pending = new Map<string, Entry>();
let listening = false;

function clearTimer(e: Entry) {
  if (e.timer !== null) window.clearTimeout(e.timer);
}

/** Sends every pending delete now, with keepalive (pagehide, or the Workboard unmounting during
 *  client navigation, when the Undo toast unmounts without firing its callbacks). A handle's later
 *  flush() then awaits the recorded request instead of sending again. */
export function flushAll() {
  for (const [key, e] of pending) {
    clearTimer(e);
    e.inflight = e.run(true);
    pending.delete(key);
  }
}

export function scheduleDelete(
  key: string,
  run: (keepalive: boolean) => Promise<unknown>,
  delayMs?: number | null,
): DeleteHandle {
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushAll);
    listening = true;
  }
  const existing = pending.get(key);
  if (existing) clearTimer(existing);
  const entry: Entry = { timer: null, run };
  if (delayMs != null) {
    entry.timer = window.setTimeout(() => {
      if (pending.get(key) !== entry) return;
      pending.delete(key);
      entry.inflight = run(false);
    }, delayMs);
  }
  pending.set(key, entry);
  // A handle only acts on its own entry; a later scheduleDelete for the same key replaces it.
  return {
    cancel: () => {
      if (pending.get(key) !== entry) return false;
      clearTimer(entry);
      pending.delete(key);
      return true;
    },
    flush: () => {
      if (pending.get(key) !== entry) return entry.inflight ?? Promise.resolve();
      clearTimer(entry);
      pending.delete(key);
      entry.inflight = entry.run(false);
      return entry.inflight;
    },
  };
}
