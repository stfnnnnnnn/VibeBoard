# Dashboard revamp: one-screen live home

**Date:** 2026-10-30
**Status:** Approved in brainstorming. Awaiting written-spec review.
**Route:** `/dashboard` (`src/app/dashboard/page.tsx`)
**Mockups:** `.superpowers/brainstorm/2502-1793320217/content/`
- `layout-v8.html` is the **approved** layout. It is a full-page mockup at real size; open it at 100% zoom.
- `layout-v2.html` … `layout-v7.html` record the iterations that led to it.

## 1. Why

Today the dashboard is static. It has a greeting, a quote card, a weather card, three image tiles and a "My Work" button. None of it shows the user's data. The user asked for a revamp that is "better by a notch" visually and functionally. The dashboard should show how every module is doing at a glance, and Workboard should become a distinct module instead of a header button.

## 2. Decisions (user)

| # | Decision |
|---|---|
| D1 | The dashboard is a **digest**. It must **not duplicate Workboard**: it shows nothing editable, and every item deep-links into the module. |
| D2 | Workboard becomes a **4th module with its own identity**: a full-width live strip under the three tiles. Habits stays a separate module. |
| D3 | Layout keeps **three equal image tiles + full-width Workboard strip** (from mockup B), plus a **Today strip** (from A). |
| D4 | **No tabs.** Overview/Activity/Profile tabs were rejected. |
| D5 | **My Work button removed**; Workboard is entered through its strip. |
| D6 | **Recent activity removed** from the page to keep it calm. (Default chosen when the question went unanswered. It is not moved to the avatar popover.) |
| D7 | **Everything visible without scrolling at 100% zoom** on desktop. Verified sizes: 1366×768, 1536×864 and 1920×1080 browser viewports. |
| D8 | Tile stat chips sit **in the title row**, not on the image. The secondary stat line under the title ("2 quizzes this week") is **removed**. |
| D9 | Workboard strip is **more defined and more functional** (§5.4). |
| D10 | Quote and weather get **no dedicated space**. They are two slim rows stacked to the right of the Today strip. |
| D11 | Weather shows a **condition-based tip** ("Bring an umbrella, it's raining", "Shady skies, good time to head out", …). Includes the "rain later today" rule, which needs the forecast endpoint (default chosen). |
| D12 | Keep the `.vb-bg` animated gradient, the glass look, the gradient title and the existing tile artwork. |

## 3. Page structure (desktop, ≥1024px)

```
┌ header ─────────────────────────────────────────────────────────────┐
│ Thursday, Oct 30 · Week 7 · Good afternoon            [Sign-Out] (K)│
│ Karl's Home                                                         │
├ band ───────────────────────────────────────┬───────────────────────┤
│ Today strip: Next class | Habits | Safe to  │ “ quote … — author    │
│ spend | Due this week                       │ ☀ 31° Sunny · tip pill│
├ tiles (3 equal, glass, 3:2 artwork) ────────┴───────────────────────┤
│ [art]            │ [art]              │ [art]                       │
│ Study Pulse  chip│ Finance Tracker chip│ Habit Tracker chip          │
├ Workboard strip ────────────────────────────────────────────────────┤
│ Workboard [1 overdue][2 in progress][4 due]   3 of 7 ▬▬  [Open →]   │
│ ┌item┐┌item┐                                 ┌ This week M T W T F ┐│
│ └item┘└item┘                                 └─────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 3.1 One-screen fit rule (D7)

- `.page` is a flex column, `min-height: 100dvh`, with `justify-content: center` and gap `clamp(8px, 1.6vh, 16px)`.
- The **tiles row is the only flexible row**: `flex: 1 1 0; min-height: 0`. It is capped so it never grows taller than the 3:2 artwork plus the name row: `max-height: calc(((92vw - 28px) / 3 - 24px) / 1.5 + 54px)`. Any spare height centres the whole stack instead of cropping the art.
- Every other row is content-height, with vh-clamped type: title `clamp(30px, 5vh, 48px)`, Today value `clamp(16px, 2.1vh, 20px)`.
- Measured in the mockup at 100% zoom: 1366×657 viewport → no scroll, artwork 203px tall. At 1920×945 → no scroll, artwork ratio 1.53.

### 3.2 Below 1024px

The page scrolls normally (the one-screen rule is desktop-only).
- **Tablet:** the band stacks, the tiles go 2-up with `aspect-ratio: 3/2`, and the Workboard body stacks.
- **Phone (<640px):** the Today strip is 2×2, tiles and Workboard items are 1-up, and the Workboard header wraps.

## 4. Architecture

### 4.1 Data: one summary endpoint, isolated sections

`GET /api/dashboard/summary` → `DashboardSummary`:

```ts
type Section<T> = { ok: true; data: T } | { ok: false };

interface DashboardSummary {
  term:     Section<{ weekOfTerm: number | null }>;
  today:    Section<{ nextClass: NextClass | null }>;
  habits:   Section<{ done: number; total: number; currentBestStreak: number }>;
  finance:  Section<{ safeToSpendToday: number | null; leftThisCycle: number | null; tone: 'on_track' | 'tight' | 'over' }>;
  study:    Section<{ projectedGpa: number | null }>;
  workboard: Section<WorkboardDigest>;
}

interface WorkboardDigest {
  overdue: number; inProgress: number; dueThisWeek: number;
  doneThisWeek: number; totalThisWeek: number;
  upNext: DigestItem[];          // max 4: overdue first, then by due_at
  week: { date: string; items: { context: WorkContext; colorKey: string }[] }[]; // Mon–Sun
}
interface DigestItem {
  id: string; title: string; href: string;  // deep link into /workboard
  context: WorkContext; contextLabel: string; // course code / org / project / "Life"
  stage: 'todo' | 'in_progress' | 'waiting' | 'revision';
  priority: 'high' | 'normal' | 'low';
  subtasks: { done: number; total: number } | null;
  estimatedHours: number | null;
  dueAt: string | null; overdueDays: number | null;
}
```

- Each section is built in its own `try/catch` inside `Promise.all`. A failed section returns `{ ok: false }` and the rest still render (fail-open, the same as the current verify-banner lookup).
- **Reuse, don't re-implement.** Each section calls existing lib code:
  - habits: `getSummaryForUser` (`src/lib/habits.ts`)
  - finance: `loadSpendBase` + `computeSafe` (`src/lib/finance/safeToSpendServer.ts`)
  - workboard: `getWorkItems` + `computeStats` / `computeWorkloadChart` (`src/lib/workboard/`)
- **Targeted extraction (required):** projected GPA is computed inside `src/app/api/studypulse/stats/route.ts`. Move `convertToGPA` into a pure `src/lib/studypulse/gpaScale.ts`, and `getCustomPeriodGrade` + `getOverallGPA` into `src/lib/studypulse/gpaSummary.ts`. The route and the dashboard then both call them, and the route's response must not change. Finance needs no extraction: both finance numbers come from `loadSpendBase` + `computeSafe` (safe total, plus per-day computed the way the safe-to-spend route does it), with tone from `safeToSpendStatus` (`src/lib/finance/status.ts`).
- Next class reuses `getWorkboardWeek` (this week + next week), which already applies cancellations and make-up reschedules, and picks the first occurrence that hasn't ended yet (Manila time). Week of term comes from the latest `trimesters` row's `start_date`/`end_date`.
- The Workboard digest reuses Workboard's own `rankUpNext` (`src/lib/workboard/ui/upNext.ts`), topped up with other items due in the next 7 days when it returns fewer than 4. It also reuses `itemKey`, `CONTEXT_FILL`/`CONTEXT_TEXT`, `STAGE_LABELS`, `computeStats` and `computeWorkloadChart`.

### 4.2 Rendering

- `page.tsx` stays a **server component**. It renders the header and the three tile images immediately, then streams each live part inside `<Suspense>` with a shimmer skeleton of the same size, so nothing shifts on load.
- The server calls the shared summary builder directly (`src/lib/dashboard/summary.ts`). The API route exists for the client-side retry and day filter.
- Quote and weather stay client widgets using their existing routes (`/api/quote`, `/api/weather`). Both are restyled into slim rows.

### 4.3 Files

| File | Purpose |
|---|---|
| `src/lib/dashboard/summary.ts` | builds `DashboardSummary` + header data from module libs (server-only) |
| `src/lib/dashboard/types.ts`, `section.ts`, `headerLine.ts`, `nextClass.ts` | pure types and helpers, unit-tested by `scripts/dash-test.mjs` |
| `src/lib/dashboard/weatherTip.ts` | pure tip rules (§5.3) |
| `src/lib/workboard/dashboardDigest.ts` | pure Workboard digest (lives in the workboard lib so it can reuse its pure helpers; tested by `scripts/wb-test.mjs`) |
| `src/app/api/dashboard/summary/route.ts` | auth + JSON |
| `src/components/dashboard/DashboardHeader.tsx` | date/week line, title, Sign-Out, avatar |
| `src/components/dashboard/ProfilePopover.tsx` | avatar menu (§5.5) |
| `src/components/dashboard/TodayStrip.tsx` | 4 cells |
| `src/components/dashboard/QuoteRow.tsx` / `WeatherRow.tsx` | slim rows (replace the widget layout) |
| `src/components/dashboard/ModuleTile.tsx` | glass tile with title-row chip |
| `src/components/dashboard/WorkboardStrip.tsx` | header, Up next, This week, day filter |
| `src/app/dashboard/dashboard.css` | tokens + layout, following the `workboard.css` glass system (imported by the page, as `workboard.css` is) |

`QuoteWidget.tsx` and `WeatherWidget.tsx` are refactored into the row components; no duplicates are kept. The large inline `style={{…}}` objects in today's `page.tsx` move into `dashboard.css` classes.

## 5. Components

### 5.1 Header
- Line 1 (12px, muted): `Thursday, Oct 30 · Week 7 · Good afternoon`. The week part is omitted when no trimester is set. Greeting by Manila hour: morning <12, afternoon <18, else evening.
- Title: `{firstName}'s Home`, `.gradient-text`, `clamp(30px, 5vh, 48px)`.
- Right: the existing Sign-Out gradient pill, then a 36px gradient avatar showing the first initial (the session carries no photo URL), which opens the Profile popover.
- `VerifyEmailBanner` stays above the header when the user is unverified.

### 5.2 Today strip
Four glass item cells. Each is a link into its module:

| Cell | Value | Sub-line | Link |
|---|---|---|---|
| Next class | `CALC 2 · 1 PM` | `today`/`tomorrow`/weekday · room | `/studypulse/schedule` |
| Habits today | `3 / 5` | gradient progress bar | `/habits` |
| Safe to spend | `₱312` | `today · on track` / `tight` / `over` | `/finance` |
| Due this week | `4 · 1 late` | `next: <title>` | `/workboard` |

- **Empty state:** if a module has no setup (no schedule, no habits, no finance plan, no items), the cell shows a muted label and `Set up →` instead of a zero.
- **Error state** (`ok: false`): a muted `Couldn't load` with a retry icon button that refetches only that section.
- Retry refetches the whole summary (all sections are independent, so this is equivalent).

### 5.3 Quote + weather (D10, D11)
A column to the right of the Today strip, `grid-template-columns: 1.75fr 1fr`, holding two equal slim rows that together are the strip's height.
- **Quote row:** a small gradient `“` glyph, the quote in italics on **one line** with ellipsis, and `— Author`. The full quote is in `title`.
- **Weather row:** condition icon (the API's icon image), temperature (bold), `Condition · Feels N°`, and a **tip pill** right-aligned with ellipsis.
- The weather route switches from `current.json` to `forecast.json?days=1`. It is still one request and returns the same `current` block plus today's hourly `chance_of_rain`.
- `weatherTip(current, todayHours)` is pure and unit-tested. Rules apply in order; the first match wins:

| # | Condition | Tip | Tone |
|---|---|---|---|
| 1 | condition matches thunder | ⛈ Storm out, stay in if you can | rain |
| 2 | raining now (rain/drizzle/shower) | ☔ Bring an umbrella, it's raining | rain |
| 3 | any remaining hour today with `chance_of_rain ≥ 60` | 🌂 Pack an umbrella just in case | rain |
| 4 | feels-like ≥ 35°C | 🥵 Scorching out: umbrella + water | heat |
| 5 | sunny/clear and temp ≥ 30°C | ☀️ Hot outside, stay hydrated | heat |
| 6 | cloudy/overcast/partly cloudy | ☁️ Shady skies, good time to head out | calm |
| 7 | fog/mist/haze | 🌫 Hazy out, take it slow | calm |
| 8 | otherwise | 🌤 Nice out, enjoy a walk | calm |

Tone colours: heat `#fff4e0`/`#b4690e`, rain `#e6f2ff`/`#2c6fb0`, calm `#f1edfa`/`#6a5a9a`. Each must pass 4.5:1 contrast.

### 5.4 Module tiles (D8)
- Same glass tile and artwork as today (`/studypulse.png`, `/financetracker.png`, `/habittracker.png`, all 1536×1024).
- Artwork: `background-size: cover`, 14px radius, flexes to fill the capped tile height.
- Title row: name (15px bold) on the left, **stat chip** on the right (glass item pill + glow dot + value):
  - Study Pulse: `GPA proj. 1.75` (dot `#74bcd9`)
  - Finance: `₱4,180 left` (dot `#2fb47a`; amber when tight, rose when over)
  - Habits: `🔥 12-day streak` (dot `#f2a7c0`)
- If there's no data, the chip is hidden. If a section failed, the chip shows a muted `—`.
- Hover (fine pointer only): tile lifts 6px and the artwork scales 1.03. Press: scale 0.98.

### 5.5 Workboard strip (D2, D9)
**Header row:** `Workboard` (17px bold), then stat pills: `1 overdue` (rose), `2 in progress` (blue), `4 due this week` (neutral). Each pill links to `/workboard`. Workboard has no filter URL parameters, and its default Focus view already leads with overdue and in-progress work. Right side: `3 of 7 done this week` + 120px gradient progress bar, then the gradient pill **Open Workboard →**.

**Body:** `grid-template-columns: 1fr minmax(300px, .42fr)`.
- **Up next:** a 2×2 grid of up to 4 items, overdue first, then by `due_at`.
  - Line 1: priority glow dot (high = rose, normal/low = grey), then the title (ellipsis).
  - Line 2: context tag (course code / org / project, tinted by `src/lib/workboard/color.ts`), stage (coloured as Workboard does), then `◔ 2/5 subtasks` when subtasks exist, else `~2h` when estimated.
  - Due chip spanning both lines: `2d late` / `Today` / weekday, with the time or date underneath. Rose when late.
  - Click opens the item in Workboard via `/workboard?item=<source>-<id>`. Workboard gains this one parameter: on load it opens that item's detail drawer, then removes the parameter from the URL.
- **This week:** Mon–Sun columns. Each day shows a stack of 7px bars, one per item due that day, coloured by context. Today gets a dot under its letter.
  - **Clicking a day filters Up next** to that day's items (the dashboard's only interaction besides links). Clicking it again clears the filter.
  - Up next swaps with a 150ms crossfade. When a day is selected, the header shows `Fri · 2 items` and a clear ×.
- **Empty states:**
  - no items at all → `Nothing on your plate. Add work in Workboard →`
  - day with no items → `Nothing due Sat`

### 5.6 Profile popover
Opens from the avatar. Anchored top-right, scale-from-origin, closes on Esc or outside click, and focus is trapped while open.
- Contents: name, email + verified badge, Google linked / Canvas connected status rows, `Reset password` (links to `/forgot-password`, the app's only password flow), `Sign out`.
- It contains no term stats (they already appear on the page) and no recent activity (D6).

## 6. Motion (via `animate`, reviewed with `emil-design-eng`)

| What | How |
|---|---|
| First paint | Sections fade + rise 8px, staggered 40ms in reading order: band → tiles → Workboard. 280ms each, `cubic-bezier(0.23, 1, 0.32, 1)`. Plays once per session (`sessionStorage` flag, wrapped in try/catch). |
| Numbers | Today values and tile chips count up once over 600ms, ease-out, tabular numerals. |
| Tiles | Lift + artwork 1.03 zoom on hover (fine pointer only); press scale 0.98 at 160ms. |
| Day filter | Selected day pill slides between columns (layout transition); Up next crossfades in 150ms. |
| Popover | Scale 0.96→1 + fade from the avatar origin, 180ms; exit 120ms. |
| Skeletons | Shimmer at 1.4s; swapped to content with no layout shift. |

`prefers-reduced-motion: reduce` disables the stagger, count-up, shimmer and zoom. Content appears instantly, and opacity fades are kept to 120ms or shorter.

## 7. Accessibility

- The page has one `h1`. Band, tiles and Workboard are `section`s with `aria-labelledby`. Today cells and tiles are single links with descriptive accessible names ("Habits today: 3 of 5 done").
- Day filter: `role="radiogroup"` of buttons with `aria-pressed`. The Up next list gets `aria-live="polite"` while a filter is active.
- All text ≥ 4.5:1 on the glass. The muted text `#6b6b80` was checked on the lightest glass. Focus rings are visible (2px `#3b8fe0` + 2px offset).
- Touch targets ≥ 44px on touch devices (day columns, pills, avatar).
- Accepted deviation: white text on the pink→blue gradient pill and avatar (`.db-pill`, `.db-avatar`) stays below 4.5:1. It is VibeBoard's existing app-wide button style, kept per D12.

## 8. Testing & verification

- **Unit (`node:test` + `node:assert/strict`, in `__tests__/` folders like `src/lib/finance/__tests__`):** `weatherTip` (every rule, rule order, missing forecast), `digest` (sort, 4-cap, week buckets, overdue days, labels, day filter), greeting/week-of-term helpers, next-class rollover.
- **Regression:** the extracted `gpaSummary` / `cycleSummary` produce identical output to the current routes, captured as fixtures before the move.
- **API:** `/api/dashboard/summary` returns 401 without a session. A section that throws returns `{ ok: false }` and the others still return.
- **Visual/fit (Playwright):** at 1366×657, 1536×730 and 1920×945 the document height equals the viewport height (no scroll), there's no horizontal scroll and artwork width/height ≥ 1.45. At 390×844 there's no horizontal scroll and everything stacks.
- **Live check:** run the app, sign in, and confirm real data in every cell, empty states on a fresh account, and the reduced-motion pass.

## 9. Skill map for implementation

| Phase | Skill | Use |
|---|---|---|
| Plan | `superpowers:writing-plans` | turn this spec into a task plan |
| Execute | `superpowers:subagent-driven-development` (Opus subagents) | one task at a time with review |
| Logic | `superpowers:test-driven-development` | summary, digest, weatherTip, extractions |
| Visual build/QA | `impeccable` (polish, harden, audit) | match `layout-v8.html`; empty/error states |
| UX/a11y check | `ui-ux-pro-max` | hierarchy, contrast, targets, labels |
| Detail feel | `emil-design-eng` | hover/press, popover origin, timing |
| Motion | `animate` | §6, in its decision order |
| Phone | `mobile-native` | tap highlight, safe areas, 100dvh, hover-only effects |
| Finish | `superpowers:verification-before-completion`, `code-review` | Playwright fit checks + review before push |

Left out on purpose: `frontend-design`, `high-end-visual-design`, `design-taste-frontend`, `redesign-existing-projects` and `gpt-taste`. They overlap with `impeccable` and would push competing styles onto a direction that is already decided.

## 10. Out of scope

- Editing Workboard items, checking off habits or logging expenses from the dashboard (D1).
- Recent activity and an activity log table (D6).
- Changes to the Workboard, Habits, Finance or Study Pulse pages themselves, beyond the two lib extractions in §4.1.
- New tile artwork.
