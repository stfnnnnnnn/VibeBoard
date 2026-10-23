'use client';
import { useState } from 'react';

/* Resend button for the expired /verify-email state, shown only to a signed-in visitor (spec §4.7). */
export default function ResendVerify() {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'already' | 'wait' | 'error'>('idle');

  async function resend() {
    setState('busy');
    try {
      const res = await fetch('/api/auth/verify/resend', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { already?: boolean };
      setState(res.ok ? (data.already ? 'already' : 'sent') : res.status === 429 ? 'wait' : 'error');
    } catch {
      setState('error');
    }
  }

  const msg = state === 'sent' ? 'Sent! Check your inbox.'
    : state === 'already' ? 'Your email is already confirmed.'
    : state === 'wait' ? 'We just sent one. Give it a minute.'
    : state === 'error' ? 'Something went wrong. Please try again.' : null;
  return (
    <>
      <button type="button" className="auth-btn" disabled={state === 'busy' || state === 'sent' || state === 'already'} onClick={resend}>
        {state === 'busy' ? 'Sending…' : 'Resend confirmation email'}
      </button>
      <p className={`auth-hint auth-resend-msg ${state === 'error' ? 'is-error' : ''}`} role="status" aria-live="polite">{msg}</p>
    </>
  );
}
