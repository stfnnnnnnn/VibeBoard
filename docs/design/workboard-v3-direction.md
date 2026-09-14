# Workboard v3 — Visual Direction (addendum to v2)

**Status:** Approved direction, ready to implement against
**Date:** 2026-09-12
**Scope:** the surfaces v3 adds that `docs/design/workboard-v2-direction.md` never had to describe — header context navigation, Table density, context colour accents, four new visual states, and the restrained Overdue treatment. Everything v2 specified stands unchanged.

This is an **addendum, not a replacement**. `docs/design/workboard-v2-direction.md` is a reviewed, shipped document; it is not edited by this one and nothing it already covers is restated here. Where a v3 surface extends or reuses a v2 decision, this document cites the v2 section and moves on.

**Two kinds of `§` reference appear below, and they are not the same numbering.** A bare `§N` is a section of the v2 direction document. A `spec §N` is one of the 36 numbered items in the refinement specification that `docs/superpowers/specs/2026-09-08-workboard-v3-design.md` is derived from. Sections here continue v2's numbering from §13, so the two documents can be read end to end as one design language.

**Every value below is either transcribed from shipped code or stated as a new decision, and the two are marked.** A line reading *(shipped)* names a file and can be verified by reading it; a line reading *(new)* is a decision this document makes for a surface Tasks 34–40 have yet to build. Nothing here is aspirational — where shipped code already answers a question, the shipped answer wins and this document records it rather than re-deciding it.

---

## §14. Header context navigation vs. the view selector

Spec §1 moves context navigation into the header, aligned with the title, and leaves the four-view selector in the toolbar row below the stat cards. It requires that **the two rows must not both read as identical pill groups.**

That requirement is already half-answered by shipped code, and the answer does not change: §13 established the underline-indicator pattern for the category tabs precisely because "giving them the same pill-fill look would make it genuinely ambiguous at a glance which control changes the *view* and which changes the *filter*." v3 moves that row into the header; it does not redesign it. The pattern's whole justification gets *stronger* when the two rows are further apart, because position alone can no longer be relied on to tell them apart in a cropped view.

### 14a. The five differences, stated as a checklist

Two "pick one of a few" controls now sit in one header block. They differ on five axes simultaneously, so no single axis is load-bearing:

| Axis | Context row (§14b) | View selector (§9) |
|---|---|---|
| **Shape** | Underline indicator on a transparent ground | Filled pill, `border-radius: 999px` |
| **Active signal** | `2px` bottom indicator + text darkens `#5c6b80` → `#2d3748` | Inverts to `#ffffff` on solid `#256f92`, border removed |
| **Resting boundary** | None — `background: transparent`, `border: none` | `rgba(255,255,255,0.5)` fill, `1px solid rgba(200,210,230,0.5)` |
| **Typeface** | DM Sans (the app's titling face) | Inter (the app's UI face) |
| **Position** | Header block, right-aligned against the `h1` | Toolbar row, below the stat cards |

### 14b. Context row — exact treatment

Five items, in shipped order: **My Work · Academic · Projects · Organization · Life** *(shipped: `WorkboardShell.tsx:58` `CATEGORY_TABS`, My Work first)*. Spec §1 lists them Academic-first; the shipped order is kept, because §13 reserves the gradient indicator for "the single top-level/combined thing on a page" and a combined item reads as combined when it leads the row.

- **Container:** `display: flex; gap: 4px; flex-wrap: wrap`, `border-bottom: 1px solid rgba(200,210,230,0.35)` *(shipped: `WorkboardShell.tsx:210`)*. **The container is shrink-to-fit in the header, not full width** *(new)* — a page-wide rule under a right-aligned group would read as a page divider rather than as this control's own baseline. Implement as `align-self: flex-end` on the group inside the header's flex row; do not give it `width: 100%`.
- **Each item:** `position: relative`, `padding: 10px 16px`, `min-height: 40px` (explicit, never padding-derived), `background: transparent`, `border: none`, `font-size: 0.82rem`, weight **700 in both states** so switching never reflows the row *(shipped: `WorkboardShell.tsx:224–229`)*.
- **Typeface:** `"'DM Sans','Segoe UI',sans-serif"`, `letter-spacing: 0` *(new — shipped uses Inter here)*. This is the one deliberate change v3 makes to the row as it moves. DM Sans is already this app's titling face (§1 sets the `h1`, every section header, and every micro-label in it); the context row is now part of the title block, so it takes the title block's face. It also gives the two rows a fifth point of difference that survives a screenshot cropped free of position. Weight stays 700 — below §1's 800 for true section headers, so the row never competes with the heading beside it. `letter-spacing` is stated as `0` explicitly so nobody adds §1's `0.04em` uppercase tracking to a sentence-case label.
- **Inactive:** text `#5c6b80`, indicator `2px` transparent (space reserved, so selection never shifts layout) *(shipped: `WorkboardShell.tsx:228, 236`)*.
- **Active:** text `#2d3748`, indicator `2px`, `position: absolute; left: 0; right: 0; bottom: -1px` so it sits *over* the container's `1px` baseline rather than doubling it *(shipped: `WorkboardShell.tsx:232–239`)*.
- **Indicator colour:** solid `#74bcd9` for the four single-context items; `linear-gradient(to right, #f2a7c0, #74bcd9)` for My Work *(shipped: `WorkboardShell.tsx:236–238`)*.

**The indicator is never the context's own hue, and §16 makes that ruling stronger rather than weaker.** §13 refused `#4dabf5`/`#8b7fd6`/`#f0a35c`/`#f2a7c0` here because one hue would carry two unrelated jobs — "this item belongs to Academic" on a chip, "you have filtered to Academic" on a tab. v3 now spreads those same four hues across dots and lane edges throughout the module (§16), so the collision the ruling anticipated would happen on more surfaces, not fewer. The ruling stands verbatim.

### 14c. Accessibility — two roving groups in one header

- The context row keeps `role="radiogroup"` with `role="radio"` children and `aria-checked`; the view selector keeps `role="tablist"` with `role="tab"`, `aria-selected` and `aria-controls` *(shipped: `WorkboardShell.tsx:210, 218–219, 255, 262–264`)*. The distinction is real and must not be flattened when the rows move apart: the contexts filter one panel, the views swap panels. Spec Task 34 states the same requirement.
- Both use a roving `tabIndex` *(shipped: `WorkboardShell.tsx:220, 265`)*, so Tab reaches each group exactly once and arrow keys move within it. **Arrow keys must never cross from one group into the other.**
- **The context group's accessible name changes to `aria-label="Filter by context"`** *(new)*. Shipped is `"Filter by category"` *(`WorkboardShell.tsx:210`)*, and spec §4 renames Category → Context throughout the UI and the service layer. A screen-reader user must not be the last person still hearing the old domain word.
- Selection is never carried by the indicator alone — the text colour changes with it *(`color-not-only`)*, already true in shipped code and preserved by 14b.

---

## §15. Table density

The Table is the module's densest surface (spec §27: tighter than Rituals or Finance). **Nearly every value in this section is shipped** — `src/components/workboard/views/WorkTableView.tsx` and the four cell components under `src/components/workboard/table/`. This section is a record, not a redesign, with one exception noted where it occurs (§15d); a later task changing anything else in it is changing shipped pixels.

### 15a. Row and cell

| Property | Value | Source |
|---|---|---|
| Cell padding, text columns | `7px 12px` | `WorkTableView.tsx:941` |
| Cell padding, the four interactive column *components* (five columns: Status, Priority, Deadline, Time, Links) | `2px 12px` | `StatusCell.tsx:157`, `PriorityCell.tsx:168`, `DeadlineCell.tsx:37`, `LinksCell.tsx:30` |
| Cell type | Inter `0.8rem`, weight 500, `#5c6b80` | `WorkTableView.tsx:950–952` |
| Status / Priority cell weight | 600 (overrides the above) | `WorkTableView.tsx:986, 994` |
| Vertical alignment | `middle` | `WorkTableView.tsx:948` |
| Wrapping | `nowrap` on every cell except Work, which is `normal` | `WorkTableView.tsx:949, 963` |
| Work-cell title | Inter `0.88rem`, weight 600, `max-width: 340px`, single-line ellipsis | `WorkItemRow.tsx:242`, `WorkTableView.tsx:973` |
| Priority edge | `3px solid` §4's edge colour, as the **first cell's left border** | `WorkTableView.tsx:946` |
| Divider | `border-bottom: 1px solid rgba(200,210,230,0.35)`, suppressed on the last row | `WorkTableView.tsx:95, 931, 942` |
| **Zebra striping** | **None.** | — |
| Row hover | `background: rgba(255,255,255,0.45)` | `WorkTableView.tsx:1056–1058` |
| Scroll container | `max-height: 68vh; overflow: auto; border-radius: 12px` | `WorkTableView.tsx:838` |

**No zebra, and this is a rule rather than an omission.** §3's flattened-row principle is that the only persistent boundaries in a work list are the priority edge and a 1px divider. A zebra stripe is a per-row background fill — exactly the thing §3 removed from List because repeated per-row fills read as the mockup's per-row-card tell. The divider plus the `12px` horizontal cell padding already give the eye a line to track; adding a fill would also put a second background behind the four inline controls, each of which carries its own `rgba(255,255,255,0.6)` ground, and the controls would stop reading as raised against alternate rows. Row tracking on a wide table is instead handled by the hover wash above, which is transient and therefore cannot accumulate into a pattern.

### 15b. Row height — the arithmetic, verified

The reason the interactive columns override their vertical padding to `2px` is that their control is taller than a line of text, and a table row is as tall as its tallest cell. The numbers reconcile:

| Cell | Computation | Height |
|---|---|---|
| Plain text cell | `7` + line box of Inter `0.8rem` (≈`15`) + `7` | **29px** |
| Work cell (the governor) | `7` + line box of Inter `0.88rem` (≈`17`) + `7` | **31px** |
| Status / Priority / Deadline / Time / Links cell | `2` + control `26` + `2` | **30px** |

**Row height: `31px`, set by the Work cell.** Every interactive cell lands at `30px` and therefore disappears inside that height rather than adding to it. Had the four control cells kept the shared `7px`, they would compute to `7 + 26 + 7 = 40px` and inflate every row by `9px` — a 29% height increase across the module's densest surface. This is stated as arithmetic rather than as a fixed `height` so a row that must grow (a wrapped Work title) still can.

### 15c. Inline control sizing

One rule governs every control that sits in a cell *(shipped across all four cells)*, with one named exception:

- `box-sizing: border-box`, `min-height: 26px`, `border-radius: 8px`, `background: rgba(255,255,255,0.6)`, `border: 1px solid rgba(200,210,230,0.6)`, Inter `0.76rem`, weight 600, `line-height: 1.2`.
- Horizontal padding varies with the control's own affordance: `2px 4px 2px 7px` for a native `<select>` (the shorter right pad leaves room for the UA disclosure arrow) *(`StatusCell.tsx:175`, `PriorityCell.tsx:186`)*; `2px 8px` for a button trigger *(`DeadlineCell.tsx:681`, `LinksCell.tsx:141`)*.
- **`appearance: none` is deliberately not set on the `<select>`s** *(`StatusCell.tsx:173`)* — the native disclosure arrow is the affordance that says the cell is editable at all, and a table of borderless text with no arrows gives the user nothing to discover.
- The `26px` control clears WCAG 2.2 AA's 24px Target Size floor on its own, so shrinking the cell padding costs nothing in reachability.
- Hover: `border-color: rgba(140,160,190,0.75)`. Focus: §9's ring, `2px solid #2a7fa8`, `outline-offset: 2px`, applied through `:focus-visible` only.
- In-flight: `opacity: 0.65` with the control disabled, never a colour swap — the UA's own disabled rendering greys text below §8's contrast floor, and this is a transient state, not a permanently unavailable control *(`StatusCell.tsx:179–182`)*.
- **The named exception:** the Priority select's `high` value overrides both the shared background and weight — `rgba(224,96,124,0.15)`, weight 700 *(`PriorityCell.tsx:192–194`)*. This is deliberate, not a drift from the rule above: it is §18's chip-scale red fill, applied to the one control that carries a priority value, and §18 records why that scale is permitted. A future edit to §15c's shared control style should not "fix" this override into matching every other cell.

**Every one of these rules must live in the component that renders the control, not in `WorkTableView`.** styled-jsx hashes its scope per component, so a `.vb-status-select` rule written in the view compiles cleanly and matches nothing. This trap has been hit repeatedly in this module and is recorded here so §15 cannot be implemented into it again.

### 15d. Sticky header — shadow, not border

| Property | Value | Source |
|---|---|---|
| Stickiness | `position: sticky; top: 0; z-index: 1`, **on the `<th>`, never on `<thead>`** | `WorkTableView.tsx:869` |
| Cell padding | `2px 12px` | `WorkTableView.tsx:875` |
| Background | `rgba(255,255,255,0.95)` | `WorkTableView.tsx:876` |
| Bottom rule | `box-shadow: inset 0 -1px 0 rgba(200,210,230,0.55)` | `WorkTableView.tsx:881` |
| Label | DM Sans `0.68rem`, weight 800, `uppercase`, `letter-spacing: 0.04em` — §1's micro-label | `WorkTableView.tsx:902–903` |
| Label colour | `#5c6b80`, darkening to `#2d3748` on hover and on the sorted column | `WorkTableView.tsx:1066–1073` |
| Sort trigger | a real `<button>`, `padding: 7px 0`, so the whole `27px` strip is the click target | `WorkTableView.tsx:887, 898` |
| Caret slot | always rendered, `12px` square, empty when inactive | `WorkTableView.tsx:911–916` |

**The bottom rule is an inset box-shadow and not a `border-bottom`, and this is load-bearing rather than stylistic.** Under `border-collapse: collapse` the border belongs to the table, not to the cell. A sticky `<th>` therefore takes its background with it on scroll and leaves its border behind — the header ends up floating on undivided rows. An inset shadow is painted by the cell, so it travels. Any later change to this divider must stay a shadow.

Two supporting rules are part of the same decision. `position: sticky` is on the `<th>` because sticky on a table *section* is unreliable across browsers while sticky on the cells is not. The background is `rgba(255,255,255,0.95)` rather than a glass fill because the header has to be opaque enough to hide the rows travelling under it, and the `0.05` of transparency that remains is all the glass system gets here.

**`scroll-padding-top: 36px` on `.vb-table-scroll`** *(new)*. Tabbing between inline controls scrolls the container to bring the next control into view, and the sticky header will sit on top of it — WCAG 2.2 AA *Focus Not Obscured (Minimum)* forbids persistent UI fully covering the focused control. The header's own height is `2 + 27 + 2 = 31px`, and §9's focus ring extends `4px` beyond a control's box (`2px` outline at `2px` offset), so `35px` is the floor. `36px` is used instead of the bare floor because it is `3 × 12` — a value on §3's own `12px` spacing rhythm, the same one §15e cites for the phone card's left padding — rather than an arbitrary number one pixel above the minimum. This is the one gap §15 adds to shipped code rather than records.

### 15e. Below `768px` the table is not a table

The `<table>` element is not rendered at all on phone; the view returns a `<ul role="list">` of cards *(shipped: `WorkTableView.tsx:689–704`)*. Card metrics: `padding: 10px 8px 10px 15px`, `min-height: 82px` (a floor, matching §10's two-line List row), `gap: 6px`, divider per §15a, priority edge as a `3px` absolutely-positioned span because a card has no first cell to border *(`WorkTableView.tsx:723–740`)*. The `15px` left padding is §3's `12px` rhythm plus the `3px` edge, so text starts where it does in the table.

The breakpoints are read from JavaScript (`matchMedia` at `768` and `1024`) and **this file contains no `@media` rule at all** *(`WorkTableView.tsx:106–121`)*. Every `<th>` and `<td>` carries inline styles, an inline declaration beats any class selector regardless of source order, and a media query trying to restructure them would compile cleanly and match nothing — the failure that shipped Board's mobile snap-scroll dead in v2. Deciding in JS means no rule has to win that fight.

---

## §16. Context colour accents (spec §28)

### 16a. The four hues are the four that already exist

| Context | Raw hue (decoration only) | Darkened text pair |
|---|---|---|
| Academic | `#4dabf5` | `#185a7d` |
| Projects | `#8b7fd6` | `#4f3fa0` |
| Organization | `#f0a35c` | `#8a5010` |
| Life | `#f2a7c0` | `#8a4468` |

*(shipped: `WorkItemRow.tsx:106–111` `CATEGORY_META`, `WorkBoardView.tsx:33`, `WorkTimelineView.tsx:40` `CATEGORY_HUE`.)*

**These are §2a's hues, unchanged — v3 introduces no new context colour.** Inventing four fresh hues for "context accents" while §2a's four chips keep shipping would give the module two parallel colour systems for the same fact, and a user would have to learn that the blue chip and the teal dot both mean Academic. The hues are already carrying the meaning correctly; spec §28 asks for a quieter *treatment* of that meaning, not a different meaning. Reuse is the whole answer.

The raw/darkened split is §8's and is not negotiable: the raw hue is for non-text decoration only (3:1 non-text threshold), the darkened value is the only approved text colour (4.5:1). §20 recomputes the darkened four for the one new context this section creates.

### 16b. The permitted forms

A context hue may appear in three general-purpose shapes, plus two shapes scoped to Timeline lanes and nowhere else. Nothing outside this list is permitted:

1. **The category chip** — §2a, unchanged. Full pill, `border-radius: 999px`, `padding: 3px 10px`, tinted background at 16% alpha, darkened text, `0.68rem`/700/uppercase *(shipped)*.
2. **The dot** — a `6px` circle, `border-radius: 50%`, raw hue, no border. Identical in size and shape to §2b's project/course dot, deliberately: a user who has learned "small round swatch = which thing this belongs to" reads both without relearning.
3. **The compact label** *(new)* — the dot followed by the context name at the chip's type (`0.68rem`, weight 700, uppercase) in the **darkened** text colour, `gap: 5px`, **no background fill, no padding, no border**. This is the chip with its pill removed: same family, a third of the visual weight. Use it where a full chip would be too heavy for its surroundings but a bare dot would be ambiguous — the Filters popover's context rows (Task 38) only.
4. **The lane tint** *(shipped, Timeline under My Work only)* — `background: <hue>08` on the whole lane, not a dot or a label. See §16c; this is the one case in the module where a context hue *is* a row background, and it is the single named exception to the "never a row background" rule below.
5. **The lane-stack edge** *(new, Timeline under a single context only, Task 39)* — a `2px` left edge on the lane stack's container, replacing form 4 the moment every lane in the stack shares one context. See §16c for why.

**Timeline's lane *label text* is not a context-hue application at all.** It is §1's shipped micro-label — `#8a94a6`, no dot, no context colour — under both forms 4 and 5. The hue lives in the lane's background or the container's edge; the label stays neutral in either state. An earlier draft of this section assigned the lane label to form 3 (the compact label); that was wrong and is corrected here.

### 16c. Where each form goes, and where the hue is forbidden

| Surface | Treatment |
|---|---|
| Focus row, Board card | Form 1, unchanged *(shipped)* |
| Table "Context" cell | **Plain `#5c6b80` text, no dot** *(shipped: `tableColumns.ts:78` + `WorkTableView.tsx:950–952`)*. v3 does not change it — §15's row is `31px` tall and a dot buys nothing a legible label does not already say. |
| Timeline lanes, My Work | Form 4: `background: <hue>08` per lane, `min-height: 44px`, `border-bottom: 1px solid rgba(200,210,230,0.25)` *(shipped: `WorkTimelineView.tsx:221–223`)*; lane label per §1's micro-label, neutral *(`WorkTimelineView.tsx:226–231`)* |
| Timeline lanes, a single context (Task 39) | Form 5: **lanes drop the per-lane tint entirely; the context hue moves to the `2px` edge**, lane label stays the same neutral micro-label *(new)* |
| Filters popover context rows (Task 38) | Form 3, the compact label |
| Detail drawer hierarchy line | Plain `#5c6b80` *(shipped: `WorkItemDetail.tsx:517`)*; unchanged |

**The Timeline ruling deserves its reasoning stated.** Task 39 makes lanes context-aware — courses under Academic, projects under Projects. Inside a single context every lane belongs to that same context, so a per-lane tint would paint every lane the identical colour and distinguish nothing. A colour that is constant across all lanes is not information about lanes; it is information about the container. So it moves to the container, as one `2px` edge, and the lanes go untinted. Under My Work the lanes *are* the four contexts, the tint does distinguish them, and §5c's shipped treatment is correct and unchanged.

**Forbidden, without exception:**

- **Never a row or card background outside form 4.** No tint, no fill, no wash, at any alpha, on any surface other than a Timeline lane under My Work. §3's flattened-row rule is not suspended for colour.
- **Never the §4 priority edge.** That `3px` slot is owned by priority and means high/normal/low. Form 5's `2px` lane-stack edge is a different slot on a different surface (Timeline's own container, which has no priority edge to conflict with) — it does not create a second priority-edge-shaped thing on a row or a card.
- **Never as a raw hue behind or as text** (§8).
- **Never the context navigation indicator** (§14b).
- **Never a due-state, priority, or status signal, and never adjacent enough to be mistaken for one.** The semantic set — `#e0607c`/`#922e48` for overdue and high, `#8a5010` for completed-late and blocked, `#5c6b80` for everything ordinary — always wins. Where a context accent and a semantic colour would occupy the same element, the semantic colour renders and the accent is dropped, not blended, not moved to a border. A context is a fact about where work lives; a due state is a fact about whether it needs attention now, and only the second one is ever urgent.

Note the genuine overlap this creates: `#8a5010` is simultaneously Organization's darkened text colour and the module's completed-late/blocked amber. Two things are true here, not one. **At the element level** the collision is tolerable — Organization's value appears on a chip or compact label, the semantic value on a meta string or a badge, and no single element ever needs to be read as both. **At the card level it is closer than that framing suggests**: an Organization item that is also Blocked, viewed under My Work, shows two amber pills on one Board card — the category chip (`rgba(240,163,92,0.16)` ground) and the Blocked badge (the identical ground, §17b) — 6–8px apart, one meaning "where this lives" and the other "why it's stuck". They are not the adjacent-enough-to-confuse case the "never" rule above forbids, because that rule is about a context hue colliding with a *due-state* signal, and Blocked is a stage, not a due state — but a user glancing at the card sees one colour doing two jobs on the same object. No fix is prescribed here; it is recorded so Task 40's `impeccable` pass evaluates it as a real case rather than discovering it fresh.

---

## §17. New states

### 17a. Completed-late

`#8a5010` — §2a's darkened amber, the only AA-passing amber text colour in this system *(shipped: `WorkItemRow.tsx:132` `META_COLOR.completed_late`; `DeadlineCell.tsx:63` `DEADLINE_COLOR.completed_late`)*.

The full state-to-colour map, which is one table keyed by `DueState` in both files so text and colour can never contradict each other:

| `DueState` | Colour |
|---|---|
| `none`, `upcoming`, `due_today`, `completed` | `#5c6b80` |
| `completed_late` | `#8a5010` |
| `overdue` | `#922e48` |

**Completed-late is amber, not red, and that is the point of having the state at all.** Red is reserved for work that still needs attention. A late completion is finished — the user's attention is no longer required, only the record is imperfect — so it takes the caution colour, not the alert colour. A `Record<DueState, string>` type is what forces a future state to have its colour decided here rather than defaulting into one of these two meanings by accident.

The colour is never the only signal: `formatDueLabel` supplies the word, and the Deadline cell additionally carries a visually-hidden suffix for screen readers *(`DeadlineCell.tsx:49, 658`)*.

### 17b. Blocked badge

A pill: `border-radius: 999px`, `padding: 2px 9px`, `background: rgba(240,163,92,0.16)`, `color: #8a5010`, Inter `0.64rem`, weight 700, `uppercase`, `letter-spacing: 0.03em`, `margin-top: 6px`. Label: `Blocked` *(shipped: `WorkBoardView.tsx:288–294`)*.

Shape-identical to §4's High pill, colour-different — the two sit on the same line and wrap together at `gap: 6px` *(`WorkBoardView.tsx:274`)*, so they read as one badge family with two meanings rather than as two unrelated marks.

**It renders only under My Work** — `context === 'all' && stageOf(item) === 'blocked'` *(`WorkBoardView.tsx:477`)*. My Work normalises `blocked` into the In Progress column (spec §17), so without the badge the state would vanish. Under Projects or Organization `blocked` has a column of its own and the badge would only repeat the heading it sits under.

**It is deliberately not the overdue red.** Blocked means held; overdue means late. The two can be true at the same time on the same card, so they must be separable at a glance *(the reasoning is in the shipped comment at `WorkBoardView.tsx:285–287`)*.

### 17c. The three Table empty states

The Table is the one view with three, because `isFiltered` alone cannot separate "this context has no work yet" — where offering the create button is right — from "a search or filter matched nothing here" — where it is not. Resolved in this order *(shipped: `WorkTableView.tsx:589–651`)*:

| # | Condition | Icon | Heading | Body | Action |
|---|---|---|---|---|---|
| 1 | Nothing at all (`!isFiltered`) | `CheckCircle2`, **56px**, `#74bcd9` | Nothing on your plate | Add your first work item to get started. | **New Work Item** (`.vb-btn-pink`) |
| 2 | A search or a popover filter is narrowing | `SearchX`, **48px**, `#9aa4b5` | No matching work items | Try a different category, search term, or filter. | none |
| 3 | Only the context tab is narrowing | `Table2`, **48px**, `#9aa4b5` | Nothing in *{Context}* yet | Work items you add under this context will appear here as rows. | **New Work Item** (`.vb-btn-pink`) |

Shared anatomy *(shipped)*: `text-align: center`, `padding: 60px 20px`, icon `margin-bottom: 14px`, heading DM Sans `1.05rem`/700/`#2d3748` with `margin: 0 0 6px`, body Inter `0.85rem`/500/`#5c6b80`, button `width: auto; padding: 10px 22px`. The body's bottom margin is `18px` when a button follows and `0` when none does.

**Task 40 widened state 2's condition** *(new)*: the Filters popover (Task 38) can narrow `visibleItems` to nothing with the search box empty and a specific context tab active — the exact shape state 3 was written to claim as "genuinely empty". `isSearching`'s computed value now covers both cases (`query.trim() !== '' || countActiveFilters(filters) > 0`), which is what state 2's condition actually reads; the row above states its real meaning rather than the narrower one that used to be true.

**A known, accepted residual of that widening, not fully closed**: a *genuinely* empty context (zero items in it at all) combined with an active filter now also resolves to state 2, without the create button — even though creating an item is, in that specific case, still the correct fix state 3 would have offered. Closing this fully needs a third signal (an unfiltered per-context item count) that no current prop carries; the trade taken instead was to stop asserting something false ("Nothing in {Context} yet" over a context that actually has work, just filtered out) in favour of something merely less helpful while still true. Recorded here rather than left implicit, per this document's own citation discipline.

Three rules the table encodes and a fourth surface must not break:

- **The action button appears if and only if the fix is available from this view.** States 1 and 3 are fixed by creating an item, which this view can trigger. State 2 is fixed by changing a search box or a popover filter, both of which live outside this empty state's own reach, so it gets no button. This is §7's rule, applied.
- **Icon size tracks first-run-ness.** State 1 is the only genuine first-run state and gets `56px` in the accent blue; states 2 and 3 are routine and get `48px` in muted grey.
- **Copy is shared with the other views, not written fresh.** State 1 and state 2 reproduce `WorkListView`'s and `WorkBoardView`'s strings verbatim — compare `WorkBoardView.tsx:399–405`, which is state 2 word for word (kept in sync across all four views, Timeline included, when Task 40 widened the string). Only state 3 is new to the Table, because only the Table has a context-scoped empty case. A view that words the same condition differently teaches the user that the two views disagree.
- **Body text is `#5c6b80`, never a lighter shade.** §8's narrow exception for `#8a94a6`/`#9aa4b5` covers decorative filler inside an obviously-empty container — Board's dashed column placeholder (§5b) qualifies; a centred sentence that is the only content on the screen does not. The icons may use `#9aa4b5`, being non-text decoration.

### 17d. Detail drawer panel

Backdrop: `position: fixed; inset: 0`, `background: rgba(20,24,38,0.45)`, `z-index: 1000` *(shipped: `WorkItemDetail.tsx:484`)*.
Panel: `width: min(420px, 100%)`, `height: 100%`, `overflow-y: auto`, `background: #fbfbfd`, `border-left: 1px solid rgba(200,210,230,0.6)`, `box-shadow: -20px 0 60px rgba(31,38,68,0.28)`, `padding: 22px`, `gap: 18px` *(shipped: `WorkItemDetail.tsx:499–502`)*.

**The panel is a solid `#fbfbfd` and not §11's `GLASS` recipe, and this is a technical constraint rather than a preference.** `backdrop-filter` on an element makes it the containing block for its `position: fixed` descendants. `LinksPopover` — which this drawer hosts — is `position: fixed` precisely so it can escape scroll containers. A glass drawer would trap it inside the drawer's own box and break the popover it exists to present. The shipped comment at `WorkItemDetail.tsx:206–209` states this; it is repeated here because "make the drawer glass like everything else" is the obvious-looking change a later reviewer will propose, and the reason it fails is invisible from the CSS alone.

`#fbfbfd` is not an invented value either: it matches `WorkItemDialog`, the surface this drawer is a variant of. The border and the deep one-sided shadow are what give the panel its edge in place of the glass blur — the drawer still reads as floating above the page, it just does so with elevation rather than translucency.

Title typography: DM Sans `1.05rem`/800/`#2d3748`, `line-height: 1.3`, `overflow-wrap: anywhere`; hierarchy line Inter `0.76rem`/600/`#5c6b80` *(shipped: `WorkItemDetail.tsx:511, 517`)*. Close button `32×32px`, `border-radius: 8px`, `#5c6b80`, `aria-label="Close details"` *(`WorkItemDetail.tsx:524–530`)*.

---

## §18. Restrained Overdue (spec §22)

§6 made the Overdue stat card the one deliberately expressive element in v2: five co-occurring changes at `count > 0`, identical to its three siblings at zero. Spec §22 keeps the intent and objects to the volume — a single overdue item should not dominate the header.

**The diagnosis is surface area, not colour.** The table below has seven properties; two of them — the background and the border — are the tinted fill across the whole card: at the four-column grid's own gap and padding (`WorkboardStats.tsx:201, 238`), that card is roughly 280–315px wide by ~90px tall depending on viewport, sitting among three white-glass cards. Those two properties are doing all the dominating. Removing them removes the shouting and leaves five co-occurring signals — the edge, the icon, and three coloured strings (label, numeral, subtitle) — which is more than enough to satisfy `color-not-only`.

**Overdue, `count > 0` — the v3 treatment.** Two properties revert to neutral; three are unchanged from §6:

| Property | v2 (shipped) | v3 | Change |
|---|---|---|---|
| Background | `rgba(224,96,124,0.14)` | `rgba(255,255,255,0.4)` | **reverts to neutral** |
| Border | `1px solid rgba(224,96,124,0.35)` | `1px solid rgba(255,255,255,0.4)` | **reverts to neutral** |
| Left edge | `3px solid #e0607c`, `border-radius: 18px 0 0 18px` | unchanged | — |
| Icon | `AlertTriangle`, 14px, `#922e48`, inline before the label | unchanged | — |
| Label | `0.74rem`/700/`#922e48` | unchanged | — |
| Numeral | DM Sans `1.7rem`/800/`#922e48`, `tabular-nums` | unchanged | — |
| Subtitle | `0.7rem`/600/`#a0405a` | unchanged | — |

*(v2 column shipped at `WorkboardStats.tsx:46–62, 85, 137–140, 149–150, 159`.)*

**Overdue, `count === 0`:** unchanged from §6 — identical to its three siblings in every respect, subtitle "All caught up". The sameness at zero is still what makes the non-zero state register as a change.

**The edge stays `3px #e0607c` and is not thickened to compensate.** §6 chose that width and colour specifically to match §4's priority-edge vocabulary, "so a viewer who has already learned that pink-red edge means high/urgent reads the same color here without re-learning it." A `4px` edge would buy back a little of the lost weight at the cost of introducing a second edge width into a system that has exactly one. The five remaining signals are sufficient without it.

**The rule this generalises to, so the question does not have to be re-answered per surface** *(new)*:

> A filled red ground is permitted at chip scale and below — the High pill's `rgba(224,96,124,0.15)` (§4), `PriorityCell`'s high-value select ground (`PriorityCell.tsx:192`), the Blocked badge's amber (§17b). At card, row, panel, or section scale, red appears only as a `3px` edge, an icon, and text. Scale, not intent, decides.

That line is what separates this from a louder alert elsewhere: the loud treatment still exists in this app and is correct on objects roughly 60×20px, where a tint reads as a label's own background rather than as an alarm over a region.

Two consequences for the surfaces still to be built:

- **Focus's OVERDUE section** (spec §6, split out of Today) takes a §1 section header and a count badge like its three siblings — no tinted section background, no coloured rule, no icon on the heading. The rows inside already carry `#922e48` meta text (§17a), and the section's existence is itself the signal that the work is late.
- **The Overdue card stays activatable**, jumping to that section, with its shipped hover `border-color: rgba(224,96,124,0.6)` *(`WorkboardStats.tsx:117–120`)*. Hover is a transient state, so a stronger red is fine there and does not re-dominate the resting header.

---

## §19. The v2 Board-header contradiction, resolved

**The contradiction.** §1's type-scale table lists "Board column headers" in its *section header* row — DM Sans `0.95rem`, weight 800, `#2d3748` (`workboard-v2-direction.md:28`) — and, two rows below, names "Board column subheader" as an example of the *micro-label* style — DM Sans `0.68rem`, weight 800, uppercase, `#8a94a6` (`:30`). §5a's prose then argues the two are not in conflict because they describe two different pieces, and that the subheader is "a smaller element this spec does not otherwise define" (`:118`). That leaves an implementer with a Board column that may have one line or two, and no statement of which.

**v3's resolution, in one sentence:** v3 adopts §5a's side — a Board column has **one** header, in §1's section-header style (DM Sans `0.95rem`/800/`#2d3748`) with an item-count badge beside it, and **no subheader exists**, so §1's micro-label row should be read as naming Timeline lane labels only.

This is not a choice between two equally open options; it is a ratification of what shipped. `WorkBoardView.tsx:450` renders the column label at exactly `DM_FONT, 0.95rem, 800, #2d3748`, with the count badge at `:453–456` and the `10px` bottom padding over `1px solid rgba(200,210,230,0.35)` at `:446–448` — §5a's spec, implemented, with no second line anywhere in the file. The micro-label style is alive and correct at `WorkTimelineView.tsx:226–231`, on lane labels, which is the use §1's row should have cited alone.

Tasks 34–40 add nothing to a Board column header. The resolution is recorded so it does not have to be re-derived.

---

## §20. Contrast — the new pairings, computed

§8's method, applied to the pairings §14–§18 introduce. The surface proxy is §8's own: white at 45% alpha over the averaged `.vb-bg` gradient, `≈ #eae8f4`, via the WCAG relative-luminance formula.

§16's compact label (form 3) strips the chip's tinted background, so its four text colours now sit on bare glass rather than on their own tint. That is a *different* pairing from the one §8 verified, and it had to be recomputed rather than assumed:

| Pair | On its own 16% tint (§8) | On bare glass (§20) | AA (4.5:1) |
|---|---|---|---|
| `#185a7d` (Academic) | 5.53:1 | **6.20:1** | Pass |
| `#4f3fa0` (Projects) | 5.87:1 | **6.80:1** | Pass |
| `#8a5010` (Organization) | 4.92:1 | **5.36:1** | Pass |
| `#8a4468` (Life) | 5.21:1 | **5.58:1** | Pass |

All four improve when the tint is removed, which is the expected direction: a hue at 16% alpha over glass is fractionally darker than bare glass, so dropping it lightens the background under an already-dark text colour. Organization, the tightest pair in §8 at 4.92:1, gains the most headroom.

§14's context row introduces no new pairing: `#5c6b80` on glass is §8's 4.48:1 (passing) and `#2d3748` is far above. The typeface change to DM Sans does not affect contrast.

**§18 does introduce a new pairing, and it had to be recomputed for the same reason §16's did.** §8 verified `#922e48`/`#a0405a` against the card's *own tinted* ground (`rgba(224,96,124,0.14)` composited over glass); stripping that tint per §18 moves both onto the same bare-glass ground as everything else in this section:

| Pair | On the tinted card (§8) | On bare glass (§20) | AA (4.5:1) |
|---|---|---|---|
| `#922e48` (label, numeral) | 5.52:1 | **6.41:1** | Pass |
| `#a0405a` (subtitle) | 4.43:1 — marginal, close to the floor | **5.14:1** | Pass, clears the margin |

Both improve for the same reason §16's four pairs did: the pink tint was fractionally darker than bare glass, so removing it lightens the ground under an already-dark text colour. `#a0405a` is the more consequential of the two — it leaves the narrow band §8 originally flagged it in.

§15's table: the column-header `#5c6b80` and the cell `#5c6b80` are §8's passing secondary colour; the sorted column and hover darken to `#2d3748`. The sticky header's `rgba(255,255,255,0.95)` ground is lighter than bare glass, so every text ratio on it is at or above the figures above.

---

## §21. Responsive additions

§10's breakpoint table stands. Three surfaces v2 did not have need placing in it *(all new; Task 40 implements)*:

| Surface | `≥1024px` | `768–1023px` | `<768px` |
|---|---|---|---|
| Context navigation (§14) | In the header, right-aligned against the `h1` on one row | Wraps below the title, full width, `padding: 10px 12px` per item (labels intact) | Horizontally scrolling strip: `overflow-x: auto`, `flex-wrap: nowrap`, `scroll-snap-type: x proximity`, each item `scroll-snap-align: start`, `-webkit-overflow-scrolling: touch` |
| Detail drawer (§17d) | `width: min(420px, 100%)`, right-anchored | unchanged | Full-width bottom sheet: `width: 100%`, `height: min(88vh, 100%)`, `align-self: flex-end`, `border-radius: 18px 18px 0 0`, `border-left: none`, `border-top: 1px solid rgba(200,210,230,0.6)` |
| Filters popover (Task 38) | Anchored below its trigger | unchanged | Bottom sheet, sharing the drawer's phone metrics above |
| Table (§15) | `<table>` | `<table>`, `low`-priority columns dropped | `<ul>` of cards (§15e) |

**Never a cramped five-item context row.** Below `1024px` the row either wraps to full width or scrolls; it does not shrink its padding below `10px 12px`, drop labels for icons, or collapse into a `<select>` — the five context names are the user's primary orientation ("where am I working?") and abbreviating them costs more than a second row of height. This differs from the view selector, which *does* go icon-only below `1024px` (§10), because four view icons are conventional and self-describing while "Organization" has no icon a user would guess.

**This is a deliberate narrowing of a choice the spec leaves open.** Spec §29 offers "horizontally scrolling *or a selector*" for mobile navigation without preferring one; this addendum picks scrolling and rules the `<select>` collapse out entirely, for the reason stated above. Noted explicitly, the way §14b flags its own deviation from shipped code, so a Task 40 implementer who reads the spec directly does not wonder whether the dropdown option was overlooked.

**Column dropping is by declared priority, never by position.** `TableColumn.priority` is `'essential' | 'high' | 'low'` *(shipped: `tableColumns.ts:16–22`)*: `Work`, `Status` and `Deadline` are `essential` and survive every width; the context's own identity column (`Course`, `Organization`, `Project`, `Area`, `Context`) plus `Priority` are `high`; `Time`, `Links`, `Estimate` and the secondary project column are `low` and go first. The column arrays are `readonly` and shared by reference across contexts — `WORK` is literally the same object in four of them — so responsive dropping must filter into a new array and never write `col.priority` or sort in place, which would corrupt every other context for the rest of the session.

**The specificity discipline is not optional here.** Any property a media query has to override must not also be set inline. That is the rule §15e's JavaScript breakpoints exist to sidestep in the Table, and it is the bug that shipped Board's mobile snap-scroll silently dead in v2.

---

## §22. Page `<h1>` — a ratified drift from v2 §1

Task 40's quality-gate audit found the shipped page title (`WorkboardShell.tsx`, `src/app/workboard/calendar/page.tsx`) is a fixed `2.2rem`/weight **700**, not v2 §1's specified `clamp(1.9rem, 4vw, 2.6rem)`/weight **800**. Neither v2 nor v3 ever recorded this deviation, and it predates this addendum entirely — it is not a decision either direction document made deliberately, just one that was never reconciled with the written spec.

**Ratified here rather than changed in code.** The shipped value has been live, unremarked-on, and unreviewed-against-the-spec through all 40 tasks of this plan with no prior complaint; reverting it now would be an unreviewed visual change with no driving requirement, at the exact point this plan is closing. §11's "match `WorkboardWeekView`'s heading exactly" clause is also now moot on its own terms — that file no longer renders an `<h1>` at all, having moved to its own `/workboard/calendar` route in Task 36 — and the two page shells that remain (`WorkboardShell.tsx`, the calendar route) already match each other exactly, which is the consistency that actually matters today.

**The value itself:** `2.2rem`, weight 700, unchanged from what has shipped since early in this plan. A future task that wants the responsive `clamp()` back, or wants to reconcile the weight against §1's 800-weight section headers, should treat this as a fresh design decision rather than a bug fix — the current value is not broken, only undocumented until now.

---

## Summary for implementers

If you read nothing else in this addendum:

- The context row and the view selector differ on **five** axes at once (§14a) — shape, active signal, resting boundary, typeface, position. The context row keeps §13's underline pattern; its typeface changes to DM Sans, its `aria-label` becomes "Filter by context", and it stays shrink-to-fit and right-aligned — **never `width: 100%`** (§14b).
- The context indicator is **never** the context's own hue (§14b), and §16 is the reason that ruling got stronger, not weaker.
- The Table row is **31px**, governed by the Work cell, and every inline control cell drops its vertical padding to `2px` to stay under it (§15b). **No zebra** (§15a). The sticky header's rule is an **inset box-shadow, not a border**, because a collapsed border does not travel with a sticky cell (§15d).
- Context accents reuse §2a's four existing hues — no new colour system — as the chip, the dot, or the compact label (§16b), plus two Timeline-only exceptions (a lane background under My Work, a lane-stack edge under a single context). **Never a row background outside that one Timeline exception, never the §4 priority edge, never over a semantic colour** (§16c).
- Completed-late is `#8a5010` amber, not red, because the work is finished (§17a). Blocked is the amber badge and renders under My Work only (§17b). The detail drawer is solid `#fbfbfd` and can **never** be glass, because `backdrop-filter` would trap the `position: fixed` popover it hosts (§17d).
- Restrained Overdue = §6 **minus two properties**: the tinted background and the red border revert to neutral; the edge, icon, and three text colours stay (§18). The general rule: red fills at chip scale, red edges and text at card scale.
- A Board column has **one** header in §1's section-header style and **no subheader** — §5a's reading, ratified by shipped code (§19).
