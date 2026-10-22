# StudyPulse revamp: subjects, subject page, entry tables, deterministic target planner

**Date:** 2026-10-22
**Status:** Approved in brainstorming (mockup v4). Awaiting written-spec review.
**Mockups:** `.superpowers/brainstorm/3446-1792647023/content/studypulse-revamp-v4.html` is the source of truth. v1 to v3 are history.
**Builds on:** the Workboard glass system (`src/app/workboard/workboard.css`, `2026-10-20-workboard-refine-design.md`). StudyPulse mirrors its token values. It does not import Workboard's CSS.

## 1. Why

The user wants StudyPulse "better by a notch" in UI, UX and visual appearance. Problems found in the current code:

- **My Subjects form** (`SubjectsGrid.tsx`): seven fields of equal weight in one flat auto-fit grid, with three `<select>`s for tiny fixed choices. The full-gradient title washes out on the gradient background.
- **Target planner** (`TargetGradePanel.tsx`):
  - The value label is pinned at `pct - 2%`, so it collides with the fill end ("100.0%" overflows).
  - A pink target tick sits on a green or amber fill, so the colors clash.
  - The "AI Study Advisor" calls Anthropic for something that is plain arithmetic.
- **Current grade honesty:** the planner, the header pills and `CustomGradeCalculator` all count an ungraded category as **100**. A Midterm with one perfect task therefore reads "100.0% A" while 76% of the grade is unscored.
- **Period toggle:** emoji labels, multi-select visibility semantics that nothing explains, and no grade on the tab.
- **Entry tables:** permanent blue and red action buttons on every row, Score and Items in separate columns, emoji, and inline-style contrast as low as `#ccc` on glass.
- **Code shape:** `SubjectCardView.tsx` is 1,847 lines. Grade math is duplicated in three places (planner, header, calculator), which is how they can drift apart.

## 2. Decisions (user, verbatim where quoted)

| # | Decision |
|---|---|
| D1 | Remaining items per category = **ungraded entries plus user-defined extra projected items** ("ungraded entries plus user defined n number of projected tasks per category"). The extra count is saved. |
| D2 | Projection output: "a comprehensive breakdown of possible numbers or percentage of grade plus a what if breakdown (expandable)". |
| D3 | Scope: **My Subjects page and subject page** (the form, the cards, the header and tiles, the toolbar, the period tabs, the entry tables, the planner and the calculator summary styling). Landing, GWA, Schedule and Canvas are out of scope. |
| D4 | Direction: **refined pink/blue glass**, aligned with Workboard tokens. The `.vb-bg` gradient is unchanged. |
| D5 | Architecture: **extract and restyle**. A pure, tested projection lib, a StudyPulse token sheet, and a split of `SubjectCardView.tsx` into focused components. |
| D6 | Subject cards **keep the circle (ring)**. It shows the grade. Under the name: "A · Excellent" **without** the number beside it. |
| D7 | **Block section** shows on the form's preview card and on every subject card. |
| D8 | **No projected rows in the entry table.** Planned items live only in the planner. |
| D9 | The planner has a **tinkerable sandbox**: one slot per remaining item, prefilled with the required average, editable, with a live outcome. Avoid redundancy (no repeated "need" column, no "1 + [−1+]" cell). |
| D10 | The "Your plan" outcome is a **light, state-tinted card** (mockup v4), not a dark slab. |
| D11 | **Current = graded-only weighted average**, shown with "N% of the grade is in". Accepted with the v3 and v4 mockups ("otherwise, im all good"). This replaces assume-100 everywhere a running period grade is shown. |

## 3. Architecture

### 3.1 New units

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/lib/studypulse/projection.ts` | Pure math: category stats, the current grade, the uniform required score, best and worst cases, scenarios, single-category what-if, sandbox outcome, status. No React, no fetch. | `gradeScale.ts` |
| `src/lib/studypulse/periodModel.ts` | Builds the projection input (`PeriodInput`) from a `GradingConfig` plus `catEntries`, or from legacy activities, quizzes and exams. Resolves linked-singleton carry scores and transmutation. | `projection.ts`, `transmutation.ts` |
| `src/lib/studypulse/__tests__/*.test.ts` | `node:test` suites for the two libs above. | none |
| `src/app/studypulse/studypulse.css` | `--sp-*` tokens (values copied from `--wb-*`), glass levels, and shared classes (`.sp-pressable`, `.sp-focus-ring`, `.sp-seg`, `.sp-chip`, `.sp-num`). Imported by both StudyPulse pages. | none |
| `src/components/studypulse/subject/SubjectHeader.tsx` | Breadcrumb, title, code tag, meta chips, grade tiles plus a Grade pt / Percent / Letter segmented switch. | `periodModel`, `projection` |
| `src/components/studypulse/subject/SubjectToolbar.tsx` | Period tabs, Transmute switch, Target planner toggle, Grading, Canvas menu. | none |
| `src/components/studypulse/subject/PeriodTabs.tsx` | Segmented control with a sliding indicator and a live grade per tab, plus "Both" (or "All" when there are 3+ periods). | none |
| `src/components/studypulse/subject/CategorySection.tsx` | Category header (swatch, weight, "x of y graded", average pill, Add, collapse) and its `EntryTable`, or an inline singleton score row. | `EntryTable` |
| `src/components/studypulse/subject/EntryTable.tsx` | The row view and edit state. Today's `CustomEntrySection` and `EntrySection` behavior moves here unchanged in function. | none |
| `src/components/studypulse/planner/TargetPlanner.tsx` | Replaces `TargetGradePanel.tsx`: a panel shell plus one `PeriodPlanCard` per period. | below |
| `planner/PeriodPlanCard.tsx`, `planner/GradeBar.tsx`, `planner/PlanSandbox.tsx`, `planner/ScenarioRow.tsx`, `planner/SoloWhatIf.tsx` | One section of the card each (§6). | `projection` |
| `src/app/api/studypulse/projection-prefs/route.ts` | GET and PUT of a subject's saved extras and targets. | `migrate.ts` table |

`SubjectCardView.tsx` remains the page container (state, data loading, wizard, transmutation load). It composes the units above and should end under ~600 lines. `SubjectsGrid.tsx` is restyled in place, with `SubjectForm` and `SubjectCard` extracted to `src/components/studypulse/subjects/`.

### 3.2 Removed

- `src/components/studypulse/TargetGradePanel.tsx`, replaced by `planner/`.
- `src/app/api/studypulse/target-analysis/route.ts`. Only `TargetGradePanel.tsx` calls it, and it is the only importer of `@anthropic-ai/sdk` in `src/` (verified 2026-10-22). The dependency is therefore removed from `package.json` as well, after the plan re-runs that grep.

### 3.3 Persistence: `studypulse_projection_prefs`

```sql
CREATE TABLE IF NOT EXISTS studypulse_projection_prefs (
  user_subject_id INT NOT NULL,
  pref_key        VARCHAR(48) NOT NULL,  -- 'extra:<catKey>' | 'target:<periodKey>'
  value           DECIMAL(6,2) NOT NULL,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_subject_id, pref_key)
)
```

- `catKey` is `c<cat_id>` for custom presets and `legacy-activities`, `legacy-quizzes`, `legacy-midterm` or `legacy-final` for legacy mode. `periodKey` is `p<period_id>`, or `overall` in legacy mode.
- The table is keyed by subject, not preset, because presets are shared across subjects.
- The table is added in `migrate.ts` with the existing `CREATE TABLE IF NOT EXISTS` pattern.
- The route checks that the `user_subject_id` belongs to the session user, as the other studypulse routes do.
- The planner saves with a 400 ms debounce on change and shows no spinner. A failed save shows one inline "Couldn't save. Retry" line in the panel header. The planner keeps working from local state.
- Sandbox slot values are **not** persisted. They are exploratory.
- The default target is 85 when nothing is saved, as today.

## 4. Projection math (`projection.ts`)

### 4.1 Input

```ts
type CategoryInput = {
  key: string; name: string; weight: number; color: string;
  graded: number[];          // per-entry percentages (transmuted when transmutation is on)
  pendingNames: string[];    // ungraded entries already in the table, in table order
  extra: number;             // user-defined projected items, >= 0
  singleton: boolean;        // singleton => pendingNames.length + extra <= 1, extra forced 0
  noun: string;              // "Quiz", "Task"… for planned slot names ("Quiz 5")
};
type PeriodInput = { key: string; name: string; target: number; categories: CategoryInput[] };
```

Per category: `n = graded.length`, `S = sum(graded)`, `k = pendingNames.length + extra`. An **ungraded entry** is `grade === null && !(score && items)`, the inverse of today's `hasGradeData`.

### 4.2 Formulas

Only categories with `n + k > 0` are **active**. `W = Σ weight` over the active categories. A category's final average is `(S + Σ remaining) / (n + k)`.

- **Grade as a function of a uniform score x** on every remaining item: `G(x) = a + b·x`, where `a = Σ (w/W)·S/(n+k)` and `b = Σ (w/W)·k/(n+k)`.
- **Required:** `need = (target − a) / b` when `b > 0`, else `null`.
- **Worst / best:** `G(0)` and `G(100)`.
- **Current (D11):** `Σ w·(S/n) / Σ w` over categories with `n > 0`. `null` when nothing is graded.
- **Coverage:** `Σ (w/W)·n/(n+k) × 100`, displayed as "N% of the grade is in".
- **Sandbox outcome:** `Σ (w/W)·(S + Σ slotValues)/(n+k)`.
- **Single-category what-if** for category c: every other category's remaining items hold `P = current ?? target`. Then `needAvg_c = (target − others) / (w_c/W)` and `x_c = (needAvg_c·(n_c+k_c) − S_c) / k_c`. The result is `null` ("locked") when `k_c = 0`.
- **Scenarios:** `G(x)` for x in [60, 70, 80, 90, 100]. When `0 < need < 100`, the nearest fixed value is replaced by `round1(need)` so the exact requirement appears. That keeps 5 cells.
- **Closest reachable** (only when `need > 100`): up to three letter thresholds below the target with `min ≤ best`, highest first, each showing `(min − a)/b`.

### 4.3 Status

| Condition | Status | Tone |
|---|---|---|
| `b = 0` and `current ≥ target` | Locked in | success |
| `b = 0` and `current < target` | Out of reach | danger |
| `need ≤ 0` | Locked in ("Safe") | success |
| `0 < need ≤ 85` | Achievable | success |
| `85 < need ≤ 100` | Stretch | warn |
| `need > 100` | Out of reach | danger |

Sandbox outcome tone: on or over target (`d ≥ −0.05`) is success, `−3 ≤ d < −0.05` is warn, and anything lower is danger.

### 4.4 Data mapping rules (`periodModel.ts`)

- **Custom presets:** one `PeriodInput` per `preset.periods` entry.
- **Linked singleton with carry_score:** when the category has no own entry and its link group has a source score, treat it as `graded = [sourceGrade]`, `k = 0`. This mirrors `linkGroupSource` today.
- **Transmutation on:** each graded value is `transmute(score, items)`, falling back to `grade`. Slot values are read as percentages on the same scale.
- **Legacy mode:** one period, `overall`, with categories Activities 24, Quizzes 36, Midterm 15 (singleton) and Final Exam 25 (singleton). This equals today's `(mid·15 + fin·25)/40 × 40%` exam math.
- **Header tiles and period tab grades** use `current` from the same lib. **The final grade** (average or collective) reads the same per-period currents. A period with `current = null` shows "—" and is excluded from the average.
- **Letter info** uses `toGradeInfo`, with whichever scale the config has. With no scale (`null`), letters are hidden and the tick row shows only numeric marks (60/70/80/90).

### 4.5 Tests (written first, `node:test`)

- **Hand-verified fixtures from the mockup.**
  - Midterm `{Q: 36, [96,88,92], 1 pending, +1}`, `{T: 24, [100], +3}`, `{Exam: 40, singleton, 1 pending}` with target 89. Expected: need **87.19**, worst **25.87**, best **98.27**, current **95.2**, coverage **27.6**. Solo: Q **54.95**, T **63.0**, Exam **80.7**.
  - Finals `{Q: 36, [72,68], 1 pending}`, `{T: 24, [60,70]}`, `{Exam: 40, 1 pending}` with target 97. Expected: need > 100, best **84.4**. Closest reachable: C **91.5**, D+ **81.9**, D **72.3**.
- **Edges:** nothing graded (current null); everything graded (b = 0); a category with `n + k = 0` (excluded, weights renormalize); target 0 or 100; `extra` on a singleton is clamped to 0; scenario substitution keeps 5 cells.
- **periodModel:** a linked carry singleton, transmuted values, and legacy-mode equivalence with today's `GradeCalculator` finals formula when all categories have data.

## 5. Visual system (`studypulse.css`)

- **Tokens:** `--sp-*` names with the values of the `--wb-*` text, brand, semantic, glass-panel and glass-item, radius, shadow and motion tokens (mockup `:root`).
- **Fonts:** DM Sans for headings and big numerals, Inter for UI. Both are already self-hosted via `src/app/fonts.css`.
- **Numbers:** every numeral uses `font-variant-numeric: tabular-nums` (`.sp-num`).
- **Icons:** Lucide icons replace all emoji in scope (📅🎯⚙️📥📢🏁🔗✦◇⏳). Status uses words plus color, never color alone.
- **Contrast:** all text meets ≥ 4.5:1 on its surface (the same proxy method as Workboard). No `#ccc` or `#bbb` text. The faintest tone is `--sp-text-faint` (#9aa4b5), and only for placeholders and the "—" glyph.
- **Category colors:** a fixed 6-color cycle by category index within a period (violet `#8b7fd6`, blue `#74bcd9`, pink `#f2a7c0`, amber `#f0a35c`, green `#6bb58a`, slate `#8a94a6`). The same color is used for the period weight bar, the category swatch and the planner's category dot.

## 6. Surfaces (match mockup v4)

### 6.1 My Subjects

- **Title:** solid ink "My" plus a gradient "Subjects". Subline: subject count, total units, trimester and year (most common values). Dashboard is a ghost button. Add/Close is the primary pink button, and its icon rotates 45°.
- **Form sheet:** a two-column glass panel with the form on the left and a **live preview card** on the right. The preview stacks under the form below 900px.
  - **Course group:** course code and block section in monospace caps, then subject name in a larger input.
  - **When group:** year level, trimester, term and units become `.sp-seg` segmented controls.
  - Required marks stay. Validation shows inline under the field.
  - Footer: "Create & set up grading →" (edit mode: "Save changes"), Cancel, and an Enter/Esc hint. Esc closes the sheet.
- **Subject card:**
  - Course code eyebrow, then the name (2-line clamp), then the letter and meaning ("A · Excellent", toned by grade, **no number**).
  - The **ring** on the right shows the rounded current grade. The ring fill = grade %, in the pink→blue gradient. No grade gives "—" on a grey ring.
  - Chips: year, trimester, **Block X**.
  - Footer: "x / y graded" and units. Edit and delete appear on hover or focus.
  - **Data change:** `src/app/studypulse/subjects/page.tsx` (server) and `src/app/api/studypulse/subjects/route.ts` both build the card list today with `progress_percent`. Both add `current_grade: number | null` and `grade_scale`. They load each subject's grading config and entries, and run the pure `periodModel` and `projection` libs server-side on **raw** grades (the transmutation table is client-loaded; cards ignore it). Overall = the final-grade rule when the preset has one, else the mean of the non-null period currents. Legacy subjects use the `overall` period. The ring stops showing task completion. `progress_percent` stays in the payload, unused by the card.

### 6.2 Subject header and toolbar

- **Header:** breadcrumb, title (DM Sans 32), course code tag plus block, and meta chips with icons (units, year, trimester, preset name).
- **Grade tiles** per period plus the final grade, with an explicit **Grade pt / Percent / Letter** segmented switch. It replaces click-to-cycle, and the choice persists in `localStorage`.
- **Toolbar:** `PeriodTabs` on the left. On the right: **Transmute** as a real switch (it keeps its loading and error behavior), **Target planner** (dark when active), **Grading**, and **Canvas ▾** (a menu with Activity Bank and Announcements).

### 6.3 Period tabs

- **Single-select** tabs per period plus **Both/All** (shows every period, the default).
- A white indicator slides between tabs. Each tab shows its current grade in a tone chip.
- Keyboard: arrow keys move, and the control carries `role="tablist"`.
- The `selectedPeriodIds` state becomes `selected: periodId | 'all'`.

### 6.4 Period panel and entry tables

- **Period header:** name, a status chip ("95.2 · 28% of grade in"), and a stacked **weight bar** with a legend.
- **Category section:** swatch, name, weight chip, "x of y graded", an average pill (tone by grade, "Not yet" when empty), "Add {noun}", and collapse.
- **Table columns:** Name (with a Canvas source tag when linked), Due (with relative context "tomorrow" or "in 3 days" within 7 days), Submitted (with "on time" or "N days late" when both dates exist), **Score as "24 / 25"**, Grade pill (with a raw → transmuted display when transmutation is on), and actions.
- **Actions:** edit and delete show on row hover or focus. While editing: ✓ and ✕. Rows that are new or being edited keep today's behavior.
- **Ungraded rows** show a dashed "Pending" pill. **No projected rows (D8).**
- **Singleton categories:** an inline "Score [ ] / [ ] Save" row instead of a one-row table. The linked-carry note stays, restyled with a link icon instead of 🔗.
- Below 720px the table scrolls horizontally inside its card. The page itself never scrolls sideways.
- The `CustomGradeCalculator` and legacy `GradeCalculator` summary is restyled to the same tokens, with no layout redesign. Its numbers come from `projection.ts` (D11).

### 6.5 Target planner (D2, D9, D10)

There is one card per period, in a 2-column grid that becomes 1 column below 1000px.

1. **Top:** period name, status chip, a target stepper (− input +, clamped 0–100), and letter quick chips from the active scale (4.0: A 97 · B+ 93 · B 89 · C+ 85 · C 80 · Pass 70; the 1.0 scale uses its thresholds).
2. **Numbers:** Current (big, success if ≥ target, otherwise danger) with its letter, plus Target with its letter and "N% of the grade is in".
3. **GradeBar** (`dataviz` rules):
   - The domain is **50–100**, with a "50" axis label at the left.
   - The fill is current, in the status gradient.
   - A hatched band shows worst→best.
   - The target is a dark ink tick plus a **pin below** the letter-tick row.
   - Current is a **tag above** the bar.
   - The plan is a hollow ink ring.
   - Labels clamp at the edges: a tag near the right edge anchors right, and a pin above 88% of the width anchors at 80%.
4. **Headline** (achievable or stretch): "{need}% · Average {need}% on your {k} remaining items to finish at {target} ({letter}). Reachable range: {worst} – {best}." The out-of-reach and safe variants follow §4.3. Out of reach adds the closest-reachable chips.
5. **Plan your remaining items** (sandbox), with "Reset to required" on the right.
   - Per category: swatch, name, weight, "n graded · avg" and **Remaining − k +**. `−` is disabled when extra = 0. A singleton shows "single score". `k = 0` shows "Nothing left here. Its X is locked in."
   - **Slots:** one per remaining item. Pending entries are solid and named after the entry. Extras are dashed, named "{noun} {index} · planned".
   - Each slot has a number field (decimal text input, 0–100) and a slider. Both stay in sync.
   - Untouched slots follow the required value. A touched slot becomes "dirty" (blue border) and keeps its value through target and count changes. Reset clears dirty.
   - **Outcome card (D10):** a light glass card with a state tint and a 4px left stripe: "YOUR PLAN 87.3", a letter chip, and a delta chip ("✓ On target", "+N over target" or "N short of target").
6. **If you average this on everything left:** 5 scenario cells (input %, result, letter). Cells that hit the target are success-tinted with ✓.
7. **What if only one category changes?** A `<details>`, collapsed by default, listing per category "need X avg", "already safe", "out of reach" or "locked".

The panel header shows the scale chip ("4.0 scale", plus "transmuted" when on) and Close. There is no AI anywhere.

## 7. Motion (`emil-design-eng` / `animate` rules)

Easing is `--sp-ease` (`cubic-bezier(.23,1,.32,1)`). Only transform, opacity, color and background are animated, plus grid-template-rows for collapses. This is required by `scripts/wb-style-gate.mjs`'s `layout-transition` rule, which this work also runs.

| Element | Motion |
|---|---|
| Period tab indicator | `transform: translateX()` 320ms. Its width is set from the active tab with no transition. |
| Planner open/close | grid-rows 0fr→1fr, 280ms, plus content fade with a 90ms delay. Same as today's form shell. |
| GradeBar fill and range band | full-width elements, `transform: scaleX()` with `transform-origin: left`, 300ms. The range band is a wrapper `translateX` plus an inner `scaleX`. |
| Plan ring, current tag, target pin | positioned by `left`, which is not transitioned; the ring alone animates via `transform: translateX()` on a full-width track layer, 300ms |
| Headline / outcome numbers | No count-up tween; the value changes instantly. The tint transitions 300ms. Numbers being dragged must never lag. |
| Category collapse | grid-rows, 240ms. The chevron rotates 180°. |
| Row actions | opacity 150ms on hover or focus-within |
| Buttons and chips | `scale(.97)` on `:active`, 120ms |
| Subject cards | today's hover lift is kept (−4px, 200ms) |

Under `prefers-reduced-motion: reduce`, durations drop to 1ms and the hover lift is removed. Nothing in scope animates on page load except the existing staggered card fade-in.

## 8. Accessibility

- Every segmented control is a `role="radiogroup"` (or `tablist` for periods) with arrow-key support and visible `:focus-visible` rings (`.sp-focus-ring`).
- Sandbox sliders have `aria-label="{slot name} score"` and `aria-valuetext="{v} percent"`. Number fields have matching labels.
- The outcome card is `aria-live="polite"`, debounced to 300ms.
- Status is never color-only. Each tone pairs with a word or a glyph (✓, "short of target").
- Touch targets are ≥ 32px. Steppers are 28×32 inside a 32px-tall control.

## 9. Verification

1. `node:test` suites for `projection.ts` and `periodModel.ts` pass. They run with a new `scripts/sp-test.mjs`, a copy of the `scripts/fin-test.mjs` / `wb-test.mjs` transpile-and-run pattern pointed at `src/lib/studypulse`.
2. `npx tsc --noEmit` is clean.
3. Playwright screenshots at 1440, 1024 and 390 of: My Subjects (form open and closed), a custom-preset subject (Both and a single period), a legacy subject, and the planner in achievable, stretch, out-of-reach and safe states. Each is compared against mockup v4.
4. **Stress pass (`break-ui`):** a 90-character subject name, a 12-character block, 0 subjects, 30 entries in a category, 5 periods, every category graded (b = 0), no grade scale, transmutation on.
5. The numbers match across the header tiles, period tabs, period header, calculator and planner for the same subject.
6. A final `impeccable` critique and `review-animations` pass on the finished screens.

## 10. Out of scope

Landing, GWA calculator, Schedule maker, Canvas pages and the grading setup wizard (it is only reached via the Grading button and is not restyled). No mobile-first redesign beyond the breakpoints above. No new grading features beyond the projection.
