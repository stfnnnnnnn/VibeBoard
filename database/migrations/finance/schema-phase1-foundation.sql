-- Finance Tracker redesign — Phase 1 foundation schema.
-- Unlocks: Planned vs Actual, Safe-to-Spend, Allowance Cycles + Recurring
-- Expenses (one shared mechanism), Smart Allocator, Category Budgets,
-- Goal Projection. What-if simulation and adaptive suggestions need no
-- schema of their own — they compute over what's added here.

-- 1. Recurring rules — one mechanism drives both "allowance cycles" (type=
--    allowance) and "recurring expenses" (type=expense/savings), instead of
--    two separate systems. A rule generates planned rows in the matching
--    transaction table (status='planned') on a schedule; app-level code
--    advances next_run_date after each generation.
CREATE TABLE IF NOT EXISTS recurring_rules (
  rule_id        INT NOT NULL AUTO_INCREMENT,
  user_id        INT NOT NULL,
  type           ENUM('allowance','expense','savings') NOT NULL,
  category       VARCHAR(50) DEFAULT NULL,   -- matches the target table's category domain; NULL for allowance
  goal_id        INT DEFAULT NULL,           -- only meaningful when type='savings'
  amount         DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  frequency      ENUM('weekly','biweekly','monthly') NOT NULL,
  day_of_week    TINYINT DEFAULT NULL,       -- 0=Mon..6=Sun, for weekly/biweekly
  day_of_month   TINYINT DEFAULT NULL,       -- for monthly
  start_date     DATE NOT NULL,
  end_date       DATE DEFAULT NULL,          -- open-ended if NULL
  next_run_date  DATE NOT NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rule_id),
  KEY user_id (user_id),
  KEY goal_id (goal_id),
  CONSTRAINT recurring_rules_ibfk_1 FOREIGN KEY (user_id) REFERENCES user_login (user_id) ON DELETE CASCADE,
  CONSTRAINT recurring_rules_ibfk_2 FOREIGN KEY (goal_id) REFERENCES savings_goals (goal_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 2. Allocation templates — Smart Allocator presets ("Normal School Week",
--    "Exam Week", custom). Applying a template to a new allowance amount
--    computes each item's share and can pre-fill planned expense/savings
--    rows per category — previewable and editable before being committed.
CREATE TABLE IF NOT EXISTS allocation_templates (
  template_id  INT NOT NULL AUTO_INCREMENT,
  user_id      INT NOT NULL,
  name         VARCHAR(60) NOT NULL,
  is_default   TINYINT(1) NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (template_id),
  KEY user_id (user_id),
  CONSTRAINT allocation_templates_ibfk_1 FOREIGN KEY (user_id) REFERENCES user_login (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS allocation_template_items (
  item_id         INT NOT NULL AUTO_INCREMENT,
  template_id     INT NOT NULL,
  category        VARCHAR(50) NOT NULL,      -- an expenses.category value, or 'savings' as the savings slice
  priority_tier   ENUM('required','target','flexible') NOT NULL DEFAULT 'flexible',
  allocation_type ENUM('fixed','percent') NOT NULL,
  amount          DECIMAL(10,2) DEFAULT NULL,  -- used when allocation_type='fixed'
  percent         DECIMAL(5,2) DEFAULT NULL,   -- used when allocation_type='percent'
  sort_order      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id),
  KEY template_id (template_id),
  CONSTRAINT allocation_template_items_ibfk_1 FOREIGN KEY (template_id) REFERENCES allocation_templates (template_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 3. Category budgets — recurring spending caps, independent of any single
--    allowance event, used for "₱2,400 of ₱3,000 spent" progress and
--    overspend alerts.
CREATE TABLE IF NOT EXISTS category_budgets (
  budget_id   INT NOT NULL AUTO_INCREMENT,
  user_id     INT NOT NULL,
  category    VARCHAR(50) NOT NULL,
  type        ENUM('expense','savings') NOT NULL DEFAULT 'expense',
  period      ENUM('weekly','monthly') NOT NULL DEFAULT 'monthly',
  cap_amount  DECIMAL(10,2) NOT NULL CHECK (cap_amount >= 0),
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (budget_id),
  KEY user_id (user_id),
  CONSTRAINT category_budgets_ibfk_1 FOREIGN KEY (user_id) REFERENCES user_login (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 4. Goal projection needs a target date to compute required pace and ETA.
ALTER TABLE savings_goals
  ADD COLUMN target_date DATE DEFAULT NULL AFTER wishlist_amount;

-- 5. Planned vs Actual — the shared concept behind Safe-to-Spend, the
--    upcoming-transactions timeline, and the What-if simulator (a what-if
--    is just a planned row that's previewed and, optionally, kept).
--    recurring_rule_id traces a generated row back to the rule that made
--    it, so it can be regenerated/cancelled without duplicating entries.
ALTER TABLE allowance
  ADD COLUMN status ENUM('planned','actual') NOT NULL DEFAULT 'actual' AFTER categories,
  ADD COLUMN recurring_rule_id INT DEFAULT NULL AFTER status,
  ADD KEY recurring_rule_id (recurring_rule_id),
  ADD CONSTRAINT allowance_ibfk_2 FOREIGN KEY (recurring_rule_id) REFERENCES recurring_rules (rule_id) ON DELETE SET NULL;

ALTER TABLE expenses
  ADD COLUMN status ENUM('planned','actual') NOT NULL DEFAULT 'actual' AFTER entry_date,
  ADD COLUMN recurring_rule_id INT DEFAULT NULL AFTER status,
  ADD KEY recurring_rule_id (recurring_rule_id),
  ADD CONSTRAINT expenses_ibfk_2 FOREIGN KEY (recurring_rule_id) REFERENCES recurring_rules (rule_id) ON DELETE SET NULL;

ALTER TABLE savings_entries
  ADD COLUMN status ENUM('planned','actual') NOT NULL DEFAULT 'actual' AFTER categories,
  ADD COLUMN recurring_rule_id INT DEFAULT NULL AFTER status,
  ADD KEY recurring_rule_id (recurring_rule_id),
  ADD CONSTRAINT savings_entries_ibfk_3 FOREIGN KEY (recurring_rule_id) REFERENCES recurring_rules (rule_id) ON DELETE SET NULL;
