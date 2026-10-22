'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Home } from 'lucide-react';
import { formatLongDate } from '@/lib/finance/dates';
import { useManilaToday } from './useManilaToday';
import { paceSeries } from '@/lib/finance/pace';
import { useFinanceData } from './useFinanceData';
import FinanceTabs, { FINANCE_TABS } from './FinanceTabs';
import PaceHero from './hero/PaceHero';
import type { FinanceTab, TransactionItem } from './types';
import WbToaster, { toastError, toastInfo, toastUndo } from '@/components/workboard/ui/WbToaster';
import { usePresence } from '@/components/workboard/ui/WbOverlay';
import { DUR } from '@/lib/workboard/ui/tokens';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { categoryLabel } from '@/lib/finance/categories';
import LogComposer, { type ComposerDraft } from './log/LogComposer';
import LogDrawer, { type DrawerPrefill, type LoggedResult } from './log/LogDrawer';
import { createTransaction, deleteTransaction, requestJson } from './financeApi';
import { scheduleDelete, flushAll } from '@/lib/workboard/ui/deferredDelete';
import type { FeedItem } from '@/lib/finance/feed';
import OverviewTab from './tabs/OverviewTab';
import PlanTab from './tabs/PlanTab';
import ActivityTab from './tabs/ActivityTab';
import GoalsTab from './tabs/GoalsTab';
import { nextCycle } from '@/lib/finance/envelopes';
import { feedKey, itemLabel } from './feed/DayFeed';
import { plannedKey } from './feed/UpcomingList';

const isTab = (v: string | null): v is FinanceTab => FINANCE_TABS.some(t => t.key === v);

export default function FinanceShell({ firstName }: { firstName: string }) {
  const params = useSearchParams();
  const tab: FinanceTab = isTab(params.get('tab')) ? (params.get('tab') as FinanceTab) : 'overview';
  const setTab = useCallback((t: FinanceTab) => {
    if (t === tab) return; // re-clicking the active tab must not stack a duplicate history entry
    const q = new URLSearchParams(params.toString());
    if (t === 'overview') q.delete('tab'); else q.set('tab', t);
    const qs = q.toString();
    /* A shallow history entry: Next (>= 14.1) syncs useSearchParams with pushState, so the tab
       switches on this frame instead of after an RSC round trip; Back and reload still work. */
    window.history.pushState(null, '', `/finance${qs ? `?${qs}` : ''}`);
  }, [params, tab]);

  const data = useFinanceData();
  /* Live Manila date: crossing midnight with the tab open moves "today" (and every write that
     defaults to it), then reloads everything so pace, cycle day and Upcoming follow. */
  const today = useManilaToday();
  const seenToday = useRef(today);
  const { refreshAll } = data;
  useEffect(() => {
    if (seenToday.current === today) return; // first mount: useFinanceData already loads
    seenToday.current = today;
    void refreshAll();
  }, [today, refreshAll]);
  const { sts } = data;
  const series = useMemo(() => (sts ? paceSeries(sts, today) : null), [sts, today]);
  const days = sts?.days_until_next_allowance ?? null;
  const todayLine = [
    formatLongDate(today),
    series ? `Day ${series.dayNumber} of this cycle` : null,
    days === null ? null : days === 0 ? 'next allowance today' : `${days} day${days === 1 ? '' : 's'} to next allowance`,
  ].filter(Boolean).join(' · ');

  const goals = data.summary?.goals ?? [];
  const activePlan = data.templates?.find(t => t.is_default) ?? null;
  const planBadge = !!(activePlan && nextCycle(activePlan, today));

  const composerRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  /* Publish the dock's measured height on <html> for WbToaster's phone offset (--wb-bulkbar-h)
     and the 601–700px override in finance.css; otherwise the Undo toast covers the dock. */
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dockRef.current;
    if (!mounted || !el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--wb-bulkbar-h', `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty('--wb-bulkbar-h'); };
  }, [mounted]);
  const [lastCategory, setLastCategory] = useState<string | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => {
    try { const saved = window.localStorage.getItem('fin:lastCategory'); if (saved) setLastCategory(saved); } catch { /* storage blocked */ }
    setPrefsLoaded(true);
  }, []);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const unhide = useCallback((key: string) => setHidden(h => { const n = new Set(h); n.delete(key); return n; }), []);
  useEffect(() => () => flushAll(), []); // client navigation away sends pending deletes
  const freshTimer = useRef<number | undefined>(undefined);
  /* The new row only exists once the refresh lands, so the 700ms clear starts after `ready`
     (otherwise a slow refresh renders the row after freshKey was already cleared). */
  const freshRef = useRef<string | null>(null);
  const markFresh = useCallback((key: string, ready: Promise<unknown>) => {
    freshRef.current = key;
    setFreshKey(key);
    window.clearTimeout(freshTimer.current);
    void ready.finally(() => {
      if (freshRef.current !== key) return; // a newer log owns the tint and its timer
      window.clearTimeout(freshTimer.current);
      freshTimer.current = window.setTimeout(() => {
        if (freshRef.current !== key) return;
        freshRef.current = null;
        setFreshKey(null);
      }, 700);
    });
  }, []);
  useEffect(() => () => window.clearTimeout(freshTimer.current), []);

  /* Spec §7.3: the row hides now; DELETE goes out when the Undo toast expires (or on pagehide).
     `hideKey` is the row's key in the hidden set: feedKey() for feed rows, plannedKey() for
     planned rows, so the two lists never hide each other's rows. */
  const deferDelete = useCallback(function run(item: Pick<TransactionItem, 'type' | 'id' | 'amount' | 'label'>, hideKey: string) {
    setHidden(h => new Set(h).add(hideKey));
    const handle = scheduleDelete(`fin-${hideKey}`, keepalive => deleteTransaction(item.type, item.id, keepalive));
    toastUndo(`Deleted ${formatPeso(item.amount)} · ${itemLabel(item)}`, () => {
      if (handle.cancel()) unhide(hideKey);
    }, {
      onExpire: () => {
        handle.flush()
          .then(() => data.refreshAll())
          .catch(() => { unhide(hideKey); toastError('Could not delete that entry.', () => run(item, hideKey)); });
      },
    });
  }, [data, unhide]);
  const deleteItem = useCallback((item: FeedItem) => deferDelete(item, feedKey(item)), [deferDelete]);
  const deletePlanned = useCallback((item: TransactionItem) => deferDelete(item, plannedKey(item)), [deferDelete]);

  const logExpense = useCallback(async (draft: ComposerDraft) => {
    const { id } = await createTransaction({ type: 'expense', amount: draft.amount, entry_date: draft.date, category: draft.category });
    setLastCategory(draft.category);
    try { window.localStorage.setItem('fin:lastCategory', draft.category); } catch { /* storage blocked */ }
    markFresh(`expense-${id}`, data.refreshAll());
    toastUndo(`Logged ${formatPeso(draft.amount)} · ${categoryLabel(draft.category)}`, async () => {
      try {
        await deleteTransaction('expense', id);
        void data.refreshAll();
      } catch {
        toastError('Could not undo that.', async () => { await deleteTransaction('expense', id); void data.refreshAll(); });
      }
    });
  }, [data, markFresh]);

  const [drawer, setDrawer] = useState<{ prefill: DrawerPrefill; instant: boolean; n: number } | null>(null);
  const drawerPresence = usePresence(drawer, DUR.slow);
  /* n changes on every open, so the drawer's form state resets even when the prefill is the same
     and the previous drawer is still in its exit window. */
  const drawerSeq = useRef(0);
  const openDrawer = useCallback((prefill: DrawerPrefill = {}, instant = false) => setDrawer({ prefill, instant, n: ++drawerSeq.current }), []);
  const drawerOpenRef = useRef(false);
  useEffect(() => { drawerOpenRef.current = drawer !== null; }, [drawer]);

  /* Ctrl+K: focus the inline composer when it is visible; otherwise (other tabs, or phones
     where the inline composer is hidden) open the drawer without animation. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (drawerOpenRef.current) return; // keep focus inside the open (aria-modal) drawer
        const el = composerRef.current;
        if (el && el.offsetParent !== null) el.focus();
        else openDrawer({}, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDrawer]);

  const onLogged = useCallback((r: LoggedResult) => {
    markFresh(`${r.type}-${r.id}`, data.refreshAll());
    if (r.planError) { toastError(`Allowance saved, but the plan couldn't be applied: ${r.planError}`); return; }
    if (r.planApplied) { toastInfo(`Logged ${formatPeso(r.amount)} allowance · envelopes set from your plan`); return; }
    toastUndo(`Logged ${formatPeso(r.amount)} · ${r.label}`, async () => {
      try {
        await deleteTransaction(r.type, r.id);
        void data.refreshAll();
      } catch {
        toastError('Could not undo that.', async () => { await deleteTransaction(r.type, r.id); void data.refreshAll(); });
      }
    });
  }, [data, markFresh]);

  const composerProps = {
    snapshot: sts,
    topCategories: data.logContext?.top_categories ?? ['food', 'transportation', 'academic', 'grocery'],
    initialCategory: lastCategory ?? data.logContext?.top_categories[0] ?? 'food',
    today,
    onLog: logExpense,
    onMore: (d: { amount: string; category: string }) => openDrawer({ type: 'expense', amount: d.amount, category: d.category }),
  };

  return (
    <div className="vb-bg fin-page">
      <div className="fin-wrap">
        <header className="fin-header">
          <div>
            <h1 className="fin-header__title">{firstName}&apos;s Finances</h1>
            <p className="fin-header__today">{todayLine}</p>
          </div>
          <div className="fin-header__actions">
            <Link href="/dashboard" className="fin-btn fin-btn--ghost" aria-label="Dashboard"><Home size={15} aria-hidden /> <span className="fin-header__lbl">Dashboard</span></Link>
            <button type="button" className="fin-btn fin-btn--primary" onClick={() => openDrawer()}>＋ Log <span className="fin-kbd fin-header__kbd">Ctrl K</span></button>
          </div>
        </header>

        <PaceHero sts={sts} series={series}>
          <FinanceTabs value={tab} onChange={setTab} planBadge={planBadge} />
        </PaceHero>

        {(tab === 'overview' || tab === 'activity') && (
          <div className="fin-composer-slot"><LogComposer key={`${prefsLoaded ? 'ready' : 'init'}-${data.logContext ? 'ctx' : 'noctx'}`} variant="inline" inputRef={composerRef} {...composerProps} /></div>
        )}

        <div role="tabpanel" id={`fin-panel-${tab}`} aria-labelledby={`fin-tab-${tab}`} key={tab} className="fin-panel">
          {tab === 'overview' && (
            <OverviewTab recent={data.recentFeed} upcoming={sts?.upcoming ?? null} today={today} hidden={hidden}
              freshKey={freshKey} onDelete={deleteItem} onDeletePlanned={deletePlanned} onSeeAll={() => setTab('activity')} />
          )}
          {tab === 'plan' && (
            <PlanTab templates={data.templates} budgets={data.budgets} savings={data.savingsProgress}
              remainingCycleAllowance={data.remainingCycleAllowance} accountRemaining={sts?.current_balance ?? null} today={today}
              onChanged={() => { void data.refreshAll(); }} />
          )}
          {tab === 'activity' && (
            <ActivityTab today={today} range={data.range} setRange={data.setRange} summary={data.summary} upcoming={sts?.upcoming ?? null}
              recurringRules={data.recurringRules} goals={goals} hidden={hidden} freshKey={freshKey} onDelete={deleteItem} onDeletePlanned={deletePlanned}
              dataVersion={data.dataVersion} onRecurringChanged={() => { void data.refreshRecurring(); }} />
          )}
          {tab === 'goals' && (
            <GoalsTab
              goals={data.summary ? data.summary.goals : null} today={today} sts={sts} series={series} wishlist={data.wishlist}
              onChanged={() => { void data.refreshAll(); }}
              onAddToGoal={g => openDrawer({ type: 'savings', goalId: g.goal_id })}
              onRecord={async (amount, category) => {
                const { id } = await createTransaction({ type: 'expense', amount, entry_date: today, category });
                void data.refreshAll();
                toastUndo(`Logged ${formatPeso(amount)} · ${categoryLabel(category)}`, async () => {
                  try {
                    await deleteTransaction('expense', id);
                    void data.refreshAll();
                  } catch {
                    toastError('Could not undo that.', async () => { await deleteTransaction('expense', id); void data.refreshAll(); });
                  }
                });
              }}
              onSaveForIt={async (amount, category) => {
                await requestJson('/api/finance/wishlist', { body: { name: `${categoryLabel(category)} · ${formatPesoWhole(amount)}`, amount, category } });
                void data.loadWishlist();
                toastInfo('Added to your wishlist');
              }}
            />
          )}
        </div>
      </div>
      {drawerPresence.value && (
        <LogDrawer
          key={drawerPresence.value.n}
          open={drawerPresence.open}
          instant={drawerPresence.value.instant}
          prefill={drawerPresence.value.prefill}
          onClose={() => setDrawer(null)}
          today={today}
          snapshot={sts}
          goals={goals}
          templates={data.templates ?? []}
          repeats={data.logContext?.repeats ?? []}
          onLogged={onLogged}
          onRecurringSaved={() => { void data.refreshRecurring(); toastInfo('Repeating entry saved'); }}
        />
      )}
      {mounted && createPortal(<div ref={dockRef} className="fin-dock"><LogComposer key={`${prefsLoaded ? 'ready' : 'init'}-${data.logContext ? 'ctx' : 'noctx'}`} variant="dock" {...composerProps} /></div>, document.body)}
      <WbToaster raised />
    </div>
  );
}
