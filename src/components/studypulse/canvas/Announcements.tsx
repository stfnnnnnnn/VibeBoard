'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Inbox } from 'lucide-react';
import { shortDate, todayManila } from '@/lib/studypulse/ui/format';
import AnnouncementDetail from './AnnouncementDetail';
import type { DestinationPayload } from './ConvertPanel';
import type { ToastInput } from './useUndoToast';
import {
  DEST_LABEL, subjectCode,
  type AnnouncementItem, type AnnouncementStatus, type HubSubject, type PickerPeriod, type ScheduleBlockOption,
} from './types';

const LEAVE_MS = 180; // matches .sp-arow-shell.is-leaving
const VIEWS: AnnouncementStatus[] = ['pending', 'included', 'ignored'];
const VIEW_LABEL: Record<AnnouncementStatus, string> = { pending: 'To review', included: 'Converted', ignored: 'Dismissed' };
const OFFLINE = 'Couldn’t reach the server. Check your connection and try again.';

type Lists = Record<AnnouncementStatus, AnnouncementItem[]>;
type Busy = { id: number; kind: 'convert' | 'dismiss' | 'restore' } | null;

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
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const stacked = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches;
/** Same order as the GET: newest first, undated last. */
const byPosted = (a: AnnouncementItem, b: AnnouncementItem) =>
  (a.posted_at === null ? 1 : 0) - (b.posted_at === null ? 1 : 0) || (b.posted_at ?? '').localeCompare(a.posted_at ?? '') || b.id - a.id;

const MANILA_FULL = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });

/** posted_at is UTC "YYYY-MM-DD HH:MM:SS". "12 min ago", "3h ago", "Yesterday", then "Oct 21" (Manila dates). */
export function postedLabel(postedAt: string | null, now: Date = new Date()): { label: string; title: string } {
  const d = postedAt ? new Date(postedAt.replace(' ', 'T') + 'Z') : null;
  if (!d || Number.isNaN(d.getTime())) return { label: 'date unknown', title: 'Canvas didn’t say when this was posted' };
  const title = MANILA_FULL.format(d);
  const s = (now.getTime() - d.getTime()) / 1000;
  if (s < 60) return { label: 'just now', title };
  if (s < 3600) return { label: `${Math.floor(s / 60)} min ago`, title };
  if (s < 86400) return { label: `${Math.floor(s / 3600)}h ago`, title };
  const day = todayManila(d), today = todayManila(now);
  if (day === todayManila(new Date(now.getTime() - 86_400_000))) return { label: 'yesterday', title };
  return { label: shortDate(day, today), title };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The Canvas hub's Announcements (spec §6 C4, §6.1; mockup v1c annView()): an inbox list (360px) beside a reading pane.
 * Owns its three lists (To review / Converted / Dismissed → ?status=pending|included|ignored), so each filter's count is
 * known up front and the header's subject filter shows a loading state rather than the previous subject's rows.
 * Opening a row marks it seen (optimistic). Dismiss offers Undo (→ restore); Convert has no undo and links to Workboard.
 * Below 900px the panes stack: the list, then the opened announcement full-width with a back button.
 */
export default function Announcements({ subject, subjects, toast, onCountsChange }: {
  subject: number | null;
  subjects: HubSubject[];
  toast: (t: ToastInput) => void;
  /** The server-side tab counts changed (router.refresh). */
  onCountsChange: () => void;
}) {
  const [view, setView] = useState<AnnouncementStatus>('pending');
  const [lists, setLists] = useState<Lists | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [shownId, setShownId] = useState<number | null>(null);
  const [reading, setReading] = useState(false); // phone: the detail replaces the list
  const [busy, setBusy] = useState<Busy>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [leaving, setLeaving] = useState<Set<number>>(new Set());

  const seq = useRef(0);
  // Bumped whenever a row leaves locally, so a fetch that was already in flight is retried instead of resurrecting it.
  const epoch = useRef(0);
  const periodsCache = useRef(new Map<number, Promise<PickerPeriod[]>>());
  const blocksCache = useRef<Promise<ScheduleBlockOption[]> | null>(null);
  const rowEls = useRef(new Map<number, HTMLButtonElement>());
  const segRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const detailHead = useRef<HTMLHeadingElement>(null);
  const focusRow = useRef<number | 'seg' | null>(null); // where focus goes once a leaving row is gone, or after Back
  const focusHead = useRef(false);

  const load = useCallback(async (reset: boolean): Promise<void> => {
    const my = ++seq.current;
    const startEpoch = epoch.current;
    if (reset) { setLists(null); setLoadErr(null); }
    try {
      const sid = subject !== null ? `&user_subject_id=${subject}` : '';
      const res = await Promise.all(VIEWS.map(v => fetch(`/api/canvas/announcements?status=${v}${sid}`)));
      const bad = res.find(r => !r.ok);
      if (bad) throw new Error(await errorOf(bad, 'Couldn’t load your announcements.'));
      const [p, i, g] = await Promise.all(res.map(r => r.json()));
      if (my !== seq.current) return;
      if (epoch.current !== startEpoch) return load(false);
      setLists({ pending: p.items, included: i.items, ignored: g.items });
      setLoadErr(null);
    } catch (err) {
      if (my !== seq.current) return;
      if (reset) setLoadErr((err as Error).message || 'Couldn’t load your announcements.');
    }
  }, [subject]);

  useEffect(() => {
    setShownId(null); setReading(false); setErrors({});
    void load(true);
  }, [load]);

  const setError = (id: number, msg: string | null) =>
    setErrors(prev => { const n = { ...prev }; if (msg) n[id] = msg; else delete n[id]; return n; });

  const rows = lists ? lists[view] : null;
  const visible = (rows ?? []).filter(x => !leaving.has(x.id));
  // The pane always shows something on a wide screen (the opened row, else the first); on a phone CSS hides it until a
  // row is opened. Only an explicit open marks a row seen.
  const shown = visible.find(x => x.id === shownId) ?? visible[0] ?? null;
  const shownNow = useRef<number | null>(null); // the row on screen now, for actions that finish after a re-render
  useLayoutEffect(() => { shownNow.current = shown?.id ?? null; });

  // ── focus: after Back, after a row leaves, and when a row opens full-width on a phone ──
  useLayoutEffect(() => {
    if (focusHead.current && shown) {
      focusHead.current = false;
      detailHead.current?.focus({ preventScroll: true });
      detailHead.current?.closest('.sp-ann')?.scrollIntoView({ block: 'start' });
      return;
    }
    const f = focusRow.current;
    if (f === null || leaving.size) return;
    focusRow.current = null;
    if (f === 'seg') segRefs.current[VIEWS.indexOf(view)]?.focus();
    else rowEls.current.get(f)?.focus();
  });

  const open = (item: AnnouncementItem) => {
    setShownId(item.id);
    if (stacked()) { setReading(true); focusHead.current = true; }
    if (item.seen_at !== null) return;
    // Optimistic: the dot goes at once; a failed request quietly brings it back.
    const mark = (seen: string | null) => setLists(prev => prev && ({
      ...prev, [view]: prev[view].map(x => (x.id === item.id ? { ...x, seen_at: seen } : x)),
    }));
    mark(new Date().toISOString());
    post(`/api/canvas/announcements/${item.id}/seen`).then(r => { if (!r.ok) mark(null); }, () => mark(null));
  };

  const back = () => {
    setReading(false);
    focusRow.current = shown?.id ?? 'seg';
  };

  /** Fade + collapse the row, show the next one, then move it from `from` to `to` (with its new status). */
  const leave = (item: AnnouncementItem, from: AnnouncementStatus, to: AnnouncementStatus) => {
    epoch.current += 1;
    const i = visible.findIndex(x => x.id === item.id);
    const next = visible[i + 1] ?? visible[i - 1] ?? null;
    // Only when the leaving row is the one on screen: a row the user opened while the request ran stays open.
    const wasShown = shownNow.current === item.id;
    setShownId(cur => (cur === item.id || cur === null ? next?.id ?? null : cur));
    if (wasShown && stacked()) setReading(false);
    if (wasShown) focusRow.current = next?.id ?? 'seg';
    setLeaving(prev => new Set(prev).add(item.id));
    setTimeout(() => {
      setLists(prev => {
        if (!prev) return prev;
        // The list's copy, not the closure's: it carries the optimistic seen_at from open().
        const moving = prev[from].find(x => x.id === item.id) ?? item;
        return {
          ...prev,
          [from]: prev[from].filter(x => x.id !== item.id),
          [to]: [...prev[to].filter(x => x.id !== item.id), { ...moving, bank_status: to }].sort(byPosted),
        } as Lists;
      });
      setLeaving(prev => { const n = new Set(prev); n.delete(item.id); return n; });
    }, reduced() ? 1 : LEAVE_MS);
  };

  const comeBack = () => { void load(false); onCountsChange(); };

  const act = async (item: AnnouncementItem, kind: NonNullable<Busy>['kind'], run: () => Promise<void>) => {
    setBusy({ id: item.id, kind }); setError(item.id, null);
    try { await run(); } catch { setError(item.id, OFFLINE); } finally { setBusy(null); }
  };

  const convert = (item: AnnouncementItem, destinations: DestinationPayload[]) => act(item, 'convert', async () => {
    const res = await post(`/api/canvas/announcements/${item.id}/include`, { destinations });
    if (!res.ok) { setError(item.id, await errorOf(res, 'Couldn’t convert this announcement. Try again.')); return; }
    leave(item, 'pending', 'included');
    onCountsChange();
    toast({ message: `Converted into ${plural(destinations.length, 'item')}`, link: { href: '/workboard', label: 'View in Workboard' } });
  });

  const dismiss = (item: AnnouncementItem) => act(item, 'dismiss', async () => {
    const res = await post(`/api/canvas/announcements/${item.id}/ignore`);
    if (!res.ok) { setError(item.id, await errorOf(res, 'Couldn’t dismiss this announcement. Try again.')); return; }
    leave(item, 'pending', 'ignored');
    onCountsChange();
    toast({
      message: 'Dismissed. Find it under Dismissed',
      undo: async () => {
        const r = await post(`/api/canvas/announcements/${item.id}/restore`);
        if (!r.ok) throw new Error(await errorOf(r, 'Couldn’t undo that. Try again.'));
        comeBack();
      },
    });
  });

  const restore = (item: AnnouncementItem) => act(item, 'restore', async () => {
    const res = await post(`/api/canvas/announcements/${item.id}/restore`);
    if (!res.ok) { setError(item.id, await errorOf(res, 'Couldn’t restore this announcement. Try again.')); return; }
    leave(item, 'ignored', 'pending');
    onCountsChange();
    toast({
      message: 'Restored to To review',
      undo: async () => {
        const r = await post(`/api/canvas/announcements/${item.id}/ignore`);
        if (!r.ok) throw new Error(await errorOf(r, 'Couldn’t undo that. Try again.'));
        comeBack();
      },
    });
  });

  // ── loaders shared by every ConvertPanel (cached; a failed load is evicted so reopening retries) ──
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
      p.catch(() => periodsCache.current.delete(sid));
      periodsCache.current.set(sid, p);
    }
    return p;
  }, []);

  const loadBlocks = useCallback(() => {
    if (!blocksCache.current) {
      const p = fetch('/api/studypulse/schedule').then(async r => {
        if (!r.ok) throw new Error('schedule ' + r.status);
        const data = await r.json();
        return (data.blocks ?? []).map((b: ScheduleBlockOption) => (
          { block_id: b.block_id, course_code: b.course_code, section: b.section, day_of_week: b.day_of_week }
        )) as ScheduleBlockOption[];
      });
      p.catch(() => { blocksCache.current = null; });
      blocksCache.current = p;
    }
    return blocksCache.current;
  }, []);

  // ── view ──
  const codeOf = (item: AnnouncementItem) => {
    const s = item.user_subject_id ? subjects.find(x => x.user_subject_id === item.user_subject_id) : undefined;
    return s ? { label: subjectCode(s), mapped: true } : { label: item.course_name, mapped: false };
  };

  const switchView = (v: AnnouncementStatus) => {
    if (v === view) return;
    setView(v); setShownId(null); setReading(false);
  };
  const onSegKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + VIEWS.length) % VIEWS.length;
    switchView(VIEWS[n]);
    segRefs.current[n]?.focus();
  };

  const counts = (v: AnnouncementStatus) => lists?.[v].filter(x => !leaving.has(x.id)).length;
  const now = new Date();
  const empty = rows !== null && rows.length === 0;

  return (
    <section className={`sp-panel sp-ann${reading ? ' is-reading' : ''}${empty ? ' is-empty' : ''}`} aria-label="Announcements">
      <div className="sp-ann__list">
        <div className="sp-ann__filter">
          <div role="radiogroup" aria-label="Show" className="sp-seg sp-seg--sm sp-ann__seg">
            {VIEWS.map((v, i) => (
              <button key={v} ref={el => { segRefs.current[i] = el; }} type="button" role="radio" aria-checked={view === v}
                tabIndex={view === v ? 0 : -1} className="sp-seg__opt sp-focus-ring" onClick={() => switchView(v)} onKeyDown={e => onSegKey(e, i)}>
                {VIEW_LABEL[v]}
                <span className="sp-bank__n sp-num">{counts(v) ?? <><span aria-hidden>–</span><span className="sp-sr-only">loading</span></>}</span>
              </button>
            ))}
          </div>
        </div>

        {loadErr ? (
          <div className="sp-bank__state" role="alert">
            <p>{loadErr}</p>
            <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-focus-ring" onClick={() => void load(true)}>Try again</button>
          </div>
        ) : rows === null ? (
          <div className="sp-ann__loading" aria-busy="true">
            <span className="sp-sr-only" role="status">Loading your announcements…</span>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="sp-arow sp-arow--skel" aria-hidden>
                <span className="sp-skel sp-skel--name" /><span className="sp-skel sp-skel--name2" /><span className="sp-skel sp-skel--meta" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="sp-bank__empty">
            <div className={`sp-bank__empty-ic${view === 'pending' ? '' : ' is-quiet'}`}>{view === 'pending' ? <Check size={24} aria-hidden /> : <Inbox size={24} aria-hidden />}</div>
            <h2>{view === 'pending' ? 'You’re all caught up' : view === 'included' ? 'Nothing converted yet' : 'Nothing dismissed'}</h2>
            <p>{view === 'pending' ? 'New announcements appear here after each sync.'
              : view === 'included' ? 'Announcements you turn into tasks, events or reminders land here.'
              : 'Announcements you dismiss land here, and you can restore them any time.'}</p>
          </div>
        ) : (
          <ul className="sp-ann__rows">
            {rows.map(item => {
              const code = codeOf(item);
              const on = shown?.id === item.id;
              return (
                <li key={item.id} className={`sp-arow-shell${leaving.has(item.id) ? ' is-leaving' : ''}`}>
                  <div className="sp-brow-clip">
                    <button type="button" ref={el => { if (el) rowEls.current.set(item.id, el); else rowEls.current.delete(item.id); }}
                      className={`sp-arow sp-focus-ring${on ? ' is-on' : ''}${on && shownId !== item.id ? ' is-auto' : ''}`} aria-current={on ? 'true' : undefined}
                      disabled={leaving.has(item.id)} onClick={() => open(item)}>
                      <span className="sp-arow__t">{item.title}</span>
                      <span className="sp-arow__m sp-num">
                        {item.seen_at === null && <span className="sp-arow__unread"><span className="sp-sr-only">Unread. </span></span>}
                        <span className={`sp-chip ${code.mapped ? 'sp-chip--blue' : 'sp-chip--neutral'} sp-ann__code`} title={code.label}>{code.label}</span>
                        <span>{cap(postedLabel(item.posted_at, now).label)}</span>
                        {view === 'pending' && item.suggested_destinations.map(d => (
                          <span key={d} className="sp-chip sp-chip--violet">{DEST_LABEL[d]}</span>
                        ))}
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!empty && (
        <div className="sp-ann__pane">
          {shown ? (
            <AnnouncementDetail ref={detailHead} item={shown} code={codeOf(shown)} posted={postedLabel(shown.posted_at, now)}
              busy={busy?.id === shown.id ? busy.kind : null} error={errors[shown.id] ?? null}
              loadPeriods={loadPeriods} loadBlocks={loadBlocks} onBack={back}
              onConvert={d => void convert(shown, d)} onDismiss={() => void dismiss(shown)} onRestore={() => void restore(shown)} />
          ) : null}
        </div>
      )}
    </section>
  );
}
