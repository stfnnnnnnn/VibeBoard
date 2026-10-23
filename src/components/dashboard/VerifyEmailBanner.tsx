'use client';
import { useEffect, useState } from 'react';

/* Spec §7.4: shown only to accounts whose email isn't confirmed yet. Dismiss lasts for the browser session. */
export default function VerifyEmailBanner() {
  const [hidden, setHidden] = useState(true);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'cooldown'>('idle');
  useEffect(() => { try { setHidden(sessionStorage.getItem('vb-verify-dismissed') === '1'); } catch { setHidden(false); } }, []);
  if (hidden) return null;

  async function resend() {
    setState('sending');
    const r = await fetch('/api/auth/verify/resend', { method: 'POST' });
    setState(r.status === 429 ? 'cooldown' : 'sent');
  }
  return (
    <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, justifyContent: 'space-between',
      background: 'rgba(255,255,255,.85)', border: '1px solid rgba(31,27,43,.08)', borderRadius: 14, padding: '12px 16px',
      margin: '0 0 20px', fontSize: 15, color: '#1f1b2b' }}>
      <span>
        {state === 'sent' ? 'Sent! Check your inbox for the confirmation link.'
          : state === 'cooldown' ? 'We just sent one. Give it a minute before trying again.'
          : 'Confirm your email so you can always reset your password.'}
      </span>
      <span style={{ display: 'flex', gap: 14 }}>
        {state === 'idle' && <button type="button" onClick={resend} style={{ background: 'none', border: 0, color: '#d9628c', fontWeight: 700, cursor: 'pointer', fontSize: 15, minHeight: 44 }}>Resend</button>}
        <button type="button" onClick={() => { try { sessionStorage.setItem('vb-verify-dismissed', '1'); } catch { /* storage blocked */ } setHidden(true); }}
          style={{ background: 'none', border: 0, color: '#6b6478', cursor: 'pointer', fontSize: 15, minHeight: 44 }}>Dismiss</button>
      </span>
    </div>
  );
}
