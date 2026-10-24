'use client';

import Link from 'next/link';
import { Loader2, X } from 'lucide-react';
import type { UndoToastApi } from './useUndoToast';

/**
 * The hub's single toast (spec §6 C5, mockup v1c .toast): a dark pill at the bottom centre with Undo and/or a link.
 * The message is announced from its own always-mounted role="status" span; the buttons sit outside that live region, so
 * a reader hears "Added to IT321 · Finals › Quizzes", not "… Undo Dismiss". The visible copy is hidden from readers
 * to avoid hearing it twice.
 * Motion: enters with a 220ms translate + fade (@starting-style), leaves the way it came in 160ms; both are
 * transitions, so a toast replaced mid-entry retargets instead of restarting.
 */
export default function UndoToast({ api }: { api: UndoToastApi }) {
  const { toast, dismiss, pause, resume, runUndo } = api;
  return (
    <div className="sp-toast-host">
      <span className="sp-sr-only" role="status" aria-live="polite">{toast && !toast.leaving ? toast.message : ''}</span>
      {toast && (
        <div
          key={toast.id}
          className={`sp-toast${toast.leaving ? ' is-leaving' : ''}`}
          onPointerEnter={pause}
          onPointerLeave={resume}
          onFocus={pause}
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume(); }}
        >
          <span className="sp-toast__msg" id={`sp-toast-msg-${toast.id}`} aria-hidden>{toast.message}</span>
          {toast.undo && (
            <button type="button" className="sp-toast__btn sp-focus-ring" onClick={runUndo} disabled={toast.undoing}
              aria-describedby={`sp-toast-msg-${toast.id}`}>
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
