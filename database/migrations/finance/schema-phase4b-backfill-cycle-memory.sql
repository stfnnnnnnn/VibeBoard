-- Finance Tracker — Phase 4b: backfill allocation_templates.last_* for
-- plans whose cycle was instantiated before Phase 4 added those columns.
-- Editing such a plan showed a blank Allowance/Period even though the plan
-- clearly had a real cycle (Budget Progress showed real numbers) — the
-- columns simply didn't exist yet when that cycle was created, so nothing
-- had ever written them. Reconstructed from what's already on disk:
-- period dates copy straight from any of the template's own category_budgets
-- rows, and the allowance amount is back-solved from one percent-type item's
-- plan_amount divided by its own percent share (peso = allowance * percent/100).
-- Templates with no percent item or no plan_amount yet are left NULL — same
-- as today, no regression.

UPDATE allocation_templates t
JOIN category_budgets cb ON cb.template_id = t.template_id AND cb.period_start IS NOT NULL
SET t.last_period_start = cb.period_start, t.last_period_end = cb.period_end
WHERE t.last_period_start IS NULL;

UPDATE allocation_templates t
JOIN allocation_template_items ai ON ai.template_id = t.template_id AND ai.allocation_type = 'percent' AND ai.percent > 0
JOIN category_budgets cb ON cb.template_id = t.template_id AND cb.category = ai.category AND cb.plan_amount IS NOT NULL
SET t.last_allowance_amount = ROUND(cb.plan_amount / (ai.percent / 100), 2)
WHERE t.last_allowance_amount IS NULL;

-- Phase 4c (same file, appended): savings previously never got a
-- category_budgets row at all (the save action skipped it outright) — it
-- only started getting one once savings became override-able. Backfill a
-- row for any template that has a savings item, a real last_allowance_amount,
-- but no category_budgets row of type='savings' yet, using the same
-- period dates as its own expense rows.
INSERT INTO category_budgets (user_id, template_id, category, type, period, period_start, period_end, cap_amount, plan_amount, tier)
SELECT t.user_id, t.template_id, 'savings', 'savings', 'monthly', sib.period_start, sib.period_end,
       ROUND(t.last_allowance_amount * (ai.percent / 100), 2), ROUND(t.last_allowance_amount * (ai.percent / 100), 2), ai.priority_tier
FROM allocation_templates t
JOIN allocation_template_items ai ON ai.template_id = t.template_id AND ai.category = 'savings' AND ai.allocation_type = 'percent'
JOIN (
  SELECT template_id, MIN(period_start) AS period_start, MIN(period_end) AS period_end
  FROM category_budgets WHERE type = 'expense' AND period_start IS NOT NULL
  GROUP BY template_id
) sib ON sib.template_id = t.template_id
WHERE t.last_allowance_amount IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM category_budgets cb2 WHERE cb2.template_id = t.template_id AND cb2.category = 'savings' AND cb2.type = 'savings'
  );
