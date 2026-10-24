'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { HubSubject, HubTab } from './types';

type Ind = { x: number; y: number; w: number; h: number; ready: boolean };

const VIEWS: Array<{ id: HubTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'bank', label: 'Activity Bank' },
  { id: 'announcements', label: 'Announcements' },
];

export const tabId = (t: HubTab) => `sp-hub-tab-${t}`;
export const panelId = (t: HubTab) => `sp-hub-panel-${t}`;

/**
 * The hub's one header row (spec §6, mockup v1c header()): an icon-only back button, "Canvas", the views tablist with
 * counts, and the subject select at the right end on the Activity Bank and Announcements views. No sync controls here.
 * The tablist uses automatic activation (arrows, Home, End) and the same sliding indicator as the subject page's
 * PeriodTabs. On a phone the tabs wrap to a full-width row under the title and the select to its own row below.
 */
export default function HubHeader({ tab, onTab, counts, showTabs, subjects, subject, onSubject }: {
  tab: HubTab;
  onTab: (t: HubTab) => void;
  counts: { bank: number; announcements: number };
  showTabs: boolean;
  subjects: HubSubject[];
  subject: number | null;
  onSubject: (s: number | null) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [ind, setInd] = useState<Ind>({ x: 0, y: 0, w: 0, h: 0, ready: false });
  const active = Math.max(0, VIEWS.findIndex(v => v.id === tab));
  const lastActive = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!showTabs) return;
    // The slide switches on with the first real change of view, never on first paint, a font swap or a resize.
    const changed = lastActive.current !== null && lastActive.current !== active;
    lastActive.current = active;
    const measure = (slide: boolean) => {
      const t = tabs.current[active];
      if (!t) return;
      const x = t.offsetLeft, y = t.offsetTop, w = t.offsetWidth, h = t.offsetHeight;
      setInd(prev => {
        const ready = prev.ready || slide;
        return prev.x === x && prev.y === y && prev.w === w && prev.h === h && prev.ready === ready ? prev : { x, y, w, h, ready };
      });
    };
    measure(changed);
    const ro = new ResizeObserver(() => measure(false));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [active, showTabs, counts.bank, counts.announcements]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const n = e.key === 'ArrowRight' ? (i + 1) % VIEWS.length
      : e.key === 'ArrowLeft' ? (i - 1 + VIEWS.length) % VIEWS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? VIEWS.length - 1
      : -1;
    if (n < 0) return;
    e.preventDefault();
    onTab(VIEWS[n].id);
    tabs.current[n]?.focus();
  };

  return (
    <div className="sp-hub-bar">
      <Link href="/studypulse" className="sp-hub-back sp-focus-ring" aria-label="Back to StudyPulse" title="Back to StudyPulse">
        <ArrowLeft size={18} aria-hidden />
      </Link>
      <h1 className="sp-hub-title">Canvas</h1>
      {showTabs && (
        <div ref={wrap} className="sp-hub-tabs" role="tablist" aria-label="Canvas views">
          <span className={`sp-pind${ind.ready ? ' is-ready' : ''}`} style={{ width: ind.w, height: ind.h, transform: `translate(${ind.x}px, ${ind.y}px)` }} aria-hidden />
          {VIEWS.map((v, i) => {
            const n = v.id === 'overview' ? null : counts[v.id];
            const on = v.id === tab;
            return (
              <button key={v.id} ref={el => { tabs.current[i] = el; }} id={tabId(v.id)} type="button" role="tab"
                aria-selected={on} aria-controls={panelId(v.id)} tabIndex={on ? 0 : -1}
                className="sp-hub-tab sp-focus-ring" onClick={() => onTab(v.id)} onKeyDown={e => onKey(e, i)}>
                {v.label}
                {n !== null && (
                  <span className={`sp-hub-tab__n sp-num${n === 0 ? ' is-zero' : ''}`}>
                    {n}<span className="sp-sr-only"> {v.id === 'bank' ? 'pending' : 'to review'}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {showTabs && tab !== 'overview' && (
        <label className="sp-hub-subj">
          <span className="sp-eyebrow">Subject</span>
          <select className="sp-input sp-input--sm sp-focus-ring" value={subject === null ? 'all' : String(subject)}
            onChange={e => onSubject(e.target.value === 'all' ? null : Number(e.target.value))}>
            <option value="all">All subjects</option>
            {subjects.map(s => (
              <option key={s.user_subject_id} value={s.user_subject_id}>
                {s.course_code ? `${s.course_code} · ${s.subject_name}` : s.subject_name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
