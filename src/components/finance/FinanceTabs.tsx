'use client';

import { useRef } from 'react';
import type { FinanceTab } from './types';

export const FINANCE_TABS: { key: FinanceTab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'plan', label: 'Plan' },
  { key: 'activity', label: 'Activity' }, { key: 'goals', label: 'Goals' },
];

/* WAI-ARIA tabs (spec §5.4): arrows/Home/End move and select, roving tabindex. */
export default function FinanceTabs({ value, onChange, planBadge }: { value: FinanceTab; onChange: (t: FinanceTab) => void; planBadge: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => {
    const n = (i + FINANCE_TABS.length) % FINANCE_TABS.length;
    onChange(FINANCE_TABS[n].key);
    refs.current[n]?.focus();
  };
  return (
    <div className="fin-tabs" role="tablist" aria-label="Finance sections">
      {FINANCE_TABS.map((t, i) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`fin-tab-${t.key}`}
            aria-selected={on}
            aria-controls={`fin-panel-${t.key}`}
            tabIndex={on ? 0 : -1}
            className={`fin-tabs__tab${on ? ' is-on' : ''}`}
            onClick={() => onChange(t.key)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1); }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1); }
              else if (e.key === 'Home') { e.preventDefault(); move(0); }
              else if (e.key === 'End') { e.preventDefault(); move(FINANCE_TABS.length - 1); }
            }}
          >
            {t.label}
            {t.key === 'plan' && planBadge && <span className="fin-tabs__badge">1<span className="fin-sr-only"> item needs attention</span></span>}
          </button>
        );
      })}
    </div>
  );
}
