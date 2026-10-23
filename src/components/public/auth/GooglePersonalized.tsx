'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import GoogleButton from './GoogleButton';

type GsiId = {
  initialize: (o: Record<string, unknown>) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
};
declare global { interface Window { google?: { accounts?: { id?: GsiId } } } }

/* Google's own personalized "Continue as …" button (spec §4.3, D7). Falls back to the plain OAuth button
   if the script is blocked, slow (>3 s), or NEXT_PUBLIC_GOOGLE_CLIENT_ID is missing. Never auto-selects. */
export default function GooglePersonalized({ onCredential, fallbackLabel }: { onCredential: (c: string) => void; fallbackLabel?: string }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [failed, setFailed] = useState(!clientId);
  const [rendered, setRendered] = useState(false);

  const render = useCallback(() => {
    const gid = window.google?.accounts?.id;
    if (!gid || !host.current || !clientId) { setFailed(true); return; }
    gid.initialize({
      client_id: clientId,
      callback: (r: { credential?: string }) => { if (r.credential) cb.current(r.credential); },
      use_fedcm_for_button: true,
      auto_select: false,
      itp_support: true,
    });
    const night = document.documentElement.dataset.daypart === 'night';
    gid.renderButton(host.current, {
      type: 'standard', theme: night ? 'filled_black' : 'outline', shape: 'pill', size: 'large',
      text: 'continue_with', logo_alignment: 'left', width: Math.min(host.current.offsetWidth || 352, 400),
    });
    setRendered(true);
  }, [clientId]);

  useEffect(() => {
    if (failed) return;
    if (window.google?.accounts?.id) { render(); return; }
    const t = setTimeout(() => { if (!window.google?.accounts?.id) setFailed(true); }, 3000);
    return () => clearTimeout(t);
  }, [failed, render]);

  if (failed) return <GoogleButton label={fallbackLabel} />;
  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={render} onError={() => setFailed(true)} />
      <div ref={host} className="pub-gis" aria-busy={!rendered} />
    </>
  );
}
