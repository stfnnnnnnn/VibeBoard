'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_PREFS, extraKey, targetKey, type ProjectionPrefs } from '@/lib/studypulse/prefs';

const ENDPOINT = '/api/studypulse/projection-prefs';

/** Server snapshot with every locally edited key kept: an edit made before the GET resolves must win. */
function mergeLocal(server: ProjectionPrefs, local: ProjectionPrefs, touched: Set<string>): ProjectionPrefs {
  const targets = { ...server.targets };
  const extras = { ...server.extras };
  for (const [k, v] of Object.entries(local.targets)) if (touched.has(targetKey(k))) targets[k] = v;
  for (const [k, v] of Object.entries(local.extras)) if (touched.has(extraKey(k))) extras[k] = v;
  return { targets, extras };
}

/** Loads and saves planner prefs (spec §3.3): 400ms debounce per key, no spinner, inline retry on failure.
    Pending saves are flushed (keepalive) on unmount, so a change made just before navigating away survives. */
export function usePlannerPrefs(userSubjectId: number) {
  const [prefs, setPrefs] = useState<ProjectionPrefs>(EMPTY_PREFS);
  const [saveError, setSaveError] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, number>>({});
  const failed = useRef<Record<string, number>>({});
  const touched = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    touched.current = new Set();
    fetch(`${ENDPOINT}?user_subject_id=${userSubjectId}`)
      .then(r => (r.ok ? r.json() : EMPTY_PREFS))
      .then((p: ProjectionPrefs) => {
        if (!alive) return;
        const server = { extras: p.extras ?? {}, targets: p.targets ?? {} };
        setPrefs(local => mergeLocal(server, local, touched.current));
      })
      .catch(() => { /* planner still works from defaults */ });
    return () => { alive = false; };
  }, [userSubjectId]);

  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
    for (const [key, value] of Object.entries(pending.current)) {
      void fetch(ENDPOINT, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ user_subject_id: userSubjectId, key, value }),
      }).catch(() => { /* page is gone; nothing to report to */ });
    }
    pending.current = {};
  }, [userSubjectId]);

  const send = useCallback(async (key: string, value: number) => {
    delete pending.current[key];
    try {
      const res = await fetch(ENDPOINT, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_subject_id: userSubjectId, key, value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      delete failed.current[key];
      if (!Object.keys(failed.current).length) setSaveError(false);
    } catch {
      failed.current[key] = value;
      setSaveError(true);
    }
  }, [userSubjectId]);

  const queue = useCallback((key: string, value: number) => {
    touched.current.add(key);
    pending.current[key] = value;
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => { void send(key, value); }, 400);
  }, [send]);

  const setTarget = useCallback((periodKey: string, v: number) => {
    setPrefs(p => ({ ...p, targets: { ...p.targets, [periodKey]: v } }));
    queue(targetKey(periodKey), v);
  }, [queue]);

  const setExtra = useCallback((catKey: string, v: number) => {
    setPrefs(p => ({ ...p, extras: { ...p.extras, [catKey]: v } }));
    queue(extraKey(catKey), v);
  }, [queue]);

  const retry = useCallback(() => {
    Object.entries(failed.current).forEach(([k, v]) => { void send(k, v); });
  }, [send]);

  return { prefs, setTarget, setExtra, saveError, retry };
}
