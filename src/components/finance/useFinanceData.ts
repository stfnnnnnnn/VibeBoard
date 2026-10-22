'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Range, SummaryResponse, SafeToSpendResponse, AllocTemplate, BudgetItem, SavingsProgress, RecurringRule, LogContext, WishItem,
} from './types';
import type { FeedItem } from '@/lib/finance/feed';

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/* A per-loader sequence token: each call takes a ticket, and its response may only set state if
   no newer call of the same loader started meanwhile (a slow older response never overwrites a
   fresher one). */
function useLatest() {
  const seq = useRef(0);
  return useCallback(() => {
    const ticket = ++seq.current;
    return () => ticket === seq.current;
  }, []);
}

/* Every dataset the Finance shell shows. `null` means "not loaded yet" (skeleton); a failed
   load also leaves null for that section only, so one slow route never blanks the page. */
export function useFinanceData() {
  const [range, setRange] = useState<Range>('week');
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [sts, setSts] = useState<SafeToSpendResponse | null>(null);
  const [templates, setTemplates] = useState<AllocTemplate[] | null>(null);
  const [budgets, setBudgets] = useState<BudgetItem[] | null>(null);
  const [remainingCycleAllowance, setRemainingCycleAllowance] = useState<number | null>(null);
  const [savingsProgress, setSavingsProgress] = useState<SavingsProgress | null>(null);
  const [recurringRules, setRecurringRules] = useState<RecurringRule[] | null>(null);
  const [logContext, setLogContext] = useState<LogContext | null>(null);
  const [recentFeed, setRecentFeed] = useState<FeedItem[] | null>(null);
  const [wishlist, setWishlist] = useState<WishItem[] | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const seqSummary = useLatest(), seqSts = useLatest(), seqTemplates = useLatest(), seqBudgets = useLatest();
  const seqRecurring = useLatest(), seqLogContext = useLatest(), seqRecent = useLatest(), seqWishlist = useLatest();

  const loadSummary = useCallback(async (r: Range) => {
    const isLatest = seqSummary();
    const d = await getJson<SummaryResponse>(`/api/finance/summary?range=${r}`);
    if (d && isLatest()) setSummary(d);
  }, [seqSummary]);
  const loadSts = useCallback(async () => {
    const isLatest = seqSts();
    const d = await getJson<SafeToSpendResponse>('/api/finance/safe-to-spend');
    if (d && isLatest()) setSts(d);
  }, [seqSts]);
  /* MySQL DECIMALs arrive as strings; coerce so runtime values match AllocTemplate's number types. */
  const loadTemplates = useCallback(async () => {
    const isLatest = seqTemplates();
    const d = await getJson<{ templates: AllocTemplate[] }>('/api/finance/allocation-templates');
    if (!isLatest()) return;
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    setTemplates((d?.templates ?? []).map(t => ({
      ...t,
      last_allowance_amount: num(t.last_allowance_amount),
      cycle_used: num(t.cycle_used),
      items: t.items.map(it => ({ ...it, amount: num(it.amount), percent: num(it.percent) })),
    })));
  }, [seqTemplates]);
  const loadBudgets = useCallback(async () => {
    const isLatest = seqBudgets();
    const d = await getJson<{ budgets: BudgetItem[]; remaining_allowance: number | null; savings: SavingsProgress | null }>('/api/finance/budgets');
    if (!isLatest()) return;
    setBudgets(d?.budgets ?? []);
    setRemainingCycleAllowance(d?.remaining_allowance ?? null);
    setSavingsProgress(d?.savings ?? null);
  }, [seqBudgets]);
  const loadRecurringRules = useCallback(async () => {
    const isLatest = seqRecurring();
    const d = await getJson<{ rules: RecurringRule[] }>('/api/finance/recurring-rules');
    if (isLatest()) setRecurringRules(d?.rules ?? []);
  }, [seqRecurring]);

  const loadLogContext = useCallback(async () => {
    const isLatest = seqLogContext();
    const d = await getJson<LogContext>('/api/finance/log-context');
    if (d && isLatest()) setLogContext(d);
  }, [seqLogContext]);

  /* 100 is the feed route's max: Overview groups this into its last 3 days with activity, and a
     busy few days must not be cut short mid-day. */
  const loadRecentFeed = useCallback(async () => {
    const isLatest = seqRecent();
    const d = await getJson<{ items: FeedItem[] }>('/api/finance/feed?type=all&period=all&limit=100');
    if (isLatest()) setRecentFeed(d?.items ?? []);
  }, [seqRecent]);

  const loadWishlist = useCallback(async () => {
    const isLatest = seqWishlist();
    const d = await getJson<{ items: WishItem[] }>('/api/finance/wishlist');
    if (isLatest()) setWishlist(d?.items ?? []);
  }, [seqWishlist]);

  useEffect(() => { void loadSts(); void loadTemplates(); void loadBudgets(); void loadRecurringRules(); void loadLogContext(); void loadRecentFeed(); void loadWishlist(); }, [loadSts, loadTemplates, loadBudgets, loadRecurringRules, loadLogContext, loadRecentFeed, loadWishlist]);
  useEffect(() => { void loadSummary(range); }, [range, loadSummary]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSummary(range), loadSts(), loadBudgets(), loadTemplates(), loadLogContext(), loadRecentFeed(), loadWishlist()]);
    setDataVersion(v => v + 1);
  }, [range, loadSummary, loadSts, loadBudgets, loadTemplates, loadLogContext, loadRecentFeed, loadWishlist]);

  const refreshRecurring = useCallback(async () => {
    await Promise.all([loadRecurringRules(), refreshAll()]);
  }, [loadRecurringRules, refreshAll]);

  return {
    range, setRange, summary, sts, templates, budgets, remainingCycleAllowance, savingsProgress, recurringRules, logContext,
    recentFeed, dataVersion, wishlist, loadWishlist, refreshAll, refreshRecurring,
  };
}

export type FinanceData = ReturnType<typeof useFinanceData>;
