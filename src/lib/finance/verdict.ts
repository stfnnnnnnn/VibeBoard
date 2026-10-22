// src/lib/finance/verdict.ts
/* Client-side mirror of the what-if route's maths (spec §4.3), so the What-if slider and the
   wishlist can recompute instantly. Same buffer (10% of a positive balance), same 14-day
   fallback, same three warning conditions as /api/finance/what-if. */
export interface SpendSnapshot {
  current_balance: number;
  upcoming_required: number;
  upcoming_savings: number;
  days_until_next_allowance: number | null;
}
/* `raw` is the unclamped balance − commitments − buffer (negative = how far over you are);
   `safe` is the same figure clamped at zero, which is what every verdict and per-day uses. */
export interface SpendPoint { balance: number; safe: number; raw: number; perDay: number }
export type Verdict = 'comfortable' | 'tight' | 'not_recommended';

export const VERDICT_LABEL: Record<Verdict, string> = {
  comfortable: 'Comfortable', tight: 'Tight', not_recommended: 'Not this cycle',
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const daysOf = (s: SpendSnapshot) => s.days_until_next_allowance ?? 14;

export function pointFor(s: SpendSnapshot, balance: number): SpendPoint {
  const buffer = balance > 0 ? r2(balance * 0.10) : 0;
  const raw = r2(balance - s.upcoming_required - s.upcoming_savings - buffer);
  const safe = Math.max(0, raw);
  const days = daysOf(s);
  return { balance: r2(balance), safe, raw, perDay: days > 0 ? r2(safe / days) : safe };
}

export function verdictFor(before: SpendPoint, after: SpendPoint): Verdict {
  if (after.balance < 0 || after.safe <= 0) return 'not_recommended';
  if (before.perDay > 0 && after.perDay < before.perDay * 0.5) return 'tight';
  return 'comfortable';
}

export function previewSpend(s: SpendSnapshot, amount: number) {
  const before = pointFor(s, s.current_balance);
  const after = pointFor(s, s.current_balance - amount);
  return {
    before,
    after,
    verdict: verdictFor(before, after),
    billsCovered: after.balance >= s.upcoming_required + s.upcoming_savings,
  };
}

/* Closed form of the two thresholds. For a positive remaining balance B−a:
   safe(a) = 0.9·(B−a) − R, where R = upcoming commitments. "Tight" starts where
   safe(a) = 0.5·safe(0); "not recommended" where safe(a) = 0. */
export function verdictZones(s: SpendSnapshot): { tightFrom: number; notFrom: number } {
  const B = s.current_balance;
  const R = s.upcoming_required + s.upcoming_savings;
  const beforeSafe = pointFor(s, B).safe;
  const clamp = (v: number) => Math.min(Math.max(0, r2(v)), Math.max(0, B));
  const notFrom = clamp(B - R / 0.9);
  const tightFrom = beforeSafe > 0 ? clamp(B - (0.5 * beforeSafe + R) / 0.9) : notFrom;
  return { tightFrom: Math.min(tightFrom, notFrom), notFrom };
}
