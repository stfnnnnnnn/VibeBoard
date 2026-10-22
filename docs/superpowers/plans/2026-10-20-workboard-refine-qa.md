# Workboard refinement: QA record

## Stress pass (Task 14, break-ui), 2026-10-21

**Fixture page:** `/workboard/stress?case=busy|tiers|sparse|long|empty`. It is dev-only, and its ids are ≥ 900000.

**Sweep:** 5 cases × 4 views × 390/820/1440 = 60 screenshots, in `.superpowers/sdd/2026-10-20-workboard-refine/qa/`.

**Automated checks:** horizontal page overflow, child-past-parent overflow inside the view panel, and console errors and page errors.

**Results:**
- No page overflow in any combination.
- No console errors.
- The overflow flags were expected:
  - Table `.vb-row-glass`: the layer is absolutely positioned to its row by design.
  - Board `⋮` trigger: overhangs its card by 7px. This was accepted in the 2026-10-06 revamp.
  - Phone `.vb-tl-week`: overhangs by 4px inside its scroller and is not visible.

### Defects

| # | Severity | Where | Worst-case value | What happens | Fix | Status |
|---|---|---|---|---|---|---|
| D1 | Ugly | Timeline chips in narrow columns (weekends at 1440, every column at 390) | context "Thesis Prototype" | The chip text is cut mid-word with no ellipsis ("Thesis Proto") | Chip `max-width: 100%; min-width: 0`; label `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`; full name in `title` | fixed: the label is in its own ellipsizing span with `min-width: 0` (`text-overflow` has no effect on an inline-flex container) |
| D2 | Broken (wrong data shown) | Table StatusCell label, My Work tab | Projects item, stage `blocked` | The pill says "For Revision". The amber dot is correct for `blocked`, but the label is wrong: on the all-contexts tab the status options or label resolution map `blocked` to the wrong stage label | Find where StatusCell picks its label and options on the `all` tab; a waiting item must read "Blocked" (or the stage's own `STAGE_LABELS` entry). Check the Board's lanes and badges for the same mapping | **Not a code bug.** `STAGE_LABELS.blocked` is deliberately `'For Revision'`, the user's existing uncommitted wording (HEAD had `'Blocked'`). A relabel to "Waiting" was tried and reverted; the label is left for the user to decide |

### What held up
- **Long and odd titles:**
  - Long titles clamp to 2 lines (Up next hero), 3 lines (Board card) or 1 line with an ellipsis (Up next cards, Table, Focus day list).
  - Unbreakable file names wrap with `overflow-wrap: anywhere` on Board and truncate elsewhere.
  - `<script>alert(1)</script> & **bold**` renders as plain text everywhere.
  - Non-Latin text and emoji (日本語のタイトル 🎓) render and truncate cleanly.
- **Short course codes:** `3TSY2526_CS0061L_TN3` → `CS0061L` on Board, Table and Up next.
- **Up next ranking:** overdue first, then today by time, then untimed; "More overdue" fills once Up next is full (busy); "Nothing urgent. Nice." shows when empty.
- **Week picker:** today ring and pink letter; due bars scale by hours, class bars cap at 3; the cancelled or moved class is struck through.
- **Timeline:**
  - The conflict banner clamps on phone.
  - Past days keep readable text.
  - The make-up "From Wed, 10/21" line is readable.
  - Weekend columns are narrower.
  - The today glow and now line are correct.
- **Board:** the High chip, the subtask bar, the tinted overdue tag, the waiting reason truncating with an ellipsis, and the empty Done lane drop target.
- **KPI cards:** 18 / 6 / 8h / 6 overdue fit, with sub-labels clamped on phone.

## Contrast record (Task 15, step 5)

Checked against `#c2e9fb`, the lightest background stop, with the glass alpha applied where the text sits on a panel or item. The floor is 4.5:1 for body text and 3:1 for large numerals and non-text.

| Pair | Ratio | Source |
|---|---|---|
| New item: white on gradient top `#c64480` / mid / bottom `#b5396e` | 4.63 / 5.04 / 5.56 | Batch B fix 1 |
| Zero numerals `--wb-text-zero` `#737d8f` (large) | 3.23 (bare), 3.40–3.67 (card) | Batch B fix 1 |
| Pink text `--wb-pink-ink` `#b0396d` (eyebrows, today labels, High chip) | ≈4.75–5.5 | Batch C fix 1, Task 12 |
| "Up next" eyebrow and Show-all fold, `--wb-text` on the bare background | ≈9.5 | Batch C/D fixes |
| Empty-state "Add something for today" link, `--wb-text` | ≈9 | Batch D fix 1 |
| Week picker past date `--wb-text-muted` (full opacity) | ≥4.6 | Batch D fix 1 |
| Table done title `--wb-text-muted` + 1.5px line-through | ≈4.6 | Task 11 fixes |
| Table overdue-row cells `--wb-text` on the pink wash | ≥7 | Task 11 fix 1 |
| Board empty-state text on the glass panel | 4.72 | Task 12 fix 1 |
| Board High chip text `--wb-pink-ink` | 5.5 | Task 12 |
| Timeline class chip text `--wb-text` on 45% course tints | ≥7 | Task 13 |
| Timeline past-day chip text (surfaces fade only) | ≥5.22 | Task 13 fix 1 |
| Timeline make-up "From …" text `--wb-text` | ≥7 | Task 13 fix 1 |

## Final verification (Task 15), 2026-10-21

- `npx tsc --noEmit`: exits 0.
- `node scripts/wb-test.mjs`: 14 tests, 14 pass.
- Style gate: clean on 71 Workboard files (side-stripe rule included). The deleted `WorkboardRail.tsx` is skipped.
- Smoke: unauthenticated `/workboard` returns 200 with `NEXT_REDIRECT` to `/login`; `/api/workboard/work` returns 401.
- Playwright on the real `/workboard`, logged in:
  - **Coverage:** Focus, Table, Board and Timeline at 1440, 820 and 390, with reduced motion off and on.
  - **Errors and layout:** 0 console errors, no horizontal overflow.
  - **Overlays:** the palette, the New item dialog and the drawer all open.
  - **Focus:** after closing the drawer with Esc, focus returns to the opener ("Open").
- Stress page `src/app/workboard/stress/` deleted after sign-off.
