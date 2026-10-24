'use client';

import { useState, useEffect, useRef } from 'react';
import { GraduationCap, Link2, Loader2, ChevronDown } from 'lucide-react';
import { buildBookmarkletHref } from '@/lib/canvas/bookmarklet';

const PAIR_POLL_MS = 3000;

/**
 * The bookmarklet pairing flow, ported from the old CanvasConnectPanel: POST /api/canvas/pair/start makes a code, then
 * the code's status is polled every 3 s until it is used (reload) or expires (pairing cleared, error set). Shared by
 * the not-connected panel and the profile card's Reconnect.
 */
export function usePairing() {
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => stopPolling, []);

  const startPairing = async () => {
    stopPolling();
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch('/api/canvas/pair/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not start Canvas connect');
      const expiresAt = new Date(data.expires_at).getTime();
      setPairing({ code: data.code, expiresAt });

      pollRef.current = setInterval(async () => {
        // Expired: drop the dead button (and its "Waiting…" spinner) so the caller shows its start button again.
        if (Date.now() > expiresAt) {
          stopPolling();
          setPairing(null);
          setError('That connect button expired. Start again to get a new one.');
          return;
        }
        try {
          const statusRes  = await fetch(`/api/canvas/pair/start?code=${encodeURIComponent(data.code)}`);
          const statusData = await statusRes.json();
          if (statusData.used) {
            stopPolling();
            window.location.reload();
          }
        } catch {
          // transient poll failure — try again on the next tick
        }
      }, PAIR_POLL_MS);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, pairing, startPairing };
}

/** The draggable bookmarklet, plus a live "waiting" line while the code is being polled. */
export function BookmarkletLink({ code }: { code: string }) {
  // React sanitizes `href` values that look like `javascript:` URLs when set through JSX
  // (a built-in XSS mitigation) and refuses to apply them — a real bookmarklet link only
  // works if the attribute is set directly on the DOM node, bypassing React's own diffing.
  const anchorRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    anchorRef.current?.setAttribute('href', buildBookmarkletHref(code, window.location.origin));
  }, [code]);

  return (
    <div className="sp-bm">
      <a ref={anchorRef} onClick={e => e.preventDefault()} className="sp-btn sp-btn--primary sp-bm__link sp-focus-ring">
        <Link2 size={15} aria-hidden /> Connect to Canvas
      </a>
      <p className="sp-bm__hint">
        Drag this to your bookmarks bar, then go to your Canvas site and click it. Expires in 10 minutes.
      </p>
      <p className="sp-bm__wait"><Loader2 size={14} className="sp-spin" aria-hidden /> Waiting for Canvas…</p>
    </div>
  );
}

/** Not connected (spec §6 C2): replaces the whole Overview with the pairing flow, restyled on the sp- tokens. */
export default function ConnectPanel() {
  const { busy: pairBusy, error: pairError, pairing, startPairing } = usePairing();
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [baseUrl, setBaseUrl]       = useState('');
  const [token, setToken]           = useState('');

  const connectManual = async () => {
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch('/api/canvas/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: baseUrl, access_token: token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Connection failed');
      setToken('');
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shownError = error ?? pairError;

  return (
    <section className="sp-panel sp-connect" aria-labelledby="sp-connect-title">
      <div className="sp-connect__head">
        <span className="sp-badge sp-badge--lg" aria-hidden><GraduationCap size={22} /></span>
        <div>
          <h2 id="sp-connect-title" className="sp-connect__title">Connect Canvas</h2>
          <p className="sp-connect__lead">
            Bring your Canvas assignments and announcements into StudyPulse. Nothing is added to a subject until you say so.
          </p>
        </div>
      </div>

      <ol className="sp-connect__steps">
        <li className={pairing ? 'is-done' : 'is-current'}>
          <span className="sp-connect__n sp-num" aria-hidden>1</span>
          <div className="sp-connect__body">
            <b>Start connecting</b>
            {!pairing ? (
              <>
                <span>Click Connect, then drag the button that appears to your bookmarks bar.</span>
                <button type="button" className="sp-btn sp-btn--primary sp-focus-ring" onClick={startPairing} disabled={pairBusy}>
                  {pairBusy ? <><Loader2 size={15} className="sp-spin" aria-hidden /> Starting…</> : 'Connect'}
                </button>
              </>
            ) : <span>Your connect button is ready.</span>}
          </div>
        </li>
        <li className={pairing ? 'is-current' : ''}>
          <span className="sp-connect__n sp-num" aria-hidden>2</span>
          <div className="sp-connect__body">
            <b>Drag it to your bookmarks bar, then click it on Canvas</b>
            {pairing ? <BookmarkletLink code={pairing.code} /> : <span>This page updates by itself once Canvas answers.</span>}
          </div>
        </li>
      </ol>

      <div className="sp-connect__manual">
        <button type="button" className="sp-link sp-focus-ring" aria-expanded={showManual} onClick={() => setShowManual(v => !v)}>
          {showManual ? 'Hide manual option' : 'Paste a token manually instead'}
          <ChevronDown size={14} className={`sp-chev${showManual ? ' is-open' : ''}`} aria-hidden />
        </button>
        <div className={`sp-collapse${showManual ? ' is-open' : ''}`}>
          <div className="sp-collapse__inner" inert={!showManual}>
            <div className="sp-connect__form">
              <label className="sp-connect__field">
                <span>Canvas address</span>
                <input className="sp-input" placeholder="https://yourschool.instructure.com" value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)} />
              </label>
              <label className="sp-connect__field">
                <span>Access token</span>
                <input className="sp-input" placeholder="Paste your Canvas access token" value={token} type="password"
                  onChange={e => setToken(e.target.value)} />
              </label>
              <button type="button" className="sp-btn sp-btn--dark sp-focus-ring" onClick={connectManual}
                disabled={busy || !baseUrl || !token}>
                {busy ? <><Loader2 size={15} className="sp-spin" aria-hidden /> Connecting…</> : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {shownError && <p className="sp-form-error" role="alert">{shownError}</p>}
    </section>
  );
}
