-- Finance Tracker — Phase 3: explicit cycle dates for plan-derived budgets.
-- category_budgets.period (weekly/monthly, computed relative to "today") was
-- fine for the old independent manual-budget model, but a plan cycle is a
-- fixed, user-chosen date range set once when the plan's allowance amount
-- is entered in the Spending Plan builder — not a rolling window. When
-- period_start/period_end are set, the budgets route uses them directly
-- instead of computing a window from the period enum, which remains as a
-- fallback for any budget that predates this (or was overridden before
-- ever having an explicit cycle).

ALTER TABLE category_budgets
  ADD COLUMN period_start DATE DEFAULT NULL AFTER period,
  ADD COLUMN period_end DATE DEFAULT NULL AFTER period_start;
