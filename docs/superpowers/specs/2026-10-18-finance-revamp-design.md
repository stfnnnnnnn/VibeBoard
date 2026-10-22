# Finance Revamp: Design Spec

- **Date:** 2026-10-18
- **Status:** Approved (2026-10-18)
- **Builds on:** `financetracker-log.md` (full history of the Next.js finance module and every past design correction), `docs/superpowers/specs/2026-10-06-workboard-revamp-design.md` (token system, primitives and motion rules this revamp reuses)
- **Canonical mockup:** `.superpowers/brainstorm/1588-1792270565/content/finance-unified-v5.html`, a clickable prototype of every approved choice with consistent sample data. When this spec and the mockup disagree on a visual detail, the mockup wins; when they disagree on behaviour or data, this spec wins.
- **Exploration mockups (history):** `72-1792214193` (`finance-revamp-v1.html`, `section1-alternatives-v2.html`), `598-1792229752` (`finance-sections-v3.html`), `1588-1792270565` (`quicklog-whatif-v4.html`)

## 1. Goal

Make the Finance section a notch better in looks, everyday speed and clarity, without changing what it is. Logging money should take seconds, the page should answer "am I on pace?" at a glance, and every section should share one visual system with the just-revamped Workboard.

**Direction: Evolve.** Keep the glass panels, the pink/blue VibeBoard palette, the dashed "stitch" hero and the existing money logic. Add one token system, a 12px type floor, proper money formatting, quieter chrome, consistent states and purposeful motion.

**References:** Copilot Money (design polish), Monarch (calm dashboard), YNAB/Goodbudget (envelopes), SafeToSpend-style apps (the daily number plus fast logging), Raycast/Things (keyboard flow, day-grouped lists).

### 1.1 Decisions made in brainstorming

| Area | Choice | Mockup |
|---|---|---|
| Direction | Evolve | — |
| Page organisation | Hero on top, then tabs: Overview / Plan / Activity / Goals | v2 option B |
| Hero | **Pace**: hero left side unchanged; right side = daily spending bars against the ₱/day line; tabs attached to the bottom of the hero | v2 B, v3 §1 |
| Overview | Day-grouped **Recent** feed | v2 option C feed, v3 §1 |
| Quick log | **Both D and E**: an always-open composer *and* a side drawer with "Log again" tiles | v4 D, E |
| Plan | **Envelopes** (3B), with the new-cycle banner | v3 §3 B |
| Goals | **Timeline** (4C) with detail notes underneath | v3 §4 C |
| Activity | One day-grouped feed; the inline Transactions form is removed and its options move into the Log drawer | v3 §5 |
| What if | **B** drag-to-preview on the Pace chart **and D** a wishlist with live verdicts | v4 B, D |
| Extra features | Toasts + Undo, new-cycle prompt, skeleton loading | — |

### 1.2 Constraints carried over from `financetracker-log.md`

These were explicit user corrections in earlier rounds. Do not reopen them:

- **No 2-column page layout.** Sections stack in a single column. Grids of *items* (envelopes, goal notes) are fine.
- **The hero's left side** (icon, "Safe to Spend" eyebrow, big number, per-day line, "After ₱X upcoming…" line, status pill, shortfall advisory) keeps its content and order.
- **No redundant numbers.** A figure shown in the hero is not repeated as a separate tile elsewhere on the same screen.
- **Plan defines the categories.** Budget progress can only show the active plan's categories (§26 of the log). Envelopes inherit this rule.
- **Collapsible/shared CSS must be global**, not styled-jsx scoped to one component (§23 of the log).

### 1.3 Out of scope

- Dark mode
- Irregular income types (part-time, freelance, …)
- Notes on transactions (no column exists; would need a schema change)
- Editing recurring rules (still create and delete only)
- Natural-language parsing in the composer (typed text is never parsed)
- Chart libraries (all visuals are SVG/CSS)
- The dead PHP files in `financetracker/`
- Changing how safe-to-spend, budgets or plans are *calculated*, except the timezone fix in §4.4

**One schema change is in scope:** the `finance_wishlist` table for What-if D (§10.2). Everything else uses existing tables.

## 2. Problems this fixes (audit, 2026-10-17)

| Finding | Count |
|---|---|
| Lines in `FinanceDashboard.tsx` | 1,903 (one client component) |
| Distinct font sizes | 19 |
| Text usages under 12px | 49 (smallest 0.56rem ≈ 9px) |
| Hard-coded hex colours | 199 (50 unique) |
| Inline `style={{…}}` objects | 274 |
| Native `alert()` / `confirm()` | 6 |
| Transitions on `width` with plain `ease` | 6 |
| Loading state | one spinner for the whole page |
| `title=` as the only explanation | 10 |

Other problems found in the live page:

1. **Money formatting:** `₱5270.38`, no thousands separators.
2. **Logging is buried:** the Transactions form is the 4th card, ~2 screens down on a phone (page is ~3,500px tall at 390px).
3. **Duplicate category list:** Allocate table and Budget Progress list the same 7 categories one above the other.
4. **Stale cycle:** Budget Progress shows "Aug 26 – Sep 22 … 100% through cycle" with no prompt to start a new one.
5. **Empty week:** a wall of hatched "No activity" pills; at 390px those labels overlap.
6. **Tier colour:** "Essential" is drawn in the same pink used for errors.
7. **Goal bug:** "New Freezer" has a target date in the past (Aug 25, 2026), so pace maths shows "162W BEHIND" and "₱9,500/wk". Nothing tells the user the date has passed.
8. **Clipping:** Budget Progress override icons are cut off at the right edge at 390px.
9. **Timezone:** six finance API routes compute "today" with `new Date().toISOString()` (UTC). Before 08:00 Manila time, "today" is yesterday. (`todayInManilaAsUtcDate()` in `src/lib/workboard/aggregate.ts` already exists for exactly this.)

## 3. Skill roles

Per `.agents/skills/design-guidelines/SKILL.md` (SCAN → DIRECT → SYSTEMIZE → BUILD → RENDER → CRITIQUE → POLISH) and the split the Workboard revamp used. Each skill does only its own job.

| Skill | Role in this work |
|---|---|
| frontend-design | Builds each section from the approved mockups |
| ui-ux-pro-max | UX rulebook: touch targets, contrast, form and feedback rules. **Its generated palettes and fonts are not used.** |
| dataviz | Pace bars, What-if B preview, envelope bars, goal timeline |
| emil-design-eng | Interaction judgement during the build; Emil-style polish review at the end |
| improve-animations, then animate | Motion audit, then motion implementation (Phase 7) |
| ask-sonner | Toast wiring questions (Sonner is already used via `WbToaster`) |
| break-ui | Stress test: ₱1,000,000 amounts, 0 / 1 / 200 transactions, 12 goals, long goal names, no active plan, no allowance ever |
| mobile-native | Docked composer, bottom sheet, safe-area insets, input zoom |
| impeccable | Final audit and polish only (Phase 7) |

Not used: gpt-taste, minimalist-ui, industrial-brutalist-ui, high-end-visual-design, design-taste-frontend (they would push away from "Evolve").

## 4. Foundation (Phase 0)

### 4.1 Reuse Workboard's system (architecture approach A)

`src/app/finance/page.tsx` imports `../workboard/workboard.css` (the `--wb-*` tokens, shared state classes and reduced-motion block) plus a new `src/app/finance/finance.css`. Finance components use the existing primitives from `src/components/workboard/ui/` directly: `WbOverlay` (drawer and bottom sheet), `WbPopover`, `WbSegmented`, `WbSkeleton`, `WbToaster` (`toastUndo`, `toastError`, `toastInfo`). No primitives are copied. Workboard files are not modified.

Promoting these to a shared `vb-*` layer is a possible later follow-up, not part of this work.

### 4.2 `src/app/finance/finance.css`

Finance-only tokens and global classes (global so they apply across sibling components, per §1.2):

- **Money colours** (each with a `-bg` tint):
  - `--fin-income #74bcd9` / ink `#256f92`
  - `--fin-expense #e0679d` / ink `#b0396d`
  - `--fin-savings #9b6dd6` / ink `#6b46b3` (replaces the separate green `#4a9c7e` savings colour, so savings is purple everywhere)
- **Tiers:** `--fin-tier-essential #2a7fa8`, `--fin-tier-committed #9b6dd6`, `--fin-tier-flexible #64748b`, each with a `-bg` tint. Essential is no longer pink.
- **Verdicts:** comfortable = `--wb-success`, tight = `--wb-warn`, not recommended = `--wb-danger`.
- Category hue families stay as they are (`EXPENSE_HUES`, `SAVINGS_HUES`), moved into `src/lib/finance/ui/colors.ts`.
- Global classes: `.fin-num` (tabular numerals), `.fin-amount-in/out/save`, `.fin-envelope`, `.fin-feed-day`, `.fin-composer`. Collapsing panels reuse Workboard's existing `.wb-collapse` (it replaces the old `.fin-shell`).

Type, spacing, radii, shadows and motion use `--wb-*` values. The 12px minimum applies, with Workboard's single exception (11px uppercase labels at weight 800, letter-spacing ≥ .03em).

### 4.3 Pool-free helpers: `src/lib/finance/`

Client-safe modules (no `db.ts` import), each with one job:

| File | Responsibility |
|---|---|
| `format.ts` | `formatPeso(n)` → `₱5,270.38` (Intl `en-PH`); `formatPesoCompact(n)` → `₱1.2k`; `splitPeso(n)` → `{ whole, cents }` for the hero's lighter cents |
| `dates.ts` | `manilaToday()` → `YYYY-MM-DD` in Asia/Manila; `addDays`, `daysBetween`, `formatDay` ("Today", "Yesterday", "Thu, Oct 15") |
| `status.ts` | `safeToSpendStatus`, `shortfallSuggestion` (moved out of the component unchanged) |
| `verdict.ts` | `previewSpend(snapshot, amount)` → `{ after_balance, after_safe, after_per_day, bills_covered }`, where `snapshot` is the fields safe-to-spend already returns (`current_balance`, `upcoming_required`, `upcoming_savings`, `days_until_next_allowance`) and the maths mirrors the what-if route (10% buffer, 14-day fallback). `verdictFor(before, after)` → `'not_recommended'` if `after_balance < 0` or `after_safe <= 0`; `'tight'` if `after_per_day < 0.5 × before_per_day`; otherwise `'comfortable'`. These are the same three conditions as today's what-if warnings. `bills_covered` = `after_balance ≥ upcoming_required + upcoming_savings`. |
| `goals.ts` | `goalState(goal, today)` → `'no_date' \| 'date_passed' \| 'on_pace' \| 'behind' \| 'done'` plus the guidance sentence |
| `categories.ts` | `EXPENSE_CATEGORIES`, `categoryLabel`, `categoryEmoji` |
| `ui/colors.ts` | `expenseColor`, `savingsColor`, `tierColor` |

### 4.4 Server-side "today" fix

Every finance route that computes today with `toISOString().slice(0, 10)` switches to `manilaToday()` (`safe-to-spend`, `what-if`, `transactions`, `apply-allocation`, `recurring-rules`, `summary`, `budgets` period helpers). The `computeSafe` logic duplicated between `safe-to-spend` and `what-if` moves into one server module, `src/lib/finance/safeToSpendServer.ts`, which both routes and the new wishlist route call. Results must not change except for the date correction.

### 4.5 File split

`FinanceDashboard.tsx` (1,903 lines) is split under `src/components/finance/`. Behaviour stays identical in Phase 0; visuals change only in later phases.

| Path | Holds |
|---|---|
| `FinanceShell.tsx` | Data loading (the existing `load*` callbacks), tab state, Ctrl+K, toaster |
| `hero/PaceHero.tsx` | Hero left side + pace chart + attached tab bar |
| `log/LogComposer.tsx` | Composer (§7.1) |
| `log/LogDrawer.tsx` | Drawer (§7.2) |
| `tabs/OverviewTab.tsx` | §6 |
| `tabs/PlanTab.tsx`, `plan/Envelope.tsx`, `plan/PlanEditor.tsx`, `plan/NewCycleBanner.tsx` | §8 |
| `tabs/ActivityTab.tsx`, `feed/DayFeed.tsx`, `feed/RecurringChips.tsx` | §9 |
| `tabs/GoalsTab.tsx`, `goals/GoalTimeline.tsx`, `goals/GoalNotes.tsx`, `whatif/WhatIfPreview.tsx`, `whatif/Wishlist.tsx` | §10 |
| `ui/PesoInput.tsx`, `ui/Money.tsx`, `ui/ConfirmPopover.tsx` | Shared pieces |
| `types.ts` | The response interfaces currently at the top of the file |

### 4.6 Style gate

`scripts/wb-style-gate.mjs` gains Finance support: `finance.css` and `src/lib/finance/ui/colors.ts` join the hex allow-list, and it is run on every Finance file a task touches. It checks for: no new hex literals elsewhere, no font sizes under 12px (except the micro-label rule), no `transition` with plain `ease`, and no transitions on width/height/top/left (except `.wb-collapse`).

## 5. Page shell and Pace hero (Phase 1)

Mockup: v3 §1.

### 5.1 Header

- Title "{firstName}'s Finances" (DM Sans 24px 800, no gradient text), with a today line beneath: "Saturday, Oct 17 · Day 3 of this cycle · 14 days to next allowance". "Day N" counts from `pace_start` (§5.3); the second part appears only when `days_until_next_allowance` is known. With neither, the line is just the date.
- Right side: **Dashboard** (ghost button) and **+ Log** (pink primary, with a `Ctrl K` hint chip). + Log opens the drawer (§7.2).

### 5.2 Hero left side

Content and order unchanged (§1.2). Changes are visual only:

- Big number via `splitPeso`: `₱5,270` at 56px plus `.38` at 28px in a lighter tint of the same blue.
- When the number changes after a log or undo, it counts from the old value to the new one over 240ms. No count-up on first load. No animation under reduced motion.
- Status pill and shortfall advisory use the semantic tokens.

### 5.3 Pace chart (hero right side)

A bar per day across the **pace window**, against a dashed line at the current `per_day` value labelled "₱376/day".

- **Pace window:**
  - Start: the date of the most recent *actual* allowance on or before today. If there is none, or it is more than 31 days ago, start = today − 6.
  - End: `horizon_end` from safe-to-spend.
  - Capped at 31 days. If longer, the window shows the 31 days ending at `horizon_end`.
- **Past days and today:** solid expense bars (`--fin-expense`). Bars above the line use the darker expense hue. Today's bar gets a 2px `--wb-blue-strong` ring and the "Today" axis label sits under it.
- **Future days:** ghosted dashed boxes.
- **Header line:** "Daily pace" label, plus "Avg ₱286/day · ₱90 under" (or "₱40 over" in warn colour). The average covers past days in the window, including today.
- **Axis:** start date, "Today", and roughly 2 more dates. Labels never overlap; on narrow widths only start, Today and end show.
- **Hover/focus:** each bar has an accessible label ("Fri, Oct 16: ₱220.00 spent") and a styled tooltip.
- **Data:** the `safe-to-spend` response gains additive fields `pace_start` (date) and `daily_spend` (`{ date, amount }[]` of actual expenses per day from `pace_start` to today). Existing fields are unchanged.
- **Empty state:** if there are no expenses in the window, the bars area shows "No spending yet this cycle" over the ghosted days.

### 5.4 Tabs

- A tab bar attached to the bottom edge of the hero (one rounded container; the hero's dashed inset stops at the tab bar). Tabs: **Overview**, **Plan**, **Activity**, **Goals**. Active tab: text colour plus a 2.5px pink underline.
- **Plan** shows a small warn badge ("1") when the new-cycle prompt (§8.3) is active.
- The active tab lives in the URL (`?tab=plan`), so Back, reload and links work. Default: Overview.
- Switching tabs crossfades content (opacity, 120ms). No slide.
- Keyboard: arrow keys move between tabs (WAI-ARIA tabs pattern).
- On phones the tab bar stays attached to the hero and scrolls horizontally inside itself if needed. The page never scrolls sideways.

### 5.5 Skeletons

`src/app/finance/loading.tsx` plus in-component skeletons (`WbSkeleton`) shaped like the hero, the pace bars, feed rows, envelopes and the timeline. The full-page spinner is removed. Each section shows its own skeleton until its own data arrives (the existing loads are independent).

## 6. Overview tab (Phase 3)

Mockup: v3 §1.

1. **Composer** (§7.1), directly under the tab bar. On phones it is not repeated inline; the docked composer covers it.
2. **Recent:** the day-grouped feed (§9.2) limited to the last 3 days that have activity, with an "All activity →" link to the Activity tab.
3. **Coming up:** the next 3 upcoming items (planned and recurring), compact rows, with a link to Activity.

Nothing else. "Where spending went" (today's hero right side) and the Activity Breakdown card are retired: the pace chart replaces the first, and the Activity tab replaces the second. Range switching (week/month/all) moves to the Activity tab's period selector.

**Empty state** (no transactions ever): one sentence, "Log your first expense to see your pace.", and the composer.

## 7. Logging (Phase 2)

Two surfaces, used together:

| | Composer (D) | Drawer (E) |
|---|---|---|
| For | The fast, everyday expense | Everything else: allowance + plan, savings to a goal, repeating, other dates, "Log again" |
| Where | Overview and Activity tabs (desktop); docked at the bottom on phones, all tabs | Opens from "+ Log", the composer's "⋯", a goal's "Add", or Ctrl+K when no composer is on screen |

### 7.1 Composer (`LogComposer`)

Mockup: v4 D.

- **Layout (desktop):** one white row: ₱ amount field → divider → category chips (the 4 most-used categories, then a "▾" for all) → divider → date chip ("Today ▾") → "⋯" → **Log** (`↵`). Under it, a muted line: "Leaves ₱5,150.38 safe · ₱367.88/day", computed live with `previewSpend`.
- **Type:** always Expense. Savings and allowance go through the drawer.
- **Defaults:** category = the last one used (or the top one); date = today.
- **Keys:** Enter logs. Tab moves amount → chips → date. After a successful log the amount clears and keeps focus for the next entry. Esc clears the amount.
- **Ctrl+K** focuses the composer's amount field when the composer is on screen.
- **"⋯"** opens the drawer with the composer's amount and category carried over.
- **Phones:** docked at the bottom on every tab (respecting `env(safe-area-inset-bottom)`). Chips sit in a row above the input; the input uses `inputmode="decimal"` at 16px to avoid zoom. Tapping "⋯" opens the drawer as a bottom sheet.
- **Validation:** amount > 0, otherwise an inline message under the field; Log stays disabled while the amount is empty.
- **Data:** `POST /api/finance/transactions` (unchanged).

### 7.2 Drawer (`LogDrawer`)

Mockup: v4 E.

- **Container:** `WbOverlay` `drawer` variant: from the right at ≥ 768px (400px wide), a bottom sheet below. The page stays visible behind a light scrim.
- **Log again:** up to 4 tiles at the top, each a repeat of a past entry (same type + category/goal + amount). A tile qualifies if that exact combination was logged at least twice in the last 60 days; most recent first. One tap logs it dated today and shows a toast with Undo. If none qualify, the section is hidden.
- **Form** ("or something new"):
  - **Type:** Expense / Savings / Allowance (`WbSegmented`).
  - **Amount** and **Category** (expense), **Goal** (savings: existing goal, or "+ New goal" with name and target, the existing flow), or **Spending plan** (allowance: "Split with {active plan}" / "Don't split", the existing apply-allocation flow from §20 of the log).
  - **When:** Today / Yesterday / Pick… / ↻ Repeat. Repeat expands Frequency + Starts + Ends (optional) and posts to `/api/finance/recurring-rules`, as the current form's Recurring option does. Repeat is hidden for allowance with a plan selected (same rule as today).
  - Future dates go to Upcoming automatically (existing server rule); a hint says so.
  - The live impact line ("Leaves ₱X safe") shows for expense and savings.
- **Submit:** "Log ₱120.00", pending state while saving, Ctrl+Enter submits. Errors show inline; network failure shows a toast with Retry.
- **Data:** `GET /api/finance/log-context` (new, read-only) returns `{ top_categories: string[], repeats: { type, category, goal_id, goal_name, amount }[] }` computed from the last 60 days. Writes use the existing transactions, recurring-rules, goals and apply-allocation routes.

### 7.3 Toasts and Undo

Replaces all 6 `alert()` / `confirm()` calls.

- **Log (composer, tile or drawer):** toast "Logged ₱120.00 · Food · Undo" for 5s. Undo calls the existing `DELETE /api/finance/transactions` for the created row. The hero number counts back.
- **Delete a transaction** (feed row action): the row hides immediately; toast "Deleted · Undo" for 5s; the DELETE is sent only after the toast expires, or on `pagehide` via `fetch(…, { keepalive: true })`. This reuses the pattern of Workboard's `src/lib/workboard/ui/deferredDelete.ts` (imported, not copied, if its signature fits; otherwise a small Finance equivalent).
- **Delete a plan, goal or recurring rule:** these cascade server-side and can't be undone cleanly, so they use `ConfirmPopover`, an inline `WbPopover` anchored to the button: "Delete 'School'? Its budgets go too." with **Delete** and **Cancel**.
- **Errors:** toast with Retry. Field validation stays inline and never toasts.

## 8. Plan tab: envelopes (Phase 4)

Mockup: v3 §3 option B.

### 8.1 Header row

"Spending plan", an active-plan selector (the existing `set_default` dropdown, styled as a purple pill), a muted line "₱5,300 · Aug 26 – Sep 22 · ₱0.00 unallocated", then **Edit split** and **+ New plan** on the right. If unallocated money exists, the unallocated chip becomes an **Assign** button that opens Edit split (existing `editActiveSignal` behaviour).

### 8.2 Envelopes

One card per category in the active plan, in a wrapping grid (`repeat(auto-fill, minmax(220px, 1fr))`: 3–4 per row on desktop, 1 per row on phones). Ordered by tier (Essential, Committed, Flexible), then by allocation size.

Each envelope:

- A 4px left stripe in the tier colour, category emoji + name, tier chip on the right.
- **₱ left** in large type (22px 800). Savings reads "₱265 to save".
- "left of ₱1,590 · 31% used" in muted text.
- A bar: spent ÷ cap, tier-coloured, with a thin vertical tick at the cycle's elapsed fraction. If spent % exceeds elapsed % by more than 15 points, the envelope shows "Spending faster than plan" in warn colour (existing rule, §36 of the log).
- **Over cap:** ₱ left shows as "₱120 over" in danger colour and the bar is full in danger colour.
- **Adjusted** (`is_override`): a small "Adjusted" chip; the plan's original amount shows in the adjust popover.
- **Click/Enter:** opens the adjust popover (`WbPopover`): amount, optional reason, "Plan allocation: ₱1,590, this cycle only", **Save**, and **Reset to plan** when overridden. Same `override` / `reset` actions and the same "can't exceed the cycle's total" guard as today.
- A last dashed tile, "+ Add category", opens Edit split.

**No cap yet** (a plan whose cycle was never given an allowance): instead of envelopes, one message, "This plan hasn't been given an allowance yet.", plus a **Start a cycle** button that opens Edit split with the allowance field focused.

**No plan at all:** "Make a plan to split each allowance automatically." plus **+ New plan**.

### 8.3 New-cycle banner

Shown at the top of the Plan tab when the active plan's `last_period_end` is before today:

- Copy: "Your 'School' cycle ended Sep 22." and "Start the next one with the same split: ₱5,300.00 · Sep 23 – Oct 20 (28 days)."
- The new period starts the day after `last_period_end` and has the same length; the amount is `last_allowance_amount`.
- **Start next cycle** calls the existing `allocation-templates` `save` action with that allowance and period (no API change). **Adjust…** opens Edit split prefilled with those values.
- The Plan tab badge (§5.4) shows while the banner is active.

### 8.4 Edit split and New plan

The existing builder and in-place editor keep their behaviour (rows of category / tier / % or fixed, allowance, period, Save / Cancel / Delete). Visual changes only: tokens, labels above fields, inline validation, `ConfirmPopover` for Delete, and the tier caption ("Essential = can't be trimmed · Committed = savings & recurring · Flexible = first to trim"). Edit split opens in place of the envelope grid (collapse via `.wb-collapse`); the % column lives here, not on the envelopes.

## 9. Activity tab (Phase 5)

Mockup: v3 §5.

### 9.1 Toolbar

Search (client-side substring match on category/goal label and amount), a type filter (`WbSegmented`: All / Expenses / Allowance / Savings) and a period selector (Week / Month / All, matching the ranges the summary route supports for the totals line). Only the tab lives in the URL; filters reset when the page reloads.

Under the toolbar, one **period totals** line keeps the numbers the retired Activity Breakdown card used to show: "This month: +₱5,300.00 in · −₱2,140.00 spent · ₱300.00 saved (across 2 goals) · ▲ 12% spending vs last month". It uses the summary route's existing `totals` / `previous_totals` and the same comparison wording rules as today ("≈ same as last month", "No data last month", "No prior period to compare" for All).

### 9.2 Day feed (`DayFeed`)

Shared with Overview.

- **Day headers:** "Today" / "Yesterday" / "Thu, Oct 15", with the day's net on the right ("−₱220.00 · +₱150 saved"; allowance days show "+₱5,300.00" in income colour).
- **Rows:** a 32px icon tile (category emoji on an expense tint, ◎ for savings, ↓ for allowance), label, a muted sub-line (goal name, "recurring", "plan applied"), and the signed amount in its money colour.
- **Row action:** on hover (fine pointers) or via a "⋯" button (always visible on touch), **Delete** with the deferred-delete toast (§7.3).
- **Upcoming:** a dashed box at the top of the feed with planned and recurring items for the next 14 days, rows at 75% opacity, and a total.
- **Recurring:** active rules as chips above the feed ("↻ Transport ₱150 · weekly ×"); × uses `ConfirmPopover` because it also removes future planned rows.
- **Paging:** the most recent 50 rows, then a "Show more" button.
- **Empty states:** "No transactions yet." (no data), or "Nothing matches these filters. Clear filters" (filtered).
- **Data:** a new read-only route, `GET /api/finance/feed?type=&period=&limit=50&offset=0`, returns `{ items: FeedItem[], has_more }` (actual rows only, newest first). The summary route's `recent` list is range-scoped and capped at 15, so it is not reused.

## 10. Goals tab: timeline, What-if preview, wishlist (Phase 6)

### 10.1 Goal timeline (4C)

Mockup: v3 §4 C.

- A horizontal time axis with month ticks, a pink **Today** marker, and one marker per goal at its `target_date`, or at `projected_date` (labelled "projected") when it has none. The axis range covers every marker plus one month either side.
- **Marker:** a small card "New Freezer · 5%" plus a stem and a dot in the goal's state colour (`goalState`): date passed = warn, behind = warn, on pace = success, no date = purple, done = success with ✓.
- **Collision:** markers closer than their card width stack upward in up to 3 rows. With more than 6 goals, or below 640px wide, the timeline switches to a vertical list ordered by date (same markers, top to bottom), so it never gets cramped.
- **Goal notes** under the timeline: one note per goal, in a wrapping grid. Each note shows saved of target, a progress bar, and one guidance sentence from `goalState`:
  - date passed: "The target date (Aug 25, 2026) has passed. ₱9,500 to go. **Pick a new date**"
  - behind: "Save ₱150/wk to hit Dec 20. You're averaging ₱61/wk."
  - no date: "At ₱66/wk you'll reach it around Jun 2027. **Set a date**"
  - on pace / done: short confirmations.
  - Plus **＋ Add** (opens the drawer set to Savings and this goal) and "⋯" (change date via an inline date popover, delete via `ConfirmPopover`).
- **+ New goal** (header button): inline form with name, target and optional date (existing goals route).
- The "162W BEHIND" style badge is removed everywhere.

### 10.2 Wishlist: "Can I afford it?" (What-if D)

Mockup: v4 D.

- A card on the Goals tab under the timeline. Rows: emoji, name, "₱2,500 · Leisure · added Oct 12", a verdict pill, and two actions.
- **Verdict pill** (live, recomputed from the current safe-to-spend snapshot with `previewSpend` + `verdictFor`): "Comfortable", "Tight: ₱198/day after", or "Not this cycle".
- **Actions:**
  - **Buy now:** logs the expense dated today via the transactions route, marks the wish `bought`, toast with Undo (undo deletes the expense and reopens the wish). Disabled when the verdict is "Not this cycle"; still possible via the row's "⋯" with a confirm.
  - **Save for it:** creates a savings goal (name, target = amount) via the goals route, marks the wish `goal` with its `goal_id`, and the new goal appears on the timeline. Primary-styled when the verdict is "Not this cycle".
  - "⋯": **Check in What if** (loads it into §10.3), **Remove**.
- **Add row:** "What do you want to buy?", amount, category (default Leisure), **Check**. Adding shows the verdict immediately.
- Bought and goal items hide from the list; a "Show 3 done" toggle reveals them.
- **Empty state:** "Thinking about buying something? Add it here to see if it fits."

**Schema** (`ensureFinanceWishlistSchema()` in `src/lib/migrate.ts`, idempotent like the others; also written as `financetracker/schema-phase5-wishlist.sql` for the record):

```sql
CREATE TABLE IF NOT EXISTS finance_wishlist (
  wish_id     INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  name        VARCHAR(120) NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  category    VARCHAR(40) NOT NULL DEFAULT 'leisure',
  status      ENUM('open','bought','goal') NOT NULL DEFAULT 'open',
  goal_id     INT NULL,
  expense_id  INT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (user_id, status)
);
```

`goal_id` and `expense_id` are plain references, not FKs, so deleting a goal or expense elsewhere never blocks; the wishlist treats a missing reference as "done". Local DB only, like Phases 2–4 (the PHP pages are dead code).

**API:** `src/app/api/finance/wishlist/route.ts` (GET list, POST create) and `src/app/api/finance/wishlist/[id]/route.ts` (PATCH `action: 'buy' | 'save' | 'reopen'`, DELETE). Verdicts are computed client-side from the snapshot already loaded, so the list needs no extra request when money changes.

### 10.3 What-if preview (What-if B)

Mockup: v4 B.

- A card at the bottom of the Goals tab: "What if I spend…", a category chip, the amount in large pink type, and a slider (₱0 to `current_balance`, step ₱50; the amount is also typeable).
- **Slider track** shows three zones from `verdictFor`: comfortable / tight / not recommended, computed for the current snapshot.
- **Preview chart:** a copy of the hero's pace chart in which today's bar includes the hypothetical amount as a striped segment, the old ₱/day line is struck through, and a new pink dashed line shows the after-value ("₱198/day after").
- **Verdict row:** pill, "Safe to spend ₱5,270 → ₱2,770 · bills still covered ✓", plus **Record it** (logs it, toast with Undo) and **Save for it instead →** (adds it to the wishlist).
- All calculation is client-side (`previewSpend`), so dragging redraws instantly with no requests. The existing `/api/finance/what-if` route stays as the server-side source of truth and is used by Record it to double-check before writing.
- Reduced motion: the chart updates without transitions.
- If `current_balance ≤ 0`, the slider is replaced by "Nothing left to spend until your next allowance." and the typed amount still shows the verdict.

## 11. Motion (Phase 7, with rules binding from Phase 1)

Same rules as the Workboard spec §4.3, plus:

1. Animate only `transform` and `opacity`. Bars grow with `scaleX`/`scaleY` from their base (`transform-origin`), never by animating `width`/`height`. Exception: `.wb-collapse` (grid-template-rows, 180ms, off under reduced motion).
2. Easing `var(--wb-ease)` / `var(--wb-ease-in-out)`; durations 120 / 180 / 240ms; 300ms maximum.
3. **Bars:** on first reveal and on data change, 240ms. On first load they grow once; afterwards only bars whose value changed animate.
4. **Hero number:** count from old to new over 240ms, on change only.
5. **Drawer:** translateX 24px → 0 plus opacity, 240ms in, 180ms out; bottom sheet translateY. Opened via Ctrl+K: no animation.
6. **Logged row:** the new feed row fades in with a brief pink tint that fades over 600ms (opacity only).
7. **Press:** `.wb-pressable` (scale 0.97) on buttons, chips and tiles. Hover effects only under `(hover: hover) and (pointer: fine)`.
8. **Reduced motion:** no movement; crossfades ≤ 120ms allowed.

## 12. Accessibility and responsiveness

- Contrast ≥ 4.5:1 for text and ≥ 3:1 for UI glyphs against the glass proxy `#eae8f4`; the tier and money ink colours are chosen to meet this.
- Touch targets ≥ 24px on desktop, ≥ 40px on phones (chips, tiles, envelope buttons, feed row actions, slider knob).
- The tabs follow the WAI-ARIA tabs pattern. The drawer traps focus and returns it to its opener. Every interactive element shows `:focus-visible`.
- Charts have text equivalents: each pace bar has an `aria-label`; the timeline has a visually hidden ordered list of goals with dates.
- Money amounts never wrap mid-number (`white-space: nowrap`).
- Breakpoints checked: 390px, 820px, 1440px. No horizontal page scroll; 16px side gutter on phones; the docked composer never covers the last feed row (bottom padding equals its height).

## 13. Phases

Each phase leaves Finance fully working and ends with screenshots for user approval.

| # | Phase | Covers |
|---|---|---|
| 0 | Foundation | §4: tokens, helpers, timezone fix, shared safe-to-spend module, file split, style gate. No visual change. |
| 1 | Shell, hero and tabs | §5, including the `daily_spend` / `pace_start` additions and skeletons |
| 2 | Logging | §7: composer, drawer, `log-context` route, toasts + Undo, deferred delete |
| 3 | Overview | §6 |
| 4 | Plan | §8 |
| 5 | Activity | §9, including the `feed` route |
| 6 | Goals | §10: timeline, wishlist (schema + routes), What-if preview |
| 7 | Motion and QA | improve-animations audit → animate; break-ui; mobile-native pass; Emil review; impeccable audit; §11 and §12 confirmed everywhere |

## 14. Verification (per phase)

1. `npx tsc --noEmit` passes.
2. `node scripts/wb-style-gate.mjs <touched finance files>` passes.
3. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/finance` returns 307 when unauthenticated.
4. **API checks** for any changed route: run against the local DB and compare before/after responses for the same user. Safe-to-spend values must be identical apart from the date fix.
5. **Playwright:** the user is already logged in in the Playwright browser (no credentials pass through Claude). Screenshots at 390, 820 and 1440px; console free of errors; the phase's key interactions exercised (log + Undo, Log again tile, drawer allowance-with-plan, start next cycle, envelope adjust, feed delete + Undo, wishlist Buy now / Save for it, What-if drag).
6. The user reviews the screenshots and approves before the next phase.

## 15. Constraints

- **No commits unless the user explicitly asks.** When asked, run `git status` first and stage only files this revamp touched; the repo holds long-lived staged and unstaged work unrelated to this (see memory: Git Staged Content Hazard).
- Client components import only pool-free modules at runtime (`src/lib/finance/*` except `safeToSpendServer.ts`). Anything touching `db.ts` is `import type` only from client code.
- styled-jsx rules apply only to the component that declares them; shared Finance rules go in `finance.css`. No backticks inside styled-jsx template literals.
- Anything `position: fixed` renders through a portal (`WbOverlay` / `WbPopover`), since the glass panels use `backdrop-filter`.
- No new dependencies (Sonner is already installed).
- New API surface is limited to: `GET /api/finance/log-context`, the wishlist routes, `GET /api/finance/feed`, additive fields on `safe-to-spend`. Any other API change needs approval first.

## Addendum A — Polish round 2 (2026-10-19, user-approved from mockup `finance-polish-v6.html`)

These supersede the matching details above:
- **§5.3 Pace chart:** days with no spending (past, today or future) draw nothing; the ghosted future boxes are removed. A baseline is drawn and today is marked by a small dot on it.
- **§6 Overview:** Recent shows the **latest 8 entries** (grouped by day; day nets cover shown rows only) with a "Showing the latest 8 entries · All activity →" footer.
- **§8.2 Envelopes:** no coloured left stripe; tier is shown by the chip, the bar keeps the tier colour.
- **§9.2 Day feed:** amounts form one right-aligned dark column with a small direction badge (− out, + in, ↗ saved); day headers show labelled **In / Out / Saved** chips instead of a joined string.
- **§10.1 Goals:** goal notes become **ring cards** (progress ring, saved of target, facts grid, guidance, "＋ Add savings" + date + ⋯ actions); the timeline becomes a slim dot strip above the cards, hidden on phones and when there are more than 6 goals.

## Addendum B — Industry-standard decisions (2026-10-19)

These supersede the matching details above (user delegated the four open decisions):
- **D1 · §8.3 New-cycle offer:** "Start next cycle" stays user-initiated (no automatic writes). The offered period is the contiguous next one (last end + 1, same length), rolled forward by whole cycle lengths until it contains today, so a lapsed plan never offers a period that is already over.
- **D2 · Plan allowance ceiling:** re-saving the running cycle (same plan, period start = its stored `last_period_start`) may assign current balance + this cycle's actual expenses and savings to date, since that money was part of the cycle's allowance; a new plan or a new period can only assign the current balance. Enforced by `allocation-templates` `save` and mirrored in the editor ("Allowance (up to ₱X available)"), re-evaluated when "Period from" changes.
- **D3 · §10.3 What-if:** the preview shows the true deficit — "Already ₱X over · would be ₱Y over", or "Safe to spend ₱X → ₱Y over" when only the spend crosses zero (`SpendPoint.raw` is unclamped; `safe` stays clamped). Slider zone labels render only for zones with non-zero width.
- **D4 · Applying a plan is budgeting:** logging an allowance with a plan no longer writes expense rows. It instantiates the plan's cycle (template-scoped envelopes from the entry date for the plan's previous cycle length, else 30 days), records only the savings share as a transfer into the chosen goal, and makes the plan active. The old unscoped `category_budgets` upsert is removed.
