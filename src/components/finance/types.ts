import type { LogRepeat } from '@/lib/finance/logContext';
import type { FeedItem } from '@/lib/finance/feed';

/* ─── Types ─── */

export interface LogContext { top_categories: string[]; repeats: LogRepeat[] }

export type Range = 'week' | 'month' | 'all';

export interface SummaryTotals { allowance: number; expense: number; savings: number; remaining: number; }
export interface SummaryBreakdown {
  labels: string[]; allowance: number[];
  expenses_total: number[]; expenses_by_category: Record<string, number>[];
  savings_total: number[]; savings_by_goal: Record<string, number>[];
  balance_over_time: number[]; opening_balance: number;
}

export interface GoalProjection {
  goal_id: number; goal_name: string; target_amount: number; saved: number; progress_percent: number;
  target_date: string | null; days_remaining: number | null; avg_per_week: number;
  required_per_week: number | null; projected_date: string | null;
  pace_status: 'ahead' | 'on_pace' | 'behind' | null; weeks_off_pace: number | null;
}

export interface TransactionItem { id: number; entry_date: string; amount: number; type: 'allowance' | 'expense' | 'savings'; label: string; }

export interface SummaryResponse {
  totals: SummaryTotals;
  previous_totals: SummaryTotals | null;
  breakdown: SummaryBreakdown;
  goals: GoalProjection[];
  recent: TransactionItem[];
}

export interface SafeToSpendResponse {
  current_balance: number; safe_to_spend: number; per_day: number;
  upcoming_required: number; upcoming_savings: number; buffer: number;
  days_until_next_allowance: number | null; upcoming: TransactionItem[]; horizon_end: string;
  tier_breakdown: { required: number; target: number; flexible: number } | null;
  shortfall: number; shortfall_coverable_by: 'flexible' | 'flexible_and_target' | 'none' | null;
  flexible_categories: string[];
  pace_start: string;
  daily_spend: { date: string; amount: number }[];
}

export interface RecurringRule {
  rule_id: number; type: 'allowance' | 'expense' | 'savings'; category: string | null; goal_id: number | null;
  amount: number; frequency: 'weekly' | 'biweekly' | 'monthly'; start_date: string; end_date: string | null; next_run_date: string;
}

export interface AllocItem {
  item_id?: number; category: string; priority_tier: 'required' | 'target' | 'flexible';
  allocation_type: 'fixed' | 'percent'; amount: number | null; percent: number | null;
}
export interface AllocTemplate {
  template_id: number; name: string; is_default: number; items: AllocItem[];
  last_allowance_amount: number | null; last_period_start: string | null; last_period_end: string | null;
  /* Active plan only: actual spending + savings in its stored cycle to date (decision D2). */
  cycle_used: number | null;
}

export interface BudgetItem {
  budget_id: number | null; category: string; type: string; period: 'weekly' | 'monthly';
  period_start: string | null; period_end: string | null;
  cap_amount: number | null; plan_amount: number | null; is_override: boolean; override_reason: string | null;
  tier: 'required' | 'target' | 'flexible' | null;
  spent: number; remaining: number | null; pct: number;
}

export interface SavingsProgress {
  budget_id: number; cap_amount: number; plan_amount: number | null; is_override: boolean; override_reason: string | null;
  funded: number; tier: 'required' | 'target' | 'flexible';
  period_start: string | null; period_end: string | null;
}

export type FinanceTab = 'overview' | 'plan' | 'activity' | 'goals';

export interface FeedResponse { items: FeedItem[]; has_more: boolean }

export interface WishItem {
  wish_id: number;
  name: string;
  amount: number;
  category: string;
  status: 'open' | 'bought' | 'goal';
  goal_id: number | null;
  expense_id: number | null;
  created_at: string;
}
