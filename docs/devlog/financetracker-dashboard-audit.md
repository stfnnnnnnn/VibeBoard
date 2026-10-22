# Finance Tracker — Main Dashboard Audit

**Scope:** `financetracker/financedashboard.php` (the dashboard landing page users hit after clicking "Finance Tracker"), plus its two AJAX backends `load_summary_totals.php` and `summaries.php`. The adjacent transaction-entry page (`financetracking.php`, 1,352 lines) and its API (`financetracker.php`) are noted only where the dashboard links to them — they were not scanned in depth and should get their own pass later.

Stack: classic PHP (`mysqli`, session-based auth), inline `<style>` and `<script>` in the same file (no build step, no component structure), polling-based AJAX rather than the Next.js/React stack used by the newer Study Pulse module.

---

## 1. What this page is

A single-screen financial overview for one logged-in user: how much allowance they've logged, how much they've spent, how much they've saved, what's left, broken down by week/month/category, plus progress toward savings goals. It's read-only/summary — actually logging a transaction happens on the separate "My Finances" page (`financetracking.php`), reached via a button in the header.

## 2. Page structure (top to bottom)

```
┌─────────────────────────────────────────────────────────────┐
│ "{FirstName}'s Finance Dashboard"      [Week▾] [My Finances] [🏠] │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │Allowance │ │ Expenses │ │ Savings  │ │Remaining │  ← summary-grid
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│  ┌────────────────────────┐ ┌────────────────────────┐      │
│  │ Total Expenses  [W▾]   │ │ Total Savings   [W▾]   │      │
│  │ (bar chart)            │ │ (bar chart)             │      │
│  │ Expenses by Cat [W▾]   │ │ Savings by Cat  [W▾]   │      │  ← tracker-duo
│  │ (donut chart)          │ │ (donut chart)           │      │
│  └────────────────────────┘ └────────────────────────┘      │
│  ┌────────────────────────┐ ┌────────────────────────┐      │
│  │ Total Allowance [W▾]   │ │ Goal Tracker            │      │
│  │ (bar chart, full-row)  │ │ (search/limit/refresh)  │      │  ← bottom-row
│  └────────────────────────┘ └────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

Visual language: animated pastel diagonal gradient background (`#a6d8ff → #ffcde1 → #c2e9fb → #f9c5d1`, matches the same wash the Next.js side later adopted for `.vb-bg`), glassmorphic cards (`rgba(255,255,255,0.25–0.8)` + `backdrop-filter: blur`), pink→blue gradient text for headings, Font Awesome icons, Poppins/Segoe UI fonts.

## 3. Features, in detail

### 3.1 Header
- **Title**: `"{first_name}'s Finance Dashboard"` — first name pulled from `$_SESSION['first_name']`.
- **Global range dropdown** (`#summary-filter`): options labeled "Week" / "Month" / "All Time" (values `month` / `year` / `all` — see §5.1 for why those value names are misleading). Drives only the four summary cards, not the rest of the page.
- **"My Finances" button**: hard-navigates to `financetracking.php` (absolute URL to the `alwaysdata.net` production host, not a relative link — see §5.4).
- **Home button**: hard-navigates to `dashboard/dashboard.php` (also absolute production URL).

### 3.2 Summary grid (2×2, top of dashboard body)
Four cards — **Allowance**, **Expenses**, **Savings**, **Remaining** — each a single peso figure. Sourced from `load_summary_totals.php`:
- `total_allowance` = `SUM(allowance_amount)` from `allowance` in the selected date range.
- `total_expense` = `SUM(expense_amount)` from `expenses`.
- `total_savings` = `SUM(savings_amount)` from `savings_entries`.
- `remaining` = `total_allowance - (total_expense + total_savings)` — i.e. savings is treated as an outflow against allowance, not as a separate pool.

### 3.3 Total Expenses (bar chart) + Expenses by Category (donut)
Left half of the "tracker-duo" row, two independently-filterable segments sharing one card:
- **Total Expenses**: horizontal pill bars, one per week (`W1`–`W4`) or per month (`Jan`–`Dec`) depending on its own filter (`weekly`/`monthly`/`all`), each labeled with the peso amount, bar width scaled to the max value in the set.
- **Expenses by Category**: CSS `conic-gradient` donut + text legend, categories pulled from the `expenses.category` enum (transportation, grocery, food, academic, family, leisure, emergency, miscellaneous, healthcare, utilities, donation), summed across the whole filtered range (categories are *not* broken out per week/month in the donut, only in aggregate).

### 3.4 Total Savings (bar chart) + Savings by Category (donut)
Same layout as 3.3, mirrored on the right. "Category" here is actually **goal name** (`savings_goals.goal_name`, via `savings_entries.goal_id`), not the `savings_entries.categories` enum (Emergency Fund/Travel/Gift/Investment/Wishlist/Future Allocation) — the enum column exists in the schema but the dashboard's savings donut never reads it.

### 3.5 Total Allowance (bar chart, full width)
Same bar-chart pattern as 3.3/3.4 but spans the full row by itself, with its own independent filter. No matching "Allowance by Category" donut, even though `allowance.categories` (`initial allowance`/`expenses`/`savings`) exists and would fit the same pattern used for expenses/savings — this asymmetry is the most visible structural gap on the page.

### 3.6 Goal Tracker
- Fetches **all** goals (`filter=all`) once on load via `summaries.php`, independent of any of the other filters on the page.
- **Search box**: client-side substring filter on `goal_name`.
- **"Show" selector**: 10/25/50/100 (labeled oddly — see §5.2), caps how many goal cards render.
- **Refresh button**: resets search + limit to defaults and re-fetches from the server.
- Each goal card: name, a progress bar, and a percent-complete label. Progress = `SUM(savings_entries.savings_amount) for that goal / savings_goals.wishlist_amount` (entries outside the goal's own date filter aren't excluded — since Goal Tracker always requests `filter=all`, this is effectively lifetime progress toward the goal).

### 3.7 Auto-refresh
A `setInterval` on the page **polls every 2 seconds, forever**, re-fetching the global summary and all five tracker sections (expenses, savings, allowance, both donuts) regardless of whether the tab is visible or the user is idle. See §5.5 — this is the single biggest "archaic" red flag on the page.

## 4. Data model (as used by this dashboard)

| Table | Key columns | Used for |
|---|---|---|
| `allowance` | `allowance_amount`, `entry_date`, `categories` (initial allowance/expenses/savings) | Allowance summary + bar chart |
| `expenses` | `expense_amount`, `entry_date`, `category` (11-value enum) | Expense summary + bar chart + donut |
| `savings_entries` | `savings_amount`, `entry_date`, `goal_id` → `savings_goals`, `categories` (6-value enum, unused by dashboard) | Savings summary + bar chart + donut (by goal) |
| `savings_goals` | `goal_name`, `wishlist_amount`, `wishlist_category`, `entry_date` | Goal Tracker |
| `monthly_expense_allocations` | `allowance_id` → **`monthly_allowance`** (table does not exist in the current DB) | Not used anywhere in the scanned code — orphaned (§5.6) |

Two backends both compute overlapping totals independently rather than sharing one code path:
- **`load_summary_totals.php`** — powers only the top 2×2 summary grid. Filter values: `month` = current week (Mon–Sun), `year` = current calendar month, `all` = 2000-01-01 to today.
- **`summaries.php`** — powers the bar charts, donuts, and Goal Tracker. Filter values: `month` = current calendar **month** (not week), `year` = current calendar **year**, `all` = same 2000-01-01 floor. Also writes a `debug_summary.json` file to disk on every single call (§5.5).

Note the two backends use the **same filter value strings** (`month`/`year`/`all`) to mean **different date ranges** — `month` means "this week" in one file and "this calendar month" in the other. Anyone touching this code without knowing that will introduce a bug.

## 5. Notable issues / "archaic" symptoms found

These are concrete findings from reading the code, not aesthetic opinions — they're the kind of thing a redesign should fix alongside the visual pass.

1. **Filter value/label mismatch.** The global dropdown shows "Week / Month / All Time" but its `<option>` values are `month` / `year` / `all`. Combined with the two backends disagreeing on what `month` means (§4), this is a genuine trap for future maintenance, not just a naming nitpick.
2. **"Show: 10" selector's first option is mislabeled.** `<option value="10" selected>8</option>` — the value is 10 but the visible label reads "8". Users seeing "8" in the dropdown are actually getting 10 results.
3. **Unstable category colors.** 17 CSS custom properties (`--transportation-color`, `--emergency-fund-color`, etc.) are defined for every expense/savings category but **never referenced anywhere** (`var(--...)` doesn't appear once in the folder). The donut charts instead assign colors from a separate 10-color pastel array purely by iteration order (`getPastelGlassColor(colorIndex++)`), so the same category can render a different color between page loads or filter changes depending on what order `Object.entries()` happens to return.
4. **Hardcoded absolute production URLs.** Both nav buttons hard-code `https://vibeboard.alwaysdata.net/VibeBoard/...` instead of relative paths — this will silently break (or worse, redirect users off a local/staging instance to production) if the app is ever hosted anywhere else.
5. **Unbounded 2-second polling + per-request disk write.** `setInterval(..., 2000)` runs forever with no pause on tab-hide/blur and no cleanup, re-running 5 fetches every 2 seconds indefinitely. `summaries.php` also does `file_put_contents("debug_summary.json", ...)` on *every* call — meaning every visitor's dashboard silently rewrites a shared debug file on disk twice a second while their tab is open. This is a real performance/scalability liability, not just a code-smell.
6. **Orphaned "Smart Allocator" feature.** A stray HTML comment (`<!-- BOTTOM ROW: Summary + Smart Allocator -->`) references a feature that isn't in the current markup, and the DB still carries a `monthly_expense_allocations` table with a foreign key to a `monthly_allowance` table that no longer exists. This looks like a half-built/abandoned feature — worth deciding whether to resurrect it (see feature suggestions) or drop the dead table.
7. **Structural asymmetry.** Expenses and Savings each get a bar chart *and* a category donut; Allowance only gets a bar chart, despite having its own `categories` enum that would support the same donut treatment.
8. **Triplicated `<!DOCTYPE html><html><head>` blocks.** The file has three nested/duplicated doctype+head open tags near the top (lines 27–51) before the real one takes effect — leftover from copy-pasted boilerplate, harmless in practice (browsers just ignore the extras) but a clear sign of unclean history.
9. **No empty states.** If a user has zero expenses/savings/goals, the donut shows a bare "No data" div with no styling, and the Goal Tracker just renders nothing — no onboarding nudge to add a first entry.
10. **No loading state.** Every chart is blank until its fetch resolves; on a slow connection the dashboard looks broken for a moment on every load and every 2-second refresh.

## 6. Suggested features for the redesign

Roughly ordered by how directly they build on data the schema already has vs. requiring new tables:

**Low-effort (data already exists, just not surfaced):**
- **Allowance-by-category donut**, matching the Expenses/Savings pattern, using the already-collected `allowance.categories`.
- **Trend indicators** on the summary cards (▲/▼ vs. previous period) — trivial once one extra query is added per card.
- **Net savings rate** (`total_savings / total_allowance`) as a headline stat — a much more motivating number than "Remaining" alone.
- **Per-goal deadline / target date** and a "days left" chip, if `savings_goals` gains a target-date column — pairs naturally with the existing progress bar.

**Medium-effort:**
- **Budget caps per category** (e.g. "you've spent ₱2,400 of your ₱3,000 grocery budget this month") — needs a small new table but reuses the existing category enums directly.
- **Overspend / low-remaining alerts** — a banner or toast when `remaining` goes negative or a category budget is exceeded.
- **Transaction list / recent activity feed** directly on the dashboard (last 5–10 entries across allowance/expense/savings) so the dashboard isn't purely aggregate — currently users must leave to "My Finances" to see anything transaction-level.
- **Exportable summary** (PNG/PDF), consistent with the pattern already built for the GWA Calculator in Study Pulse.

**Larger, but high value given the abandoned groundwork already in the schema:**
- **Revive the "Smart Allocator"**: auto-split a newly logged allowance across categories by a saved percentage template (the dead `monthly_expense_allocations` table suggests this was the original intent) — this would give the "Total Allowance" card the same category-aware depth the other two already have, and give the page an actual planning feature instead of only after-the-fact tracking.
- **Multi-goal contribution flow**: let one savings entry split across multiple goals at once, instead of one goal per entry.
- **Consolidate the two summary backends** (`load_summary_totals.php` and `summaries.php`) into one source of truth so the top cards and the charts below can never disagree — directly fixes issue §5.1/§4's filter-meaning mismatch as a side effect.

## 7. Out of scope for this pass (flagged for later)

- `financetracking.php` (1,352 lines) — the actual add/edit/delete transaction UI, reached via "My Finances." Not scanned in depth; will need its own audit before a full finance-tracker redesign is complete.
- `financetracker.php` — the AJAX CRUD backend behind that page (load/add/edit/delete for allowance, expense, and savings entries).
