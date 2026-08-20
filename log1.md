# VibeBoard — Session Handoff Log 1

**Scope of this session:** Study Pulse module (grading system overhaul), Study Pulse dashboard redesign, GWA Calculator redesign + OCR pipeline fixes, and installation of five external Claude Code design skills at user level.

**Stack reminder:** Next.js (App Router) + TypeScript, MySQL via `mysql2/promise` (pool at `src/lib/db.ts`), no ORM (raw SQL), no test suite (verification throughout this session was `npx tsc --noEmit`, direct MySQL queries against the live `vibeboard` DB, and HTTP route-mount checks via `curl`). Design system is locked: pink `#f2a7c0` + blue `#74bcd9` two-tone glassmorphism, purple `#a78bfa` as a minor accent only, Inter/DM Sans fonts, `lucide-react` icons (no emoji as structural icons). Not a git repository — no commits were made; all changes are live in the working tree.

---

## 1. Bug fix — deadline / date-accomplished blank on refresh

**File:** `src/lib/db.ts`

**Root cause:** The mysql2 pool config had no `dateStrings: true`. Without it, MySQL `DATE` columns come back as JS `Date` objects. Multiple places in the codebase did `String(dateValue).split('T')[0]` assuming an ISO string like `"2025-06-10T00:00:00.000Z"` — but `Date.prototype.toString()` actually returns something like `"Tue Jun 10 2025 00:00:00 GMT+0800 (Singapore Standard Time)"`, which has no reliable `'T'` boundary. The split produced garbage or an empty string, which `<input type="date">` silently rejects, rendering blank.

**Fix:** Added `dateStrings: true` to the pool config. Verified directly against the live DB with a throwaway Node script (before: `typeof deadline === 'object'`, `instanceof Date`, split produced `""`; after: `typeof deadline === 'string'`, exact `"2025-06-10"`).

**Same buggy pattern existed in 4 places** (all fixed by this one config change, no code-site changes needed): `src/app/studypulse/[id]/page.tsx` (`toEntry`), `src/app/studypulse/page.tsx`, `src/app/api/studypulse/trimester/route.ts`, `src/app/api/studypulse/stats/route.ts` (days-remaining calc).

---

## 2. Grading system overhaul (Study Pulse)

This was the largest and most iterative piece of work. Read this section fully before touching grading code — several early designs were built, then explicitly reverted or replaced based on user feedback. **Only the final state described here is current.**

### 2.1 Zero-fill display fix (final, correct behavior)

**User's rule (confirmed twice after an over-broad first attempt):**
- Within a period that has **some** data, a still-ungraded category is **assumed perfect (100)** — this was already the original behavior and was preserved.
- A period with **zero** data anywhere shows **0** (previously it misleadingly showed as if perfect, or blank).
- The per-category breakdown row always shows the category's **real** value (0 if that specific category is empty) — this was already correct and untouched.

**What went wrong first, and why it was reverted:** I initially made every empty category count as 0 in the period-total math too (not just the breakdown), which broke partial-fill periods (e.g. Midterm with only Quizzes scored dropped to ~29% instead of the correct ~93% that assumes Tasks/Exam are still perfect). This was caught by the user via screenshot and reverted to the rule above.

**Where implemented** (`src/components/studypulse/SubjectCardView.tsx`):
- `CustomGradeCalculator`: `actualGrades` (raw, 0 if empty) → `catHasData` → `effectiveGrades` (100 if category empty, but only meaningful within a period that has data) → `periodGrades` (checks `periodHasData` per period; returns 0 outright if nothing in the period has data, else computes the weighted assume-100 average).
- Same pattern applied to the **legacy** Activities/Quizzes/Exams calculator (`GradeCalculator` function) — `componentHasData`/`hasGradeData` etc. were restored after being wrongly deleted, then a `modeHasAnyData` check added so an entirely-empty mode also shows 0 instead of 100.
- Header stat pills (`headerPeriodGrades` in the main `SubjectCardView` component) mirror the same logic.
- This applies to **both** the "upper" period card display and the header stat pills, per the user's explicit request; the bottom breakdown display was already correct and untouched.

### 2.2 Final Grade feature (new)

**Wizard flow** (`src/components/studypulse/GradingSetupWizard.tsx`), in order:
`choose` → `scale` → **`method`** (new step: Average vs Collective, asked up front) → `build` (periods/categories) → `final` (simplified: pick which period is "the final" for labeling only, and yes/no on showing a separate summary) → `lab` → `saving`.

**`final_mode` is now `'average' | 'collective' | null`.** An earlier `'period_grade'` mode (manually re-weight one period's categories to fake a cumulative total) was built, then **explicitly removed** at the user's request in favor of Collective mode automating the same thing. Do not reintroduce `'period_grade'`.

- **Average**: mean of every period's own computed grade.
- **Collective**: pools **every category instance from every period** into one weighted average, each at its own **independently set** local weight (periods are never forced to share a weight for a "linked" category — see 2.3). Self-normalizing (`Σ(grade×weight)/Σ(weight)`), so it tolerates the total not landing exactly on 100. A category with no data assumes 100 *unless nothing in the whole pool has data*, in which case the result is 0 (same philosophy as 2.1, applied one level up).
- The designated "final period" (`final_period_id`) is now **purely a label/badge anchor** (🏁 shown on that period's column/pill) — it does not affect either calculation, since neither mode is tied to one specific period's own number anymore.
- Display: a distinct "Final Grade" summary card/pill is shown whenever `finalGrade !== null`, for both modes (not just Average) — labeled "average of all periods" or "collective percentage of all categories" accordingly.

**Schema** (`src/lib/migrate.ts`, `ensureFinalGrade()`): `grading_presets.final_period_id INT NULL`, `grading_presets.final_mode VARCHAR(20) NULL`. Lazy-migrated (ALTER TABLE on first use, same pattern as the pre-existing `ensureGradeScale()`).

### 2.3 Category linking + score carry-forward (new, went through 2 full redesigns)

**Current, final model** — confirmed correct by the user after two rounds of revision:

- **"Same in other periods" toggle** (`link_group`, a string shared by linked copies): auto-creates a matching category (same name) in every other period when first checked. **Weight is always independently editable per period from then on** — editing weight in one period never touches the linked copy in another. (Earlier versions force-synced weight across linked copies via a separate "Different weight collectively" + numeric override field — **this was entirely removed** at the user's request; do not reintroduce a `collective_weight` UI or force-synced weight.)
- **"Carry score to other periods" toggle** (`carry_score`, boolean, singleton categories only, default true when linked): when a linked singleton category has no score of its own yet, it automatically reuses a linked sibling's score (from whichever period does have one) for all calculations — period grade, breakdown display, and Collective total. The entry section (`CustomEntrySection`) shows a "🔗 Using [Period]'s score (X.XX) — add your own above to override it just for this period" note when this fallback is active; entering a score there overrides it going forward for that period only.
- **Resolution logic** lives in `CustomGradeCalculator` (`linkGroupSource`, `resolvedGrades`, `resolvedHasData`) and is mirrored at the header-pill scope (`headerLinkGroupSource`, `headerGetGrade`, `headerHasData`) and for the entry-section note (`linkGroupSourceInfo`) in the main `SubjectCardView` component. If touching any of these, update all three call sites together — they're intentionally parallel implementations, not shared via a hook (could be a good refactor target later, but was left as-is to minimize risk during rapid iteration).

**Schema** (`src/lib/migrate.ts`, `ensureCategoryLinking()`): `grading_categories.link_group VARCHAR(40) NULL`, `grading_categories.carry_score TINYINT(1) NOT NULL DEFAULT 1`. **Note:** a `grading_categories.collective_weight DECIMAL(5,2) NULL` column also exists in the DB (added by an earlier, now-abandoned design) — it is **unused** by any current code. Harmless to leave; safe to drop in a future cleanup migration, but nothing currently reads or writes it.

### 2.4 Collective calculation (final, simplified)

`computeCollectiveGrade()` (module-level function in `SubjectCardView.tsx`) takes `(periods, resolvedGrade, resolvedHasData)` — both callbacks accept the **category object** (not just its id), typed as `PresetCategory`. It flattens every category across every period into one list and does a single self-normalizing weighted average. **There is no grouping/deduplication step** — an earlier design grouped linked categories and averaged them as one unit before pooling; this was found to be unnecessary and was removed, since per-period-independent weights (2.3) combined with self-normalization already produce the correct proportions without it. If re-deriving this function, do not reintroduce grouping — verify against the math notes in the function's own doc comment first.

### 2.5 API route changes

`src/app/api/studypulse/grading/route.ts` (`POST`): inserts `link_group` and `carry_score` per category (no longer `collective_weight`); resolves `final_period_index` → `final_period_id` after period rows are inserted, then updates the preset row with `final_period_id`/`final_mode` if `final_mode` is `'average'` or `'collective'`.

---

## 3. UI/UX redesign passes

### 3.1 Wizard & grade-entry layout — 2-column tried, then reverted

A 2-column responsive grid (`grid-template-columns: repeat(auto-fit, minmax(...))`) was applied to (a) the wizard's period/category builder and (b) the main grade-entry view's period blocks. **The user found this did not look good and asked for a full revert.** Both are back to single-column stacked layout (`marginBottom` spacing, no grid wrapper). Do not re-attempt a multi-column layout for these two areas without being asked again.

### 3.2 `SubjectsGrid.tsx` (My Subjects page) — delete button relocation

The delete (trash) button used to float absolutely at the card's top-right corner, appearing only on `:hover`. Two real problems found and fixed: (1) it visually collided with the `GradeRing` progress circle in the same corner; (2) since it only existed via CSS `:hover` with base `opacity: 0`, it was **completely unreachable on touch devices** (the `onContextMenu` right-click fallback isn't a real substitute on mobile). Fixed by moving it into the footer row (next to the `ArrowRight` hover-arrow), given a low-opacity-but-always-present default (`0.45` idle → `0.7` on card hover → `1` + red on its own hover/focus) so it's discoverable and tappable on every device, not just visible-on-desktop-hover.

### 3.3 `StudyPulseLanding.tsx` (Study Pulse dashboard) — full visual revamp

Was using an old, off-brand palette (teal `#26a69a` numbers, plain white boxes, generic `#4dabf5`/`#ec407a` gradients) predating the rest of the app's design-system consistency work. Revamped to match the locked glass/pink-blue system: glass header with icon badge + `gradient-text` title + a subtle animated pulse-glow accent (respects `prefers-reduced-motion`), glass stat tiles with Lucide icons, glass filter pills, glass setup modal (was a flat white card). **Real bug fixed along the way:** the Activity/Quiz/Exam progress-bar trio was using the exact same pink (`#f8a5c2`) for both Activity and Exam — two different categories were visually indistinguishable. Now uses the same pink/blue/purple (`#f2a7c0`/`#74bcd9`/`#a78bfa`) triple already established elsewhere in the app for this exact Activities/Quizzes/Exams grouping. The progress-bar + grade-ring **concept** was explicitly preserved per the user's instruction (only the visual treatment changed, not the mechanism).

### 3.4 `GwaCalculator.tsx` — full visual revamp (layout/interaction only, OCR logic untouched in this pass)

Used `ui-ux-pro-max` skill's design-system CLI plus manual audit. Concrete issues found and fixed:
- **Emoji used as structural icons everywhere** → replaced with `lucide-react` icons throughout (`Calculator as CalculatorIcon`, `GraduationCap`, `BarChart3`, `CalendarDays`, `Image as ImageIcon`, `FileText`, `Camera`, `FolderOpen`, `Loader2` with a CSS spin, `Trash2`, `Home`, `ArrowLeft`, `Plus`, `TriangleAlert`).
- **Focus rings were explicitly removed** (`outline: 'none'` on every input, nothing replacing it) — restored via `.gwa-input:focus-visible` / `.gwa-focusable:focus-visible` CSS classes.
- **Off-brand palette**: purple/blue/pink used as three equal primaries → realigned to the locked pink/blue two-tone, purple kept only as the OCR/scan feature's minor accent.
- **Color mapping bug**: 1.0-scale and 4.0-scale colors were backwards relative to the grading wizard's own convention. Fixed to match exactly: **4.0-scale = blue, 1.0-scale = pink**, everywhere on the page (top-nav badge, `ScaleSelect` cards, etc.).
- **`ScaleSelect` redesign**: was a sparse text-line list ("1.00 = Excellent", "1.25 / 1.50 / 1.75" …) on a low-contrast gradient-text heading sitting directly on the busy animated background (nearly invisible). Rebuilt to match the grading wizard's own scale-step exactly — wrapped the header in a glass panel for guaranteed contrast, switched to single-column stacked cards with the same chip-badge breakdown (`97–100 → A (Excellent)` etc., data hoisted into `SCALE_4PT_CHIPS`/`SCALE_1PT_CHIPS` constants, duplicated intentionally from the wizard rather than importing, to avoid cross-file coupling for what is purely display data).
- **Subject-table column alignment bug** (two rounds): first attempt used two independently-flex-computed containers (header row vs. data rows) that drifted apart. Fixed by flattening both to **4 direct children of one shared `.gwa-row` CSS Grid** (`grid-template-columns: minmax(120px, 1fr) 76px 108px 28px`) — header and data rows now share literally the same column tracks, guaranteeing pixel alignment. (An earlier narrower column width also caused the "GRADE (0.0–4.0)" header to wrap and the input placeholder to visibly truncate — fixed by widening the grade column and dropping the redundant range text from the header, since it's already shown in each row's own input placeholder.)
- **Export template** (`buildExportHtml`, used identically for both PNG and PDF downloads via `html2canvas`): re-themed to the same pink→blue gradient and colors so the exported file visually matches the page. The rendering mechanism itself (off-screen HTML → `html2canvas` → `toDataURL`/`jsPDF`) is untouched.

---

## 4. OCR pipeline fixes (GWA Calculator, `parseOcrText` / `preprocessForOcr`)

**Critical constraint carried through this whole section:** the user has a working reference image (`hi.png`, a clean high-contrast PNG with a `TN33`-style section-code table) that must **never regress**. Every fix below was traced through the algorithm by hand against real raw OCR text the user pasted from the debug panel (not guessed), and the user re-confirmed after each fix that `hi.png` was unaffected. If touching `parseOcrText`, `mergeOcrLines`, `normalizeSlot`, `extractCourseCode`, or `preprocessForOcr` again, get fresh raw OCR text from the "Raw OCR text (debug)" `<details>` panel in the UI before changing anything — don't guess at regex fixes.

1. **Row-drop bug** (fixed): Strategy 2 (the fallback parser path — used whenever a table has no `TN33`-style section-code column, e.g. the user's PT-program report) used to unconditionally `continue` (drop the entire row, including name and units) when zero grade digits could be extracted at all. Strategy 1 already had the correct behavior (keep the row with a blank grade). Now Strategy 2 does too — it does a secondary units-only scan and pushes the row with `slots: []` if a plausible unit count is found. This fixed a row (`LIWORIZ`) vanishing entirely when Tesseract totally failed to read its grade cell.

2. **Uncertain-name flag** (new, cosmetic, non-destructive): `resolveName()` now returns `{ name, uncertain }`. `uncertain` is true only when the name fell through to the token-fallback path (the clean `extractCourseCode` regex failed) **and** the resulting token mixes digits and letters (e.g. `PTI0I`) — never on legitimate all-letter fallback names like `ETHICS`/`LIWORIZ`, never on a clean regex match. Threaded through `SubjectRow`/`PeriodDataRow` (`uncertain?: boolean`), `switchToPeriod`, `handleModeSelect`. Shown as a small amber `TriangleAlert` icon + tooltip on the name input; clears the moment the user edits that name (`setField` clears it when `f === 'name'`). **This cannot detect every wrong OCR read** — a clean-looking-but-wrong code like `PT1010` (should be `PT10110`) is structurally indistinguishable from a genuinely correct one and will never be flagged. This is a known, explained limitation, not a bug to chase further without a course-catalog data source to fuzzy-match against.

3. **Grade self-correction gap on the 4.0 scale** (fixed): `normalizeSlot`'s "snap to nearest valid grade point within a small tolerance" logic (catches single-glyph OCR misreads like `5`→`0`) previously existed **only** for the 1.0 scale (0.25-increments). Added the same mechanism for the 4.0 scale using this app's own canonical points from `src/lib/gradeScale.ts` (0.5, 1.0, 1.5 … 4.0), refactored into one shared `snapToScale()` helper used by all three normalization branches (decimal, `/10`, `/100`). Verified safe against `hi.png`'s deliberately out-of-range `9.0` (stays correctly rejected, nowhere near a valid point) and its already-exact values (zero-distance snap, no-op).
   - **Important finding surfaced during this fix and explained to the user**: values like `2.25`/`1.25` are not valid points on the 4.0 scale at all (it steps in 0.5s). If a Philippine-style (`.25`-increment) report is scanned while "4.0 Highest" is selected instead of "1.0 Highest", those values will never self-correct — this is a **scale-selection mismatch on the user's part**, not a parsing bug, and was correctly diagnosed via hand-tracing rather than assumed.

4. **Image preprocessing pipeline — the single biggest accuracy win** (fixed): the pipeline's very first line was `if (file.type === 'image/png') return file;` — **every PNG skipped all preprocessing**, on the assumption that PNGs are always lossless screenshots with adequate resolution already. That assumption doesn't hold for a smaller/lower-resolution PNG, and Tesseract's LSTM is well documented to start dropping/confusing characters below ~20–30px character height — which matches the *dropped-character* symptom (`PT1019`→`PTI0I`) far better than a contrast problem does. Refactored to separate two independent concerns:
   - **Size** (`longestEdge < 1400px` → upscale to a 2200px target), checked for **every** file type including PNG.
   - **Contrast** (existing histogram-based check, `< 180` → upscale to 2400px + grayscale/stretch), unchanged logic, still only applied when actually needed.
   - A PNG only takes the original zero-processing fast path when it is **already** both large and (implicitly, since it's untested at that point) presumed fine — precisely preserving `hi.png`'s behavior (confirmed unaffected by the user) while giving small/low-res images — including PNGs — a real chance at upscaling.
   - **Result, user-verified against `hi.png`'s companion troublesome image**: went from ~3 of 9 rows readable to **9 of 9 rows present with 100% correct grades and units** (GWA math independently verified: `48.75/23 = 2.12`, matched exactly). Course-code text quality also improved dramatically (`PTIOM`→`PT 10M`, still one character off but far more recognizable), though single-digit-level misreads on otherwise well-formed codes remain (see next item and the "practical ceiling" note below).

5. **Name-fallback space-merge bug** (fixed): a course code rendered with a space in the source (`"PT 10M3L"`, same pattern as the already-working `"PT 1019"`) that fails the primary anchored regex only because of embedded OCR noise (the `"M"` breaking the digit run before a valid `\b` boundary) used to fall all the way through to `firstTok = r.name.split(/\s+/)[0]`, which grabbed only `"PT"` and silently discarded everything after the space — including the part that actually identifies the subject. Fixed: when the first token is a short bare letter-prefix (`/^[A-Z]{2,4}$/`) and the *next* token starts with a digit, merge them (`"PT"+"10M3L"` → `"PT10M3L"`) before falling back further. Verified this doesn't affect already-clean multi-letter fallback names (`ETHICS`, `LIWORIZ` are too long to match the 2–4-char prefix check, so they're unaffected) and doesn't affect anything that matches the primary regex (never reaches this code path).

**Practical ceiling reached and explained to the user**: remaining errors are single dropped/misread digits inside otherwise well-formed OCR text (e.g. `PT1010` instead of `PT10110`) that are, by design, indistinguishable from genuinely correct text — going further would require either (a) fuzzy-matching against a real course catalog for the institution (no such data source exists in this app), or (b) a manual "zoom and re-scan just this cell" UI feature (a real, separate feature, not a bug fix). Both were discussed with the user as **future options, not started**.

**User's direct question "should I use a better OCR model?"** was answered as an opinion (not implemented): recommended considering a vision-capable LLM (Claude/GPT-4V) or a dedicated table-extraction API (AWS Textract) over Tesseract if accuracy needs to go further, with the explicit tradeoff that this moves OCR from a free/instant/offline client-side call to a paid/networked server-side one — a real architectural change, not a tweak. **No implementation work was done on this.**

---

## 5. External skills installed (user-level, not part of the app)

Not application code — installed into `~/.claude/` (global Claude Code config) and via `claude plugin`, not into the VibeBoard repo. Documented here only because a future agent working on this machine should know they're available and where they came from.

| Repo | Method | Landed at |
|---|---|---|
| Leonxlnx/taste-skill (6 of 13 skills, curated — see log for exclusions) | `npx skills add --copy` | `~/.claude/skills/{design-taste-frontend, industrial-brutalist-ui, gpt-taste, minimalist-ui, redesign-existing-projects, high-end-visual-design}` |
| pbakaus/impeccable | Claude Code native plugin (marketplace add + install; the author's "Recommended" CLI installer hung indefinitely and was killed) | Plugin `impeccable@impeccable`, v4.1.1, scope user — **installs 2 hooks** (`PostToolUse` on Edit/Write/MultiEdit, `Stop`) that run automatically in **every** future project/session unless disabled (`claude plugin disable impeccable`) |
| nextlevelbuilder/ui-ux-pro-max-skill | `npm install -g ui-ux-pro-max-cli` + `uipro init --ai claude --global` | `~/.claude/skills/ui-ux-pro-max` (v2.15.0) — **also silently installed 6 unrelated third-party "claudekit" skills**: `banner-design`, `brand`, `design`, `design-system`, `slides`, `ui-styling` (left in place, not requested, not removed) |
| emilkowalski/skills (all 11) | `npx skills add --copy` | `~/.claude/skills/{animate, animate-expo, animation-vocabulary, apple-design, ask-sonner, emil-design-eng, find-animation-opportunities, improve-animations, pick-ui-library, prototype, review-animations}` |
| anthropics frontend-design | Existing `claude-plugins-official` marketplace (already registered) | Plugin `frontend-design@claude-plugins-official`, scope user |

**Pre-existing project-level duplicates found in VibeBoard's own `.claude/skills/` (untouched):**
- `frontend-design` — byte-for-byte identical to the one now installed globally.
- `ui-ux-pro-max` — the project copy is an **older version** (161 palettes/57 fonts) than the newly-installed global one (192 palettes/74 fonts, v2.15.0). Both work; project-scope takes precedence for VibeBoard specifically. Not updated — flagged to the user, no action taken.

---

## 6. Verification methodology used throughout

No test suite exists in this project. Every change in this session was verified by:
1. `npx tsc --noEmit` after every edit batch (zero errors maintained throughout).
2. Direct queries/dry-run `ALTER TABLE` statements against the live `vibeduplicate` — actually the live **`vibeboard`** MySQL DB via `"/c/xampp/mysql/bin/mysql.exe" -h localhost -u root vibeboard -e "..."` to confirm every new column lands as expected before/independent of the app's own lazy-migration functions running.
3. `curl -s -o /dev/null -w "%{http_code}"` against the relevant Next.js route (`/studypulse`, `/studypulse/subjects`, `/studypulse/gwa-calculator`) after every batch, expecting `307` (auth redirect = compiles and mounts without a server crash) — the app's own dev server (`next dev --turbopack`) was already running throughout the session (started by the user, not this session) and picked up changes via hot reload.
4. For OCR-specific fixes: hand-tracing the actual algorithm line-by-line against real raw OCR text the user copy-pasted from the in-app debug panel — never guessed at what Tesseract would output.

No UI was driven directly by this agent (no browser automation available) — all visual verification was done by the user via screenshots, iteratively.
