'use client';

import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, Inbox, Megaphone, Settings2, Target } from 'lucide-react';

export default function SubjectToolbar({
  tabs, transmutationOn, transLoading, transError, onToggleTrans, plannerOpen, onTogglePlanner, isCustom, onGrading, userSubjectId,
}: {
  tabs?: ReactNode;
  transmutationOn: boolean; transLoading: boolean; transError: string | null; onToggleTrans: () => void;
  plannerOpen: boolean; onTogglePlanner: () => void;
  isCustom: boolean; onGrading: () => void; userSubjectId: number;
}) {
  /* Canvas links: a plain disclosure (button + list of links), not an ARIA menu. Closes on an outside press,
     on Esc (focus back to the trigger), and when focus leaves the trigger-and-list group. */
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const inside = !!menuRef.current?.contains(document.activeElement);
      setMenu(false);
      if (inside) triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menu]);
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    // relatedTarget is null when focus goes to nothing (e.g. a click on blank page), which the pointerdown handler covers.
    if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setMenu(false);
  };

  return (
    <div className="sp-toolbar">
      {tabs}
      <div className="sp-toolbar__right">
        <button type="button" role="switch" aria-checked={transmutationOn} disabled={transLoading}
          title={transError ?? 'Transmutation scale'} className="sp-btn sp-btn--ghost sp-switch sp-focus-ring" onClick={onToggleTrans}>
          <span className="sp-switch__track" aria-hidden />{transLoading ? 'Loading…' : 'Transmute'}
        </button>
        <button type="button" aria-expanded={plannerOpen} className={`sp-btn ${plannerOpen ? 'sp-btn--dark' : 'sp-btn--ghost'} sp-focus-ring`} onClick={onTogglePlanner}>
          <Target size={15} /> Target planner
        </button>
        <button type="button" className="sp-btn sp-btn--ghost sp-focus-ring" onClick={onGrading}>
          <Settings2 size={15} /> {isCustom ? 'Grading' : 'Set up grading'}
        </button>
        <div className="sp-menu" ref={menuRef} onBlur={onBlur}>
          <button ref={triggerRef} type="button" aria-expanded={menu} aria-controls={menu ? 'sp-canvas-links' : undefined} className="sp-btn sp-btn--ghost sp-focus-ring" onClick={() => setMenu(m => !m)}>
            <Inbox size={15} aria-hidden /> Canvas <ChevronDown size={14} aria-hidden className={`sp-chev${menu ? ' is-open' : ''}`} />
          </button>
          {menu && (
            <ul id="sp-canvas-links" className="sp-menu__pop" aria-label="Canvas">
              <li><Link className="sp-menu__item sp-focus-ring" href={`/studypulse/canvas?subject=${userSubjectId}&view=activity`}><Inbox size={15} aria-hidden /> Activity Bank</Link></li>
              <li><Link className="sp-menu__item sp-focus-ring" href={`/studypulse/canvas?subject=${userSubjectId}&view=announcements`}><Megaphone size={15} aria-hidden /> Announcements</Link></li>
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
