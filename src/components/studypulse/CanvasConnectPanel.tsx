'use client';

import { useState, useEffect, useRef } from 'react';
import { GraduationCap, AlertTriangle, RefreshCw, Unplug, Link2 } from 'lucide-react';
import { buildBookmarkletHref } from '@/lib/canvas/bookmarklet';

const GLASS: React.CSSProperties = {
  background:           'rgba(255,255,255,0.4)',
  backdropFilter:       'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  borderRadius:         '22px',
  border:               '1px solid rgba(255,255,255,0.4)',
  boxShadow:            '0 8px 24px rgba(31,38,68,0.09)',
};

const pillBtn: React.CSSProperties = {
  border: 'none', borderRadius: '999px', padding: '9px 18px', fontWeight: 700,
  fontSize: '0.84rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
};

export interface ConnectionStatus {
  connected:         boolean;
  canvas_user_name?: string;
  status?:           'active' | 'invalid' | 'disconnected';
  last_sync_at?:     string | null;
  last_sync_status?: 'success' | 'partial' | 'failed' | null;
  token_expires_at?: string | null;
}

const PAIR_POLL_MS = 3000;

export default function CanvasConnectPanel({
  connection, onChange,
}: {
  connection: ConnectionStatus;
  onChange:   () => void;
}) {
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [pairing, setPairing]     = useState<{ code: string; expiresAt: number } | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [baseUrl, setBaseUrl]     = useState('');
  const [token, setToken]         = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => stopPolling, []);

  const startPairing = async () => {
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch('/api/canvas/pair/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not start Canvas connect');
      const expiresAt = new Date(data.expires_at).getTime();
      setPairing({ code: data.code, expiresAt });

      pollRef.current = setInterval(async () => {
        if (Date.now() > expiresAt) { stopPolling(); return; }
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

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/canvas/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('Disconnect failed');
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch('/api/canvas/sync/manual', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const daysUntilExpiry = connection.token_expires_at
    ? Math.ceil((new Date(connection.token_expires_at.replace(' ', 'T') + 'Z').getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const showExpiryWarning = connection.connected && connection.status === 'active'
    && daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 7;

  if (connection.connected) {
    return (
      <div style={{ ...GLASS, padding: '20px 26px', marginBottom: '20px' }}>
        <style jsx>{`
          .ccp-sync:hover:not(:disabled)  { filter: brightness(1.04); }
          .ccp-discon:hover:not(:disabled) { background: rgba(254,226,226,0.9) !important; color: #c0392b !important; }
          .ccp-reconnect:hover:not(:disabled) { filter: brightness(1.04); }
        `}</style>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <GraduationCap size={18} color="#74bcd9" strokeWidth={2.2} />
            <span style={{ fontWeight: 800, color: '#333', fontSize: '0.92rem' }}>
              Connected to Canvas as {connection.canvas_user_name}
            </span>
            {connection.status === 'invalid' && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#c0392b', fontWeight: 700,
                fontSize: '0.78rem', background: 'rgba(254,226,226,0.7)', borderRadius: '999px', padding: '3px 10px',
              }}>
                <AlertTriangle size={12} /> Token expired — reconnect below
              </span>
            )}
          </div>
          {showExpiryWarning && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
              background: 'rgba(255,229,143,0.35)', border: '1px solid rgba(214,158,46,0.35)',
              borderRadius: '14px', padding: '9px 14px', fontSize: '0.8rem', color: '#8a6416', fontWeight: 600,
            }}>
              <AlertTriangle size={13} />
              Your Canvas connection expires in {daysUntilExpiry} day{daysUntilExpiry === 1 ? '' : 's'} — reconnect anytime to renew it.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', color: '#8a94a6', fontWeight: 600, marginRight: 'auto' }}>
              {connection.last_sync_at
                ? `Last synced ${new Date(connection.last_sync_at).toLocaleString()} (${connection.last_sync_status})`
                : 'Never synced'}
            </span>
            {pairing ? (
              <BookmarkletLink code={pairing.code} />
            ) : (
              <button className="ccp-reconnect" onClick={startPairing} disabled={busy}
                style={{
                  ...pillBtn, color: 'white', background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                  boxShadow: '0 4px 14px rgba(242,167,192,0.3)', cursor: busy ? 'wait' : 'pointer',
                }}>
                <Link2 size={14} /> Reconnect
              </button>
            )}
            <button className="ccp-sync" onClick={syncNow} disabled={busy}
              style={{
                ...pillBtn, color: 'white', background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                boxShadow: '0 4px 14px rgba(242,167,192,0.3)', cursor: busy ? 'wait' : 'pointer',
              }}>
              <RefreshCw size={14} /> {busy ? 'Syncing…' : 'Sync Now'}
            </button>
            <button className="ccp-discon" onClick={disconnect} disabled={busy}
              style={{ ...pillBtn, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.5)', color: '#8a94a6' }}>
              <Unplug size={14} /> Disconnect
            </button>
          </div>
        </div>
        {error && <div style={{ marginTop: '10px', color: '#dc2626', fontSize: '0.85rem', fontWeight: 600 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ ...GLASS, padding: '24px 26px', marginBottom: '20px' }}>
      <style jsx>{`
        .ccp-connect:hover:not(:disabled) { filter: brightness(1.04); }
        .ccp-manual-toggle:hover { color: #5c6b80 !important; }
      `}</style>
      <h2 style={{
        margin: '0 0 10px', fontSize: '1.05rem', fontWeight: 800, color: '#2d3748',
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif", display: 'flex', alignItems: 'center', gap: '8px',
      }}>
        <GraduationCap size={19} color="#74bcd9" strokeWidth={2.2} /> Connect Canvas
      </h2>

      {!pairing ? (
        <>
          <p style={{ fontSize: '0.85rem', color: '#8a94a6', marginBottom: '16px', lineHeight: 1.5 }}>
            Click Connect, then drag the button that appears to your bookmarks bar.
          </p>
          <button className="ccp-connect" onClick={startPairing} disabled={busy}
            style={{
              ...pillBtn, color: 'white', background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
              boxShadow: '0 4px 14px rgba(242,167,192,0.3)',
              opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer',
            }}>
            {busy ? 'Starting…' : 'Connect'}
          </button>
        </>
      ) : (
        <BookmarkletLink code={pairing.code} />
      )}

      <div style={{ marginTop: '14px' }}>
        <button
          className="ccp-manual-toggle"
          onClick={() => setShowManual(v => !v)}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.78rem', color: '#8a94a6', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
        >
          {showManual ? 'Hide manual option' : 'Paste a token manually instead'}
        </button>
        {showManual && (
          <div style={{ marginTop: '12px' }}>
            <input placeholder="https://yourschool.instructure.com" value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)} className="vb-input" style={{ marginBottom: '10px' }} />
            <input placeholder="Paste your Canvas access token" value={token} type="password"
              onChange={e => setToken(e.target.value)} className="vb-input" style={{ marginBottom: '14px' }} />
            <button className="ccp-connect" onClick={connectManual} disabled={busy || !baseUrl || !token}
              style={{
                ...pillBtn, color: 'white', background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
                boxShadow: '0 4px 14px rgba(242,167,192,0.3)',
                opacity: (busy || !baseUrl || !token) ? 0.6 : 1,
                cursor: busy ? 'wait' : (!baseUrl || !token) ? 'not-allowed' : 'pointer',
              }}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        )}
      </div>
      {error && <div style={{ marginTop: '10px', color: '#dc2626', fontSize: '0.85rem', fontWeight: 600 }}>{error}</div>}
    </div>
  );
}

function BookmarkletLink({ code }: { code: string }) {
  const href = typeof window !== 'undefined' ? buildBookmarkletHref(code, window.location.origin) : 'javascript:void(0)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
      <span style={{ fontSize: '0.8rem', color: '#8a94a6', fontWeight: 600 }}>
        Drag this to your bookmarks bar, then go to your Canvas site and click it. Expires in 10 minutes.
      </span>
      <a
        href={href}
        onClick={e => e.preventDefault()}
        style={{
          ...pillBtn, color: 'white', background: 'linear-gradient(to right, #f2a7c0, #74bcd9)',
          boxShadow: '0 4px 14px rgba(242,167,192,0.3)', textDecoration: 'none', cursor: 'grab',
        }}
      >
        <Link2 size={14} /> Connect to Canvas
      </a>
    </div>
  );
}
