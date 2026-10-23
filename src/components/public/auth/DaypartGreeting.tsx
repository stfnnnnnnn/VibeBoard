'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun, Sunrise, Sunset } from 'lucide-react';
import { DAYPART_COPY, formatWhen, type Daypart } from '@/lib/auth/daypart';

const ICON: Record<Daypart, typeof Sun> = { morning: Sunrise, afternoon: Sun, evening: Sunset, night: Moon };
const ORDER: Daypart[] = ['morning', 'afternoon', 'evening', 'night'];

/* All four variants render on the server; public.css shows the one matching <html data-daypart>. The clock
   text needs the visitor's time, so it fills in after mount (the chip keeps its height meanwhile). */
export default function DaypartGreeting({ page }: { page: 'login' | 'signup' }) {
  const [when, setWhen] = useState('');
  useEffect(() => {
    const tick = () => setWhen(formatWhen(new Date()));
    tick();
    const t = setInterval(tick, 30_000);
    // Pause the sky glows' drift while the tab is hidden (public.css: html.pub-hidden).
    const vis = () => document.documentElement.classList.toggle('pub-hidden', document.hidden);
    document.addEventListener('visibilitychange', vis);
    vis();
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); document.documentElement.classList.remove('pub-hidden'); };
  }, []);
  return (
    <>
      <div className="auth-when dp" aria-hidden={!when}>
        {ORDER.map(d => { const I = ICON[d]; return <span key={d} data-dp={d}><I size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />{when}</span>; })}
      </div>
      {page === 'login' ? (
        <>
          <h1 className="auth-h1 dp">{ORDER.map(d => <span key={d} data-dp={d}>{DAYPART_COPY[d].greeting}</span>)}</h1>
          <p className="auth-sub dp">{ORDER.map(d => <span key={d} data-dp={d}>{DAYPART_COPY[d].login}</span>)}</p>
        </>
      ) : null}
    </>
  );
}
