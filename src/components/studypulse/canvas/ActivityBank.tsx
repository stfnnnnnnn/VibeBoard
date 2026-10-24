'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Inbox } from 'lucide-react';
import BankRow, { type BankView } from './BankRow';
import type { ToastInput } from './useUndoToast';
import {
  subjectCode, suggestedTarget, targetLabel,
  type BankItem, type BankTarget, type HubSubject, type PickerPeriod,
} from './types';

const LEAVE_MS = 180; // matches .sp-brow-shell.is-leaving
const CANT_UNDO = 'Can’t undo, it was edited';

type Lists = { pending: BankItem[]; ignored: BankItem[] };

async function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
/** The route's own message for a 4xx (written for people); a 5xx carries raw server/DB text, so it gets the fallback. */
async function errorOf(res: Response, fallback: string): Promise<string> {
  if (res.status >= 500) return fallback;
  try { return (await res.json()).error || fallback; } catch { return fallback; }
}
const includeBody = (t: BankTarget) => (t.kind === 'custom'
  ? { target_type: 'grade_entries', period_id: t.period_id, cat_id: t.cat_id }
  : { target_type: t.target });
const byDue = (a: BankItem, b: BankItem) =>
  (a.due_at === null ? 1 : 0) - (b.due_at === null ? 1 : 0) || (a.due_at ?? '').localeCompare(b.due_at ?? '') || a.id - b.id;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The Canvas hub's Activity Bank (spec §6 C3, mockup v1c bank()). Owns its own two lists (To review / Ignored) for the
 * header's subject filter, so a subject switch shows a loading state rather than the previous subject's rows.
 * Add / Ignore / Restore act at once and offer Undo through the hub's toast; bulk actions run one request at a time and
 * share one toast whose Undo reverses all of them. Errors stay on their row (role="alert").
 */
export default function ActivityBank({ subject, subjects, toast, onCountsChange }: {
  subject: number | null;
  subjects: HubSubject[];
  toast: (t: ToastInput) => void;
  /** The server-side tab counts changed (router.refresh). */
  onCountsChange: () => void;
}) {
  const [view, setView] = useState<BankView>('pending');
  const [lists, setLists] = useState<Lists | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [pickId, setPickId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const seq = useRef(0);
  // Bumped whenever a row leaves locally, so a fetch that was already in flight is retried instead of resurrecting it.
  const epoch = useRef(0);
  const periodsCache = useRef(new Map<number, Promise<PickerPeriod[]>>());
  const rowEls = useRef(new Map<number, HTMLLIElement>());
  const focusAfter = useRef<number | null>(null); // list index to focus once a leaving row is gone
  const segRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selAll = useRef<HTMLInputElement>(null);

  const load = useCallback(async (reset: boolean): Promise<void> => {
    const my = ++seq.current;
    const startEpoch = epoch.current;
    if (reset) { setLists(null); setLoadErr(null); }
    try {
      const sid = subject !== null ? `&user_subject_id=${subject}` : '';
      const [p, i] = await Promise.all([
        fetch(`/api/canvas/bank?status=pending${sid}`), fetch(`/api/canvas/bank?status=ignored${sid}`),
      ]);
      if (!p.ok || !i.ok) throw new Error(await errorOf(p.ok ? i : p, 'Couldn’t load the Activity Bank.'));
      const [pj, ij] = await Promise.all([p.json(), i.json()]);
      if (my !== seq.current) return;
      // A row left the list while this was in flight: the answer may predate it, so ask again.
      if (epoch.current !== startEpoch) return load(false);
      setLists({ pending: pj.items, ignored: ij.items });
      setLoadErr(null);
    } catch (err) {
      if (my !== seq.current) return;
      if (reset) setLoadErr((err as Error).message || 'Couldn’t load the Activity Bank.');
    }
  }, [subject]);

  useEffect(() => {
    setSelected(new Set()); setPickId(null); setErrors({});
    void load(true);
  }, [load]);

  const changed = useCallback(() => { onCountsChange(); }, [onCountsChange]);

  // ── helpers over the row sets ──
  const mark = (set: typeof setBusy, ids: number[], on: boolean) =>
    set(prev => { const n = new Set(prev); ids.forEach(id => (on ? n.add(id) : n.delete(id))); return n; });
  const setError = (id: number, msg: string | null) =>
    setErrors(prev => { const n = { ...prev }; if (msg) n[id] = msg; else delete n[id]; return n; });

  /** Fade + collapse the rows, then drop them from `from` (and file them under `to`, if given). */
  const leave = (ids: number[], from: BankView, to?: BankView) => {
    if (!ids.length) return;
    epoch.current += 1;
    const list = lists?.[from] ?? [];
    const idx = list.findIndex(x => ids.includes(x.id));
    // Disabled buttons drop focus to <body> while the request runs, so that counts as "focus was in this row" too.
    const a = document.activeElement;
    if (idx >= 0 && (a === document.body || ids.some(id => rowEls.current.get(id)?.contains(a)))) focusAfter.current = idx;
    mark(setLeaving, ids, true);
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    setPickId(p => (p !== null && ids.includes(p) ? null : p));
    setTimeout(() => {
      setLists(prev => {
        if (!prev) return prev;
        const moving = prev[from].filter(x => ids.includes(x.id));
        const next = { ...prev, [from]: prev[from].filter(x => !ids.includes(x.id)) } as Lists;
        if (to) next[to] = [...next[to].filter(x => !ids.includes(x.id)), ...moving.map(x => ({ ...x, suggestion: null }))].sort(byDue);
        return next;
      });
      mark(setLeaving, ids, false);
    }, reduced() ? 1 : LEAVE_MS);
  };

  /** Bring rows back from the server after an undo or restore (their suggestion is computed there). */
  const comeBack = () => {
    void load(false);
    changed();
  };

  // After a leaving row is gone, keep keyboard focus in the list instead of dropping it on <body>.
  useLayoutEffect(() => {
    if (focusAfter.current === null || !lists) return;
    if (leaving.size) return;
    const list = lists[view];
    const i = Math.min(focusAfter.current, list.length - 1);
    focusAfter.current = null;
    if (i >= 0) rowEls.current.get(list[i].id)?.focus();
    else segRefs.current[view === 'pending' ? 0 : 1]?.focus();
  }, [lists, leaving, view]);

  // ── single-row actions ──
  const undoInclude = async (ids: number[]) => {
    let edited = 0, failed = 0;
    const back: number[] = [];
    for (const id of ids) {
      const res = await post(`/api/canvas/bank/${id}/uninclude`);
      if (res.ok) back.push(id);
      else if (res.status === 409) edited++;
      else failed++;
    }
    if (back.length) comeBack();
    if (ids.length === 1 && edited) throw new Error(CANT_UNDO);
    if (ids.length === 1 && failed) throw new Error('Couldn’t undo that. Try again.');
    if (edited || failed) {
      throw new Error(`Undid ${back.length} of ${ids.length}. ${edited ? `${plural(edited, 'item was', 'items were')} edited, so they stay.` : 'The rest couldn’t be undone.'}`);
    }
  };

  const undoIgnore = async (ids: number[]) => {
    const back: number[] = [];
    for (const id of ids) { if ((await post(`/api/canvas/bank/${id}/restore`)).ok) back.push(id); }
    setLists(prev => (prev ? { ...prev, ignored: prev.ignored.filter(x => !back.includes(x.id)) } : prev));
    if (back.length) comeBack();
    if (back.length < ids.length) throw new Error(`Couldn’t restore ${plural(ids.length - back.length, 'item')}. Try again.`);
  };

  const add = async (item: BankItem, t: BankTarget) => {
    mark(setBusy, [item.id], true); setError(item.id, null);
    try {
      const res = await post(`/api/canvas/bank/${item.id}/include`, includeBody(t));
      if (!res.ok) { setError(item.id, await errorOf(res, 'Couldn’t add this item. Try again.')); return; }
      leave([item.id], 'pending');
      changed();
      toast({ message: `Added to ${codeOf(item).label} · ${targetLabel(t)}`, undo: () => undoInclude([item.id]) });
    } catch {
      setError(item.id, 'Couldn’t reach the server. Check your connection and try again.');
    } finally {
      mark(setBusy, [item.id], false);
    }
  };

  const ignore = async (item: BankItem) => {
    mark(setBusy, [item.id], true); setError(item.id, null);
    try {
      const res = await post(`/api/canvas/bank/${item.id}/ignore`);
      if (!res.ok) { setError(item.id, await errorOf(res, 'Couldn’t ignore this item. Try again.')); return; }
      leave([item.id], 'pending', 'ignored');
      changed();
      toast({ message: 'Ignored. It’s in the Ignored tab', undo: () => undoIgnore([item.id]) });
    } catch {
      setError(item.id, 'Couldn’t reach the server. Check your connection and try again.');
    } finally {
      mark(setBusy, [item.id], false);
    }
  };

  const restore = async (item: BankItem) => {
    mark(setBusy, [item.id], true); setError(item.id, null);
    try {
      const res = await post(`/api/canvas/bank/${item.id}/restore`);
      if (!res.ok) { setError(item.id, await errorOf(res, 'Couldn’t restore this item. Try again.')); return; }
      leave([item.id], 'ignored');
      comeBack();
      toast({
        message: 'Restored to To review',
        undo: async () => {
          const r = await post(`/api/canvas/bank/${item.id}/ignore`);
          if (!r.ok) throw new Error(await errorOf(r, 'Couldn’t undo that. Try again.'));
          void load(false); changed();
        },
      });
    } catch {
      setError(item.id, 'Couldn’t reach the server. Check your connection and try again.');
    } finally {
      mark(setBusy, [item.id], false);
    }
  };

  // ── bulk ──
  const pendingRows = (lists?.pending ?? []).filter(x => !leaving.has(x.id));
  const chosen = pendingRows.filter(x => selected.has(x.id));
  const addable = chosen.filter(x => x.user_subject_id && suggestedTarget(x.suggestion));

  const bulkAdd = async () => {
    const skipped = chosen.length - addable.length;
    setBulkBusy(true);
    // Every queued row is busy from the start (not just when the loop reaches it), so nothing can Ignore or Add a row
    // that this run is about to include. Each row is released as its own request finishes.
    mark(setBusy, addable.map(x => x.id), true);
    const done: number[] = [];
    let failed = 0;
    for (const item of addable) {
      const t = suggestedTarget(item.suggestion)!;
      setError(item.id, null);
      try {
        const res = await post(`/api/canvas/bank/${item.id}/include`, includeBody(t));
        if (res.ok) done.push(item.id);
        else { failed++; setError(item.id, await errorOf(res, 'Couldn’t add this item. Try again.')); }
      } catch {
        failed++; setError(item.id, 'Couldn’t reach the server. Check your connection and try again.');
      } finally {
        mark(setBusy, [item.id], false);
      }
    }
    setBulkBusy(false);
    leave(done, 'pending');
    if (done.length) changed();
    const tail = [
      skipped ? `${skipped} skipped (no suggestion)` : '',
      failed ? `${failed} failed` : '',
    ].filter(Boolean).join(' · ');
    toast(done.length
      ? { message: `Added ${plural(done.length, 'item')}${tail ? ` · ${tail}` : ''}`, undo: () => undoInclude(done) }
      : { message: `Nothing added${tail ? ` · ${tail}` : ''}` });
  };

  const bulkIgnore = async () => {
    const ids = chosen.map(x => x.id);
    setBulkBusy(true);
    mark(setBusy, ids, true); // queued rows are locked for the whole run, as in bulkAdd
    const done: number[] = [];
    for (const id of ids) {
      setError(id, null);
      try {
        const res = await post(`/api/canvas/bank/${id}/ignore`);
        if (res.ok) done.push(id); else setError(id, await errorOf(res, 'Couldn’t ignore this item. Try again.'));
      } catch {
        setError(id, 'Couldn’t reach the server. Check your connection and try again.');
      } finally {
        mark(setBusy, [id], false);
      }
    }
    setBulkBusy(false);
    leave(done, 'pending', 'ignored');
    if (done.length) {
      changed();
      const failed = ids.length - done.length;
      toast({ message: `Ignored ${plural(done.length, 'item')}${failed ? ` · ${failed} failed` : ''}`, undo: () => undoIgnore(done) });
    }
  };

  // ── view ──
  const codeOf = (item: BankItem) => {
    const s = item.user_subject_id ? subjects.find(x => x.user_subject_id === item.user_subject_id) : undefined;
    return s ? { label: subjectCode(s), mapped: true } : { label: item.course_name, mapped: false };
  };

  const loadPeriods = useCallback((sid: number) => {
    let p = periodsCache.current.get(sid);
    if (!p) {
      p = fetch(`/api/studypulse/subjects/${sid}/grading`).then(async r => {
        if (!r.ok) throw new Error(await errorOf(r, 'Couldn’t load this subject’s grading periods.'));
        const data = await r.json();
        return ((data.config?.preset?.periods ?? []) as Array<PickerPeriod & Record<string, unknown>>).map(x => ({
          period_id: x.period_id, name: x.name,
          categories: (x.categories ?? []).map(c => ({ cat_id: c.cat_id, name: c.name })),
        }));
      });
      // A failed load isn't cached, so reopening the picker retries.
      p.catch(() => periodsCache.current.delete(sid));
      periodsCache.current.set(sid, p);
    }
    return p;
  }, []);

  const rows = lists ? lists[view] : null;
  const visible = (rows ?? []).filter(x => !leaving.has(x.id));
  const nSel = view === 'pending' ? chosen.length : 0;
  const allOn = view === 'pending' && pendingRows.length > 0 && chosen.length === pendingRows.length;

  useEffect(() => {
    if (selAll.current) selAll.current.indeterminate = nSel > 0 && !allOn;
  }, [nSel, allOn]);

  const switchView = (v: BankView) => {
    if (v === view) return;
    setView(v); setSelected(new Set()); setPickId(null);
  };
  const onSegKey = (e: KeyboardEvent, i: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const n = 1 - i;
    switchView(n === 0 ? 'pending' : 'ignored');
    segRefs.current[n]?.focus();
  };
  const toggleAll = (on: boolean) => setSelected(on ? new Set(pendingRows.map(x => x.id)) : new Set());

  const counts = { pending: lists?.pending.filter(x => !leaving.has(x.id)).length, ignored: lists?.ignored.filter(x => !leaving.has(x.id)).length };

  return (
    <section className="sp-panel sp-bank" aria-label="Activity Bank">
      <div className="sp-bank__tools">
        {view === 'pending' && visible.length > 0 && (
          <label className="sp-brow__chk sp-bank__all">
            <input ref={selAll} type="checkbox" className="sp-check sp-focus-ring" checked={allOn} disabled={bulkBusy}
              onChange={e => toggleAll(e.target.checked)} aria-label="Select all items to review" />
          </label>
        )}
        <div role="radiogroup" aria-label="Show" className="sp-seg sp-seg--sm sp-bank__seg">
          {(['pending', 'ignored'] as const).map((v, i) => (
            <button key={v} ref={el => { segRefs.current[i] = el; }} type="button" role="radio" aria-checked={view === v}
              tabIndex={view === v ? 0 : -1} className="sp-seg__opt sp-focus-ring" onClick={() => switchView(v)} onKeyDown={e => onSegKey(e, i)}>
              {v === 'pending' ? 'To review' : 'Ignored'}
              <span className="sp-bank__n sp-num">{counts[v] ?? <><span aria-hidden>–</span><span className="sp-sr-only">loading</span></>}</span>
            </button>
          ))}
        </div>
        {nSel > 0 ? (
          <div className="sp-bank__bulk sp-num" role="group" aria-label="Selected items">
            <b>{nSel} selected</b>
            <button type="button" className="sp-btn sp-btn--primary sp-btn--sm sp-focus-ring" disabled={bulkBusy || addable.length === 0}
              onClick={bulkAdd} title={addable.length < nSel ? `${nSel - addable.length} without a suggestion will be skipped` : undefined}>
              <Check size={14} aria-hidden /> Add {addable.length} as suggested
            </button>
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-focus-ring" disabled={bulkBusy} onClick={bulkIgnore}>Ignore</button>
          </div>
        ) : (
          <p className="sp-bank__hint">New Canvas assignments wait here until you add them to a subject.</p>
        )}
      </div>

      {loadErr ? (
        <div className="sp-bank__state" role="alert">
          <p>{loadErr}</p>
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-focus-ring" onClick={() => void load(true)}>Try again</button>
        </div>
      ) : rows === null ? (
        <div className="sp-bank__loading" aria-busy="true">
          <span className="sp-sr-only" role="status">Loading the Activity Bank…</span>
          {[0, 1, 2].map(i => (
            <div key={i} className="sp-brow sp-brow--skel" aria-hidden>
              <span className="sp-skel sp-skel--box" />
              <div className="sp-brow__main"><span className="sp-skel sp-skel--name" /><span className="sp-skel sp-skel--meta" /><span className="sp-skel sp-skel--dest" /></div>
              <span className="sp-skel sp-skel--btn" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="sp-bank__empty">
          <div className={`sp-bank__empty-ic${view === 'ignored' ? ' is-quiet' : ''}`}>{view === 'pending' ? <Check size={24} aria-hidden /> : <Inbox size={24} aria-hidden />}</div>
          <h2>{view === 'pending' ? 'You’re all caught up' : 'Nothing ignored'}</h2>
          <p>{view === 'pending' ? 'New Canvas assignments will show up here after the next sync.' : 'Items you ignore land here, and you can restore them any time.'}</p>
        </div>
      ) : (
        <ul className="sp-bank__list">
          {rows.map(item => (
            <BankRow key={item.id} item={item} view={view} code={codeOf(item)}
              selected={selected.has(item.id)}
              onSelect={on => setSelected(prev => { const n = new Set(prev); if (on) n.add(item.id); else n.delete(item.id); return n; })}
              busy={busy.has(item.id)} error={errors[item.id] ?? null} leaving={leaving.has(item.id)}
              picking={pickId === item.id} onTogglePick={() => setPickId(p => (p === item.id ? null : item.id))}
              onAdd={t => void add(item, t)} onIgnore={() => void ignore(item)} onRestore={() => void restore(item)}
              loadPeriods={loadPeriods}
              rowRef={el => { if (el) rowEls.current.set(item.id, el); else rowEls.current.delete(item.id); }} />
          ))}
        </ul>
      )}
    </section>
  );
}
