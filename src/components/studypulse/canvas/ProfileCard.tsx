'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Link2, Loader2, RefreshCw } from 'lucide-react';
import { BookmarkletLink, usePairing } from './ConnectPanel';
import type { ConnectionStatus } from './types';
import type { ToastInput } from './useUndoToast';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

function ago(seconds: number) {
  if (seconds < 60) return 'Just now';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

const SYNC_TONE = { success: '', partial: 'sp-tone-warn', failed: 'sp-tone-danger' } as const;

/**
 * The Overview's left column (spec §6 C2, mockup v1c .conn): who is connected, a key–value list, and the hub's only
 * sync controls. Sync and Disconnect are the old CanvasConnectPanel's handlers, unchanged; Disconnect now asks first
 * in an inline confirm instead of acting on one click.
 */
export default function ProfileCard({ connection, mapped, fresh, onChange, toast }: {
  connection: ConnectionStatus;
  mapped: number;
  fresh: number;
  onChange: () => void;
  toast: (t: ToastInput) => void;
}) {
  const { busy: pairBusy, error: pairError, pairing, startPairing } = usePairing();
  const [busy, setBusy]       = useState<'sync' | 'disconnect' | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const discRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Focus follows the confirm: onto "Keep connected" when it opens, back to the link when it closes.
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (wasConfirming.current) discRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const disconnect = async () => {
    setBusy('disconnect');
    setError(null);
    try {
      const res = await fetch('/api/canvas/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('Disconnect failed');
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    setBusy('sync');
    setError(null);
    try {
      const res  = await fetch('/api/canvas/sync/manual', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      onChange();
      if (data.status === 'failed') setError('Canvas didn’t answer this sync. Try again, or reconnect if it keeps failing.');
      else toast({ message: data.itemsChanged > 0 ? `Synced · ${data.itemsChanged} update${data.itemsChanged === 1 ? '' : 's'} from Canvas` : 'Synced · everything is up to date' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const invalid = connection.status === 'invalid';
  const name = connection.canvas_user_name ?? 'Canvas user';
  const days = connection.token_days_left ?? null;
  const tokenText = days === null ? 'No expiry set'
    : days < 0 ? 'Expired'
    : days === 0 ? 'Expires today'
    : `Expires in ${days} day${days === 1 ? '' : 's'}`;
  const tokenWarn = days !== null && days < 14;
  const anyBusy = busy !== null;
  const shownError = error ?? pairError;

  return (
    <section className="sp-panel sp-prof" aria-label="Canvas connection">
      <div className="sp-prof__top">
        <span className="sp-prof__avatar" aria-hidden>{initials(name)}</span>
        <div className="sp-prof__who">
          <b>{name}</b>
          {invalid
            ? <span className="sp-chip sp-chip--danger"><AlertTriangle size={12} aria-hidden /> Needs reconnect</span>
            : <span className="sp-chip sp-chip--success"><Check size={12} aria-hidden /> Connected</span>}
        </div>
      </div>

      <dl className="sp-prof__kv sp-num">
        <div>
          <dt>Last sync</dt>
          <dd>
            {connection.last_sync_at && connection.last_sync_age_s != null
              ? <>{ago(connection.last_sync_age_s)}{connection.last_sync_status && <> · <span className={SYNC_TONE[connection.last_sync_status]}>{connection.last_sync_status}</span></>}</>
              : 'Never'}
          </dd>
        </div>
        <div><dt>Auto-sync</dt><dd>Every 30 min</dd></div>
        <div><dt>Access token</dt><dd className={tokenWarn ? 'sp-tone-warn' : undefined}>{tokenWarn && <AlertTriangle size={13} aria-hidden />}{tokenText}</dd></div>
        <div><dt>Courses</dt><dd>{mapped} mapped · {fresh} new</dd></div>
      </dl>

      {invalid ? (
        pairing ? <BookmarkletLink code={pairing.code} /> : (
          <button type="button" className="sp-btn sp-btn--primary sp-prof__main sp-focus-ring" onClick={startPairing} disabled={pairBusy}>
            {pairBusy ? <Loader2 size={16} className="sp-spin" aria-hidden /> : <Link2 size={16} aria-hidden />}
            {pairBusy ? 'Starting…' : 'Reconnect Canvas'}
          </button>
        )
      ) : (
        <button type="button" className="sp-btn sp-btn--primary sp-prof__main sp-focus-ring" onClick={syncNow} disabled={anyBusy} aria-busy={busy === 'sync'}>
          <RefreshCw size={16} className={busy === 'sync' ? 'sp-spin' : undefined} aria-hidden />
          {busy === 'sync' ? 'Syncing…' : 'Sync now'}
        </button>
      )}

      {!invalid && pairing && <div className="sp-prof__pair"><BookmarkletLink code={pairing.code} /></div>}

      <div className="sp-prof__conn">
        {confirming ? (
          <div className="sp-prof__confirm" role="group" aria-label="Disconnect Canvas?"
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setConfirming(false); } }}>
            <span>Disconnect Canvas? Your subjects and entries stay.</span>
            <div className="sp-prof__confirm-btns">
              <button ref={keepRef} type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-focus-ring" onClick={() => setConfirming(false)} disabled={anyBusy}>
                Keep connected
              </button>
              <button type="button" className="sp-btn sp-btn--danger sp-btn--sm sp-focus-ring" onClick={disconnect} disabled={anyBusy}>
                {busy === 'disconnect' ? <><Loader2 size={14} className="sp-spin" aria-hidden /> Disconnecting…</> : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <span className="sp-eyebrow">Connection</span>
            {!invalid && !pairing && (
              <button type="button" className="sp-prof__quiet sp-focus-ring" onClick={startPairing} disabled={pairBusy || anyBusy}>
                {pairBusy ? 'Starting…' : 'Reconnect'}
              </button>
            )}
            <button ref={discRef} type="button" className="sp-prof__danger sp-focus-ring" onClick={() => setConfirming(true)} disabled={anyBusy}>
              Disconnect Canvas
            </button>
          </>
        )}
      </div>
      {shownError && <p className="sp-form-error" role="alert">{shownError}</p>}
    </section>
  );
}
