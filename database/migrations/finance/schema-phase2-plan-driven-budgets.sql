-- Finance Tracker — Phase 2: plan-driven budgets, tier-aware Safe-to-Spend.
-- Spending Plan (allocation_templates) now generates category_budgets
-- instead of budgets being a fully separate manual mechanism. A manual
-- override still wins over whatever the plan says, until reset.

ALTER TABLE category_budgets
  ADD COLUMN plan_amount DECIMAL(10,2) DEFAULT NULL AFTER cap_amount,      -- what the active plan currently allocates to this category; NULL if this budget was never plan-derived
  ADD COLUMN is_override TINYINT(1) NOT NULL DEFAULT 0 AFTER plan_amount, -- true once the user manually overrides cap_amount away from plan_amount
  ADD COLUMN override_reason VARCHAR(255) DEFAULT NULL AFTER is_override,
  ADD COLUMN tier ENUM('required','target','flexible') DEFAULT NULL AFTER override_reason; -- copied from allocation_template_items.priority_tier when a plan sets this budget; NULL for budgets that have never come from a plan

-- allocation_templates.is_default (added in Phase 1, previously unused) now
-- means "the active Spending Plan" — the one shown in Spending Plan's
-- summary and the one a new allowance is split against by default.
