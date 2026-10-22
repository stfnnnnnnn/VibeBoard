// src/lib/finance/ui/colors.ts
/* Finance colour lookups in TS. The only Finance TS file allowed to hold hex values (style
   gate allow-list); today every colour here is a --fin-* variable from
   src/app/finance/finance.css. */
export type Tier = 'required' | 'target' | 'flexible';

export const TIER_META: Record<Tier, { label: string; hint: string; fill: string; ink: string; bg: string }> = {
  required: { label: 'Essential', hint: "can't be trimmed", fill: 'var(--fin-tier-essential)', ink: 'var(--fin-tier-essential-ink)', bg: 'var(--fin-tier-essential-bg)' },
  target: { label: 'Committed', hint: 'savings & recurring', fill: 'var(--fin-tier-committed)', ink: 'var(--fin-tier-committed-ink)', bg: 'var(--fin-tier-committed-bg)' },
  flexible: { label: 'Flexible', hint: 'first to trim', fill: 'var(--fin-tier-flexible)', ink: 'var(--fin-tier-flexible-ink)', bg: 'var(--fin-tier-flexible-bg)' },
};
