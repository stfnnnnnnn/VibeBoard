'use client';

import { Fragment, useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import WbPopover from '@/components/workboard/ui/WbPopover';
import { toastInfo, toastError } from '@/components/workboard/ui/WbToaster';
import { buildEnvelopes, envelopeSummary, groupEnvelopes, nextCycle, planAllowanceCeiling, templateToRows, type EnvelopeModel } from '@/lib/finance/envelopes';
import { TIER_META } from '@/lib/finance/ui/colors';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { formatShortDate } from '@/lib/finance/dates';
import Envelope from '../plan/Envelope';
import AdjustPopover from '../plan/AdjustPopover';
import NewCycleBanner from '../plan/NewCycleBanner';
import PlanEditor from '../plan/PlanEditor';
import ConfirmPopover from '../ui/ConfirmPopover';
import { requestJson } from '../financeApi';
import type { AllocTemplate, BudgetItem, SavingsProgress } from '../types';

type EditorState = null | { mode: 'new' } | { mode: 'edit'; cycle: { amount: number; start: string; end: string } | null; focusAllowance?: boolean };

export default function PlanTab({ templates, budgets, savings, remainingCycleAllowance, accountRemaining, today, onChanged }: {
  templates: AllocTemplate[] | null; budgets: BudgetItem[] | null; savings: SavingsProgress | null;
  remainingCycleAllowance: number | null; accountRemaining: number | null; today: string; onChanged: () => void;
}) {
  const [editor, setEditor] = useState<EditorState>(null);
  const [adjust, setAdjust] = useState<{ env: EnvelopeModel; anchor: HTMLElement } | null>(null);
  const [starting, setStarting] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (templates === null || budgets === null) {
    return <div className="fin-card"><div className="fin-envs">{[0, 1, 2, 3].map(i => <WbSkeleton key={i} height={130} radius={14} />)}</div></div>;
  }
  const active = templates.find(t => t.is_default) ?? null;
  const cycle = active ? nextCycle(active, today) : null;
  const { envelopes, elapsedPct, period } = buildEnvelopes(budgets, savings, today);
  const groups = groupEnvelopes(envelopes);
  const summary = envelopeSummary(envelopes);
  const unallocated = remainingCycleAllowance;
  const fullyAssigned = unallocated !== null && Math.abs(unallocated) <= 0.004;
  const assign = () => setEditor({ mode: 'edit', cycle: null });
  /* Decision D2: what the running cycle has already used — from the server (cycle_used), the
     same figure the save check counts, so the editor never blocks a save the server allows. */
  const runningCycle = active?.last_period_start && active.cycle_used !== null
    ? { start: active.last_period_start, used: active.cycle_used }
    : null;

  const setActive = async (templateId: number) => {
    try { await requestJson('/api/finance/allocation-templates', { body: { action: 'set_default', template_id: templateId } }); onChanged(); }
    catch (e) { toastError(e instanceof Error ? e.message : 'Could not switch plans.'); }
  };
  const startNext = async () => {
    if (!active || !cycle) return;
    if (accountRemaining !== null && cycle.amount > accountRemaining) { setEditor({ mode: 'edit', cycle }); return; }
    setStarting(true);
    try {
      await requestJson('/api/finance/allocation-templates', {
        body: { action: 'save', template_id: active.template_id, name: active.name, items: templateToRows(active.items), allowance_amount: cycle.amount, period_start: cycle.start, period_end: cycle.end },
      });
      onChanged();
      toastInfo(`Started ${formatShortDate(cycle.start)} – ${formatShortDate(cycle.end)} · ${formatPeso(cycle.amount)}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not start the cycle.', startNext);
    } finally {
      setStarting(false);
    }
  };
  const deleteActive = async () => {
    if (!active) return;
    setEditor(null);
    await requestJson('/api/finance/allocation-templates', { body: { action: 'delete', template_id: active.template_id } });
    onChanged();
  };

  return (
    <section className="fin-card" aria-labelledby="fin-plan-title">
      {/* Addendum B: the header keeps only the plan switcher and two buttons; the numbers live in
          the summary tiles below and the rarer actions in the "⋯" menu. */}
      <div className="fin-card__head">
        <h2 className="fin-card__title" id="fin-plan-title">Spending plan</h2>
        {active && (
          <select className="fin-plan-select" aria-label="Active plan" value={active.template_id} onChange={e => setActive(Number(e.target.value))} disabled={!!editor}>
            {templates.map(t => <option key={t.template_id} value={t.template_id}>{t.name}</option>)}
          </select>
        )}
        {active && (
          <span className="fin-push fin-plan-actions">
            <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={assign}>Edit split</button>
            <button ref={moreRef} type="button" className="fin-btn fin-btn--ghost fin-btn--sm fin-btn--icon" aria-label="More plan actions"
              aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
              <MoreHorizontal size={16} aria-hidden />
            </button>
          </span>
        )}
      </div>
      <WbPopover open={menuOpen} anchor={moreRef.current} onClose={() => setMenuOpen(false)} width={200} ariaLabel="Plan actions" placement="bottom-end">
        <div className="fin-goalmenu">
          <button type="button" className="fin-datechoice__opt" data-autofocus onClick={() => { setMenuOpen(false); setEditor({ mode: 'new' }); }}>New plan</button>
          <button type="button" className="fin-datechoice__opt fin-goalmenu__danger" onClick={() => { setMenuOpen(false); setConfirmOpen(true); }}>Delete plan…</button>
        </div>
      </WbPopover>
      <ConfirmPopover open={confirmOpen} anchor={moreRef.current} onClose={() => setConfirmOpen(false)}
        title={`Delete “${active?.name ?? ''}”?`} body="Its envelopes for this cycle are deleted too. Your transactions stay." onConfirm={deleteActive} />

      {active && !editor && envelopes.length > 0 && (
        <div className="fin-plan-stats">
          <div className="fin-plan-stat">
            <div className="fin-label">Allowance</div>
            <div className="fin-plan-stat__v fin-num">{active.last_allowance_amount != null ? formatPesoWhole(active.last_allowance_amount) : '—'}</div>
            {period && <div className="fin-plan-stat__s fin-num">{formatShortDate(period.start)} – {formatShortDate(period.end)}</div>}
          </div>
          <div className="fin-plan-stat">
            <div className="fin-label">Left in envelopes</div>
            <div className="fin-plan-stat__v fin-num">{formatPesoWhole(summary.left)}</div>
            <div className="fin-plan-stat__s fin-num">{formatPesoWhole(summary.spent)} spent · {summary.pct}%</div>
          </div>
          <div className={`fin-plan-stat${unallocated === null ? '' : fullyAssigned ? ' is-done' : ' is-warn'}`}>
            <div className="fin-label">Unallocated</div>
            <div className="fin-plan-stat__v fin-num">{unallocated === null ? '—' : fullyAssigned ? formatPesoWhole(0) : formatPeso(unallocated)}</div>
            {unallocated !== null && (fullyAssigned
              ? <div className="fin-plan-stat__s">Every peso has a job</div>
              : (
                <div className="fin-plan-stat__s">
                  {unallocated > 0 ? 'Not in any envelope' : 'More than the allowance'}
                  <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm fin-plan-stat__btn" onClick={assign}>Assign</button>
                </div>
              ))}
          </div>
        </div>
      )}

      {active && cycle && !editor && active.last_period_end && (
        <NewCycleBanner lastEnd={active.last_period_end} cycle={cycle} busy={starting} onStart={startNext} onAdjust={() => setEditor({ mode: 'edit', cycle })} />
      )}

      {editor ? (
        <PlanEditor
          key={editor.mode === 'new' ? 'new' : `edit-${active?.template_id}`}
          template={editor.mode === 'new' ? null : active}
          initialCycle={editor.mode === 'edit' ? editor.cycle : null}
          focusAllowance={editor.mode === 'edit' && !!editor.focusAllowance}
          allowanceCeiling={from => planAllowanceCeiling(accountRemaining, editor.mode === 'edit' ? runningCycle : null, from)}
          onSaved={() => { setEditor(null); onChanged(); }}
          onCancel={() => setEditor(null)}
        />
      ) : !active ? (
        <div className="fin-empty"><p>Make a plan to split each allowance automatically.</p>
          <button type="button" className="fin-btn fin-btn--primary" onClick={() => setEditor({ mode: 'new' })}>New plan</button></div>
      ) : envelopes.length === 0 ? (
        <div className="fin-empty"><p>This plan hasn&apos;t been given an allowance yet.</p>
          <button type="button" className="fin-btn fin-btn--primary" onClick={() => setEditor({ mode: 'edit', cycle: null, focusAllowance: true })}>Start a cycle</button></div>
      ) : (
        /* Grouped by tier (Addendum B); "Add category" ends the last group's grid. */
        groups.map((g, gi) => {
          const tier = TIER_META[g.tier];
          const headId = `fin-envgroup-${g.tier}`;
          return (
            <Fragment key={g.tier}>
              <h3 className="fin-envgroup" id={headId}>
                <span className="fin-label" style={{ color: tier.ink }}>{tier.label}</span>
                <span className="fin-envgroup__tot fin-num">
                  {Math.abs(g.left - g.cap) < 0.005 ? `${formatPesoWhole(g.left)} left` : `${formatPesoWhole(g.left)} of ${formatPesoWhole(g.cap)} left`}
                </span>
              </h3>
              <div className="fin-envs" role="group" aria-labelledby={headId}>
                {g.envelopes.map(env => (
                  <Envelope key={env.category} env={env} elapsedPct={elapsedPct} onAdjust={(e, anchor) => setAdjust({ env: e, anchor })} />
                ))}
                {gi === groups.length - 1 && (
                  <button type="button" className="fin-env-add" onClick={assign}><Plus size={14} aria-hidden /> Add category</button>
                )}
              </div>
            </Fragment>
          );
        })
      )}
      {adjust && (
        <AdjustPopover key={adjust.env.category} env={adjust.env} anchor={adjust.anchor} remainingCycleAllowance={remainingCycleAllowance}
          onClose={() => setAdjust(null)} onSaved={onChanged} />
      )}
    </section>
  );
}
