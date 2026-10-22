'use client';

import { useEffect, useState } from 'react';

/** Minutes since midnight in Asia/Manila, the timezone every Workboard date is reckoned in. */
export function manilaNowMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date());
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

/** `manilaNowMinutes()`, re-read every 60s so a now marker keeps its place in the agenda.
 *  Null until mounted, so server and client markup cannot disagree about the time. */
export function useNowMinutes(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(manilaNowMinutes());
    const id = window.setInterval(() => setNow(manilaNowMinutes()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** "9:05 am" from minutes since midnight. Shared by Timeline's now marker and its day panel. */
export function formatClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
