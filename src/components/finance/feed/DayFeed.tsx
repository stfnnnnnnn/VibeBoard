'use client';

import { Trash2 } from 'lucide-react';
import { categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import type { DayGroup, FeedItem } from '@/lib/finance/feed';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { LedgerAmount } from '../ui/Money';

export const feedKey = (item: { type: string; id: number }) => `${item.type}-${item.id}`;

export function itemLabel(item: { type: string; label: string }): string {
  return item.type === 'expense' ? categoryLabel(item.label) : item.label;
}

/* The day header's labelled In / Out / Saved chips, non-zero only (Addendum A). */
function DayNet({ g }: { g: DayGroup }) {
  const parts = [
    { key: 'in', label: 'In', value: g.inflow },
    { key: 'out', label: 'Out', value: g.spent },
    { key: 'save', label: 'Saved', value: g.saved },
  ].filter(p => Math.round(p.value) > 0); // a chip that would read ₱0 is dropped
  if (!parts.length) return null;
  return (
    <span className="fin-feed__net">
      <span className="fin-sr-only">{parts.map(p => `${p.label} ${formatPesoWhole(p.value)}`).join(', ')}</span>
      {parts.map(p => (
        <span key={p.key} className={`fin-daychip fin-daychip--${p.key} fin-num`} aria-hidden>
          <span className="fin-daychip__lbl">{p.label}</span>{formatPesoWhole(p.value)}
        </span>
      ))}
    </span>
  );
}

function subLine(item: FeedItem): string {
  if (item.recurring) return 'Recurring';
  if (item.type === 'savings') return 'Savings goal';
  // Allowance rows get no sub-line: the title already says "Allowance".
  return '';
}

/* Day-grouped transactions (spec §9.2, Addendum A): header with the day's In / Out / Saved
   chips, then rows in a ledger column. Shared by Overview (latest 8) and Activity (paged). */
export default function DayFeed({ groups, onDelete, freshKey = null }: {
  groups: DayGroup[]; onDelete?: (item: FeedItem) => void; freshKey?: string | null;
}) {
  return (
    <div className={`fin-feed${onDelete ? ' fin-feed--del' : ''}`}>
      {groups.map(g => (
        <section key={g.date} className="fin-feed__day" aria-labelledby={`fin-day-${g.date}`}>
          <h3 className="fin-feed__head" id={`fin-day-${g.date}`}>
            <span className="fin-feed__title">{g.title}</span>
            {g.subtitle && <span className="fin-feed__sub">{g.subtitle}</span>}
            <DayNet g={g} />
          </h3>
          <ul className="fin-feed__list">
            {g.items.map(item => {
              const tone = item.type === 'expense' ? 'out' : item.type === 'savings' ? 'save' : 'in';
              return (
                <li key={feedKey(item)} className={`fin-row${feedKey(item) === freshKey ? ' is-fresh' : ''}`}>
                  <span className={`fin-ico fin-ico--${tone}`} aria-hidden>{item.type === 'expense' ? categoryEmoji(item.label) : item.type === 'savings' ? '◎' : '↓'}</span>
                  <span className="fin-row__text">
                    <span className="fin-row__title" title={itemLabel(item)}>{itemLabel(item)}</span>
                    {subLine(item) && <span className="fin-row__sub">{subLine(item)}</span>}
                  </span>
                  <LedgerAmount value={item.amount} tone={tone} />
                  {onDelete && (
                    <button type="button" className="fin-row__del" aria-label={`Delete ${itemLabel(item)} ${formatPeso(item.amount)}`} onClick={() => onDelete(item)}>
                      <Trash2 size={15} aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
