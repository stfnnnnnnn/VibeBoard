'use client';

import { useEffect, useState } from 'react';
import WbPopover from '@/components/workboard/ui/WbPopover';

/* Inline confirm for deletes that cascade server-side and can't be undone (spec §7.3):
   plans, goals, recurring rules. Replaces window.confirm. */
export default function ConfirmPopover({ open, anchor, onClose, title, body, confirmLabel = 'Delete', onConfirm }: {
  open: boolean; anchor: HTMLElement | null; onClose: () => void; title: string; body?: string; confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /* A reopened confirm starts clean: no error or busy state left over from the last attempt. */
  useEffect(() => { if (open) { setBusy(false); setError(''); } }, [open]);
  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <WbPopover open={open} anchor={anchor} onClose={onClose} width={290} ariaLabel={title} placement="bottom-end">
      <div className="fin-confirm">
        <p className="fin-confirm__title">{title}</p>
        {body && <p className="fin-confirm__body">{body}</p>}
        {error && <p className="fin-error" role="alert">{error}</p>}
        <div className="fin-confirm__row">
          <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="fin-btn fin-btn--danger fin-btn--sm" disabled={busy} onClick={confirm}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </WbPopover>
  );
}
