# Grading System and Canvas Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the new grading model, the grading setup, the subject-page fixes and the Canvas hub described in the spec.
- **Grading model:** linked and cumulative categories, raw-score reuse, a final grade shown in a period or in a dedicated average view, the 1.0-scale letters, linked lab subjects, and safe in-place preset editing.
- **Grading setup:** rebuilt as a new sheet.
- **Subject-page fixes:** included.
- **Canvas hub:** Overview, Activity Bank and Announcements.

**Architecture:** Pure, tested libraries in `src/lib/studypulse/*` and `src/lib/canvas/classify.ts` carry all the grading and suggestion logic. API routes in `src/app/api/**` stay thin, ownership-first, and use transactions. The UI components are rebuilt on the existing StudyPulse token sheet (`src/app/studypulse/studypulse.css`, `--sp-*`). The mockups are the visual source of truth. Their HTML/CSS can be ported directly (translate colours to `--sp-*` tokens).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, mysql2, lucide-react, node:test via `scripts/sp-test.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-24-grading-system-and-canvas-hub-design.md` (binding).

**Mockups:**
- `.superpowers/brainstorm/1679-1792810448/content/grading-simulation-v8.html`: the grading setup (left panel) and the subject page (right side).
- `.superpowers/brainstorm/1679-1792810448/content/canvas-hub-v1c.html`: the Canvas hub. Open them in a browser and read their source; the `render*`/`overview`/`bank`/`annView` functions contain the exact markup.

## Global Constraints

**Git**
- Branch: work on `master` (the project's standing practice).
- **Before every commit:** run `git status --short` and stage only the files the task lists (`git add <paths>`). Never use `git add -A`.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

**Commands**
- Tests: `node scripts/sp-test.mjs` (all) or `node scripts/sp-test.mjs <filter>`.
- Types: `npx tsc --noEmit` must report 0 errors after every task.
- Style gate: `node scripts/wb-style-gate.mjs <every created or modified .tsx/.css file>` must pass. Its rules:
  - no hex colours outside the token files;
  - no font size under 12px, except 11px uppercase weight-800 labels;
  - no plain `ease` timing;
  - no transitions on width, height, top, left, right, bottom, margin, padding or flex.

**Styling**
- Use **`--sp-*` tokens only.** No static inline styles; inline `style` is for dynamic values only.
- Contrast is ≥ 4.5:1. Small text uses `--sp-text-muted` or darker.
- Hover styles go inside `@media (hover:hover) and (pointer:fine)`.
- **Reduced motion:** 1ms durations, no hover lifts.
- **Icons:** `lucide-react`, no emoji.
- **Numbers:** numerals use `.sp-num`.
- **No `alert()` or `confirm()` in anything touched.**

**API**
- Every API route checks `auth()` and then **ownership before any read or write of user data**.
- Multi-statement writes use a transaction.

**Data and scope**
- **"Today" is Manila:** use `todayManila()`.
- **Don't modify Finance.** Workboard changes are limited to school-task notes (spec §6.1, Task 14b). The Workboard New-item dialog's read of `GET /api/studypulse/subjects` must keep working.

**Verification**
- The dev server is already running at http://localhost:3000. Don't restart it.
- Logged-in browser checks use the Playwright MCP browser. If it is signed out, the task's live check is deferred to Task 15 and noted in the report. Never forge sessions.

**Subagents**
- Use Opus subagents. Wait out rate limits; don't fall back to Sonnet.

---

## File map

| Path | Status | Responsibility |
|---|---|---|
| `src/lib/gradeScale.ts` | modify | 1.0-scale letters |
| `src/lib/studypulse/__tests__/gradeScale.test.ts` | new | letter tests |
| `src/lib/migrate.ts` | modify | `ensureGradingV2Schema()` |
| `src/components/studypulse/GradingSetupWizard.tsx` | types only, then delete in Task 8 | `GradingPresetFull` moves to `src/lib/studypulse/types.ts` |
| `src/lib/studypulse/types.ts` | modify | preset types (include_earlier, final_mode), lab link types |
| `src/lib/studypulse/periodModel.ts` (+test) | modify | cumulative, earlier-only carry, unlinked, `carried`/`reused` meta |
| `src/lib/studypulse/projection.ts` (+test) | modify | `subjectFinal(periods, mode, finalKey)`; remove collective |
| `src/lib/studypulse/labLink.ts` (+test) | new | combine lecture and lab per period |
| `src/lib/studypulse/presetDiff.ts` (+test) | new | diff, moves, copy remap |
| `src/lib/studypulse/subjectCards.ts` | modify | new final rule, linked-lab combined card grade |
| `src/app/api/studypulse/grading/[id]/route.ts` | rewrite | ownership-first GET/PUT/DELETE, safe PUT |
| `src/app/api/studypulse/grading/[id]/usage/route.ts` | new | subjects using a preset |
| `src/app/api/studypulse/grading/route.ts` | modify | new fields, final modes |
| `src/app/api/studypulse/subjects/[id]/grading/route.ts` | modify | preset ownership, switch with map |
| `src/app/api/studypulse/subjects/[id]/lab-link/route.ts` | new | GET/PUT/DELETE link |
| `src/components/studypulse/grading/*` | new | the setup sheet (replaces the wizard) |
| `src/components/studypulse/ui/InfoTip.tsx`, `ui/LetterGrade.tsx` | new | shared UI |
| `src/components/studypulse/subject/*` | modify | header, tabs, summary, tables, toolbar, lab section |
| `src/components/studypulse/SubjectCardView.tsx` | modify | wiring |
| `src/app/studypulse/studypulse.css` | modify | new sections |
| `src/lib/canvas/classify.ts` (+test) | modify | `suggestBankTarget` |
| `src/app/api/canvas/bank/route.ts` | modify | add `suggestion` |
| `src/app/api/canvas/bank/[id]/{restore,uninclude}/route.ts` | new | reverse actions |
| `src/app/api/canvas/announcements/[id]/{restore,seen}/route.ts` | new | reverse action, unread |
| `src/app/api/canvas/announcements/[id]/include/route.ts` | modify | per-destination `note` |
| `src/lib/workboard/{workItems,academicWrites}.ts` | modify | school-task notes (read and write) |
| `src/app/api/workboard/academic/{create,[source]/[id]}/route.ts` | modify | accept `note` |
| `src/components/workboard/WorkItemDialog.tsx`, `dialog/SharedFields.tsx` | modify | Note field enabled for academic items |
| `src/app/api/canvas/announcements/route.ts` | modify | return `seen_at` and status filters |
| `src/app/studypulse/canvas/{page.tsx,CanvasClientShell.tsx}` | rewrite | the hub |
| `src/components/studypulse/canvas/*` | new | hub components (replace `Canvas*.tsx`) |

---

### Task 0: Workspace and ledger

**Files:** none in the repo. Uses the SDD workspace `.superpowers/sdd/2026-10-24-grading-system-and-canvas-hub/` (git-ignored).

- [ ] **Step 1:** Run `git status --short`. Expected: clean, or containing only user files that this plan doesn't touch. Record `git rev-parse HEAD` as BASE in the ledger.
- [ ] **Step 2:** Run `node scripts/sp-test.mjs` (expected: 33/33 pass), `node scripts/wb-test.mjs` and `npx tsc --noEmit` (expected: 0 errors). Record all three as the baseline.

---

### Task 1: 1.0-scale letters (TDD)

**Files:**
- Modify: `src/lib/gradeScale.ts`
- Test: `src/lib/studypulse/__tests__/gradeScale.test.ts`
- Modify: any test that asserted 1.0-scale `letter === point`. Search for them with `grep -rn "1.25\|toFixed(2)" src/lib/studypulse/__tests__`.

**Interfaces:** Produces `toGradeInfo(pct,'1pt').letter` ∈ {A+, A, A−, B+, B, B−, C+, C, C−, F}. `point` and `description` are unchanged. The minus is U+2212 (−) for display; tests compare with `'−'`.

- [ ] **Step 1: Write the failing test**
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toGradeInfo } from '../../gradeScale';

const M = '−';
test('1.0 scale letters', () => {
  const cases: Array<[number, string, number, string]> = [
    [97, 'A+', 1.0, 'Excellent'], [95, 'A', 1.25, 'Very Good'], [92, 'A' + M, 1.5, 'Very Good'],
    [90, 'B+', 1.75, 'Good'], [87, 'B', 2.0, 'Good'], [85, 'B' + M, 2.25, 'Good'],
    [82, 'C+', 2.5, 'Fair'], [80, 'C', 2.75, 'Fair'], [75, 'C' + M, 3.0, 'Passed'], [60, 'F', 5.0, 'Failed'],
  ];
  for (const [pct, letter, point, desc] of cases) {
    const g = toGradeInfo(pct, '1pt');
    assert.equal(g.letter, letter, `pct ${pct}`); assert.equal(g.point, point); assert.equal(g.description, desc);
  }
});
test('4.0 scale unchanged', () => {
  assert.deepEqual(toGradeInfo(86.7, '4pt'), { point: 2.5, letter: 'C+', description: 'Good' });
});
```
`scripts/sp-test.mjs` already transpiles `src/lib/gradeScale.ts`. The relative import from `__tests__` is `../../gradeScale`.

- [ ] **Step 2:** Run `node scripts/sp-test.mjs gradeScale`. Expected: FAIL (the letter is `'1.00'`).
- [ ] **Step 3: Implement.** Add `letter` to every `SCALE_1PT` row (A+, A, A−, B+, B, B−, C+, C, C−, F in order). `toGradeInfo` returns `row.letter` for `1pt`.
- [ ] **Step 4:** Run `node scripts/sp-test.mjs`. Expected: all pass. Fix any existing test that assumed letter = point for the 1.0 scale, and note it in the report.
- [ ] **Step 5:** Run `npx tsc --noEmit` and check usages: `SubjectCard.gradeLine`, `SubjectHeader`, `GradeSummary`, planner `targetPresets`/`scaleThresholds`.
  - For the 1.0 scale, `scaleThresholds` and `targetPresets` keep **point** labels (`r.point.toFixed(2)`). They read `SCALE_1PT_ROWS`, not `toGradeInfo`. Verify they still compile.
- [ ] **Step 6:** Commit `src/lib/gradeScale.ts` and the test (plus any test you fixed). Message: `gradeScale: letter equivalents on the 1.0 scale`.

---

### Task 2: Schema v2 and types

**Files:**
- Modify: `src/lib/migrate.ts`
- Modify: `src/lib/studypulse/types.ts`
- Modify: `src/components/studypulse/GradingSetupWizard.tsx` (re-export the moved types only)

**Interfaces:**
- Produces `ensureGradingV2Schema()`.
- Produces `GradingPresetFull` in `types.ts` with:
  - `final_mode: 'period' | 'average' | null`
  - per-category `include_earlier: number`
- Produces `SubjectLink { lecture_user_subject_id: number; lab_user_subject_id: number; lecture_weight: number }`.

- [ ] **Step 1:** Append to `migrate.ts`, with a module flag `_ranGradingV2`:
```ts
/** Grading v2 (spec 2026-10-24 §3.1): cumulative flag, final-mode values, lab links, announcement seen_at. */
export async function ensureGradingV2Schema(): Promise<void> {
  if (_ranGradingV2) return;
  await ensureCategoryLinking();
  await ensureFinalGrade();
  try { await pool.query(`ALTER TABLE grading_categories ADD COLUMN include_earlier TINYINT(1) NOT NULL DEFAULT 0`); }
  catch (err: unknown) { if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err; }
  await pool.query(`UPDATE grading_presets SET final_mode='average' WHERE final_mode='collective'`);
  await pool.query(`UPDATE grading_presets SET final_mode='period' WHERE final_mode IS NULL AND final_period_id IS NOT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subject_links (
      lecture_user_subject_id INT NOT NULL PRIMARY KEY,
      lab_user_subject_id     INT NOT NULL UNIQUE,
      lecture_weight          DECIMAL(5,2) NOT NULL DEFAULT 70.00,
      created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  try { await pool.query(`ALTER TABLE canvas_announcement_bank ADD COLUMN seen_at DATETIME NULL`); }
  catch (err: unknown) { const c = (err as { code?: string }).code; if (c !== 'ER_DUP_FIELDNAME' && c !== 'ER_NO_SUCH_TABLE') throw err; }
  // Notes on school tasks (spec §6.1). The overlay table is created by ensureWorkboardSchema.
  try { await pool.query(`ALTER TABLE workboard_entry_meta ADD COLUMN note TEXT NULL`); }
  catch (err: unknown) { const c = (err as { code?: string }).code; if (c !== 'ER_DUP_FIELDNAME' && c !== 'ER_NO_SUCH_TABLE') throw err; }
  _ranGradingV2 = true;
}
```
Check: `ensureCategoryLinking` and `ensureFinalGrade` exist in `migrate.ts` (they do). Use their exact names.

- [ ] **Step 2:** Move `GradingCategory`, `GradingPeriod`, `GradeScale` (re-export from `gradeScale`), `FinalMode` and `GradingPresetFull` into `types.ts`:
  - `FinalMode = 'period' | 'average'`, and `final_mode: FinalMode | null`.
  - Add `include_earlier: number` to the persisted category and `include_earlier?: boolean` to the draft `GradingCategory`.
  - In `GradingSetupWizard.tsx`, replace the local declarations with `export type { ... } from '@/lib/studypulse/types'`, so the existing imports keep compiling until Task 8 deletes the file.
  - Update `PresetLike` and `SubjectLink`.
- [ ] **Step 3:** Call `ensureGradingV2Schema()` at the top of the routes that read presets: `subjects/[id]/grading` GET and POST, `grading` GET and POST, `grading/[id]` (all), and in `loadGradingConfig` (`src/lib/studypulse/subjectCards.ts`) inside its try.
- [ ] **Step 4:** Run `npx tsc --noEmit`. The `'collective'` usages in `GradeSummary.tsx`, `SubjectCardView.tsx` and `projection.ts` now fail to type-check. **This task only changes the types:** cast `finalMode` call sites to the new union with `// fixed in Task 4` comments, or temporarily widen `projection.subjectFinal`'s parameter. Choose the smaller change and note it in the report. tsc must end at 0 errors.
- [ ] **Step 5:** Live check, logged out is fine: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/studypulse/grading` → 401. Then run a read-only scratch Node script with mysql2 against the local DB (localhost, root, empty password, database `vibeboard`) that calls the same DDL statements twice to prove they're idempotent, then prints `SHOW COLUMNS FROM grading_categories LIKE 'include_earlier'`, `SHOW COLUMNS FROM workboard_entry_meta LIKE 'note'` and `SHOW TABLES LIKE 'subject_links'`.
  - Workboard reads `workboard_entry_meta.note` from Task 14b on, so call `ensureGradingV2Schema()` at the end of `ensureWorkboardSchema()` (both live in `migrate.ts`; keep `ensureWorkboardSchema`'s own flag semantics).
  - This changes the schema in the dev DB. That's intended and idempotent.
- [ ] **Step 6:** Commit `src/lib/migrate.ts`, `src/lib/studypulse/types.ts`, `src/components/studypulse/GradingSetupWizard.tsx` and the route files touched in Step 3. Message: `Grading v2 schema and shared preset types`.

---

### Task 3: Period model: cumulative, earlier-only carry, unlinked (TDD)

**Files:**
- Modify: `src/lib/studypulse/periodModel.ts`
- Modify: `src/lib/studypulse/projection.ts`, only to extend `CategoryInput` with optional metadata
- Test: `src/lib/studypulse/__tests__/periodModel.test.ts` (append)

**Interfaces:**
- `CategoryInput` gains:
  - `carried?: { count: number; from: string[]; avg: number } | null`
  - `reused?: { score: string; items: string; from: string; weight: number } | null`
- `buildCustomPeriods` signature unchanged.

**Rules (spec §3.2):**
- Own graded values come first; earlier periods' graded values are appended.
- Pending earlier entries are never included.
- Only periods with index `pj < pi` can supply carried or reused values.
- `include_earlier` applies only when `link_group` is set, `is_singleton = 0`, and `pi > 0`.
- For a singleton reuse, the value is `entryValue(sourceEntry, table)`, computed from the source's own score/items, so transmutation applies.

- [ ] **Step 1: Write the failing tests** (append to the existing file and reuse its `row()` helper):
```ts
const CUM: PresetLike = {
  final_mode: 'period', final_period_id: 2,
  periods: [
    { period_id: 1, name: 'Midterm', sort_order: 0, categories: [
      { cat_id: 10, name: 'Quizzes', weight: 60, is_singleton: 0, sort_order: 0, link_group: 'q', carry_score: 1, include_earlier: 0 },
      { cat_id: 12, name: 'Midterm Exam', weight: 40, is_singleton: 1, sort_order: 1, link_group: 'me', carry_score: 1, include_earlier: 0 },
    ] },
    { period_id: 2, name: 'Finals', sort_order: 1, categories: [
      { cat_id: 20, name: 'Quizzes', weight: 85, is_singleton: 0, sort_order: 0, link_group: 'q', carry_score: 1, include_earlier: 1 },
      { cat_id: 22, name: 'Midterm Exam', weight: 15, is_singleton: 1, sort_order: 1, link_group: 'me', carry_score: 1, include_earlier: 0 },
    ] },
  ],
};

test('cumulative: later period averages own + earlier graded entries; pending earlier is excluded', () => {
  const [, fin] = buildCustomPeriods(CUM, {
    10: [row({ grade: 85 }), row({ grade: 90 }), row({ name: 'Quiz 3', grade: null })],
    12: [row({ score: '40', items: '50', grade: 80 })],
    20: [row({ grade: 70 }), row({ name: 'Quiz 5', grade: null })],
    22: [],
  }, EMPTY_PREFS, null);
  const q = fin.categories[0];
  assert.deepEqual(q.graded, [70, 85, 90]);
  assert.deepEqual(q.pendingNames, ['Quiz 5']);
  assert.deepEqual(q.carried, { count: 2, from: ['Midterm'], avg: 87.5 });
});

test('linked single score reuses the earlier raw score at this period\'s weight', () => {
  const [, fin] = buildCustomPeriods(CUM, { 10: [], 12: [row({ score: '40', items: '50', grade: 80 })], 20: [], 22: [] }, EMPTY_PREFS, null);
  const me = fin.categories[1];
  assert.deepEqual(me.graded, [80]);
  assert.equal(me.weight, 15);
  assert.deepEqual(me.reused, { score: '40', items: '50', from: 'Midterm', weight: 40 });
});

test('reuse only flows forward: an ungraded earlier singleton never borrows a later score', () => {
  const [mid] = buildCustomPeriods(CUM, { 10: [], 12: [], 20: [], 22: [row({ score: '45', items: '50', grade: 90 })] }, EMPTY_PREFS, null);
  assert.deepEqual(mid.categories[1].graded, []);
  assert.equal(mid.categories[1].reused ?? null, null);
});

test('reused value is transmuted from the raw score', () => {
  const [, fin] = buildCustomPeriods(CUM, { 10: [], 12: [row({ score: '40', items: '50', grade: 80 })], 20: [], 22: [] }, EMPTY_PREFS, { 40: { 50: 88 } });
  assert.deepEqual(fin.categories[1].graded, [88]);
});

test('unlinked categories never borrow, even with include_earlier set', () => {
  const unlinked: PresetLike = { ...CUM, periods: CUM.periods.map(p => ({ ...p, categories: p.categories.map(c => ({ ...c, link_group: null })) })) };
  const [, fin] = buildCustomPeriods(unlinked, { 10: [row({ grade: 85 })], 12: [row({ score: '40', items: '50', grade: 80 })], 20: [row({ grade: 70 })], 22: [] }, EMPTY_PREFS, null);
  assert.deepEqual(fin.categories[0].graded, [70]);
  assert.deepEqual(fin.categories[1].graded, []);
});
```
Update the `PRESET` fixture already in the file so that every category has `include_earlier: 0`; that's a TypeScript requirement.

- [ ] **Step 2:** Run `node scripts/sp-test.mjs periodModel`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Replace the `source` pre-pass in `buildCustomPeriods`:
```ts
type Graded = { values: number[]; pending: string[]; firstRaw: EntryLike | null };
function gradedOf(entries: EntryLike[], table: TransmutationTable | null): Graded {
  const values: number[] = [], pending: string[] = []; let firstRaw: EntryLike | null = null;
  for (const e of entries) {
    if (entryHasGrade(e)) { const v = entryValue(e, table); if (v !== null) { values.push(v); firstRaw ??= e; } }
    else pending.push(e.name.trim() || 'Untitled');
  }
  return { values, pending, firstRaw };
}

export function buildCustomPeriods(preset, catEntries, prefs, table): PeriodInput[] {
  const own = preset.periods.map(p => p.categories.map(c => gradedOf(catEntries[c.cat_id] ?? [], table)));
  return preset.periods.map((p, pi) => ({
    key: `p${p.period_id}`, name: p.name,
    target: prefs.targets[`p${p.period_id}`] ?? DEFAULT_TARGET,
    categories: p.categories.map((c, ci) => {
      const singleton = Number(c.is_singleton) === 1;
      const linked = !!c.link_group;
      let { values: graded, pending } = own[pi][ci];
      let carried: CategoryInput['carried'] = null, reused: CategoryInput['reused'] = null;
      if (linked && pi > 0) {
        if (singleton && !graded.length && Number(c.carry_score) === 1) {
          for (let pj = 0; pj < pi; pj++) {
            const sj = preset.periods[pj].categories.findIndex(x => x.link_group === c.link_group);
            const src = sj >= 0 ? own[pj][sj] : null;
            if (src?.firstRaw) {
              const v = entryValue(src.firstRaw, table);
              if (v !== null) {
                graded = [v]; pending = [];
                reused = { score: src.firstRaw.score, items: src.firstRaw.items, from: preset.periods[pj].name, weight: Number(preset.periods[pj].categories[sj].weight) };
                break;
              }
            }
          }
        } else if (!singleton && Number(c.include_earlier) === 1) {
          const extra: number[] = [], from: string[] = [];
          for (let pj = 0; pj < pi; pj++) {
            const sj = preset.periods[pj].categories.findIndex(x => x.link_group === c.link_group);
            if (sj >= 0 && own[pj][sj].values.length) { extra.push(...own[pj][sj].values); from.push(preset.periods[pj].name); }
          }
          if (extra.length) { carried = { count: extra.length, from, avg: mean(extra) }; graded = [...graded, ...extra]; }
        }
      }
      return { ...category(`c${c.cat_id}`, c.name, Number(c.weight), ci, singleton, graded, pending, prefs), carried, reused };
    }),
  }));
}
```
- Add the parameter types exactly as the current signature has them.
- Remove the old `split`/`source` logic only where it's replaced. `buildLegacyPeriods` keeps `split`.
- Add `carried?`/`reused?` to `CategoryInput` in `projection.ts`. `projectPeriod` spreads `...c`, so they pass through untouched.

- [ ] **Step 4:** Run `node scripts/sp-test.mjs` (all pass) and `npx tsc --noEmit` (0 errors).
- [ ] **Step 5:** Commit `periodModel.ts`, `projection.ts` and the test. Message: `Period model: cumulative categories and forward-only score reuse`.

---

### Task 4: Final grade rule (TDD)

**Files:**
- Modify: `src/lib/studypulse/projection.ts`
- Test: `src/lib/studypulse/__tests__/projection.test.ts`
- Modify: `src/lib/studypulse/subjectCards.ts`
- Modify: `src/components/studypulse/SubjectCardView.tsx`
- Modify: `src/components/studypulse/subject/GradeSummary.tsx`, only the call sites

**Interfaces:**
- `subjectFinal(periods: PeriodInput[], mode: FinalMode | null, finalPeriodKey: string | null): number | null`
- `subjectOverall(periods, mode, finalPeriodKey)`
- `collectiveCurrent` is **deleted**.

- [ ] **Step 1:** Replace the two collective tests in `projection.test.ts` with:
```ts
test('final grade: period, average, none', () => {
  near(subjectFinal([MIDTERM, FINALS], 'period', 'p2'), 68.0);
  near(subjectFinal([MIDTERM, FINALS], 'average', null), 81.6);
  assert.equal(subjectFinal([MIDTERM, FINALS], null, null), null);
  assert.equal(subjectFinal([MIDTERM, FINALS], 'period', 'nope'), null);
  near(subjectOverall([MIDTERM, FINALS], null, null), 81.6);
  near(subjectOverall([MIDTERM, FINALS], 'period', 'p2'), 68.0);
});
```
Remove the `collectiveCurrent` import.

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement:
```ts
export function subjectFinal(periods: PeriodInput[], mode: FinalMode | null, finalPeriodKey: string | null): number | null {
  if (mode === 'period') { const p = periods.find(x => x.key === finalPeriodKey); return p ? projectPeriod(p).current : null; }
  if (mode === 'average') return meanOfCurrents(periods);
  return null;
}
export function subjectOverall(periods: PeriodInput[], mode: FinalMode | null, finalPeriodKey: string | null): number | null {
  return mode ? subjectFinal(periods, mode, finalPeriodKey) : meanOfCurrents(periods);
}
```
Import `FinalMode` from `./types` with `import type`. Delete `collectiveCurrent`.

- [ ] **Step 4:** Update the call sites:
  - `subjectCards.ts`: `subjectOverall(periods, preset.final_mode ?? null, preset.final_period_id != null ? 'p' + preset.final_period_id : null)`.
  - `SubjectCardView.tsx`: pass `finalPeriodId` as the key the same way.
  - `GradeSummary.tsx`: what-if passes the same key. Remove `'collective'` from its props and its label: the label reads "Final grade · average of periods" when `'average'`, and the summary has no final column for `'period'`. Task 10 restyles it.
  - Remove any temporary casts left by Task 2.
- [ ] **Step 5:** Run `node scripts/sp-test.mjs` (all pass) and `npx tsc --noEmit` (0 errors).
- [ ] **Step 6:** Commit the five files. Message: `Final grade is a period's grade or the period average`.

---

### Task 5: Linked lab: pure combine and API (TDD)

**Files:**
- Create: `src/lib/studypulse/labLink.ts` and `src/lib/studypulse/__tests__/labLink.test.ts`
- Create: `src/app/api/studypulse/subjects/[id]/lab-link/route.ts`
- Modify: `src/lib/studypulse/subjectCards.ts` (combined card grade plus a `lab_tag` flag)
- Modify: `SubjectCardData` in `types.ts` to add `lab_tag?: 'Lec + Lab' | null`

**Interfaces:**
- `combinePeriod(lec: number | null, lab: number | null, lectureWeight: number): number | null`
- `combinePeriods(lecCurrents: (number | null)[], labCurrents: (number | null)[], lectureWeight: number): (number | null)[]`
- `periodNamesMatch(a: string[], b: string[]): boolean`

- [ ] **Step 1: Write the tests**
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinePeriod, combinePeriods, periodNamesMatch } from '../labLink';

test('combine per period', () => {
  assert.equal(combinePeriod(86.3, 87.7, 70)!.toFixed(2), '86.72');
  assert.equal(combinePeriod(81.9, null, 70), 81.9);
  assert.equal(combinePeriod(null, 95, 70), 95);
  assert.equal(combinePeriod(null, null, 70), null);
  assert.deepEqual(combinePeriods([80, null], [90, 70], 50), [85, 70]);
});
test('period names must match by order, case-insensitively', () => {
  assert.equal(periodNamesMatch(['Midterm', 'Finals'], ['midterm', 'FINALS ']), true);
  assert.equal(periodNamesMatch(['Midterm', 'Finals'], ['Finals', 'Midterm']), false);
  assert.equal(periodNamesMatch(['Prelim', 'Midterm', 'Finals'], ['Midterm', 'Finals']), false);
});
```
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `labLink.ts`:
```ts
/* Linked lecture + lab subjects (spec §3.5). Pure. */
export function combinePeriod(lec: number | null, lab: number | null, lectureWeight: number): number | null {
  if (lec == null && lab == null) return null;
  if (lab == null) return lec; if (lec == null) return lab;
  return lec * lectureWeight / 100 + lab * (100 - lectureWeight) / 100;
}
export function combinePeriods(lecs: (number | null)[], labs: (number | null)[], w: number): (number | null)[] {
  return lecs.map((l, i) => combinePeriod(l, labs[i] ?? null, w));
}
const norm = (s: string) => s.trim().toLowerCase();
export function periodNamesMatch(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((n, i) => norm(n) === norm(b[i]));
}
```
- [ ] **Step 4:** API route `src/app/api/studypulse/subjects/[id]/lab-link/route.ts`:
  - **`GET`:** returns `{ link: { role: 'lecture' | 'lab', partner_user_subject_id, partner_code, partner_name, lecture_weight } | null }`, looking the subject up as either side.
  - **`PUT` `{ lab_user_subject_id, lecture_weight }`** checks:
    - auth;
    - ownership of **both** IDs (`user_subjects` with `user_id`);
    - the IDs are distinct;
    - neither is in another link (as either column);
    - both have custom grading configs (`loadGradingConfig`) and `periodNamesMatch` passes, else 400 with `{ error, lecture_periods, lab_periods }`;
    - `lecture_weight` is in 1..99.

    Then upsert in a transaction: delete the existing links that involve either ID, then insert.
  - **`DELETE`:** remove the link involving this subject (ownership checked).
  - **`ensureGradingV2Schema()`** runs first in every method.
- [ ] **Step 5:** `subjectCards.ts`:
  - After computing each subject's period currents, load all `subject_links` for the user's subjects in **one** query.
  - For linked pairs, compute `combinePeriods` with the partner's currents, and apply the **lecture subject's** final rule to the combined values.
  - Give **both** cards that grade, with `lab_tag: 'Lec + Lab'`.
  - **Refactor needed:** expose a helper that returns the period currents and preset for one subject. `currentGradeFor` needs it, and Task 9's page needs it too, so export `loadSubjectGradeModel(userSubjectId)` returning `{ periods: PeriodInput[], config } | null`.
- [ ] **Step 6:** Run the tests, tsc, and curl `GET /api/studypulse/subjects/1/lab-link` (expect 401). Run a read-only SQL probe that the link query runs.
- [ ] **Step 7:** Commit. Message: `Linked lab subjects: per-period combination and link API`.

---

### Task 6: Grading API security and usage endpoint

**Files:**
- Rewrite: `src/app/api/studypulse/grading/[id]/route.ts` (GET and DELETE in this task; PUT in Task 7)
- Create: `src/app/api/studypulse/grading/[id]/usage/route.ts`
- Modify: `src/app/api/studypulse/subjects/[id]/grading/route.ts`

**Changes:**
- **`GET /grading/[id]`:** unchanged behaviour (it already filters by `user_id`). Add `include_earlier` to the category rows: it's already `SELECT *`, so nothing to add.
- **`DELETE /grading/[id]`**, in one transaction:
  - `SELECT preset_id FROM grading_presets WHERE preset_id=? AND user_id=? FOR UPDATE`, returning 404 if it's missing.
  - `SELECT COUNT(*) FROM subject_grading WHERE preset_id=?`, returning **409** `{ error: 'This grading system is used by N subjects', count }` if it's above 0.
  - Then delete the categories, periods and preset.
- **`PUT /grading/[id]`:** temporarily return **501** with `{ error: 'Use the new editor' }`, until Task 7 replaces it. This removes the destructive path immediately; nothing calls it today, which was verified by grep.
- **`GET /grading/[id]/usage`:** ownership-checked. Returns `{ subjects: [{ user_subject_id, code, name, entry_count }] }`, where `entry_count` = `COUNT(grade_entries)` per subject for this preset's categories.
- **`subjects/[id]/grading` POST:** after the subject ownership check, verify `SELECT 1 FROM grading_presets WHERE preset_id=? AND user_id=?`, returning 404 if not found. (The `map` support comes in Task 7.)
- **`subjects/[id]/grading` GET:** read the preset with `AND user_id=?`.

- [ ] **Step 1:** Implement the above. Keep the response shapes the existing callers use: `GradingSetupWizard` calls subject-grading GET and POST and preset POST.
- [ ] **Step 2:** Verify:
  - `npx tsc --noEmit` reports 0 errors.
  - curl gives 401 on all four.
  - A **scratch Node script** reproduces the old vulnerability with direct SQL and proves it's gone. Create two presets as user A and user B with direct SQL inside a transaction that is **rolled back**. Then import the route handler? Not possible outside Next. Instead, review the code paths in the report, and assert by SQL that the new DELETE statement order is ownership-gated.
  - Rule: **no persistent test data.**
- [ ] **Step 3:** Commit. Message: `Grading API: ownership before every write; in-use presets can't be deleted`.

---

### Task 7: Safe preset editing: diff, moves, copy and switch (TDD)

**Files:**
- Create: `src/lib/studypulse/presetDiff.ts` and `__tests__/presetDiff.test.ts`
- Modify: `src/app/api/studypulse/grading/[id]/route.ts` (PUT)
- Modify: `src/app/api/studypulse/subjects/[id]/grading/route.ts` (POST with `map`)
- Modify: `src/app/api/studypulse/grading/route.ts` (POST accepts `include_earlier`, `final_mode` `'period' | 'average'` and `final_period_index`)

**Interfaces:**
```ts
export interface DraftCategory { cat_id?: number; name: string; weight: number; is_singleton: boolean; link_group: string | null; carry_score: boolean; include_earlier: boolean }
export interface DraftPeriod { period_id?: number; name: string; categories: DraftCategory[] }
export type Move = { to: number } | 'delete';
export interface PresetDiff {
  periodUpdates: Array<{ period_id: number; name: string; sort_order: number }>;
  periodInserts: Array<{ index: number; name: string; sort_order: number }>;
  periodDeletes: number[];
  catUpdates: Array<{ cat_id: number; period_id: number; fields: DraftCategory; sort_order: number }>;
  catInserts: Array<{ periodIndex: number; fields: DraftCategory; sort_order: number }>;
  catDeletes: number[];
}
export function diffPreset(old: { periods: Array<{ period_id: number; categories: Array<{ cat_id: number }> }> }, draft: DraftPeriod[]): PresetDiff;
/** Throws Error('missing-move:<cat_id>') when a deleted category has entries and no move. */
export function validateMoves(catDeletes: number[], entryCounts: Record<number, number>, moves: Record<number, Move>): void;
/** For scope 'copy': maps each old cat_id that survives to its position [periodIndex, catIndex] in the draft. */
export function survivingPositions(draft: DraftPeriod[]): Record<number, [number, number]>;
```
A moved-to category is referenced by its **draft** `cat_id`. Moving into a *new* category isn't supported (spec: move to an existing category, or delete).

- [ ] **Step 1: Write the tests**
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPreset, validateMoves, survivingPositions, type DraftPeriod } from '../presetDiff';

const OLD = { periods: [
  { period_id: 1, categories: [{ cat_id: 10 }, { cat_id: 11 }] },
  { period_id: 2, categories: [{ cat_id: 20 }] },
] };
const cat = (o: Partial<import('../presetDiff').DraftCategory>) => ({ name: 'X', weight: 50, is_singleton: false, link_group: null, carry_score: true, include_earlier: false, ...o });

test('keeps ids for edits, inserts new, deletes removed', () => {
  const draft: DraftPeriod[] = [
    { period_id: 1, name: 'Midterm', categories: [cat({ cat_id: 10, name: 'Quizzes', weight: 60 }), cat({ name: 'Labs', weight: 40 })] },
    { name: 'Finals', categories: [cat({ name: 'Quizzes', weight: 100 })] },
  ];
  const d = diffPreset(OLD, draft);
  assert.deepEqual(d.periodUpdates.map(p => p.period_id), [1]);
  assert.deepEqual(d.periodInserts.map(p => p.name), ['Finals']);
  assert.deepEqual(d.periodDeletes, [2]);
  assert.deepEqual(d.catUpdates.map(c => c.cat_id), [10]);
  assert.equal(d.catInserts.length, 2);
  assert.deepEqual(d.catDeletes.sort(), [11, 20]);
});

test('a deleted category with entries needs a move', () => {
  assert.throws(() => validateMoves([11], { 11: 3 }, {}), /missing-move:11/);
  assert.doesNotThrow(() => validateMoves([11], { 11: 3 }, { 11: { to: 10 } }));
  assert.doesNotThrow(() => validateMoves([11], { 11: 3 }, { 11: 'delete' }));
  assert.doesNotThrow(() => validateMoves([20], { 20: 0 }, {}));
});

test('surviving positions for copy remap', () => {
  const draft: DraftPeriod[] = [{ period_id: 1, name: 'M', categories: [cat({ cat_id: 11 }), cat({ cat_id: 10 })] }];
  assert.deepEqual(survivingPositions(draft), { 11: [0, 0], 10: [0, 1] });
});
```
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `presetDiff.ts` (pure, no DB) to satisfy the interface and the tests.
- [ ] **Step 4: Rewrite `PUT /api/studypulse/grading/[id]`.** Body:
```
{ name, grade_scale, final_mode, final_period_index, periods: DraftPeriod[], moves: Record<cat_id, Move>, scope: 'all' | 'copy', user_subject_id }
```
Handling:
- `ensureGradingV2Schema()`.
- In a transaction, `SELECT … FOR UPDATE` the preset `WHERE preset_id=? AND user_id=?`, returning 404 if not found.
- Load the old structure and the entry counts per category (`SELECT cat_id, COUNT(*) FROM grade_entries WHERE cat_id IN (...) GROUP BY cat_id`).
- `validateMoves`, returning 400 `{ error: 'missing-move', cat_id }` on failure.
- `user_subject_id` must be owned by the user. Validate every period sums to 100 and has names, returning 400 otherwise.
- **`scope:'all'`:**
  1. Apply `periodUpdates`/`periodInserts` and keep a map from insert index to the new `period_id`.
  2. Apply `catUpdates` (name, weight, is_singleton, link_group, carry_score, include_earlier, sort_order, period_id) and `catInserts`.
  3. For each `catDeletes` entry with a move: `UPDATE grade_entries SET cat_id=?, period_id=(SELECT period_id FROM grading_categories WHERE cat_id=?) WHERE cat_id=?`. For `'delete'`: delete those entries **and** their `canvas_entry_links` (FK cascade handles it). Then delete the categories, then the deleted periods.
  4. Update the preset's name, scale, `final_mode` and `final_period_id`. The final period index refers to the draft; resolve it to its ID.
- **`scope:'copy'`:**
  1. Insert a new preset owned by the user from the draft, building a map from each new position `[pi, ci]` to the new `cat_id`.
  2. Remap **only** `user_subject_id`'s `grade_entries`: for each old `cat_id` in `survivingPositions(draft)`, set `cat_id`/`period_id` to the new IDs at that position. For moved deleted categories, move them to the new category corresponding to the move target's position. Delete the `'delete'` ones (only this subject's).
  3. `UPDATE subject_grading SET preset_id=newId WHERE user_subject_id=?`.
  4. Return `{ status: 'success', preset_id }`. The original preset is untouched.
- [ ] **Step 5: `POST subjects/[id]/grading`** accepts `map?: Record<old_cat_id, number | 'delete'>`.
  - When the subject already has a config with a **different** `preset_id` **and** has entries, `map` is required (400 `{ error: 'map-required', categories: [...] }` otherwise).
  - Apply it in the same transaction as the `subject_grading` upsert: move the entries to the new `cat_id`/`period_id` (new preset ownership is verified in Task 6), and delete the ones mapped to `'delete'`.
- [ ] **Step 6: `POST /grading`** (create) stores `include_earlier`. `final_mode` is `'period'` or `'average'`, with `final_period_index` resolving `final_period_id` for both modes.
- [ ] **Step 7:** Verify:
  - The tests pass and tsc reports 0 errors.
  - **A rolled-back integration probe:** a scratch Node script opens one connection, `BEGIN`, creates a preset with two periods and categories plus a subject and entries for a **temporary** user row, runs the same SQL sequence that `scope:'all'` and `scope:'copy'` issue (copied from the route), asserts the entry `cat_id`s afterwards, then `ROLLBACK`.
  - Paste the output into the report.
- [ ] **Step 8:** Commit. Message: `Edit grading systems in place: ids kept, entries moved, copy or apply to all`.

---

### Task 8: Grading setup sheet (replaces the wizard)

**Before coding:** invoke `ui-ux-pro-max` (form and stepper UX checks) and `emil-design-eng` (polish), and open `grading-simulation-v8.html`. The left `.setup` panel is the design. Port its markup and CSS to `--sp-*` classes.

**Files:**
- Create in `src/components/studypulse/grading/`:
  - `GradingSetup.tsx`: the sheet shell, stepper, state, save.
  - `ScaleStep.tsx`, `PeriodsStep.tsx` (with `CategoryRow.tsx`), `FinalStep.tsx`, `LabStep.tsx`, `ReviewStep.tsx`.
  - `ChoosePreset.tsx`: the entry modes and mapping.
  - `draft.ts`: pure draft helpers.
  - `__tests__` for `draft.ts`.
- Delete: `src/components/studypulse/GradingSetupWizard.tsx`.
- Modify: `SubjectCardView.tsx` (renders `GradingSetup`; passes `config`, `userSubjectId`, `existingPresets`; `onSaved(newConfig)` reloads the config via `GET subjects/[id]/grading` and **keeps `catEntries`**, merging `prev[cat_id] ?? []` for surviving IDs and refetching the entries after a copy or map). After any save that moves entries, call `router.refresh()`.
- Modify: `studypulse.css` (append a "Grading setup" section).
- `draft.ts` holds the pure functions, with tests:
  - `toDraft(preset)`;
  - `linkAcross(draft, pi, ci, on)`: mirrors the category into the other periods with the same name, as the old wizard did;
  - `renameLinked`;
  - `periodSum`;
  - `validateDraft(draft) → Record<string, string>`: field errors;
  - `draftToPayload`.

**Behaviour (spec §4):**
- **The sheet:** full height, a right-hand drawer on desktop (min(720px, 100%)) and a full-screen sheet on a phone. Esc closes it with an inline "Discard changes?" confirm when the draft is dirty. Focus is trapped inside while it's open.
- **Stepper:** 1 Scale · 2 Periods & categories · 3 Final grade · 4 Linked lab · 5 Review. Any step can be clicked. A step with errors shows a dot.
- **Entry modes:**
  - **Edit current**: the default when a config exists. The draft is built from the subject's preset.
  - **Use another system**: pick a preset, then a mapping table (old category → new category or delete, pre-filled by same name and same period name), then save via `POST subjects/[id]/grading` with `map`.
  - **Start new**: the FEU template (Midterm: Quizzes 36 / Tasks 24 / Midterm Exam 40 single; Finals: Quizzes 36 / Tasks 24 / Midterm Exam 15 single, linked / Final Exam 25 single) or blank.
- **Category flags:** exactly as in the mockup.
  - `Linked across periods` is a toggle.
  - `Include <first period>'s entries` shows for a linked multi-entry category in a period with index > 0.
  - `Reuse <first period>'s raw score` shows for a linked single score in a period with index > 0.
- **Final step:** two option cards. Picking a period is required for "Shown in a period".
- **Lab step:**
  - Uses `GET/PUT/DELETE subjects/[id]/lab-link`.
  - Partner select: the user's subjects, from `GET /api/studypulse/subjects`, excluding this one.
  - Lecture % input (1–99), with Lab shown as 100 − Lecture.
  - A period-match chip comes from the PUT 400 response, or is pre-checked client-side against the partner's config, fetched from `GET subjects/[partner]/grading`.
- **Review:**
  - A list of the changes.
  - If `GET grading/[id]/usage` shows more than one subject: an **Apply to all N** / **Save a copy for this subject only** choice.
  - For every deleted category with entries: a move select (other categories of the draft that have a `cat_id`) or "Delete its N entries".
  - Save calls `PUT grading/[id]` with `scope` (or `POST grading` and then `POST subjects/[id]/grading` for a new system). The lab link saves separately.
- **Errors** are inline. Save is disabled while there are errors, and a busy state shows while saving.

- [ ] **Step 1:** Write the tests for `draft.ts` (toDraft round trip, linkAcross adds a mirrored category to every other period, validateDraft flags a sum ≠ 100 and empty names). Run them and watch them fail.
- [ ] **Step 2:** Implement `draft.ts` and get the tests passing.
- [ ] **Step 3:** Build the components and CSS. Delete the old wizard. Wire up `SubjectCardView`.
- [ ] **Step 4:** Verify:
  - tsc 0 and the style gate clean on all new files.
  - Live, if logged in: open Grading on a real subject, edit a weight, save (scope all), and confirm the entries are still visible. Switch to "Use another system" and map. Link a lab.
  - Otherwise: an SSR render harness screenshot of each step (the same approach as the last revamp's harness scripts in the session scratchpad), and defer the live check to Task 15.
- [ ] **Step 5:** Commit. Message: `Grading setup: editable sheet with linked/cumulative categories, final rule and lab link`.

---

### Task 9: Subject page: header, tabs, final view, lab section, info tips, badge, scroll

**Before coding:** invoke `emil-design-eng` and `animate`. Use the right side of `grading-simulation-v8.html` as the design.

**Files:**
- Create: `src/components/studypulse/ui/InfoTip.tsx`, `ui/LetterGrade.tsx`, `subject/LabSection.tsx`
- Modify: `subject/SubjectHeader.tsx`, `subject/PeriodTabs.tsx`, `subject/PeriodPanel.tsx`, `subject/CategorySection.tsx`, `subject/EntryTable.tsx`, `subject/SubjectToolbar.tsx`, `SubjectCardView.tsx`, `src/app/studypulse/[id]/page.tsx` (loads the lab link and partner model)
- Modify: `studypulse.css`

**Behaviour (spec §5):**
1. **Scroll fix:** `.sp-tp-shell__inner, .sp-form-shell__inner { position: relative; }`. Verify live, or in the SSR harness with the planner closed: `document.documentElement.scrollHeight - document.querySelector('.sp-page').offsetHeight` ≤ 1.
2. **`LetterGrade`:**
   - Props `{ letter: string; description: string; size?: 'tile' | 'inline' }`.
   - Renders the base letter, a superscript modifier for `+` or `−` (raised 0.62em, at 56% size), a centred dot (4px, `currentColor` at 40% opacity) and the description (600 14.5px, muted), as in mockup v8 `.lg`.
   - `aria-label` = `"C plus, Good"` or `"B minus, Good"`.
3. **`SubjectHeader` tiles:** the value only. Percent `f1(v)`; Point `point.toFixed(scale==='4pt'?1:2)`; Letter `<LetterGrade/>`. The unit labels are Percent · Point · Letter. The "Final grade" tag sits on the designated period's tile (`'period'`) or a separate Final grade tile (`'average'`).
4. **`PeriodTabs`:** when `final_mode==='average'`, a **Final grade** tab is added after "All" with its grade. Selecting it shows only the summary's final column (the panels are hidden). The selection type becomes `number | 'all' | 'final'`.
5. **`PeriodPanel`:** a "Final grade" chip on the designated period (`'period'`).
6. **`InfoTip`:**
   - Props `{ label: string; children: ReactNode; tone?: 'violet' | 'pink' }`.
   - A 18px circular button containing an italic "i", with `aria-expanded` and `aria-describedby`.
   - The popover has `role="tooltip"`. It positions above, or below when there's no room, measured with `getBoundingClientRect` on open.
   - It closes on Esc, on an outside pointerdown and on blur out.
   - One open at a time: a module-level event, or a context. Choose the simpler.
7. **Info content:**
   - Category headers in `CategorySection` and in the summary: for `carried`, "Includes earlier work: N own graded (avg X) plus M graded from Midterm (avg Y). Those rows stay in the Midterm table."; for `reused`, "Reused score: 40/50 from Midterm (weighted 40% there), weighted 15% here. Enter a score in this period to override it."
   - The lab section: the combination rule.
8. **Entry tables:** no carried rows. **The Canvas badge** renders inline: `<span class="sp-en__name">{name}<span class="sp-src">Canvas</span></span>`, where `.sp-en` is no longer a flex container (the badge uses `display:inline-block; margin-left:6px; vertical-align:1px`).
9. **`LabSection`:** shown when the subject has a link.
   - A per-period table: Lecture · Lab · Combined, with an InfoTip.
   - The header chip "Linked lab: CODE (30%)" or "Linked lecture: CODE (70%)", linking to the partner.
   - The header tiles, tabs and final view show **combined** values. The summary and entry tables stay per subject.
   - **Page data:** `[id]/page.tsx` loads the link plus the partner's period currents via `loadSubjectGradeModel` (Task 5) and passes `labLink={ role, partner, lectureWeight, partnerCurrents: (number | null)[] }`.
10. **`SubjectToolbar` Canvas menu:** the items link to `/studypulse/canvas?tab=bank&subject=ID` and `?tab=announcements&subject=ID`.

- [ ] **Step 1:** Build `InfoTip` and `LetterGrade`, then wire them up.
- [ ] **Step 2:** Make the header, tabs and panel changes.
- [ ] **Step 3:** Build `LabSection` and the page data.
- [ ] **Step 4:** Fix the badge, the scroll and the toolbar links.
- [ ] **Step 5:** Verify:
  - tsc 0, `node scripts/sp-test.mjs` all pass, the style gate clean.
  - Screenshots: live if logged in, otherwise the SSR harness. Cover the Letter, Point and Percent tiles; the dedicated final tab; an InfoTip open; a linked lab subject; a long name with the inline Canvas badge.
- [ ] **Step 6:** Commit. Message: `Subject page: value-only tiles, letter grades, final view, lab section, info tips`.

---

### Task 10: Grade summary: points, toggle, info tips, what-if raw input

**Files:**
- Modify: `subject/GradeSummary.tsx`
- Modify: `studypulse.css` (summary section)

**Behaviour (spec §5.4):**
- **Rows:** primary `80.0%` with secondary `32.0 of 40 pts`. The **Percent · Points** segmented toggle swaps which is primary (`32.0 / 40` with `80.0%`). Points = `avg × weight / 100` (raw weight, **not** renormalised; this replaces the last fix wave's contribution).
- **Each period's big number** has an InfoTip: "**61.4 of 75 pts earned** so far. 75% of this period's grade is in; ungraded categories don't count against you yet." The values come from `projectPeriod` (Σ avg × w / 100 over the graded categories; graded weight; coverage).
- **Carried and reused InfoTips** on category names (Task 9 content).
- **The final column** shows only when `final_mode==='average'`. It lists each period's grade (no "1 of N"), with the final grade in large type and its letter. With `'period'` there's no final column; the period card carries the "Final grade" eyebrow.
- **What-if:**
  - An **Enter as: Percent · Raw score** segmented control.
  - Raw mode shows `score / items` inputs per category. A valid pair → `score/items×100`, or `transmute(score, items, table)` when transmutation is on.
  - The overrides feed the existing `wifPeriods` path (only edited categories are overridden; the invariant is kept).
  - Inputs keep the full precision in state; only the display is rounded.
- **Legacy summary:** gets the same points display and toggle.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Verify:
  - tsc and tests pass, the gate is clean.
  - An offline numeric check (a scratch Node script over `projection`/`periodModel` and the fixtures from the mockup: Midterm Quizzes [85, 90], Tasks [90, 100], Exam 40/50; Finals cumulative). It must print Midterm 86.3 with rows 31.5/36, 22.8/24, 32.0/40, and Finals 81.9 with "61.4 of 75 pts".
  - Screenshots of the Percent and Points views and what-if raw input.
- [ ] **Step 3:** Commit. Message: `Grade summary: points of weight, percent/points toggle, raw what-if`.

---

### Task 11: Canvas APIs: suggestions, notes, restore, uninclude, seen (TDD for the pure parts)

**Files:**
- Modify: `src/lib/canvas/classify.ts` (+ `src/lib/canvas/__tests__/classify.test.ts`). **`scripts/sp-test.mjs` only includes `studypulse/**`**, so extend its `INCLUDE` regex to `^(studypulse\/.+|canvas\/classify(\.test)?|canvas\/__tests__\/.+|gradeScale|transmutation)\.ts$`. `classify.ts` is pure.
- Modify: `src/app/api/canvas/bank/route.ts`
- Create: `src/app/api/canvas/bank/[id]/restore/route.ts`, `bank/[id]/uninclude/route.ts`, `announcements/[id]/restore/route.ts`, `announcements/[id]/seen/route.ts`
- Modify: `src/app/api/canvas/announcements/route.ts` (accepts `status=pending|included|ignored`, default `pending`; returns `seen_at`, `suggested_note` and `note_spans`)
- Modify: `src/app/api/canvas/announcements/[id]/include/route.ts` (per-destination `note`)

**Interfaces:**
```ts
export interface BankSuggestion { period_id: number; period_name: string; cat_id: number; cat_name: string; confidence: 'match' | 'guess'; reason: string }
export function suggestBankTarget(
  itemName: string,
  periods: Array<{ period_id: number; name: string; categories: Array<{ cat_id: number; name: string }> }>,
  recentPeriodId: number | null,
): BankSuggestion | null;
export function suggestLegacyTarget(itemName: string): { target: 'activities' | 'quizzes' | 'exams'; confidence: 'match' | 'guess'; reason: string };
/** Spec §6.1: the extra-detail sentences ("Bring a calculator.", "Coverage: …"), joined by a space; '' when none. */
export function extractAnnouncementNote(body: string): string;
/** Character ranges [start, end) of those same sentences in `body`, for the highlight. */
export function noteSpans(body: string): Array<[number, number]>;
```

**Rules:**
- **Period:** `recentPeriodId` if it's in `periods`, else the first period. The reason text ends with "<Period> is the period you're currently adding entries to." or "<Period> is the first period."
- **Category:**
  - An exact category-name substring match (case-insensitive, longest name first) → `match`, with reason `“<name>” matches the category name.`
  - Else a keyword alias: quiz|seatwork|long test → a category named like /quiz/i; task|data sheet|report|activity|lab|output|assignment → /task|activit|lab|output|requirement/i; exam|midterm|final → /exam/i; problem set|ps\d → /problem|set|exercise/i. A hit → `match`, reason `“<keyword>” matches your <cat> category.`
  - Else the first category in that period → `guess`, reason "No category matched “<name>”, so this is a guess. Check it with Change…".
- Returns `null` when there are no periods.

- [ ] **Step 1: Write the tests:**
  - "Quiz 4: Binary Search Trees" → Quizzes, match.
  - "[M7S2-DATA SHEET] Hash Tables Lab Report" with categories [Quizzes, Tasks, Midterm Exam] → Tasks, match.
  - "Problem Set 6: Graph Coloring" with [Quizzes, Problem Sets, Midterm Exam] → Problem Sets, match (exact name).
  - "Seatwork: Euler Paths" with [Quizzes, Problem Sets] → Quizzes, match via the seatwork alias.
  - "Survey" with [Quizzes, Tasks] → Quizzes, guess.
  - Period: recentPeriodId 2 → period 2; null → the first period.
  - `suggestLegacyTarget`: "Quiz 3" → quizzes, "Final Exam" → exams, "Survey" → activities (guess).
- [ ] **Step 2:** Run them (fail), implement in `classify.ts` (reuse `includesAny`), run them again (pass).
- [ ] **Step 3: `GET /api/canvas/bank`:**
  - For pending items whose mapped subject is custom, attach `suggestion`. Load each distinct subject's periods and categories **once** (one query per subject, cached in a `Map`). `recentPeriodId` = `SELECT period_id FROM grade_entries WHERE user_subject_id=? ORDER BY entry_id DESC LIMIT 1`.
  - Legacy subjects get `suggestion: { legacy: suggestLegacyTarget(name) }`.
  - Also return `points_possible`/`submission_score` as numbers (`Number()`); they're strings today.
- [ ] **Step 3b: Notes.**
  - **Tests:** for "Reminder: our long quiz is on Monday, Nov 3, during class hours. Coverage: graph traversal, trees, and coloring. Bring a calculator.", `extractAnnouncementNote` returns "Coverage: graph traversal, trees, and coloring. Bring a calculator." and `noteSpans` returns two ranges whose slices equal those sentences. A body with no cues returns `''` and `[]`.
  - The cue list (case-insensitive, sentence-initial): bring, please bring, coverage, covers, attendance, wear, prepare, don't/do not forget, remember to, materials, requirements, note, reminder that.
  - **`GET /api/canvas/announcements`:** adds `suggested_note` (computed from the stripped body) and `note_spans`.
  - **`POST announcements/[id]/include`:** every destination accepts `note?: string | null` (trim; empty → null; > 1000 → 400 `{ error: 'Note is too long' }`).
    - event and reminder pass it to `insertWorkboardItem` (currently hard-coded `note: null`);
    - schedule change keeps its existing field;
    - task, after inserting the entry: if a note is set, `INSERT INTO workboard_entry_meta (user_id, <metaCol>, note) VALUES (?,?,?) ON DUPLICATE KEY UPDATE note=VALUES(note)`, inside the same transaction. `metaCol` is activity_id, quiz_id, exam_id or grade_entry_id, matching `linkColumn`.
- [ ] **Step 4:** Reverse endpoints (each: auth, ownership via the `canvas_connections.user_id` join, as in `ignore/route.ts`):
  - **`bank/[id]/restore`:** `ignored` → `pending` (409 if not ignored).
  - **`announcements/[id]/restore`:** `ignored` → `pending`.
  - **`announcements/[id]/seen`:** `seen_at = COALESCE(seen_at, NOW())`.
  - **`bank/[id]/uninclude`**, in a transaction:
    - Find the `canvas_entry_links` row for the bank item. 404 if there is none.
    - Require `link.created_at >= NOW() - INTERVAL 15 MINUTE` and that the linked entry's `score`/`items` still equal `gradeBreakdown(submission_score, points_possible)`. Otherwise **409** `{ error: 'This entry has changed since it was added' }`.
    - Delete the linked entry row (activities, quizzes, exams or grade_entries by the non-null column; the link cascades) and set `bank_status='pending'`.
- [ ] **Step 5:** Verify:
  - The tests pass and tsc reports 0 errors.
  - curl returns 401 for each new route.
  - A rolled-back SQL probe for `uninclude` on a temporary row set (BEGIN … ROLLBACK).
- [ ] **Step 6:** Commit. Message: `Canvas APIs: bank suggestions, restore, undo include, announcement seen`.

---

### Task 12: Canvas hub shell and Overview

**Before coding:** open `canvas-hub-v1c.html` and use its `header()` and `overview()` functions as the design. Invoke `redesign-existing-projects` for an audit-first check of today's `CanvasConnectPanel`/`CanvasCourseMapping` behaviour, which must be kept: pairing bookmarklet, sync, disconnect, link/create/ignore course mapping.

**Files:**
- Rewrite: `src/app/studypulse/canvas/page.tsx`. It also loads the pending counts and the `?tab=`/`?subject=` params; it imports `../studypulse.css`.
- Rewrite: `src/app/studypulse/canvas/CanvasClientShell.tsx`.
- Create in `src/components/studypulse/canvas/`:
  - `HubHeader.tsx`: back button, "Canvas", the views tablist with counts, the subject select on the bank and announcements tabs.
  - `CanvasOverview.tsx`, `ProfileCard.tsx`, `CourseMapping.tsx`, `ConnectPanel.tsx` (the not-connected pairing flow, restyled).
  - `useUndoToast.ts` and `UndoToast.tsx`.
- Delete: `CanvasConnectPanel.tsx`, `CanvasCourseMapping.tsx`. They're replaced, and their logic is ported unchanged.
- Modify: `studypulse.css` (append a "Canvas hub" section).

**Behaviour (spec §6, C1–C2):**
- **Header row:** `[←] Canvas [Overview | Activity Bank n | Announcements n]`, with the subject select at the right end on the bank and announcements tabs.
  - The back button is icon-only, with `aria-label="Back to StudyPulse"`, and goes to `/studypulse`.
  - The tabs are a tablist with arrow keys.
  - The tab, and the subject when not `all`, are reflected in the URL via `router.replace`, with no scroll.
- **Default tab:** `bank` if there's anything pending, else `overview`, unless `?tab=` is given.
- **`?subject=`** shows the "Showing CODE only · Show all subjects" bar.
- **Overview:**
  - Two columns: a 340–360px `ProfileCard` and the courses panel. They stack below 900px.
  - **`ProfileCard`:**
    - Avatar initials, name, a Connected or "Needs reconnect" chip (`status==='invalid'`).
    - A key–value list: Last sync (relative time and status), Auto-sync "Every 30 min", Access token "Expires in N days" (warn tone under 14), Courses "N mapped · M new".
    - A full-width **Sync now** (busy spinner), the "Connection" eyebrow and **Disconnect Canvas**, which uses an inline confirm.
  - **Courses panel:** New Canvas courses rows ("Link to subject…" select · "or" · Create subject · Ignore), then the Mapped list with per-subject "N pending · M to review".
  - **Not connected:** `ConnectPanel` replaces both columns with the pairing flow (the bookmarklet link and pairing code polling, logic ported unchanged).
- **`useUndoToast`:**
  - `show({ message, undo?: () => Promise<void>, link?: { href, label } })`, auto-dismissed after 5s.
  - `role="status"`. Only one at a time.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Verify:
  - tsc and the gate pass.
  - curl `/studypulse/canvas` → 307 when logged out.
  - Screenshots: live if possible, otherwise SSR harness screenshots with mock props, compared against `canvas-hub-v1c.html`.
- [ ] **Step 3:** Commit. Message: `Canvas hub: header with views, Overview profile and course mapping`.

---

### Task 13: Activity Bank tab

**Files:**
- Create: `src/components/studypulse/canvas/ActivityBank.tsx`, `BankRow.tsx`
- Delete: `src/components/studypulse/CanvasActivityBank.tsx`
- Modify: `studypulse.css`

**Behaviour (spec §6 C3, mockup `bank()`):**
- **Toolbar:**
  - A select-all checkbox (a real `<input type="checkbox">`).
  - A **To review (n) / Ignored (n)** segmented control.
  - The hint "New Canvas assignments wait here until you add them to a subject." on the right. When rows are selected, it's replaced by "N selected · Add N as suggested · Ignore".
- **Row:**
  - Checkbox, name, subject chip, due date (`shortDate`), and the Canvas score "18 / 20" or "Not graded on Canvas yet · N pts".
  - **"Goes to Period › Category"** with an InfoTip showing the reason. A guess shows a warn-tone dot plus "guess" in the InfoTip.
  - The preview "18 / 20 → 90.0" (transmuted if the subject page's transmutation preference isn't available here, so show raw) or "added as Pending (no score yet)".
  - Actions: **Add** (primary), **Change…**, **Ignore**.
- **Change…** opens the inline picker row (period select → category select) with "Add here". It loads the periods via `GET subjects/[id]/grading` (cached per subject).
- **Add:**
  - Calls the existing `POST bank/[id]/include` with `{ target_type: 'grade_entries', period_id, cat_id }`, or the legacy target.
  - The row leaves (fade plus grid-rows collapse, 180ms).
  - Toast "Added to CODE · Period › Category" with **Undo** → `POST bank/[id]/uninclude`. On 409, the toast changes to "Can't undo, it was edited".
- **Ignore:** `POST bank/[id]/ignore`. Toast with Undo → `restore`. Ignored rows show **Restore**.
- **Bulk:** runs the requests sequentially, then shows one toast ("Added 3 items") whose Undo reverses all of them. Items without a suggestion are skipped, with a count in the toast.
- **Errors:** inline per row (`role="alert"`). No `alert()`.
- **Empty states:** "You're all caught up" / "Nothing ignored".
- **Subject filter:** from the header select.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Verify tsc and the gate, and take screenshots (live or SSR with mock data, including the guess row, the picker open, bulk selected, the toast and the empty states).
- [ ] **Step 3:** Commit. Message: `Canvas hub: Activity Bank with suggestions, bulk actions and undo`.

---

### Task 14: Announcements tab

**Files:**
- Create: `src/components/studypulse/canvas/Announcements.tsx`, `AnnouncementDetail.tsx`, `ConvertPanel.tsx`
- Delete: `src/components/studypulse/CanvasAnnouncementBank.tsx`. Port its destination sub-forms, validation and include payload **unchanged in logic**: task (legacy or custom period/category, deadline), event, reminder, schedule change (with the block list fetch).
- Modify: `studypulse.css`

**Behaviour (spec §6 C4, mockup `annView()`):**
- **Two panes:** the list (360px) and the detail. Below 900px, list → detail with a back button.
- **List:**
  - Header: the subject select comes from the hub header, so the list header shows only the **To review / Converted / Dismissed** segmented control with counts. Map: To review = `pending`, Converted = `included`, Dismissed = `ignored`.
  - Rows: title (2-line clamp), unread dot (`seen_at == null`), subject chip, relative time, suggested-destination chips.
- **Opening a row** marks it seen (`POST announcements/[id]/seen`, optimistic).
- **Detail:**
  - Subject chip, "Posted …", **Open in Canvas** (`html_url`, new tab), the title, and the body (HTML stripped, max-height with scroll).
  - **"Turn this into"**:
    - Destination tabs (Task · Event · Reminder · Schedule change), each with an include checkbox and a "Suggested" mark from `suggested_destinations`.
    - The active tab shows its short form, pre-filled as the old component did.
    - **Every form ends with a full-width Note textarea** (spec §6.1, mockup v1c):
      - pre-filled with `suggested_note` and labelled "From the announcement" when non-empty;
      - an `InfoTip` saying where the note will show;
      - each destination keeps its own edited value;
      - it is sent as `note` per destination.
      The schedule change's old "Note" input is this same field.
    - The body highlights `note_spans` with `<mark class="sp-ann-pick">`. Build the nodes from the ranges; never use `dangerouslySetInnerHTML`.
    - "Include this <x>" / "Remove from this conversion".
    - **Dismiss** (→ ignore + toast Undo → restore) and **Convert (n)** (→ the existing include with every checked destination; toast "Converted into N items · View in Workboard" linking to `/workboard`, no undo).
  - Converted and dismissed items show a status chip. Dismissed ones show **Restore**.
- **Errors** inline. No `alert()`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Verify tsc and the gate, and take screenshots (live or SSR: the list with unread, the detail with two destinations included, the phone stack, dismissed + restore).
- [ ] **Step 3:** Commit. Message: `Canvas hub: Announcements inbox with multi-destination conversion`.

---

### Task 14b: Notes on school tasks in Workboard and StudyPulse

**Before coding:** read spec §6.1. Workboard code is dense with invariants (see the comments in `academicWrites.ts` and `workItems.ts`). Change only what is listed and follow the existing comment style.

**Files:**
- Modify: `src/lib/workboard/workItems.ts`. The academic SELECT adds `m.note`; the academic item maps `note: r.note ?? null` instead of `null`.
- Modify: `src/lib/workboard/academicWrites.ts`. `AcademicPatch` gains `note?: string | null`, routed to the `workboard_entry_meta` overlay like `estimated_hours`, through the same insert-or-update path.
- Modify: `src/app/api/workboard/academic/[source]/[id]/route.ts`. Accept `note` (string or null; trim; ≤ 1000, else 400).
- Modify: `src/app/api/workboard/academic/create/route.ts`. Accept an optional `note`. After the entry is inserted, if the note is non-empty, upsert the overlay row.
- Modify: `src/components/workboard/WorkItemDialog.tsx` and `dialog/SharedFields.tsx`.
  - The Note field is enabled for academic edit and the new-graded path, and sent in their payloads.
  - The new-graded hint drops "or Note" from its list.
- Modify: `src/app/studypulse/[id]/page.tsx`. The entry queries (grade_entries, activities, quizzes, exams) `LEFT JOIN workboard_entry_meta m ON m.<metaCol> = <pk> AND m.user_id = ?` and select `m.note`.
- Modify: `src/components/studypulse/subject/EntryTable.tsx` (and the legacy table if separate) plus the entry type in `types.ts`. A lucide `StickyNote` icon button (16px, `aria-label="Note"`) after the name, inline like the Canvas badge, opens an `InfoTip` with the note (pre-wrap) and a muted "Edit in Workboard" line.

- [ ] **Step 1:** Implement.
- [ ] **Step 2: Verify.**
  - tsc 0, all tests pass, and the style gate is clean on the touched StudyPulse files. The Workboard files keep their existing inline-style idiom, so don't run the gate on them unless it already passes on them at BASE.
  - Run `node scripts/wb-test.mjs` (Workboard's suite) and report its output; record its pass count at BASE in Task 0 too.
  - **Rolled-back SQL probe:** insert an activity for a temp row set, upsert its overlay note, then run the `workItems` academic SELECT and the subject-page query to confirm both return the note. Then `ROLLBACK`.
  - **Live, if signed in:** convert the calculator-style announcement into a Task with a note, check the Workboard item detail shows it under Notes and the StudyPulse entry shows the note icon, then edit the note in Workboard.
- [ ] **Step 3:** Commit. Message: `Notes on school tasks: Workboard reads and edits them, StudyPulse shows them`.

---

### Task 15: Motion, accessibility, stress and live QA

**Skills, in order:** `emil-design-eng`, `animate`, `mobile-native`, `break-ui`, `impeccable` (critique/audit), `superpowers:verification-before-completion`.

- [ ] **Step 1:** Run each skill against the touched surfaces: the grading setup, the subject page, the grade summary and the Canvas hub. Write `file:line — issue — fix` findings to `.superpowers/sdd/2026-10-24-grading-system-and-canvas-hub/t15-findings.md` and apply the P0/P1 fixes.
- [ ] **Step 2: break-ui data:**
  - a 90-character subject name;
  - 5 periods;
  - a linked category across 3 periods with cumulative on;
  - a lab link with a period mismatch;
  - a preset used by 4 subjects;
  - 30 bank items;
  - an announcement with a 5,000-character body;
  - the 1.0 scale everywhere.

  Fix what breaks.
- [ ] **Step 3: Live QA** in the Playwright MCP browser.
  - **If signed out, stop and ask the user to sign in once in that window.** Don't fake it.
  - Walk through:
    - edit a grading system in place (entries survive);
    - turn cumulative on and check the Finals numbers against the mockup math;
    - reuse a score with a weight change;
    - switch the final rule;
    - link a lab and see the combined tiles and cards;
    - the summary's Points view and raw what-if;
    - the scroll height with the planner closed;
    - Canvas: Add + Undo, Ignore + Restore, Change…, bulk;
    - convert an announcement into Task + Schedule change with the pre-filled note, then find the note in Workboard and on the StudyPulse entry;
    - Dismiss + Undo;
    - the phone width (390).
  - Screenshots go to `.superpowers/sdd/2026-10-24-grading-system-and-canvas-hub/screens/`.
- [ ] **Step 4: Gates.** `npx tsc --noEmit`, `node scripts/sp-test.mjs`, and `node scripts/wb-style-gate.mjs` over every file changed since BASE (`git diff --name-only BASE -- '*.tsx' '*.css'`). Paste the real output.
- [ ] **Step 5:** Commit the fixes. Message: `Grading and Canvas hub: QA fixes`. Write `final-report.md` in the workspace.

---

## Self-review notes

**Spec coverage**

| Spec section | Covered by |
|---|---|
| §3.1 schema | Task 2 |
| §3.2 model | Task 3 |
| §3.3 final rule | Task 4 |
| §3.4 letters | Task 1 |
| §3.5 lab | Tasks 5 and 9 |
| §3.6 editing | Tasks 7 and 8 |
| §3.7 security | Task 6 |
| §4 setup | Task 8 |
| §5 subject page | Tasks 9 and 10 |
| §6 Canvas hub | Tasks 11–14 |
| §6.1 notes | Tasks 2, 11, 14 and 14b |
| §7 cross-cutting | every task, plus Task 15 |

**Type consistency**
- `FinalMode`, `GradingPresetFull` and `SubjectLink` are defined in Task 2.
- `subjectFinal(periods, mode, finalKey)` is defined in Task 4 and used in Tasks 5, 9 and 10.
- `CategoryInput.carried`/`reused` are defined in Task 3 and used in Tasks 9 and 10.
- `loadSubjectGradeModel` is defined in Task 5 and used in Task 9.
- `diffPreset`, `validateMoves` and `survivingPositions` are defined in Task 7 and used in Task 8 through the API.
- `suggestBankTarget` is defined in Task 11 and used in Task 13 via the API.
- The `InfoTip` and `LetterGrade` components are defined in Task 9 and used in Tasks 10 and 13.

**Known trade-off:** `InfoTip`s in the bank rows (Task 13) depend on Task 9's component, which is fine given the task order.
