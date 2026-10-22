/**
 * How an interactive Table cell (and the detail drawer, which shares it) tells the user a
 * write failed: an error toast with Retry (spec 14).
 *
 * ClassOverridePopover also calls this, and StudyPulse's ScheduleMaker mounts it with no
 * Toaster on the page; there a toast would be invisible, so fall back to `window.alert`.
 *
 * Not a hook and not a component: it is called from inside an async handler *after* an
 * `await`, where a hook may not be. Callers revert their optimistic value *before* calling
 * this; `retry` re-runs the caller's own save with the same arguments.
 */
import { isToasterMounted, toastError } from '../ui/WbToaster';

export function reportTableCellError(message: string, retry?: () => void | Promise<void>): void {
  if (isToasterMounted()) toastError(message, retry);
  else window.alert(message);
}
