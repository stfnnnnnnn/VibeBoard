'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface ProfileInfo {
  name: string; email: string; verified: boolean; googleLinked: boolean; canvasConnected: boolean;
}

/** Avatar account menu (spec §5.6). Esc / outside click close it; Tab is trapped while open. */
export default function ProfilePopover({ profile, signOut }: { profile: ProfileInfo; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); if (refocus) button.current?.focus(); }, reduce ? 0 : 120);
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) close(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(true); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const f = Array.from(panel.current.querySelectorAll<HTMLElement>('a, button'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const yes = (on: boolean, label: string) => <span style={{ fontWeight: 700, color: on ? '#1f7a52' : '#6b6b80' }}>{on ? label : 'Not yet'}</span>;

  return (
    <div ref={wrap} className="db-profile">
      <button
        ref={button} type="button" className="db-avatar"
        aria-haspopup="dialog" aria-expanded={open} aria-label={`Account menu for ${profile.name}`}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span><b>{profile.name.trim().charAt(0).toUpperCase() || 'V'}</b></span>
      </button>
      {open && (
        <div ref={panel} role="dialog" aria-label="Account" className="db-popover db-panel" data-closing={closing || undefined}>
          <h2>{profile.name}</h2>
          <div className="db-sub">{profile.email}</div>
          <ul>
            <li><span>Email</span>{yes(profile.verified, 'Verified')}</li>
            <li><span>Google</span>{yes(profile.googleLinked, 'Linked')}</li>
            <li><span>Canvas</span>{yes(profile.canvasConnected, 'Connected')}</li>
          </ul>
          <div className="db-pop-actions">
            <Link href="/forgot-password">Reset password</Link>
            <form action={signOut}><button type="submit">Sign out</button></form>
          </div>
        </div>
      )}
    </div>
  );
}
