/**
 * How an interactive Table cell tells the user a write failed.
 *
 * One named function called by every cell, rather than each cell holding its own copy of
 * "how a table cell reports failure". The implementation is deliberately *unchanged* from
 * what `StatusCell` shipped with in Task 20 — still `alert`, so behaviour is identical and
 * this is not a toast system — but the decision now lives in one place, so upgrading to a
 * real inline or toast surface is a single edit instead of a hunt through every cell. Task
 * 20's report flagged the second call site as the moment to do this; this is that moment.
 *
 * Not a hook and not a component: it is called from inside an async handler *after* an
 * `await`, where a hook may not be, and it must behave identically for every caller.
 */
export function reportTableCellError(message: string): void {
  // `alert` is modal, so a screen reader announces it with no live-region plumbing of our
  // own — coarse for a dense grid, but never silent. The one thing this must not become is
  // a bare `console.error`, which is exactly the defect the v2 review flagged: a failed
  // write that reverts the control with no explanation reads as the app losing the edit.
  alert(message);
}
