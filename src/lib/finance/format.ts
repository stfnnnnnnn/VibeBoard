// src/lib/finance/format.ts
/* Every peso amount in Finance goes through these, so separators, the minus sign and
   rounding agree everywhere (spec §4.3). Pool-free and dependency-free.
   The sign is decided after rounding, so a value that displays as zero never shows "−₱0". */
const TWO = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WHOLE = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
const MINUS = '−';

/** True when the amount displays as ₱0.00 — callers use it to drop a +/− prefix. */
export function roundsToZero(n: number): boolean {
  return Math.round(Math.abs(n) * 100) === 0;
}

export function formatPeso(n: number): string {
  const cents = Math.round(Math.abs(n) * 100);
  return `${n < 0 && cents !== 0 ? MINUS : ''}₱${TWO.format(cents / 100)}`;
}

export function formatPesoWhole(n: number): string {
  const whole = Math.round(Math.abs(n));
  return `${n < 0 && whole !== 0 ? MINUS : ''}₱${WHOLE.format(whole)}`;
}

export function formatPesoCompact(n: number): string {
  const abs = Math.abs(n);
  const short = (v: number) => v.toFixed(1).replace(/\.0$/, '');
  /* Round at each unit's display precision first, then pick the unit, so 999.6 reads "₱1k"
     and 999,950 reads "₱1M" instead of "₱1000" / "₱1000k". */
  const whole = Math.round(abs);
  const k = Math.round(abs / 100) / 10;
  const sign = n < 0 && whole !== 0 ? MINUS : '';
  if (whole < 1000) return `${sign}₱${whole}`;
  if (k < 1000) return `${sign}₱${short(k)}k`;
  return `${sign}₱${short(Math.round(abs / 100_000) / 10)}M`;
}

export function splitPeso(n: number): { whole: string; cents: string } {
  const s = formatPeso(n);
  const i = s.lastIndexOf('.');
  return { whole: s.slice(0, i), cents: s.slice(i) };
}
