# Workboard Revamp: Design Spec

- **Date:** 2026-10-06
- **Status:** Approved in brainstorming, pending written-spec review
- **Builds on:** `docs/design/workboard-v2-direction.md`, `docs/design/workboard-v3-direction.md`, `docs/superpowers/specs/2026-09-08-workboard-v3-design.md`
- **Mockups:** `.superpowers/brainstorm/1074-1791216656/content/` (header-kpi, focus-rows, table-bulk, board-columns, timeline-focus) and `.superpowers/brainstorm/1200-1791242520/content/palette-a-fixed.html`

## 1. Goal

Make every Workboard view noticeably better in visual quality, interaction feel and everyday speed, without changing its identity or data model.

**Direction: Evolve.** Keep the glass panels, the pink/blue VibeBoard palette and the per-context hues. Make it sharper by adding:

- one token system,
- one type scale with a 12px minimum,
- quieter chrome,
- consistent states (hover, active, focus, selected, disabled, loading, empty, error),
- purposeful motion.

**References:** Linear (density, bulk bar, palette), Things (completion feel), Notion Calendar / Sunsama (week + day agenda), Raycast (palette formatting).

**New features in scope:**

1. Quick add
2. Multi-select with bulk actions
3. Command palette (Ctrl+K)

**Out of scope:**

- Keyboard shortcuts other than Ctrl+K and in-overlay navigation (↑/↓/Enter/Esc/Tab, Ctrl+Enter)
- A dark-mode redesign
- Natural-language date parsing
- Habit Tracker v2
- Any schema change
- New API endpoints. One exception: a read-only helper may be added if a view needs data it cannot get today. If so, the implementation plan names it and gets it approved.

## 2. Problems this fixes (audit, 2026-10-06)

| Finding | Count |
|---|---|
| Distinct font sizes | 22 |
| Usages under 12px | 41 (including 0.6rem added in the last Board compaction) |
| Hard-coded hex colours in components | 28 |
| Transitions using plain `ease` (0 custom curves) | 24 |
| Transitions on layout properties (Timeline `flex-grow`, progress `width`) | 2 |
| `:active` press states | 0 |
| Loading skeletons | 0 |
| Native `title=` tooltips used as the only explanation | 16 |
| Toast system | none |

Other problems:

- Popovers rendered inside `backdrop-filter` ancestors land in the wrong place unless each one remembers to portal itself.
- The "waiting on…" reason uses `window.prompt`.
- `WorkItemDialog.tsx` is 1,900 lines.

## 3. Skill roles

Each design skill is used only for its own role:

| Skill | Role in this work |
|---|---|
| ui-ux-pro-max | UX rulebook: touch targets, contrast, form and feedback rules. **Its generated palettes and fonts are not used.** |
| frontend-design | Builds each view |
| emil-design-eng | Motion and interaction judgement during the build; Emil-style review at the end |
| dataviz | KPI micro-visuals and the Focus week rail |
| improve-animations, then animate | Motion audit, then motion implementation (Phase 7) |
| break-ui | Stress test: long titles, 0 / 1 / 200 items, narrow widths, slow network, failures |
| impeccable | Final audit and polish only (Phase 7) |

Not used: gpt-taste, minimalist-ui, industrial-brutalist-ui, high-end-visual-design, ui-styling (they would push away from "Evolve").

## 4. Foundation (Phase 0)

### 4.1 Tokens: `src/app/workboard/workboard.css`

A global stylesheet imported by the Workboard route. Every Workboard component reads `--wb-*` variables instead of hex literals.

- **Text:** `--wb-text #2d3748`, `--wb-text-muted #5c6b80`, `--wb-text-subtle #8a94a6`, `--wb-text-faint #9aa4b5`.
- **Brand:** `--wb-pink #f0679d`, `--wb-blue #74bcd9`, `--wb-blue-strong #2a7fa8`, `--wb-blue-ink #256f92`.
- **Semantic** (each has a `-bg` tint at 0.12–0.16 alpha):
  - `--wb-danger #922e48`
  - `--wb-warn #8a5010`
  - `--wb-success #1f6b42`
  - `--wb-success-fill #2f8f5b`
  - `--wb-priority-high #e0607c`
- **Context hues:** fill/text pairs taken verbatim from `src/lib/workboard/color.ts` (Academic `#4dabf5`/`#185a7d`, Projects `#8b7fd6`/`#4f3fa0`, Organization `#f0a35c`/`#8a5010`, Life `#f2a7c0`/`#8a4468`, fifth `#74bcd9`/`#225f77`). `color.ts` remains the source of truth for per-context colour, and the CSS variables mirror it.
- **Surfaces:**
  - `--wb-glass rgba(255,255,255,.42)`
  - `--wb-glass-border rgba(255,255,255,.55)`
  - `--wb-surface #fff`
  - `--wb-surface-raised #fbfbfd`
  - `--wb-hairline rgba(200,210,230,.5)`
  - `--wb-hover rgba(255,255,255,.6)`
  - `--wb-selected rgba(116,188,217,.16)`
  - `--wb-scrim rgba(20,24,38,.26)`
- **Type scale:** `--wb-fs-12`, `-13`, `-14`, `-16`, `-20`, `-24` (px). **Nothing below 12px.**
  - Weights: 500 / 600 / 700 / 800.
  - Headings use DM Sans; body text uses Inter.
  - Uppercase micro-labels are 11px only when bold (800 weight) with letter-spacing ≥ .03em. This is the single allowed exception, and it is used only for context codes and group headings.
- **Spacing:** 4px base, `--wb-space-1` through `--wb-space-8` (4, 8, 12, 16, 20, 24, 32, 40).
- **Radii:** `--wb-r-sm 6px`, `--wb-r-md 8px`, `--wb-r-lg 10px`, `--wb-r-xl 14px`, `--wb-r-panel 16px`, `--wb-r-pill 999px`.
- **Shadows:**
  - `--wb-shadow-card` (1px, low alpha)
  - `--wb-shadow-pop` (0 10px 28px rgba(31,38,68,.18))
  - `--wb-shadow-modal` (0 24px 64px rgba(31,38,68,.32))
- **Motion:**
  - `--wb-ease cubic-bezier(0.23,1,0.32,1)`
  - `--wb-ease-in-out cubic-bezier(0.77,0,0.175,1)`
  - Durations: `--wb-dur-fast 120ms`, `--wb-dur 180ms`, `--wb-dur-slow 240ms`. The maximum anywhere is 300ms.

### 4.2 Shared state classes (also in `workboard.css`)

- `.wb-pressable`: `:active { transform: scale(0.97) }`.
- `.wb-focus-ring`: `:focus-visible { outline: 2px solid var(--wb-blue-strong); outline-offset: 2px }`.
- `.wb-hoverable`: hover background applies only inside `@media (hover: hover) and (pointer: fine)`.
- `.is-selected`, `.is-disabled`, `.is-pending` (60% opacity, no pointer events), `.is-error` (danger tint plus inline message).
- A global `@media (prefers-reduced-motion: reduce)` block sets Workboard transition and animation durations to 0.01ms and removes transforms used purely for motion.

### 4.3 Motion rules (binding for every phase)

1. Animate only `transform` and `opacity`, never width, height, flex-grow, top or left.
2. Use `--wb-ease` for enter and exit, and `--wb-ease-in-out` for moving between places.
3. Anything opened from the keyboard appears with no animation. That covers Ctrl+K, Enter on a row and the arrow keys.
4. Popovers scale from 0.96 toward the edge they open from (`transform-origin` set to the trigger side), never from `scale(0)`.
5. Enter animations use `@starting-style` where supported, with a class-toggle fallback.
6. Hover motion only under `(hover: hover) and (pointer: fine)`.
7. Under reduced motion, there is no movement at all. Opacity crossfades of 120ms or less are allowed.

### 4.4 `src/lib/workboard/ui/tokens.ts`

A small pool-free module exporting the same values for places that need them in TS: `EASE`, `DUR` (`fast` / `base` / `slow` in ms), and `CONTEXT_COLORS`, re-exported from `color.ts`. It contains no React code.

### 4.5 Primitives: `src/components/workboard/ui/`

Each primitive lives in its own file and has a single job:

| Primitive | Responsibility |
|---|---|
| `WbOverlay` | Portals to `document.body`; scrim; focus trap; Esc to close; scroll lock; returns focus to the opener; `role="dialog"`, `aria-modal`, `aria-labelledby`. Variants: `modal` (centred), `drawer` (right on ≥ 768px, bottom sheet below), `palette` (top-anchored at 12vh, no enter animation when opened from the keyboard). |
| `WbPopover` | Portalled and anchored to a trigger rect; flips when there is no room; origin-aware 140ms enter and 100ms exit; Esc and outside click close it. **All** cell, filter and bulk-bar popovers use it, which fixes the glass-parent mis-positioning class of bug. |
| `WbCheckbox` | Two shapes: `round` (Focus completion, with a 180ms check-draw on click) and `square` (Table/Board selection, with an indeterminate state). Hit area ≥ 24px. A `ring` prop marks high priority. |
| `WbSegmented` | View switcher and other segmented controls. The selected pill slides with a `transform` (`--wb-ease-in-out`, 180ms). Keyboard: arrow keys. |
| `WbSkeleton` | Shimmer-free pulsing blocks (opacity 0.5↔0.8, 1.2s; static under reduced motion). |
| `WbToaster` | Wraps Sonner (new dependency `sonner`). Bottom-centre. Its offset rises above the bulk bar while the bar is visible. Styled with `--wb-*` tokens. |
| `WbQuickAdd` | Inline input row; behaviour in §11. |
| `WbBulkBar` | Floating selection bar; behaviour in §12. |

## 5. Header and KPI (Phase 1)

Mockup: `header-kpi.html`, option C.

- **Title row:**
  - "Workboard" title, with a "today" line beneath it, e.g. "Tuesday, Oct 6 · 3 due today · 1 overdue".
  - On the right: **+ New item**, the primary pink button.
- **Toolbar row:**
  - `WbSegmented` view switcher (Focus / Table / Board / Timeline).
  - Search field with a `Ctrl K` hint chip on the right. Typing in the field filters the current view as it does today. Clicking the hint chip or pressing Ctrl+K opens the palette (§13).
  - **Filters** button with an active-count badge.
- **KPI tiles:** four glass tiles, each with a label, a big number and a micro-visual. Built with dataviz:
  - **In progress:** a thin progress bar showing done ÷ (done + open) for the current context this week.
  - **Due soon:** three dots for today, tomorrow and the day after. Dot size or fill scales with count, and overdue days use the danger colour.
  - **Overdue:** the number in danger colour with an alert icon. When the count is 0 it shows "All clear" in success colour.
  - **Estimated hours:** a 7-day sparkline of scheduled estimate hours (SVG polyline, no chart library).

  No left edge bar (removed per earlier request). The top stripe and icon chip remain, restyled with tokens.

- **Phones:**
  - Tiles become a 2×2 grid.
  - The segmented switcher scrolls horizontally inside its own container, so the page itself never scrolls sideways.
  - The search field collapses to an icon that opens the palette.

## 6. Focus view (Phase 2)

Mockup: `focus-rows.html`, option A.

- **Section order:** Waiting first, then Overdue, Today, Tomorrow, This week, Later, No deadline.
- **Section headings** (16px DM Sans 800) show a count and a right-aligned **+ Add** button. Waiting has no + Add. Overdue's + Add creates an item due today.
- **Rows** are a fixed 34px single line: round `WbCheckbox`, title (ellipsis), context dot + code (11px uppercase), due (12px, danger when overdue), estimate (`~2h`, muted).
  - High priority shows as a `--wb-priority-high` ring on the checkbox; there is no separate pill.
  - Waiting rows show "Waiting on X · 4d" in warn colour instead of due/estimate.
- **Hover** (fine pointers only) tints the row and reveals a trailing actions button (open, move to…). Clicking the row opens the drawer.
- **Completing an item** takes one click on the checkbox:
  1. The check draws (180ms).
  2. The row fades out and collapses (opacity 180ms; the height collapse uses a `grid-template-rows: 1fr → 0fr` wrapper and is the one sanctioned layout transition, limited to 180ms and disabled under reduced motion).
  3. A toast appears: "Completed · Undo" for 5s.
- **Quick add** opens in place under the section (§11). The item takes the section's date.
- The **week rail** on the right (desktop) becomes a dataviz bar chart of item counts per day for this week, with today highlighted. Below 1024px, the rail is hidden.

## 7. Table view (Phase 3)

Mockup: `table-bulk.html`, option A.

- **Quiet cells.** Values read as plain text, and a cell shows its control (bordered box plus ▾) only on row hover or keyboard focus. This deliberately replaces v3 §15c's always-boxed cells, keeping the same editors (Status, Priority, Deadline, Time, Links), now rendered through `WbPopover`.
- **Rows:** hairline dividers only, no zebra striping. Overdue shows an alert icon plus danger text. Done rows show the title muted with a strikethrough.
- **Selection checkboxes** (square `WbCheckbox`) appear in the first column on row hover. Once any row is selected, all checkboxes stay visible. The header checkbox selects all visible rows and shows indeterminate when only some are selected. Shift-click selects a range.
- The **bulk bar** appears as soon as one row is selected (§12).
- The **Links cell** keeps the current summaries: "+ Link" dashed when empty, "Canvas ↗", "GitHub · +2".
- **Phones:** keep the existing card fallback (`CardLinksButton` and related), restyled with tokens. Selection there uses a long-press-free "Select" toggle in the toolbar.

## 8. Board view (Phase 4)

Mockup: `board-columns.html`, option A.

- **Lanes:** each column keeps a faint stage-tint wash plus a 3px coloured top edge. Column header: stage name (DM Sans 13px 800) and a count pill; an overdue badge (icon + number) when relevant.
- **Cards:** white `--wb-surface` cards with a 13–14px type floor. This restores sizes from the earlier compaction; nothing under 12px.
  - Left edge colour = priority (high uses `--wb-priority-high`).
  - Card anatomy: title, context line, due line, then estimate and links.
  - Done cards show a muted strikethrough title and "Completed late · date" in warn colour when late.
- **Column width:** current rules stay (flex 1 1 200px, min 200, max 260). On mobile, columns scroll horizontally with scroll-snap, and the page itself never scrolls sideways.
- **+ Add** at the bottom of each column opens quick add. The item takes that column's stage.
  - Empty columns show a dashed message using the existing `STAGE_EMPTY_TEXT`, and clicking it opens quick add.
  - **Done** has no + Add.
- **Selection:** shift-click toggles a card's selection (2px `--wb-blue-strong` ring) and uses the same bulk bar as Table.
- **Drag:**
  - The dragged card lifts (scale 1.02, `--wb-shadow-pop`).
  - A gap opens at the drop point: neighbouring cards translate by the card height, 180ms `--wb-ease-in-out`.
  - On drop, the card settles (scale 1.02 → 1, 180ms).
  - Moving to For Revision opens the inline waiting popover (§10.3) instead of `window.prompt`. Cancelling it cancels the move.
  - A toast confirms the move with Undo.

## 9. Timeline view (Phase 5)

Mockup: `timeline-focus.html`, option B.

- **The week grid never reflows.** All seven day columns have equal width and equal minimum height, and the old flex-grow day expansion is removed.
- **Clicking a day:**
  - It gets a 2px `--wb-blue-strong` ring and opens a **day panel** on the right (desktop, 300px).
  - Below 1024px, the panel opens as a `WbOverlay` drawer (bottom sheet on phones).
  - The first time, the panel slides in (translateX 16px → 0 plus opacity, 240ms). Switching to another day while it is open crossfades its contents (120ms) without sliding again.
  - Esc or the panel's ✕ closes it.
- **Day panel contents:**
  - Heading "Tuesday, Oct 13" plus a summary line ("Today · 1 of 2 done · 3h scheduled").
  - A time-ordered agenda: class occurrences (time, room, instructor, override state), then a **now** marker row on today, then items due (with an alert when overdue) and events.
  - Clicking a class opens the existing class-override popover.
  - At the bottom: **+ Add to Tuesday** (quick add, due that day).
- **Now line:** on today's column, a 2px pink line with a dot at the current time position. It updates every minute.
- **Week arrows:**
  - The days slide sideways in the direction of travel (translateX ±24px plus opacity, 160ms).
  - **Today** jumps without a slide when it is more than one week away.
  - Keyboard-initiated navigation does not animate.
- **Unchanged:** the multi-day bar row, course-coloured class blocks, dimmed ghost cards for moved classes, and the per-day progress bar.

## 10. Overlays (Phase 6)

### 10.1 Item dialog (`WorkItemDialog.tsx`)

- Restyle it onto `WbOverlay` (`modal`) and tokens.
- Split it into focused files under `src/components/workboard/dialog/`: type step, shared fields, academic link-existing path, academic new-graded path, academic independent path, and a reminder field. Behaviour and the three academic paths stay as they are today.
- Form rules:
  - Labels sit above fields.
  - 12px minimum text.
  - Validation errors appear inline under the field (no alert).
  - Save shows a pending state and is disabled while saving.
  - Ctrl+Enter submits.
- Motion: opens with opacity plus a scale from 0.96 (180ms); closes in 120ms. Opened from the keyboard: no animation.

### 10.2 Drawer (`WorkItemDetail.tsx`)

- Moves onto `WbOverlay` (`drawer`).
- **Header:** title editable in place (Enter saves, Esc reverts), with a status control beneath.
- **Body:**
  - A two-column property list (label column 96px, muted 12px; value column) covering context, project, priority, deadline/time, estimate, and the waiting reason and days.
  - Then links, then subtasks.
- **Motion:** slides from the right (translateX 24px → 0 plus opacity, 240ms); bottom sheet below 768px.

### 10.3 Waiting popover

A `WbPopover` with one input, "What is it waiting on? (optional)", plus **Move** and **Cancel**. It replaces `window.prompt` in the Board move and anywhere else a stage changes to blocked or submitted (For Revision).

### 10.4 Event dialog (`WorkboardEventDialog.tsx`)

Moves onto `WbOverlay` (`modal`) and tokens, with no behaviour change.

## 11. Quick add

- **Where:** Focus sections, Board columns (except Done) and the Timeline day panel. `WbQuickAdd` is the same component in all three; the caller supplies the defaults.
- **Defaults:**
  - Due date: the section's date, or the day.
  - Stage: the column's stage.
  - Context: the context the board is currently filtered to. Under "All", the last context the user created in, falling back to the first owned context.
  - Type: Task.
- **Keys:** Enter saves and keeps the input open and empty for the next item. Esc or blur with an empty input closes it. Blur with text keeps the draft visible.
- **Optimistic:** the new row or card appears immediately with `.is-pending`. On failure it switches to `.is-error` with **Retry** and **Discard**.
- Quick add creates owned Workboard items only. Academic graded items still go through the full dialog.
- **No text parsing:** typed text is used as the title as-is.

## 12. Multi-select and bulk actions

- **Selection sources:** Table checkboxes (§7), Board shift-click (§8). Focus has no multi-select in this revamp.
- **Clearing:** switching view or context clears the selection, and so do Esc and the bar's ✕.
- **`WbBulkBar`:**
  - A dark pill (`--wb-text` background, white text) fixed bottom-centre, 16px from the bottom.
  - Contents: "N selected · Status ▾ · Priority ▾ · Deadline ▾ · Delete · ✕".
  - Enters with translateY 8px → 0 plus opacity (180ms). On phones it spans full width minus 16px gutters.
- **Execution:**
  - Each bulk action calls the existing per-item PATCH or DELETE routes for every selected item with `Promise.allSettled`. No new endpoint.
  - Items whose type cannot take the change are skipped and counted. Example: an academic overlay item without the field in its editable set.
- **Feedback:**
  - Success: "3 items updated · Undo".
  - Partial: "2 of 3 updated · Retry failed".
  - Undo restores each item's previous values with the same routes.
- **Delete:** items hide immediately, and a toast "3 deleted · Undo" shows for 5s. The DELETE requests are sent only after the toast expires without Undo. If the page unloads first, they are sent on `pagehide` via `fetch(..., { keepalive: true })`.
- **Single deletes** (drawer, row actions) use the same deferred-delete mechanism.

## 13. Command palette (Ctrl+K)

Mockup: `palette-a-fixed.html`. Centred palette with fixed formatting.

- **Opening:**
  - Ctrl+K (Cmd+K on macOS) anywhere on Workboard, or clicking the search field's hint chip.
  - From the keyboard: no animation. From a click: 140ms opacity plus a scale from 0.98.
  - Closes in 100ms.
- **Layout** (`WbOverlay` `palette`, anchored at 12vh from the top so it never jumps as results change):
  - Width 600px; on phones, full width minus 16px each side.
  - Input row 48px: search icon, input, `Esc` key hint.
  - Scope chips row: All / Items / Go to / Create; Tab cycles through them.
  - List with a max height of 340px that scrolls inside.
  - Group headings 28px (11px uppercase 800, with a count when typing).
  - Rows a fixed 36px.
  - Footer 34px with key hints and a result count.
- **Rows** use one fixed grid: `24px | minmax(0,1fr) | 92px | 84px | 44px`, for icon, title (ellipsis), context (dot + code, ellipsis), due (right-aligned; overdue shows the alert icon in danger colour), and key hint.
  - Empty cells keep their width.
  - Below 640px, the context and key-hint columns are hidden.
  - The active row uses the `--wb-selected` background with a 2px inset left bar in `--wb-blue-strong`. The highlight moves instantly.
- **Content:**
  - **Empty query:** Recent (the last 5 opened or edited items), then Go to (the four views plus each context), then Create (task, event, reminder).
  - **Typing:**
    - **Items:** case-insensitive substring match on titles within the user's loaded data, at most 6 shown, matched letters highlighted, and a "Show all N in Table" row that applies the query to the Table view's search.
    - **Go to** matches.
    - **Create:** "New task 'query'" and "New event 'query'".
  - **No matches:** one "No items match" line, then the Create rows.
- **Keys:**
  - ↑/↓ move the highlight.
  - Enter runs the highlighted row. On an item, that opens its drawer.
  - Ctrl+Enter creates a task titled with the query.
  - Esc closes the palette.
  - The first row is always highlighted.
- **Data:** it searches the items already loaded in the Workboard shell. There is no new search endpoint.

## 14. Toasts

- Sonner via `WbToaster`. One toast at a time per action type; new toasts stack, up to 3.
- **Undo** is offered for 5s on: complete, move (Board drag, stage change), delete, and bulk updates.
- **Errors:** a toast with a **Retry** action. Field-level validation errors stay inline and never toast.
- `aria-live="polite"`. Toasts never steal focus.

## 15. Loading and empty states

- **First load:** each view renders `WbSkeleton` blocks in its own layout (Focus rows, Table rows, Board cards per lane, Timeline day columns) instead of a blank screen or spinner.
- **Empty states:** one sentence plus one action (for example, Focus with nothing due: "Nothing due. Add something for today →" opening quick add). The Board keeps its column-level empty text.
- **Tooltips:** the 16 `title=` tooltips that are the only explanation of an icon-only control get a visible label or `aria-label` plus a styled tooltip. Native `title` stays only as a supplement.

## 16. Accessibility and responsiveness

- Contrast ≥ 4.5:1 for body text and ≥ 3:1 for large text and UI glyphs against the glass proxy `#eae8f4`. The context text colours are already verified.
- Touch targets ≥ 24px on desktop and ≥ 40px on phones for checkboxes, + Add, bulk bar buttons and palette rows.
- Every overlay traps focus and returns it to its opener. Every interactive element shows `:focus-visible`.
- Breakpoints checked: 390px (phone), 820px (tablet), 1440px (desktop). The page never scrolls horizontally, and the side gutter is 16px on phones.

## 17. Phases

Each phase leaves Workboard fully working.

| # | Phase | Covers |
|---|---|---|
| 0 | Foundation | §4 |
| 1 | Header and KPI | §5 |
| 2 | Focus | §6, quick add §11 |
| 3 | Table | §7, bulk §12 |
| 4 | Board | §8 |
| 5 | Timeline | §9 |
| 6 | Overlays and palette | §10, §13 |
| 7 | Motion and QA | Motion audit (improve-animations → animate), break-ui, Emil review, impeccable audit; §15 and §16 checks completed across all views |

Toasts (§14) arrive in Phase 0 as the `WbToaster` primitive and are first used in Phase 2. Skeletons and empty states (§15) are built into each view's phase, and Phase 7 confirms them.

## 18. Verification (per phase)

1. `npx tsc --noEmit` passes.
2. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/workboard` returns 307 when unauthenticated.
3. **Playwright:**
   - The user logs in once in the Playwright browser; no credentials go through Claude.
   - Screenshots at 390, 820 and 1440px widths for the changed views.
   - The browser console has no errors.
   - The phase's key interactions are exercised: complete + Undo, quick add, select + bulk update, drag, day panel, palette navigation.
4. **Grep gate** on the files the phase touched: no new hex literals outside `workboard.css` / `color.ts`; no font sizes below 12px (except the §4.1 micro-label exception); no `transition` with plain `ease`; no transitions on width, height, flex-grow, top or left (except the §6 row-collapse wrapper).
5. The user reviews the screenshots and approves before the next phase.

## 19. Constraints

- No commits unless the user explicitly asks. When asked, stage only files touched by this revamp. The repo holds unrelated uncommitted work (finance tracker, StudyPulse, Workboard v3 follow-ups and others), so always run `git status` first.
- Client components import only pool-free modules at runtime (`dates.ts`, `dueSemantics.ts`, `workContexts.ts`, `color.ts`, `ui/tokens.ts`). Modules that touch the pool are `import type` only.
- styled-jsx rules apply per component function. Shared rules go in `workboard.css`. Template literals in styled-jsx must not contain backticks.
- Anything `position: fixed` renders through a portal (`WbOverlay` / `WbPopover`).
- New dependency: `sonner` only.
