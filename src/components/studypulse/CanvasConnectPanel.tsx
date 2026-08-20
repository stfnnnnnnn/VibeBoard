'use client';

import { useState } from 'react';

const GLASS: React.CSSProperties = {
  background:           'rgba(255,255,255,0.22)',
  backdropFilter:       'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  borderRadius:         '20px',
  border:               '1px solid rgba(255,255,255,0.35)',
  boxShadow:            '0 8px 28px rgba(0,0,0,0.12)',
};

export interface ConnectionStatus {
  connected:        boolean;
  canvas_user_name?: string;
  status?:          'active' | 'invalid' | 'disconnected';
  last_sync_at?:    string | null;
  last_sync_status?: 'success' | 'partial' | 'failed' | null;
}

export default function CanvasConnectPanel({
  connection, onChange,
}: {
  connection: ConnectionStatus;
  onChange:   () => void;
}) {
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const connect = async () => {
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
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await fetch('/api/canvas/disconnect', { method: 'POST' });
      onChange();
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

  if (connection.connected) {
    return (
      <div style={{ ...GLASS, padding: '20px 24px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, color: '#333' }}>
            Connected to Canvas as {connection.canvas_user_name}
          </span>
          {connection.status === 'invalid' && (
            <span style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.85rem' }}>
              ⚠ Token expired — reconnect below
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#888' }}>
            {connection.last_sync_at
              ? `Last synced ${new Date(connection.last_sync_at).toLocaleString()} (${connection.last_sync_status})`
              : 'Never synced'}
          </span>
          <button onClick={syncNow} disabled={busy}
            style={{ background: 'linear-gradient(to right, #f2a7c0, #74bcd9)', color: 'white', border: 'none', borderRadius: '10px', padding: '8px 16px', fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? 'Syncing…' : 'Sync Now'}
          </button>
          <button onClick={disconnect} disabled={busy}
            style={{ background: 'rgba(240,240,245,0.9)', border: 'none', borderRadius: '10px', padding: '8px 16px', fontWeight: 700, color: '#888', cursor: 'pointer' }}>
            Disconnect
          </button>
        </div>
        {error && <div style={{ marginTop: '10px', color: '#dc2626', fontSize: '0.85rem' }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ ...GLASS, padding: '24px', marginBottom: '20px' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: '1.1rem', fontWeight: 800, color: '#333' }}>Connect Canvas</h2>
      <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '14px' }}>
        Enter your Canvas domain, then generate an access token from your Canvas Settings page
        (Account → Settings → New Access Token) and paste it below.
      </p>
      <input placeholder="https://yourschool.instructure.com" value={baseUrl}
        onChange={e => setBaseUrl(e.target.value)}
        style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(180,190,215,0.5)', marginBottom: '10px' }} />
      <input placeholder="Paste your Canvas access token" value={token} type="password"
        onChange={e => setToken(e.target.value)}
        style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(180,190,215,0.5)', marginBottom: '10px' }} />
      <button onClick={connect} disabled={busy || !baseUrl || !token}
        style={{ background: 'linear-gradient(to right, #f2a7c0, #74bcd9)', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 20px', fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? 'Connecting…' : 'Connect'}
      </button>
      {error && <div style={{ marginTop: '10px', color: '#dc2626', fontSize: '0.85rem' }}>{error}</div>}
    </div>
  );
}
