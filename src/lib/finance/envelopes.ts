// src/lib/finance/envelopes.ts
/* Plan tab models (spec §8): envelope cards from the budgets route, the next-cycle offer,
   and the template → builder-row mapping shared by the editor and "Start next cycle". */
import { addDays, daysBetween } from './dates';
import type { Tier } from './ui/colors';

export interface BudgetRow {
  budget_id: number | null; category: string; cap_amount: number | null; plan_amount: number | null;
  is_override: boolean; override_reason: string | null; tier: Tier | null; spent: number;
  period_start: string | null; period_end: string | null;
}
export interface SavingsRow {
  budget_id: number; cap_amount: number; plan_amount: number | null; is_override: boolean; override_reason: string | null;
  funded: number; tier: Tier; period_start: string | null; period_end: string | null;
}
export interface EnvelopeModel {
  category: string; isSavings: boolean; tier: Tier; cap: number; spent: number; left: number; pct: number;
  over: boolean; fasterThanPlan: boolean; isOverride: boolean; planAmount: number | null; reason: string | null; budgetId: number | null;
}

const TIER_ORDER: Tier[] = ['required', 'target', 'flexible'];
const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildEnvelopes(budgets: BudgetRow[], savings: SavingsRow | null, today: string) {
  const dated = budgets.find(b => b.cap_amount !== null && b.period_start && b.period_end) ?? (savings?.period_start && savings.period_end ? savings : null);
  const period = dated ? { start: dated.period_start!, end: dated.period_end! } : null;
  const elapsedPct = period && daysBetween(period.start, period.end) > 0
    ? Math.min(100, Math.max(0, Math.round((daysBetween(period.start, today) / daysBetween(period.start, period.end)) * 100)))
    : null;

  const make = (category: string, isSavings: boolean, tier: Tier, cap: number, spent: number, row: { is_override: boolean; plan_amount: number | null; override_reason: string | null; budget_id: number | null }): EnvelopeModel => {
    const pct = cap > 0 ? Math.round((spent / cap) * 100) : 0;
    return {
      category, isSavings, tier, cap, spent, left: r2(cap - spent), pct,
      over: spent > cap,
      fasterThanPlan: !isSavings && spent > 0 && elapsedPct !== null && pct - elapsedPct > 15,
      isOverride: row.is_override, planAmount: row.plan_amount, reason: row.override_reason, budgetId: row.budget_id,
    };
  };

  const envelopes = budgets
    .filter(b => b.cap_amount !== null)
    .map(b => make(b.category, false, b.tier ?? 'flexible', b.cap_amount!, b.spent, b));
  if (savings) envelopes.push(make('savings', true, savings.tier, savings.cap_amount, savings.funded, savings));
  envelopes.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || b.cap - a.cap);
  return { envelopes, elapsedPct, period };
}

/* Plan tab grouping (Addendum B): one group per tier, in tier order, empty tiers left out.
   A group's `left` counts only money still available, so an overspent envelope adds 0 rather
   than pulling its neighbours' total down. */
export interface EnvelopeGroup { tier: Tier; envelopes: EnvelopeModel[]; left: number; cap: number }
export function groupEnvelopes(envelopes: EnvelopeModel[]): EnvelopeGroup[] {
  return TIER_ORDER
    .map(tier => {
      const list = envelopes.filter(e => e.tier === tier);
      return { tier, envelopes: list, left: r2(list.reduce((s, e) => s + Math.max(0, e.left), 0)), cap: r2(list.reduce((s, e) => s + e.cap, 0)) };
    })
    .filter(g => g.envelopes.length > 0);
}

/* The "Left in envelopes" summary tile. left = every envelope's left clamped at 0 (savings
   included: unfunded savings is still money with a job); spent = what the envelopes have used,
   spending plus savings funded, overspend included; pct = spent as a share of all caps. */
export function envelopeSummary(envelopes: EnvelopeModel[]): { left: number; spent: number; cap: number; pct: number } {
  const left = r2(envelopes.reduce((s, e) => s + Math.max(0, e.left), 0));
  const spent = r2(envelopes.reduce((s, e) => s + e.spent, 0));
  const cap = r2(envelopes.reduce((s, e) => s + e.cap, 0));
  return { left, spent, cap, pct: cap > 0 ? Math.round((spent / cap) * 100) : 0 };
}

export function nextCycle(
  t: { last_allowance_amount: number | null; last_period_start: string | null; last_period_end: string | null },
  today: string,
): { start: string; end: string; days: number; amount: number } | null {
  if (t.last_allowance_amount === null || !t.last_period_start || !t.last_period_end) return null;
  if (t.last_period_end >= today) return null;
  const days = daysBetween(t.last_period_start, t.last_period_end) + 1;
  let start = addDays(t.last_period_end, 1);
  let end = addDays(start, days - 1);
  // A lapsed plan never offers a period that is already over (decision D1): roll forward by
  // whole cycle lengths, keeping the same cadence, until the period contains today.
  if (end < today) {
    const skip = Math.ceil(daysBetween(end, today) / days);
    start = addDays(start, skip * days);
    end = addDays(start, days - 1);
  }
  return { start, end, days, amount: t.last_allowance_amount };
}

/* Decision D2: how much allowance a plan's cycle may be given. Re-saving the cycle that is
   running (period start = the plan's last_period_start) may count what that cycle has already
   spent or saved, since that money was part of its allowance; any other period can only
   assign the balance you have now. Mirrors the allocation-templates `save` check. */
export function planAllowanceCeiling(
  balance: number | null,
  current: { start: string | null; used: number } | null,
  periodStart: string,
): number | null {
  if (balance === null) return null;
  if (current?.start && periodStart === current.start) return r2(balance + current.used);
  return balance;
}

export function templateToRows(items: { category: string; priority_tier: Tier; allocation_type: 'fixed' | 'percent'; amount: number | null; percent: number | null }[]) {
  return items.map(it => ({
    category: it.category,
    priority_tier: it.priority_tier,
    allocation_type: it.allocation_type,
    value: it.allocation_type === 'fixed' ? (it.amount ?? 0) : (it.percent ?? 0),
  }));
}
