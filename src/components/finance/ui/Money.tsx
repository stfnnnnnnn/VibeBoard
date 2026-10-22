// src/components/finance/ui/Money.tsx
import { formatPeso, roundsToZero } from '@/lib/finance/format';

/* A peso amount in tabular numerals with its money colour. `signed` prefixes + for income
   and − for spending; savings show unsigned (they move money, not lose it). A value
   that displays as ₱0.00 gets no sign. */
export default function Money({ value, tone, signed = false, className = '' }: {
  value: number; tone?: 'in' | 'out' | 'save'; signed?: boolean; className?: string;
}) {
  const show = signed && !roundsToZero(value);
  const prefix = show && tone === 'in' ? '+' : show && tone === 'out' ? '−' : '';
  return <span className={`fin-num${tone ? ` fin-amount--${tone}` : ''}${className ? ` ${className}` : ''}`}>{prefix}{formatPeso(Math.abs(value))}</span>;
}

const DIRECTION = {
  out: { glyph: '−', word: 'spent' },
  in: { glyph: '+', word: 'received' },
  save: { glyph: '↗', word: 'saved' },
} as const;

/* A feed row's amount (Addendum A, ledger column): an unsigned dark number in one right-aligned
   column, after a small tinted direction badge. The badge is decorative; screen readers get the
   direction as a word after the amount. */
export function LedgerAmount({ value, tone }: { value: number; tone: 'in' | 'out' | 'save' }) {
  const dir = roundsToZero(value) ? null : DIRECTION[tone]; // ₱0.00 has no direction
  return (
    <span className="fin-row__amt fin-num">
      {dir && <span className={`fin-dir fin-dir--${tone}`} aria-hidden>{dir.glyph}</span>}
      <span className="fin-row__val">{formatPeso(Math.abs(value))}</span>
      {dir && <span className="fin-sr-only"> {dir.word}</span>}
    </span>
  );
}
