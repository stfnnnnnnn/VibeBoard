'use client';

import { Trash2 } from 'lucide-react';
import { categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import { formatDay } from '@/lib/finance/dates';
import { formatPeso } from '@/lib/finance/format';
import { LedgerAmount } from '../ui/Money';
import type { TransactionItem } from '../types';

/* The shell's hidden-set key for a planned row; prefixed so it never collides with feedKey(). */
export const plannedKey = (item: { type: string; id: number }) => `planned-${item.type}-${item.id}`;

/* Planned rows from safe-to-spend's `upcoming` (plan ruling R6), shown at 75% opacity. With
   `onDelete`, each row ends in the same delete button as DayFeed (legacy parity). */
export default function UpcomingList({ items, today, limit, onDelete }: {
  items: TransactionItem[]; today: string; limit?: number; onDelete?: (item: TransactionItem) => void;
}) {
  const shown = typeof limit === 'number' ? items.slice(0, limit) : items;
  return (
    <ul className="fin-feed__list">
      {shown.map(item => {
        const tone = item.type === 'expense' ? 'out' : item.type === 'savings' ? 'save' : 'in';
        const label = item.type === 'expense' ? categoryLabel(item.label) : item.label;
        return (
          <li key={`${item.type}-${item.id}`} className="fin-row is-planned">
            <span className={`fin-ico fin-ico--${tone}`} aria-hidden>{item.type === 'expense' ? categoryEmoji(item.label) : item.type === 'savings' ? '◎' : '↓'}</span>
            <span className="fin-row__text">
              <span className="fin-row__title" title={label}>{label}</span>
              <span className="fin-row__sub">{formatDay(item.entry_date, today)} · Planned</span>
            </span>
            <LedgerAmount value={item.amount} tone={tone} />
            {onDelete && (
              <button type="button" className="fin-row__del" aria-label={`Delete planned ${label} ${formatPeso(item.amount)}`} onClick={() => onDelete(item)}>
                <Trash2 size={15} aria-hidden />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
