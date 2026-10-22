'use client';

import { useMemo, useRef, useState } from 'react';
import { X, Repeat } from 'lucide-react';
import WbOverlay from '@/components/workboard/ui/WbOverlay';
import WbSegmented from '@/components/workboard/ui/WbSegmented';
import { EXPENSE_CATEGORIES, categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import { addDays } from '@/lib/finance/dates';
import { formatPeso } from '@/lib/finance/format';
import { previewSpend, type SpendSnapshot } from '@/lib/finance/verdict';
import type { LogRepeat } from '@/lib/finance/logContext';
import { createTransaction, parseAmount, requestJson, type TxType } from '../financeApi';
import PesoField from '../ui/PesoField';
import type { AllocTemplate, GoalProjection } from '../types';

export interface DrawerPrefill { type?: TxType; amount?: string; category?: string; goalId?: number }
export interface LoggedResult { type: TxType; id: number; amount: number; label: string; planApplied: boolean; planError?: string }

type When = 'today' | 'yesterday' | 'pick';

/* The full log form (spec §7.2): "Log again" tiles, then expense / savings / allowance with
   goals, plan split and repeat. Submission logic is the old Transactions form's handleAdd
   (financetracker-log.md §20), unchanged in behaviour. */
export default function LogDrawer({ open, instant, prefill, onClose, today, snapshot, goals, templates, repeats, onLogged, onRecurringSaved }: {
  open: boolean; instant: boolean; prefill: DrawerPrefill; onClose: () => void; today: string;
  snapshot: SpendSnapshot | null; goals: GoalProjection[]; templates: AllocTemplate[]; repeats: LogRepeat[];
  onLogged: (r: LoggedResult) => void; onRecurringSaved: () => void;
}) {
  const amountRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<TxType>(prefill.type ?? 'expense');
  const [raw, setRaw] = useState(prefill.amount ?? '');
  const [category, setCategory] = useState(prefill.category ?? 'food');
  const [goalMode, setGoalMode] = useState<'existing' | 'new'>(goals.length ? 'existing' : 'new');
  /* A prefilled goal (Goals tab "＋ Add") is only used if it still exists. */
  const [goalId, setGoalId] = useState<number | null>(() =>
    prefill.goalId !== undefined && goals.some(g => g.goal_id === prefill.goalId) ? prefill.goalId : goals[0]?.goal_id ?? null);
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const activePlan = templates.find(t => t.is_default) ?? null;
  const [split, setSplit] = useState(true);
  const [when, setWhen] = useState<When>('today');
  const [pickDate, setPickDate] = useState(today);
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // synchronous guard: Ctrl+Enter can fire before `busy` re-renders
  const [error, setError] = useState('');

  const amount = parseAmount(raw);
  const date = when === 'today' ? today : when === 'yesterday' ? addDays(today, -1) : pickDate;
  // Split and Repeat are exclusive: an allowance split by the plan can't also repeat.
  const canRepeat = !(type === 'allowance' && !!activePlan && split);
  const effectiveRepeat = repeat && canRepeat;
  const willApplyPlan = type === 'allowance' && !!activePlan && split && !effectiveRepeat;
  const planHasSavings = activePlan?.items.some(i => i.category === 'savings') ?? false;
  const needsGoal = type === 'savings' || (willApplyPlan && planHasSavings);
  const impact = amount && snapshot && type !== 'allowance' ? previewSpend(snapshot, amount).after : null;
  const goalName = useMemo(() => goals.find(g => g.goal_id === goalId)?.goal_name ?? newGoalName, [goals, goalId, newGoalName]);

  const logRepeat = async (r: LogRepeat) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const { id } = await createTransaction({ type: r.type, amount: r.amount, entry_date: today, category: r.category ?? undefined, goal_id: r.goal_id ?? undefined });
      onLogged({ type: r.type, id, amount: r.amount, label: r.type === 'expense' ? categoryLabel(r.category ?? '') : (r.goal_name ?? 'Savings'), planApplied: false });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log that. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busyRef.current) return;
    setError('');
    if (!amount) { setError('Enter an amount greater than 0.'); amountRef.current?.focus(); return; }
    if (when === 'pick' && !pickDate) { setError('Pick a date.'); return; }
    busyRef.current = true; // set synchronously after validation so the early returns above can't leave it stuck
    setBusy(true);
    try {
      let effectiveGoalId = goalId;
      if (needsGoal && goalMode === 'new') {
        const target = parseAmount(newGoalTarget);
        if (!newGoalName.trim()) { setError('Enter a name for the new goal.'); return; }
        if (!target) { setError('Enter a target amount for the new goal.'); return; }
        const g = await requestJson<{ goal_id: number }>('/api/finance/goals', { body: { goal_name: newGoalName.trim(), wishlist_amount: target } });
        effectiveGoalId = g.goal_id;
        /* The goal now exists: if a later step fails, a retry must reuse it, not create a twin.
           It isn't in `goals` until the shell refreshes, so `goalName` falls back to newGoalName. */
        setGoalId(g.goal_id);
        setGoalMode('existing');
      } else if (needsGoal && !effectiveGoalId) {
        setError('Pick a goal, or choose "+ New goal".');
        return;
      }

      if (effectiveRepeat) {
        await requestJson('/api/finance/recurring-rules', {
          body: { action: 'save', type, category: type === 'expense' ? category : undefined, goal_id: type === 'savings' ? effectiveGoalId : undefined, amount, frequency, start_date: date, end_date: endDate || undefined },
        });
        onRecurringSaved();
        onClose();
        return;
      }

      const { id } = await createTransaction({
        type, amount, entry_date: date,
        category: type === 'expense' ? category : undefined,
        goal_id: type === 'savings' ? (effectiveGoalId ?? undefined) : undefined,
      });
      let planError: string | undefined;
      if (willApplyPlan && activePlan) {
        try {
          await requestJson('/api/finance/apply-allocation', {
            body: { template_id: activePlan.template_id, amount, entry_date: date, goal_id: planHasSavings ? effectiveGoalId : undefined },
          });
        } catch (e) {
          planError = e instanceof Error ? e.message : 'Unknown error';
        }
      }
      const label = type === 'expense' ? categoryLabel(category) : type === 'savings' ? goalName || 'Savings' : 'Allowance';
      onLogged({ type, id, amount, label, planApplied: willApplyPlan && !planError, planError });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <WbOverlay open={open} onClose={onClose} variant="drawer" panelClassName="fin-sheet" labelledBy="fin-log-title" instant={instant} initialFocusRef={amountRef} panelStyle={{ width: 'min(400px, 100vw)' }}>
      <form className="fin-drawer" onSubmit={e => { e.preventDefault(); void submit(); }}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }}>
        <div className="fin-drawer__head">
          <h2 id="fin-log-title" className="fin-drawer__title">Log</h2>
          <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm fin-push" onClick={onClose} aria-label="Close"><X size={16} aria-hidden /></button>
        </div>

        {repeats.length > 0 && (
          <section aria-labelledby="fin-again">
            <p id="fin-again" className="fin-field-label">Log again · one tap, dated today</p>
            <div className="fin-again">
              {repeats.map(r => (
                <button key={`${r.type}-${r.category ?? r.goal_id}-${r.amount}`} type="button" className="fin-again__tile" disabled={busy} onClick={() => logRepeat(r)}>
                  <span className={`fin-ico${r.type === 'savings' ? ' fin-ico--save' : ' fin-ico--out'}`} aria-hidden>{r.type === 'savings' ? '◎' : categoryEmoji(r.category ?? '')}</span>
                  <span className="fin-again__text">
                    <span className="fin-again__name" title={r.type === 'savings' ? r.goal_name ?? undefined : undefined}>{r.type === 'savings' ? r.goal_name : categoryLabel(r.category ?? '')}</span>
                    <span className="fin-again__amt fin-num">{formatPeso(r.amount)}</span>
                  </span>
                  <span className={`fin-again__go${r.type === 'savings' ? ' is-save' : ''}`} aria-hidden>＋</span>
                </button>
              ))}
            </div>
            <div className="fin-drawer__or"><span>or something new</span></div>
          </section>
        )}

        <p className="fin-field-label">Type</p>
        <WbSegmented<TxType>
          ariaLabel="Type" idPrefix="fin-log-type" value={type} onChange={setType}
          options={[{ key: 'expense', label: 'Expense' }, { key: 'savings', label: 'Savings' }, { key: 'allowance', label: 'Allowance' }]}
        />

        <PesoField id="fin-log-amount" label="Amount" value={raw} onChange={setRaw} inputRef={amountRef} />

        {type === 'expense' && (
          <>
            <p className="fin-field-label">Category</p>
            <div className="fin-chips" role="group" aria-label="Category">
              {EXPENSE_CATEGORIES.map(([key, label, emoji]) => (
                <button key={key} type="button" className={`fin-chip${key === category ? ' is-on' : ''}`} aria-pressed={key === category} onClick={() => setCategory(key)}>
                  <span aria-hidden>{emoji}</span> {label}
                </button>
              ))}
            </div>
          </>
        )}

        {type === 'allowance' && activePlan && (
          <>
            <p className="fin-field-label">Spending plan</p>
            <div className="fin-chips" role="group" aria-label="Spending plan">
              <button type="button" className={`fin-chip${split ? ' is-on-blue' : ''}`} aria-pressed={split} onClick={() => setSplit(true)}>Split with “{activePlan.name}”</button>
              <button type="button" className={`fin-chip${!split ? ' is-on-blue' : ''}`} aria-pressed={!split} onClick={() => setSplit(false)}>Don&apos;t split</button>
            </div>
          </>
        )}

        {needsGoal && (
          <>
            <p className="fin-field-label">{type === 'savings' ? 'Goal' : 'Goal for the plan’s savings share'}</p>
            <div className="fin-chips" role="group" aria-label="Goal">
              {goals.map(g => (
                <button key={g.goal_id} type="button" className={`fin-chip${goalMode === 'existing' && goalId === g.goal_id ? ' is-on-purple' : ''}`}
                  aria-pressed={goalMode === 'existing' && goalId === g.goal_id} onClick={() => { setGoalMode('existing'); setGoalId(g.goal_id); }}>
                  ◎ {g.goal_name}
                </button>
              ))}
              {goalId !== null && !goals.some(g => g.goal_id === goalId) && (
                /* A goal this drawer just created (a later step failed); selected so a retry reuses it. */
                <button type="button" className={`fin-chip${goalMode === 'existing' ? ' is-on-purple' : ''}`} aria-pressed={goalMode === 'existing'} onClick={() => setGoalMode('existing')}>
                  ◎ {newGoalName.trim()}
                </button>
              )}
              <button type="button" className={`fin-chip${goalMode === 'new' ? ' is-on-purple' : ''}`} aria-pressed={goalMode === 'new'} onClick={() => setGoalMode('new')}>＋ New goal</button>
            </div>
            {goalMode === 'new' && (
              <div className="fin-drawer__pair">
                <div>
                  <label className="fin-field-label" htmlFor="fin-new-goal-name">Goal name</label>
                  <div className="fin-field"><input id="fin-new-goal-name" value={newGoalName} onChange={e => setNewGoalName(e.target.value)} placeholder="e.g. New laptop" /></div>
                </div>
                <PesoField id="fin-new-goal-target" label="Target" value={newGoalTarget} onChange={setNewGoalTarget} />
              </div>
            )}
          </>
        )}

        <p className="fin-field-label">When</p>
        <div className="fin-chips" role="group" aria-label="When">
          {(['today', 'yesterday', 'pick'] as const).map(w => (
            <button key={w} type="button" className={`fin-chip${when === w ? ' is-on-blue' : ''}`} aria-pressed={when === w} onClick={() => setWhen(w)}>
              {w === 'today' ? 'Today' : w === 'yesterday' ? 'Yesterday' : 'Pick…'}
            </button>
          ))}
          {canRepeat && (
            <button type="button" className={`fin-chip${effectiveRepeat ? ' is-on-blue' : ''}`} aria-pressed={effectiveRepeat} onClick={() => setRepeat(r => !r)}>
              <Repeat size={13} aria-hidden /> Repeat
            </button>
          )}
        </div>
        {when === 'pick' && (
          <div className="fin-field" style={{ marginTop: 8 }}><input type="date" aria-label="Date" value={pickDate} onChange={e => setPickDate(e.target.value)} /></div>
        )}
        {effectiveRepeat && (
          <div className="fin-drawer__pair">
            <div>
              <label className="fin-field-label" htmlFor="fin-freq">Frequency</label>
              <div className="fin-field">
                <select id="fin-freq" value={frequency} onChange={e => setFrequency(e.target.value as typeof frequency)}>
                  <option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div>
              <label className="fin-field-label" htmlFor="fin-end">Ends (optional)</label>
              <div className="fin-field"><input id="fin-end" type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} /></div>
            </div>
          </div>
        )}

        <p className="fin-hint fin-drawer__impact fin-num" aria-live="polite">
          {impact
            ? `Leaves ${formatPeso(impact.safe)} safe · ${formatPeso(impact.perDay)}/day`
            : willApplyPlan ? `Sets this cycle's envelopes from “${activePlan?.name}”${planHasSavings ? ' and moves the savings share to your goal' : ''}.` : 'Future dates go to Upcoming automatically.'}
        </p>
        {error && <p className="fin-error" role="alert">{error}</p>}
        <button type="submit" className="fin-btn fin-btn--primary fin-btn--block" disabled={busy}>
          {busy ? 'Saving…' : effectiveRepeat ? 'Save repeating entry' : amount ? `Log ${formatPeso(amount)}${type === 'allowance' ? ' allowance' : ''}` : 'Log'}
        </button>
      </form>
    </WbOverlay>
  );
}
