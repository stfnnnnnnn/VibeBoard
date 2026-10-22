'use client';

import { useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import WbPopover from '@/components/workboard/ui/WbPopover';
import { goalGuidance, goalState, type GoalState } from '@/lib/finance/goals';
import { formatPesoWhole } from '@/lib/finance/format';
import { formatFullDate, formatMonthYear } from '@/lib/finance/dates';
import { requestJson } from '../financeApi';
import type { GoalProjection } from '../types';

/* pill: the state pill; dot: timeline marker; ink: timeline label; ring: the card's progress arc. */
export const GOAL_STATE_META: Record<GoalState, { label: string; pill: string; dot: string; ink: string; ring: string }> = {
  date_passed: { label: 'Date passed', pill: 'fin-pill--warn', dot: 'var(--wb-warn)', ink: 'var(--wb-warn)', ring: 'var(--wb-warn)' },
  behind: { label: 'Behind', pill: 'fin-pill--warn', dot: 'var(--wb-warn)', ink: 'var(--wb-warn)', ring: 'var(--wb-warn)' },
  on_pace: { label: 'On pace', pill: 'fin-pill--success', dot: 'var(--wb-success)', ink: 'var(--wb-success)', ring: 'var(--wb-success-fill)' },
  done: { label: 'Done', pill: 'fin-pill--success', dot: 'var(--wb-success)', ink: 'var(--wb-success)', ring: 'var(--wb-success-fill)' },
  no_date: { label: 'No date', pill: 'fin-pill--purple', dot: 'var(--fin-savings)', ink: 'var(--fin-savings-ink)', ring: 'var(--fin-savings)' },
};

function GoalMenu({ goal, anchor, startMode, onClose, onChanged }: {
  goal: GoalProjection; anchor: HTMLElement | null; startMode: 'menu' | 'date'; onClose: () => void; onChanged: () => void;
}) {
  const [mode, setMode] = useState<'menu' | 'date' | 'delete'>(startMode);
  const [date, setDate] = useState(goal.target_date ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); onChanged(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  };
  return (
    <WbPopover open={!!anchor} anchor={anchor} onClose={onClose} width={260} ariaLabel={`${goal.goal_name} options`} placement="bottom-end">
      <div className="fin-goalmenu">
        {mode === 'menu' && (
          <>
            <button type="button" className="fin-datechoice__opt" onClick={() => setMode('date')}>Change target date</button>
            <button type="button" className="fin-datechoice__opt fin-goalmenu__danger" onClick={() => setMode('delete')}>Delete goal</button>
          </>
        )}
        {mode === 'date' && (
          <form onSubmit={e => { e.preventDefault(); void run(() => requestJson(`/api/finance/goals/${goal.goal_id}/target`, { body: { target_date: date || null } })); }}>
            <label className="fin-field-label" htmlFor={`fin-goal-date-${goal.goal_id}`}>Target date</label>
            <div className="fin-field"><input id={`fin-goal-date-${goal.goal_id}`} type="date" value={date} onChange={e => setDate(e.target.value)} autoFocus /></div>
            <div className="fin-confirm__row">
              {goal.target_date && <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={busy} onClick={() => run(() => requestJson(`/api/finance/goals/${goal.goal_id}/target`, { body: { target_date: null } }))}>Clear</button>}
              <button type="submit" className="fin-btn fin-btn--primary fin-btn--sm" disabled={busy}>Save</button>
            </div>
          </form>
        )}
        {mode === 'delete' && (
          <>
            <p className="fin-confirm__title">Delete “{goal.goal_name}”?</p>
            <p className="fin-confirm__body">Goals with savings logged can&apos;t be deleted.</p>
            <div className="fin-confirm__row">
              <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={onClose}>Cancel</button>
              <button type="button" className="fin-btn fin-btn--danger fin-btn--sm" disabled={busy}
                onClick={() => run(() => requestJson('/api/finance/goals', { method: 'DELETE', body: { goal_id: goal.goal_id } }))}>Delete</button>
            </div>
          </>
        )}
        {error && <p className="fin-error" role="alert">{error}</p>}
      </div>
    </WbPopover>
  );
}

const RING_R = 40;
const RING_C = 2 * Math.PI * RING_R;
const RING_STROKE = 10;

/* Progress ring (Addendum A): a static arc, no animation (motion is transform/opacity only).
   Round caps add half a stroke at each end, so a partial arc is shortened by one stroke width
   or it would look closed from ~96%; only a finished goal draws the full circle. */
function GoalRing({ goal, fill, color }: { goal: GoalProjection; fill: number; color: string }) {
  const pct = Math.floor(fill * 100);
  const dash = fill >= 1 ? RING_C : Math.max(0, RING_C * fill - RING_STROKE);
  return (
    <div className="fin-ring" role="img" aria-label={`${goal.goal_name}: ${pct}% saved`}>
      <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
        <circle className="fin-ring__track" cx="48" cy="48" r={RING_R} />
        {fill > 0 && (
          <circle className="fin-ring__arc" cx="48" cy="48" r={RING_R} style={{ stroke: color }}
            strokeDasharray={`${dash} ${RING_C}`} transform="rotate(-90 48 48)" />
        )}
      </svg>
      <span className="fin-ring__pct fin-num" aria-hidden>{pct}%</span>
    </div>
  );
}

/* One ring card per goal under the timeline strip (spec §10.1, Addendum A): ring, saved of
   target, facts, one guidance sentence, then Add savings, the date action and ⋯. */
export default function GoalNotes({ goals, today, onAdd, onChanged }: {
  goals: GoalProjection[]; today: string; onAdd: (g: GoalProjection) => void; onChanged: () => void;
}) {
  const [menu, setMenu] = useState<{ goal: GoalProjection; anchor: HTMLElement; mode: 'menu' | 'date' } | null>(null);
  return (
    <div className="fin-gnotes">
      {goals.map(g => {
        const state = goalState(g, today);
        const meta = GOAL_STATE_META[state];
        const guide = goalGuidance(g, today);
        const fill = g.target_amount > 0 ? Math.min(1, Math.max(0, g.saved / g.target_amount)) : 0;
        const remaining = Math.max(0, g.target_amount - g.saved);
        const facts: [string, string][] = [];
        if (g.target_date) facts.push(['Target', formatFullDate(g.target_date)]);
        if (g.avg_per_week > 0) facts.push(['Pace', `${formatPesoWhole(g.avg_per_week)}/wk`]);
        if (remaining > 0) facts.push(['To go', formatPesoWhole(remaining)]);
        if (!g.target_date && g.projected_date) facts.push(['Arrives', `≈ ${formatMonthYear(g.projected_date)}`]);
        const dateLabel = guide.action === 'pick_date' ? 'Pick a new date' : guide.action === 'set_date' ? 'Set a date' : 'Change date';
        return (
          <article key={g.goal_id} className="fin-gnote" aria-labelledby={`fin-goal-${g.goal_id}`}>
            <GoalRing goal={g} fill={fill} color={meta.ring} />
            <div className="fin-gnote__body">
              <div className="fin-gnote__head">
                <h3 className="fin-gnote__name" id={`fin-goal-${g.goal_id}`} title={g.goal_name}>{g.goal_name}</h3>
                <span className={`fin-pill ${meta.pill}`}>{meta.label}</span>
              </div>
              <p className="fin-gnote__big"><span className="fin-num">{formatPesoWhole(g.saved)}</span> <span className="fin-gnote__of fin-num">of {formatPesoWhole(g.target_amount)}</span></p>
              {facts.length > 0 && (
                <dl className="fin-gnote__facts">
                  {facts.map(([k, v]) => <div key={k} className="fin-gnote__fact"><dt>{k}</dt><dd className="fin-num">{v}</dd></div>)}
                </dl>
              )}
            </div>
            <p className={`fin-gnote__msg is-${guide.tone}`}>{guide.text}</p>
            <div className="fin-gnote__actions">
              <button type="button" className="fin-btn fin-btn--savings fin-btn--sm" onClick={() => onAdd(g)}><Plus size={14} aria-hidden /> Add savings</button>
              <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={e => setMenu({ goal: g, anchor: e.currentTarget, mode: 'date' })}>{dateLabel}</button>
              <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm fin-push" aria-label={`${g.goal_name} options`}
                onClick={e => setMenu({ goal: g, anchor: e.currentTarget, mode: 'menu' })}>
                <MoreHorizontal size={16} aria-hidden />
              </button>
            </div>
          </article>
        );
      })}
      {menu && <GoalMenu key={`${menu.goal.goal_id}-${menu.mode}`} goal={menu.goal} anchor={menu.anchor} startMode={menu.mode} onClose={() => setMenu(null)} onChanged={onChanged} />}
    </div>
  );
}
