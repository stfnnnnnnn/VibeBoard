# Grading system, subject page fixes, and Canvas hub

**Date:** 2026-10-24
**Status:** Approved in brainstorming. Awaiting written-spec review.
**Builds on:** `2026-10-22-studypulse-revamp-design.md`, which defines the StudyPulse tokens (`studypulse.css`), the projection engine, and the subject page structure. Its constraints still apply: the style gate, tokens only, ≥4.5:1 contrast, the motion rules and reduced motion.
**Mockups:** these are the source of truth, in `.superpowers/brainstorm/1679-1792810448/content/`:
- `grading-simulation-v8.html`: interactive, real math. Covers the setup wizard, the subject page, the grade summary, the entry tables and the linked lab. Use its two samples: "Midterm + Finals" and "3 shifts".
- `canvas-hub-v1c.html`: interactive. Covers the Overview, Activity Bank and Announcements tabs. It is the first mockup (v1) with two changes: a single header row `[←] Canvas [Overview | Activity Bank | Announcements] … [Subject ▾]` (v1b), and the Note field in every "Turn this into" form (v1c, C6). Every other canvas-hub file is a rejected exploration.

## 1. Why

The user asked for a clearer, better-looking grading setup, and found a loophole: some schools grade Finals cumulatively, using every task and quiz from Midterm. VibeBoard cannot model that.

A code audit then found the following.

**Grading model gaps**
- Linking only works for single scores. There is no cumulative option.
- The "final period" is described as "just a label anchor".
- The "collective weight" option is advertised but never implemented.
- Lecture/Lab weights are collected but never used.
- The grading setup cannot edit a subject's current system. Switching systems makes the subject's entries vanish from view.
- Presets are silently shared between subjects.

**Security**
- `PUT` and `DELETE /api/studypulse/grading/[id]` delete another user's periods and categories before checking ownership.
- `POST /api/studypulse/subjects/[id]/grading` accepts any `preset_id`.

**Subject page bugs**
- An excess white strip at the bottom of the page.
- The grade summary shows a category's contribution renormalised: Midterm Exam at 40% with a score of 80 reads "80.00" instead of 32.
- Labels are confusing: "Meaning" and "Grade pt" duplicate each other on the 1.0 scale.
- The Canvas badge breaks into its own column.

**Canvas screens**
- The Activity Bank renders nothing when empty.
- Every Activity Bank item needs a manual period and category pick, with no preview.
- Ignoring an item is permanent.
- Announcements are one dense form per item.
- Errors are shown with `alert()`.
- The screens use the old pre-token styling.

## 2. Decisions (from the user)

| # | Decision |
|---|---|
| G1 | **Linked across periods** is a per-category toggle. Off means the same name with separate scores. |
| G2 | For a linked **multi-entry** category in a later period: an option to **include earlier periods' entries** (cumulative). Only *graded* earlier entries are included. The later period's table shows only its own rows. The carried work is explained by an ⓘ button, with no extra rows. |
| G3 | For a linked **single-score** category: the **raw score carries over** (e.g. 40/50), and each period applies its own weight (40% in Midterm, 15% in Finals). This is the existing `carry_score`, now explained clearly. |
| G4 | Final grade has two options. **Shown in a period:** one period holds the final grade and gets a small "Final grade" tag, with no extra calculation. **Dedicated Final grade view:** a "Final grade" tab, tile and summary column after the periods, always the **average of the periods**. "Collective" is removed. |
| G5 | Editing: **edit safely in place**. Existing entries always stay attached. Removing a category that has entries asks where they go (move to another category, or delete). If the system is shared: **Apply to all N subjects** or **Save a copy for this subject only**. |
| G6 | Lab: a **linked lab subject**. Lecture and Lab are two separate subjects with their own categories and pages. They must have the **same period names**. They combine **per period** (Lecture × w + Lab × (100−w)). Both pages show the combined grade. The GWA counts the pair as **one entry with summed units** (see §7.4). |
| G7 | Header grade switch: **Percent · Point · Letter**. The tiles show the value only: Percent `86.7`, Point `2.0` (4.0 scale, one decimal) or `1.25` (1.0 scale, two decimals), Letter `C+ · Good`. The letter is rendered with a raised modifier, a centred dot and the meaning on the same baseline (mockup v8). |
| G8 | The 1.0 scale gets letter equivalents (approved as proposed): 1.00 A+ · 1.25 A · 1.50 A− · 1.75 B+ · 2.00 B · 2.25 B− · 2.50 C+ · 2.75 C · 3.00 C− · 5.00 F. |
| G9 | Grade summary rows show the average **and** the points earned out of the weight ("80.0% · 32.0 of 40 pts"), with a **Percent · Points** view toggle. "x of y pts earned · z% of the grade is in" moves behind an ⓘ beside each period's grade. |
| G10 | What-if takes input as **Percent** or **Raw score** (score / items). Nothing is saved. |
| G11 | Explanatory notes become **ⓘ info buttons**, not extra lines. This covers carried entries, reused scores, points earned and the lab combination. |
| G12 | The Canvas badge sits **inline** with the entry name. |
| C1 | Canvas becomes a **hub with three views** (Overview · Activity Bank · Announcements), shown as a segmented tab control **in the header row, right beside the title**. The header is `[← back icon] Canvas [views] … [Subject filter]`. The back control is an icon-only button labelled "Back to StudyPulse". The subject filter appears at the right end of the header row on Activity Bank and Announcements only. A subject page's Canvas menu opens the hub pre-filtered to that subject. |
| C2 | Overview keeps the **v1 two-column layout**. Left: a vertical profile card (avatar, name, Connected chip; rows for last sync, auto-sync, access token and courses; a full-width Sync now; "Connection · Disconnect Canvas"). Right: **New Canvas courses** (Link to subject… · or · Create subject · Ignore) and the **Mapped** list. Sync appears **only** in the profile card: the header has no sync line and no Sync now button (they were redundant). The header row is the only change from v1. |
| C3 | Activity Bank: a **smart suggestion** ("Goes to Finals › Quizzes · 18 / 20 → 90.0", with an ⓘ explaining why), one-click **Add**, **Change…** picker, **bulk** add/ignore, and an empty state. |
| C4 | Announcements: an **inbox list plus reading pane**. "Turn this into" offers Task · Event · Reminder · Schedule change as multi-select tabs, with suggested ones marked and pre-filled. **Convert (n)**. On a phone the list and detail stack. |
| C5 | Recoverability: **Ignored** (bank) and **Dismissed** (announcements) filters with **Restore**, plus an **Undo** toast after each ignore, add and dismiss (Convert's toast links to Workboard instead, see §6). |
| C6 | **Notes for extra details.** Every "Turn this into" form has a **Note**, pre-filled with the announcement's extra-detail sentences ("Bring a calculator.", "Coverage: …"), which are also highlighted in the body. The note is saved on whatever the conversion creates, including school tasks, which gain notes in Workboard and show them in StudyPulse (§6.1). Mockup: `canvas-hub-v1c.html`. |

## 3. Grading model

### 3.1 Schema (in `src/lib/migrate.ts`, idempotent like the existing `ensure*` functions)

- `grading_categories.include_earlier TINYINT(1) NOT NULL DEFAULT 0`. Only meaningful when `link_group` is set, `is_singleton = 0`, and the period is not the first of its link group.
- `grading_presets.final_mode`: the allowed values become `NULL` (no final grade), `'period'` (shown in `final_period_id`) and `'average'` (dedicated view).
  - One-time migration: `UPDATE grading_presets SET final_mode='average' WHERE final_mode='collective'`.
  - `final_period_id` with `final_mode IS NULL`: treat as `'period'` (backfill `final_mode='period'` where `final_period_id IS NOT NULL AND final_mode IS NULL`).
- New table `subject_links` (§3.5).
- `grading_categories.collective_weight`, and `subject_grading.has_lab/lec_weight/lab_weight`, stay in place unused. The UI no longer reads or writes them. No destructive DDL.

### 3.2 Category values (`src/lib/studypulse/periodModel.ts`, pure)

For period index `pi` and category `c`:
- **Own entries:** graded values only (existing `entryHasGrade`/`entryValue`).
- **Linked single score** (`is_singleton=1`, `link_group` set, `carry_score=1`) with no own graded entry: use the first earlier period's same-group category that has a graded entry. Its value is computed from **that entry's own score/items** (so transmutation applies to the raw score). Only the weight differs.
  - Today the source is the "first in preset order", which may be a later period. **Change: only earlier periods (`pj < pi`) may supply a carried score.**
- **Linked multi-entry** with `include_earlier=1`: graded values = own graded values plus every graded value of the same-group categories in periods `pj < pi`. Pending earlier entries are **not** included.
- Unlinked categories never borrow anything.
- `CategoryInput` gains `carried?: { count: number; from: string[]; avg: number } | null` and `reused?: { score: string; items: string; from: string; weight: number } | null`, for the ⓘ text.
  - The projection engine's `graded` array already holds the combined values, so `projectPeriod` needs no change.
  - The **planner's remaining items stay own-period only**: carried entries are graded, so they never add slots.

### 3.3 Final grade (`projection.ts`)

`subjectFinal(periods, mode, finalPeriodKey)`:
- `'period'` → that period's `current`.
- `'average'` → the mean of the non-null period currents.
- `null` → `null`.

`collectiveCurrent` is deleted. `subjectOverall` (subject cards) returns the final grade when one is defined, otherwise the mean of the period currents (as today).

### 3.4 Letter scale (`src/lib/gradeScale.ts`)

`SCALE_1PT` gains a `letter` column per G8. `toGradeInfo(pct,'1pt')` returns `{ point, letter, description }` with the real letter, not the point string.

Every place that relied on `letter === point` for the 1.0 scale is updated:
- the subject card line;
- the planner scale thresholds/presets;
- the summary and header.

The planner's 1.0-scale target presets keep their point labels ("1.25 · 94").

### 3.5 Linked lab subject

```sql
CREATE TABLE IF NOT EXISTS subject_links (
  lecture_user_subject_id INT NOT NULL PRIMARY KEY,
  lab_user_subject_id     INT NOT NULL UNIQUE,
  lecture_weight          DECIMAL(5,2) NOT NULL DEFAULT 70.00,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

- **Validation:**
  - Both subjects belong to the user.
  - They are distinct.
  - Neither is already in another link.
  - Both use custom grading presets whose period names match (case-insensitive, same count and same order).
  - A mismatch is reported in the setup UI ("Periods don't match: Lecture has Prelim, Midterm, Finals; Lab has Midterm, Finals").
- **Combination** (pure, `src/lib/studypulse/labLink.ts`): per period, `combined = lec×w + lab×(1−w)` when both currents exist; the one that exists when only one does; `null` when neither does. The final grade follows the **lecture subject's** final-grade rule, applied to the combined period values.
- **Display:**
  - Both subject pages: the header tiles, tabs and final view show **combined** values, plus a chip ("Linked lab: IT321L (30%)" / "Linked lecture: IT321 (70%)") that links to the partner.
  - A "Linked lab" section with a per-period Lecture · Lab · Combined table and an ⓘ.
  - The grade summary and entry tables stay **per subject** (each page shows its own categories).
- **Subject cards:** both show the combined grade with a `Lec + Lab` tag.
- **Target planner:** stays per subject, on that subject's own grade. Combined-target planning is out of scope.
- **API:** `GET/PUT/DELETE /api/studypulse/subjects/[id]/lab-link`, with an ownership check on both IDs.

### 3.6 Editing a grading system safely

New pure module `src/lib/studypulse/presetDiff.ts`: `diffPreset(oldPreset, newDraft) → { updates, inserts, deletes }`. It keys by `period_id`/`cat_id`; draft items without IDs are inserts.

- **`PUT /api/studypulse/grading/[id]` (rewritten)**, inside one transaction:
  1. **Ownership is checked first** (`SELECT … FOR UPDATE … WHERE preset_id=? AND user_id=?`; 404 if not owned).
  2. Update the changed periods and categories **in place, keeping their IDs**.
  3. Insert the new ones.
  4. For each deleted category, apply `moves[cat_id]`: either `{to: cat_id}` (`UPDATE grade_entries SET cat_id=?, period_id=? WHERE cat_id=?`) or `'delete'` (delete those `grade_entries`). A deleted category that has entries but no move → 400.
  5. Delete the removed periods and categories.
  6. Write the scale, final mode and final period.
- **Body:** `{ name, grade_scale, final_mode, final_period_key, periods:[{period_id?, name, categories:[{cat_id?, name, weight, is_singleton, link_group, carry_score, include_earlier}]}], moves, scope: 'all' | 'copy', user_subject_id }`.
  - `scope:'copy'` clones the edited draft as a new preset owned by the user.
  - It then **remaps only this subject's** `grade_entries` from old category IDs to the clone's IDs, by structural position (period index + category index after the edit, honouring `moves`).
  - Finally it points `subject_grading` at the clone. Other subjects are untouched.
- **Switching a subject to a different existing preset** while it has entries requires a category map (`old cat_id → new cat_id | 'delete'`). The setup's "Use another system" path shows a mapping step, pre-filled by same-name matching. Same endpoint family: `POST /api/studypulse/subjects/[id]/grading` with `{ preset_id, map }`.
- **`GET /api/studypulse/grading/[id]/usage`** → `{ subjects: [{user_subject_id, code, name, entry_count}] }`, which powers "Used by N subjects".

### 3.7 Security fixes

- **`DELETE /api/studypulse/grading/[id]`:** check ownership first, inside a transaction. Refuse (409) while any `subject_grading` row uses the preset; the UI offers "switch those subjects first".
- **`POST /api/studypulse/subjects/[id]/grading`:** the `preset_id` must belong to the user (otherwise 404).
- **`GET /api/studypulse/subjects/[id]/grading`:** read the preset with `AND user_id=?`.

## 4. Grading setup (wizard) redesign

**Component:** `src/components/studypulse/grading/GradingSetup.tsx`, a full-height sheet. It replaces `GradingSetupWizard.tsx` (deleted); its sub-steps are split into files under `grading/`. Visuals follow the left panel of `grading-simulation-v8.html`, using the `sp-` tokens and no emoji.

- **Steps (a stepper you can jump between):** 1 Scale · 2 Periods & categories · 3 Final grade · 4 Linked lab · 5 Review.
- **Entry modes:**
  - **Edit current**: the default when the subject already has a system. It opens on the subject's preset.
  - **Use another system**: the list of the user's presets, followed by a category mapping step.
  - **Start new**: from the FEU template, or blank.
- **Scale step:** the 4.0 / 1.0 segmented choice plus the full threshold table (letter, point, meaning).
- **Periods & categories step**, a card per period:
  - Name, a weight-sum badge (green at exactly 100), and add/remove.
  - Each category row: name, a weight box, and a flags row:
    - `Single score` / `Multiple entries`;
    - `Linked across periods` (toggle);
    - `Include <first period>'s entries` (linked multi-entry, later periods only);
    - `Reuse <first period>'s raw score` (linked single, later periods only).
  - Renaming a linked category renames it in every period. Weights stay independent.
- **Final grade step:** two option cards (Shown in a period + period picker / Dedicated Final grade view, always the average).
- **Linked lab step:** Linked / No lab, a subject picker (the user's subjects, excluding this one and already-linked ones), the Lecture % input with Lab = 100 − Lecture, and a live period-match check.
- **Review step:**
  - A summary of the changes.
  - The "Used by N subjects" choice (**Apply to all N** / **Save a copy for this subject only**) when N > 1.
  - The move-or-delete prompt for every removed category that has entries.
  - Save.
- **Validation is inline**, per field, with no `alert()`. Save is disabled until every period sums to 100 and every name is filled.

## 5. Subject page fixes

1. **White strip:** set `.sp-tp-shell__inner { position: relative; }` (and the same on `.sp-form-shell__inner`). This makes the collapsed planner the containing block for its absolutely positioned screen-reader live region, so it no longer extends the document height. Verify live that `document.documentElement.scrollHeight` equals the `.sp-page` height with the planner closed.
2. **Header tiles (G7):**
   - `SubjectHeader` shows only the value.
   - Letter uses a `LetterGrade` component (`src/components/studypulse/ui/LetterGrade.tsx`): base letter, a raised `+`/`−` (real minus sign), a dot, and the meaning. Its `aria-label` is "C plus, Good".
   - The view choice persists in `localStorage` as today.
3. **Final grade (G4):**
   - `'period'`: the designated period's tile, tab and panel get a "Final grade" tag.
   - `'average'`: `PeriodTabs` adds a **Final grade** tab after "All", `SubjectHeader` adds a Final grade tile, and `GradeSummary` adds a Final grade column listing each period's grade (no "1 of N" text).
4. **Grade summary (G9, G10):**
   - Rows show `80.0%` with `32.0 of 40 pts`. The **Percent · Points** toggle swaps which is primary.
   - An ⓘ next to each period grade explains points earned and coverage.
   - What-if gets a **Percent · Raw score** input switch. A raw score/items pair converts to a percentage, transmuted when transmutation is on.
   - The contribution fix replaces the last fix wave's renormalised contribution.
5. **Info buttons (G11):** a shared `InfoTip` component (`src/components/studypulse/ui/InfoTip.tsx`).
   - A button with `aria-expanded`, and a popover with `role="tooltip"`.
   - It closes on Esc and on an outside click. It is keyboard reachable and flips below when there's no room above.
   - Used for carried entries, reused scores, points earned and the lab combination, on category headers in the summary and the entry tables.
6. **Canvas badge (G12):** the badge renders as an inline element after the name text inside the name cell, not as a flex sibling.
7. **Subject page Canvas menu:** "Activity Bank" and "Announcements" link to `/studypulse/canvas?tab=bank&subject=ID` and `…tab=announcements&subject=ID`.

## 6. Canvas hub

**Route:** `/studypulse/canvas?tab=overview|bank|announcements&subject=<id>`.
- The default tab is `bank` when anything is pending, otherwise `overview`.
- `CanvasClientShell` is rebuilt on the `sp-` tokens, with the single header row (back icon button, "Canvas", the views tablist with counts, and the subject select on Activity Bank and Announcements) and the tab panels.
- On a phone the views wrap to a full-width row under the title, and the filter to its own row below that.
- Arriving with `subject=` shows a "Showing <code> only · Show all subjects" bar.
- **Components** (under `src/components/studypulse/canvas/`): `CanvasOverview`, `ProfileStrip`, `CourseMapping`, `ActivityBank`, `BankRow`, `Announcements`, `AnnouncementDetail`, `ConvertPanel`, `UndoToast`. The old `Canvas*.tsx` files are deleted.
- **Overview (C2):** the layout in `canvas-hub-v1c.html`.
  - A two-column grid: a 360px profile card on the left, the courses panel on the right. It stacks on a phone.
  - The card: avatar initials, name, a Connected chip; a key–value list (Last sync with its status, Auto-sync, Access token expiry, Courses mapped · new); a full-width Sync now; an eyebrow "Connection" with a Disconnect Canvas link (inline confirm).
  - The courses panel: New Canvas courses, one row each, with "Link to subject…", "or", "Create subject" and "Ignore". Then a Mapped list with per-subject pending and to-review counts.
  - The "Connect Canvas" pairing flow (bookmarklet) keeps today's behaviour, restyled, when not connected.
- **Activity Bank (C3):**
  - **Server:** `GET /api/canvas/bank` adds `suggestion: { period_id, period_name, cat_id, cat_name, confidence: 'match' | 'guess', reason }` per pending item, from a new pure `suggestBankTarget(item, preset, recentPeriodId)` in `src/lib/canvas/classify.ts`, which reuses its keyword rules.
    - Category: match the item name against the category names and the keyword aliases (quiz, seatwork, task, data sheet, report, problem set, exam…).
    - Period: the period the user most recently added entries to; if none, the first period.
    - Legacy subjects suggest Activity, Quiz or Exam.
  - **Row:** checkbox, name, subject chip, due date, Canvas score or "Not graded on Canvas yet · N pts", "Goes to Period › Category" with an ⓘ showing the reason (a `guess` reads "this is a guess, check it with Change…"), and the preview "18 / 20 → 90.0" or "added as Pending".
  - **Actions:** Add (uses the suggestion), Change… (inline period and category selects), Ignore.
  - **Bulk:** select-all plus "Add N as suggested" and "Ignore".
  - **Filters:** To review (n) / Ignored (n). Ignored rows offer Restore.
  - **New endpoint** `POST /api/canvas/bank/[id]/restore` (ignored → pending; ownership checked).
  - **Empty states:** "You're all caught up" and "Nothing ignored".
- **Announcements (C4):**
  - Left: filters To review / Converted / Dismissed with counts, and rows (title clamped to 2 lines, subject chip, time, unread dot, suggested-destination chips).
  - Right: the subject, the posted time, "Open in Canvas", the title, and the body (scrollable, HTML stripped as today).
  - "Turn this into" uses multi-select destination tabs. Each tab has a check box that adds it to the conversion, a "Suggested" mark, and a short pre-filled form (Task: title, due, "Grade it in Period › Category" or "Don't grade it"; Event; Reminder; Schedule change).
  - **Convert (n)** posts to the existing include endpoint with every checked destination. Dismiss.
  - **New endpoint** `POST /api/canvas/announcements/[id]/restore` (dismissed → pending).
  - "Unread" is new client state: `seen_at` is set when an announcement is opened. Add the column `canvas_announcement_bank.seen_at DATETIME NULL` and the endpoint `POST /api/canvas/announcements/[id]/seen`.
  - **Phone:** the list and detail stack, with a back button.
- **Undo (C5):** a 5-second toast after each action.
  - **Ignore, bulk Ignore, Dismiss:** **Undo** calls the restore endpoint.
  - **Add and bulk Add:** **Undo** calls a new `POST /api/canvas/bank/[id]/uninclude`. It deletes the entry that the include created (the include endpoint returns its ID, and the link row in `canvas_entry_links` identifies it) and sets the bank item back to pending. This only works while that entry still has no user edits; afterwards it returns 409 and the toast has already closed.
  - **Convert:** no undo, because it creates items across Workboard tables. The toast instead reads "Converted into N items · **View in Workboard**".
- **No `alert()` and no `confirm()`.** Errors show inline on the row or panel. Disconnect asks for confirmation in a small inline confirm.

### 6.1 Notes (C6)

**Extraction**
- Pure `extractAnnouncementNote(body: string): string` lives in `src/lib/canvas/classify.ts`.
- It splits the stripped body into sentences and keeps those that open with an extra-detail cue: bring, coverage, covers, attendance, wear, prepare, don't forget, remember to, materials, requirements, note, reminder that, please bring. It joins them with a space and returns `''` when none match.
- It runs in `GET /api/canvas/announcements` as `suggested_note`, so the client does not repeat the logic. The same cue list drives the body highlight (`noteSpans(body)` returns the character ranges).

**Convert form**
- Each destination form ends with a full-width **Note** textarea (max 1,000 characters).
- It is pre-filled with `suggested_note` and labelled "From the announcement" with an ⓘ. Each destination keeps its own edited value.

**Include endpoint**
- Every destination accepts `note?: string | null` (trimmed; empty means null; over 1,000 characters is a 400):
  - event and reminder write `workboard_items.note`;
  - schedule change keeps its existing `note`;
  - task writes the new `workboard_entry_meta.note`, upserting the overlay row for the created entry.

**Workboard, school tasks only**
- **Schema:** `workboard_entry_meta.note TEXT NULL`.
- **Reads:** `workItems.ts` reads `m.note` instead of the hard-coded `null`, so the Notes section of the item detail shows it.
- **Writes:**
  - `patchAcademicItem` accepts `note` into the overlay;
  - `PATCH /api/workboard/academic/[source]/[id]` and `POST /api/workboard/academic/create` accept `note`.
- **Dialog:** `WorkItemDialog` enables the Note field for academic items (edit and the new-graded path). The hint "Study Pulse doesn't have a place for … Note yet" drops "Note" from its list.

**StudyPulse**
- The subject page's entry queries `LEFT JOIN workboard_entry_meta` for `note`.
- `EntryTable` shows a small note icon after the name, inline like the Canvas badge, opening an `InfoTip` with the note text.
- Notes are read-only here and edited in Workboard. The tooltip says "Edit in Workboard".

## 7. Cross-cutting

1. **Motion:**
   - Transform and opacity only.
   - Tabs and the planner use the existing patterns.
   - Toasts enter with a 220ms translate and fade.
   - Bank rows leave with a 180ms fade and collapse (grid-rows).
   - Reduced motion uses 1ms.
2. **Accessibility:**
   - The tabs are a `tablist` with arrow keys; the hub tabs map to real panels.
   - Checkboxes are real `<input type="checkbox">` styled as tokens.
   - `InfoTip` is accessible as described in §5.5.
   - Toasts are `role="status"`.
   - Every action is keyboard reachable.
   - Contrast ≥ 4.5:1.
3. **Tests (node:test via `scripts/sp-test.mjs`, written first):**
   - `periodModel`: cumulative include (graded only; pending excluded; earlier periods only); the unlinked toggle; raw-score reuse with a weight change (40/50 at 15% → 12.0 of 15); transmuted reuse.
   - `projection`: `subjectFinal` for `'period'`, `'average'` and `null`.
   - `gradeScale`: 1.0-scale letters.
   - `labLink`: both sides, one side, neither, and the final rule.
   - `presetDiff`: keep IDs, inserts, deletes with moves, and refusing a delete with entries but no move.
   - `suggestBankTarget`: name match, alias match, guess fallback, and legacy mode.
   - `extractAnnouncementNote` / `noteSpans`: "Bring a calculator." and "Coverage: …" kept; plain sentences dropped; empty body → `''`; ranges line up with the kept sentences.
   - The existing tests still pass (the 1.0-scale letter expectations are updated where they assumed point = letter).
4. **GWA (G6):** the GWA calculator today is manual entry and OCR. It does not read subject grades, so this work does **not** change it. The rule "a linked lecture + lab counts as one entry with summed units at the combined grade" is recorded here for whenever the GWA calculator gains "import from my subjects", which is out of scope.

## 8. Out of scope

- GWA import from subjects.
- Combined lecture + lab target planning.
- Editing the grade scale thresholds.
- Restyling the landing, schedule and GWA pages.
- Any change to Workboard beyond school-task notes (§6.1).
- Editing notes from StudyPulse (they are edited in Workboard).
