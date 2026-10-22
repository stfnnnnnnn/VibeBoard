# Workboard refinement: Focus "Up next", glass system, view polish

**Date:** 2026-10-20
**Status:** Approved in brainstorming. Awaiting written-spec review.
**Builds on:** `2026-10-06-workboard-revamp-design.md` (the revamp). Its tokens, primitives, motion rules and accessibility rules still apply unless this document says otherwise.
**Mockups:** `.superpowers/brainstorm/1592-1792489260/content/`
- `focus-c-detail.html`: Focus
- `header-kpi-v1.html`: header and KPIs ("After" panels, minus the excluded options below)
- `views-glass-v4.html`: Table, Board and Timeline on the real background

## 1. Why

The user's verdict on the current Workboard: "a lot going on but the aesthetics and usability is not really considered". Focus in particular is "bland and flat".

A design critique (impeccable + emil-design-eng lenses, 25/40 heuristic score) found:
- weak hierarchy: a faint gradient title, a New item button that looks disabled, and every surface at the same flat glass level
- redundancy: overdue is stated 3 times, and Focus shows six section headers for two items
- 3px colour stripes that mean different things in different views
- a phone layout that pushes all work below the fold

## 2. Decisions (user, verbatim where quoted)

| # | Decision |
|---|---|
| D1 | KPI cards: remove the **top accent strips**. Keep the other mini visuals (progress track, due-soon dots, sparkline). |
| D2 | Focus should help "plan the week and see the whole picture, but give me a more of a concise view to know whats next". Chosen layout: **Direction C, "Up next" stack + week picker**. |
| D3 | The header/KPI "After" mockup is accepted, **plus removing the KPI corner icon tiles**. **Rejected:** a static background, and a floating New item button on phone. |
| D4 | Table, Board and Timeline: the glass direction in `views-glass-v4.html`, on the user's comment "loveit". |
| D5 | "keep the same old gradient for the background": `.vb-bg` in `globals.css` (animated, `#a6d8ff #ffcde1 #c2e9fb #f9c5d1`) is **unchanged**. The glass must look right on it, not on the vivid blobs used in v3. |

## 3. Glass system (shared, `workboard.css`)

Three surface levels replace today's single `--wb-glass`. Add these tokens; values are the mockup's.

| Token | Use | Value |
|---|---|---|
| `--wb-glass-panel` | Panels: Focus columns, Table, Board lanes, Timeline sheet | `linear-gradient(160deg, rgba(255,255,255,.58), rgba(255,255,255,.32))` |
| `--wb-glass-panel-border` | Panel edge | `1px solid rgba(255,255,255,.65)` |
| `--wb-glass-panel-shadow` | Panel depth | `inset 0 1px 0 rgba(255,255,255,.9), inset 0 -1px 0 rgba(255,255,255,.25), 0 20px 50px -24px rgba(60,40,110,.35)` |
| `--wb-glass-item` | Rows, cards, day tiles, KPI cards | `linear-gradient(160deg, rgba(255,255,255,.78), rgba(255,255,255,.5))` |
| `--wb-glass-item-border` | Item edge | `1px solid rgba(255,255,255,.8)` |
| `--wb-glass-item-shadow` | Item at rest | `inset 0 1px 0 #fff, 0 10px 26px -16px rgba(60,40,110,.4)` |
| `--wb-glass-item-shadow-hover` | Item hovered or dragged | `inset 0 1px 0 #fff, 0 16px 30px -16px rgba(60,40,110,.5)` |
| `--wb-r-panel` / `--wb-r-item` | Radii | `22px` / `14px` (cards `16px`) |

Classes: `.wb-glass-panel` and `.wb-glass-item`.

**Blur rule (performance):** only panels get `backdrop-filter: blur(22px) saturate(160%)`. Items get no backdrop filter of their own; their translucent gradient sits on the already-blurred panel. Stacked filters per row are too expensive. Wrap the filter in `@supports (backdrop-filter: blur(1px))`; the fallback raises panel opacity to `.72`.

**Glow dots:** one dot language for context, status and course. An 8px dot with `box-shadow: 0 0 0 3px <colour 18%>, 0 0 10px <colour 60%>`. Class `.wb-gdot`, colour set through `--dot`. Context colours come from `color.ts`. Status colours:
- To do: grey `#9aa5b8`, no outer glow
- In progress: blue `#3b8fe0`
- Waiting: amber
- For revision: violet
- Done: green `#2fb47a`

**Glass pill:** `.wb-gpill` has a translucent white fill, a white border and an inset top highlight, holding a dot plus a label. Status cells, course chips and Timeline nav use it.

**Remove all 3px side stripes.** The detector found 6:
- Table row priority edge
- Board card edge
- Board column top bars
- Timeline class-card edges
- `.wb-toast--error` (keep that one: it's a toast, not data)
- event chips

Use dots, tints or washes instead.

Contrast floor stays at 4.5:1 for body text, checked against the lightest gradient stop `#c2e9fb` behind a panel.

## 4. Header, toolbar, KPIs

- **Title:** solid `--wb-text`, 800, 28px, letter-spacing −0.02em, preceded by a 12×28px rounded mark filled with `linear-gradient(180deg,#e8609a,#7aa7e0)`. The gradient-text title goes.
- **Subtitle:** just the date ("Tuesday, October 20"). Drop "0 due today · 1 overdue"; the KPIs already say it.
- **New item:** new `--wb-pink-strong: #d94f86`, fill `linear-gradient(180deg,#e8609a,#d94f86)`, white 700 text, pill radius, shadow `0 6px 16px -6px rgba(217,79,134,.55)`. Must reach ≥4.5:1 (white on `#d94f86` ≈ 4.0, so darken the lower stop until it passes, about `#c9437a`).
- **Context tabs:** stay underlined (revamp §14a), with a 2px `--wb-pink-strong` underline. On phone the strip gets a right-edge fade mask (`mask-image: linear-gradient(90deg,#000 80%,transparent)`) as a scroll cue.
- **View switcher:** a sunken track `rgba(31,41,55,.05)`. The active segment is a white raised pill with weight 700 and shadow `0 1px 2px rgba(31,41,55,.08), 0 4px 10px -4px rgba(31,41,55,.15)`.
- **KPI cards:**
  - surface: `.wb-glass-item`, radius 16
  - no top strip and no corner icon tile
  - label: 11px uppercase 800
  - number: 34px, weight 750, tabular-nums
  - a value of 0 renders in `--wb-text-subtle`
  - Overdue > 0: card tint `linear-gradient(180deg, rgba(255,235,242,.9), rgba(255,245,248,.8))` and border `rgba(217,79,134,.25)`
  - Overdue footer: "Oldest from <date> · Review →". Clicking it scrolls to and highlights the overdue item; in Focus that's the Up next card.
  - Mini visuals stay: progress track, due-soon dots, sparkline.
- **Phone KPIs:** a single horizontal scroll-snap strip of compact cards, about 120px wide and about 88px tall. This replaces the 2×2 grid (about 310px tall). New item stays in the header on phone (D3).

## 5. Focus: "Up next" + week picker

The layout is two columns at ≥1024px: left about 1.1fr, right about 1fr. The right rail (This Week's Workload, Upcoming Deadlines) is **removed**; the week picker replaces both.

### 5.1 Up next (left)

**Ranking** is a pure function `rankUpNext(items, now)` in `src/lib/workboard/ui/upNext.ts`:
1. Overdue: oldest due first. For Revision is never overdue (RV2).
2. Due today: by time. Items with no time go after timed ones.
3. Due tomorrow.
4. In-progress items due later this week, sorted by priority, then by date.
5. Everything else that isn't done is not in Up next; it lives in "Show all".

Waiting/blocked items rank by their due date as above, and keep their waiting badge.

**Display:**
- The **first item is a hero card** (`.wb-glass-item`, padding 16/18, pink-tinted shadow `0 12px 30px rgba(214,69,122,.12)`). It shows:
  - an eyebrow: "OVERDUE · 105 DAYS", "TODAY · 11:59 PM", "TOMORROW" or "THU"
  - a 22px round checkbox
  - the title, 16px 650
  - meta chips: context or course dot, due date, estimate, link count, waiting/revise reason
  - actions: **Mark done** (primary, dark), **Reschedule** (opens the existing deadline popover), **Open** (opens the drawer)
- Up to **3 compact cards** follow: one row each with checkbox, title, due, and a context chip on wide screens.
- Completing an item uses the existing completion animation and Undo. The next item then promotes into the hero slot with a 180ms crossfade (opacity plus a 4px translate; instant under reduced motion).

**States:**
- 0 items: "Nothing urgent. Nice." plus a quick-add field.
- 1–4 items: no "Show all" toggle needed if nothing else exists.
- When nothing else is due this week: a soft green line, "✓ Nothing else due this week".

**Show all:** a fold row, "+N more this week · M no deadline · Show all ▾". It expands in place into a grouped list, using the existing collapse animation. Groups: Later this week, Next week, Later, No deadline, Waiting. **Only non-empty groups render.** Items already shown in Up next aren't repeated. Each group header keeps "+ Add" (quick add) for its timeframe.

### 5.2 Week picker (right)

- **Header:** "Week of Oct 19", with ‹ › to change week and a Today button when off the current week.
- **7 day tiles:**
  - each shows the day letter, the date, and a mini bar cluster: pink bars are due work (height scales with estimate, or count when there are no estimates), blue bars are classes
  - past days at opacity .55
  - the selected day is a white tile with a pink ring
  - today's date label is pink
- **Selected-day list:**
  - default is today
  - header: "Thursday Oct 22 · 1 due · 1 class"
  - rows: due work with checkboxes, plus classes as muted rows with times. Skipped or cancelled classes are struck through, matching TimelineDayPanel.
  - footer: estimated hours for the day, plus "+ Add for <day>"
- **Data:** reuse what Timeline already uses: `dayEntries.ts` and the week's class schedule from the shell's `initialWeek`/week fetch. **No new API.**

### 5.3 Phone (<768px)

The order, top to bottom:
1. KPI strip
2. week picker as a compact 7-tile strip (tap a day to swap the Up next area for that day's list; tap again or "Back to up next" to return)
3. Up next (hero plus 2 compact)
4. Show all

The hero's actions are Done and Reschedule (Open = tap the title).

## 6. Table

- **Panel:** `.wb-glass-panel`, padding 10.
- **Header:** sits inside the glass, 40px tall, uppercase 11px 800 muted labels, sticky within the panel scroll.
- **Rows:** each row is a separate `.wb-glass-item` strip, 52px tall, radius 14, 6px gap between rows. Hover (fine pointer only) lifts 1px and uses `--wb-glass-item-shadow-hover`.
- **Column order:** checkbox, **Work**, Context, Status, Priority, Deadline, Time, Links.
- **Text weight:** Work is the only 650/14px text. Other cells are 550/13px muted.
- **Context:** glow dot plus label.
- **Status:** glass pill with its status dot. It stays an inline-editable select; the pill is the trigger.
- **Overdue rows:** background `linear-gradient(90deg, rgba(255,196,218,.95), rgba(255,255,255,.6) 55%)` instead of a stripe. The deadline reads "⚠ Overdue · Jul 7" in `--wb-danger`, weight 700.
- **Done rows:** title muted, struck through with a 60% line colour; checkbox filled green.
- **Selected rows (bulk):** a blue-tinted wash plus a 1.5px inset ring `rgba(59,143,224,.45)`.
- **Footer:** "3 items · 1 overdue" on the left, "+ New item" on the right.
- **Phone:** keep the existing card-list fallback, with each card as `.wb-glass-item`.

## 7. Board

- **Lanes:** `repeat(n, minmax(280px,1fr))` so they fill the width.
- **Lane surface:** `.wb-glass-panel`, plus a status-colour **wash**: an absolutely positioned 90px top gradient, colour at about 26% fading to transparent. This replaces the `borderTop` bars.
- **Lane header:** glow dot, then the name in sentence case ("In progress"), 14px 750, then a glass count pill.
- **Cards:** `.wb-glass-item`, radius 16, padding 13/14.
  - Title: 14px 650, 3-line clamp (D2 from the revamp).
  - Meta row: course or context glass chip with a **short course code**, a deadline tag, a link count, and the waiting badge.
  - Deadline tag: tinted when overdue (`rgba(232,85,143,.14)` with `#c0285c` text).
  - Subtask progress: a 4px bar with gradient `#8ec5ff → #e8558f`, shown only when the item has subtasks.
- **Short course code:** a pure helper `shortCourseCode(code)` in `src/lib/workboard/ui/`. It extracts the first segment matching `/[A-Z]{2,}\d{3,}[A-Z]?/` (`3TSY2526_CS0061L_TN3` → `CS0061L`) and falls back to the full code, truncated. The full code goes in `title`. Use the same helper in Focus and Table chips.
- **Drag:** lift `translateY(-2px) rotate(-.4deg)` plus the hover shadow, transform only. Hover lift is fine-pointer only.
- **⋮ menu:** on desktop with a fine pointer it shows only on card hover or focus-within; always visible on touch.
- **Empty lane:** a glass drop target (1.5px dashed white border, `rgba(255,255,255,.2)` fill) with copy per status. Done: "Drag finished work here". Others: "Nothing here yet".

## 8. Timeline

- **Sheet:** the week sits on one `.wb-glass-panel`.
- **Header:** "Oct 19 – 25", then a **week progress bar** (6px, gradient `#8ec5ff → #e8558f`, fill = elapsed fraction of the week; full for past weeks, empty for future ones), then glass pills ‹ Today ›.
- **Columns:** `repeat(5, minmax(0,1fr)) repeat(2, minmax(0,.7fr))`. Weekends are recessed: `rgba(255,255,255,.18)` with no shadow. Past days at opacity .6.
- **Day tiles:** `.wb-glass-item`, radius 18, with a 22px 750 date.
- **Today:**
  - background `linear-gradient(180deg, rgba(255,255,255,.88), rgba(255,236,245,.7))`, a 1.5px pink ring, and a pink glow shadow
  - the label reads "TUE · TODAY" in pink
  - a **now line**: a 2px pink line with a dot, positioned by `nowMinutes` across the visible hour range (existing helper)
- **Classes:** tinted glass chips, `linear-gradient(160deg, <course colour 45%>, rgba(255,255,255,.45))`, showing the code and the time range. No side edge.
- **Due work:** bright white chips with a ⚑ flag and the due time, so deadlines stand out from classes.
- **Empty days:** no text, except **today**, which shows a small glass orb and "Free day". Remove every "Nothing scheduled".
- **Conflict summary, day panel, card clamps and phone scroll-snap:** unchanged from the revamp. They're restyled onto the new surfaces.

## 9. Motion

The revamp rules apply: transform and opacity only; `--wb-ease`; 120/180/240ms; no animation for keyboard-opened UI; hover effects only under `(hover:hover) and (pointer:fine)`; reduced motion removes movement.

New in this spec:
- Up next promotion: crossfade, 180ms.
- Week picker day switch: list crossfade, 120ms.
- Week progress bar: no animation.
- Card lift and tilt on drag: 120ms.
- No glow pulsing anywhere.

## 10. Out of scope

- Background change (D5).
- Floating New item button (D3).
- New APIs or schema changes.
- Palette, dialogs and drawer internals beyond picking up the new surface tokens.
- Other pages that use `.vb-bg`.

## 11. Verification

1. `npx tsc --noEmit` exits 0, and `node scripts/wb-style-gate.mjs` is clean on every changed file.
   - Extend the gate to flag any new `box-shadow: inset 3px 0 0` or `border-left: 3px` in Workboard files, except `.wb-toast--error`.
2. Unauthenticated smoke check as before.
3. Playwright screenshots at 390, 820 and 1440 of:
   - Focus in three states: sparse (the real board), busy (a dev-only fixture page, deleted after QA), and Show all expanded
   - Table, Board and Timeline
   - reduced motion, with zero console errors and no horizontal overflow
4. `break-ui` pass on Up next (long titles, 0/1/many items, very old overdue), the week picker (overloaded day, all-empty week) and Board chips (unbreakable course codes).
5. Contrast checked for every new text/background pair against `#c2e9fb`.
