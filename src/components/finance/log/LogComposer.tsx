'use client';

import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { ArrowUp, MoreHorizontal } from 'lucide-react';
import { previewSpend, type SpendSnapshot } from '@/lib/finance/verdict';
import { categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import { formatPeso } from '@/lib/finance/format';
import { parseAmount } from '../financeApi';
import DateChoice from './DateChoice';
import CategoryPicker from './CategoryPicker';

export interface ComposerDraft { amount: number; category: string; date: string }

/* The always-open composer (spec §7.1). Expense only; everything else goes through the
   drawer via "⋯". `inline` sits under the tabs on Overview/Activity (desktop) and reads as a
   sentence: "₱ amount on [category] [day]" (Addendum B); `dock` is the phone version fixed to
   the bottom (rendered by the shell through a portal): top-category chips, then the amount. */
export default function LogComposer({ variant, snapshot, topCategories, initialCategory, today, onLog, onMore, inputRef }: {
  variant: 'inline' | 'dock';
  snapshot: SpendSnapshot | null;
  topCategories: string[];
  initialCategory: string;
  today: string;
  onLog: (draft: ComposerDraft) => Promise<void>;
  onMore: (draft: { amount: string; category: string }) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const ownRef = useRef<HTMLInputElement>(null);
  const amountRef = inputRef ?? ownRef;
  const [raw, setRaw] = useState('');
  const [category, setCategory] = useState(initialCategory);
  /* null = "today", which follows the live `today` prop, so a composer left open past midnight
     never logs onto yesterday. Only an explicitly picked other day is stored. */
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;
  const pickDate = (d: string) => setPicked(d === today ? null : d);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const amount = parseAmount(raw);
  const impact = amount && snapshot ? previewSpend(snapshot, amount).after : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!amount) { setError('Enter an amount greater than 0.'); return; }
    setBusy(true);
    setError('');
    try {
      await onLog({ amount, category, date });
      setRaw('');
      setPicked(null);
      amountRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const focusAmount = () => amountRef.current?.focus();
  const chips = (
    <div className="fin-composer__chips" role="group" aria-label="Category">
      {topCategories.map(c => (
        <button key={c} type="button" className={`fin-chip${c === category ? ' is-on' : ''}`} aria-pressed={c === category} onClick={() => setCategory(c)}>
          <span aria-hidden>{categoryEmoji(c)}</span> {categoryLabel(c)}
        </button>
      ))}
      <CategoryPicker variant="chip" value={category} onChange={setCategory} topCategories={topCategories} onPicked={focusAmount} />
    </div>
  );
  const more = (
    <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm fin-composer__more" aria-label="More options" onClick={() => onMore({ amount: raw, category })}>
      <MoreHorizontal size={16} aria-hidden />
    </button>
  );

  return (
    <form className={`fin-composer fin-composer--${variant}`} onSubmit={submit} aria-label="Log an expense" noValidate>
      {variant === 'dock' && chips}
      <div className="fin-composer__row">
        {variant === 'dock' && more}
        <label className="fin-composer__amount">
          <span className="fin-composer__peso" aria-hidden>₱</span>
          <input
            ref={amountRef} inputMode="decimal" enterKeyHint="send" autoComplete="off" placeholder="0.00" aria-label="Amount" value={raw}
            onChange={e => { setRaw(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Escape') setRaw(''); }}
          />
        </label>
        {variant === 'inline' && (
          <>
            {/* The picker's accessible name ("Category: Food") carries the meaning of "on". */}
            <span className="fin-composer__word" aria-hidden>on</span>
            <CategoryPicker value={category} onChange={setCategory} topCategories={topCategories} onPicked={focusAmount} />
            <DateChoice value={date} onChange={pickDate} today={today} />
            <span className="fin-push" />
            {more}
          </>
        )}
        <button type="submit" className="fin-btn fin-btn--primary fin-composer__send" disabled={!amount || busy} aria-label={variant === 'dock' ? 'Log expense' : undefined}>
          {variant === 'dock' ? <ArrowUp size={18} aria-hidden /> : <>Log <span className="fin-kbd">↵</span></>}
        </button>
      </div>
      {variant === 'inline' && (
        <div className="fin-composer__under fin-num" aria-live="polite">
          {impact && <span>Leaves <b>{formatPeso(impact.safe)}</b> safe · <b>{formatPeso(impact.perDay)}</b>/day</span>}
          <span className="fin-push"><kbd className="fin-kbd" title="Ctrl K jumps here">Ctrl K</kbd></span>
        </div>
      )}
      {error && <p className="fin-error" role="alert">{error}</p>}
    </form>
  );
}
