'use client';

import Link from 'next/link';
import { Loader2, X } from 'lucide-react';
import type { UndoToastApi } from './useUndoToast';

/**
 * The hub's single toast (spec §6 C5, mockup v1c .toast): a dark pill at the bottom centre with Undo and/or a link.
 * role="status" lives on an always-mounted wrapper so screen readers announce each new message.
 * Motion: enters with a 220ms translate + fade (@starting-style), leaves the way it came in 160ms; both are
 * transitions, so a toast replaced mid-entry retargets instead of restarting.
 */
export default function UndoToast({ api }: { api: UndoToastApi }) {
  const { toast, dismiss, pause, resume, runUndo } = api;
  return (
    <div className="sp-toast-host" role="status" aria-live="polite">
      {toast && (
        <div
          key={toast.id}
          className={`sp-toast${toast.leaving ? ' is-leaving' : ''}`}
          onPointerEnter={pause}
          onPointerLeave={resume}
          onFocus={pause}
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume(); }}
        >
          <span className="sp-toast__msg">{toast.message}</span>
          {toast.undo && (
            <button type="button" className="sp-toast__btn sp-focus-ring" onClick={runUndo} disabled={toast.undoing}>
              {toast.undoing ? <><Loader2 size={13} className="sp-spin" aria-hidden /> Undoing…</> : 'Undo'}
            </button>
          )}
          {toast.link && (
            <Link className="sp-toast__btn sp-focus-ring" href={toast.link.href}>{toast.link.label}</Link>
          )}
          <button type="button" className="sp-toast__x sp-focus-ring" onClick={dismiss} aria-label="Dismiss">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
