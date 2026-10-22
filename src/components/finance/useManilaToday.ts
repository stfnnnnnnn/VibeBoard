'use client';

import { useEffect, useState } from 'react';
import { manilaToday, msUntilNextManilaMidnight } from '@/lib/finance/dates';

/* The current Asia/Manila date, kept live: a tab left open past midnight (or woken from sleep)
   moves to the new day, so entries logged "today" are never backdated. Re-read when the tab
   becomes visible, on window focus, and by a timer set to the next Manila midnight (+1s). */
export function useManilaToday(): string {
  const [today, setToday] = useState(() => manilaToday());
  useEffect(() => {
    let timer: number | undefined;
    const check = () => setToday(prev => { const now = manilaToday(); return now === prev ? prev : now; });
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { check(); schedule(); }, msUntilNextManilaMidnight() + 1000);
    };
    /* Timers are throttled or frozen while the tab sleeps, so a wake also re-arms the timer. */
    const wake = () => { check(); schedule(); };
    const onVisible = () => { if (document.visibilityState === 'visible') wake(); };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', wake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', wake);
    };
  }, []);
  return today;
}
