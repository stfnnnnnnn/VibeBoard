'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Repeat, Search, X } from 'lucide-react';
import WbSegmented from '@/components/workboard/ui/WbSegmented';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import { toastError } from '@/components/workboard/ui/WbToaster';
import { groupByDay, compareText, type FeedItem } from '@/lib/finance/feed';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { addDays } from '@/lib/finance/dates';
import { categoryLabel } from '@/lib/finance/categories';
import DayFeed, { feedKey, itemLabel } from '../feed/DayFeed';
import UpcomingList, { plannedKey } from '../feed/UpcomingList';
import Money from '../ui/Money';
import ConfirmPopover from '../ui/ConfirmPopover';
import { requestJson } from '../financeApi';
import type { GoalProjection, Range, RecurringRule, SummaryResponse, TransactionItem, FeedResponse } from '../types';

/* Spec §9: search + type + period toolbar, period totals, recurring chips, Upcoming, and the
   day-grouped feed paged 50 rows at a time. Search only filters rows already loaded. */
type TypeFilter = 'all' | 'expense' | 'allowance' | 'savings';
const PAGE = 50;
const RANGE_LABEL: Record<Range, string> = { week: 'This week', month: 'This month', all: 'All time' };
const CADENCE: Record<RecurringRule['frequency'], string> = { weekly: 'weekly', biweekly: 'every 2 weeks', monthly: 'monthly' };

export default function ActivityTab({ today, range, setRange, summary, upcoming, recurringRules, goals, hidden, freshKey, onDelete, onDeletePlanned, dataVersion, onRecurringChanged }: {
  today: string; range: Range; setRange: (r: Range) => void; summary: SummaryResponse | null; upcoming: TransactionItem[] | null;
  recurringRules: RecurringRule[] | null; goals: GoalProjection[]; hidden: Set<string>; freshKey: string | null;
  onDelete: (item: FeedItem) => void; onDeletePlanned: (item: TransactionItem) => void; dataVersion: number; onRecurringChanged: () => void;
}) {
  const [type, setType] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stopRule, setStopRule] = useState<{ rule: RecurringRule; anchor: HTMLElement } | null>(null);

  /* Every request carries a generation; a response from an older generation (filter changed,
     data refreshed, or a newer page load) is dropped so stale rows never land in the list. */
  const genRef = useRef(0);
  const filterRef = useRef<string | null>(null);
  const itemsRef = useRef<FeedItem[] | null>(null);
  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => {
    const gen = ++genRef.current;
    const filterKey = `${type}|${range}`;
    const sameFilter = filterRef.current === filterKey;
    filterRef.current = filterKey;
    /* A data refresh (same filters) refetches everything already loaded so the user keeps
       their place; the route caps limit at 100, so beyond that it falls back to page 1. */
    const loaded = itemsRef.current;
    const keep = sameFilter && loaded !== null && loaded.length <= 100;
    const limit = keep ? Math.max(PAGE, loaded.length) : PAGE;
    if (!keep) setItems(null);
    requestJson<FeedResponse>(`/api/finance/feed?type=${type}&period=${range}&limit=${limit}&offset=0`)
      .then(d => { if (gen === genRef.current) { setItems(d.items); setHasMore(d.has_more); } })
      .catch(() => { if (gen === genRef.current && !keep) { setItems([]); setHasMore(false); } });
  }, [type, range, dataVersion]);

  const loadMore = async () => {
    if (!items) return;
    const gen = genRef.current;
    setLoadingMore(true);
    try {
      const d = await requestJson<FeedResponse>(`/api/finance/feed?type=${type}&period=${range}&limit=${PAGE}&offset=${items.length}`);
      if (gen !== genRef.current) return;
      setItems(prev => (prev ? [...prev, ...d.items] : d.items));
      setHasMore(d.has_more);
    } catch {
      toastError('Could not load more entries.');
    } finally {
      setLoadingMore(false);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(i => !hidden.has(feedKey(i))).filter(i => !q || itemLabel(i).toLowerCase().includes(q) || String(i.amount).includes(q));
  }, [items, hidden, query]);

  const totals = summary?.totals;
  const goalsInPeriod = summary ? new Set(summary.breakdown.savings_by_goal.flatMap(b => Object.entries(b).filter(([, v]) => v > 0).map(([g]) => g))).size : 0;
  const cmp = totals ? compareText(totals.expense, summary?.previous_totals?.expense ?? null, range) : null;
  const soon = (upcoming ?? []).filter(i => i.entry_date <= addDays(today, 14) && !hidden.has(plannedKey(i)));
  const soonTotal = soon.reduce((s, i) => s + (i.type === 'allowance' ? 0 : i.amount), 0);
  const ruleWhat = (r: RecurringRule) => r.type === 'expense' ? categoryLabel(r.category ?? '') : r.type === 'savings' ? (goals.find(g => g.goal_id === r.goal_id)?.goal_name ?? 'Savings') : 'Allowance';
  const filtersActive = type !== 'all' || query.trim() !== '';

  return (
    <section className="fin-card" aria-label="Activity">
      <div className="fin-toolbar">
        <label className="fin-search">
          <Search size={15} aria-hidden />
          <input type="search" enterKeyHint="search" placeholder="Search transactions" aria-label="Search transactions" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <WbSegmented<TypeFilter> ariaLabel="Type" idPrefix="fin-act-type" value={type} onChange={setType}
          options={[{ key: 'all', label: 'All' }, { key: 'expense', label: 'Expenses' }, { key: 'allowance', label: 'Allowance' }, { key: 'savings', label: 'Savings' }]} />
        <WbSegmented<Range> ariaLabel="Period" idPrefix="fin-act-period" value={range} onChange={setRange}
          options={[{ key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'all', label: 'All' }]} />
      </div>

      {totals && (
        <p className="fin-totals fin-num">
          {RANGE_LABEL[range]}: <b><Money value={totals.allowance} tone="in" signed /></b> in ·{' '}
          <b><Money value={totals.expense} tone="out" signed /></b> spent ·{' '}
          <b className="fin-amount--save">{formatPeso(totals.savings)}</b> saved{goalsInPeriod > 1 ? ` (across ${goalsInPeriod} goals)` : ''}
          {cmp && <> · <span className={`fin-totals__cmp is-${cmp.tone}`}>{cmp.tone !== 'muted' ? cmp.text.replace(' vs ', ' spending vs ') : cmp.text}</span></>}
        </p>
      )}
      {query.trim() !== '' && hasMore && <p className="fin-hint">Searching the loaded entries. Show more to search further.</p>}

      {recurringRules && recurringRules.length > 0 && (
        <div className="fin-recur">
          <span className="fin-label">Recurring</span>
          {recurringRules.map(r => (
            <span key={r.rule_id} className="fin-recur__chip">
              <Repeat size={13} aria-hidden className="fin-recur__ico" />
              <span className="fin-recur__body">
                <b className="fin-recur__what" title={ruleWhat(r)}>{ruleWhat(r)}</b>
                <span className="fin-recur__meta"><span className="fin-num">{formatPesoWhole(r.amount)}</span> · {CADENCE[r.frequency]}</span>
              </span>
              <button type="button" className="fin-recur__x" aria-label={`Stop ${ruleWhat(r)} recurring`} onClick={e => setStopRule({ rule: r, anchor: e.currentTarget })}><X size={13} aria-hidden /></button>
            </span>
          ))}
        </div>
      )}
      <ConfirmPopover
        open={!!stopRule} anchor={stopRule?.anchor ?? null} onClose={() => setStopRule(null)}
        title={`Stop “${stopRule ? ruleWhat(stopRule.rule) : ''}”?`} body="Its future planned entries are removed too. Past ones stay." confirmLabel="Stop"
        onConfirm={async () => { if (!stopRule) return; await requestJson('/api/finance/recurring-rules', { body: { action: 'delete', rule_id: stopRule.rule.rule_id } }); onRecurringChanged(); }}
      />

      {soon.length > 0 && (
        <div className="fin-upcoming fin-feed--del">
          <h3 className="fin-feed__head"><span className="fin-feed__title">Upcoming</span><span className="fin-feed__sub">next 14 days</span>
            {soonTotal > 0 && <span className="fin-feed__net fin-num fin-amount--out">−{formatPeso(soonTotal)}</span>}</h3>
          <UpcomingList items={soon} today={today} onDelete={onDeletePlanned} />
        </div>
      )}

      {items === null ? (
        [0, 1, 2, 3, 4].map(i => <WbSkeleton key={i} height={40} radius={8} style={{ marginTop: 10 }} />)
      ) : (
        <>
          {shown.length === 0 ? (
            <div className="fin-empty">
              <p>{hasMore ? 'No matches in the loaded entries.' : filtersActive ? 'Nothing matches these filters.' : range === 'all' ? 'No transactions yet.' : 'Nothing in this period yet.'}</p>
              {filtersActive && <button type="button" className="fin-link fin-clear" onClick={() => { setType('all'); setQuery(''); }}>Clear filters</button>}
            </div>
          ) : (
            <DayFeed groups={groupByDay(shown, today)} onDelete={onDelete} freshKey={freshKey} />
          )}
          {hasMore && (
            <div className="fin-more"><button type="button" className="fin-btn fin-btn--ghost" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading…' : 'Show more'}</button></div>
          )}
        </>
      )}
    </section>
  );
}
