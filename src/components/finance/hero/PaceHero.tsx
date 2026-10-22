'use client';

import type { ReactNode } from 'react';
import { Wallet } from 'lucide-react';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { safeToSpendStatus, shortfallSuggestion } from '@/lib/finance/status';
import type { PaceSeries } from '@/lib/finance/pace';
import type { SafeToSpendResponse } from '../types';
import HeroNumber from './HeroNumber';
import PaceChart from './PaceChart';

/* Spec §5.2–5.3. The left side keeps the content and order of the old hero (§1.2); the right
   side is the daily pace. `children` is the tab bar, attached to the hero's bottom edge. */
export default function PaceHero({ sts, series, children }: { sts: SafeToSpendResponse | null; series: PaceSeries | null; children: ReactNode }) {
  const status = sts ? safeToSpendStatus(sts) : null;
  const advice = sts ? shortfallSuggestion(sts) : null;
  const days = sts?.days_until_next_allowance ?? null;
  const spentAnything = series?.bars.some(b => !b.future && b.amount > 0) ?? false;
  const daysLeft = series?.bars.some(b => b.future) ?? false;

  return (
    <section className="fin-hero" aria-labelledby="fin-hero-label">
      <div className="fin-hero__body">
        <div className="fin-hero__left">
          <div className="fin-hero__eyebrow fin-label" id="fin-hero-label"><Wallet size={15} aria-hidden /> Safe to spend</div>
          {sts ? (
            <>
              <HeroNumber value={sts.safe_to_spend} />
              <p className="fin-hero__perday fin-num">
                {formatPeso(sts.per_day)}/day · {days === null ? 'over the next 14 days' : days === 0 ? 'next allowance today' : `${days} day${days === 1 ? '' : 's'} until next allowance`}
              </p>
              {(sts.upcoming_required > 0 || sts.upcoming_savings > 0) && (
                <p className="fin-hero__after fin-num">
                  After {formatPeso(sts.upcoming_required)} upcoming expenses
                  {sts.upcoming_savings > 0 && <> and {formatPeso(sts.upcoming_savings)} planned savings</>}
                </p>
              )}
              {status && <div className="fin-hero__status"><span className={`fin-pill fin-pill--${status.tone}`}>{status.label}</span></div>}
              {advice && <p className="fin-hero__advice" role="note">{advice}</p>}
            </>
          ) : (
            <div className="fin-hero__skel" aria-busy="true" aria-label="Loading safe to spend">
              <WbSkeleton width={260} height={52} radius={10} />
              <WbSkeleton width={300} height={14} />
              <WbSkeleton width={140} height={22} radius={999} />
            </div>
          )}
        </div>
        <div className="fin-hero__pace">
          <div className="fin-hero__pace-head">
            <span className="fin-label">Daily pace</span>
            {series && spentAnything && (
              <span className="fin-hero__pace-sum fin-num">
                Avg <b>{formatPesoWhole(series.avg)}</b>/day ·{' '}
                <span className={series.diff >= 0 ? 'is-under' : 'is-over'}>
                  {formatPesoWhole(Math.abs(series.diff))} {series.diff >= 0 ? 'under' : 'over'}
                </span>
              </span>
            )}
          </div>
          {series ? (
            <div className="fin-hero__chart">
              <PaceChart series={series} label={`Daily spending this cycle against ${formatPesoWhole(series.perDay)} a day`} />
              {!spentAnything && <p className="fin-pace__empty fin-hint">No spending yet this cycle</p>}
              {/* Hero only: the What-if preview reuses PaceChart without a legend. */}
              {spentAnything && (
                <div className="fin-pace__legend fin-num">
                  <span><i className="fin-pace__key" aria-hidden />Within {formatPesoWhole(series.perDay)}</span>
                  <span><i className="fin-pace__key is-over" aria-hidden />Over {formatPesoWhole(series.perDay)}</span>
                  {daysLeft && <span><i className="fin-pace__key is-future" aria-hidden />Days left</span>}
                </div>
              )}
            </div>
          ) : (
            <WbSkeleton height={140} radius={8} style={{ marginTop: 14 }} />
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
