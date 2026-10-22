# Finance Tracker — Comprehensive Change Log

Covers everything done to the Finance Tracker across this conversation, from the initial PHP audit through the full Next.js/React migration and every design pass since. Companion to `financetracker-dashboard-audit.md` (the original PHP-only scan, written before any of the work below — that document is now historical; the module it describes has since been rebuilt).

---

## 1. Where this started

The user asked for a Finance Tracker redesign. First step was an audit-only pass (no code changes) of the legacy PHP dashboard (`financetracker/financedashboard.php` + its two AJAX backends). That audit is preserved in `financetracker-dashboard-audit.md` and found, among other things:
- Two backends (`load_summary_totals.php`, `summaries.php`) used the *same* filter values (`month`/`year`/`all`) to mean *different* date ranges.
- Category donut colors were assigned by iteration order, not stable per category.
- A `setInterval` polled every 2 seconds forever, and one endpoint wrote a debug JSON file to disk on every single call.
- An orphaned `monthly_expense_allocations` table with a foreign key to a `monthly_allowance` table that no longer existed — evidence of an abandoned "Smart Allocator" feature.
- Hardcoded absolute production URLs (`vibeboard.alwaysdata.net`) baked into every cross-page nav link.

The user then asked for a strategic direction, not just visual polish — the module should become a *planning* tool ("what can I afford?"), not just a *tracking* one. Agreed roadmap, Gemini/AI narration explicitly deferred to last:

1. Schema foundation
2. Safe to Spend + Planned vs Actual
3. Goal pace/projection
4. What-if simulator
5. Smart Allocator
6. (deferred) Adaptive suggestions, Gemini narration, Study Pulse cross-linking

---

## 2. Phase 1 — Schema foundation (built in PHP first, later carried into Next.js)

New tables, added to **both** the local dev DB and the remote production DB (`mysql-vibeboard.alwaysdata.net` / `vibeboard_db` — the PHP code's actual DB, discovered mid-session to be a *separate* database from the local one Next.js/Study Pulse uses):

- **`recurring_rules`** — one shared mechanism for both allowance cycles and recurring expenses (not built out into UI yet — schema only, unused so far).
- **`allocation_templates`** + **`allocation_template_items`** — Smart Allocator templates. Deliberately does *not* bind a "savings" template item to a specific goal at template-definition time — which goal receives it is chosen at apply time instead, since a reusable template shouldn't be hard-wired to one goal forever.
- **`category_budgets`** — spending caps per category/period, independent of any single allowance.

Column additions to existing tables:
- `allowance`, `expenses`, `savings_entries` all got **`status`** (`'planned' | 'actual'`, default `'actual'`) and **`recurring_rule_id`**.
- `savings_goals` got **`target_date`**.

Also dropped the orphaned `monthly_expense_allocations` table (confirmed unreferenced anywhere in the codebase, and never actually present on the remote DB despite existing locally).

**Known constraint discovered here:** all classic PHP pages hardcode a connection to the remote alwaysdata database, while the Next.js side (`src/lib/db.ts`) uses a local MySQL pool. These are two different databases. Schema changes have to be applied to both by hand — there is no shared migration system between the two stacks.

---

## 3. Phases 2–5 — first built directly into the legacy PHP files

Before the Next.js migration decision, all four remaining roadmap phases were implemented directly in `financetracker/financedashboard.php` plus new PHP endpoints (`safe_to_spend.php`, `plan_transaction.php`, `what_if.php`, `allocation_templates.php`, `apply_allocation.php`, `set_goal_target.php`). This included a full visual pass on the PHP dashboard too (design tokens, fixing a real `flex`+`grid-template-columns` bug on the summary grid, fixing `.tracker-duo`'s forced `flex-wrap: nowrap` that caused cramping on narrow screens, removing dead CSS, unifying card treatments).

**This PHP-side work was later fully superseded** — see §4. It's recorded here for history but none of the `financetracker/*.php` additions from this phase are what's live today.

---

## 4. The pivot — full migration to Next.js/React

**Trigger:** the user discovered the Study Pulse dashboard's module tile linked to `/finance`, which 404'd (not a real Next.js route). Fixing the link exposed the deeper issue — Finance Tracker was still classic PHP while Study Pulse had already been migrated. The user's direction: Finance Tracker needed to actually live under `src/app` like Study Pulse, not stay in PHP.

**What got built**, reusing the Phase 1 schema (already present on both databases, so no new migration was needed for the port itself):

**API routes** (`src/app/api/finance/`):
| Route | Purpose |
|---|---|
| `summary` | Consolidates the old two-PHP-backend split into one endpoint with an unambiguous `week`/`month`/`all` range param. Returns totals, previous-period totals (for deltas), per-bucket breakdown, category/goal sub-totals, balance-over-time, recent transactions, and goal projections. |
| `safe-to-spend` | Current balance, safe-to-spend, buffer, upcoming commitments, days to next allowance, upcoming timeline. |
| `transactions` | POST (create) / DELETE. The single place both "log a transaction" and "plan ahead" go through. |
| `what-if` | Pure preview — never writes to the DB. |
| `allocation-templates` | GET (list with items) / POST (`action: 'save' \| 'delete'`). |
| `apply-allocation` | Splits an amount across a template's categories into transaction rows. |
| `goals` | POST (create) / DELETE. |
| `goals/[id]/target` | POST — set/clear a goal's target date. |
| `budgets` | GET (with computed spend-this-period) / POST (`action: 'save' \| 'delete'`). |

**Frontend:** `src/app/finance/page.tsx` (auth-gated server component) + `src/components/finance/FinanceDashboard.tsx` (single large client component, ~1,285 lines — consistent with how `GwaCalculator.tsx`/`ScheduleMaker.tsx` are structured elsewhere in the app). Design direction was run through the `frontend-design` skill this time (the user specifically asked whether `.agents/skills/design-guidelines/SKILL.md` had been used for the earlier PHP pass — it had not been).

The dashboard tile now correctly points to `/finance`.

---

## 5. Real bugs found and fixed during/after the migration

1. **No way to log an actual transaction.** The first migrated build only had a "plan ahead" form (always `status='planned'`) — there was no way to record something that already happened. Fixed by generalizing into one Transactions form.
2. **Delete button on Upcoming items silently failed.** `safe-to-spend`'s query never selected the row `id`, so the frontend's delete call always sent `id: undefined`. Fixed by adding `allowance_id`/`expense_id`/`saving_id AS id` to the query.
3. **No way to create a savings goal at all**, and no way to pick a *new* goal while logging a savings transaction (only existing goals, via a dropdown with zero create path). Fixed with a `goals` create/delete endpoint and an "Existing goal / + New goal" toggle in the transaction form.
4. **Category breakdown charts were silently dropped** in the first migrated pass (flagged as deferred, but not actually built until the user asked "what happened to the charts"). Added donuts + a ranked "Top Spending Categories" list.
5. **`renderAllocTemplateList` recursion / stray closing tags** — minor JSX structural bugs introduced mid-refactor, caught by `tsc` before shipping.
6. **The big one — Actual/Planned status was decoupled from the date entered.** A manual toggle (default: "Already happened") controlled `status` independent of whatever date was picked, so a future-dated entry left on the default toggle saved as `actual` with a future date — invisible in both the "Recent" (not really recent) and "Upcoming" (wrong status) lists. This is what the user reported as "it seems like it cannot be saved." **Fixed by removing the toggle entirely** and deriving status server-side from the date (`entry_date > today → 'planned'`, else `'actual'`), applied consistently in both `transactions` and `apply-allocation`.
7. **Category colors were a single global hash across everything**, so the biggest expense-category donut slice could render purple while "Expenses" was pink everywhere else on the page (stat rail, composition bar). Split into `expenseColor()` (pink family) and `savingsColor()` (purple family) so every visualization referencing "Expenses" or "Savings" agrees with itself.
8. **Amount text in the transaction list was hardcoded blue for every row**, including expenses (which should read as an outflow color). Fixed alongside the color-family fix above — row accent and amount color now both derive from the same category hue used in the donuts.
9. **Two donut panels (Expenses by Category / Savings by Goal) rendered at mismatched widths** (`flex: '1 1 240px'` let content stretch the basis) — fixed to `flex: '1 1 0'` so both split evenly regardless of item count.

---

## 6. Design iteration history (several corrected course-reversals — noted so they aren't repeated)

- **2-column grid layout was tried and explicitly rejected.** ("when I said make the layout compact, I didn't mean two columns... make sure it looks neat and buttons don't look too big.") Reverted to a single-column stack. This is the *second* time a 2-column grid was proposed and rejected in this app (first was Study Pulse's period-builder layout, much earlier in the session) — don't propose it a third time without being asked.
- **Button/input sizing pass** — every button and input across the module was standardized to one compact scale (primary CTAs, toggle pills, secondary dashed buttons, template chips, builder action buttons), since the initial sizes read as oversized next to each other.
- **`PesoInput`** — reusable ₱-prefixed input, applied to every amount field app-wide, so currency fields are self-explanatory without a separate label.
- **"Where It Went" restructure** — grouped into three sub-panels (composition mix / donuts / top categories) with colored accent borders instead of one continuous block separated by thin dividers.
- **Smart Allocator** — template deletion existed but was undiscoverable (required double-clicking a chip to open the editor, then finding a Delete button inside). Added direct edit (pencil) and delete (×) icons on each chip. Added column headers above the builder's category rows. Added an explanatory line under "Apply to a new allowance" (the user asked directly what that control did).
- **Goal Tracker** — added goal creation (previously only target-date editing on existing goals existed) and goal deletion (fails gracefully with a clear message if the goal still has transactions logged against it, since the DB FK has no cascade).
- **Hero redesign, round 1** — replaced a wide "Balance Trend" line chart (with full axis labels) on the hero's right side with something "inspired by" a reference dashboard screenshot showing five small metric cards (sales, profit, margin, funds, a health ring). Built three compact tiles: Balance (mini sparkline), Spendable % (ring), Budgets Used % (ring).
- **Hero redesign, round 1 — called out as wrong, then fixed.** The three tiles were not independent signals: Spendable % was arithmetically `safe_to_spend ÷ balance`, and both of those numbers were already the headline content two inches to the left; Balance itself was one hop away from Safe to Spend (which *is* derived from it). The actual lesson from the reference image wasn't "small cards with sparklines" as a visual style — it was "five *genuinely distinct* business metrics." The first pass copied the container, not the requirement that each card earn its place with non-redundant information.
  **Fix applied:** dropped `BalanceMiniCard` and `SpendableRingCard` entirely. Kept `BudgetUsedRingCard` (the one tile that was already genuinely separate data) and added `GoalsOnPaceRingCard` — the *other* idea the user had originally floated ("it could be 5 goals... % of overall budget used") and that hadn't actually been built yet. It shows how many goals-with-a-target-date are on pace (`ahead`/`on_pace`/≥100% progress) out of how many have a target date at all, with a graceful "No target dates set" empty state matching the budgets tile's pattern.
- **Hero redesign, round 2 — filled out to a 2×2 grid, right side only.** After round 1's fix left only two tiles, the user asked to "analyze the whole finance tracker" for what else belonged there. Proposal: keep the two ring tiles as-is (they'd already passed the redundancy check) and add two new *always-available* signals rather than more opt-in ones, since Budgets Used/Goals On Pace both show an empty state for anyone who hasn't set up budgets or goal dates yet. User confirmed scope explicitly ("the changes should only apply to the hero in thr right side") and asked for direct execution.
  **Built:** `BiggestExpenseTile` (this period's single largest expense category, reusing the same `sumBuckets(breakdown.expenses_by_category)` aggregation "Where It Went" already computes — pulled out into a shared top-level `sumBuckets()` helper so both agree) and `UpcomingTile` (count + total ₱ of `sts.upcoming`, the forward-looking complement to the headline's "days until next allowance" text). The right-side container changed from a 2-wide flex row to a `display:'grid', gridTemplateColumns:'1fr 1fr'` 2×2, `maxWidth` trimmed from 340px to 320px to keep four tiles compact. `SafeToSpendHero` gained a `breakdown` prop (dropped in round 1 when `BalanceMiniCard` was removed, now needed again for the expense tile). No other section touched.
- **Whole-module redesign pass — a 10-point written critique the user asked to be executed in full, with one explicit constraint: keep the hero's left side (icon, "Safe to Spend" eyebrow, big number, per-day line) exactly as previously screenshotted, don't turn it into the full-width layout the critique's own mockup showed.** Everything else in the critique was implemented:
  - **Hero, round 3.** Left side gained two additive lines (nothing removed): "After ₱X upcoming expenses and ₱Y planned savings" (from `sts.upcoming_required`/`upcoming_savings`, already fetched, nothing new), and a status pill — On track / Tight / At risk — derived by comparing `safe_to_spend` against what's already committed (`upcoming_required + upcoming_savings`), no backend change needed (`safeToSpendStatus()`). Right-side grid: dropped `BiggestExpenseTile` (its data now lives in Cash Flow's ranked bars instead, per the critique's point that it's analytics, not a hero-worthy decision input) and added `NextAllowanceTile` (days until next allowance — genuinely separate from "Upcoming," which is about what leaves, not what arrives). Final 2×2: Budget Used, Next Allowance, Upcoming, Goals On Pace.
  - **"Where It Went" → "Cash Flow."** Removed both donuts (`Donut` component deleted) and "This Period's Mix" (`CompositionBar` deleted) — they were duplicating what the ranked bars already said, just as proportions instead of numbers. Replaced with `CashFlowWaterfall` (Received → Spent → Saved → Upcoming → Reserved → Safe to Spend, as an actual sequence of figures, using `sts.upcoming_required` as "Upcoming" and `sts.buffer` as "Reserved") plus a generalized `RankedBars` component (replaces `TopCategories`) used twice — once for expense categories ("Where Spending Went"), once for savings goals ("Saved") — so both categories and goals get the same bar treatment instead of a donut-for-one/list-for-the-other split.
  - **Smart Allocator + Category Budgets merged into "Spending Plan."** New `SpendingPlan` wrapper component holds both as sub-panels under one card and one heading, `SmartAllocator` re-labeled internally to "Allocate" and `BudgetTracker` to "Live Budgets," each demoted from its own top-level `GLASS` card to a `subPanel` inside the shared one. This is a **presentational merge only** — no data-layer change, no cross-checking between a template and a budget cap yet (see §7).
  - **Goal Tracker cards restructured** from one prose sentence into labeled rows (Target / Required / Current), a red "⚠ ₱X/wk behind pace" line when `pace_status === 'behind'`, and a "Projected completion" row — same `GoalProjection` fields the app already computed (`required_per_week`, `avg_per_week`, `projected_date`), just laid out so the pace math is legible at a glance instead of buried in a sentence.
  - **What If? expanded** from a bare before/after comparison into a full verdict: an Affordable / Affordable-but-tight / Not-recommended badge (`whatIfVerdict()`, derived from the existing `warning` field and `after.balance`), an explicit "no goal impact" line when the type isn't savings, an "upcoming commitments still covered" / "at risk" line (from `after.safe_to_spend`), and a **"Record" button that posts straight to `/api/finance/transactions`** with today's date — so checking a what-if and then acting on it no longer requires re-typing the amount into the Transactions form. Added a category selector (only shown for `type: 'expense'`) since recording requires one and What If never needed it before.
  - **Page reorder.** Order is now Hero → Stat Rail → Cash Flow → Spending Plan → Transactions → a two-column bottom row (Goal Tracker + What If, side by side on wide screens, stacking on narrow ones) — matching the critique's proposed flow. This is the first *explicitly user-specified* 2-column layout in this module (as opposed to one I proposed and had rejected, see the note above) — different case, done as asked.
  - **Explicitly deferred, not built:** irregular income types (Part-time work / Freelance / Gift / Refund / Scholarship, generalizing "Allowance" into "Income") and recurring transactions (materializing `recurring_rules` — which exists as schema only — into future Upcoming entries automatically). Both require schema work applied to *two* live databases (per the constraint noted in §2), plus in the income case, touching every query that currently assumes `allowance` means one thing. Flagged rather than attempted silently — see §7.

---

## 7. Open questions / things flagged but not resolved

- **Category Budgets vs. Smart Allocator overlap — resolved, see §20.** What was a presentational merge here became a real data-level one: applying a plan now generates `category_budgets` directly (with a manual-override escape hatch), so the two are no longer independent mechanisms that could disagree about a category's number.
- **Irregular income.** Proposed: generalize "Allowance" into an "Income" concept with subtypes (Allowance, Part-time work, Freelance, Gift, Refund, Scholarship/Stipend, Other). Not started — requires an `income_type` column (or equivalent) on the `allowance` table (or a rename of the whole concept), applied to both databases per the constraint in §2, and touches every query/label currently written assuming "allowance" is the only inflow. (Recurring transactions, the other item deferred alongside this one, is now built — see §9.)
- **Habit Tracker is still legacy PHP**, still linked from the Next.js dashboard via an absolute production URL. Not in scope for any work done so far.
- **`financetracking.php` (1,352 lines)** — the original transaction-entry PHP page — was never audited in depth and has not been ported. Everything transaction-related in the new Next.js module was built fresh against the schema, not migrated from that file's logic.

---

## 9. Recurring transactions, and the hero's right side becoming Cash Flow

Two more requests, done in order: build recurring transactions (deferred in §7), then replace the hero's right-side entirely with Cash Flow.

**Recurring transactions — built.** The `recurring_rules` table had existed since Phase 1 with zero code touching it; confirmed present on the local DB with the documented columns (`type`, `category`, `goal_id`, `amount`, `frequency`, `day_of_week`, `day_of_month`, `start_date`, `end_date`, `next_run_date`) before writing anything against it.
- **New route** `src/app/api/finance/recurring-rules/route.ts`. `POST action:'save'` creates a rule and immediately materializes real planned rows (not virtual/computed ones) for the next 6 occurrences, tagged with `recurring_rule_id`. `GET` lists active rules and, before returning, tops up any rule whose future-planned count has dropped below 3 back up to 6 — so a rule stays populated with no cron job, just because the dashboard gets loaded regularly. `POST action:'delete'` hard-deletes the rule and also removes its not-yet-happened planned rows (so deleting "Transport ₱150/week" doesn't leave orphaned phantom entries sitting in Upcoming).
- **Occurrence stepping** (`addInterval()`) advances by 7/14 days for weekly/biweekly, or by one calendar month with day-of-month clamping (so a rule started on the 31st doesn't skip February) for monthly. `day_of_week`/`day_of_month` are still populated at creation from the start date for schema completeness, but the actual stepping only depends on `next_run_date` — the rule row is its own cursor.
- **Frontend:** new `RecurringRules` component, placed inside the Transactions card between the add-transaction form and the Recent/Upcoming lists (not a separate top-level section) — recurring rules exist to feed Upcoming, so it sits right next to it. Compact chip list (`Transport · ₱150.00 · Weekly ×`) plus a collapsible create form (Type → Category/Goal → Amount → Frequency → Start/End dates), matching the `fin-shell` collapse pattern already used for Budgets/Goals/Allocator-builder.
- No edit — only create and delete. Editing a rule mid-generation raises questions (does it touch already-materialized future rows, or only new ones?) that weren't worth answering for a first pass; deleting and recreating is one extra step for a rare action.

**Hero round 4 — Cash Flow replaces the 2×2 grid entirely.** The right-side tile grid (Budget Used, Next Allowance, Upcoming, Goals On Pace) is gone. In its place: the same `CashFlowWaterfall` + `RankedBars` pieces that used to live in their own standalone "Cash Flow" card below the Stat Rail — that standalone card (the `CashFlow` wrapper component) was deleted outright rather than duplicated, so the content now exists in exactly one place, just relocated into the hero.
- The user's stated priority: Cash Flow gets the readability, the left "Safe to Spend" block adjusts to make room, not the other way around. Concretely: the left block's flex-basis capped at `300px` (was unconstrained), its number size trimmed from `clamp(2.6rem,6vw,3.6rem)` to `clamp(2rem,3.4vw,2.6rem)`, and every internal margin/icon size nudged down a notch — while the right side went from a `320px`-capped 2-column tile grid to an uncapped `flex:'2 1 480px'` column that gives the waterfall and both ranked-bar panels real width to breathe, with the two ranked-bars panels sitting side by side inside it (`flex:'1 1 240px'` each) instead of stacked, now that there's room.
- This means `BudgetUsedRingCard`, `GoalsOnPaceRingCard`, `NextAllowanceTile`, and `UpcomingTile` are all now dead and were deleted. Budget-used and goal-pace information hasn't disappeared — it's one click down, already shown in more detail in Spending Plan's Live Budgets bars and each Goal Tracker card's own pace rows respectively. `SafeToSpendHero`'s props changed from `{ sts, budgets, goals }` to `{ sts, totals, breakdown }` to match.

---

## 10. Waterfall trimmed back to three steps, hero left side restored

Follow-up: the user asked to drop Upcoming, Reserved, and the final Safe to Spend chip from "This Allowance Cycle," leaving just Received → Spent → Saved — the waterfall now reports what actually happened this period, not a re-derivation of the Safe to Spend number that's already the hero's headline two inches away (the same redundancy lesson from the round-1 hero fix, applied here too). `CashFlowWaterfall` dropped its `sts` prop entirely since nothing in it needs safe-to-spend data anymore.

With the right side lighter, the left "Safe to Spend" block went back to its original sizing from before round 4 — `clamp(2.6rem,6vw,3.6rem)` number, `32px 36px` card padding, `alignItems:'center'`, no flex-basis/maxWidth cap — per explicit instruction to restore it now that Cash Flow no longer needs the extra room it was given.

---

## 11. Hero hierarchy fix — right side stops competing with the headline number

The user's diagnosis: the problem was never the amount of information on the right, it was visual competition — three separate floating cards, saturated per-step colors (cyan/pink/purple), and strong headings were pulling the eye away from the ₱4,265.40 that's supposed to be the answer. Four changes, all in `SafeToSpendHero`/`CycleSummary`/`RankedBars`:

1. **Removed the "Saved" ranked-bars panel entirely.** A goal-by-goal savings breakdown at hero level was too much detail for one number (`Saved ₱500`, already shown in the cycle summary) — that detail belongs in Goal Tracker further down, not duplicated here.
2. **Right side collapsed into one quiet column instead of three cards.** `CashFlowWaterfall` (a `subPanel` card) was replaced by `CycleSummary`, a bare block with no background/border of its own; `RankedBars` gained a `bare` prop that strips its `subPanel` styling for exactly this use. A single hairline divider (`1px`, `rgba(120,130,150,0.15)`) separates "This Allowance Cycle" from "Where Spending Went" in place of two separate card boundaries. A vertical hairline now also separates the whole left/right halves of the hero, doing the job a second card border used to do without adding another visible container.
3. **Right-side numbers went neutral.** Received/Spent/Saved were colored cyan/pink/purple before (`color` on the amount itself); now all three render in the same neutral `#2d3748`, with a small 6px colored dot next to each label carrying the category color instead — the same "encode with a small indicator, not a loud number" idea `RankedBars`' amount column already followed (its amounts were always `#333`, only the bar fill was ever colored). The hero's blue `₱4,265.40` is now the only saturated large number in the card.
4. **Status pill reworded to say what it's tracking toward.** "On track" became `Safe through {date}` — using `horizon_end` from the safe-to-spend response (already returned by the API, just not previously read into the frontend's `SafeToSpendResponse` type) so the pill reinforces what the headline number means instead of floating a vague verdict next to it. Tight/over-budget states, which can't promise a date, read "Spending tight this cycle" / "Over budget this cycle" instead.

Also: left side given a touch more relative width (`flex: 1.05 1 320px` vs. the right's `flex: 1 1 300px`) per direct instruction that the primary number should have first claim on space, not just equal footing.

---

## 12. Bottom row un-columned, Recurring folded into the Transactions form as an option

Two corrections after §9/§10:

1. **Goal Tracker and What If no longer share a row.** §9 had put them side by side in a 2-column flex wrapper at the bottom of the page. The user's call: they each deserve their own full-width row, matching every other section. The wrapping `<div style={{ display:'flex', ... }}>` is gone — both are now plain top-level siblings again, same as Spending Plan or Transactions.
2. **Recurring is no longer its own section with its own form — it's a Timing option inside the Transactions add-form.** The Transactions form gained a "One-time / Recurring" toggle (same `fin-tab` pill pattern as the existing/new-goal toggle). Choosing "Recurring" swaps the single Date field for Frequency + Starts + Ends(optional), relabels the submit button "Save," and posts to `/api/finance/recurring-rules` instead of `/api/finance/transactions` — sharing the same Type/Category/Goal fields either way, so nothing is asked twice. `RecurringRules` (the chip list) lost its entire create-form/`fin-shell` toggle and is now just a delete-capable list of active rules, rendered only when `recurringRules.length > 0` instead of always present with its own "+ New Recurring" button.

---

## 13. Hero's "This Allowance Cycle" removed — it duplicated the Stat Rail

The user spotted a redundancy the last few passes had missed: the hero's right side ("This Allowance Cycle" — Received/Spent/Saved) and the Stat Rail card directly below it (Allowance/Expenses/Savings totals + the week/month/all bar chart) were reporting the same three numbers, just in two different shapes, one screen-length apart.

**Fix:** the hero's right side is now *only* "Where Spending Went" — `CycleSummary` (the Received/Spent/Saved block) was deleted outright, not relocated, since its numbers already live in the Stat Rail. `SafeToSpendHero`'s `totals` prop is gone too (it was only there for `CycleSummary`); the component now takes just `{ sts, breakdown }`.

**Stat Rail made more descriptive/visual**, since it's now the sole place this data lives (previously it could lean on the hero for some of the explaining):
- Gained an actual header — `<BarChart3/> Activity Breakdown` — plus a range-aware subtitle ("Day by day this week" / "Week by week this month" / "Month by month this year"), where before it opened directly on the stat numbers with no title at all.
- The vs-last-period delta changed from a bare `▲87%` (context only in a hover tooltip) to a visible `▲ 87% vs last week` — descriptive without requiring a hover.
- The bar chart now highlights "today"'s column: a colored 1.5px border around today's bar (`currentBucketIndex()`, a client-side mirror of the summary route's own `bucketIndex()` so no extra API call is needed) and a small floating ₱ value label above it — so the chart answers "where am I right now" at a glance instead of requiring a hover on every bar to find today.

---

## 14. Stat Rail polish — label overlap fixed, then each row given its own visual language

Three quick follow-ups after §13 shipped the today-highlight, then one larger one.

**Bug: the floating ₱ label overlapped the row above it.** The value label used `position: absolute; bottom: 100%` inside a row, but the outer rows only had a 9px gap between them — not enough room for an ~11px label, so it rendered on top of the previous row's bar instead of above its own. Fixed by giving every row `paddingTop: 14px` (reserving space for a label regardless of whether that row happens to show one) and switching the row to `alignItems: 'flex-end'` so the row's own text label ("Allowance"/"Expenses"/"Savings") stays flush with the bar's bottom instead of drifting into the new padding.

**Value labels shown on every bar, not just today's.** Originally the ₱ label only appeared above the highlighted "today" column; changed to show on any bucket with a nonzero value, for visual consistency across the whole row instead of one column reading differently from the rest.

**Each row given a visualization that fits what it actually represents,** rather than all three sharing one generic proportional-bar treatment — and this isn't range-specific, so it looks the same in Week/Month/All since none of the new components read `range` directly, only the already range-shaped `breakdown` arrays:
- **Allowance → `AllowanceMarkerRow`** *(superseded in §15 — the dot-marker shape was reverted; kept here for history).* Allowance isn't a quantity that accumulates through the period, it's a handful of deposit events — a proportional bar made that read as "mostly empty, one spike," technically correct but not informative. Replaced with a thin track line and a dot marker on any bucket that received a deposit (today's dot gets a slightly larger size + ring instead of a border, since a bordered dot doesn't read as clearly as a bordered bar does).
- **Expenses → `BarRow`.** Unchanged — the proportional bar remains the right shape for a quantity that's genuinely distributed across the period.
- **Savings → `SavingsSegmentedRow`.** Changed from one flat-colored bar per bucket to a bar segmented by goal (using `breakdown.savings_by_goal[i]` and the same `savingsColor()` hash "Where Spending Went" and the Savings donut used to use), so a bucket's savings bar visually shows *which* goal(s) it went to instead of just a total — the hover tooltip spells it out too (`Tue: ₱500.00 — New Freezer ₱500.00`). This is the bar-chart equivalent of the ranked-bars idea already used for expenses, applied to savings instead of a flat number.

**Hero's "Where Spending Went" was vertically centering instead of stacking from the top.** The right-side wrapper used `alignSelf: 'center'`, which put it in the middle of the hero's stretched height whenever it had less content than the left "Safe to Spend" block (e.g., only one expense category this period) — reported as pills appearing to "float in the middle" rather than starting at the top. Changed to `alignSelf: 'flex-start'` so it always anchors to the top of the hero, growing downward.

---

## 15. Correction — pill shape restored everywhere; variety moved into the data, not the shape

The user pushed back on §14's Allowance dot-marker: **the pill shape should stay consistent across all three rows** (Allowance included) — the "variety" they wanted was always about *what kind of data a pill shows*, not a different shape per row. Concretely: an empty day should say "No allowance" rather than just sitting blank, and a savings bucket split across several goals should say something like "5 goals allocated" rather than only a peso figure.

- **`AllowanceMarkerRow` deleted.** Allowance is back to the same `BarRow` pill Expenses uses — `<BarRow label="Allowance" ... emptyLabel="No allowance" />`. `BarRow` gained an `emptyLabel` prop: when a bucket's value is 0, its tooltip now reads `{day}: No allowance` (or `No expenses` for that row) instead of `{day}: ₱0.00` — the empty-state *text* carries the distinction now, not the pill's shape.
- **`SavingsSegmentedRow`'s floating label now switches between a peso amount and a goal count** *(superseded in §16 — the goal count was moved to the period-level stat, not shown per-bucket; kept here for history).* One goal in a bucket → shows the peso amount, same as every other row. More than one goal in the same bucket → shows `"N goals"` instead (e.g. `"2 goals"`), with the full per-goal breakdown still available on hover. The segmented-by-goal *fill* (§14) was kept — that part wasn't a shape complaint, it's still a pill, just internally colored by goal.
- **Bug caught in the same pass: Month and All views showed no vs-previous-period annotation at all**, because the delta calculation silently returns `null` whenever `previousTotals` is 0 or missing (e.g., no allowance recorded last calendar month), and the UI simply hid the line rather than saying why. Fixed by always rendering *some* line under each stat now: the percentage-vs-last-period when there's real data to compare, `"≈ same as last {period}"` when the change is under the 0.5% noise floor, `"No data last {period}"` when the previous period is empty, and `"No prior period to compare"` for the `all` range specifically (there's no meaningful "previous all-time" to diff against, so this explains the absence instead of leaving a silent gap).
- **"Today" highlight changed from a border ring to a glow** (`todayGlow()`: a 1px solid outline plus a soft blurred `box-shadow` in the row's color) per direct request — reads as the pill lighting up rather than getting boxed in, and is shared by both `BarRow` and `SavingsSegmentedRow` so the treatment is identical everywhere it's used.

---

## 16. Glow extended to every filled pill; the goal count moved to where it belongs

Two more corrections, both direct pushback on §15.

**"Why does the glow effect not apply to all."** Investigated first rather than guessed — cross-checked `currentBucketIndex('all')` against the actual data with a direct SQL query (`GROUP BY MONTH(entry_date)` across every table, matching the backend's own `bucketIndex()` for the `all` range) to rule out an indexing bug before touching any code. August (index 7) genuinely has nonzero Allowance/Expenses/Savings, so the "today" glow was rendering correctly on the right pill in the `all` view — there was no bug. The real ask, read against the pattern already set by "put the number details on top of each pill for consistency" a few turns earlier, was that the glow should apply to **every populated pill**, not just today's — the same consistency principle already applied to value labels. Added a second `glow()` helper (a softer, tighter version of `todayGlow()`) and gave every pill with `v > 0` a colored glow now, with today's staying visually stronger so it's still findable among the rest.
  **Follow-up fix in the same pass:** the first version of `glow()`/`todayGlow()` used a `box-shadow` spread radius with little to no blur, which rendered as a crisp colored ring — visually indistinguishable from a border, the exact thing the glow was supposed to replace. Corrected to pure blur with no spread (`glow`: `0 0 8px 1px` at low opacity; `todayGlow`: two stacked blur layers, tighter+brighter plus wider+softer), so both now actually fade outward instead of terminating in a hard edge.
  **Second follow-up, still an outline:** the glow was still reading as an outline for low-value pills (e.g. a ₱400 bar on a scale that maxes out around ₱18,000) — because the `box-shadow` was on the *outer track div* (the full-width gray pill), not the small colored fill inside it. A pill that's 98% empty gray space with a glow around its entire outline looks exactly like a colored border around an empty box, regardless of how soft the blur is. Fixed by moving the glow onto an unclipped absolutely-positioned sibling sized to match only the *filled* width (`pct`), so the glow now blooms from the actual colored data, not from the track's outer boundary. This also required removing `boxShadow` from the `overflow: hidden` track div — a child's box-shadow gets clipped by a parent's `overflow: hidden` the same as any other overflowing content, so the glow element had to live outside that clipping context as a sibling rather than nested inside it.

**"When I said the goals, that should apply below the savings under the overall. Please, don't be dumb."** §15 had put the "N goals" descriptor on individual per-bucket pills (replacing the peso amount when a bucket spanned more than one goal). The user meant the top-level Savings stat, not the bar chart: a `goalsInPeriod` count (`new Set(...)` over every bucket's goal keys with a nonzero value, for the whole period) is now appended to the *existing* annotation line under the overall "Savings ₱X" figure in the stats row — `"▲12% vs last week · across 2 goals"`, or `"No prior period to compare · across 2 goals"` for the `all` range, etc. — only shown when more than one goal actually contributed. `SavingsSegmentedRow`'s per-bucket label reverted to always showing the peso amount, matching every other row exactly (no more "N goals" replacing it at the pill level); the segmented-by-goal colored fill and the hover tooltip's per-goal breakdown are unchanged.

---

## 17. Glow abandoned — back to the original border highlight

After two follow-up attempts to fix the glow's "looks like an outline" problem (§16), the user asked to drop the glow idea entirely rather than keep tuning it: **revert to the original design, just make today's pill stand out.** `glow()` and `todayGlow()` (the box-shadow helpers) and the absolutely-positioned glow sibling elements from the last fix are gone. `BarRow` and `SavingsSegmentedRow` are back to exactly what they were before any of the glow work started: a `1.5px solid {color}` border on today's pill, `1.5px solid transparent` on every other one (the transparent border keeps every pill the same box size regardless of highlight state, so the row doesn't jump around). Everything else from §14–§16 stayed — the pill shape, the empty-state labels ("No allowance"/"No expenses"), the goal-segmented Savings fill, and the "across N goals" note at the stat level are unaffected; only the today-highlight *style* changed back.

---

## 18. Border color darkened — same-color border on a full bar is an invisible border

The border came back from §17, but the user immediately caught the reason it looked inconsistent before it was ever a glow: `border: isToday ? \`1.5px solid ${color}\` : ...` used the exact same color as the fill (`background: color`). A same-color border sitting flush against a same-color fill has no edge to see — with `box-sizing: border-box`, the border is genuinely there (the content box shrinks to make room for it), it's just visually identical to what's next to it. On a mostly-empty pill this was invisible only where the fill overlapped the border (mostly not, since there's little fill) — so it read as "clearly visible." On a pill filled close to 100% (e.g. Allowance receiving the full deposit for the period), the border sits on top of the fill on *every* side, and the whole ring vanishes. Same root cause as the glow bug in §16, different symptom.

**Fix:** `BarRow` now takes a separate `borderColor` prop, distinct from the fill `color`, so there's always contrast regardless of fill percentage:
- Allowance: fill `#74bcd9`, border `#2a7fa8` (the same deep blue already used for the Safe to Spend headline number — reused rather than inventing a new color).
- Expenses: fill `#e0679d`, border `#c65f83` (already one of `EXPENSE_HUES`).
- Savings (`SavingsSegmentedRow`): border `#6b46b3`, deliberately *not* one of the five `SAVINGS_HUES` a goal segment could be filled with, so it can never accidentally match whichever goal color happens to be filling today's bucket.

**Immediate follow-up: Expenses' border still washed out at 100% fill.** `#c65f83` turned out to be too close to `#e0679d` in lightness and saturation — both are mid-tone pinks (HSL lightness 64% vs 57%, same hue family), so on a fully-filled Week-view bar (where Expenses was the single largest bucket and filled the whole pill) the low-contrast pair read as barely-there, exactly the problem this fix was meant to solve. It only looked fine in Month/All because a partial fill exposed the border against the gray track instead, masking the real issue. Replaced with `#9c3a5c`, a noticeably darker, more saturated rose (L≈45%) — the same fix, just with enough actual contrast to survive a 100%-filled bar.

---

## 20. Plan-driven architecture — Spending Plan stops being a transaction-entry surface

An independent AI auditor's review (pasted in full by the user) diagnosed the real problem with Spending Plan: applying a template had quietly become a *second* way to create transactions, parallel to and disconnected from the actual Transactions form. Given a scope choice between (a) just relocating the apply-flow, (b) that plus plan-generated budgets with manual override, or (c) all of that plus a tier-aware Safe-to-Spend advisory engine, the user picked the full scope. Also fixed in the same pass, as a byproduct of (a): applying a template previously never recorded the allowance itself — it created ₱8,000 worth of expense/savings rows with no corresponding `+₱8,000` ever hitting the `allowance` table, a real ledger inconsistency that's now structurally impossible since the allowance row is always created first.

**Schema** (`financetracker/schema-phase2-plan-driven-budgets.sql`, local DB only — the classic PHP finance pages are dead code at this point, nothing reads the remote DB's finance tables anymore, so this migration wasn't mirrored there): `category_budgets` gained `plan_amount` (what the active plan currently allocates, NULL if this budget was never plan-derived), `is_override` + `override_reason` (a manual adjustment that intentionally diverges from the plan), and `tier` (copied from `allocation_template_items.priority_tier` when a plan sets the budget). `allocation_templates.is_default` — added in Phase 1, sat completely unused until now — is repurposed as "the active plan."

1. **Allowance creation moved into Transactions.** The Transactions form gained a "Spending plan" field (shown only for `type: 'allowance'`, hidden when Recurring is selected — combining recurring income with auto-allocation was explicitly left out of scope, same as the review's own "eventually" framing for template/recurring interaction) with an Apply-automatically / Don't-allocate-yet choice. Submitting now always creates the allowance transaction first, then — only if a plan was chosen and "apply automatically" — calls `apply-allocation` afterward, fixing the ledger gap described above. The goal picker (for a plan with a savings slice) reuses the exact existing/new-goal UI already built for savings transactions, rather than a second copy.
2. **Spending Plan is now a read-only "Active Plan" summary, not a permanently-open editor.** `SmartAllocator` shows the active template's name and a plain Category/Tier/Value table; the full builder and the "Change Plan" chip list (click a chip to call the new `set_default` action) both live behind `Edit`/`Change Plan` buttons in `fin-shell` collapses, closed by default. The first template a user ever creates becomes active automatically (there'd otherwise be no way to have an "Active Plan" state at all). `goals`/`onApplied` props were removed from `SmartAllocator` entirely — it has nothing left to apply.
3. **`apply-allocation` now generates the cycle's budgets instead of just planned transactions.** For each non-savings item, it upserts `category_budgets`: sets `plan_amount` and `tier` always, and additionally moves `cap_amount` to match — *unless* `is_override` is already set, in which case the override's number is left alone and only the reference `plan_amount` moves. This is the "plan generates budgets, override survives it" rule from the review, implemented as literally as the schema allows.
4. **Live Budgets groups by tier** (Essential/Committed/Flexible, reusing `priority_tier`'s existing enum values — only the *display* labels changed from Required/Target/Flexible) and adds an override control (`SlidersHorizontal` icon → inline amount + optional reason, posts `action: 'override'`) plus a reset-to-plan control (`RotateCcw`, shown only when overridden and a plan value exists to revert to, posts `action: 'reset'`) with an "Adjusted" badge and a small "Plan allocation: ₱X · reason" caption underneath. Budgets with no tier (set manually, never touched by a plan) group under Flexible — the same default the tier math below uses.
5. **Tier-aware Safe-to-Spend.** `/api/finance/safe-to-spend` now looks up the active template's category→tier map and buckets upcoming planned expenses into `tier_breakdown: { required, target, flexible }` (planned savings count toward `target`/Committed). When the raw (unclamped) balance projection goes negative, it computes `shortfall` and whether Flexible alone, Flexible+Committed together, or neither can cover it (`shortfall_coverable_by`), plus which categories are the flexible ones (`flexible_categories`, as raw category keys — labeling happens client-side via the existing `categoryLabel()`, keeping formatting logic in one place). The hero renders this as a plain-text advisory banner beneath the status pill when a shortfall exists — matching the review's explicit "don't automatically change it, just say so" instruction. No tier data at all (no active plan) means these fields come back `null`/empty and nothing shows.
6. **Deferred, matching the review's own framing:** letting a template's percentages apply to "money remaining after recurring commitments" instead of the total allowance (review's point 8, explicitly called "an eventually" — not implemented); the "₱X est." column in the Active Plan summary mockup, which would need a "typical allowance" baseline the app doesn't currently compute anywhere (skipped — the summary shows the plan's configured % / fixed ₱ directly instead, which is accurate, just not pre-multiplied).

---

## 21. Spending Plan, round 2 — one plan switcher instead of two, real pesos, tier consistency fixed

A follow-up review of §20's build (same "independent AI auditor" format, six numbered points) caught real remaining issues:

1. **Two controls did the same job.** `Edit`/`Change Plan` sat right above a persistent `[Hi] [Try] [+ New Template]` chip row — both were ways to switch or manage plans. Replaced with one control: an "Active plan" `<select>` listing every template plus `+ New plan` and `Manage plans…` as synthetic options. Choosing a template calls `set_default` directly; `+ New plan` opens the builder; `Manage plans…` reveals the same edit/delete chip list as before (now purely for editing or deleting a *non-active* template, not for switching), collapsed by default via the same `fin-shell` pattern. `changingPlan` was renamed `manageOpen` throughout to match what it actually does now.
2. **The active plan table now shows real pesos, not just percentages.** `apply-allocation` already writes `plan_amount` onto `category_budgets` when a plan is applied — `SmartAllocator` back-solves the allowance those figures were computed from (`plan_amount ÷ percent`, from any one category) to get a `baseAllowance`, then shows a `Current cycle: ₱18,000` line, a `%` + `Allocation` column pair instead of one blended "Value" column, and a Total row. Before a plan has ever been applied (no `plan_amount` anywhere yet), it falls back to the plain percent/fixed display from before — there's no cycle amount to compute pesos from yet.
3. **Real bug: Live Budgets could show a different tier than the plan does for the same category.** `apply-allocation` writes `category_budgets.tier` at apply time, but editing a template afterward (changing a category's tier) only touches `allocation_template_items` — nothing re-syncs the already-generated budget rows, so a category's tier could visibly disagree between "Spending Plan" (live, correct) and "Live Budgets" (stale, from whenever it was last applied). Notably, the *backend* tier-aware Safe-to-Spend math (§20) was already immune to this, since it re-derives tiers from `allocation_template_items` fresh on every call rather than trusting the stored column — only the budget list's own display was reading the stale value. Fixed the same way: `SpendingPlan` now builds `activeTierMap` from the active template's live items and passes it into `BudgetTracker`, which groups by `activeTierMap.get(category) ?? b.tier ?? 'flexible'` — the live plan wins whenever it has an opinion, the stored column is only a fallback for categories the active plan doesn't mention.
4. **Renamed "Live Budgets — tracking what's been spent" to "Budget Progress — how your plan is going,"** making the Plan-vs-Progress relationship explicit in the section labels themselves now that the upper half is unambiguously "the plan" and the lower half is unambiguously "how it's going."
5. **`+ Set a Budget` kept as-is, deliberately.** The review suggested reframing it as "Adjust Budget" since the plan now generates budgets automatically — but `+ Set a Budget` still serves a distinct, real purpose: capping a category the active plan doesn't cover at all (there's no "allocation" to adjust for a category with no budget row yet). The per-row `SlidersHorizontal` override icon already added in §20 *is* the "Adjust Budget" the review was asking for, for categories that do have one.

A screenshot in the same message appeared to show the "Manage plans" chip list and the template builder both rendered open by default — turned out not to be a bug at all: it was the user having actually selected "Manage plans…" from the new dropdown to see what it did, which worked exactly as coded. The real feedback (see §22) was that burying an action inside a `<select>` option is confusing regardless of whether it technically works.

---

## 22. "Manage plans…" moved out of the dropdown into its own button

Confirms §21's dropdown redesign worked mechanically, but triggering a side-effect (revealing the edit/delete chip list) by picking a non-plan "option" out of a `<select>` reads as unclear — a dropdown option should select a value, not perform an action. `__manage__` removed from the `<select>` entirely; a plain `Manage`/`Done` toggle button now sits next to `Edit` on the right side of the "Active plan" row, doing the exact same thing (`setManageOpen`) through a normal, visible control instead of a hidden dropdown entry.

---

## 23. Root cause found — every collapsible panel in this module has been rendering permanently open, all session

The user kept reporting the same shape of complaint across several turns — a panel appearing expanded when its own toggle button clearly showed the "closed" label (Recurring's old create form, "Change Plan," the template builder, and finally "+ Set a Budget"). Each time, the component's own state logic checked out (the `open`/closed boolean was correctly `false`, gated correctly behind a click) — the actual defect was one level up, and shared by all of them.

**The bug:** `FinanceDashboard`'s top-level `<style jsx>{...}</style>` block is *scoped* by default — styled-jsx only attaches its scoping class to elements written literally inside the JSX of the component that declares the `<style jsx>` tag. `.fin-shell` (the `grid-template-rows: 0fr → 1fr` collapse animation every "+ New X" / "Set a Budget" / builder panel in this file depends on) is used inside `BudgetTracker`, `SmartAllocator`, and `GoalTracker` — separate top-level components, not inline JSX inside `FinanceDashboard`. Styled-jsx's scoping attribute never reached their elements, so the compiled selector (effectively `.fin-shell.jsx-xxxxx`) never matched anything they rendered. The rule simply never applied — not "sometimes," not "under certain state" — for any of these three components' collapsible panels, for the entirety of this session. Every one of them has always rendered at full height regardless of its `open` class.

**Fix:** `<style jsx>` → `<style jsx global>`. One word. This drops the scoping requirement so `.fin-shell`, `.fin-tab`, `.fin-add-btn`, `.fin-spin`, and `.fin-row-remove` apply anywhere in the DOM by class name alone, which is what a shared set of utility classes used by several sibling components actually needs — confirmed no other file in the project uses any `fin-`-prefixed class name, so widening the scope carries no collision risk.

This also retroactively explains why the "Recurring" section (before it was simplified to a plain list in an earlier pass) and "Live Budgets"/"Budget Progress"'s create-form always looked "already open" in early screenshots — same cause, not a series of unrelated bugs.

---

## 25. Spending Plan, round 3 — builder lifted to the card title row, chip list dropped as redundant, dropdown restyled

Three more corrections, once the styled-jsx fix in §23 made it possible to actually see these panels collapse for the first time.

1. **"Manage Plans" renamed and repurposed: it now opens the builder directly, not a chip list.** The chip list (`[Hi] [Try] [+ New Template]`) was redundant with the "Active plan" dropdown already added in §21 — switching plans is the dropdown's job, so a second surface for the same choice added nothing. The button is now `+ Create Plan` and opens a blank builder immediately; deleting a *non-active* template now goes through Edit → Delete inside the builder (select it active via the dropdown first, or edit whichever template is already active) rather than a dedicated chip-list delete icon. `Pencil` import removed as dead code along with it.
2. **The builder moved up a level, and now renders above the breakdown, not below it.** Builder state (`builderOpen`, `editingId`, `name`, `rows`, `builderMsg`) and its whole form JSX moved out of `SmartAllocator` into `SpendingPlan` itself, since the trigger button now lives on `SpendingPlan`'s title row and needs to control it directly rather than through an awkward lifted-boolean handshake. `SmartAllocator` shrank to a pure view: the "Active plan" dropdown, an `Edit` shortcut, and the read-only Category/Tier/Value(/Allocation) table — it takes an `onEditTemplate` callback instead of owning any create/edit state itself. In the render order, the `fin-shell`-wrapped builder now sits *before* `<SmartAllocator>` inside `SpendingPlan`, so opening it visually pushes the breakdown down rather than appending below it.
3. **The "Active plan" `<select>` restyled** from a plain white `inputStyle` box to the same dashed-pill look already used for "+ New Template" elsewhere in the app (`1.5px dashed` purple border, `rgba(164,132,196,0.08)` fill, purple text) — plus a custom SVG chevron via `background-image` and `appearance: none`, since removing the native white chrome meant supplying a replacement affordance that it's a dropdown.

---

## 26. Budget Progress made fully plan-derived — no more independent category list

The screenshot exposed a real data-integrity gap the tier-consistency fix in §21 hadn't reached: Spending Plan's active template ("Hi") listed Food/Healthcare/Utilities/Savings, but Budget Progress showed Utilities/Grocery/Leisure/Miscellaneous — a different set of categories entirely, because Budget Progress's category list came from whichever rows existed in `category_budgets` (a mix of leftover manual budgets from before Spending Plan existed, plus whatever categories had happened to go through an `apply-allocation` at some point), not from the active plan itself. §21's tier fix made the *label* on a shown category agree with the plan; it didn't make the *set of categories shown* agree with it.

**Backend (`/api/finance/budgets`), rewritten:**
- **GET** no longer starts from `category_budgets` rows. It starts from the active template's items (`allocation_template_items` where `category != 'savings'`) and, for each one, computes `spent` fresh from actual transactions regardless of whether a `category_budgets` row exists yet — a plan category that's never been through an `apply-allocation` still shows up, with `cap_amount: null` and `budget_id: null` rather than being silently absent. A `category_budgets` row, when one exists, still supplies `cap_amount` (or the override), `plan_amount`, and override metadata. No active plan → empty list, not a leftover manual set.
- **POST** dropped the `save` and `delete` actions entirely — manual, plan-independent budget creation is no longer part of the model. `override` was changed to upsert **by category** instead of requiring an existing `budget_id`, since a plan category with no row yet needs one created on first override, not just updated. `reset` is unchanged.

**Frontend:** `BudgetTracker` lost its "+ Set a Budget" button, the whole create-form, and the per-row delete (×) — it's now pure monitoring plus the one exception mechanism (the `SlidersHorizontal` override icon, unchanged in spirit, now keyed by category). A category with `cap_amount: null` (in the plan, never applied) renders as `{spent} spent · not applied yet` instead of a `spent / cap` fraction, since there's nothing yet to divide by. `SpendingPlan`'s `activeTierMap` reconciliation from §21 was removed as redundant — the backend now returns each category's `tier` straight from the live template, so there's no stored, potentially-stale column left in the loop for the frontend to reconcile against. `BudgetItem`'s `budget_id`, `cap_amount`, and `remaining` are now `| null` throughout to match.

Net effect: **Spending Plan defines the categories → Budget Progress can only ever show that exact set.** A category can't appear in one and not the other, and can't disagree on tier, because there is no longer a second source of truth to disagree with.

---

## 28. The builder can instantiate a real cycle directly — explicit dates, remaining-allowance guards both ways

§26 made Budget Progress fully plan-derived, but left every category stuck at "not applied yet" until a real Transactions allowance event happened to apply the plan — which the user hadn't done for "Hi" yet, hence the placeholders. Rather than requiring that detour, the template builder can now instantiate a concrete cycle directly, with two different "remaining" guards depending on which number is being bounded:

**Schema** (`financetracker/schema-phase3-explicit-cycle-dates.sql`, local only, same rationale as §20): `category_budgets` gained `period_start`/`period_end` (explicit dates) alongside the existing `period` enum — when set, the budgets route uses them directly instead of computing a rolling weekly/monthly window from "today."

1. **Builder gained two additive fields**, sharing the row with Template name instead of it spanning alone: an **Allowance** amount (`PesoInput`, capped against the account's actual `current_balance` — "remaining allowance" in the sense of "money you actually have that isn't already claimed by something else") and a **Period from/to** date pair. Both are optional — leaving them blank saves exactly as before (percentages only, no budget rows). Filling them in computes each non-savings item's real peso cap (`allowanceAmount × percent`, or the fixed amount) and upserts `category_budgets` for that explicit date range, replacing "not applied yet" with real numbers immediately. Providing an allowance also marks the template active (defining a concrete cycle for a plan is activating it).
2. **A second, different "remaining" governs overrides**: not the account balance, but the cycle's own total pie. `/api/finance/budgets` GET now also returns `remaining_allowance` = (sum of every category's original `plan_amount`) − (sum of every category's current, possibly-overridden `cap_amount`) — how much of *this cycle's* allocated total is still unclaimed. Budget Progress shows this as "Unassigned this cycle," and the override form's max is `remaining_allowance + the category's own current cap` (since raising one category's cap by X has to come from somewhere in the same fixed pie, not from outside it). Enforced both client-side (immediate feedback) and server-side in the `override` POST handler (authoritative — the client check alone was never trustworthy).
3. **A first-time override on a never-applied category now inherits the active cycle's dates** from any sibling budget that already has them, instead of defaulting to a bare "this month," so a category overridden before it's ever gone through the builder's allowance step still lines up with the rest of the cycle.

These are two genuinely different ceilings — "how much of my money can I commit" (builder, account-wide) vs. "how much of what's already committed to this plan is still up for grabs among its categories" (override, cycle-scoped) — and conflating them would have let a single category quietly absorb money the account doesn't actually have, or let overrides silently expand a cycle's total beyond what the plan says it should be.

---

## 29. "Not applied yet" placeholder dropped — Budget Progress only lists categories with a real cap

§28 introduced this to keep every plan category visible even before it had a real number, but the placeholder row itself ("₱X spent · not applied yet") wasn't wanted — the ask was to get the section back to its original clean look. Fixed by filtering: `BudgetTracker` now only lists categories where `cap_amount !== null` (i.e., have actually gone through the builder's allowance step or an override), so every visible row is back to a plain `spent / cap (period)` bar with nothing conditional in it. A plan whose categories haven't been given an allowance yet shows one line — "This plan hasn't been given an allowance yet — set one in Allocate above to start tracking" — instead of a placeholder per row.

---

## 30. Active plan now has a visible Delete option

Deleting a plan previously required opening the builder (Edit) to reach the Delete button buried inside it — no direct way existed from the Allocate row itself, and deleting a non-active plan meant switching it to active first. Added a `Delete` button next to `Edit` in `SmartAllocator`'s active-plan row, wired through a new `onDeleteTemplate` prop back to `SpendingPlan`'s existing `removeTemplate` (same confirm dialog, same API call). `removeTemplate` now also calls `onBudgetsChange()` so Budget Progress refreshes immediately if the deleted plan was the one supplying its categories. Deleting a plan that isn't currently active still goes through the dropdown-then-Edit path, unchanged.

---

## 31. Category budgets weren't scoped per plan — three real bugs from one root cause

Reported: after switching the active plan and deleting one, Budget Progress went blank and showed nothing, even though other plans still existed. Also asked to check that switching plans actually adapts to the chosen plan's own period, and that editing a plan prefills its existing inputs instead of always starting blank.

All three trace back to the same root cause: `category_budgets` had no link back to which plan produced a row — a row was found purely by `(user_id, category)`. That meant:

1. **Two plans sharing a category silently shared one row.** If Plan A and Plan B both had "food," applying B's allowance overwrote the exact same row A was using — switching back to A would show B's numbers, not A's. This is why switching plans didn't "adapt to the chosen plan for its specific period" — there was only ever one row per category, not one per plan.
2. **Deleting the active plan left no active plan at all.** `action: 'delete'` never checked whether the deleted template was `is_default`, so if it was, the account was left with zero active templates even when others existed — Budget Progress and Allocate both render their "no active plan" empty state in that condition, which is what looked like "not updating and showing nothing."
3. **Switching the active plan (`set_default`) never refreshed Budget Progress.** `SmartAllocator`'s `setActive()` only called `onTemplatesChange()`, never `onBudgetsChange()`, so even when the underlying data was correct, the panel could sit stale until some unrelated action happened to refetch it.

Fixed with `schema-phase4-template-scoped-budgets.sql` (migration applied to the local DB): added `category_budgets.template_id` (FK to `allocation_templates`, `ON DELETE CASCADE` — deleting a plan now cleans up its own budget rows automatically) and three cycle-memory columns on `allocation_templates` — `last_allowance_amount`, `last_period_start`, `last_period_end`. Existing rows were backfilled to whichever template was active at migration time.

- `/api/finance/allocation-templates` — GET now returns the three cycle-memory columns per template; `save`'s cycle-instantiation block looks up/inserts `category_budgets` scoped by `(user_id, template_id, category)` instead of `(user_id, category)`, and writes `last_allowance_amount`/`last_period_start`/`last_period_end` onto the template whenever a cycle is (re)instantiated; `delete` now runs in a transaction that promotes the oldest remaining template to `is_default` if the one being deleted was active, so deleting the active plan never leaves the account with none.
- `/api/finance/budgets` — GET's `existingRows` query and POST `override`'s `allBudgets` query both now filter by the active template's `template_id`, not category alone; a first-time override inserts with that `template_id` too.
- `FinanceDashboard.tsx` — `AllocTemplate` gained the three cycle-memory fields; `SpendingPlan`'s `openBuilder(t)` now prefills `allowanceAmount`/`periodFrom`/`periodTo` from `t.last_allowance_amount`/`last_period_start`/`last_period_end` when editing an existing plan (still blank for a brand-new one), instead of always resetting to blank; `SmartAllocator` gained an `onBudgetsChange` prop and calls it right after `setActive()` succeeds, so Budget Progress updates the instant you switch plans, not on the next unrelated refetch.

---

## 32. Budget Progress date moved to the section header; per-row date dropped

The date range appeared twice — redundantly, and in an awkward spot on each row, wedged between the spent/cap amount and the manual-override icon. Removed the per-row `(Aug 1 – Aug 31)` parenthetical entirely. The cycle's date range now replaces "how your plan is going" in the section header itself — `Budget Progress — Aug 1 – Aug 31` — computed once from whichever applied budget has explicit period dates (they all share one cycle, so any of them will do), falling back to "This week"/"This month" for budgets that predate explicit cycle dates.

---

## 33. Editing the active plan no longer opens the create-plan panel — it edits in place

Editing reused the exact same slide-open panel as "+ Create Plan," just pre-filled — visually indistinguishable from starting a new plan. Split the two flows apart: "+ Create Plan" still opens that panel, but only for a genuinely new plan. Clicking **Edit** on the active plan no longer touches it at all — `SmartAllocator` now owns its own local edit state (`editing`, `editName`, `editRows`, `editAllowance`, `editFrom`, `editTo`, `editMsg`) and swaps its own read-only Category/Tier/%/Allocation table for the same editable rows in place, right where the breakdown already lives. Save/Cancel/Delete replace the Edit/Delete pair in the Allocate row's corner while editing; the active-plan dropdown disables itself for the duration so you can't switch plans mid-edit. `SmartAllocator` gained an `accountRemaining` prop to validate its own allowance input the same way the create-panel does. Saving calls the same `POST /api/finance/allocation-templates` `save` action (with the active plan's `template_id`), then refreshes both templates and budgets.

---

## 34. Edit prefill was still blank for plans predating Phase 4 — backfilled; fixed the "%" header misalignment

Two bugs from the same screenshot. First: editing "School" showed a blank Allowance and Period even though it clearly had a real cycle (Budget Progress showed real numbers for it). Cause: §31's `last_allowance_amount`/`last_period_start`/`last_period_end` columns only ever get written going forward, on the next save — they were never populated for a plan whose cycle was instantiated *before* those columns existed. Confirmed directly against the DB: `School` had `last_allowance_amount = NULL` while its `category_budgets` rows plainly showed a ₱5,300 cycle running Aug 26 – Sep 22.

Fixed with a one-time data backfill, `schema-phase4b-backfill-cycle-memory.sql` (run against the local DB): period dates copy straight from any of the template's own `category_budgets` rows; the allowance amount is back-solved from one percent-type item's `plan_amount` divided by its own percent share (`peso = allowance × percent/100`, solved for allowance). Verified against `School`: back-solved to exactly ₱5,300.00 and Aug 26–Sep 22, matching what was already on screen. Templates with only fixed-type items (nothing to back-solve an allowance from) are left as they were — no regression, same blank-until-next-save behavior as before this fix existed.

Second, smaller bug in the same screenshot: the Allocate breakdown's `%` column header was left-aligned while the percentage values under it were right-aligned, so the label visually floated away from its own column. Fixed by right-aligning the `%` header to match.

---

## 36. Budget Progress: Savings gets its own section, Unallocated is actionable, remaining amount + spending pace, tier guidance for Committed

A detailed follow-up review of §31–§35's architecture, all implemented:

1. **Savings was silently missing from Budget Progress.** It's not "spent," so it never belonged in the expense list — but that made it look like a dropped row rather than a deliberate exclusion. `/api/finance/budgets` GET now also returns a `savings` object: `{ cap_amount, funded, tier, period_start, period_end }`, computed the same way the read-only Allocate breakdown derives any percent-based item (`last_allowance_amount × percent/100` — savings never gets a `category_budgets` row, so this is derived, not stored) and funded from `SUM(savings_entries.savings_amount)` (`status='actual'`) across every goal in the cycle's period, since savings entries are always goal-scoped but the plan's allocation isn't. Budget Progress now renders it as its own **SAVINGS** section, separate from the Essential/Committed/Flexible tier groups, with its own accent color and "₱X / ₱Y funded" framing instead of "spent."
2. **Tier guidance for Committed.** The tier model already supported it (`target` → "Committed"), but nothing nudged people toward using it for savings/recurring obligations specifically — the example plan had Savings tagged Essential, which blunts the point of having three tiers for shortfall-advisory purposes. Added a one-line caption under both builder's Tier column ("Essential = can't be trimmed · Committed = savings & recurring obligations · Flexible = first to trim") and an auto-suggestion: selecting "Savings" as a row's category now defaults that row's tier to Committed (still fully overridable). Existing plans/rows are untouched — this only nudges new selections.
3. **"Unassigned this cycle" renamed to "Unallocated," made actionable.** When nonzero, an **Assign** button now appears next to it and opens Allocate's in-place editor for the active plan directly — wired via a signal counter lifted to `SpendingPlan` (`editActiveSignal`) that `SmartAllocator` watches with a `useEffect` and calls its existing `startEdit()` on change, so Budget Progress can trigger Allocate's editor without the two components sharing more state than that one counter.
4. **The override editor now states the plan's original allocation before you save**, not just after (`Plan allocation: ₱1,590 — this cycle only, the plan itself won't change.`) — previously that context only appeared retroactively once a row was already overridden.
5. **Remaining amount, always shown.** Every row now has a second line — `₱1,090 left` — so the gap doesn't have to be mentally computed from `spent / cap`.
6. **Spending pace, shown only where it's informative.** The same line adds `31% used · 12% through cycle` once a category has actual spending against a dated cycle (comparing `%% of cap spent` to `%% of the cycle elapsed`), plus `⚠ Spending faster than plan` when spent-% outpaces elapsed-% by more than 15 points. Skipped entirely for untouched categories (0 spent) — where every row would trivially read "under pace," which is noise, not insight.

---

## 37. Savings now gets a real budget row, so it can be overridden like any other category

§36 gave Savings a distinct, read-only "funded" section but explicitly left it non-adjustable, since it had no `category_budgets` row to attach an override to. Asked to add the override back. Fixed at the source instead of bolting on a parallel mechanism: the `allocation-templates` `save` action no longer skips savings when instantiating a cycle — it now writes a `category_budgets` row for it too, `type='savings'` instead of `'expense'` (the enum already supported this since Phase 1; nothing used it). That single change makes savings a first-class row exactly like any expense category: it has a `budget_id`, a `plan_amount`, and can be `is_override`'d.

- `/api/finance/budgets` GET now reads the savings row straight out of `category_budgets` (`type='savings'`) instead of deriving its cap from `allocation_template_items` on the fly — the row itself now carries the cap, same as every expense category. Only `funded` is still computed fresh each call, from `SUM(savings_entries.savings_amount)` across every goal in the row's period (savings entries are always goal-scoped; the plan's allocation isn't, so this deliberately doesn't filter to one goal).
- `remaining_allowance`'s math changed from summing expense `plan_amount`s to reading `allocation_templates.last_allowance_amount` directly as the true total pie, with `totalAssigned` now summing expense caps **and** the savings cap together. Verified this doesn't change the existing "School" plan's displayed `₱0.00` — 1,590+1,590+530+530+265+530+265(savings) = 5,300, still exactly the last instantiated allowance.
- POST `override` now accepts `category: 'savings'` (previously rejected by an expense-only allowlist) and pools it into the same "can't exceed the cycle's total" check as every expense row, instead of checking expense rows alone.
- `schema-phase4b-backfill-cycle-memory.sql` gained a third statement (re-run, idempotent) that backfills a `type='savings'` row for any plan that already has a real cycle but predates this change — verified against "School": backfilled to exactly ₱265, matching what Budget Progress already showed.
- `SmartAllocator`'s Savings section in `BudgetTracker` reuses the exact same override UI and handlers (`startOverride`/`submitOverride`/`maxFor`/`resetOverride`) as expense rows, via a small adapter (`savingsAsBudgetItem`) that reshapes `SavingsProgress` into a `BudgetItem` — no parallel override implementation to keep in sync.

---

## 38. Hero readability — "Where Spending Went" was hard to read against the tinted gradient background

The hero's right column (`RankedBars` in `bare` mode) sits directly on the hero's soft pink/blue gradient rather than a white card — fine for the bold peso amounts and category labels, but the muted grays tuned for a plain white `subPanel` background (the empty bar track, the `· 63%` text) nearly disappeared into it, and a small-but-real share like Food's 3% rendered as an almost invisible sliver. Fixed three things, `bare` mode only (its only other caller is unaffected):
- The empty bar track now uses a translucent white fill with a thin border (`rgba(255,255,255,0.55)` + `1px solid rgba(120,130,150,0.14)`) instead of a low-opacity gray that blended into the gradient.
- The `· NN%` text darkened from `#9aa4b5` to `#6b7890` for real contrast against the tinted background.
- Every bar's fill now has a 4%-minimum visible width, so a real but small value never renders as functionally invisible — the exact percentage still reads correctly from the label beside it.
- The whole right column gained a light frosted backing (`rgba(255,255,255,0.3)`) so its title and rows read as a lifted surface rather than floating directly on the gradient, without becoming a fully opaque card that would break from the hero's quiet, single-surface feel.

---

## 39. Hero's right half: a real glass panel instead of a hairline divider

§38 fixed the individual bar/text contrast but the right column was still just floating content next to a 1px divider line. Replaced that with an actual glassmorphic panel occupying the full right half — `alignSelf: 'stretch'` so it matches the left column's height edge to edge, `backdrop-filter: blur(12px)` plus a translucent white fill and a 1px light border (an inner highlight, simulating edge refraction) reusing the same glass language as the page's outer `GLASS` card token, just tuned lighter since it now nests inside one. The panel's own edge is the divider — the hairline is gone. `RankedBars`'s `bare` mode no longer draws its own background (that lives on the wrapper now); its track/text contrast tuning from §38 stays, bumped slightly since the backdrop is now a lit glass surface rather than the plain gradient.

---

## 40. Activity Breakdown: quiet days get their own visual treatment

Each Allowance/Expenses/Savings row already handled its own zero individually (a flat gray track, "No expenses" on hover) — but a day where genuinely nothing happened across all three had no distinct signal from a day where, say, only Savings was empty. Added a per-column check in `StatRail` (`emptyBuckets`, true only when allowance, expenses, and savings are all zero for that bucket) passed down to `BarRow` and `SavingsSegmentedRow`. A fully quiet bucket gets a subtle diagonal hatch instead of the flat gray track and a dashed border instead of a plain one, on all three rows for that column — the repeated per-row treatment at the same column position reads as one tinted column, without restructuring the row-major layout into a grid. The Allowance row (topmost) also gets a small "No activity" label above its bar for that column, in place of where a value label would sit if there were one — a single textual cue at the top rather than repeating it on all three rows. Applies identically to Week/Month/All since `emptyBuckets` is derived generically from `breakdown`'s arrays, which are already range-agnostic.

---

## 41. Savings row: dropped the inline "funded," added a bottom caption to match the expense rows

The Savings row read "₱0.00 / ₱265.00 funded" inline, which every other Budget Progress row doesn't do (they're just "spent / cap," with detail underneath). Dropped the trailing word from the value line and added the same bottom caption expense rows already have — except phrased for savings specifically: `₱X left to save` (using `cap_amount - funded`) instead of the generic `₱X left`, since "left" reads as spending room for an expense row but as a savings shortfall here.

---

## 42. Quiet-day treatment: excluded upcoming buckets, extended to individual empty pills

Two refinements to §40's "no activity" styling:

1. **Upcoming buckets were getting flagged too.** A future day/week/month is zero because it hasn't happened yet, not because nothing happened — showing the same "nothing here" hatch for both was misleading. `emptyBuckets` in `StatRail` now also requires `i <= todayIdx`, so Saturday and Sunday on a Friday, for instance, stay in their normal unstyled state instead of reading as quiet days that already passed.
2. **Extended the same hatch/dashed treatment to any individual empty pill**, not just fully-quiet columns — previously a day with an Allowance entry but no Expenses or Savings left those two rows in the plain flat-gray style, with the distinction only reachable via hover tooltip. `BarRow` and `SavingsSegmentedRow` now key the background/border purely off `value === 0 && i <= todayIdx` per pill (`isRowEmpty`), independent of whether the whole column is quiet. The whole-column "No activity" text badge on the Allowance row still depends on the separate `emptyBuckets` (all three rows zero) signal, so a genuinely quiet day still gets its one textual callout — an individually-empty pill next to real activity doesn't repeat it, just the visual hatch.

---

## 43. Current state

All API routes and the dashboard mount cleanly (`tsc --noEmit` clean, routes verified via direct HTTP checks throughout). The conceptual model: **Transactions records money moving** (including receiving an allowance, optionally against a plan) → **Spending Plan configures how a plan splits money and can instantiate a real cycle for it directly** (an allowance amount + explicit date range in the builder, capped by the account's actual remaining balance) → **Budget Progress lists only categories with a real cap this cycle, scoped to the active plan alone** (§31 — no cross-plan bleed, updates the instant you switch plans), with its cycle's dates in the section header (§32), a separate Savings section with its own override (§36, §37) instead of a silent gap, a "left to save" caption matching the expense rows' own wording (§41), remaining-amount and spending-pace context on every row, and an actionable Unallocated indicator (§36) → **Safe-to-Spend reasons about those budgets by tier** (Essential/Committed/Flexible, now with in-app guidance toward using Committed for savings/recurring obligations — §36) and surfaces a plain-language advisory, never an automatic change, when the numbers don't add up. The active plan can be deleted directly from the Allocate row (§30); deleting it always leaves another plan active if one exists (§31). Editing the active plan happens in place in Allocate itself (§33), reliably prefilled from its existing allowance and period even for plans that predate that column existing (§31, §34), and can also be triggered remotely from Budget Progress's Unallocated indicator (§36) — never reopening the separate create-plan panel, which is reserved for genuinely new plans. Every collapsible panel in the module actually collapses (the styled-jsx scoping bug from §23 stays fixed). The hero keeps its established hierarchy, with its right column now a real glass panel spanning the full right half — readable, and divided from the left by its own edge rather than a hairline (§38, §39) — and the Stat Rail remains the sole home for period totals, with its Activity Breakdown now visually distinguishing a genuinely quiet day/week/month from a day where only one metric happened to be zero, and any individually-empty pill from any other — both scoped to today and earlier, never an upcoming bucket (§40, §42). Every section stacks in its own full-width row. One feature remains deliberately out of scope — irregular income types — because it needs schema changes applied to two live databases and touches every query that currently assumes "allowance" is the only inflow; see §7. Feeding spending-pace into Safe-to-Spend's own advisory remains a natural next step the reviewer flagged as "eventually," not requested yet.

---

## 44. Finance revamp (2026-10-18)

The single long dashboard page was replaced by a tabbed `/finance` built on Workboard's design system (its `--wb-*` tokens, `WbOverlay`/`WbPopover`, deferred delete) plus Finance's own tokens and classes in `src/app/finance/finance.css`. Spec: `docs/superpowers/specs/2026-10-18-finance-revamp-design.md` (with Addendum A, polish round 2, and Addendum B, the decisions round). Plan: `docs/superpowers/plans/2026-10-18-finance-revamp.md`.

**What shipped**
- **Pace hero:** the Safe to Spend number counts up on change and shows the per-day amount and a status pill ("Safe through Nov 2" / tight / over budget / "Nothing left to spend"), with the shortfall advisory when needed. Next to it is a Daily pace chart: bars for spending days only, a per-day line, a baseline with a today dot, and "No spending yet this cycle" when the cycle is empty. The header line reads "Monday, Oct 19 · Day N of this cycle · N days to next allowance".
- **Tabs** (Overview / Plan / Activity / Goals) attached to the hero, following the WAI-ARIA tabs pattern, with `?tab=` in the URL and a warning badge on Plan.
- **Logging:** an inline **composer** (amount, top-category chips, More, date choice, Log; Ctrl+K jumps to it). On phones it becomes a fixed **dock** whose measured height pads the page and lifts the toasts. A **Log drawer** (a bottom sheet on phones) handles expense, savings and allowance, with "Log again" tiles from the new `log-context` route, goal chips or a new goal, an allowance-with-plan split, and repeat rules.
- **Feeds:** a day-grouped ledger shared by Overview and Activity. Amounts sit in one right-aligned dark column with − / + / ↗ direction badges. Day headers carry In / Out / Saved chips. Planned rows come from safe-to-spend's `upcoming`.
- **Overview:** the latest 8 entries (footer: "Showing the latest 8 entries · All activity →") and Coming up.
- **Activity:** search, a type filter and Week / Month / All, then a period totals line with the comparison against the last period, recurring-rule chips, a 14-day Upcoming box and paged Show more.
- **Plan:** envelopes per category (tier chip, left/of, a bar in the tier colour, adjust popover with override reason, no side stripe). A **new-cycle banner** ("Your 'School' cycle ended Sep 22 … Start next cycle"), Edit split, and New plan.
- **Goals:** a slim timeline strip (dot per goal, Today line, labels stacked so they never collide). Below it, **ring cards**: a progress ring, saved of target, a Target / Pace / To go / Arrives facts grid, guidance in a tone box, and "＋ Add savings", date and ⋯ actions.
- **Wishlist "Can I afford it?":** verdict pills, Buy now, Save for it, and Remove. Next to it, the **What-if preview**: a slider with Comfortable / Tight / Not recommended zones, the pace chart redrawn live, the true deficit in the copy, and Record it / Save for it instead.
- **Skeletons** for the first load.
- **Sonner toasts with Undo** for every log and delete. Deletes are deferred, so Undo really cancels them.

**Date bugs fixed**
- Six API routes computed "today" as UTC (`toISOString().slice(0, 10)`), which is the previous day in Manila from 00:00 to 08:00. They now use `manilaToday()`.
- The summary and budgets week and month ranges are now built from Manila dates with UTC string arithmetic.
- Weekly recurring rules stepped 6 days instead of 7: the old version did local-midnight maths and then called `toISOString`.
- The client "today" was frozen at mount, so a tab left open past midnight backdated new entries. `useManilaToday` now re-reads the date on focus, on becoming visible, and at Manila midnight, then refreshes the data.
- `toISOString` now appears only in `src/lib/finance/dates.ts`.

**Other fixes**
- The budgets override no longer leaves a stale row behind. It also rejects categories that aren't in the active plan.
- Balance float noise (₱5,270.379999…) is rounded to cents, so a zero balance reads as zero.
- Planned (upcoming) rows can be deleted again, with Undo.
- Duplicate goals on a drawer retry are gone: a goal the drawer just created is reused.
- The wishlist amount now has an upper bound.

**New table and routes:** table `finance_wishlist`; `GET /api/finance/log-context`, `GET /api/finance/feed`, `GET/POST /api/finance/wishlist`, `PATCH/DELETE /api/finance/wishlist/[id]`; additive `pace_start` / `daily_spend` / `upcoming` on `safe-to-spend` and `cycle_used` on `allocation-templates`.

**Retired:** the Activity Breakdown card, Where Spending Went, the inline Transactions form, the old Budget Progress list, `FinanceDashboard.tsx`, and the `legacy/` components (recoverable from snapshot ref `refs/sdd/finance-revamp/t9`).

**Polish round 2 (Addendum A):** empty pace days draw nothing (baseline and today dot added); Overview shows the latest 8 entries; envelopes lost the side stripe; ledger amounts gained direction badges and the In/Out/Saved day chips; goals became ring cards with a slim timeline strip.

**Decisions round (Addendum B):**
- **D1:** "Start next cycle" stays user-initiated. The period it offers rolls forward until it contains today.
- **D2:** Re-saving the running cycle may assign the current balance plus what this cycle has already spent and saved. The editor shows "Allowance (up to ₱X available)", using `cycle_used` so client and server share one number.
- **D3:** What-if shows the true deficit ("Already ₱X over · would be ₱Y over"). Collapsed slider zones hide their labels.
- **D4:** Applying a plan budgets the money and no longer records expense rows. Only the savings share is recorded, as a transfer to the goal. The Aug-25 split rows that were already recorded as expenses were left untouched.

**Final QA (Task 28):**
- Browser QA, then mobile-native, Emil and impeccable passes.
- Contrast: Finance re-points Workboard's subtle/faint text tokens to 4.6:1 and uses a deeper primary pink (white text 4.9:1). The expense and income inks were darkened so they hold 4.5:1 on their own tints.
- Phone targets are 40px. The drawer bottom sheet uses `dvh` and safe-area padding, and `/finance` declares `viewport-fit=cover`.
- Timeline labels are stacked from measured pixel widths, which fixed the collisions at 641–820px.

**Open follow-ups**
- The header still says "Day N of this cycle" from `pace_start` even when the plan's cycle has ended. It should say something like "No active cycle".
- Pace-bar amounts can't be read on touch: the tooltips need hover or keyboard focus. Tap-to-reveal would fix it.
- Rings under ~4% render as a dot.
- On phones the direction badges aren't column-aligned (accepted trade-off).
- The first and last timeline ticks overhang the strip slightly.
- Long envelope names truncate beside the tier chip at 1440 ("Transporta…").
- The What-if category select is wider than its label.
- No `theme-color` meta tag; the animated gradient has no single top colour.
- Smaller deferred items:
  - Upcoming ignores the Activity type filter and search.
  - Failed loads have no error-and-retry state.
  - Show more stays clickable during a keep-place refetch.
  - The ConfirmPopover closes on Esc while busy.
  - Up to 31 pace-bar tab stops; a roving tabindex would be kinder.
  - Monthly recurrence drifts after the 28th (Jan 31 → Feb 28 → Mar 28).
  - Budgets GET can show a stale savings row if a plan drops savings in place.
- Safe-area insets, tap delay, input zoom and sticky hover are fixed in code. They still need checking on a real phone.
