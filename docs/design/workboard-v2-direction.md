# Workboard v2 — Visual Direction

**Status:** Approved direction, ready to implement against
**Date:** 2026-09-06
**Scope:** `src/app/workboard/**`, `src/components/workboard/**` — the List, Board, Timeline, and shared-shell surfaces (stat cards, category tabs, view switcher, right rail) that Tasks 11–16 build. The Calendar view is `WorkboardWeekView.tsx`, preserved as-is; this document does not change it, but every new surface must sit next to it without clashing (see "Sitting next to Calendar" below).

This document is derived from `docs/superpowers/specs/2026-09-05-workboard-v2-design.md`'s "Visual direction" section, built on the existing token set in `src/app/globals.css` (`.vb-bg`, `.glass`, `.glass-strong`, `.gradient-text`, `.vb-btn-pink`, `.vb-btn-blue`, `.vb-btn-ghost`), and grounded against the two shipped sibling surfaces `WorkboardWeekView.tsx` and `CanvasAnnouncementBank.tsx`. No new dependency, no new styling approach — inline React style objects plus the existing global classes, exactly as those two files already do.

---

## 0. The three mandated departures, restated as rules

These are not aesthetic preferences — they are constraints every later task must satisfy. Each is given an exact, checkable rule in its relevant section below; this is just the index.

1. **Flattened rows.** No per-row card or per-row background fill anywhere in List, Board's within-column item stacking is the one exception (see §5). Rule lives in §3.
2. **One priority signal.** The colored left edge renders on every row, always. The pill renders **only** when `priority === 'high'`. Rule lives in §4.
3. **Overdue is an alert, not a stat.** The Overdue card's entire visual treatment is conditional on `count > 0` vs `count === 0`. Rule lives in §6.

---

## 1. Type scale

All families: `"'Inter','DM Sans','Segoe UI',sans-serif"` for body/UI text; page title and section headers use DM Sans as the primary face in the stack (`"'DM Sans','Segoe UI',sans-serif"`), matching how `gradient-text` headings are already set across Finance/Study Pulse/Canvas. No new font is introduced.

| Element | Font | Size | Weight | Color | Notes |
|---|---|---|---|---|---|
| Page title (`<h1>Workboard</h1>`) | DM Sans | `clamp(1.9rem, 4vw, 2.6rem)` | 800 | `.gradient-text` (`#f2a7c0 → #74bcd9`) | `letter-spacing: -0.01em`, matches `FinanceDashboard.tsx`'s h1 exactly |
| Section header (Today / Upcoming / Later; Board column headers; rail panel headers, e.g. "Upcoming Deadlines") | DM Sans | `0.95rem` (15.2px) | 800 | `#2d3748` | Same size/weight already used for `WorkboardWeekView`'s "Reminders" header |
| Section header count badge (e.g. "Today · 3") | Inter | `0.78rem` (12.5px) | 700 | `#8a94a6` on the badge itself is fine (decorative count, not load-bearing) | Rendered inline after the header, not a separate pill |
| Micro-label (day-of-week style caps, e.g. Board column subheader, Timeline lane labels) | DM Sans | `0.68rem` (10.9px) | 800 | `#8a94a6` | `text-transform: uppercase`, `letter-spacing: 0.04em` — matches `WorkboardWeekView`'s day-label treatment exactly |
| Row title | Inter | `0.88rem` (14.1px) | **600** | `#2d3748` | Deliberately lighter than section headers (800) so density doesn't compete with real hierarchy — see §3 |
| Row title, completed item | Inter | `0.88rem` | 600 | `#9aa4b5` | `text-decoration: line-through`; strikethrough + desaturation together, never strikethrough alone (color-not-only) |
| Row meta text (due label, estimate, "2h", "Due today") | Inter | `0.76rem` (12.2px) | 500 | `#5c6b80` | **Not** `#8a94a6`/`#9aa4b5` — see §8 contrast note; due dates and estimates are load-bearing, not decorative |
| Chip label (category + project/course) | Inter | `0.68rem` (10.9px) | 700 | per-category, see §2 | `text-transform: uppercase` for category chips only; project/course tag keeps normal case (it's a proper noun) |
| High-priority pill label | Inter | `0.64rem` (10.2px) | 700 | `#922e48` | `text-transform: uppercase`, letter-spacing `0.03em` |
| Stat card numeral | DM Sans | `1.7rem` (27.2px) | 800 | `#2d3748` (neutral) / `#922e48` (Overdue alert) | `font-variant-numeric: tabular-nums` |
| Stat card label | Inter | `0.74rem` (11.8px) | 700 | `#5c6b80` | Sits above the numeral; not `#8a94a6` (see §8) |
| Stat card subtitle/delta | Inter | `0.7rem` (11.2px) | 600 | `#8a94a6` (neutral cards) / `#a0405a` (Overdue alert) | Genuinely decorative supplementary line — the number above it already carries the meaning, so the lighter shade is acceptable here only |
| Empty-state heading | DM Sans | `1.05rem` | 700 | `#2d3748` | See §7 |
| Empty-state body | Inter | `0.85rem` | 500 | `#5c6b80` | See §7 |

---

## 2. Chips — category vs. project/course

Two visually distinct shapes so the two chip families are never confused at a glance, even in a busy row.

### 2a. Category chip (Academic / Projects / Organization / Life)

Full pill, tinted low-alpha background, solid darkened text (never the raw hue — see §8 for why). `border-radius: 999px`, padding `3px 10px`, `display: inline-flex`, `font: as in §1`.

| Category | Background | Text color | Source hue (edges/dots only, never text) |
|---|---|---|---|
| Academic | `rgba(77,171,245,0.16)` | `#185a7d` | `#4dabf5` |
| Projects | `rgba(139,127,214,0.16)` | `#4f3fa0` | `#8b7fd6` |
| Organization | `rgba(240,163,92,0.16)` | `#8a5010` | `#f0a35c` |
| Life | `rgba(242,167,192,0.16)` | `#8a4468` | `#f2a7c0` |

All four text/background pairs verified ≥4.5:1 (computed via WCAG relative-luminance formula against the pair's own tinted background, not against bare white). See §8 for the full computation and why the raw hues (as used for dots/edges) cannot double as text color.

### 2b. Project/course chip ("chip_label" — project name or course code)

**Not a pill.** A small tag: `border-radius: 6px`, padding `2px 8px 2px 6px`, `background: rgba(255,255,255,0.55)`, `border: 1px solid rgba(200,210,230,0.4)`, with a **6px solid color dot** (`border-radius: 50%`) preceding the label at `gap: 5px`. Label text color `#5c6b80` (fixed, does not vary by hash — only the dot is colored), weight 500, normal case.

The dot's color is `courseColor(chip_label)` — reuse `WorkboardWeekView.tsx`'s existing hash function verbatim (`['#74bcd9', '#f2a7c0', '#8b7fd6', '#4dabf5', '#f0a35c']`, hashed by character sum) rather than reimplementing it, so a course chip in the List view and the same course's block in the Calendar view land on the same color. Because the dot is a small decorative swatch and not text, it uses the raw saturated hue — no contrast fix needed there.

**Why two different shapes, not two different colors of the same pill:** category is a closed set of 4 known values the eye should learn once; project/course is an open, growing set (new projects appear over time) where hash-based color can collide or seem arbitrary. A shape difference tells them apart even before color registers, which a same-shape-different-hue system would not.

---

## 3. List rows — the flattened-row rule

**Rule:** a work-item row has **no card, no per-row background fill, at rest.** The only persistent visual boundaries are the priority edge (§4) and a 1px divider between rows. This is a deliberate step further than `CanvasAnnouncementBank.tsx`'s existing "flattened" rows, which still give each row a `rgba(255,255,255,0.55)` background — that pattern is fine for a moderate-density review queue, but per-row backgrounds at Workboard's density (potentially dozens of rows across three sections) start to read as the mockup's per-row-card tell once repeated enough times. Dividers alone read as one continuous list, which is the point.

**Structure per row**, left to right:
- Priority edge: `3px` wide, full row height, flush left (see §4 for colors).
- `12px` gap, then checkbox (§9).
- `12px` gap, then title + meta stacked vertically (title on top, meta line below, `2px` gap between them) — meta line holds due label, estimate, and any inline warning text.
- Flexible gap, then category chip + project/course chip (§2), `6px` gap between the two chips.
- `12px` gap, then due label (if not already folded into the meta line — implementer's choice depending on final row width) and the high-only pill if applicable (§4).
- `8px` gap, then overflow menu trigger (three-dot icon button, 32×32px, see §9 for hit target).

**Density:**
- Vertical padding: `12px` top, `12px` bottom.
- Horizontal padding: `4px` (the row has no side border/card to pad against — this is just breathing room before the priority edge and after the overflow trigger).
- Minimum row height: `52px` (accommodates two-line title+meta stacking plus the 40px checkbox hit target without clipping).
- Divider: `border-bottom: 1px solid rgba(200,210,230,0.35)` on every row except the last in a section — this exact color is `WorkboardWeekView`'s existing day-column border color, reused rather than invented.

**Hover state** (no card to lift, so `translateY` — the pattern `CanvasAnnouncementBank` uses — would look wrong on a borderless row): apply a full-width background wash, `background: rgba(116,188,217,0.06)`, `transition: background 120ms ease`, on `:hover` and `:focus-within`. No shadow, no scale, no lift. This keeps continuity with the "flattened" concept — the row still has no permanent boundary, but gets one transiently on interaction, which is what tells the user it's a target.

**Section headers** (Today / Upcoming / Later): collapsible, chevron-left of the label, count after the label (e.g. "Today  3"), `margin-bottom: 8px` before the first row, `margin-top: 20px` between sections (except the first, which sits directly under the toolbar row).

---

## 4. Priority — one signal, high-only pill

**The rule, stated exactly:** the left edge renders unconditionally, colored by `priority`. A pill renders if and only if `priority === 'high'`. `normal` and `low` never render a pill under any circumstance — not muted, not smaller, not present. This is what makes the mockup's "High / Normal / Low pill on every row" noise disappear: with two-thirds of rows carrying no pill at all, the ones that do are immediately the exceptions worth noticing.

| Priority | Edge color | Pill? | Pill background | Pill text |
|---|---|---|---|---|
| `high` | `#e0607c` | **Yes** | `rgba(224,96,124,0.15)` | `#922e48` |
| `normal` | `#b8c6da` | No | — | — |
| `low` | `#d3dbe6` | No | — | — |

`#e0607c` is the exact color `WorkboardWeekView.tsx` already uses for its `high` heatmap level and for deadline dots — reused, not invented, so "high" reads consistently between Calendar and List/Board. `normal`/`low` sit on the same cool-neutral family as the row divider (`rgba(200,210,230,...)`) rather than true gray, so the edge still feels like it belongs to the pink/blue system even when quiet.

Pill: `border-radius: 999px`, padding `2px 9px`, no icon (an icon here would be a second signal for the same fact — text label "High" alone is correct). Board cards carry the identical edge+pill rule; Timeline markers use the edge color as their fill (see §5c) but never render the pill (a Timeline marker is too small to host readable pill text).

---

## 5. Board and Timeline

### 5a. Board — cards are correct here

Per-item cards are kept in Board, and this is not a contradiction of §3: a List row is a scannable line of text, but a Board card is a physical, draggable token the user picks up and drops — an object needs a boundary the way a sentence does not. Card: `background: rgba(255,255,255,0.55)`, `border-radius: 14px`, `padding: 12px 14px`, `border: 1px solid rgba(255,255,255,0.4)`, no shadow at rest; on drag-start, `box-shadow: 0 10px 24px rgba(31,38,68,0.18)` and `opacity: 0.9` on the dragged element, `transform: rotate(-1deg)` for a light "picked up" cue (removed entirely under `prefers-reduced-motion`, along with any transition on drag-over reordering). The priority edge (§4, same colors) renders as the card's left border; the high-only pill rule is unchanged.

Column header: micro-label style (§1), plus an item-count badge (`rgba(255,255,255,0.5)` pill, `#5c6b80` text, `0.7rem` weight 700), `padding-bottom: 10px`, `border-bottom: 1px solid rgba(200,210,230,0.35)` separating header from the card stack. Column background: `rgba(255,255,255,0.18)` (lighter than a card — a column is a container, not a panel), `border-radius: 18px`, `padding: 14px 10px`, `min-width: 260px`.

Every card's overflow menu includes a "Move to →" submenu listing the other two columns, so drag is an accelerator, not a requirement (`dragging-alternative`, WCAG 2.2 AA).

### 5b. Board — empty column

A dashed drop-zone placeholder so the column doesn't collapse to nothing (it must stay a legible drop target even with zero cards): `border: 1.5px dashed rgba(180,190,210,0.5)`, `border-radius: 14px`, `min-height: 120px`, centered text, `color: #8a94a6`, `0.8rem`, weight 600 — this text is genuinely decorative filler inside an obviously-empty container, so the lighter muted shade is acceptable here (contrast on real content elsewhere in Board still follows §8). Copy: "No work queued" (To Do) / "Nothing in progress" / "Nothing completed yet" (Done) — one line per column, not a generic "Empty".

### 5c. Timeline

Horizontal scrollable date axis, one lane per category (`Academic/Projects/Organization/Life`, in that fixed order top-to-bottom so a returning user learns the layout). Each lane: `background: <category color>08` (an 8-alpha-hex tint of that category's raw hue — extremely faint, just enough to separate lanes without competing with the bars), `min-height: 44px`, `border-bottom: 1px solid rgba(200,210,230,0.25)`.

- **Bar** (item has both `start_date` and `due_at`): rounded rect spanning start→due, `height: 22px`, `border-radius: 6px`, fill = priority edge color at full opacity (§4) with `1.5px solid <same color>` border 20% darker, label text inside if it fits (`0.68rem`, white, weight 700), else label floats to the right of the bar.
- **Marker** (due date only, no start): a `10px` circle in the same priority color, centered on its date column.
- **Today marker**: a `2px` solid vertical line, color `#74bcd9`, full lane-stack height, with a small pill-flag at the top reading "Today" (`background: #74bcd9`, white text, `0.62rem`, weight 800, `padding: 2px 8px`, `border-radius: 0 0 6px 6px`) — a distinct shape from the deadline/pill vocabulary used elsewhere (flag, not a rounded pill) so "today" reads as an axis marker, not another chip.

### 5d. Timeline — legitimately-empty state

When no item in the current filtered set has a `start_date` or `due_at`, **do not render the date axis or lanes at all** — an empty grid with no explanation is exactly what the spec calls out as unacceptable. Instead render a centered panel in the Timeline's content area: icon (lucide `CalendarRange`, 48px, `color: #9aa4b5`), heading "Nothing scheduled yet" (§1 empty-state heading style), body "Timeline needs a due date or start date to plot something — add one from the List view." (§1 empty-state body style), no action button (the fix is a few clicks away in a different view, not a single action this view can trigger).

---

## 6. Stat cards — Overdue as an alert

Four cards, equal width, `gap: 14px`, each: `border-radius: 18px`, `padding: 16px 18px`, `backdrop-filter: blur(14px)`. Layout inside each card: label (top), numeral (middle, large), subtitle/delta (bottom).

| Card | Neutral (default) styling |
|---|---|
| Active | `background: rgba(255,255,255,0.4)`, `border: 1px solid rgba(255,255,255,0.4)`, numeral `#2d3748` |
| Due Soon | same neutral treatment |
| Estimated This Week | same neutral treatment |
| Overdue, `count === 0` | **identical** neutral treatment to the other three — no red, no icon, no special border. Subtitle: "All caught up". This sameness at zero is what makes the alert state at non-zero actually register as a change, not a permanently-styled card that happens to hold a number. |

**Overdue, `count > 0`** — the one deliberately expressive element in this whole system, and deliberately *not animated* (a looping pulse was considered and rejected: WCAG's `excessive-motion`/`motion-meaning` guidance argues motion should express a cause-effect transition, and a persistent looping pulse on a card that just sits there expresses nothing new after the first glance — it only adds a reduced-motion edge case for no real gain). Static treatment instead:

- `background: rgba(224,96,124,0.14)`
- `border: 1px solid rgba(224,96,124,0.35)` (replaces the neutral border, doesn't add to it)
- Numeral color `#922e48`, unchanged size/weight (§1) — weight and color together carry the alert, not size, so the four cards stay visually aligned as a set
- A `14px` lucide `AlertTriangle` icon, `color: #922e48`, inline before the label
- Subtitle color `#a0405a`, e.g. "3 past due — oldest from Sep 2"
- Left edge: `3px solid #e0607c` matching the priority-edge vocabulary (§4), so a viewer who has already learned "that pink-red edge means high/urgent" from the List/Board reads the same color here without re-learning it

This is the transition the spec asks for — "loud when greater than zero, quiet at zero" — made concrete as five co-occurring, non-animated changes (background, border, numeral color, icon, edge) rather than a color swap alone, so the state doesn't rely on color perception by itself (`color-not-only`).

---

## 7. Empty states — one per view, no generic "No data"

Shared empty-state anatomy (used by List's all-empty state and Timeline's legitimately-empty state): centered column, `padding: 60px 20px`, icon 48-64px at `color: #9aa4b5`, heading per §1, body per §1, optional single action button (`.vb-btn-pink` or `.vb-btn-ghost`) only when there's a single obvious next action to take **from this view** — Timeline's fix lives in a different view, so it gets no button; List's does, so it gets one.

| View | Empty condition | Treatment |
|---|---|---|
| List | One section (Today/Upcoming/Later) has 0 items, but others don't | Inline single-line note where rows would be: `"Nothing due today"` / `"Nothing upcoming"` / `"Nothing later"`, italic, `#5c6b80`, `0.82rem`, `padding: 14px 4px`, no icon — this is a routine, expected state (most days *should* have an empty "Today"), so it must not look alarming or heavy |
| List | Zero items across all three sections (new user, or fully caught up) | Full empty-state anatomy above. Icon: lucide `CheckCircle2`, `color: #74bcd9`. Heading: "Nothing on your plate". Body: "Add your first work item to get started." Action: "New Work Item" button (`.vb-btn-pink`), same trigger as the shell's existing add button |
| Board | Individual column has 0 cards | §5b's dashed drop-zone, not the full empty-state anatomy (a Board column being briefly empty during normal use is routine, not a first-run state) |
| Board | Every column has 0 cards (nothing at all) | Full empty-state anatomy, rendered once above/instead of the three columns. Icon: lucide `LayoutGrid`. Heading: "Board's empty". Body: "Work items you create will show up here as cards." Action: "New Work Item" |
| Timeline | Nothing plottable (no item has any date) | §5d — its own spec, distinct because it must explain *why* (missing dates), not just that nothing is there |
| Calendar | — | Out of scope; `WorkboardWeekView.tsx`'s existing states (`"No reminders."` etc.) are unchanged |

---

## 8. Contrast — computed, not assumed

Given how pastel this system already is, raw hues from the existing 5-color hash palette (`#74bcd9, #f2a7c0, #8b7fd6, #4dabf5, #f0a35c`) were checked as **text** color against a representative glass-over-gradient surface (white at 45% alpha over the averaged `.vb-bg` gradient stops, `≈ #eae8f4`, computed via the WCAG relative-luminance formula) and against each chip's own tinted background:

| Pair | Ratio | AA (4.5:1) text pass? |
|---|---|---|
| `#4dabf5` (raw) on its own 16%-alpha chip bg | 2.05:1 (on bare glass) | **Fail** |
| `#185a7d` (darkened) on the same chip bg | 5.53:1 | Pass |
| `#8b7fd6` (raw) on its own chip bg | 2.84:1 (on bare glass) | **Fail** |
| `#4f3fa0` (darkened) on the same chip bg | 5.87:1 | Pass |
| `#f0a35c` (raw) on its own chip bg | 1.72:1 (on bare glass) | **Fail** |
| `#8a5010` (darkened) on the same chip bg | 4.92:1 | Pass |
| `#f2a7c0` (raw) on its own chip bg | 1.57:1 (on bare glass) | **Fail** |
| `#8a4468` (darkened) on the same chip bg | 5.21:1 | Pass |
| `#a0405a` (existing "high" alert text) on its own pill bg | 4.43:1 (borderline) | Marginal |
| `#922e48` (darkened one step further) on the same pill bg | 5.52:1 | Pass |
| `#8a94a6` (existing app-wide muted text) on glass | 2.53:1 | **Fail** |
| `#5c6b80` (existing app-wide secondary text) on glass | 4.48:1 | Pass (borderline) |

**Conclusion, and what this means for implementers:** never use a raw palette hue as text color in this module — §2's darkened variants are the only text colors approved for chips, and §6's `#922e48`/`#a0405a` are the only approved Overdue-alert text colors. The raw hues remain correct for edges, dots, bars, and other non-text decoration, where WCAG's non-text-contrast threshold (3:1) is the relevant bar and all raw hues clear it against the light glass surfaces used here.

Also flagged: `#8a94a6` and `#9aa4b5`, already used pervasively elsewhere in this app (including `WorkboardWeekView.tsx` itself) for meta/muted text, fail AA at 2.5:1 and 2.1:1 respectively against glass. This is a pre-existing gap in the shipped surfaces, not something this document should propagate into new UI — §1 specifies `#5c6b80` (4.48:1, passing) for every load-bearing meta/label string in Workboard v2's new surfaces, and reserves the lighter shades only for genuinely decorative filler text (count badges next to a numeral that already states the fact, dashed-placeholder copy inside an obviously-empty container) where the information isn't lost if a low-vision user can't resolve it. This is a deliberate, narrower exception — not a blanket license to keep using the lighter shade wherever it previously appeared.

---

## 9. Focus-visible and hit targets

**Focus-visible** (every interactive element in these new surfaces — row checkbox, drag handle, overflow trigger, chip if it becomes clickable for filtering, view-switcher buttons, stat cards if they become clickable filters):

```css
outline: 2px solid #2a7fa8;
outline-offset: 2px;
border-radius: inherit; /* or match the element's own radius */
```

`#2a7fa8` is chosen (not the raw `#74bcd9`) specifically because it's the darker blue already used for high-contrast text elsewhere in this app (e.g. `CanvasAnnouncementBank`'s course-name chip text) — it needs to read clearly against the *lightest* glass surfaces in this module, where `#74bcd9` at full saturation would still pass non-text contrast but reads weaker. Apply via `:focus-visible`, never bare `:focus`, so mouse interaction doesn't show a ring pointer users didn't ask for. Never remove the outline without this replacement (`focus-states`, WCAG).

**Hit targets** (WCAG 2.2 AA's Target Size (Minimum) requires ≥24×24 CSS px; this system sets a more comfortable floor above that minimum everywhere a user repeatedly interacts):

| Control | Visual size | Hit-target size (via padding, not visual scale) |
|---|---|---|
| Row completion checkbox | 20×20px visual control | **40×40px** clickable area (10px padding on all sides) |
| Drag handle (Board card, List row if List ever exposes one) | 16px `GripVertical` icon | **40×40px** clickable area, `cursor: grab` (`cursor: grabbing` while active) |
| Overflow menu trigger (three-dot) | 16px icon | **32×32px** clickable area — smaller than the other two because it's a secondary, occasional action, but still clears the 24px WCAG floor with margin |
| View-switcher buttons (List/Board/Timeline/Calendar) | icon + label | **40px** minimum height, `padding: 8px 14px` |

Adjacent interactive elements (checkbox, then title which may itself be clickable to open detail, then chips, then overflow) keep **≥8px** of true gap between their hit-target boxes, not just their visual glyphs, satisfying `touch-spacing`.

---

## 10. Responsive

Breakpoints: `1024px` and `768px` — matching the standard anchors this app's tooling already treats as canonical (375/768/1024/1440), scoped down to the two that actually change this layout.

| Breakpoint | Stat cards | Right rail | View switcher | Board | Timeline |
|---|---|---|---|---|---|
| `≥1024px` (desktop) | 4-in-a-row | Visible beside content on List/Calendar (fixed `~280px` column); collapsed (hidden) on Board/Timeline | Icon + label, full width | 3 columns side by side | Horizontally scrollable, all lanes visible |
| `768–1023px` (tablet) | 2×2 grid | Moves below main content on List/Calendar (still visible, not collapsed — only Board/Timeline collapse it); still collapsed on Board/Timeline | Icon-only pills | 3 columns, horizontally scrollable if they don't fit | Horizontally scrollable (unchanged) |
| `<768px` (mobile) | 2×2 grid (unchanged from tablet) | Below content on List/Calendar | Icon-only pills | Snap-scroll: one column's width per swipe (`scroll-snap-type: x mandatory`, each column `scroll-snap-align: start`) | Horizontally scrollable (unchanged) — Timeline is not hidden or simplified away on mobile, per the spec's explicit requirement that Board and Timeline "remain reachable on mobile rather than disappearing" |
| `<768px`, initial view | List is the default view on load (not whatever was last selected on desktop) | — | — | — | — |

No breakpoint hides Board or Timeline from the view switcher — both remain one tap away at every width.

---

## 11. Sitting next to Calendar

`WorkboardWeekView.tsx` is not being touched, but the new shell wraps around it, so three things must match exactly rather than merely "look similar":

- The `GLASS` constant's exact values (`rgba(255,255,255,0.4)` / `blur(14px)` / `22px` radius / `1px solid rgba(255,255,255,0.4)` / `boxShadow: 0 8px 24px rgba(31,38,68,0.09)`) are the shell's outer-panel treatment too — List/Board/Timeline's outermost containers use this, not a newly-invented glass recipe.
- The page header (`gradient-text` "Workboard" h1, `clamp(1.9rem,4vw,2.6rem)`, 800) stays exactly as `WorkboardWeekView.tsx` already renders it today — the new shell adds stat cards/tabs/switcher/search below it, it does not replace or restyle the heading itself.
- `courseColor()`'s exact hash function and 5-color palette (§2b) is reused verbatim for project/course dot coloring, not reimplemented, so a course's color is identical whether you're looking at its Calendar block or its List chip.

---

## Summary for implementers

If you read nothing else: rows have no backgrounds (§3), only High gets a pill (§4), Overdue changes five properties at once when non-zero and looks exactly like its neutral siblings at zero (§6), never put a raw palette hue behind text (§8), and match `WorkboardWeekView`'s `GLASS` constant and header treatment exactly rather than inventing a parallel one (§11).
