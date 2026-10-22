// src/lib/finance/status.ts
/* Hero status pill and shortfall advisory, moved out of the component (financetracker-log.md
   §11, §20). One deliberate change from the old component: an empty account with nothing
   committed reads "Nothing left to spend" (warn) instead of "Over budget". "Empty" means the
   amounts round to ₱0.00, so float noise on either side of zero still counts as empty. */
import { formatPeso, roundsToZero } from './format';
import { categoryLabel } from './categories';
import { formatShortDate } from './dates';

export interface StatusInput {
  safe_to_spend: number; upcoming_required: number; upcoming_savings: number; horizon_end: string | null;
  shortfall: number; shortfall_coverable_by: 'flexible' | 'flexible_and_target' | 'none' | null; flexible_categories: string[];
  current_balance?: number;
}

export function safeToSpendStatus(s: StatusInput): { label: string; tone: 'success' | 'warn' | 'danger' } {
  /* Nothing in the account and nothing committed (a brand-new user, or a cycle spent to the
     last peso) is not "over budget": nothing was overspent. */
  if (roundsToZero(s.safe_to_spend) && s.current_balance !== undefined && roundsToZero(s.current_balance)
    && roundsToZero(s.upcoming_required) && roundsToZero(s.upcoming_savings)) {
    return { label: 'Nothing left to spend', tone: 'warn' };
  }
  if (s.safe_to_spend <= 0 || roundsToZero(s.safe_to_spend)) return { label: 'Over budget this cycle', tone: 'danger' };
  if (s.safe_to_spend < s.upcoming_required + s.upcoming_savings) return { label: 'Spending tight this cycle', tone: 'warn' };
  return { label: s.horizon_end ? `Safe through ${formatShortDate(s.horizon_end)}` : 'Spending on track', tone: 'success' };
}

export function shortfallSuggestion(s: StatusInput): string | null {
  if (s.shortfall <= 0 || !s.shortfall_coverable_by) return null;
  const amount = formatPeso(s.shortfall);
  if (s.shortfall_coverable_by === 'flexible') {
    const cats = s.flexible_categories.map(categoryLabel).join(', ');
    return `Your current plan exceeds available funds by ${amount}. ${cats ? `Flexible spending (${cats}) is` : 'Flexible spending is'} the first area available for adjustment.`;
  }
  if (s.shortfall_coverable_by === 'flexible_and_target') {
    return `Your current plan exceeds available funds by ${amount}. Trimming flexible and committed spending together could cover the gap.`;
  }
  return `Your current plan exceeds available funds by ${amount}. Even trimming flexible and committed spending may not close the gap.`;
}
