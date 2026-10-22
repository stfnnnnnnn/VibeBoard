'use client';

import { useEffect, type CSSProperties } from 'react';
import { Toaster, toast } from 'sonner';

export const UNDO_MS = 5000;

// Shared callers (ClassOverridePopover is also mounted by StudyPulse, which has no Toaster)
// need to know whether a toast would actually be seen.
let mountedToasters = 0;

export function isToasterMounted(): boolean {
  return mountedToasters > 0;
}

export default function WbToaster({ raised }: { raised: boolean }) {
  useEffect(() => {
    mountedToasters += 1;
    return () => { mountedToasters -= 1; };
  }, []);
  return (
    <Toaster
      position="bottom-center"
      offset={raised ? 84 : 16}
      // At <=600px Sonner switches to mobileOffset. The phone bulk bar can wrap to two rows, so
      // rise above its measured height (WbBulkBar publishes --wb-bulkbar-h) rather than a constant.
      mobileOffset={raised ? { bottom: 'calc(var(--wb-bulkbar-h, 48px) + 24px)' } : undefined}
      visibleToasts={3}
      gap={8}
      style={{ '--width': 'min(420px, calc(100vw - 32px))' } as CSSProperties}
      toastOptions={{
        unstyled: true,
        classNames: { toast: 'wb-toast', content: 'wb-toast__content', actionButton: 'wb-toast__action wb-pressable' },
      }}
    />
  );
}

/** Spec 14: Undo for 5s on complete, move, delete and bulk updates. `onExpire` fires only if
 *  the toast closes without Undo; deferred deletes use it to send the DELETE. */
export function toastUndo(
  message: string,
  onUndo: () => void | Promise<void>,
  opts: { duration?: number; onExpire?: () => void } = {},
): void {
  let undone = false;
  toast(message, {
    duration: opts.duration ?? UNDO_MS,
    action: { label: 'Undo', onClick: () => { undone = true; void onUndo(); } },
    onAutoClose: () => { if (!undone) opts.onExpire?.(); },
    onDismiss: () => { if (!undone) opts.onExpire?.(); },
  });
}

export function toastError(message: string, onRetry?: () => void | Promise<void>): void {
  toast(message, {
    duration: 8000,
    className: 'wb-toast--error',
    action: onRetry ? { label: 'Retry', onClick: () => { void onRetry(); } } : undefined,
  });
}

export function toastInfo(message: string): void {
  toast(message, { duration: 3000 });
}
