-- Finance Tracker — Phase 4: template-scoped budgets + plan cycle memory.
--
-- Bug: category_budgets had no link back to which plan produced a row —
-- it was found purely by (user_id, category). Two plans that both use
-- "food" shared the exact same row, so switching the active plan to a
-- template that had never been given an allowance still showed whatever
-- cap/period the *other* plan's cycle had last written, and applying a
-- new allowance to one plan silently overwrote the other plan's numbers
-- for any category they had in common. Scoping every budget row to the
-- template that created it fixes both: switching plans now shows exactly
-- that plan's own cycle (or "not applied yet" if it truly has none), and
-- editing/reapplying one plan can never bleed into another's numbers.
ALTER TABLE category_budgets
  ADD COLUMN template_id INT DEFAULT NULL AFTER user_id,
  ADD CONSTRAINT category_budgets_template_fk FOREIGN KEY (template_id) REFERENCES allocation_templates (template_id) ON DELETE CASCADE;

-- Plan cycle memory — lets the builder prefill "Allowance" and the period
-- dates when editing a plan that already has one, instead of always
-- starting blank. Written whenever a plan is (re)instantiated with a
-- concrete allowance; read back by the builder's openBuilder(t).
ALTER TABLE allocation_templates
  ADD COLUMN last_allowance_amount DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN last_period_start DATE DEFAULT NULL,
  ADD COLUMN last_period_end DATE DEFAULT NULL;

-- Backfill: attribute any pre-existing category_budgets rows to whichever
-- template is currently active, since they predate per-template scoping
-- and there is no way to know which plan actually wrote them.
UPDATE category_budgets cb
JOIN allocation_templates t ON t.user_id = cb.user_id AND t.is_default = 1
SET cb.template_id = t.template_id
WHERE cb.template_id IS NULL;
