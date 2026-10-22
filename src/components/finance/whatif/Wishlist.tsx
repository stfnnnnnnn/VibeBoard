'use client';

import { useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import WbPopover from '@/components/workboard/ui/WbPopover';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import { toastError, toastUndo } from '@/components/workboard/ui/WbToaster';
import { previewSpend, VERDICT_LABEL, type SpendSnapshot, type Verdict } from '@/lib/finance/verdict';
import { formatShortDate } from '@/lib/finance/dates';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { EXPENSE_CATEGORIES, categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import { parseAmount, requestJson } from '../financeApi';
import ConfirmPopover from '../ui/ConfirmPopover';
import type { WishItem } from '../types';

const PILL: Record<Verdict, string> = { comfortable: 'fin-pill--success', tight: 'fin-pill--warn', not_recommended: 'fin-pill--danger' };

/* "Can I afford it?" (spec §10.2). Verdicts are recomputed client-side from the loaded
   safe-to-spend snapshot, so they stay current without extra requests. */
export default function Wishlist({ items, snapshot, onChanged, onCheck }: {
  items: WishItem[] | null; snapshot: SpendSnapshot | null; onChanged: () => void; onCheck: (amount: number, category: string) => void;
}) {
  const [name, setName] = useState('');
  const [raw, setRaw] = useState('');
  const [category, setCategory] = useState('leisure');
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [menu, setMenu] = useState<{ item: WishItem; anchor: HTMLElement } | null>(null);
  const [confirmBuy, setConfirmBuy] = useState<{ item: WishItem; anchor: HTMLElement } | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  if (items === null) return <>{[0, 1, 2].map(i => <WbSkeleton key={i} height={44} radius={8} style={{ marginBottom: 10 }} />)}</>;
  const open = items.filter(i => i.status === 'open');
  const done = items.filter(i => i.status !== 'open');

  /* Throws on failure so ConfirmPopover ("Buy anyway") can show the error inline. */
  const perform = async (item: WishItem, action: 'buy' | 'save') => {
    setPending(item.wish_id);
    try {
      await requestJson(`/api/finance/wishlist/${item.wish_id}`, { method: 'PATCH', body: { action } });
    } finally {
      setPending(null);
    }
    onChanged();
    toastUndo(action === 'buy' ? `Bought ${item.name} · logged ${formatPeso(item.amount)}` : `“${item.name}” is now a goal`, async () => {
      try { await requestJson(`/api/finance/wishlist/${item.wish_id}`, { method: 'PATCH', body: { action: 'reopen' } }); }
      catch (e) { toastError(e instanceof Error ? e.message : 'Could not undo.'); }
      onChanged();
    });
  };
  const act = async (item: WishItem, action: 'buy' | 'save') => {
    if (pending !== null) return;
    try {
      await perform(item, action);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Something went wrong.', () => act(item, action));
    }
  };
  const add = async () => {
    const amount = parseAmount(raw);
    if (!name.trim()) { setError('What do you want to buy?'); return; }
    if (!amount) { setError('Enter an amount greater than 0.'); return; }
    if (adding) return;
    setError(''); setAdding(true);
    try {
      await requestJson('/api/finance/wishlist', { body: { name: name.trim(), amount, category } });
      setName(''); setRaw('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that.');
    } finally {
      setAdding(false);
    }
  };
  const remove = async (item: WishItem) => {
    setMenu(null);
    if (pending !== null) return;
    setPending(item.wish_id);
    try {
      await requestJson(`/api/finance/wishlist/${item.wish_id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not remove that.', () => remove(item));
    } finally {
      setPending(null);
    }
  };
  const pillText = (v: Verdict, perDay: number) => (v === 'tight' ? `${VERDICT_LABEL.tight}: ${formatPesoWhole(perDay)}/day after` : VERDICT_LABEL[v]);

  return (
    <div className="fin-wish">
      {open.length === 0 && <p className="fin-hint fin-wish__empty">Thinking about buying something? Add it here to see if it fits.</p>}
      <ul className="fin-wish__list">
        {open.map(item => {
          const p = snapshot ? previewSpend(snapshot, item.amount) : null;
          const label = p ? pillText(p.verdict, p.after.perDay) : '';
          const notNow = p?.verdict === 'not_recommended';
          const busy = pending !== null;
          return (
            <li key={item.wish_id} className="fin-wish__row">
              <span className="fin-ico fin-ico--out" aria-hidden>{categoryEmoji(item.category)}</span>
              <span className="fin-row__text">
                <span className="fin-row__title" title={item.name}>{item.name}</span>
                <span className="fin-row__sub"><span className="fin-num">{formatPeso(item.amount)}</span> · {categoryLabel(item.category)} · added {formatShortDate(item.created_at.slice(0, 10))}</span>
              </span>
              {p && <span className={`fin-pill ${PILL[p.verdict]} fin-num`}>{label}</span>}
              <span className="fin-wish__acts">
                <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={notNow || busy} onClick={() => act(item, 'buy')}>Buy now</button>
                <button type="button" className={`fin-btn ${notNow ? 'fin-btn--primary' : 'fin-btn--ghost'} fin-btn--sm`} disabled={busy} onClick={() => act(item, 'save')}>Save for it{notNow ? ' →' : ''}</button>
                <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" aria-label={`${item.name} options`} disabled={busy} onClick={e => setMenu({ item, anchor: e.currentTarget })}><MoreHorizontal size={16} aria-hidden /></button>
              </span>
            </li>
          );
        })}
      </ul>
      {menu && (
        <WbPopover open anchor={menu.anchor} onClose={() => setMenu(null)} width={220} ariaLabel={`${menu.item.name} options`} placement="bottom-end">
          <div className="fin-goalmenu">
            <button type="button" className="fin-datechoice__opt" onClick={() => { onCheck(menu.item.amount, menu.item.category); setMenu(null); }}>Check in What if</button>
            {snapshot && previewSpend(snapshot, menu.item.amount).verdict === 'not_recommended' && (
              <button type="button" className="fin-datechoice__opt" onClick={() => { setConfirmBuy(menu); setMenu(null); }}>Buy anyway…</button>
            )}
            <button type="button" className="fin-datechoice__opt fin-goalmenu__danger" onClick={() => remove(menu.item)}>Remove</button>
          </div>
        </WbPopover>
      )}
      {confirmBuy && snapshot && (
        <ConfirmPopover open anchor={confirmBuy.anchor} onClose={() => setConfirmBuy(null)}
          title={`Buy “${confirmBuy.item.name}” anyway?`}
          body={`This logs ${formatPeso(confirmBuy.item.amount)} today and leaves ${formatPesoWhole(previewSpend(snapshot, confirmBuy.item.amount).after.safe)} safe to spend.`}
          confirmLabel="Buy anyway" onConfirm={() => perform(confirmBuy.item, 'buy')} />
      )}
      <form className="fin-wish__add" onSubmit={e => { e.preventDefault(); void add(); }} aria-label="Add something you want">
        <Plus size={15} aria-hidden />
        <input className="fin-wish__name" placeholder="What do you want to buy?" aria-label="Item" value={name} onChange={e => setName(e.target.value)} />
        <input className="fin-wish__amt fin-num" placeholder="₱ 0.00" aria-label="Price" inputMode="decimal" value={raw} onChange={e => setRaw(e.target.value)} />
        <select className="fin-chip fin-chip--select" aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}>
          {EXPENSE_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button type="submit" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={adding}>{adding ? 'Adding…' : 'Check'}</button>
      </form>
      {error && <p className="fin-error" role="alert">{error}</p>}
      {done.length > 0 && (
        <>
          <button type="button" className="fin-link fin-wish__toggle" aria-expanded={showDone} onClick={() => setShowDone(s => !s)}>
            {showDone ? 'Hide' : 'Show'} {done.length} done
          </button>
          {showDone && (
            <ul className="fin-wish__list is-done">
              {done.map(item => (
                <li key={item.wish_id} className="fin-wish__row">
                  <span className="fin-ico fin-ico--out" aria-hidden>{categoryEmoji(item.category)}</span>
                  <span className="fin-row__text"><span className="fin-row__title" title={item.name}>{item.name}</span><span className="fin-row__sub fin-num">{formatPeso(item.amount)}</span></span>
                  <span className="fin-hint">{item.status === 'bought' ? 'Bought' : 'Saving for it'}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
