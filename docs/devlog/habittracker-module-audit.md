# Habit Tracker Module — Feature Audit (Legacy PHP)

Audit-only pass over the current PHP implementation before porting it to Next.js/React, in the same spirit as `financetracker-dashboard-audit.md` before the Finance Tracker migration. No code changed by this document.

**Files covered:**
- `habittracker/habittracker.php` (1,224 lines) — the habit manager: CRUD, daily check-ins, streak tracking, client-side filtering.
- `habittracker/habitdashboard.php` (650 lines) — an analytics dashboard intended to sit alongside it.

Both are self-contained PHP files: inline `<style>`, inline `<script>`, server-rendered HTML, and AJAX calls back to themselves (`fetch("")`) for every mutation.

---

## 1. Access & connection

- Session-gated: `session_start()`, redirects to `../login.php` if `user_id`/`first_name` aren't set. No CSRF token on any form or fetch call.
- **Both files hardcode production DB credentials directly in source** (`mysql-vibeboard.alwaysdata.net`, `vibeboard`, plaintext password) — not read from environment config. This is a real credential-exposure issue independent of the migration.
- Timezone pinned to `Asia/Manila` for all date math (`date_default_timezone_set`).

## 2. Database shape (as actually used, not just declared)

Three tables, no ORM, raw `mysqli`:

**`habit_tasks`** — one row per habit/routine.
| Column | Notes |
|---|---|
| `habit_id` (PK) | |
| `user_id` | FK to `user_login`, cascade delete |
| `task_name` | |
| `purpose` | free text, shown as the card's "Purpose" line |
| `habit_urgency` | enum: Urgent / Priority / Important / Not Important / Not Urgent |
| `task_category` | enum: academic / household / health / social / organizational / life goals |
| `habit_type` | enum: habit / routine |
| `days_of_week` | MySQL `SET` of weekday names, stored/consumed as a comma-joined string in PHP |
| `times_per_week` | derived at save time as `count(days selected)` — not independently editable |
| `date_created` | timestamp default |
| `task_status` | enum `active`/`archived` — **see §5, this is not a user-controlled archive flag** |

**`habit_checkins`** — one row per habit per day it was completed. Unique key on `(habit_id, checkin_date)`, so a check-in is an upsert (`ON DUPLICATE KEY UPDATE`).

**`habit_streaks`** — append-only-ish streak ledger: `streak_start`, `streak_end`, `current_streak_days`, `longest_streak`. A habit can accumulate multiple streak *rows* over its life (a new row starts whenever a check-in doesn't extend the previous streak's `streak_end + 1 day`); "current streak" is read as the most recent row by `streak_id DESC`.

## 3. `habittracker.php` — the manager page

### 3.1 On every page load (before any rendering)
Runs an `UPDATE habit_tasks SET task_status = CASE WHEN FIND_IN_SET(today's weekday, days_of_week) THEN 'active' ELSE 'archived' END WHERE user_id = ...` — i.e. **`task_status` is recomputed from scratch on every single request**, for every habit belonging to the logged-in user, whether or not anything changed. It is not a persistent "I archived this" flag — it is "is this habit scheduled for today," renamed confusingly to sound like an archive state. This matters for the port: naming it `status: active/archived` in a new UI would mislead users into thinking they can permanently archive a habit, when today's PHP behavior silently flips it back the next day it's scheduled.

### 3.2 CRUD (all via `POST` to the same file, discriminated by `action`)
- **`add`** — validates nothing server-side beyond what HTML `required` attributes imply; inserts with `times_per_week = count($days)`.
- **`update`** — same shape, scoped by `habit_id AND user_id`.
- **`delete`** — scoped by `habit_id AND user_id`; relies on FK cascade to clean up checkins/streaks.
- All three `echo` a bare string (`'added'`, `'updated'`, `'deleted'`) that the frontend string-compares to decide whether to `location.reload()`. No JSON, no error payload — any failure just doesn't match the expected string and the UI silently does nothing (or in the add/edit form's case, shows a generic `alert("Something went wrong...")`).

### 3.3 Check-in / streak engine (the most complex logic in the module)
- **`checkin`**: upserts today's `habit_checkins` row to completed, then:
  - Looks at the habit's most recent streak row.
  - If `today == streak_end + 1 day`, extends it: `current_streak_days += 1`, `longest_streak = max(longest, current)`.
  - Otherwise (no prior streak, or a gap), **starts a brand new streak row** at `current_streak_days = 1`.
  - Note: it never checks whether *today itself* already extends an in-progress streak correctly across the *actual scheduled days* — a habit scheduled Mon/Wed/Fri that's checked in Mon then Wed reads that as "not consecutive" (`Wed ≠ Mon+1`) and starts a **new** streak, even though the user hasn't missed a scheduled day. Streak continuity is calendar-day-based, not scheduled-day-based. This is a real behavioral bug worth deciding on for the rewrite: keep byte-for-byte, or fix to count consecutive *scheduled occurrences* instead of consecutive calendar days.
- **`undo_checkin`**: deletes today's check-in, then recomputes `streak_end`/`current_streak_days` by counting *all* completed check-ins up to the new latest date — this is a flat count, not a recomputed consecutive-run length, so it can disagree with how the streak was built in the first place if there were ever gaps.
- **`reset_streak`**: hard-deletes all streak rows for the habit — no soft state.
- **`undo_streak`**: a *second*, differently-implemented "undo" path (deletes today's check-in, then decrements `current_streak_days` by 1 or deletes the row if it was `1`) that duplicates `undo_checkin` with different math and **is never called from the UI** (no button wires to it — `resetStreak()` and `undoCheckin()` are the only two exposed). Dead code; the two undo implementations would disagree if both were used.
- Streak percent shown on each card: `min(100, current_streak_days / times_per_week * 100)` — i.e. "how much of this week's target you've hit," not "days in a row" despite living in a component called `streak-bar`.

### 3.4 Rendering a habit card
For every habit, per request: a `SELECT` for its latest streak row, a `SELECT` for whether today is already checked in, then PHP computes `is_today_allowed` (is today in `days_of_week`) and `is_disabled` (not allowed *and* not already checked in — habits already checked in stay clickable so you can undo them even off-schedule). That's **2 extra queries per habit** on every page load, no batching.

Each card shows: name, urgency badge, category badge, status badge (Active/Archived — see §3.1 caveat), purpose (`nl2br`'d), type, days list, a streak progress bar + percent, and three actions: Done/Undo, Edit, Delete.

### 3.5 Add/Edit modal
One shared modal for both create and edit, its mode toggled by mutating the same DOM form (`action` hidden input, title text). Editing pre-fills every field via a JSON blob embedded directly in an inline `onclick` handler (`editHabit(<?= $habit_for_js ?>)`), XSS-escaped via `JSON_HEX_*` flags. Editing also dynamically injects a "🔁 Reset Streak" button into the modal that isn't present when adding — appended via JS, removed again by `openAddModal()`.

Days-of-week picker: seven toggle buttons (`Mon`..`Sun`), tracked in a JS `Set`, serialized into hidden `days_of_week[]` inputs right before submit.

### 3.6 Filtering
One `<select>` with four optgroups — Status / Category / Urgency / Day — collapsed into a single dropdown via `type:value` option values (e.g. `category:academic`). Filtering is **entirely client-side**: every habit for the user is always fetched and rendered into the DOM (`display:none` toggles visibility), the "FILTER HABITS" SQL section in the PHP builds `$where`/`$params` but they're never actually parameterized beyond the constant `user_id = ?` — dead scaffolding for a filter that was never wired server-side.
- Default view on load is `status:active` (i.e., "scheduled today").
- If a Category/Urgency/Day filter matches zero cards, it silently falls back to the Active filter instead of showing an empty state.

## 4. `habitdashboard.php` — the analytics dashboard

This file is **effectively non-functional in its current form**, despite doing real work to compute data:

- It correctly queries and computes: active habit tasks, per-habit streaks, the last 7 days of check-ins, per-weekday completion percentages (`$completion_percent_per_day`), per-habit weekly progress (`$habit_weekly_progress`), and a login-streak lookup into `$login_streak` (an associative array).
- **But the HTML/PHP template below it references entirely different, never-defined variables**: `$loginStreak`, `$topHabits`, `$weeklyCompletionPercent`, `$weeklyCheckins`, `$todaysHabits`, `$totalHabits`, `$completedToday`, `$longestStreak`, `$mostUrgentHabit`. None of these are ever assigned anywhere in the file. Every one of these renders as PHP's default-empty/`0`/`null` coercion, meaning:
  - Login Streak card always shows "0 consecutive days."
  - Top Habit Streaks always shows "No habits found."
  - Weekly Completion always shows "0% ... completed," empty progress bar.
  - Weekly Check-ins always shows "No check-ins recorded this week."
  - Today's Habits always shows "No scheduled habits today" — so the one "Check In" button this page offers is unreachable in practice.
  - Quick Stats always shows Total Habits: 0, Completed Today: 0, Longest Streak: 0 days, Most Urgent: None.
- The category completion bar chart (Chart.js via CDN) fetches `fetch_category_completion.php`, **a file that does not exist anywhere in the `habittracker/` directory** — the chart silently fails (`console.error`) and never renders.
- Net effect: this page currently ships a fully-styled, fully-interactive-looking dashboard shell where **every single data-bearing element is dead**, because the real backend computation and the template were never connected. This is the single most important finding for the rewrite — the *intent* of every card is clear and worth preserving, but none of the current wiring can be reused as-is; the data plumbing has to be rebuilt from the correctly-computed PHP variables (which do work) through to the template (which doesn't read them).
- Separately, `body { overflow: hidden; max-height: 150vh }` means this page cannot scroll — any content taller than the viewport (e.g. a long "Today's Habits" list) is simply clipped, invisible, with no scrollbar.

## 5. Design language (both pages)

- Animated 4-stop pastel gradient background (`blue → pink → aqua → light-pink`), `background-size: 300% 300%`, slow `gradientFlow` keyframe — the same treatment already established across VibeBoard (Study Pulse, Finance, the main dashboard) and already ported into `.vb-bg` / `--bg-gradient` in the Next.js app.
- Glassmorphism cards: `rgba(255,255,255,0.5–0.6)` background, `backdrop-filter: blur(12–22px)`, soft shadow, rounded corners (14–20px) — equivalent to the app's existing `.glass` / `.glass-strong` tokens.
- Gradient text treatment for headers and titles (`background-clip: text`) — equivalent to `.gradient-text`.
- Color-coded badge system, meaningful and worth preserving exactly:
  - **Category**: academic (blue #6c8efb), health (green #42c38b), household (orange #ffb46e), life goals (pink #f58fb1), organizational (teal #51c4d3), social (coral #f28585).
  - **Urgency**: Urgent (red #f75b67), Priority (orange-yellow #f79f24), Important (yellow #f7d324, dark text), Not Important (sky blue #91cfff, dark text), Not Urgent (light purple #b28eff).
  - **Status**: active (emerald #00b894), archived (dark gray #555).
- Habit cards hover-scale (1.08×) with deepened shadow — fairly aggressive for a grid of cards; worth a deliberate call in the redesign rather than copying as-is.
- Icons are emoji (💡 ✅ ↩️ ✏️ 🗑️ 🔁) and one Font Awesome glyph (home button), not a unified icon system — the rest of the migrated app (Finance) uses `lucide-react`.
- Duplicated CSS: `.habit-card`, `.habit-card-header`, `.habit-title`, `.habit-details`, `.streak-bar` are declared twice, verbatim, in `habittracker.php`'s stylesheet (lines ~350–465 repeated at ~423–465) — dead weight, not a functional bug.
- Both pages hardcode an absolute production URL for the "home" nav button (`https://vibeboard.alwaysdata.net/VibeBoard/dashboard/dashboard.php`) — same class of issue already fixed for Finance's dashboard tile link.

## 6. Summary of what's worth carrying forward vs. fixing

**Carry forward as-is (real, working, well-scoped features):**
- Habit CRUD with urgency / category / type / multi-day scheduling.
- Daily check-in with upsert semantics (one check-in per habit per day).
- Streak accumulation and "reset streak" as an explicit user action.
- Client-side multi-facet filtering (status / category / urgency / day) with a sensible default view.
- The category/urgency color-coding system — it's expressive and already distinguishes six categories and five urgency levels clearly.

**Needs a real decision before porting, not a blind copy:**
- `task_status` semantics (§3.1) — is "Active/Archived" meant to be "scheduled today" (current behavior) or a real user-controlled archive? These are different features wearing the same label.
- Streak continuity math (§3.3) — consecutive calendar days vs. consecutive *scheduled* occurrences.
- Two divergent, only-one-used undo implementations (`undo_checkin` vs. `undo_streak`) — pick one, drop the dead one.

**Do not carry forward:**
- Hardcoded DB credentials in source.
- The entire disconnected variable-naming bug in `habitdashboard.php` (§4) — rebuild the dashboard's data flow from scratch against the correctly-computed aggregates, or equivalent fresh queries.
- The dependency on a nonexistent `fetch_category_completion.php` endpoint.
- Duplicate CSS blocks.
- Hardcoded absolute production nav URLs.

---

*Companion document, not yet written: an implementation/migration log will be kept as work proceeds, matching `financetracker-log.md`'s format.*
