'use client';

import { useEffect, useState } from 'react';
import WbPopover from './WbPopover';

export interface WaitingPopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  title: string;
  /** The label text; defaults to `What is "<title>" waiting on?`. */
  prompt?: string;
  initial?: string;
  confirmLabel?: string;
  onConfirm: (reason: string | null) => void;
  onCancel: () => void;
  /** Passed through to WbPopover: skip the entrance animation (keyboard-opened UI). */
  instant?: boolean;
}

/** The title as quoted in a prompt: capped at 40 characters. */
export function shortWaitingTitle(title: string): string {
  return title.length > 40 ? `${title.slice(0, 40)}…` : title;
}

/** Replaces window.prompt for "waiting on…" (spec 10.3). Empty input confirms with null. */
export default function WaitingPopover({ open, anchor, title, prompt, initial = '', confirmLabel = 'Move', onConfirm, onCancel, instant }: WaitingPopoverProps) {
  const [value, setValue] = useState(initial);
  // WbPopover focuses the [data-autofocus] input once it is positioned.
  useEffect(() => { if (open) setValue(initial); }, [open, initial]);
  const confirm = () => onConfirm(value.trim() ? value.trim().slice(0, 255) : null);
  return (
    <WbPopover open={open} anchor={anchor} onClose={onCancel} ariaLabel="Waiting reason" width={280} instant={instant}>
      <form style={{ display: 'grid', gap: 8, padding: 12 }} onSubmit={e => { e.preventDefault(); confirm(); }}>
        <label style={{ font: '600 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-text)' }}>
          {prompt ?? <>What is &ldquo;{shortWaitingTitle(title)}&rdquo; waiting on?</>}
          <span style={{ fontWeight: 500, color: 'var(--wb-text-muted)' }}> (optional)</span>
          <input data-autofocus value={value} onChange={e => setValue(e.target.value)} maxLength={255}
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '7px 9px', font: '500 var(--wb-fs-14) var(--wb-font-ui)', color: 'var(--wb-text)', background: 'var(--wb-surface)', border: '1px solid var(--wb-border)', borderRadius: 'var(--wb-r-md)' }} />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button type="button" className="wb-add-trigger wb-focus-ring" onClick={onCancel}>Cancel</button>
          <button type="submit" className="vb-btn-pink wb-pressable" style={{ width: 'auto', padding: '6px 14px', minHeight: 32 }}>{confirmLabel}</button>
        </div>
      </form>
    </WbPopover>
  );
}
