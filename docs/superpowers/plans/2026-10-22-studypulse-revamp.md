# StudyPulse Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle My Subjects and the subject page onto a StudyPulse glass token system, and replace the AI target advisor with a deterministic, tested projection engine and a tinkerable plan sandbox.

**Architecture:**
- **Pure libs** in `src/lib/studypulse/`, all tested with `node:test`:
  - `projection.ts`: the math.
  - `periodModel.ts`: turns entries into projection input.
  - `prefs.ts`, `grades.ts`, `ui/format.ts`: helpers.
- **One server lib**, `subjectCards.ts`, is shared by the subjects page and API.
- **UI:** `SubjectCardView.tsx` stays the page container. It is split into focused components under `src/components/studypulse/{subjects,subject,planner,ui}/`, all styled by `src/app/studypulse/studypulse.css`.
- **Persistence:** extra-item counts and targets go in one new table, `studypulse_projection_prefs`.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, mysql2, lucide-react, node:test (via a transpile runner), plain CSS with custom properties.

**Spec:** `docs/superpowers/specs/2026-10-22-studypulse-revamp-design.md`. Approved mockup: `.superpowers/brainstorm/3446-1792647023/content/studypulse-revamp-v4.html` (open it in a browser and match it).

## Global Constraints

These apply to every task.

**Git and snapshots**
- **No git commits.** This repo keeps long-lived uncommitted user work: `SubjectCardView.tsx`, `migrate.ts` and `package.json` are already modified. A normal commit would sweep it in.
- Every task ends with a **snapshot**: `bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t<N> "<msg>"` (created in Task 0). Never run `git add`, `git commit` or `git stash`.

**Commands**
- Tests: `node scripts/sp-test.mjs` (all) or `node scripts/sp-test.mjs projection` (filter).
- Types: `npx tsc --noEmit` must report 0 errors after every task.
- Style gate: `node scripts/wb-style-gate.mjs <every file the task created or modified>` must pass. Its rules:
  - No hex colours outside `src/app/studypulse/studypulse.css` and `src/lib/studypulse/ui/colors.ts`.
  - No font size under 12px, except 11px uppercase weight-800 labels.
  - No plain `ease` timing.
  - No transitions on width, height, top, left, right, bottom, margin, padding or flex. Animate `transform` and `opacity` instead.
  - No 2–3px coloured side stripes.

**Styling**
- Colours, radii, fonts, shadows and motion come **only** from `--sp-*` tokens in `studypulse.css`. Components use classes, not big inline style objects. Inline `style` is allowed only for dynamic values: a CSS custom property, a transform, or a percentage position.
- Text contrast is ≥ 4.5:1. `--sp-text-subtle` and `--sp-text-faint` are for icons, separators, placeholders and the "—" glyph only. Small text and eyebrows use `--sp-text-muted` or darker. (This deliberately darkens the mockup's eyebrow grey.)
- Hover styles go inside `@media (hover: hover) and (pointer: fine)`.
- `@media (prefers-reduced-motion: reduce)` drops every StudyPulse transition to 1ms and removes hover lifts.
- Icons are `lucide-react`. No emoji in any touched UI.
- All numerals use `.sp-num` (`font-variant-numeric: tabular-nums`).
- DM Sans for headings and big numbers, Inter for UI. Both are already loaded via `src/app/fonts.css`.

**Data and scope**
- "Today" is always Manila: `todayManila()` from `src/lib/studypulse/ui/format.ts`. Never use raw `new Date().toISOString()` for a date.
- Do not modify Workboard or Finance files. The one exception is the `ALLOW_HEX` list in `scripts/wb-style-gate.mjs` (Task 0).

**Subagents**
- Use Opus subagents. Wait out rate limits; don't fall back to Sonnet.

---

## File map

| Path | Status | Responsibility |
|---|---|---|
| `.superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh` | new | private-index snapshot helper |
| `scripts/sp-test.mjs` | new | transpile `src/lib/studypulse/**` plus `gradeScale.ts` and `transmutation.ts`, then run node:test |
| `scripts/wb-style-gate.mjs` | modify | allow hex in the two StudyPulse token files |
| `src/lib/studypulse/types.ts` | new | `EntryRow`, `GradingConfig`, `PresetLike`, `SubjectCardData` |
| `src/lib/studypulse/projection.ts` (+test) | new | projection math (spec §4.2–4.3) |
| `src/lib/studypulse/prefs.ts` (+test) | new | prefs type, key parsing, clamping |
| `src/lib/studypulse/periodModel.ts` (+test) | new | entries → `PeriodInput[]` (spec §4.4) |
| `src/lib/studypulse/grades.ts` (+test) | new | `calcGrade` (moved from SubjectCardView) |
| `src/lib/studypulse/ui/colors.ts` | new | category colour cycle |
| `src/lib/studypulse/ui/format.ts` (+test) | new | `f1`, `gradeTone`, Manila today, date notes |
| `src/lib/studypulse/subjectCards.ts` | new (server) | `loadGradingConfig`, `listSubjectCards` |
| `src/lib/migrate.ts` | modify | `ensureProjectionPrefsSchema` |
| `src/app/api/studypulse/projection-prefs/route.ts` | new | GET and PUT prefs |
| `src/app/api/studypulse/subjects/route.ts` | modify | GET uses `listSubjectCards` |
| `src/app/studypulse/subjects/page.tsx` | modify | uses `listSubjectCards`, imports CSS |
| `src/app/studypulse/[id]/page.tsx` | modify | uses `loadGradingConfig`, imports CSS |
| `src/app/studypulse/studypulse.css` | new | tokens and all StudyPulse classes |
| `src/components/studypulse/ui/SpSegmented.tsx` | new | radiogroup segmented control |
| `src/components/studypulse/subjects/{SubjectForm,SubjectCard,GradeRing}.tsx` | new | My Subjects pieces |
| `src/components/studypulse/SubjectsGrid.tsx` | rewrite | composes the subjects pieces |
| `src/components/studypulse/subject/{GradePill,EntryTable,SingletonScore,CategorySection,PeriodPanel,PeriodTabs,SubjectHeader,SubjectToolbar,GradeSummary}.tsx` | new | subject page pieces |
| `src/components/studypulse/planner/{usePlannerPrefs.ts,GradeBar,SlotField,PlanSandbox,ScenarioRow,SoloWhatIf,PeriodPlanCard,TargetPlanner}.tsx` | new | target planner |
| `src/components/studypulse/SubjectCardView.tsx` | modify (shrinks to ~450 lines) | page container |
| `src/components/studypulse/TargetGradePanel.tsx` | delete | replaced by `planner/` |
| `src/app/api/studypulse/target-analysis/route.ts` | delete | AI route |

---

### Task 0: Workspace, test runner, style-gate allowlist

**Files:**
- Create: `.superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh`
- Create: `scripts/sp-test.mjs`
- Modify: `scripts/wb-style-gate.mjs` (the `ALLOW_HEX` line)

**Interfaces:**
- Produces: `node scripts/sp-test.mjs [filter]` and `snap.sh <label> "<msg>"`, which later tasks use.

- [ ] **Step 1: Create the snapshot helper**

`.superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh`:
```bash
#!/usr/bin/env bash
# Snapshot the working tree into a dangling commit WITHOUT touching the real index, branch or
# staged content (this repo keeps long-lived uncommitted user work). Refs: refs/sdd/studypulse-revamp/*
# Usage: snap.sh <label> "<message>"   -> prints the snapshot SHA
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
WS=.superpowers/sdd/2026-10-22-studypulse-revamp
label=$1; msg=$2
export GIT_INDEX_FILE="$WS/snap-index"
if [ ! -f "$GIT_INDEX_FILE" ]; then git read-tree HEAD; fi
git add -A -- . ':(exclude).playwright-mcp' ':(exclude).superpowers' ':(exclude)*.png' >/dev/null 2>&1
tree=$(git write-tree)
parent=$(git rev-parse -q --verify refs/sdd/studypulse-revamp/latest || git rev-parse HEAD)
sha=$(git commit-tree "$tree" -p "$parent" -m "$msg")
git update-ref "refs/sdd/studypulse-revamp/$label" "$sha"
git update-ref refs/sdd/studypulse-revamp/latest "$sha"
echo "$sha"
```
Run: `bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh base "studypulse revamp base"`
Expected: it prints a SHA, and `git status` is unchanged from before (verify with `git diff --cached --stat`, which is empty).

- [ ] **Step 2: Create the test runner**

`scripts/sp-test.mjs`:
```js
#!/usr/bin/env node
// StudyPulse unit tests. Same approach as scripts/wb-test.mjs: transpile pool-free modules with the
// project's TypeScript into a temp dir and run node:test on *.test.ts.
// Usage: node scripts/sp-test.mjs [substring-filter]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const ROOT = 'src/lib';
// Only StudyPulse modules plus the two shared pure libs they import.
const INCLUDE = /^(studypulse\/.+|gradeScale|transmutation)\.ts$/;
// Modules that import the DB pool. Never transpiled; tests may only `import type` from them.
const SERVER = /^studypulse\/subjectCards\.ts$/;
const out = mkdtempSync(join(tmpdir(), 'sp-test-'));
const walk = d => readdirSync(d).flatMap(n => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.ts') ? [p] : []);
});

const tests = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (!INCLUDE.test(rel) || SERVER.test(rel)) continue;
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const fromDir = posix.dirname(rel);
  const js = outputText
    .replace(/(from\s+['"])@\/lib\/([^'"]+)(['"])/g, (_, a, p, b) => {
      let r = posix.relative(fromDir, p);
      if (!r.startsWith('.')) r = './' + r;
      return `${a}${r}${b}`;
    })
    .replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, '$1$2.mjs$3');
  const dest = join(out, rel).replace(/\.ts$/, '.mjs');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, js);
  if (file.endsWith('.test.ts')) tests.push(dest);
}

const filter = process.argv[2];
const selected = filter ? tests.filter(t => t.includes(filter)) : tests;
if (selected.length === 0) { console.error('no studypulse tests matched'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...selected], { stdio: 'inherit' });
process.exit(r.status ?? 1);
```

- [ ] **Step 3: Allow StudyPulse token files in the style gate**

In `scripts/wb-style-gate.mjs`, replace the `const ALLOW_HEX = [...]` line with:
```js
const ALLOW_HEX = [/workboard\.css$/, /lib[\\/]workboard[\\/]color\.ts$/, /lib[\\/]workboard[\\/]ui[\\/]tokens\.ts$/, /finance[\\/]finance\.css$/, /lib[\\/]finance[\\/]ui[\\/]colors\.ts$/, /studypulse[\\/]studypulse\.css$/, /lib[\\/]studypulse[\\/]ui[\\/]colors\.ts$/];
```

- [ ] **Step 4: Verify the runner reports "no tests" cleanly**

Run: `node scripts/sp-test.mjs`
Expected: `no studypulse tests matched`, exit 1. That's correct at this point, since no tests exist yet.

- [ ] **Step 5: Snapshot**

`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t0 "sp: test runner, snapshot helper, style-gate allowlist"`

---

### Task 1: Projection engine (TDD)

**Files:**
- Create: `src/lib/studypulse/projection.ts`
- Test: `src/lib/studypulse/__tests__/projection.test.ts`

**Interfaces:**
- Consumes: `SCALE_4PT_ROWS`, `SCALE_1PT_ROWS`, `GradeScale` from `@/lib/gradeScale`.
- Produces, for Tasks 2, 8, 9 and 10:
  - Types: `CategoryInput`, `PeriodInput`, `CategoryStats`, `PeriodProjection`, `Tone`, `ProjectionStatus`, `Threshold`.
  - Functions:
    - `projectPeriod(p)`, `gradeAt(proj, x)`, `planOutcome(proj, slots)`, `soloNeed(proj, target, i)`, `scenarios(proj)`
    - `scaleThresholds(scale)`, `closestReachable(proj, target, scale)`, `targetPresets(scale)`, `outcomeTone(delta)`, `defaultSlotValue(proj)`
    - `collectiveCurrent(periods)`, `subjectFinal(periods, mode)`, `subjectOverall(periods, mode)`

- [ ] **Step 1: Write the failing tests**

`src/lib/studypulse/__tests__/projection.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectPeriod, gradeAt, planOutcome, soloNeed, scenarios, closestReachable,
  targetPresets, outcomeTone, defaultSlotValue, subjectFinal, subjectOverall, scaleThresholds,
  type PeriodInput, type CategoryInput,
} from '../projection';

const near = (actual: number | null, expected: number, tol = 0.05) => {
  assert.ok(actual !== null, `expected ${expected}, got null`);
  assert.ok(Math.abs((actual as number) - expected) <= tol, `expected ${expected}±${tol}, got ${actual}`);
};
const cat = (o: Partial<CategoryInput> & Pick<CategoryInput, 'key' | 'weight'>): CategoryInput => ({
  name: o.key, color: '', graded: [], pendingNames: [], extra: 0, singleton: false, noun: 'Item', ...o,
});

// Hand-verified fixtures from mockup v4 (spec §4.5).
const MIDTERM: PeriodInput = { key: 'p1', name: 'Midterm', target: 89, categories: [
  cat({ key: 'q', weight: 36, graded: [96, 88, 92], pendingNames: ['Quiz 4: Trees'], extra: 1 }),
  cat({ key: 't', weight: 24, graded: [100], extra: 3 }),
  cat({ key: 'e', weight: 40, pendingNames: ['Midterm Exam'], singleton: true }),
] };
const FINALS: PeriodInput = { key: 'p2', name: 'Finals', target: 97, categories: [
  cat({ key: 'q', weight: 36, graded: [72, 68], pendingNames: ['Quiz 7'] }),
  cat({ key: 't', weight: 24, graded: [60, 70] }),
  cat({ key: 'e', weight: 40, pendingNames: ['Final Exam'], singleton: true }),
] };

test('midterm: need, range, current, coverage, status', () => {
  const p = projectPeriod(MIDTERM);
  near(p.need, 87.19);
  near(p.worst, 25.87);
  near(p.best, 98.27);
  near(p.current, 95.2);
  near(p.coverage, 27.6);
  assert.equal(p.remaining, 6);
  assert.equal(p.status.kind, 'stretch');
  assert.equal(p.status.tone, 'warn');
});

test('midterm: single-category what-if', () => {
  const p = projectPeriod(MIDTERM);
  near(soloNeed(p, 89, 0), 54.95);
  near(soloNeed(p, 89, 1), 63.0);
  near(soloNeed(p, 89, 2), 80.71);
});

test('midterm: every slot at the requirement lands exactly on target', () => {
  const p = projectPeriod(MIDTERM);
  const x = p.need as number;
  near(planOutcome(p, [[x, x], [x, x, x], [x]]), 89, 0.001);
  near(gradeAt(p, 70), 76.55);
});

test('midterm: scenarios swap the nearest fixed value for the requirement', () => {
  const s = scenarios(projectPeriod(MIDTERM));
  assert.deepEqual(s.map(r => r.input), [60, 70, 80, 87.2, 100]);
  near(s[3].result, 89.0, 0.06);
});

test('finals: out of reach with closest reachable letters', () => {
  const p = projectPeriod(FINALS);
  assert.ok((p.need as number) > 100);
  near(p.best, 84.4);
  near(p.current, 68.0);
  near(p.coverage, 48.0);
  assert.equal(p.status.kind, 'out-of-reach');
  const alts = closestReachable(p, 97, '4pt');
  assert.deepEqual(alts.map(a => a.label), ['C', 'D+', 'D']);
  near(alts[0].need, 91.54);
  near(alts[1].need, 81.92);
  near(alts[2].need, 72.31);
  assert.deepEqual(scenarios(p).map(r => r.input), [60, 70, 80, 90, 100]);
});

test('finals: a category with nothing left is locked for solo what-if', () => {
  assert.equal(soloNeed(projectPeriod(FINALS), 97, 1), null);
});

test('nothing graded: current is null, status still computed from need', () => {
  const p = projectPeriod({ key: 'x', name: 'X', target: 80, categories: [
    cat({ key: 'a', weight: 50, pendingNames: ['A1'] }), cat({ key: 'b', weight: 50, extra: 2 }),
  ] });
  assert.equal(p.current, null);
  near(p.need, 80);
  assert.equal(p.coverage, 0);
  assert.equal(p.status.kind, 'achievable');
});

test('everything graded: b = 0, locked in or out of reach by current', () => {
  const base = { key: 'x', name: 'X', categories: [cat({ key: 'a', weight: 100, graded: [90] })] };
  const hi = projectPeriod({ ...base, target: 85 });
  assert.equal(hi.need, null);
  assert.equal(hi.status.kind, 'locked-in');
  assert.equal(projectPeriod({ ...base, target: 95 }).status.kind, 'out-of-reach');
});

test('no items at all: empty status', () => {
  const p = projectPeriod({ key: 'x', name: 'X', target: 85, categories: [cat({ key: 'a', weight: 100 })] });
  assert.equal(p.current, null);
  assert.equal(p.status.kind, 'empty');
});

test('inactive categories are excluded and weights renormalize', () => {
  const p = projectPeriod({ key: 'x', name: 'X', target: 85, categories: [
    cat({ key: 'a', weight: 60, graded: [80], extra: 1 }), cat({ key: 'b', weight: 40 }),
  ] });
  assert.equal(p.categories[1].share, 0);
  near(p.categories[0].share, 1);
  near(p.need, 90);
});

test('negative need means locked in; extra on a singleton is ignored', () => {
  const p = projectPeriod({ key: 'x', name: 'X', target: 40, categories: [
    cat({ key: 'a', weight: 90, graded: [100] }), cat({ key: 'e', weight: 10, singleton: true, pendingNames: ['E'], extra: 5 }),
  ] });
  assert.equal(p.categories[1].k, 1);
  assert.ok((p.need as number) <= 0);
  assert.equal(p.status.kind, 'locked-in');
});

test('defaultSlotValue clamps to 0..100 and rounds to one decimal', () => {
  assert.equal(defaultSlotValue(projectPeriod(MIDTERM)), 87.2);
  assert.equal(defaultSlotValue(projectPeriod(FINALS)), 100);
});

test('outcomeTone thresholds', () => {
  assert.equal(outcomeTone(0), 'success');
  assert.equal(outcomeTone(-0.04), 'success');
  assert.equal(outcomeTone(-1.7), 'warn');
  assert.equal(outcomeTone(-3.5), 'danger');
});

test('presets and thresholds per scale', () => {
  assert.deepEqual(targetPresets('4pt').map(p => p.value), [97, 93, 89, 85, 80, 70]);
  assert.deepEqual(targetPresets('1pt').map(p => p.label), ['1.00', '1.50', '2.00', '2.50', '3.00']);
  assert.deepEqual(scaleThresholds(null).map(t => t.min), [90, 80, 70, 60]);
});

test('final grade: average and collective', () => {
  near(subjectFinal([MIDTERM, FINALS], 'average'), 81.6);
  near(subjectFinal([MIDTERM, FINALS], 'collective'), 81.6);
  assert.equal(subjectFinal([MIDTERM, FINALS], null), null);
  near(subjectOverall([MIDTERM, FINALS], null), 81.6);
  near(subjectOverall([MIDTERM], null), 95.2);
  const empty: PeriodInput = { key: 'z', name: 'Z', target: 85, categories: [cat({ key: 'a', weight: 100 })] };
  assert.equal(subjectOverall([empty], null), null);
});

test('collective pools categories at their own weights', () => {
  const a: PeriodInput = { key: 'a', name: 'A', target: 85, categories: [cat({ key: 'x', weight: 10, graded: [100] })] };
  const b: PeriodInput = { key: 'b', name: 'B', target: 85, categories: [cat({ key: 'y', weight: 90, graded: [50] })] };
  near(subjectFinal([a, b], 'collective'), 55);
  near(subjectFinal([a, b], 'average'), 75);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/sp-test.mjs projection`
Expected: FAIL. The module import fails because `projection.mjs` does not exist yet.

- [ ] **Step 3: Implement**

`src/lib/studypulse/projection.ts`:
```ts
/* Deterministic grade projection (spec §4). Pure: no React, no fetch, no DB.
   A period's grade after every remaining item scores x is linear: G(x) = a + b·x. */
import { SCALE_4PT_ROWS, SCALE_1PT_ROWS, type GradeScale } from '@/lib/gradeScale';

export interface CategoryInput {
  key: string;
  name: string;
  weight: number;
  color: string;
  /** Per-entry percentages already earned (transmuted when transmutation is on). */
  graded: number[];
  /** Ungraded entries already in the table, in table order. */
  pendingNames: string[];
  /** User-defined projected items (>= 0). Ignored for singletons. */
  extra: number;
  singleton: boolean;
  /** Singular noun for planned-slot names ("Quiz" -> "Quiz 5"). */
  noun: string;
}

export interface PeriodInput {
  key: string;
  name: string;
  target: number;
  categories: CategoryInput[];
}

export interface CategoryStats extends CategoryInput {
  n: number;
  sum: number;
  k: number;
  avg: number | null;
  /** weight / W over active categories (n + k > 0); 0 when inactive. */
  share: number;
}

export type Tone = 'success' | 'warn' | 'danger' | 'neutral';
export type StatusKind = 'empty' | 'locked-in' | 'achievable' | 'stretch' | 'out-of-reach';
export interface ProjectionStatus { kind: StatusKind; tone: Tone; label: string }

export interface PeriodProjection {
  categories: CategoryStats[];
  a: number;
  b: number;
  /** Graded-only weighted average (spec D11); null when nothing is graded. */
  current: number | null;
  /** Percent of the period's grade already earned (0..100). */
  coverage: number;
  /** Uniform score needed on every remaining item; null when nothing remains. */
  need: number | null;
  worst: number;
  best: number;
  remaining: number;
  status: ProjectionStatus;
}

export interface Threshold { min: number; label: string }

const round1 = (v: number) => Math.round(v * 10) / 10;

function statusOf(need: number | null, current: number | null, target: number): ProjectionStatus {
  if (need === null) {
    if (current === null) return { kind: 'empty', tone: 'neutral', label: 'Nothing to plan' };
    return current >= target
      ? { kind: 'locked-in', tone: 'success', label: 'Locked in' }
      : { kind: 'out-of-reach', tone: 'danger', label: 'Out of reach' };
  }
  if (need <= 0) return { kind: 'locked-in', tone: 'success', label: 'Locked in' };
  if (need <= 85) return { kind: 'achievable', tone: 'success', label: 'Achievable' };
  if (need <= 100) return { kind: 'stretch', tone: 'warn', label: 'Stretch' };
  return { kind: 'out-of-reach', tone: 'danger', label: 'Out of reach' };
}

export function projectPeriod(p: PeriodInput): PeriodProjection {
  const raw = p.categories.map(c => {
    const extra = c.singleton ? 0 : Math.max(0, Math.floor(c.extra));
    const pendingNames = c.singleton ? c.pendingNames.slice(0, c.graded.length ? 0 : 1) : c.pendingNames;
    const n = c.graded.length;
    const sum = c.graded.reduce((s, g) => s + g, 0);
    const k = pendingNames.length + extra;
    return { ...c, extra, pendingNames, n, sum, k, avg: n ? sum / n : null };
  });
  const W = raw.reduce((s, c) => s + (c.n + c.k > 0 ? Math.max(0, c.weight) : 0), 0);
  const categories: CategoryStats[] = raw.map(c => ({
    ...c, share: W > 0 && c.n + c.k > 0 ? Math.max(0, c.weight) / W : 0,
  }));

  let a = 0, b = 0, cov = 0;
  for (const c of categories) {
    if (c.share === 0) continue;
    a += (c.share * c.sum) / (c.n + c.k);
    b += (c.share * c.k) / (c.n + c.k);
    cov += (c.share * c.n) / (c.n + c.k);
  }
  const graded = categories.filter(c => c.n > 0 && c.weight > 0);
  const gw = graded.reduce((s, c) => s + c.weight, 0);
  const current = gw > 0 ? graded.reduce((s, c) => s + c.weight * (c.avg as number), 0) / gw : null;
  const need = b > 1e-12 ? (p.target - a) / b : null;
  return {
    categories, a, b, current, coverage: cov * 100, need,
    worst: a, best: a + b * 100,
    remaining: categories.reduce((s, c) => s + c.k, 0),
    status: statusOf(need, current, p.target),
  };
}

export const gradeAt = (proj: PeriodProjection, x: number): number => proj.a + proj.b * x;

/** Period grade when each category's remaining items score `slots[i]` (one value per remaining item). */
export function planOutcome(proj: PeriodProjection, slots: number[][]): number {
  let t = 0;
  proj.categories.forEach((c, i) => {
    if (c.share === 0) return;
    const extra = (slots[i] ?? []).slice(0, c.k).reduce((s, v) => s + v, 0);
    t += (c.share * (c.sum + extra)) / (c.n + c.k);
  });
  return t;
}

/** Score needed on category i's remaining items if every OTHER remaining item holds the current average. */
export function soloNeed(proj: PeriodProjection, target: number, i: number): number | null {
  const c = proj.categories[i];
  if (!c || c.k === 0 || c.share === 0) return null;
  const P = proj.current ?? target;
  let others = 0;
  proj.categories.forEach((o, j) => {
    if (j === i || o.share === 0) return;
    others += (o.share * (o.sum + o.k * P)) / (o.n + o.k);
  });
  const needAvg = (target - others) / c.share;
  return (needAvg * (c.n + c.k) - c.sum) / c.k;
}

export const SCENARIO_INPUTS = [60, 70, 80, 90, 100] as const;

export function scenarios(proj: PeriodProjection): Array<{ input: number; result: number }> {
  const xs: number[] = [...SCENARIO_INPUTS];
  if (proj.need !== null && proj.need > 0 && proj.need < 100) {
    const nv = round1(proj.need);
    if (!xs.some(x => Math.abs(x - nv) < 0.05)) {
      let idx = 0;
      xs.forEach((x, i) => { if (Math.abs(x - nv) < Math.abs(xs[idx] - nv)) idx = i; });
      xs[idx] = nv;
      xs.sort((p, q) => p - q);
    }
  }
  return xs.map(input => ({ input, result: gradeAt(proj, input) }));
}

/** Letter/point thresholds above 0, highest first. No scale: plain numeric marks. */
export function scaleThresholds(scale: GradeScale | null): Threshold[] {
  if (scale === '4pt') return SCALE_4PT_ROWS.filter(r => r.min > 0).map(r => ({ min: r.min, label: r.letter }));
  if (scale === '1pt') return SCALE_1PT_ROWS.filter(r => r.min > 0).map(r => ({ min: r.min, label: r.point.toFixed(2) }));
  return [90, 80, 70, 60].map(m => ({ min: m, label: String(m) }));
}

/** Up to three thresholds below the target that are still reachable, with the uniform score each needs. */
export function closestReachable(proj: PeriodProjection, target: number, scale: GradeScale | null): Array<Threshold & { need: number }> {
  if (proj.b <= 1e-12) return [];
  return scaleThresholds(scale)
    .filter(t => t.min < target && t.min <= proj.best + 1e-9)
    .slice(0, 3)
    .map(t => ({ ...t, need: (t.min - proj.a) / proj.b }));
}

export function targetPresets(scale: GradeScale | null): Array<{ label: string; value: number }> {
  if (scale === '4pt') return [
    { label: 'A', value: 97 }, { label: 'B+', value: 93 }, { label: 'B', value: 89 },
    { label: 'C+', value: 85 }, { label: 'C', value: 80 }, { label: 'Pass', value: 70 },
  ];
  if (scale === '1pt') return [
    { label: '1.00', value: 96 }, { label: '1.50', value: 92 }, { label: '2.00', value: 87 },
    { label: '2.50', value: 82 }, { label: '3.00', value: 75 },
  ];
  return [90, 85, 80, 75].map(v => ({ label: String(v), value: v }));
}

export function outcomeTone(delta: number): Exclude<Tone, 'neutral'> {
  if (delta >= -0.05) return 'success';
  if (delta >= -3) return 'warn';
  return 'danger';
}

/** The value an untouched sandbox slot shows: the requirement, clamped and rounded. */
export function defaultSlotValue(proj: PeriodProjection): number {
  if (proj.need === null) return 100;
  return Math.max(0, Math.min(100, round1(proj.need)));
}

/** Pooled graded-only average over every category of every period, each at its own weight. */
export function collectiveCurrent(periods: PeriodInput[]): number | null {
  let ws = 0, w = 0;
  for (const p of periods) for (const c of p.categories) {
    if (!c.graded.length || c.weight <= 0) continue;
    ws += c.weight * (c.graded.reduce((s, g) => s + g, 0) / c.graded.length);
    w += c.weight;
  }
  return w > 0 ? ws / w : null;
}

function meanOfCurrents(periods: PeriodInput[]): number | null {
  const cs = periods.map(p => projectPeriod(p).current).filter((v): v is number => v !== null);
  return cs.length ? cs.reduce((s, v) => s + v, 0) / cs.length : null;
}

/** The preset's Final Grade (spec §4.4); null when the preset defines none. */
export function subjectFinal(periods: PeriodInput[], mode: 'average' | 'collective' | null): number | null {
  if (mode === 'collective') return collectiveCurrent(periods);
  if (mode === 'average') return meanOfCurrents(periods);
  return null;
}

/** One number for a subject card: the Final Grade when defined, else the mean of period currents. */
export function subjectOverall(periods: PeriodInput[], mode: 'average' | 'collective' | null): number | null {
  return mode ? subjectFinal(periods, mode) : meanOfCurrents(periods);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/sp-test.mjs projection`
Expected: all 16 tests pass. If a hand value is off by more than the tolerance, recheck the formula against spec §4.2. **Do not loosen the tolerance.**

- [ ] **Step 5: Typecheck and snapshot**

Run: `npx tsc --noEmit`. Expected: 0 errors.
`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t1 "sp: projection engine + tests"`

---

### Task 2: Types, prefs, period model, grade and format helpers (TDD)

**Files:**
- Create: `src/lib/studypulse/types.ts`, `src/lib/studypulse/prefs.ts`, `src/lib/studypulse/periodModel.ts`, `src/lib/studypulse/grades.ts`, `src/lib/studypulse/ui/colors.ts`, `src/lib/studypulse/ui/format.ts`
- Test: `src/lib/studypulse/__tests__/{prefs,periodModel,grades,format}.test.ts`
- Modify: `src/components/studypulse/SubjectCardView.tsx`. Replace its local `Urgency`, `EntryStatus`, `EntryRow` and `GradingConfig` declarations (the `/* ── Types ── */` block) with re-exports. Replace its local `calcGrade` with an import.

**Interfaces:**
- Consumes: `CategoryInput`, `PeriodInput` (Task 1); `transmute`, `TransmutationTable` from `@/lib/transmutation`; `GradingPresetFull` (type only) from `@/components/studypulse/GradingSetupWizard`.
- Produces:
  - `types.ts`: `EntryRow`, `Urgency`, `EntryStatus`, `GradingConfig`, `PresetLike`, `SubjectCardData`.
  - `prefs.ts`: `ProjectionPrefs`, `EMPTY_PREFS`, `DEFAULT_TARGET`, `parsePrefKey(key)`, `clampPrefValue(kind, v)`, `rowsToPrefs(rows)`, `extraKey(catKey)`, `targetKey(periodKey)`.
  - `periodModel.ts`: `entryHasGrade(e)`, `entryValue(e, table)`, `nounFor(name)`, `buildCustomPeriods(preset, catEntries, prefs, table)`, `buildLegacyPeriods(acts, quizzes, exams, prefs, table)`, `legacyMidtermPeriod(overall)`, `averageOf(entries, table)`.
  - `grades.ts`: `calcGrade(score, items)`.
  - `ui/colors.ts`: `CATEGORY_COLORS`, `categoryColor(i)`.
  - `ui/format.ts`: `f1`, `gradeTone`, `GradeTone`, `todayManila`, `shortDate`, `dueNote`, `submittedNote`.

- [ ] **Step 1: Write the failing tests**

`src/lib/studypulse/__tests__/prefs.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrefKey, clampPrefValue, rowsToPrefs, extraKey, targetKey } from '../prefs';

test('parsePrefKey accepts only extra:/target: with safe ids', () => {
  assert.deepEqual(parsePrefKey('extra:c12'), { kind: 'extra', id: 'c12' });
  assert.deepEqual(parsePrefKey('target:overall'), { kind: 'target', id: 'overall' });
  assert.deepEqual(parsePrefKey('extra:legacy-quizzes'), { kind: 'extra', id: 'legacy-quizzes' });
  assert.equal(parsePrefKey('extra:C12'), null);
  assert.equal(parsePrefKey('foo:c1'), null);
  assert.equal(parsePrefKey('extra:'), null);
  assert.equal(parsePrefKey(42), null);
  assert.equal(extraKey('c3'), 'extra:c3');
  assert.equal(targetKey('p9'), 'target:p9');
});

test('clampPrefValue', () => {
  assert.equal(clampPrefValue('extra', 3.6), 4);
  assert.equal(clampPrefValue('extra', -2), 0);
  assert.equal(clampPrefValue('extra', 99), 50);
  assert.equal(clampPrefValue('target', 89.25), 89.3);
  assert.equal(clampPrefValue('target', 140), 100);
  assert.equal(clampPrefValue('target', Number.NaN), null);
});

test('rowsToPrefs splits keys and ignores junk', () => {
  assert.deepEqual(
    rowsToPrefs([{ key: 'extra:c1', value: 2 }, { key: 'target:p1', value: 89 }, { key: 'bad', value: 1 }]),
    { extras: { c1: 2 }, targets: { p1: 89 } },
  );
});
```

`src/lib/studypulse/__tests__/grades.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcGrade } from '../grades';

test('calcGrade', () => {
  assert.equal(calcGrade('24', '25'), 96);
  assert.equal(calcGrade('2', '3'), 66.67);
  assert.equal(calcGrade('', '25'), null);
  assert.equal(calcGrade('5', '0'), null);
  assert.equal(calcGrade('x', '10'), null);
});
```

`src/lib/studypulse/__tests__/format.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { f1, gradeTone, todayManila, shortDate, dueNote, submittedNote } from '../ui/format';

test('f1 and gradeTone', () => {
  assert.equal(f1(87.19), '87.2');
  assert.equal(f1(100), '100.0');
  assert.equal(gradeTone(null), 'none');
  assert.equal(gradeTone(75), 'success');
  assert.equal(gradeTone(70), 'warn');
  assert.equal(gradeTone(64.9), 'danger');
});

test('todayManila uses Asia/Manila, not UTC', () => {
  // 2026-10-21T17:30Z is already Oct 22 in Manila (UTC+8).
  assert.equal(todayManila(new Date('2026-10-21T17:30:00Z')), '2026-10-22');
});

test('shortDate omits the current year only', () => {
  assert.equal(shortDate('2026-09-04', '2026-10-22'), 'Sep 4');
  assert.equal(shortDate('2025-12-01', '2026-10-22'), 'Dec 1, 2025');
});

test('dueNote', () => {
  const T = '2026-10-22';
  assert.deepEqual(dueNote('2026-10-22', T, false), { text: 'today', tone: 'warn' });
  assert.deepEqual(dueNote('2026-10-23', T, false), { text: 'tomorrow', tone: 'warn' });
  assert.deepEqual(dueNote('2026-10-27', T, false), { text: 'in 5 days', tone: 'muted' });
  assert.equal(dueNote('2026-11-10', T, false), null);
  assert.deepEqual(dueNote('2026-10-20', T, false), { text: '2 days overdue', tone: 'danger' });
  assert.equal(dueNote('2026-10-20', T, true), null);
  assert.equal(dueNote('', T, false), null);
});

test('submittedNote', () => {
  assert.deepEqual(submittedNote('2026-09-04', '2026-09-04'), { text: 'on time', tone: 'muted' });
  assert.deepEqual(submittedNote('2026-09-18', '2026-09-19'), { text: '1 day late', tone: 'danger' });
  assert.deepEqual(submittedNote('2026-09-18', '2026-09-21'), { text: '3 days late', tone: 'danger' });
  assert.equal(submittedNote('', '2026-09-21'), null);
});
```

`src/lib/studypulse/__tests__/periodModel.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entryHasGrade, entryValue, nounFor, buildCustomPeriods, buildLegacyPeriods, legacyMidtermPeriod, averageOf,
} from '../periodModel';
import { projectPeriod } from '../projection';
import { EMPTY_PREFS } from '../prefs';
import type { EntryRow, PresetLike } from '../types';

const row = (o: Partial<EntryRow>): EntryRow => ({
  id: 1, name: 'x', specificType: '', urgency: 'Low', status: 'Pending', deadline: '', accomplished_at: '',
  score: '', items: '', grade: null, ...o,
});

const PRESET: PresetLike = {
  final_mode: 'average', final_period_id: null,
  periods: [
    { period_id: 1, name: 'Midterm', sort_order: 0, categories: [
      { cat_id: 10, name: 'Quizzes', weight: 36, is_singleton: 0, sort_order: 0, link_group: null, carry_score: 1 },
      { cat_id: 11, name: 'Tasks', weight: 24, is_singleton: 0, sort_order: 1, link_group: null, carry_score: 1 },
      { cat_id: 12, name: 'Midterm Exam', weight: 40, is_singleton: 1, sort_order: 2, link_group: 'lg-1', carry_score: 1 },
    ] },
    { period_id: 2, name: 'Finals', sort_order: 1, categories: [
      { cat_id: 20, name: 'Quizzes', weight: 36, is_singleton: 0, sort_order: 0, link_group: null, carry_score: 1 },
      { cat_id: 22, name: 'Midterm Exam', weight: 15, is_singleton: 1, sort_order: 1, link_group: 'lg-1', carry_score: 1 },
    ] },
  ],
};

test('entryHasGrade / entryValue', () => {
  assert.equal(entryHasGrade(row({ grade: 90 })), true);
  assert.equal(entryHasGrade(row({ score: '8', items: '10' })), true);
  assert.equal(entryHasGrade(row({})), false);
  assert.equal(entryValue(row({ grade: 90 }), null), 90);
  assert.equal(entryValue(row({ score: '8', items: '10' }), null), 80);
  // transmutation table: score 8 of max 10 -> 85
  assert.equal(entryValue(row({ score: '8', items: '10', grade: 80 }), { 8: { 10: 85 } }), 85);
});

test('nounFor', () => {
  assert.equal(nounFor('Quizzes'), 'Quiz');
  assert.equal(nounFor('Activities'), 'Activity');
  assert.equal(nounFor('Tasks'), 'Task');
  assert.equal(nounFor('Midterm Exam'), 'Midterm Exam');
  assert.equal(nounFor('Class'), 'Class');
});

test('custom periods: keys, colours, pending names, extras, targets', () => {
  const periods = buildCustomPeriods(PRESET, {
    10: [row({ grade: 96 }), row({ grade: 88 }), row({ name: 'Quiz 3', grade: null })],
    11: [],
    12: [],
  }, { extras: { c11: 3, c12: 4 }, targets: { p1: 89 } }, null);
  const mid = periods[0];
  assert.equal(mid.key, 'p1');
  assert.equal(mid.target, 89);
  assert.equal(periods[1].target, 85);
  assert.deepEqual(mid.categories.map(c => c.key), ['c10', 'c11', 'c12']);
  assert.deepEqual(mid.categories[0].pendingNames, ['Quiz 3']);
  assert.equal(mid.categories[1].extra, 3);
  assert.equal(mid.categories[1].noun, 'Task');
  // empty singleton is one implicit remaining item named after the category; extra ignored
  assert.deepEqual(mid.categories[2].pendingNames, ['Midterm Exam']);
  assert.equal(mid.categories[2].extra, 0);
  assert.notEqual(mid.categories[0].color, mid.categories[1].color);
});

test('linked carry singleton borrows the first scored sibling', () => {
  const periods = buildCustomPeriods(PRESET, { 10: [], 11: [], 12: [row({ grade: 82 })], 20: [], 22: [] }, EMPTY_PREFS, null);
  const fin = periods[1].categories[1];
  assert.deepEqual(fin.graded, [82]);
  assert.deepEqual(fin.pendingNames, []);
});

test('legacy: all graded equals the old finals formula', () => {
  const [overall] = buildLegacyPeriods(
    [row({ grade: 90 })], [row({ grade: 80 })],
    [row({ grade: 70, specificType: 'Midterm' }), row({ grade: 60, specificType: 'Final Exam' })],
    EMPTY_PREFS, null,
  );
  assert.equal(overall.key, 'overall');
  const cur = projectPeriod(overall).current as number;
  assert.ok(Math.abs(cur - 75.9) < 1e-9, String(cur)); // (24·90 + 36·80 + 15·70 + 25·60) / 100
});

test('legacy: missing exams are implicit remaining items; midterm view re-weights to 40', () => {
  const [overall] = buildLegacyPeriods([row({ grade: 90 })], [], [], EMPTY_PREFS, null);
  assert.deepEqual(overall.categories.map(c => c.key), ['legacy-activities', 'legacy-quizzes', 'legacy-midterm', 'legacy-final']);
  assert.deepEqual(overall.categories[2].pendingNames, ['Midterm Exam']);
  const mid = legacyMidtermPeriod(overall);
  assert.deepEqual(mid.categories.map(c => [c.key, c.weight]), [['legacy-activities', 24], ['legacy-quizzes', 36], ['legacy-midterm', 40]]);
});

test('averageOf', () => {
  assert.equal(averageOf([row({ grade: 90 }), row({ grade: 80 }), row({})], null), 85);
  assert.equal(averageOf([row({})], null), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/sp-test.mjs`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement the modules**

`src/lib/studypulse/types.ts`:
```ts
/* Shared StudyPulse types. Moved out of SubjectCardView.tsx so server code and pure libs can use them. */
import type { GradeScale } from '@/lib/gradeScale';
import type { GradingPresetFull } from '@/components/studypulse/GradingSetupWizard';

export type Urgency = 'High' | 'Medium' | 'Low';
export type EntryStatus = 'Pending' | 'Done';

export interface EntryRow {
  id: number;
  name: string;
  specificType: string;
  urgency: Urgency;
  status: EntryStatus;
  deadline: string;
  accomplished_at: string;
  score: string;
  items: string;
  grade: number | null;
  canvas_linked?: boolean;
  saving?: boolean;
}

export interface GradingConfig {
  preset_id: number;
  has_lab: number;
  lec_weight: number;
  lab_weight: number;
  grade_scale: GradeScale | null;
  preset: GradingPresetFull;
}

export type PresetLike = Pick<GradingPresetFull, 'periods' | 'final_mode' | 'final_period_id'>;

export interface SubjectCardData {
  user_subject_id: number;
  subject_name: string;
  course_code: string;
  section?: string | null;
  units: number;
  year_level: string;
  trimester: string;
  completed_tasks: number;
  total_tasks: number;
  progress_percent: number;
  /** Overall current grade (spec §6.1); null when nothing is graded. */
  current_grade: number | null;
  grade_scale: GradeScale | null;
}
```

`src/lib/studypulse/prefs.ts`:
```ts
/* Saved planner preferences (spec §3.3): extra projected items per category and a target per period. */
export interface ProjectionPrefs {
  extras: Record<string, number>;   // catKey -> extra count
  targets: Record<string, number>;  // periodKey -> target %
}
export const EMPTY_PREFS: ProjectionPrefs = { extras: {}, targets: {} };
export const DEFAULT_TARGET = 85;

export type PrefKind = 'extra' | 'target';
const KEY_RE = /^(extra|target):([a-z0-9-]{1,40})$/;

export const extraKey = (catKey: string) => `extra:${catKey}`;
export const targetKey = (periodKey: string) => `target:${periodKey}`;

export function parsePrefKey(key: unknown): { kind: PrefKind; id: string } | null {
  if (typeof key !== 'string') return null;
  const m = KEY_RE.exec(key);
  return m ? { kind: m[1] as PrefKind, id: m[2] } : null;
}

export function clampPrefValue(kind: PrefKind, v: number): number | null {
  if (!Number.isFinite(v)) return null;
  if (kind === 'extra') return Math.min(50, Math.max(0, Math.round(v)));
  return Math.min(100, Math.max(0, Math.round(v * 10) / 10));
}

export function rowsToPrefs(rows: Array<{ key: string; value: number }>): ProjectionPrefs {
  const out: ProjectionPrefs = { extras: {}, targets: {} };
  for (const r of rows) {
    const p = parsePrefKey(r.key);
    if (!p) continue;
    if (p.kind === 'extra') out.extras[p.id] = r.value;
    else out.targets[p.id] = r.value;
  }
  return out;
}
```

`src/lib/studypulse/grades.ts`:
```ts
/** Raw percentage from a score and item count, 2 decimals; null when not computable. */
export function calcGrade(score: string, items: string): number | null {
  const s = parseFloat(score);
  const i = parseFloat(items);
  if (!score || isNaN(s) || isNaN(i) || i <= 0) return null;
  return parseFloat(((s / i) * 100).toFixed(2));
}
```

`src/lib/studypulse/ui/colors.ts`:
```ts
/* Category colour cycle (spec §5). The same colour is used for the weight bar, the category swatch
   and the planner dot. The only hex literals StudyPulse TS may contain live here. */
export const CATEGORY_COLORS = ['#8b7fd6', '#74bcd9', '#f2a7c0', '#f0a35c', '#6bb58a', '#8a94a6'] as const;
export const categoryColor = (i: number): string => CATEGORY_COLORS[((i % CATEGORY_COLORS.length) + CATEGORY_COLORS.length) % CATEGORY_COLORS.length];
```

`src/lib/studypulse/ui/format.ts`:
```ts
/* Display helpers shared by the subject page and the planner. Pure. */
export const f1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

export type GradeTone = 'success' | 'warn' | 'danger' | 'none';
/** Same bands the old gradeStyle() used: >= 75 success, >= 65 warn, else danger. */
export function gradeTone(g: number | null): GradeTone {
  if (g === null) return 'none';
  if (g >= 75) return 'success';
  if (g >= 65) return 'warn';
  return 'danger';
}

/** YYYY-MM-DD for "today" in Manila. Raw UTC dates are a known bug source in this repo. */
export function todayManila(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toUTC = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const dayDiff = (a: string, b: string) => Math.round((toUTC(a) - toUTC(b)) / 86_400_000);

export function shortDate(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  return String(y) === today.slice(0, 4) ? base : `${base}, ${y}`;
}

export interface DateNote { text: string; tone: 'muted' | 'warn' | 'danger' }

/** Relative context under a due date, for unfinished rows only. */
export function dueNote(deadline: string, today: string, done: boolean): DateNote | null {
  if (!deadline || done) return null;
  const diff = dayDiff(deadline, today);
  if (diff < 0) return { text: diff === -1 ? '1 day overdue' : `${-diff} days overdue`, tone: 'danger' };
  if (diff === 0) return { text: 'today', tone: 'warn' };
  if (diff === 1) return { text: 'tomorrow', tone: 'warn' };
  if (diff <= 7) return { text: `in ${diff} days`, tone: 'muted' };
  return null;
}

export function submittedNote(deadline: string, accomplished: string): DateNote | null {
  if (!deadline || !accomplished) return null;
  const late = dayDiff(accomplished, deadline);
  if (late <= 0) return { text: 'on time', tone: 'muted' };
  return { text: late === 1 ? '1 day late' : `${late} days late`, tone: 'danger' };
}
```

`src/lib/studypulse/periodModel.ts`:
```ts
/* Builds projection input from StudyPulse data (spec §4.4). Pure. */
import type { CategoryInput, PeriodInput } from './projection';
import { transmute, type TransmutationTable } from '@/lib/transmutation';
import { categoryColor } from './ui/colors';
import { DEFAULT_TARGET, type ProjectionPrefs } from './prefs';
import type { EntryRow, PresetLike } from './types';

type EntryLike = Pick<EntryRow, 'name' | 'score' | 'items' | 'grade'> & { specificType?: string };

export function entryHasGrade(e: EntryLike): boolean {
  return e.grade !== null || (!!e.score && !!e.items);
}

/** The entry's percentage: transmuted when a table is given and applies, else its grade, else score/items. */
export function entryValue(e: EntryLike, table: TransmutationTable | null): number | null {
  if (table) {
    const t = transmute(e.score, e.items, table);
    if (t !== null) return t;
  }
  if (e.grade !== null) return Number(e.grade);
  const s = parseFloat(e.score), i = parseFloat(e.items);
  return Number.isFinite(s) && Number.isFinite(i) && i > 0 ? (s / i) * 100 : null;
}

export function averageOf(entries: EntryLike[], table: TransmutationTable | null): number | null {
  const vals = entries.filter(entryHasGrade).map(e => entryValue(e, table)).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

export function nounFor(categoryName: string): string {
  const n = categoryName.trim();
  if (/zzes$/i.test(n)) return n.slice(0, -3);          // Quizzes -> Quiz
  if (/ies$/i.test(n)) return n.slice(0, -3) + 'y';     // Activities -> Activity
  if (/[^s]s$/i.test(n)) return n.slice(0, -1);         // Tasks -> Task (not "Class")
  return n;
}

function split(entries: EntryLike[], table: TransmutationTable | null) {
  const graded: number[] = [];
  const pending: string[] = [];
  for (const e of entries) {
    if (entryHasGrade(e)) {
      const v = entryValue(e, table);
      if (v !== null) graded.push(v);
    } else {
      pending.push(e.name.trim() || 'Untitled');
    }
  }
  return { graded, pending };
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

function category(
  key: string, name: string, weight: number, index: number, singleton: boolean,
  graded: number[], pending: string[], prefs: ProjectionPrefs,
): CategoryInput {
  // A singleton is one score: once graded nothing remains; ungraded it is exactly one item.
  const pendingNames = singleton ? (graded.length ? [] : [pending[0] ?? name]) : pending;
  return {
    key, name, weight, color: categoryColor(index), graded, pendingNames,
    extra: singleton ? 0 : Math.max(0, prefs.extras[key] ?? 0),
    singleton, noun: singleton ? name : nounFor(name),
  };
}

export function buildCustomPeriods(
  preset: PresetLike,
  catEntries: Record<number, EntryLike[]>,
  prefs: ProjectionPrefs,
  table: TransmutationTable | null,
): PeriodInput[] {
  // Linked carry-forward source: the first category in preset order with its own graded score.
  const source: Record<string, number> = {};
  for (const p of preset.periods) for (const c of p.categories) {
    const { graded } = split(catEntries[c.cat_id] ?? [], table);
    if (c.link_group && graded.length && !(c.link_group in source)) source[c.link_group] = mean(graded);
  }
  return preset.periods.map(p => ({
    key: `p${p.period_id}`,
    name: p.name,
    target: prefs.targets[`p${p.period_id}`] ?? DEFAULT_TARGET,
    categories: p.categories.map((c, i) => {
      const singleton = Number(c.is_singleton) === 1;
      let { graded, pending } = split(catEntries[c.cat_id] ?? [], table);
      if (!graded.length && singleton && Number(c.carry_score) === 1 && c.link_group && c.link_group in source) {
        graded = [source[c.link_group]];
        pending = [];
      }
      return category(`c${c.cat_id}`, c.name, Number(c.weight), i, singleton, graded, pending, prefs);
    }),
  }));
}

export function buildLegacyPeriods(
  activities: EntryLike[], quizzes: EntryLike[], exams: EntryLike[],
  prefs: ProjectionPrefs, table: TransmutationTable | null,
): PeriodInput[] {
  const a = split(activities, table);
  const q = split(quizzes, table);
  const m = split(exams.filter(e => e.specificType === 'Midterm'), table);
  const f = split(exams.filter(e => e.specificType === 'Final Exam'), table);
  return [{
    key: 'overall',
    name: 'Overall',
    target: prefs.targets.overall ?? DEFAULT_TARGET,
    categories: [
      category('legacy-activities', 'Activities', 24, 0, false, a.graded, a.pending, prefs),
      category('legacy-quizzes', 'Quizzes', 36, 1, false, q.graded, q.pending, prefs),
      category('legacy-midterm', 'Midterm Exam', 15, 2, true, m.graded, m.pending, prefs),
      category('legacy-final', 'Final Exam', 25, 3, true, f.graded, f.pending, prefs),
    ],
  }];
}

/** The legacy calculator's "Midterm" view: Activities 24 + Quizzes 36 + Midterm Exam 40. */
export function legacyMidtermPeriod(overall: PeriodInput): PeriodInput {
  return {
    ...overall,
    key: 'midterm-view',
    categories: overall.categories
      .filter(c => c.key !== 'legacy-final')
      .map(c => (c.key === 'legacy-midterm' ? { ...c, weight: 40 } : c)),
  };
}
```

- [ ] **Step 4: Point SubjectCardView at the shared types**

In `src/components/studypulse/SubjectCardView.tsx`, replace the whole `/* ── Types ── */` block (the `Urgency` and `EntryStatus` lines, the `EntryRow` interface and the `GradingConfig` interface) with the following. Keep `GradeMode` and `SectionType`, which are still local:
```ts
import type { EntryRow, GradingConfig } from '@/lib/studypulse/types';
export type { EntryRow, GradingConfig, Urgency, EntryStatus } from '@/lib/studypulse/types';
export type GradeMode   = 'finals' | 'midterm' | 'whatif';
export type SectionType = 'activities' | 'quizzes' | 'exams';
```
Delete the local `function calcGrade(...)` and add `import { calcGrade } from '@/lib/studypulse/grades';`. Remove `type GradeScale` from the `gradeScale` import if it becomes unused. `[id]/page.tsx` and `TargetGradePanel.tsx` keep importing these types from `./SubjectCardView`, which now re-exports them.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `node scripts/sp-test.mjs`. Expected: every suite passes (projection 16, prefs 3, grades 1, format 5, periodModel 7).
Run: `npx tsc --noEmit`. Expected: 0 errors.

- [ ] **Step 6: Snapshot**

`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t2 "sp: types, prefs, period model, format helpers + tests"`

---

### Task 3: Prefs table and API

**Files:**
- Modify: `src/lib/migrate.ts` (append one function and one flag)
- Create: `src/app/api/studypulse/projection-prefs/route.ts`

**Interfaces:**
- Consumes: `parsePrefKey`, `clampPrefValue`, `rowsToPrefs` (Task 2).
- Produces:
  - `GET /api/studypulse/projection-prefs?user_subject_id=N` → `ProjectionPrefs` JSON.
  - `PUT /api/studypulse/projection-prefs` with body `{ user_subject_id, key, value }` → `{ status: 'success', key, value }`.
  - Status codes: 400 for a bad key or value, 401 when unauthenticated, 404 when the subject isn't the user's.

- [ ] **Step 1: Add the migration**

In `src/lib/migrate.ts`, add `let _ranProjectionPrefs = false;` after `let _ranFinanceWishlist = false;`, and append at the end of the file:
```ts
/** StudyPulse revamp (spec §3.3): saved planner extras and targets, keyed by subject (presets are shared). */
export async function ensureProjectionPrefsSchema(): Promise<void> {
  if (_ranProjectionPrefs) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS studypulse_projection_prefs (
      user_subject_id INT NOT NULL,
      pref_key        VARCHAR(48) NOT NULL,
      value           DECIMAL(6,2) NOT NULL,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_subject_id, pref_key)
    )`);
  _ranProjectionPrefs = true;
}
```

- [ ] **Step 2: Add the route**

`src/app/api/studypulse/projection-prefs/route.ts`:
```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import { ensureProjectionPrefsSchema } from '@/lib/migrate';
import type { RowDataPacket } from 'mysql2';
import { parsePrefKey, clampPrefValue, rowsToPrefs } from '@/lib/studypulse/prefs';

async function ownsSubject(userId: number, userSubjectId: number): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM user_subjects WHERE user_subject_id=? AND user_id=?', [userSubjectId, userId],
  );
  return rows.length > 0;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userSubjectId = Number(req.nextUrl.searchParams.get('user_subject_id'));
  if (!Number.isInteger(userSubjectId) || userSubjectId <= 0) return Response.json({ error: 'user_subject_id required' }, { status: 400 });
  if (!(await ownsSubject(parseInt(session.user.id), userSubjectId))) return Response.json({ error: 'Not found' }, { status: 404 });

  await ensureProjectionPrefsSchema();
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT pref_key, value FROM studypulse_projection_prefs WHERE user_subject_id=?', [userSubjectId],
  );
  return Response.json(rowsToPrefs(rows.map(r => ({ key: String(r.pref_key), value: Number(r.value) }))));
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as { user_subject_id?: unknown; key?: unknown; value?: unknown } | null;
  const userSubjectId = Number(body?.user_subject_id);
  const parsed = parsePrefKey(body?.key);
  if (!Number.isInteger(userSubjectId) || userSubjectId <= 0 || !parsed) return Response.json({ error: 'Invalid key' }, { status: 400 });
  const value = clampPrefValue(parsed.kind, Number(body?.value));
  if (value === null) return Response.json({ error: 'Invalid value' }, { status: 400 });
  if (!(await ownsSubject(parseInt(session.user.id), userSubjectId))) return Response.json({ error: 'Not found' }, { status: 404 });

  await ensureProjectionPrefsSchema();
  await pool.execute(
    `INSERT INTO studypulse_projection_prefs (user_subject_id, pref_key, value) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE value=VALUES(value)`,
    [userSubjectId, body!.key as string, value],
  );
  return Response.json({ status: 'success', key: body!.key, value });
}
```

- [ ] **Step 3: Verify it compiles, then exercise it live**

Run: `npx tsc --noEmit`. Expected: 0 errors.

With the dev server running (`npm run dev`) and logged in through the Playwright browser, run in the page console via `browser_evaluate`. Use a real `user_subject_id` from `/studypulse/subjects`:
```js
await fetch('/api/studypulse/projection-prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_subject_id: ID, key: 'target:qa-probe', value: 88.25 }) }).then(r => r.json())
await fetch('/api/studypulse/projection-prefs?user_subject_id=ID').then(r => r.json())
await fetch('/api/studypulse/projection-prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_subject_id: ID, key: 'evil:x', value: 1 }) }).then(r => r.status)
```
Expected: `{status:'success', value: 88.3}`, then `targets['qa-probe'] === 88.3`, then `400`.

Remove the probe row afterwards from MySQL (`DELETE FROM studypulse_projection_prefs WHERE pref_key='target:qa-probe'`). It's harmless if left, but don't leave QA junk.

- [ ] **Step 4: Snapshot**

`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t3 "sp: projection prefs table + API"`

---

### Task 4: Server card grades (shared loader)

**Files:**
- Create: `src/lib/studypulse/subjectCards.ts`
- Modify: `src/app/studypulse/subjects/page.tsx` (the whole body, replaced by the loader)
- Modify: `src/app/api/studypulse/subjects/route.ts` (the `GET` handler only)
- Modify: `src/app/studypulse/[id]/page.tsx` (the `/* ── Try to load custom grading config ── */` block)

**Interfaces:**
- Consumes: `buildCustomPeriods`, `buildLegacyPeriods` (Task 2); `projectPeriod`, `subjectOverall` (Task 1); `EMPTY_PREFS`; `GradingConfig`, `SubjectCardData`.
- Produces:
  - `loadGradingConfig(userSubjectId): Promise<GradingConfig | null>`
  - `listSubjectCards(userId): Promise<SubjectCardData[]>`, which Task 6 consumes through `SubjectsGrid initialSubjects`.

- [ ] **Step 1: Create the loader**

`src/lib/studypulse/subjectCards.ts`:
```ts
/* Server-only StudyPulse loaders shared by /studypulse/subjects, GET /api/studypulse/subjects and
   /studypulse/[id]. Imports the DB pool, so it is excluded from scripts/sp-test.mjs. */
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { ensureSubjectSection } from '@/lib/migrate';
import { buildCustomPeriods, buildLegacyPeriods } from './periodModel';
import { projectPeriod, subjectOverall } from './projection';
import { EMPTY_PREFS } from './prefs';
import type { EntryRow, GradingConfig, SubjectCardData } from './types';

/** The subject's custom grading config, or null (no config, or grading tables not created yet). */
export async function loadGradingConfig(userSubjectId: number): Promise<GradingConfig | null> {
  try {
    const [sgRows] = await pool.execute<RowDataPacket[]>('SELECT * FROM subject_grading WHERE user_subject_id=?', [userSubjectId]);
    if (!sgRows.length) return null;
    const sg = sgRows[0];
    const presetId = sg.preset_id as number;
    const [presets] = await pool.execute<RowDataPacket[]>('SELECT * FROM grading_presets WHERE preset_id=?', [presetId]);
    if (!presets.length) return null;
    const [periods] = await pool.execute<RowDataPacket[]>('SELECT * FROM grading_periods WHERE preset_id=? ORDER BY sort_order', [presetId]);
    const [cats] = await pool.execute<RowDataPacket[]>(
      `SELECT gc.* FROM grading_categories gc
       JOIN grading_periods gp ON gc.period_id=gp.period_id
       WHERE gp.preset_id=? ORDER BY gc.period_id, gc.sort_order`, [presetId],
    );
    const preset = {
      ...presets[0],
      periods: periods.map(p => ({ ...p, categories: cats.filter(c => c.period_id === p.period_id) })),
    };
    return {
      preset_id: Number(sg.preset_id),
      has_lab: Number(sg.has_lab),
      lec_weight: Number(sg.lec_weight),
      lab_weight: Number(sg.lab_weight),
      grade_scale: ((preset as unknown as Record<string, unknown>).grade_scale as GradingConfig['grade_scale']) ?? '4pt',
      preset: preset as unknown as GradingConfig['preset'],
    };
  } catch {
    return null;
  }
}

type Lite = Pick<EntryRow, 'name' | 'score' | 'items' | 'grade'> & { specificType?: string };
const lite = (r: RowDataPacket): Lite => ({
  name: String(r.name ?? ''),
  score: r.score != null ? String(r.score) : '',
  items: r.items != null ? String(r.items) : '',
  grade: r.grade != null ? Number(r.grade) : null,
  specificType: r.specificType != null ? String(r.specificType) : '',
});

/** Overall current grade for a card. Raw grades only: the transmutation table is client-loaded. */
async function currentGradeFor(userSubjectId: number): Promise<Pick<SubjectCardData, 'current_grade' | 'grade_scale'>> {
  const config = await loadGradingConfig(userSubjectId);
  if (config) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT cat_id, name, score, items, grade FROM grade_entries WHERE user_subject_id=?', [userSubjectId],
    );
    const byCat: Record<number, Lite[]> = {};
    for (const r of rows) (byCat[r.cat_id as number] ??= []).push(lite(r));
    const periods = buildCustomPeriods(config.preset, byCat, EMPTY_PREFS, null);
    return { current_grade: subjectOverall(periods, config.preset.final_mode ?? null), grade_scale: config.grade_scale };
  }
  const [acts] = await pool.execute<RowDataPacket[]>('SELECT activity_name AS name, score, items, grade FROM activities WHERE user_subject_id=?', [userSubjectId]);
  const [quizzes] = await pool.execute<RowDataPacket[]>('SELECT quiz_name AS name, score, items, grade FROM quizzes WHERE user_subject_id=?', [userSubjectId]);
  const [exams] = await pool.execute<RowDataPacket[]>('SELECT exam_name AS name, exam_type AS specificType, score, items, grade FROM exams WHERE user_subject_id=?', [userSubjectId]);
  const [overall] = buildLegacyPeriods(acts.map(lite), quizzes.map(lite), exams.map(lite), EMPTY_PREFS, null);
  return { current_grade: projectPeriod(overall).current, grade_scale: '4pt' };
}

export async function listSubjectCards(userId: number): Promise<SubjectCardData[]> {
  await ensureSubjectSection();
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT us.user_subject_id, s.subject_name, s.course_code, s.section,
           s.units, s.year_level, s.trimester
    FROM user_subjects us
    JOIN subjects s ON us.subject_id = s.subject_id
    WHERE us.user_id = ?
    ORDER BY us.user_subject_id DESC
  `, [userId]);

  return Promise.all(rows.map(async sub => {
    const id = sub.user_subject_id as number;
    const [prog] = await pool.execute<RowDataPacket[]>(`
      SELECT SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END) AS completed, COUNT(*) AS total
      FROM (
        SELECT status FROM activities WHERE user_subject_id = ?
        UNION ALL SELECT status FROM quizzes WHERE user_subject_id = ?
        UNION ALL SELECT status FROM exams WHERE user_subject_id = ?
        UNION ALL SELECT status FROM grade_entries WHERE user_subject_id = ?
      ) t
    `, [id, id, id, id]);
    const completed = Number(prog[0].completed ?? 0);
    const total = Number(prog[0].total ?? 0);
    return {
      user_subject_id: id,
      subject_name: sub.subject_name as string,
      course_code: sub.course_code as string,
      section: sub.section as string | null,
      units: sub.units as number,
      year_level: sub.year_level as string,
      trimester: sub.trimester as string,
      completed_tasks: completed,
      total_tasks: total,
      progress_percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      ...(await currentGradeFor(id)),
    };
  }));
}
```

- [ ] **Step 2: Use it in the subjects page and API**

Replace `src/app/studypulse/subjects/page.tsx` entirely:
```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { listSubjectCards } from '@/lib/studypulse/subjectCards';
import SubjectsGrid from '@/components/studypulse/SubjectsGrid';
import '../studypulse.css';

export default async function SubjectsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const subjects = await listSubjectCards(parseInt(session.user.id));
  return <SubjectsGrid initialSubjects={subjects} />;
}
```
`studypulse.css` is created in Task 5. Create an empty `src/app/studypulse/studypulse.css` now, with just the comment `/* StudyPulse tokens: filled in Task 5 */`, so this task compiles.

In `src/app/api/studypulse/subjects/route.ts`, replace the body of `GET()` after the auth check with:
```ts
  return Response.json(await listSubjectCards(parseInt(session.user.id)));
```
Add `import { listSubjectCards } from '@/lib/studypulse/subjectCards';`. Remove the now-unused `ensureSubjectSection` import **only** if `POST` doesn't use it (it does, so keep it).

- [ ] **Step 3: Use `loadGradingConfig` in the subject page**

In `src/app/studypulse/[id]/page.tsx`, replace everything from `/* ── Try to load custom grading config ── */` down to (but not including) `/* ── Load existing presets list (for wizard) ── */` with:
```tsx
  /* ── Custom grading config (shared loader) + its grade_entries ── */
  const gradingConfig: GradingConfig | null = await loadGradingConfig(userSubjectId);
  const initialGradeEntries: Record<number, EntryRow[]> = {};
  if (gradingConfig) {
    try {
      const entries = await selectEntries(
        `SELECT ge.entry_id AS id, ge.name, '' AS specificType, ge.urgency, ge.status, ge.deadline,
                ge.score, ge.items, ge.grade, ge.cat_id, ge.is_lab, ge.accomplished_at,
                (cel.grade_entry_id IS NOT NULL) AS canvas_linked
         FROM grade_entries ge
         LEFT JOIN canvas_entry_links cel ON cel.grade_entry_id = ge.entry_id
         WHERE ge.user_subject_id=? ORDER BY ge.entry_id ASC`,
        `SELECT ge.entry_id AS id, ge.name, '' AS specificType, ge.urgency, ge.status, ge.deadline,
                ge.score, ge.items, ge.grade, ge.cat_id, ge.is_lab, ge.accomplished_at
         FROM grade_entries ge
         WHERE ge.user_subject_id=? ORDER BY ge.entry_id ASC`,
        [userSubjectId]
      );
      for (const e of entries) (initialGradeEntries[e.cat_id as number] ??= []).push(toEntry(e));
    } catch {
      // grade_entries missing: render the config with no entries
    }
  }
```
Add `import { loadGradingConfig } from '@/lib/studypulse/subjectCards';` and `import '../studypulse.css';`. The `toEntry` function's `todayStr` line becomes `const todayStr = todayManila();`, with `import { todayManila } from '@/lib/studypulse/ui/format';`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`. Expected: 0 errors.

Live check, logged in through Playwright:
- `/studypulse/subjects` renders the same cards as before.
- `await fetch('/api/studypulse/subjects').then(r=>r.json())` now includes `current_grade` and `grade_scale` on every item.
- A custom-preset subject page still loads its entries.
- Workboard's New-item dialog (which calls GET subjects) still lists subjects.

- [ ] **Step 5: Snapshot**

`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t4 "sp: shared server loader, card current_grade"`

---

### Task 5: Token sheet and segmented primitive

**Before coding:** invoke the `ui-ux-pro-max` skill and check the token sheet below against its contrast and touch-target guidance for a light glass UI. Adjust a value only if it fails a rule, and note the change in the snapshot message.

**Files:**
- Create: `src/app/studypulse/studypulse.css` (replace the Task 4 placeholder)
- Create: `src/components/studypulse/ui/SpSegmented.tsx`

**Interfaces:**
- Produces:
  - CSS classes for every later task:
    - Layout and surfaces: `.sp-page`, `.sp-wrap`, `.sp-panel`, `.sp-item`, `.sp-num`, `.sp-eyebrow`.
    - Buttons: `.sp-btn` with `--primary`, `--ghost`, `--quiet` and `--dark`; `.sp-pressable`, `.sp-focus-ring`, `.sp-icon-btn`.
    - Chips: `.sp-chip` with `--pink`, `--blue`, `--neutral`, `--success`, `--warn`, `--danger`.
    - Inputs: `.sp-input` with `--lg` and `--mono`; `.sp-seg`, `.sp-seg--sm`, `.sp-seg__opt`.
    - Utilities: `.sp-sr-only`, `.sp-collapse` (with `.is-open` and `.sp-collapse__inner`), the tone utilities `.sp-tone-{success,warn,danger,muted}`, and `.sp-chev` (with `.is-open`).
  - `SpSegmented<T>({ options, value, onChange, label, size? })`.

- [ ] **Step 1: Write the token sheet**

`src/app/studypulse/studypulse.css`:
```css
/* StudyPulse tokens and shared classes (spec §5). Values mirror src/app/workboard/workboard.css
   --wb-*; StudyPulse never imports Workboard CSS. Every StudyPulse colour lives here. */
:root {
  --sp-text: #2d3748;
  --sp-text-muted: #5a697e;      /* smallest text and eyebrows: 4.6:1 on item glass */
  --sp-text-subtle: #8a94a6;     /* icons, separators only (not text) */
  --sp-text-faint: #9aa4b5;      /* placeholders and the "—" glyph only */
  --sp-pink: #f0679d;
  --sp-pink-ink: #b0396d;
  --sp-pink-bg: rgba(240, 103, 157, 0.12);
  --sp-pink-btn-top: #c64480;
  --sp-pink-deep: #b5396e;
  --sp-blue: #74bcd9;
  --sp-blue-strong: #2a7fa8;
  --sp-blue-ink: #256f92;
  --sp-blue-bg: rgba(116, 188, 217, 0.16);
  --sp-success: #1f6b42;
  --sp-success-fill: #2f8f5b;
  --sp-success-soft: #8fd0ac;
  --sp-success-bg: rgba(107, 181, 138, 0.16);
  --sp-warn: #8a5010;
  --sp-warn-fill: #d9892f;
  --sp-warn-soft: #f3c58f;
  --sp-warn-bg: rgba(240, 163, 92, 0.18);
  --sp-danger: #922e48;
  --sp-danger-fill: #d0546f;
  --sp-danger-soft: #f0a6b6;
  --sp-danger-bg: rgba(224, 96, 124, 0.14);
  --sp-neutral-bg: rgba(120, 130, 150, 0.14);
  --sp-ink: #2d3748;
  --sp-ink-top: #3b4a63;
  --sp-on-ink: #ffffff;
  --sp-surface: #ffffff;
  --sp-hair: rgba(160, 172, 196, 0.28);
  --sp-field-border: rgba(160, 172, 196, 0.45);
  --sp-hover: rgba(255, 255, 255, 0.6);
  --sp-glass-panel: linear-gradient(160deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.36));
  --sp-glass-panel-border: 1px solid rgba(255, 255, 255, 0.7);
  --sp-glass-panel-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 20px 50px -24px rgba(60, 40, 110, 0.35);
  --sp-glass-item: linear-gradient(160deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.56));
  --sp-glass-item-border: 1px solid rgba(255, 255, 255, 0.85);
  --sp-glass-item-shadow: inset 0 1px 0 #ffffff, 0 10px 26px -16px rgba(60, 40, 110, 0.4);
  --sp-shadow-lift: 0 20px 40px -18px rgba(31, 38, 68, 0.35);
  --sp-shadow-knob: 0 1px 2px rgba(31, 38, 68, 0.08), 0 6px 14px -6px rgba(31, 38, 68, 0.25);
  --sp-focus: #2a7fa8;
  --sp-font-ui: 'Inter', 'DM Sans', 'Segoe UI', sans-serif;
  --sp-font-head: 'DM Sans', 'Segoe UI', sans-serif;
  --sp-font-mono: ui-monospace, 'Cascadia Code', Consolas, monospace;
  --sp-r-sm: 8px;
  --sp-r-md: 10px;
  --sp-r-lg: 12px;
  --sp-r-item: 14px;
  --sp-r-card: 18px;
  --sp-r-panel: 22px;
  --sp-r-pill: 999px;
  --sp-ease: cubic-bezier(0.23, 1, 0.32, 1);
  --sp-dur-fast: 120ms;
  --sp-dur: 180ms;
  --sp-dur-slow: 300ms;
}

.sp-page { min-height: 100vh; font-family: var(--sp-font-ui); color: var(--sp-text); padding-block: 36px 96px; padding-inline: clamp(16px, 4vw, 40px); overflow-x: hidden; }
.sp-wrap { max-width: 1240px; margin: 0 auto; }
.sp-num { font-variant-numeric: tabular-nums; }
.sp-panel { background: var(--sp-glass-panel); border: var(--sp-glass-panel-border); box-shadow: var(--sp-glass-panel-shadow); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); border-radius: var(--sp-r-panel); }
.sp-item { background: var(--sp-glass-item); border: var(--sp-glass-item-border); box-shadow: var(--sp-glass-item-shadow); border-radius: var(--sp-r-item); }
.sp-eyebrow { font: 800 11px var(--sp-font-ui); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sp-text-muted); }
.sp-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.sp-focus-ring:focus-visible { outline: 2px solid var(--sp-focus); outline-offset: 2px; }
.sp-pressable { transition: transform var(--sp-dur-fast) var(--sp-ease); }
.sp-pressable:active:not(:disabled) { transform: scale(0.97); }

.sp-btn { display: inline-flex; align-items: center; gap: 7px; border: 0; cursor: pointer; font: 700 13px var(--sp-font-ui); border-radius: var(--sp-r-lg); padding: 9px 14px; min-height: 36px; white-space: nowrap; text-decoration: none; transition: transform var(--sp-dur-fast) var(--sp-ease), background-color var(--sp-dur) var(--sp-ease), color var(--sp-dur) var(--sp-ease); }
.sp-btn:active:not(:disabled) { transform: scale(0.97); }
.sp-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.sp-btn--primary { color: var(--sp-on-ink); background: linear-gradient(180deg, var(--sp-pink-btn-top), var(--sp-pink-deep)); box-shadow: 0 8px 20px -8px rgba(181, 57, 110, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.25); }
.sp-btn--ghost { background: rgba(255, 255, 255, 0.62); color: var(--sp-text); border: 1px solid rgba(255, 255, 255, 0.8); }
.sp-btn--quiet { background: transparent; color: var(--sp-text-muted); }
.sp-btn--dark { background: linear-gradient(180deg, var(--sp-ink-top), var(--sp-ink)); color: var(--sp-on-ink); border: 1px solid transparent; }
@media (hover: hover) and (pointer: fine) {
  .sp-btn--ghost:hover { background: rgba(255, 255, 255, 0.88); }
  .sp-btn--quiet:hover { background: var(--sp-hover); color: var(--sp-text); }
}

.sp-icon-btn { width: 32px; height: 32px; border-radius: var(--sp-r-md); display: inline-grid; place-items: center; border: 0; background: transparent; color: var(--sp-text-muted); cursor: pointer; transition: background-color var(--sp-dur) var(--sp-ease), color var(--sp-dur) var(--sp-ease), transform var(--sp-dur-fast) var(--sp-ease); }
.sp-icon-btn:active { transform: scale(0.92); }
@media (hover: hover) and (pointer: fine) { .sp-icon-btn:hover { background: rgba(255, 255, 255, 0.8); color: var(--sp-text); } }
.sp-icon-btn--danger { color: var(--sp-danger); }
.sp-icon-btn--ok { color: var(--sp-success); background: var(--sp-success-bg); }

.sp-chip { display: inline-flex; align-items: center; gap: 5px; font: 700 12px var(--sp-font-ui); padding: 3px 9px; border-radius: var(--sp-r-pill); white-space: nowrap; }
.sp-chip--pink { background: var(--sp-pink-bg); color: var(--sp-pink-ink); }
.sp-chip--blue { background: var(--sp-blue-bg); color: var(--sp-blue-ink); }
.sp-chip--neutral { background: var(--sp-neutral-bg); color: var(--sp-text-muted); }
.sp-chip--success { background: var(--sp-success-bg); color: var(--sp-success); }
.sp-chip--warn { background: var(--sp-warn-bg); color: var(--sp-warn); }
.sp-chip--danger { background: var(--sp-danger-bg); color: var(--sp-danger); }

.sp-tone-success { color: var(--sp-success); }
.sp-tone-warn { color: var(--sp-warn); }
.sp-tone-danger { color: var(--sp-danger); }
.sp-tone-muted { color: var(--sp-text-muted); }

.sp-input { width: 100%; font: 500 14px var(--sp-font-ui); color: var(--sp-text); padding: 10px 13px; border-radius: var(--sp-r-lg); border: 1px solid var(--sp-field-border); background: rgba(255, 255, 255, 0.9); box-shadow: inset 0 1px 2px rgba(31, 38, 68, 0.04); outline: none; transition: border-color var(--sp-dur) var(--sp-ease), box-shadow var(--sp-dur) var(--sp-ease); }
.sp-input::placeholder { color: var(--sp-text-faint); }
.sp-input:focus { border-color: var(--sp-pink); box-shadow: 0 0 0 4px rgba(240, 103, 157, 0.16); }
.sp-input--lg { font: 700 17px var(--sp-font-head); padding: 12px 14px; }
.sp-input--mono { font-family: var(--sp-font-mono); font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.sp-input--sm { padding: 7px 10px; font-size: 13px; border-radius: 9px; }

.sp-seg { display: inline-flex; flex-wrap: wrap; background: rgba(160, 172, 196, 0.16); border-radius: var(--sp-r-lg); padding: 3px; gap: 2px; }
.sp-seg__opt { border: 0; background: transparent; font: 700 13px var(--sp-font-ui); color: var(--sp-text-muted); padding: 8px 13px; min-height: 34px; border-radius: 9px; cursor: pointer; transition: background-color var(--sp-dur) var(--sp-ease), color var(--sp-dur) var(--sp-ease); }
.sp-seg__opt[aria-checked='true'] { background: var(--sp-surface); color: var(--sp-text); box-shadow: var(--sp-shadow-knob); }
.sp-seg--sm .sp-seg__opt { padding: 5px 10px; min-height: 28px; font-size: 12px; }
@media (hover: hover) and (pointer: fine) { .sp-seg__opt[aria-checked='false']:hover { color: var(--sp-text); } }

.sp-collapse { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 240ms var(--sp-ease); }
.sp-collapse.is-open { grid-template-rows: 1fr; }
.sp-collapse__inner { overflow: hidden; min-height: 0; }
.sp-chev { transition: transform 240ms var(--sp-ease); }
.sp-chev.is-open { transform: rotate(180deg); }

@media (prefers-reduced-motion: reduce) {
  .sp-page *, .sp-page *::before, .sp-page *::after { transition-duration: 1ms !important; animation-duration: 1ms !important; }
}
```

- [ ] **Step 2: Write SpSegmented**

`src/components/studypulse/ui/SpSegmented.tsx`:
```tsx
'use client';

import { useRef, type KeyboardEvent } from 'react';

export interface SegOption<T extends string | number> { value: T; label: string }

/** Single-select segmented control: role=radiogroup with roving tabindex and arrow keys (spec §8). */
export default function SpSegmented<T extends string | number>({
  options, value, onChange, label, size = 'md',
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'md' | 'sm';
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = options.findIndex(o => o.value === value);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={`sp-seg${size === 'sm' ? ' sp-seg--sm' : ''}`}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={el => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={(active < 0 ? i === 0 : i === active) ? 0 : -1}
          className="sp-seg__opt sp-focus-ring"
          onClick={() => onChange(o.value)}
          onKeyDown={e => onKey(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`. Expected: 0 errors.
Run: `node scripts/wb-style-gate.mjs src/app/studypulse/studypulse.css src/components/studypulse/ui/SpSegmented.tsx`. Expected: pass.

- [ ] **Step 4: Snapshot**

`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t5 "sp: token sheet + SpSegmented"`

---

### Task 6: My Subjects (form, preview, cards)

**Before coding:** open mockup v4 section 1, and invoke `redesign-existing-projects` for the audit-first checklist on `SubjectsGrid.tsx`. This work must keep every current behaviour:
- create routes to `/studypulse/<id>?new=1`;
- edit uses PUT;
- delete confirms;
- right-click delete stays;
- the staggered card fade-in stays (`animate-fade-in-up`).

**Files:**
- Create: `src/components/studypulse/subjects/GradeRing.tsx`, `SubjectCard.tsx`, `SubjectForm.tsx`
- Rewrite: `src/components/studypulse/SubjectsGrid.tsx`
- Modify: `src/app/studypulse/studypulse.css` (append the "My Subjects" section)

**Interfaces:**
- Consumes: `SubjectCardData` (Task 2); `toGradeInfo` from `@/lib/gradeScale`; `gradeTone` (Task 2); `SpSegmented` (Task 5).
- Produces: `SubjectsGrid({ initialSubjects: SubjectCardData[] })`, the same default export and prop name as today. `export type SubjectCard = SubjectCardData` is kept for any importer.

- [ ] **Step 1: Append CSS**

Append to `studypulse.css`:
```css
/* ── My Subjects (spec §6.1, mockup v4 §1) ── */
.sp-ms-head { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
.sp-ms-title { font: 800 clamp(30px, 4vw, 40px)/1.05 var(--sp-font-head); letter-spacing: -0.02em; margin: 0; color: var(--sp-text); }
.sp-ms-title em { font-style: normal; background: linear-gradient(90deg, var(--sp-pink-deep), var(--sp-blue-strong)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sp-ms-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; color: var(--sp-text-muted); font-weight: 600; margin-top: 8px; font-size: 13.5px; }
.sp-ms-sub span { display: inline-flex; align-items: center; gap: 6px; }
.sp-ms-actions { margin-left: auto; display: flex; gap: 8px; }
.sp-ms-actions .sp-btn--primary svg { transition: transform 220ms var(--sp-ease); }
.sp-ms-actions .sp-btn--primary.is-open svg { transform: rotate(45deg); }

.sp-sheet { display: grid; grid-template-columns: 1fr 300px; margin-top: 22px; overflow: hidden; }
.sp-sheet__main { padding: 26px 28px; }
.sp-sheet__side { padding: 26px 24px; background: rgba(255, 255, 255, 0.28); border-left: 1px solid var(--sp-hair); }
.sp-sheet__title { font: 800 19px var(--sp-font-head); margin: 0 0 4px; display: flex; align-items: center; gap: 10px; }
.sp-badge { width: 30px; height: 30px; border-radius: var(--sp-r-md); display: grid; place-items: center; background: linear-gradient(135deg, var(--sp-pink-bg), var(--sp-blue-bg)); color: var(--sp-pink-ink); flex-shrink: 0; }
.sp-sheet__lede { color: var(--sp-text-muted); font-size: 13px; margin: 0 0 22px 40px; }
.sp-fgroup { margin-bottom: 22px; }
.sp-fgroup__title { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.sp-fgroup__title::after { content: ''; flex: 1; height: 1px; background: var(--sp-hair); }
.sp-frow { display: grid; gap: 14px; }
.sp-frow--2 { grid-template-columns: 1fr 1fr; }
.sp-frow--segs { display: flex; flex-wrap: wrap; gap: 14px 22px; }
.sp-field__label { display: block; font: 700 12.5px var(--sp-font-ui); color: var(--sp-text); margin-bottom: 6px; }
.sp-field__req { color: var(--sp-pink-ink); margin-left: 2px; }
.sp-field__hint { font-size: 12px; color: var(--sp-text-muted); margin-top: 5px; }
.sp-field__err { font-size: 12px; font-weight: 600; color: var(--sp-danger); margin-top: 5px; }
.sp-sheet__foot { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding-top: 6px; }
.sp-sheet__kbd { margin-left: auto; font-size: 12px; color: var(--sp-text-muted); }
.sp-kbd { font: 700 11px var(--sp-font-ui); background: rgba(255, 255, 255, 0.85); border: 1px solid var(--sp-hair); border-bottom-width: 2px; border-radius: 6px; padding: 1px 6px; color: var(--sp-text-muted); }
.sp-sheet__note { font-size: 12px; color: var(--sp-text-muted); line-height: 1.5; margin: 14px 2px 0; }
.sp-form-error { margin-top: 14px; padding: 10px 14px; border-radius: var(--sp-r-md); background: var(--sp-danger-bg); color: var(--sp-danger); font-size: 13px; font-weight: 600; }
.sp-form-shell { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 280ms var(--sp-ease); }
.sp-form-shell.is-open { grid-template-rows: 1fr; }
.sp-form-shell__inner { overflow: hidden; min-height: 0; }
.sp-form-shell__content { opacity: 0; transition: opacity 180ms var(--sp-ease); padding-bottom: 6px; }
.sp-form-shell.is-open .sp-form-shell__content { opacity: 1; transition-delay: 90ms; }

.sp-ring { --p: 0; width: 48px; height: 48px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; background: conic-gradient(from -90deg, var(--sp-pink) 0%, var(--sp-blue) calc(var(--p) * 1%), var(--sp-neutral-bg) 0); }
.sp-ring__in { width: 38px; height: 38px; border-radius: 50%; background: rgba(255, 255, 255, 0.94); display: grid; place-items: center; font: 800 12px var(--sp-font-ui); color: var(--sp-text); }
.sp-ring--empty .sp-ring__in { color: var(--sp-text-faint); }

.sp-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; margin-top: 22px; }
.sp-card { padding: 18px; border-radius: var(--sp-r-card); display: flex; flex-direction: column; gap: 12px; min-height: 176px; cursor: pointer; user-select: none; text-align: left; transition: transform 200ms var(--sp-ease), box-shadow 200ms var(--sp-ease); }
.sp-card__top { display: flex; justify-content: space-between; gap: 10px; }
.sp-card__code { font: 800 11.5px var(--sp-font-ui); letter-spacing: 0.07em; text-transform: uppercase; color: var(--sp-pink-ink); }
.sp-card__name { font: 700 16px/1.25 var(--sp-font-head); margin: 3px 0 6px; color: var(--sp-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.sp-card__grade { font: 800 12.5px var(--sp-font-ui); }
.sp-card__meta { display: flex; flex-wrap: wrap; gap: 6px; }
.sp-card__foot { display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--sp-hair); font-size: 12.5px; color: var(--sp-text-muted); font-weight: 600; }
.sp-card__actions { display: flex; gap: 2px; opacity: 0.6; transition: opacity var(--sp-dur) var(--sp-ease); }
.sp-card:focus-within .sp-card__actions { opacity: 1; }
@media (hover: hover) and (pointer: fine) {
  .sp-card:hover { transform: translateY(-4px); box-shadow: var(--sp-shadow-lift); }
  .sp-card:hover .sp-card__actions { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) { .sp-card:hover { transform: none; } }
.sp-empty { text-align: center; padding: 56px 24px; margin-top: 22px; }
.sp-empty h3 { font: 800 18px var(--sp-font-head); margin: 14px 0 6px; }
.sp-empty p { color: var(--sp-text-muted); margin: 0 0 20px; }

@media (max-width: 900px) {
  .sp-sheet { grid-template-columns: 1fr; }
  .sp-sheet__side { border-left: 0; border-top: 1px solid var(--sp-hair); }
  .sp-sheet__lede { margin-left: 0; }
}
@media (max-width: 560px) {
  .sp-frow--2 { grid-template-columns: 1fr; }
  .sp-sheet__main { padding: 20px 18px; }
  .sp-sheet__kbd { display: none; }
  .sp-ms-actions { margin-left: 0; width: 100%; }
}
```

- [ ] **Step 2: GradeRing and SubjectCard**

`src/components/studypulse/subjects/GradeRing.tsx`:
```tsx
import type { CSSProperties } from 'react';

/** The subject card's ring (spec D6): fill = current grade %, centre = rounded grade. */
export default function GradeRing({ grade }: { grade: number | null }) {
  const p = grade === null ? 0 : Math.max(0, Math.min(100, grade));
  return (
    <div className={`sp-ring${grade === null ? ' sp-ring--empty' : ''}`} style={{ '--p': p } as CSSProperties} aria-hidden="true">
      <span className="sp-ring__in sp-num">{grade === null ? '—' : Math.round(grade)}</span>
    </div>
  );
}
```

`src/components/studypulse/subjects/SubjectCard.tsx`:
```tsx
'use client';

import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { toGradeInfo } from '@/lib/gradeScale';
import { gradeTone } from '@/lib/studypulse/ui/format';
import type { SubjectCardData } from '@/lib/studypulse/types';
import GradeRing from './GradeRing';

type CardFields = Pick<SubjectCardData, 'course_code' | 'subject_name' | 'section' | 'year_level' | 'trimester' | 'units' | 'current_grade' | 'grade_scale'>
  & Partial<Pick<SubjectCardData, 'completed_tasks' | 'total_tasks'>>;

const TONE_CLASS = { success: 'sp-tone-success', warn: 'sp-tone-warn', danger: 'sp-tone-danger', none: 'sp-tone-muted' } as const;

/** Letter and meaning only, never the number beside it (spec D6). */
function gradeLine(grade: number | null, scale: SubjectCardData['grade_scale']): string {
  if (grade === null) return 'No grades yet';
  if (!scale) return '';
  const gi = toGradeInfo(grade, scale);
  return `${gi.letter} · ${gi.description}`;
}

export default function SubjectCard({
  sub, preview = false, index = 0, onOpen, onEdit, onDelete,
}: {
  sub: CardFields;
  preview?: boolean;
  index?: number;
  onOpen?: () => void;
  onEdit?: (e: MouseEvent) => void;
  onDelete?: (e: MouseEvent) => void;
}) {
  const units = `${sub.units} unit${Number(sub.units) !== 1 ? 's' : ''}`;
  const line = gradeLine(sub.current_grade, sub.grade_scale);
  const onKey = (e: KeyboardEvent) => { if (!preview && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen?.(); } };

  return (
    <div
      className={`sp-item sp-card sp-focus-ring${preview ? '' : ' animate-fade-in-up'}`}
      style={preview ? { cursor: 'default' } : ({ animationDelay: `${Math.min(index, 12) * 45}ms` } as CSSProperties)}
      role={preview ? undefined : 'link'}
      tabIndex={preview ? undefined : 0}
      aria-label={preview ? undefined : `Open ${sub.subject_name}`}
      onClick={preview ? undefined : onOpen}
      onKeyDown={onKey}
      onContextMenu={preview || !onDelete ? undefined : e => { e.preventDefault(); onDelete(e); }}
    >
      <div className="sp-card__top">
        <div style={{ minWidth: 0 }}>
          <div className="sp-card__code">{sub.course_code || 'Course code'}</div>
          <div className="sp-card__name">{sub.subject_name || 'Subject name'}</div>
          {line && <div className={`sp-card__grade ${TONE_CLASS[gradeTone(sub.current_grade)]}`}>{line}</div>}
        </div>
        <GradeRing grade={sub.current_grade} />
      </div>
      <div className="sp-card__meta">
        {sub.year_level && <span className="sp-chip sp-chip--pink">{sub.year_level}</span>}
        {sub.trimester && <span className="sp-chip sp-chip--blue">{sub.trimester}</span>}
        {sub.section && <span className="sp-chip sp-chip--neutral">Block {sub.section}</span>}
      </div>
      <div className="sp-card__foot sp-num">
        <span>
          {preview || !sub.total_tasks ? (preview ? units : `No entries yet · ${units}`) : `${sub.completed_tasks} / ${sub.total_tasks} graded · ${units}`}
        </span>
        {preview ? <ArrowRight size={15} className="sp-tone-muted" aria-hidden /> : (
          <span className="sp-card__actions">
            <button type="button" className="sp-icon-btn sp-focus-ring" aria-label={`Edit ${sub.subject_name}`} onClick={e => { e.stopPropagation(); onEdit?.(e); }}>
              <Pencil size={14} />
            </button>
            <button type="button" className="sp-icon-btn sp-icon-btn--danger sp-focus-ring" aria-label={`Delete ${sub.subject_name}`} onClick={e => { e.stopPropagation(); onDelete?.(e); }}>
              <Trash2 size={14} />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: SubjectForm**

`src/components/studypulse/subjects/SubjectForm.tsx`:
```tsx
'use client';

import { useEffect, type FormEvent } from 'react';
import { ArrowRight, Layers } from 'lucide-react';
import SpSegmented from '../ui/SpSegmented';
import SubjectCard from './SubjectCard';

export const YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
export const TERMS = ['1st Term', '2nd Term', '3rd Term'];
export const TRIMESTERS = ['1st Trimester', '2nd Trimester', '3rd Trimester'];
export const UNIT_OPTIONS = ['0', '1', '2', '3'];

export interface SubjectFormValues {
  course_code: string; section: string; subject_name: string;
  year_level: string; term: string; semester: string; units: string;
}
export const BLANK_FORM: SubjectFormValues = { course_code: '', section: '', subject_name: '', year_level: '', term: '', semester: '', units: '3' };

const short = (v: string) => v.split(' ')[0]; // "3rd Year" -> "3rd"

export default function SubjectForm({
  open, editing, form, set, submitting, message, onSubmit, onCancel,
}: {
  open: boolean;
  editing: boolean;
  form: SubjectFormValues;
  set: (k: keyof SubjectFormValues, v: string) => void;
  submitting: boolean;
  message: string;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const req = <span className="sp-field__req" aria-hidden>*</span>;

  return (
    <div className={`sp-form-shell${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="sp-form-shell__inner">
        <form className="sp-form-shell__content" onSubmit={onSubmit} inert={!open ? true : undefined}>
          <div className="sp-panel sp-sheet">
            <div className="sp-sheet__main">
              <h3 className="sp-sheet__title"><span className="sp-badge"><Layers size={16} /></span>{editing ? 'Edit subject' : 'New subject'}</h3>
              <p className="sp-sheet__lede">{editing ? 'Changes apply to this subject only.' : "You'll set up its grading system right after this."}</p>

              <div className="sp-fgroup">
                <div className="sp-fgroup__title"><span className="sp-eyebrow">Course</span></div>
                <div className="sp-frow sp-frow--2">
                  <label className="sp-field">
                    <span className="sp-field__label">Course code{req}</span>
                    <input className="sp-input sp-input--mono" placeholder="e.g. CS101" value={form.course_code} onChange={e => set('course_code', e.target.value)} required />
                  </label>
                  <label className="sp-field">
                    <span className="sp-field__label">Block section</span>
                    <input className="sp-input sp-input--mono" placeholder="e.g. TN37" value={form.section} onChange={e => set('section', e.target.value)} />
                    <span className="sp-field__hint">Optional. Shown as a tag on the card.</span>
                  </label>
                </div>
                <label className="sp-field" style={{ display: 'block', marginTop: 14 }}>
                  <span className="sp-field__label">Subject name{req}</span>
                  <input className="sp-input sp-input--lg" placeholder="e.g. Data Structures" value={form.subject_name} onChange={e => set('subject_name', e.target.value)} required />
                </label>
              </div>

              <div className="sp-fgroup">
                <div className="sp-fgroup__title"><span className="sp-eyebrow">When</span></div>
                <div className="sp-frow--segs">
                  <div className="sp-field"><span className="sp-field__label">Year level{req}</span>
                    <SpSegmented label="Year level" value={form.year_level} onChange={v => set('year_level', v)} options={YEAR_LEVELS.map(y => ({ value: y, label: short(y) }))} />
                  </div>
                  <div className="sp-field"><span className="sp-field__label">Trimester{req}</span>
                    <SpSegmented label="Trimester" value={form.semester} onChange={v => set('semester', v)} options={TRIMESTERS.map(t => ({ value: t, label: short(t) }))} />
                  </div>
                  <div className="sp-field"><span className="sp-field__label">Term</span>
                    <SpSegmented label="Term" value={form.term} onChange={v => set('term', v)} options={[{ value: '', label: '—' }, ...TERMS.map(t => ({ value: t, label: short(t) }))]} />
                  </div>
                  <div className="sp-field"><span className="sp-field__label">Units</span>
                    <SpSegmented label="Units" value={form.units} onChange={v => set('units', v)} options={UNIT_OPTIONS.map(u => ({ value: u, label: u }))} />
                  </div>
                </div>
              </div>

              {message && <div className="sp-form-error" role="alert">{message}</div>}

              <div className="sp-sheet__foot" style={{ marginTop: 18 }}>
                <button type="submit" className="sp-btn sp-btn--primary sp-focus-ring" disabled={submitting}>
                  {editing ? (submitting ? 'Saving…' : 'Save changes') : (submitting ? 'Creating…' : <>Create &amp; set up grading <ArrowRight size={15} /></>)}
                </button>
                <button type="button" className="sp-btn sp-btn--quiet sp-focus-ring" onClick={onCancel}>Cancel</button>
                <span className="sp-sheet__kbd"><kbd className="sp-kbd">Enter</kbd> to {editing ? 'save' : 'create'} · <kbd className="sp-kbd">Esc</kbd> to close</span>
              </div>
            </div>
            <aside className="sp-sheet__side" aria-label="Preview">
              <div className="sp-eyebrow" style={{ marginBottom: 12 }}>Preview</div>
              <SubjectCard preview sub={{
                course_code: form.course_code.toUpperCase(), subject_name: form.subject_name, section: form.section.toUpperCase() || null,
                year_level: form.year_level, trimester: form.semester, units: Number(form.units) || 0,
                current_grade: null, grade_scale: null,
              }} />
              <p className="sp-sheet__note">This is how the subject will look in your list.</p>
            </aside>
          </div>
        </form>
      </div>
    </div>
  );
}
```
Year level and trimester are required, but segmented controls can't use native `required`. That validation stays in `handleAdd` (Step 4), which sets `message`.

- [ ] **Step 4: Rewrite SubjectsGrid**

Replace `src/components/studypulse/SubjectsGrid.tsx`:
```tsx
'use client';

import { useCallback, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, GraduationCap, Home, Plus } from 'lucide-react';
import type { SubjectCardData } from '@/lib/studypulse/types';
import SubjectCard from './subjects/SubjectCard';
import SubjectForm, { BLANK_FORM, type SubjectFormValues } from './subjects/SubjectForm';

export type SubjectCard = SubjectCardData;

const mode = (xs: string[]) => {
  const c = new Map<string, number>();
  xs.filter(Boolean).forEach(x => c.set(x, (c.get(x) ?? 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
};

export default function SubjectsGrid({ initialSubjects }: { initialSubjects: SubjectCardData[] }) {
  const router = useRouter();
  const [subjects, setSubjects] = useState(initialSubjects);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<SubjectFormValues>(BLANK_FORM);

  const set = (k: keyof SubjectFormValues, v: string) => setForm(p => ({ ...p, [k]: v }));
  const closeForm = useCallback(() => { setShowForm(false); setEditingId(null); setForm(BLANK_FORM); setMessage(''); }, []);
  const openForCreate = () => { setEditingId(null); setForm(BLANK_FORM); setMessage(''); setShowForm(true); };
  const openForEdit = (sub: SubjectCardData) => {
    setEditingId(sub.user_subject_id);
    setForm({ course_code: sub.course_code, section: sub.section ?? '', subject_name: sub.subject_name, year_level: sub.year_level, term: '', semester: sub.trimester, units: String(sub.units) });
    setMessage('');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const stats = useMemo(() => ({
    units: subjects.reduce((s, x) => s + (Number(x.units) || 0), 0),
    tri: mode(subjects.map(s => s.trimester)),
    year: mode(subjects.map(s => s.year_level)),
  }), [subjects]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.course_code || !form.subject_name || !form.year_level || !form.semester) {
      setMessage('Course code, subject name, year level and trimester are required.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const body = JSON.stringify({
        course_code: form.course_code, section: form.section || null, subject_name: form.subject_name,
        year_level: form.year_level, trimester: form.semester, units: form.units,
      });
      if (editingId) {
        const res = await fetch(`/api/studypulse/subjects/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.error);
        setSubjects(prev => prev.map(s => s.user_subject_id === editingId ? {
          ...s, course_code: form.course_code, section: form.section || null, subject_name: form.subject_name,
          year_level: form.year_level, trimester: form.semester, units: Number(form.units) || 0,
        } : s));
        closeForm();
        return;
      }
      const res = await fetch('/api/studypulse/subjects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error);
      // SubjectCardView consumes ?new=1 to auto-open the grading setup wizard.
      router.push(`/studypulse/${data.user_subject_id}?new=1`);
    } catch (err) {
      setMessage((err as Error).message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (_e: MouseEvent, id: number) => {
    if (!confirm('Delete this subject? This cannot be undone.')) return;
    await fetch(`/api/studypulse/subjects/${id}`, { method: 'DELETE' });
    setSubjects(prev => prev.filter(s => s.user_subject_id !== id));
    if (editingId === id) closeForm();
  };

  return (
    <div className="vb-bg sp-page">
      <div className="sp-wrap">
        <header className="sp-ms-head">
          <div>
            <h1 className="sp-ms-title">My <em>Subjects</em></h1>
            <div className="sp-ms-sub sp-num">
              <span><BookOpen size={15} aria-hidden /> {subjects.length} subject{subjects.length !== 1 ? 's' : ''}</span>
              {stats.units > 0 && <span>· {stats.units} units</span>}
              {(stats.tri || stats.year) && <span>· {[stats.tri, stats.year].filter(Boolean).join(' · ')}</span>}
            </div>
          </div>
          <div className="sp-ms-actions">
            <button type="button" className="sp-btn sp-btn--ghost sp-focus-ring" onClick={() => router.push('/studypulse')}><Home size={15} /> Dashboard</button>
            <button type="button" className={`sp-btn sp-btn--primary sp-focus-ring${showForm ? ' is-open' : ''}`} aria-expanded={showForm} onClick={() => (showForm ? closeForm() : openForCreate())}>
              <Plus size={16} /> {showForm ? 'Close' : 'Add subject'}
            </button>
          </div>
        </header>

        <SubjectForm open={showForm} editing={editingId !== null} form={form} set={set} submitting={submitting} message={message} onSubmit={handleAdd} onCancel={closeForm} />

        {subjects.length > 0 ? (
          <div className="sp-cards">
            {subjects.map((sub, idx) => (
              <SubjectCard
                key={sub.user_subject_id}
                sub={sub}
                index={idx}
                onOpen={() => router.push(`/studypulse/${sub.user_subject_id}`)}
                onEdit={() => openForEdit(sub)}
                onDelete={e => handleDelete(e, sub.user_subject_id)}
              />
            ))}
          </div>
        ) : !showForm && (
          <div className="sp-panel sp-empty">
            <span className="sp-badge" style={{ width: 56, height: 56, margin: '0 auto' }}><GraduationCap size={26} /></span>
            <h3>No subjects yet</h3>
            <p>Add your first subject to start tracking grades and tasks.</p>
            <button type="button" className="sp-btn sp-btn--primary sp-focus-ring" onClick={openForCreate}><Plus size={16} /> Add subject</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`. Expected: 0 errors.
Run: `node scripts/wb-style-gate.mjs src/components/studypulse/SubjectsGrid.tsx src/components/studypulse/subjects/*.tsx src/app/studypulse/studypulse.css`. Expected: pass.
In Playwright at 1440×900 and 390×844 on `/studypulse/subjects`, check:
- the form opens with a grid-rows slide and the preview updates live;
- Esc closes it;
- the segmented controls work with the arrow keys;
- creating a subject lands on `/studypulse/<id>?new=1` with the wizard open;
- edit saves;
- the cards show the ring with the grade number, the letter line without a number, and the Block chip.

Compare against mockup v4 §1.

- [ ] **Step 6: Snapshot**

`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t6 "sp: My Subjects restyle (form sheet, preview, ring cards)"`

---

### Task 7: Entry tables and category sections

**Files:**
- Create: `src/components/studypulse/subject/GradePill.tsx`, `EntryTable.tsx`, `SingletonScore.tsx`, `CategorySection.tsx`
- Modify: `src/components/studypulse/SubjectCardView.tsx`
  - Delete `MiniGauge`, `GradeCell`, `EntrySection`, `CustomEntrySection` and the now-unused helpers `gradeStyle`, `avgGrades`, `examAvg`, `examTransmuted`, `INPUT`, **only if** nothing else still uses them. `CustomGradeCalculator` and `GradeCalculator` still use `gradeStyle`, `avgGrades`, `examAvg`, `examTransmuted` and `INPUT` until Task 9, so keep exactly those.
  - Render `CategorySection` in their place.
- Modify: `src/app/studypulse/studypulse.css` (append the "Entry tables" section)

**Interfaces:**
- Consumes: `EntryRow`; `calcGrade`; `transmute`; `averageOf`; `f1`, `gradeTone`, `dueNote`, `submittedNote`, `shortDate`, `todayManila`.
- Produces:
  - `EntryPersistence { save(row, doneAt): Promise<number>; remove(row): Promise<void> }`
  - `TypeColumn = { kind: 'select'; options: string[] } | { kind: 'index' }`
  - `CategorySection` props, used by Task 8's `PeriodPanel` and by legacy mode:
    ```ts
    {
      name: string; weight: number | null; color: string; noun: string; singleton: boolean;
      entries: EntryRow[]; onChange: (rows: EntryRow[]) => void; persistence: EntryPersistence;
      typeColumn?: TypeColumn; transTable: TransmutationTable | null; transmutationOn: boolean;
      sharedFrom?: { periodName: string; grade: number } | null; scheduledNote?: string | null;
    }
    ```

- [ ] **Step 1: Append CSS**

```css
/* ── Entry tables (spec §6.4, mockup v4 §3) ── */
.sp-cat { margin-top: 12px; border-radius: 16px; overflow: hidden; }
.sp-cat__head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: 12px 16px; }
.sp-cat__swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.sp-cat__name { font: 800 15px var(--sp-font-head); }
.sp-cat__prog { font: 600 12.5px var(--sp-font-ui); color: var(--sp-text-muted); }
.sp-cat__right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.sp-avg { display: inline-flex; align-items: baseline; gap: 4px; padding: 4px 10px; border-radius: var(--sp-r-md); font: 800 15px var(--sp-font-head); }
.sp-avg small { font: 700 11px var(--sp-font-ui); opacity: 0.85; }
.sp-avg--success { background: var(--sp-success-bg); color: var(--sp-success); }
.sp-avg--warn { background: var(--sp-warn-bg); color: var(--sp-warn); }
.sp-avg--danger { background: var(--sp-danger-bg); color: var(--sp-danger); }
.sp-avg--none { background: var(--sp-neutral-bg); color: var(--sp-text-muted); font-size: 12.5px; }
.sp-add { display: inline-flex; align-items: center; gap: 5px; font: 700 12.5px var(--sp-font-ui); color: var(--sp-pink-ink); background: var(--sp-pink-bg); border: 0; border-radius: var(--sp-r-md); padding: 6px 11px; min-height: 32px; cursor: pointer; transition: transform var(--sp-dur-fast) var(--sp-ease); }
.sp-add:active { transform: scale(0.97); }
.sp-table-wrap { overflow-x: auto; }
.sp-et { width: 100%; min-width: 640px; border-collapse: separate; border-spacing: 0; font-size: 13.5px; }
.sp-et th { font: 800 11px var(--sp-font-ui); letter-spacing: 0.07em; text-transform: uppercase; color: var(--sp-text-muted); text-align: left; padding: 8px 16px; border-top: 1px solid var(--sp-hair); border-bottom: 1px solid var(--sp-hair); background: rgba(255, 255, 255, 0.3); white-space: nowrap; }
.sp-et td { padding: 10px 16px; border-bottom: 1px solid var(--sp-hair); vertical-align: middle; }
.sp-et tr:last-child td { border-bottom: 0; }
.sp-et .r { text-align: right; }
.sp-et tbody tr { transition: background-color var(--sp-dur) var(--sp-ease); }
.sp-et tr.is-editing td { background: rgba(255, 255, 255, 0.75); }
.sp-row-actions { display: inline-flex; gap: 2px; opacity: 0; transition: opacity 150ms var(--sp-ease); }
.sp-et tr:focus-within .sp-row-actions, .sp-et tr.is-editing .sp-row-actions { opacity: 1; }
@media (hover: hover) and (pointer: fine) {
  .sp-et tbody tr:hover { background: rgba(255, 255, 255, 0.55); }
  .sp-et tbody tr:hover .sp-row-actions { opacity: 1; }
}
@media (hover: none) { .sp-row-actions { opacity: 1; } }
.sp-en { font-weight: 600; color: var(--sp-text); display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
.sp-src { font: 700 11px var(--sp-font-ui); color: var(--sp-blue-ink); background: var(--sp-blue-bg); padding: 1px 6px; border-radius: 6px; }
.sp-date { color: var(--sp-text-muted); font-weight: 500; white-space: nowrap; }
.sp-date small { display: block; font-size: 12px; font-weight: 600; }
.sp-frac { font-weight: 700; white-space: nowrap; }
.sp-frac span { color: var(--sp-text-muted); font-weight: 500; }
.sp-gp { display: inline-block; min-width: 58px; text-align: center; font: 800 13px var(--sp-font-ui); padding: 4px 9px; border-radius: 9px; }
.sp-gp--success { background: var(--sp-success-bg); color: var(--sp-success); }
.sp-gp--warn { background: var(--sp-warn-bg); color: var(--sp-warn); }
.sp-gp--danger { background: var(--sp-danger-bg); color: var(--sp-danger); }
.sp-gp--pending { background: transparent; border: 1.5px dashed var(--sp-field-border); color: var(--sp-text-muted); font-weight: 700; }
.sp-gp-trans { display: inline-flex; align-items: center; gap: 6px; }
.sp-gp-trans__raw { font-size: 12px; color: var(--sp-text-muted); }
.sp-score-pair { display: inline-flex; align-items: center; gap: 4px; }
.sp-score-pair input { width: 64px; text-align: right; }
.sp-cat__empty { padding: 4px 16px 16px; color: var(--sp-text-muted); font-size: 13px; }
.sp-single { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 14px; padding: 2px 16px 14px 34px; color: var(--sp-text-muted); font-weight: 600; }
.sp-single .sp-input { width: 84px; text-align: center; }
.sp-single__note { margin-left: auto; font-size: 12.5px; }
.sp-shared { margin: 0 16px 14px; font-size: 12.5px; color: var(--sp-pink-ink); background: var(--sp-pink-bg); border-radius: var(--sp-r-md); padding: 8px 12px; display: flex; align-items: center; gap: 8px; }
```

- [ ] **Step 2: GradePill**

`src/components/studypulse/subject/GradePill.tsx`:
```tsx
import { transmute, type TransmutationTable } from '@/lib/transmutation';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import type { EntryRow } from '@/lib/studypulse/types';

/** Grade pill: raw %, or "raw → transmuted" when transmutation is on; dashed "Pending" when ungraded. */
export default function GradePill({ row, transTable, transmutationOn }: {
  row: Pick<EntryRow, 'grade' | 'score' | 'items'>; transTable: TransmutationTable | null; transmutationOn: boolean;
}) {
  const tg = transmutationOn && transTable ? transmute(row.score, row.items, transTable) : null;
  const shown = tg ?? row.grade;
  if (shown === null) return <span className="sp-gp sp-gp--pending">Pending</span>;
  const tone = gradeTone(shown);
  const pill = <span className={`sp-gp sp-gp--${tone === 'none' ? 'pending' : tone} sp-num`}>{tg !== null ? tg : f1(shown)}</span>;
  if (tg === null || row.grade === null) return pill;
  return <span className="sp-gp-trans sp-num"><span className="sp-gp-trans__raw">{f1(row.grade)} →</span>{pill}</span>;
}
```

- [ ] **Step 3: EntryTable**

`src/components/studypulse/subject/EntryTable.tsx`. This ports the row logic from the old `EntrySection`/`CustomEntrySection`: `setField` with the Canvas confirm, `calcGrade`, `saveRow`, the edit snapshots and the delete confirm. Behaviour is unchanged; only the markup changes.
```tsx
'use client';

import { useCallback, useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import type { TransmutationTable } from '@/lib/transmutation';
import type { EntryRow } from '@/lib/studypulse/types';
import { calcGrade } from '@/lib/studypulse/grades';
import { dueNote, shortDate, submittedNote, todayManila } from '@/lib/studypulse/ui/format';
import GradePill from './GradePill';

export interface EntryPersistence {
  /** Create or update; resolves to the entry id. Throws with a message on failure. */
  save: (row: EntryRow, doneAt: string | null) => Promise<number>;
  remove: (row: EntryRow) => Promise<void>;
}
export type TypeColumn = { kind: 'select'; options: string[] } | { kind: 'index' };

const NOTE_CLASS = { muted: 'sp-tone-muted', warn: 'sp-tone-warn', danger: 'sp-tone-danger' } as const;

export function useEntryEditing(entries: EntryRow[], onChange: (rows: EntryRow[]) => void, persistence: EntryPersistence) {
  const [editingIds, setEditingIds] = useState<Set<number>>(new Set());
  const [snapshots, setSnapshots] = useState<Record<number, EntryRow>>({});
  const clearEdit = (id: number) => {
    setEditingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    setSnapshots(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const setField = useCallback((idx: number, field: keyof EntryRow, val: string) => {
    const row = entries[idx];
    if (field === 'score' && row.canvas_linked) {
      if (!window.confirm('This score comes from Canvas. It will be overwritten by Canvas on the next sync — edit anyway?')) return;
    }
    onChange(entries.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, [field]: val };
      if (field === 'score' || field === 'items') {
        next.grade = calcGrade(field === 'score' ? val : r.score, field === 'items' ? val : r.items);
        if (next.grade !== null) next.status = 'Done';
      }
      return next;
    }));
  }, [entries, onChange]);

  const saveRow = useCallback(async (idx: number): Promise<boolean> => {
    const row = entries[idx];
    const today = todayManila();
    const validAc = row.accomplished_at && row.accomplished_at <= today ? row.accomplished_at : null;
    const doneAt = row.status === 'Done' ? (validAc || today) : null;
    if (!row.name.trim()) { alert('Please enter a name.'); return false; }
    onChange(entries.map((r, i) => (i === idx ? { ...r, saving: true } : r)));
    try {
      const id = await persistence.save(row, doneAt);
      onChange(entries.map((r, i) => (i === idx ? { ...r, id, saving: false, accomplished_at: doneAt ?? '' } : r)));
      return true;
    } catch (err) {
      alert('Save failed: ' + (err as Error).message);
      onChange(entries.map((r, i) => (i === idx ? { ...r, saving: false } : r)));
      return false;
    }
  }, [entries, onChange, persistence]);

  const enterEdit = (idx: number) => {
    const row = entries[idx];
    setEditingIds(prev => new Set([...prev, row.id]));
    setSnapshots(prev => ({ ...prev, [row.id]: { ...row } }));
  };
  const cancelEdit = (idx: number) => {
    const row = entries[idx];
    const snap = snapshots[row.id];
    if (snap) onChange(entries.map((r, i) => (i === idx ? snap : r)));
    clearEdit(row.id);
  };
  const saveAndExit = async (idx: number) => { const id = entries[idx].id; if (await saveRow(idx)) clearEdit(id); };
  const deleteRow = async (idx: number) => {
    const row = entries[idx];
    if (!row.id) { onChange(entries.filter((_, i) => i !== idx)); return; }
    if (!confirm('Delete this entry?')) return;
    await persistence.remove(row);
    onChange(entries.filter((_, i) => i !== idx));
  };
  const isEditing = (row: EntryRow) => row.id === 0 || editingIds.has(row.id);

  return { setField, saveRow, enterEdit, cancelEdit, saveAndExit, deleteRow, isEditing };
}

export default function EntryTable({
  entries, onChange, persistence, typeColumn, transTable, transmutationOn,
}: {
  entries: EntryRow[];
  onChange: (rows: EntryRow[]) => void;
  persistence: EntryPersistence;
  typeColumn?: TypeColumn;
  transTable: TransmutationTable | null;
  transmutationOn: boolean;
}) {
  const ed = useEntryEditing(entries, onChange, persistence);
  const today = todayManila();

  return (
    <div className="sp-table-wrap">
      <table className="sp-et sp-num">
        <thead>
          <tr>
            <th style={{ width: '34%' }}>Name</th>
            {typeColumn && <th>{typeColumn.kind === 'index' ? '#' : 'Type'}</th>}
            <th>Due</th>
            <th>Submitted</th>
            <th className="r">Score</th>
            <th className="r">{transmutationOn ? 'Raw → Trans.' : 'Grade'}</th>
            <th className="r" style={{ width: 84 }}><span className="sp-sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((row, idx) => {
            const editing = ed.isEditing(row);
            const done = row.status === 'Done' || row.grade !== null;
            const due = dueNote(row.deadline, today, done);
            const ac = row.accomplished_at && row.accomplished_at <= today ? row.accomplished_at : '';
            const sub = submittedNote(row.deadline, ac);
            return (
              <tr key={row.id || `new-${idx}`} className={editing ? 'is-editing' : undefined}>
                <td>
                  {editing
                    ? <input className="sp-input sp-input--sm" aria-label="Name" value={row.name} placeholder="Name…" onChange={e => ed.setField(idx, 'name', e.target.value)} />
                    : <span className="sp-en">{row.name || '—'}{row.canvas_linked && <span className="sp-src">Canvas</span>}</span>}
                </td>
                {typeColumn && (
                  <td>
                    {typeColumn.kind === 'index' ? <span className="sp-tone-muted">#{idx + 1}</span>
                      : editing ? (
                        <select className="sp-input sp-input--sm" aria-label="Type" value={row.specificType} onChange={e => ed.setField(idx, 'specificType', e.target.value)}>
                          {typeColumn.options.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      ) : <span className="sp-date">{row.specificType || '—'}</span>}
                  </td>
                )}
                <td>
                  {editing
                    ? <input type="date" className="sp-input sp-input--sm" aria-label="Due date" value={row.deadline} onChange={e => ed.setField(idx, 'deadline', e.target.value)} />
                    : <span className="sp-date">{row.deadline ? shortDate(row.deadline, today) : '—'}{due && <small className={NOTE_CLASS[due.tone]}>{due.text}</small>}</span>}
                </td>
                <td><span className="sp-date">{ac ? shortDate(ac, today) : '—'}{sub && <small className={NOTE_CLASS[sub.tone]}>{sub.text}</small>}</span></td>
                <td className="r">
                  {editing ? (
                    <span className="sp-score-pair">
                      <input type="number" step="0.01" min="0" className="sp-input sp-input--sm" aria-label="Score" value={row.score} placeholder="—" onChange={e => ed.setField(idx, 'score', e.target.value)} />
                      <span className="sp-tone-muted">/</span>
                      <input type="number" step="0.01" min="0.01" className="sp-input sp-input--sm" aria-label="Items" value={row.items} placeholder="—" onChange={e => ed.setField(idx, 'items', e.target.value)} />
                    </span>
                  ) : <span className="sp-frac">{row.score || '—'} <span>/ {row.items || '—'}</span></span>}
                </td>
                <td className="r"><GradePill row={row} transTable={transTable} transmutationOn={transmutationOn} /></td>
                <td className="r">
                  <span className="sp-row-actions">
                    {editing ? (
                      <>
                        <button type="button" className="sp-icon-btn sp-icon-btn--ok sp-focus-ring" aria-label="Save" disabled={!!row.saving} onClick={() => (row.id === 0 ? ed.saveRow(idx) : ed.saveAndExit(idx))}><Check size={15} /></button>
                        <button type="button" className="sp-icon-btn sp-focus-ring" aria-label="Cancel" onClick={() => (row.id === 0 ? ed.deleteRow(idx) : ed.cancelEdit(idx))}><X size={15} /></button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="sp-icon-btn sp-focus-ring" aria-label={`Edit ${row.name}`} onClick={() => ed.enterEdit(idx)}><Pencil size={14} /></button>
                        <button type="button" className="sp-icon-btn sp-icon-btn--danger sp-focus-ring" aria-label={`Delete ${row.name}`} onClick={() => ed.deleteRow(idx)}><Trash2 size={14} /></button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: SingletonScore**

`src/components/studypulse/subject/SingletonScore.tsx`:
```tsx
'use client';

import { Check, Pencil, Trash2, X } from 'lucide-react';
import type { TransmutationTable } from '@/lib/transmutation';
import type { EntryRow } from '@/lib/studypulse/types';
import { shortDate, todayManila } from '@/lib/studypulse/ui/format';
import GradePill from './GradePill';
import { useEntryEditing, type EntryPersistence } from './EntryTable';

const blank = (name: string): EntryRow => ({
  id: 0, name, specificType: '', urgency: 'Low', status: 'Pending', deadline: '', accomplished_at: '', score: '', items: '', grade: null,
});

/** A single-score category (an exam): an inline score row instead of a one-row table (spec §6.4). */
export default function SingletonScore({
  name, entries, onChange, persistence, transTable, transmutationOn,
}: {
  name: string; entries: EntryRow[]; onChange: (rows: EntryRow[]) => void; persistence: EntryPersistence;
  transTable: TransmutationTable | null; transmutationOn: boolean;
}) {
  const rows = entries.length ? entries.slice(0, 1) : [blank(name)];
  const change = (next: EntryRow[]) => onChange(next);
  const ed = useEntryEditing(rows, change, persistence);
  const row = rows[0];
  const editing = ed.isEditing(row);
  const today = todayManila();

  return (
    <div className="sp-single sp-num">
      {editing ? (
        <>
          <span>Score</span>
          <input className="sp-input sp-input--sm" type="number" step="0.01" min="0" aria-label={`${name} score`} placeholder="—" value={row.score} onChange={e => ed.setField(0, 'score', e.target.value)} />
          <span className="sp-tone-muted">/</span>
          <input className="sp-input sp-input--sm" type="number" step="0.01" min="0.01" aria-label={`${name} items`} placeholder="100" value={row.items} onChange={e => ed.setField(0, 'items', e.target.value)} />
          <input className="sp-input sp-input--sm" style={{ width: 150 }} type="date" aria-label={`${name} date`} value={row.deadline} onChange={e => ed.setField(0, 'deadline', e.target.value)} />
          <button type="button" className="sp-add sp-focus-ring" disabled={!!row.saving} onClick={() => (row.id === 0 ? ed.saveRow(0) : ed.saveAndExit(0))}><Check size={14} /> Save</button>
          {row.id !== 0 && <button type="button" className="sp-icon-btn sp-focus-ring" aria-label="Cancel" onClick={() => ed.cancelEdit(0)}><X size={15} /></button>}
        </>
      ) : (
        <>
          <span className="sp-frac">{row.score || '—'} <span>/ {row.items || '—'}</span></span>
          <GradePill row={row} transTable={transTable} transmutationOn={transmutationOn} />
          <span className="sp-row-actions" style={{ opacity: 1 }}>
            <button type="button" className="sp-icon-btn sp-focus-ring" aria-label={`Edit ${name}`} onClick={() => ed.enterEdit(0)}><Pencil size={14} /></button>
            <button type="button" className="sp-icon-btn sp-icon-btn--danger sp-focus-ring" aria-label={`Delete ${name}`} onClick={() => ed.deleteRow(0)}><Trash2 size={14} /></button>
          </span>
        </>
      )}
      {row.deadline && !editing && <span className="sp-single__note sp-tone-muted">Scheduled {shortDate(row.deadline, today)}</span>}
    </div>
  );
}
```
Note: when there are no entries, `rows` is a synthetic blank with `id: 0`, so it renders in edit mode. Saving calls `onChange([savedRow])`, which persists it into the parent's entries.

- [ ] **Step 5: CategorySection**

`src/components/studypulse/subject/CategorySection.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { ChevronDown, Link2, Plus } from 'lucide-react';
import type { TransmutationTable } from '@/lib/transmutation';
import type { EntryRow } from '@/lib/studypulse/types';
import { averageOf, entryHasGrade } from '@/lib/studypulse/periodModel';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import EntryTable, { type EntryPersistence, type TypeColumn } from './EntryTable';
import SingletonScore from './SingletonScore';

export interface CategorySectionProps {
  name: string;
  weight: number | null;
  color: string;
  noun: string;
  singleton: boolean;
  entries: EntryRow[];
  onChange: (rows: EntryRow[]) => void;
  persistence: EntryPersistence;
  typeColumn?: TypeColumn;
  defaultType?: string;
  transTable: TransmutationTable | null;
  transmutationOn: boolean;
  sharedFrom?: { periodName: string; grade: number } | null;
}

export default function CategorySection(p: CategorySectionProps) {
  const [open, setOpen] = useState(true);
  const table = p.transmutationOn ? p.transTable : null;
  const avg = averageOf(p.entries, table);
  const graded = p.entries.filter(entryHasGrade).length;
  const tone = gradeTone(avg);

  const addRow = () => {
    setOpen(true);
    p.onChange([...p.entries, {
      id: 0, name: '', specificType: p.defaultType ?? '', urgency: 'Low', status: 'Pending',
      deadline: '', accomplished_at: '', score: '', items: '', grade: null,
    }]);
  };

  return (
    <section className="sp-item sp-cat" aria-label={p.name}>
      <div className="sp-cat__head">
        <span className="sp-cat__swatch" style={{ background: p.color }} aria-hidden />
        <span className="sp-cat__name">{p.name}</span>
        {p.weight !== null && <span className="sp-chip sp-chip--blue sp-num">{p.weight}%</span>}
        <span className="sp-cat__prog sp-num">{p.singleton ? 'single score' : `${graded} of ${p.entries.length} graded`}</span>
        <div className="sp-cat__right">
          <span className={`sp-avg sp-avg--${tone} sp-num`}>{avg === null ? 'Not yet' : <>{f1(avg)}<small>avg</small></>}</span>
          {!p.singleton && <button type="button" className="sp-add sp-focus-ring" onClick={addRow}><Plus size={14} /> Add {p.noun.toLowerCase()}</button>}
          {!p.singleton && (
            <button type="button" className="sp-icon-btn sp-focus-ring" aria-expanded={open} aria-label={open ? `Collapse ${p.name}` : `Expand ${p.name}`} onClick={() => setOpen(o => !o)}>
              <ChevronDown size={16} className={`sp-chev${open ? ' is-open' : ''}`} />
            </button>
          )}
        </div>
      </div>
      {p.sharedFrom && !p.entries.some(entryHasGrade) && (
        <div className="sp-shared"><Link2 size={14} aria-hidden /> Using {p.sharedFrom.periodName}&apos;s score ({f1(p.sharedFrom.grade)}). Add your own to override it for this period.</div>
      )}
      {p.singleton ? (
        <SingletonScore name={p.name} entries={p.entries} onChange={p.onChange} persistence={p.persistence} transTable={p.transTable} transmutationOn={p.transmutationOn} />
      ) : (
        <div className={`sp-collapse${open ? ' is-open' : ''}`}>
          <div className="sp-collapse__inner">
            {p.entries.length === 0
              ? <p className="sp-cat__empty">No {p.noun.toLowerCase()} entries yet.</p>
              : <EntryTable entries={p.entries} onChange={p.onChange} persistence={p.persistence} typeColumn={p.typeColumn} transTable={p.transTable} transmutationOn={p.transmutationOn} />}
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Wire into SubjectCardView**

In `SubjectCardView.tsx`:

(a) Add persistence factories near the top of `SubjectCardViewInner`. They wrap the exact fetch calls the old sections made:
```tsx
  const customPersistence = useCallback((catId: number, periodId: number): EntryPersistence => ({
    save: async (row, doneAt) => {
      const res = await fetch('/api/studypulse/grade-entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_id: row.id || null, user_subject_id: userSubjectId, cat_id: catId, period_id: periodId, is_lab: 0,
          name: row.name.trim(), urgency: row.urgency, status: row.status, deadline: row.deadline,
          score: row.score || null, items: row.items || null, grade: row.grade, accomplished_at: doneAt,
        }),
      });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error ?? 'Save failed');
      return data.entry_id as number;
    },
    remove: async row => { await fetch(`/api/studypulse/grade-entries/${row.id}`, { method: 'DELETE' }); },
  }), [userSubjectId]);

  const legacyPersistence = useCallback((type: SectionType): EntryPersistence => ({
    save: async (row, doneAt) => {
      const res = await fetch('/api/studypulse/entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, entry_id: row.id || null, user_subject_id: userSubjectId, name: row.name.trim(), specific_type: row.specificType,
          urgency: row.urgency, status: row.status, deadline: row.deadline, score: row.score || null,
          items: row.items || null, grade: row.grade, accomplished_at: doneAt,
        }),
      });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error ?? 'Save failed');
      return data.entry_id as number;
    },
    remove: async row => { await fetch(`/api/studypulse/entries/${row.id}?type=${type}`, { method: 'DELETE' }); },
  }), [userSubjectId]);
```
Make sure `useCallback` is imported. Note the returned persistence objects change identity per render; that's fine because `useEntryEditing` only reads them inside handlers.

(b) In the custom-mode render, replace `<CustomEntrySection … />` with:
```tsx
<CategorySection
  key={cat.cat_id}
  name={cat.name}
  weight={Number(cat.weight)}
  color={categoryColor(ci)}
  noun={cat.is_singleton === 1 ? cat.name : nounFor(cat.name)}
  singleton={cat.is_singleton === 1}
  entries={catEntries[cat.cat_id] ?? []}
  onChange={rows => handleCatEntriesChange(cat.cat_id, rows)}
  persistence={customPersistence(cat.cat_id, period.period_id)}
  transTable={transTable}
  transmutationOn={transmutationOn}
  sharedFrom={sharedFrom}
/>
```
Change the enclosing `period.categories.map(cat => {` to `period.categories.map((cat, ci) => {`. `catEntries` is now the single source of truth. The old per-section local `entries` state is gone, and `initialGradeEntries` already seeds `catEntries`.

(c) In legacy mode, wrap the three sections in one `<div className="sp-panel" style={{ padding: '20px 22px', marginBottom: 18 }}>` and render:
```tsx
<CategorySection name="Activities" weight={24} color={categoryColor(0)} noun="Activity" singleton={false}
  entries={activities} onChange={setActivities} persistence={legacyPersistence('activities')}
  typeColumn={{ kind: 'select', options: ['Seatwork', 'Performance Task', 'Take-Home Activity', 'Laboratory Activity', 'Technical Assessment'] }}
  defaultType="Seatwork" transTable={transTable} transmutationOn={transmutationOn} />
<CategorySection name="Quizzes" weight={36} color={categoryColor(1)} noun="Quiz" singleton={false}
  entries={quizzes} onChange={setQuizzes} persistence={legacyPersistence('quizzes')}
  typeColumn={{ kind: 'index' }} transTable={transTable} transmutationOn={transmutationOn} />
<CategorySection name="Exams" weight={40} color={categoryColor(2)} noun="Exam" singleton={false}
  entries={exams} onChange={setExams} persistence={legacyPersistence('exams')}
  typeColumn={{ kind: 'select', options: ['Midterm', 'Final Exam'] }}
  defaultType="Midterm" transTable={transTable} transmutationOn={transmutationOn} />
```
Then add the imports `CategorySection`, `type EntryPersistence` (from `./subject/EntryTable`), `categoryColor` and `nounFor`. Delete `MiniGauge`, `GradeCell`, `EntrySection` and `CustomEntrySection`.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` (0 errors) and `node scripts/wb-style-gate.mjs src/components/studypulse/subject/*.tsx src/app/studypulse/studypulse.css` (pass).

Live in Playwright, on one custom-preset subject and one legacy subject:
- Add, save, edit, cancel and delete an entry; reload and confirm it persisted.
- Editing a Canvas-linked score still prompts.
- A singleton exam saves its score inline.
- The transmute toggle shows "raw → trans" pills.
- Row actions appear on hover and keyboard focus.
- At 390px the table scrolls inside its card and the page does not scroll sideways (`document.documentElement.scrollWidth <= innerWidth`).

- [ ] **Step 8: Snapshot**

`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t7 "sp: entry tables + category sections"`

---

### Task 8: Header, toolbar, period tabs, period panel

**Files:**
- Create: `src/components/studypulse/subject/SubjectHeader.tsx`, `SubjectToolbar.tsx`, `PeriodTabs.tsx`, `PeriodPanel.tsx`
- Modify: `src/components/studypulse/SubjectCardView.tsx`
  - Compute `periods`/`projections` with `periodModel` and `projection`.
  - Replace the header JSX, the "Period filter bar + action buttons" JSX, the `selectedPeriodIds` state and `togglePeriod`, `pillMode` and `cyclePillMode`, and all of the `header*` memos and callbacks (`headerOwnGrade`, `headerOwnHasData`, `headerLinkGroupSource`, `headerHasData`, `headerGetGrade`, `headerPeriodGrades`, `headerFinalPeriodIdx`, `headerFinalGrade`).
  - **Keep** `linkGroupSourceInfo`, which the shared-score note still needs.
  - Change the outer wrapper to `className="vb-bg sp-page"` with an inner `sp-wrap`.
- Modify: `src/app/studypulse/studypulse.css` (append the "Subject page" section)

**Interfaces:**
- Consumes: `buildCustomPeriods`, `buildLegacyPeriods`, `EMPTY_PREFS`, `projectPeriod`, `subjectFinal`, `toGradeInfo`, `SpSegmented`, `CategorySection`.
- Produces, for Tasks 9 and 10: these values in `SubjectCardViewInner`:
  - `periods: PeriodInput[]`
  - `projections: PeriodProjection[]`
  - `finalGrade: number | null`
  - `scale: GradeScale | null`
  - `plannerOpen`, `setPlannerOpen`

- [ ] **Step 1: Append CSS**

```css
/* ── Subject page (spec §6.2–6.4, mockup v4 §2–3) ── */
.sp-sh { padding: 24px 28px; }
.sp-crumb { display: inline-flex; align-items: center; gap: 6px; font: 700 12.5px var(--sp-font-ui); color: var(--sp-blue-ink); text-decoration: none; border-radius: 6px; }
.sp-sh__grid { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px 24px; align-items: end; margin-top: 12px; }
.sp-sh__title { font: 800 clamp(24px, 3vw, 32px)/1.1 var(--sp-font-head); letter-spacing: -0.015em; margin: 0; overflow-wrap: anywhere; }
.sp-sh__code { display: flex; align-items: center; gap: 8px; margin: 8px 0 14px; color: var(--sp-text-muted); font-weight: 600; }
.sp-code-tag { font: 800 12px var(--sp-font-mono); letter-spacing: 0.05em; background: rgba(45, 55, 72, 0.08); color: var(--sp-text); padding: 3px 8px; border-radius: 7px; }
.sp-metas { display: flex; flex-wrap: wrap; gap: 6px; }
.sp-meta { display: inline-flex; align-items: center; gap: 6px; font: 600 12.5px var(--sp-font-ui); color: var(--sp-text-muted); background: rgba(255, 255, 255, 0.55); border: 1px solid rgba(255, 255, 255, 0.75); padding: 5px 10px; border-radius: var(--sp-r-pill); }
.sp-meta--preset { color: var(--sp-pink-ink); }
.sp-tiles { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
.sp-tile { width: 150px; padding: 12px 14px; border-radius: 16px; }
.sp-tile__head { display: flex; justify-content: space-between; align-items: center; }
.sp-tile__big { font: 800 28px/1 var(--sp-font-head); margin: 8px 0 4px; }
.sp-tile__sub { font: 700 12px var(--sp-font-ui); color: var(--sp-text-muted); }
.sp-tile--final { background: linear-gradient(160deg, rgba(255, 255, 255, 0.88), rgba(253, 228, 239, 0.72)); border: 1px solid rgba(240, 103, 157, 0.35); }
.sp-tile--final .sp-eyebrow { color: var(--sp-pink-ink); }
.sp-unit-switch { display: flex; justify-content: flex-end; margin-top: 8px; }
.sp-sh__error { margin-top: 12px; padding: 10px 14px; border-radius: var(--sp-r-md); background: var(--sp-danger-bg); color: var(--sp-danger); font-size: 13px; font-weight: 600; }

.sp-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 18px 0 16px; }
.sp-toolbar__right { margin-left: auto; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sp-switch { display: inline-flex; align-items: center; gap: 8px; }
.sp-switch__track { width: 30px; height: 18px; border-radius: var(--sp-r-pill); background: rgba(120, 130, 150, 0.35); position: relative; transition: background-color 200ms var(--sp-ease); flex-shrink: 0; }
.sp-switch__track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--sp-surface); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); transition: transform 200ms var(--sp-ease); }
.sp-switch[aria-checked='true'] .sp-switch__track { background: var(--sp-blue-strong); }
.sp-switch[aria-checked='true'] .sp-switch__track::after { transform: translateX(12px); }
.sp-menu { position: relative; }
.sp-menu__pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; min-width: 210px; padding: 6px; border-radius: var(--sp-r-lg); background: var(--sp-surface); box-shadow: 0 18px 40px -16px rgba(31, 38, 68, 0.4); border: 1px solid var(--sp-hair); transform-origin: top right; animation: sp-pop 160ms var(--sp-ease); }
.sp-menu__item { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: 9px; color: var(--sp-text); font: 600 13px var(--sp-font-ui); text-decoration: none; }
@media (hover: hover) and (pointer: fine) { .sp-menu__item:hover { background: var(--sp-blue-bg); } }
@keyframes sp-pop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }

.sp-ptabs { position: relative; display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 4px; border-radius: 16px; background: rgba(255, 255, 255, 0.4); border: 1px solid rgba(255, 255, 255, 0.7); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.sp-ptab { position: relative; z-index: 1; border: 0; background: transparent; cursor: pointer; padding: 8px 14px; min-height: 36px; border-radius: 12px; display: inline-flex; align-items: center; gap: 9px; font: 700 13px var(--sp-font-ui); color: var(--sp-text-muted); transition: color var(--sp-dur) var(--sp-ease); }
.sp-ptab[aria-selected='true'] { color: var(--sp-text); }
.sp-ptab__g { font: 800 11.5px var(--sp-font-ui); padding: 2px 7px; border-radius: var(--sp-r-pill); background: var(--sp-neutral-bg); color: var(--sp-text-muted); }
.sp-ptab__g--success { background: var(--sp-success-bg); color: var(--sp-success); }
.sp-ptab__g--warn { background: var(--sp-warn-bg); color: var(--sp-warn); }
.sp-ptab__g--danger { background: var(--sp-danger-bg); color: var(--sp-danger); }
.sp-ptab-sep { width: 1px; height: 20px; background: var(--sp-hair); align-self: center; margin: 0 2px; }
.sp-pind { position: absolute; z-index: 0; top: 4px; left: 0; height: calc(100% - 8px); border-radius: 12px; background: var(--sp-surface); box-shadow: var(--sp-shadow-knob); pointer-events: none; }
.sp-pind.is-ready { transition: transform 320ms var(--sp-ease); }

.sp-period { padding: 22px 24px; margin-bottom: 18px; }
.sp-period__head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 12px; margin-bottom: 6px; }
.sp-period__title { font: 800 20px var(--sp-font-head); margin: 0; display: flex; align-items: center; gap: 9px; }
.sp-period__weights { margin-left: auto; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; min-width: min(340px, 100%); }
.sp-wbar { display: flex; gap: 2px; height: 8px; width: 100%; border-radius: var(--sp-r-pill); overflow: hidden; }
.sp-wbar i { display: block; height: 100%; }
.sp-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font: 600 12px var(--sp-font-ui); color: var(--sp-text-muted); justify-content: flex-end; }
.sp-legend span { display: inline-flex; align-items: center; gap: 5px; }
.sp-legend i { width: 8px; height: 8px; border-radius: 3px; }

@media (max-width: 860px) {
  .sp-sh__grid { grid-template-columns: 1fr; }
  .sp-tiles, .sp-unit-switch { justify-content: flex-start; }
  .sp-toolbar__right { margin-left: 0; }
  .sp-period__weights { margin-left: 0; align-items: flex-start; }
  .sp-legend { justify-content: flex-start; }
}
@media (max-width: 560px) {
  .sp-sh, .sp-period { padding: 18px 16px; }
  .sp-tile { width: calc(50% - 5px); }
}
```

- [ ] **Step 2: PeriodTabs**

`src/components/studypulse/subject/PeriodTabs.tsx`:
```tsx
'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays } from 'lucide-react';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';

export type PeriodSelection = number | 'all';

/** Single-select period tabs plus "Both"/"All" with a sliding indicator (spec §6.3). */
export default function PeriodTabs({ periods, value, onChange }: {
  periods: Array<{ id: number; name: string; current: number | null }>;
  value: PeriodSelection;
  onChange: (v: PeriodSelection) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [ind, setInd] = useState<{ x: number; w: number; ready: boolean }>({ x: 0, w: 0, ready: false });
  const order: PeriodSelection[] = [...periods.map(p => p.id), 'all'];
  const active = Math.max(0, order.indexOf(value));

  useLayoutEffect(() => {
    const measure = () => {
      const t = tabs.current[active];
      if (!t) return;
      setInd(prev => ({ x: t.offsetLeft, w: t.offsetWidth, ready: prev.w > 0 }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [active, periods]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + order.length) % order.length;
    onChange(order[n]);
    tabs.current[n]?.focus();
  };

  return (
    <div ref={wrap} className="sp-ptabs" role="tablist" aria-label="Grading periods">
      <span className={`sp-pind${ind.ready ? ' is-ready' : ''}`} style={{ width: ind.w, transform: `translateX(${ind.x}px)` }} aria-hidden />
      {periods.map((p, i) => {
        const tone = gradeTone(p.current);
        return (
          <button key={p.id} ref={el => { tabs.current[i] = el; }} type="button" role="tab" aria-selected={value === p.id}
            tabIndex={i === active ? 0 : -1} className="sp-ptab sp-focus-ring" onClick={() => onChange(p.id)} onKeyDown={e => onKey(e, i)}>
            <CalendarDays size={15} aria-hidden />{p.name}
            <span className={`sp-ptab__g sp-num${tone !== 'none' ? ` sp-ptab__g--${tone}` : ''}`}>{p.current === null ? '—' : f1(p.current)}</span>
          </button>
        );
      })}
      <span className="sp-ptab-sep" aria-hidden />
      <button ref={el => { tabs.current[periods.length] = el; }} type="button" role="tab" aria-selected={value === 'all'}
        tabIndex={active === periods.length ? 0 : -1} className="sp-ptab sp-focus-ring" onClick={() => onChange('all')} onKeyDown={e => onKey(e, periods.length)}>
        {periods.length === 2 ? 'Both' : 'All'}
      </button>
    </div>
  );
}
```
`sp-pind` is a `transform` animation with no layout transition. `width` changes instantly (style-gate rule).

- [ ] **Step 3: SubjectHeader**

`src/components/studypulse/subject/SubjectHeader.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, Flag, GraduationCap, Hash, Layers } from 'lucide-react';
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import SpSegmented from '../ui/SpSegmented';

type Unit = 'gwa' | 'pct' | 'letter';
const UNIT_KEY = 'sp-grade-unit';
const TONE = { success: 'sp-tone-success', warn: 'sp-tone-warn', danger: 'sp-tone-danger', none: 'sp-tone-muted' } as const;

export interface HeaderTile { key: string; label: string; value: number | null; final?: boolean }

function display(v: number | null, unit: Unit, scale: GradeScale | null): { big: string; sub: string } {
  if (v === null) return { big: '—', sub: 'No grades yet' };
  if (!scale) return { big: f1(v), sub: '' };
  const gi = toGradeInfo(v, scale);
  const lt = scale === '4pt' ? `${gi.letter} · ${gi.description}` : gi.description;
  if (unit === 'gwa') return { big: gi.point.toFixed(2), sub: lt };
  if (unit === 'pct') return { big: f1(v), sub: lt };
  return { big: gi.letter, sub: gi.description };
}

export default function SubjectHeader({ subject, presetName, tiles, scale, transError }: {
  subject: { subject_name: string; course_code: string; section?: string | null; units: number; year_level: string; trimester: string };
  presetName: string | null;
  tiles: HeaderTile[];
  scale: GradeScale | null;
  transError: string | null;
}) {
  const [unit, setUnit] = useState<Unit>('gwa');
  useEffect(() => {
    try { const v = localStorage.getItem(UNIT_KEY); if (v === 'gwa' || v === 'pct' || v === 'letter') setUnit(v); } catch { /* storage blocked */ }
  }, []);
  const pick = (u: Unit) => { setUnit(u); try { localStorage.setItem(UNIT_KEY, u); } catch { /* storage blocked */ } };
  const effective: Unit = scale ? unit : 'pct';

  return (
    <header className="sp-panel sp-sh">
      <Link href="/studypulse/subjects" className="sp-crumb sp-focus-ring"><ArrowLeft size={14} /> My Subjects</Link>
      <div className="sp-sh__grid">
        <div style={{ minWidth: 0 }}>
          <h1 className="sp-sh__title">{subject.subject_name}</h1>
          <div className="sp-sh__code"><span className="sp-code-tag">{subject.course_code}</span>{subject.section && <span>Block {subject.section}</span>}</div>
          <div className="sp-metas">
            <span className="sp-meta"><Hash size={13} aria-hidden />{subject.units} unit{subject.units !== 1 ? 's' : ''}</span>
            {subject.year_level && <span className="sp-meta"><GraduationCap size={13} aria-hidden />{subject.year_level}</span>}
            {subject.trimester && <span className="sp-meta"><CalendarDays size={13} aria-hidden />{subject.trimester}</span>}
            {presetName && <span className="sp-meta sp-meta--preset"><Layers size={13} aria-hidden />{presetName}{scale ? ` (${scale === '4pt' ? '4.0' : '1.0'})` : ''}</span>}
          </div>
        </div>
        <div>
          <div className="sp-tiles sp-num">
            {tiles.map(t => {
              const d = display(t.value, effective, scale);
              return (
                <div key={t.key} className={`sp-item sp-tile${t.final ? ' sp-tile--final' : ''}`}>
                  <div className="sp-tile__head"><span className="sp-eyebrow">{t.label}</span>{t.final && <Flag size={13} className="sp-tone-muted" aria-hidden />}</div>
                  <div className={`sp-tile__big ${t.final ? '' : TONE[gradeTone(t.value)]}`}>{d.big}</div>
                  {d.sub && <div className="sp-tile__sub">{d.sub}</div>}
                </div>
              );
            })}
          </div>
          {scale && (
            <div className="sp-unit-switch">
              <SpSegmented size="sm" label="Grade display" value={unit} onChange={pick}
                options={[{ value: 'gwa', label: 'Grade pt' }, { value: 'pct', label: 'Percent' }, { value: 'letter', label: scale === '4pt' ? 'Letter' : 'Meaning' }]} />
            </div>
          )}
        </div>
      </div>
      {transError && <div className="sp-sh__error" role="alert">{transError}</div>}
    </header>
  );
}
```
For the 1.0 scale, `toGradeInfo().letter` is the point string. So the third option is labelled "Meaning", and `display` shows `gi.letter` (the point) as the big value with the description below. That is acceptable and needs no extra branch.

- [ ] **Step 4: SubjectToolbar (with the Canvas menu)**

`src/components/studypulse/subject/SubjectToolbar.tsx`:
```tsx
'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, Inbox, Megaphone, Settings2, Target } from 'lucide-react';

export default function SubjectToolbar({
  tabs, transmutationOn, transLoading, transError, onToggleTrans, plannerOpen, onTogglePlanner, isCustom, onGrading, userSubjectId,
}: {
  tabs?: ReactNode;
  transmutationOn: boolean; transLoading: boolean; transError: string | null; onToggleTrans: () => void;
  plannerOpen: boolean; onTogglePlanner: () => void;
  isCustom: boolean; onGrading: () => void; userSubjectId: number;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menu]);

  return (
    <div className="sp-toolbar">
      {tabs}
      <div className="sp-toolbar__right">
        <button type="button" role="switch" aria-checked={transmutationOn} disabled={transLoading}
          title={transError ?? 'Transmutation scale'} className="sp-btn sp-btn--ghost sp-switch sp-focus-ring" onClick={onToggleTrans}>
          <span className="sp-switch__track" aria-hidden />{transLoading ? 'Loading…' : 'Transmute'}
        </button>
        <button type="button" aria-expanded={plannerOpen} className={`sp-btn ${plannerOpen ? 'sp-btn--dark' : 'sp-btn--ghost'} sp-focus-ring`} onClick={onTogglePlanner}>
          <Target size={15} /> Target planner
        </button>
        <button type="button" className="sp-btn sp-btn--ghost sp-focus-ring" onClick={onGrading}>
          <Settings2 size={15} /> {isCustom ? 'Grading' : 'Set up grading'}
        </button>
        <div className="sp-menu" ref={menuRef}>
          <button type="button" aria-haspopup="menu" aria-expanded={menu} className="sp-btn sp-btn--ghost sp-focus-ring" onClick={() => setMenu(m => !m)}>
            <Inbox size={15} /> Canvas <ChevronDown size={14} className={`sp-chev${menu ? ' is-open' : ''}`} />
          </button>
          {menu && (
            <div className="sp-menu__pop" role="menu">
              <Link role="menuitem" className="sp-menu__item sp-focus-ring" href={`/studypulse/canvas?subject=${userSubjectId}&view=activity`}><Inbox size={15} /> Activity Bank</Link>
              <Link role="menuitem" className="sp-menu__item sp-focus-ring" href={`/studypulse/canvas?subject=${userSubjectId}&view=announcements`}><Megaphone size={15} /> Announcements</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: PeriodPanel**

`src/components/studypulse/subject/PeriodPanel.tsx`:
```tsx
import type { ReactNode } from 'react';
import { CalendarDays, Flag } from 'lucide-react';
import type { PeriodInput, PeriodProjection } from '@/lib/studypulse/projection';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';

export default function PeriodPanel({ period, proj, isFinal, children }: {
  period: PeriodInput; proj: PeriodProjection; isFinal: boolean; children: ReactNode;
}) {
  const tone = gradeTone(proj.current);
  const total = period.categories.reduce((s, c) => s + Math.max(0, c.weight), 0) || 1;
  return (
    <section className="sp-panel sp-period" aria-label={period.name}>
      <div className="sp-period__head">
        <h2 className="sp-period__title"><CalendarDays size={18} className="sp-tone-muted" aria-hidden />{period.name}</h2>
        {isFinal && <span className="sp-chip sp-chip--pink"><Flag size={12} aria-hidden /> Final</span>}
        <span className={`sp-chip sp-chip--${tone === 'none' ? 'neutral' : tone} sp-num`}>
          {proj.current === null ? 'No grades yet' : `${f1(proj.current)} · ${Math.round(proj.coverage)}% of grade in`}
        </span>
        <div className="sp-period__weights">
          <div className="sp-wbar" aria-hidden>
            {period.categories.map(c => <i key={c.key} style={{ width: `${(Math.max(0, c.weight) / total) * 100}%`, background: c.color }} />)}
          </div>
          <div className="sp-legend sp-num">
            {period.categories.map(c => <span key={c.key}><i style={{ background: c.color }} aria-hidden />{c.name} {c.weight}</span>)}
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 6: Rewire SubjectCardView**

In `SubjectCardViewInner`:

(a) Remove `selectedPeriodIds`, its effect and `togglePeriod`. Remove `pillMode`, `cyclePillMode` and every `header*` memo or callback. Add:
```tsx
  const [periodSel, setPeriodSel] = useState<PeriodSelection>('all');
  useEffect(() => { setPeriodSel('all'); }, [config?.preset_id]);
  const [plannerOpen, setPlannerOpen] = useState(false);

  const projTable = transmutationOn ? transTable : null;
  const periods = useMemo<PeriodInput[]>(() => (config
    ? buildCustomPeriods(config.preset, catEntries, EMPTY_PREFS, projTable)
    : buildLegacyPeriods(activities, quizzes, exams, EMPTY_PREFS, projTable)
  ), [config, catEntries, activities, quizzes, exams, projTable]);
  const projections = useMemo(() => periods.map(projectPeriod), [periods]);
  const finalMode = config?.preset.final_mode ?? null;
  const finalGrade = config ? subjectFinal(periods, finalMode) : null;
  const scale: GradeScale | null = config ? config.grade_scale : '4pt';
  const finalPeriodId = config?.preset.final_period_id ?? null;
```
Rename the old `showTarget` state to `plannerOpen` everywhere (it is replaced, not added twice). Keep `TargetGradePanel` rendering when `plannerOpen` until Task 10.

(b) Tiles:
```tsx
  const tiles: HeaderTile[] = config
    ? [
        ...config.preset.periods.map((p, i) => ({ key: `p${p.period_id}`, label: p.name, value: projections[i]?.current ?? null })),
        ...(finalMode ? [{ key: 'final', label: 'Final grade', value: finalGrade, final: true }] : []),
      ]
    : [{ key: 'overall', label: 'Overall', value: projections[0]?.current ?? null }];
```

(c) Render the page as:
```tsx
  <div className="vb-bg sp-page">
    <div className="sp-wrap">
      {showWizard && <GradingSetupWizard … />}   {/* unchanged props */}
      <SubjectHeader subject={subject} presetName={config?.preset.name ?? null} tiles={tiles} scale={scale} transError={transError} />
      <SubjectToolbar
        tabs={isCustomMode ? (
          <PeriodTabs value={periodSel} onChange={setPeriodSel}
            periods={config.preset.periods.map((p, i) => ({ id: p.period_id, name: p.name, current: projections[i]?.current ?? null }))} />
        ) : undefined}
        transmutationOn={transmutationOn} transLoading={transLoading} transError={transError} onToggleTrans={handleTransToggle}
        plannerOpen={plannerOpen} onTogglePlanner={() => setPlannerOpen(v => !v)}
        isCustom={isCustomMode} onGrading={() => setShowWizard(true)} userSubjectId={userSubjectId} />
      {plannerOpen && <TargetGradePanel … onClose={() => setPlannerOpen(false)} />}   {/* replaced in Task 10 */}
      {isCustomMode && (
        <>
          {config.preset.periods.map((period, pi) => (periodSel === 'all' || periodSel === period.period_id) && (
            <PeriodPanel key={period.period_id} period={periods[pi]} proj={projections[pi]} isFinal={finalPeriodId === period.period_id}>
              {period.categories.map((cat, ci) => { /* the Task 7 CategorySection block, unchanged */ })}
            </PeriodPanel>
          ))}
          <CustomGradeCalculator … />   {/* restyled in Task 9 */}
        </>
      )}
      {!isCustomMode && ( /* legacy block from Task 7, with its empty-state card restyled: */ )}
    </div>
  </div>
```
Legacy empty state (when `totalLegacy === 0 && !showWizard`):
```tsx
<div className="sp-panel" style={{ padding: '24px 28px', marginBottom: 18, textAlign: 'center' }}>
  <p className="sp-tone-muted" style={{ margin: '0 0 16px' }}>No entries yet. Set up a custom grading system, or use the default layout below.</p>
  <button type="button" className="sp-btn sp-btn--primary sp-focus-ring" onClick={() => setShowWizard(true)}><GraduationCap size={16} /> Set up grading system</button>
</div>
```
Add the imports: `SubjectHeader`, `type HeaderTile`, `SubjectToolbar`, `PeriodTabs`, `type PeriodSelection`, `PeriodPanel`, `buildCustomPeriods`, `buildLegacyPeriods`, `EMPTY_PREFS`, `projectPeriod`, `subjectFinal`, `type PeriodInput`, `GraduationCap` (lucide) and `type GradeScale`. The Suspense fallback becomes `<div className="vb-bg sp-page" />`.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` (0 errors). Run the style gate on the four new files plus `studypulse.css` (pass).

Live, compared against mockup v4 §2:
- The tabs slide with no jump on first paint.
- Arrow keys move between tabs.
- "Both" shows every period.
- The tab grades equal the period header chips and the header tiles.
- The Grade pt / Percent / Letter switch persists across reloads.
- The Canvas menu opens and closes with Esc and with an outside click.
- The transmute switch flips and its error shows in the header.
- At 390px the toolbar wraps and nothing overflows horizontally.

Record the header tile numbers before and after this task for one subject that has an ungraded category. They should now differ (graded-only), which is expected under D11. Put both values in the snapshot message.

- [ ] **Step 8: Snapshot**

`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t8 "sp: header tiles, toolbar, period tabs, period panels (graded-only current)"`

---

### Task 9: Grade summary (calculator restyle)

**Files:**
- Create: `src/components/studypulse/subject/GradeSummary.tsx`
- Modify: `src/components/studypulse/SubjectCardView.tsx`
  - Delete `CustomGradeCalculator`, `GradeCalculator`, `computeCollectiveGrade`, `gradeStyle`, `avgGrades`, `examAvg`, `examTransmuted`, `INPUT` and `GLASS`.
  - Remove `avgTransmuted` and `transmute` from the transmutation import if they become unused.
  - Render `GradeSummary` in their place.
- Modify: `studypulse.css` (append the "Grade summary" section)

**Interfaces:**
- Consumes: `periods`, `projections`, `finalGrade`, `scale`, `finalPeriodId`, `config` (Task 8); `legacyMidtermPeriod`, `projectPeriod`.
- Produces: `GradeSummary` with props `{ periods, projections, finalMode, finalGrade, finalPeriodKey, scale, transmutationOn, lab }` and `LegacyGradeSummary` with props `{ overall, overallProj, transmutationOn }`.

- [ ] **Step 1: Append CSS**

```css
/* ── Grade summary (spec §6.4 last bullet) ── */
.sp-sum { padding: 20px 22px; }
.sp-sum__head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.sp-sum__title { font: 800 17px var(--sp-font-head); margin: 0; display: flex; align-items: center; gap: 8px; flex-grow: 1; }
.sp-sum__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.sp-sum__col { padding: 14px; border-radius: var(--sp-r-item); }
.sp-sum__big { font: 800 32px/1 var(--sp-font-head); text-align: center; margin-top: 6px; }
.sp-sum__lt { font: 700 12.5px var(--sp-font-ui); text-align: center; margin-top: 4px; }
.sp-sum__rows { border-top: 1px solid var(--sp-hair); margin-top: 12px; padding-top: 10px; display: grid; gap: 8px; }
.sp-sum__row { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; }
.sp-sum__row b { font-weight: 700; }
.sp-sum__row small { display: block; font-size: 12px; color: var(--sp-text-muted); font-weight: 600; }
.sp-sum__row input { width: 72px; text-align: right; }
.sp-sum__final { margin-top: 14px; padding: 14px 18px; border-radius: var(--sp-r-item); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; background: var(--sp-pink-bg); }
.sp-sum__note { margin: 12px 0 0; font-size: 12.5px; color: var(--sp-text-muted); }
```

- [ ] **Step 2: Implement GradeSummary**

`src/components/studypulse/subject/GradeSummary.tsx`:
```tsx
'use client';

import { useMemo, useState } from 'react';
import { Calculator, Flag, RotateCcw } from 'lucide-react';
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';
import { projectPeriod, type PeriodInput, type PeriodProjection } from '@/lib/studypulse/projection';
import { legacyMidtermPeriod } from '@/lib/studypulse/periodModel';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import SpSegmented from '../ui/SpSegmented';

const TONE = { success: 'sp-tone-success', warn: 'sp-tone-warn', danger: 'sp-tone-danger', none: 'sp-tone-muted' } as const;
const letterLine = (v: number | null, scale: GradeScale | null) => (v !== null && scale ? (() => { const g = toGradeInfo(v, scale); return `${g.letter} · ${g.description}`; })() : '');
const dp = (v: number, transmuted: boolean) => (transmuted ? Math.round(v).toString() : f1(v));

/** Custom-preset summary: per-period current (graded-only, spec D11) with a category breakdown and an optional what-if. */
export default function GradeSummary({ periods, projections, finalMode, finalGrade, finalPeriodKey, scale, transmutationOn, lab }: {
  periods: PeriodInput[]; projections: PeriodProjection[];
  finalMode: 'average' | 'collective' | null; finalGrade: number | null; finalPeriodKey: string | null;
  scale: GradeScale | null; transmutationOn: boolean;
  lab: { has: boolean; lec: number; lab: number };
}) {
  const [whatIf, setWhatIf] = useState(false);
  const [wif, setWif] = useState<Record<string, number>>({});

  const seed = (pi: number, key: string) => {
    const c = projections[pi].categories.find(x => x.key === key);
    return c?.avg ?? projections[pi].current ?? 0;
  };
  const value = (pi: number, key: string) => (whatIf ? (wif[key] ?? seed(pi, key)) : null);

  const periodValues = useMemo(() => projections.map((proj, pi) => {
    if (!whatIf) return proj.current;
    const cats = periods[pi].categories.filter(c => c.weight > 0);
    const w = cats.reduce((s, c) => s + c.weight, 0);
    return w > 0 ? cats.reduce((s, c) => s + c.weight * (wif[c.key] ?? seed(pi, c.key)), 0) / w : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projections, periods, whatIf, wif]);

  const shownFinal = !whatIf ? finalGrade : (() => {
    if (finalMode === 'average') { const vs = periodValues.filter((v): v is number => v !== null); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null; }
    if (finalMode === 'collective') {
      let ws = 0, w = 0;
      periods.forEach((p, pi) => p.categories.forEach(c => { if (c.weight > 0) { ws += c.weight * (wif[c.key] ?? seed(pi, c.key)); w += c.weight; } }));
      return w > 0 ? ws / w : null;
    }
    return null;
  })();

  return (
    <section className="sp-panel sp-sum" aria-label="Grade summary">
      <div className="sp-sum__head">
        <h2 className="sp-sum__title"><Calculator size={17} className="sp-tone-muted" aria-hidden /> Grade summary
          {transmutationOn && <span className="sp-chip sp-chip--blue">transmuted</span>}
          {whatIf && <span className="sp-chip sp-chip--pink">what if</span>}
        </h2>
        {whatIf && <button type="button" className="sp-btn sp-btn--quiet sp-focus-ring" onClick={() => setWif({})}><RotateCcw size={14} /> Reset</button>}
        <button type="button" aria-pressed={whatIf} className={`sp-btn ${whatIf ? 'sp-btn--dark' : 'sp-btn--ghost'} sp-focus-ring`} onClick={() => { setWhatIf(v => !v); setWif({}); }}>
          {whatIf ? 'Exit what-if' : 'What if?'}
        </button>
      </div>
      {whatIf && <p className="sp-sum__note" style={{ margin: '-6px 0 14px' }}>Adjust category averages. Weights stay fixed and nothing is saved. For item-by-item planning, use the Target planner.</p>}

      <div className="sp-sum__grid sp-num">
        {periods.map((p, pi) => {
          const v = periodValues[pi];
          return (
            <div key={p.key} className="sp-item sp-sum__col">
              <div className="sp-eyebrow" style={{ textAlign: 'center' }}>{p.name}{finalPeriodKey === p.key && <> <Flag size={11} aria-hidden /></>}</div>
              <div className={`sp-sum__big ${TONE[gradeTone(v)]}`}>{v === null ? '—' : dp(v, transmutationOn)}</div>
              <div className={`sp-sum__lt ${TONE[gradeTone(v)]}`}>{letterLine(v, scale) || (v === null ? 'No grades yet' : '')}</div>
              <div className="sp-sum__rows">
                {p.categories.map(c => {
                  const avg = projections[pi].categories.find(x => x.key === c.key)?.avg ?? null;
                  return (
                    <div key={c.key} className="sp-sum__row">
                      <span><b>{c.name}</b><small>{c.weight}%</small></span>
                      {whatIf ? (
                        <input className="sp-input sp-input--sm" type="number" min={0} max={100} step={0.5} aria-label={`${c.name} average`}
                          value={value(pi, c.key) ?? 0}
                          onChange={e => setWif(prev => ({ ...prev, [c.key]: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) }))} />
                      ) : (
                        <span style={{ textAlign: 'right' }}>
                          <b className={TONE[gradeTone(avg)]}>{avg === null ? '—' : ((avg * c.weight) / 100).toFixed(2)}</b>
                          <small>{avg === null ? 'not graded' : dp(avg, transmutationOn)}</small>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {finalMode && (
        <div className="sp-sum__final sp-num">
          <span className="sp-tone-muted" style={{ fontWeight: 700 }}><Flag size={14} aria-hidden /> Final grade · {finalMode === 'collective' ? 'collective percentage of all categories' : 'average of all periods'}</span>
          <span><b className={TONE[gradeTone(shownFinal)]} style={{ fontSize: 24, fontFamily: 'var(--sp-font-head)' }}>{shownFinal === null ? '—' : dp(shownFinal, transmutationOn)}</b> <span className="sp-tone-muted">{letterLine(shownFinal, scale)}</span></span>
        </div>
      )}
      {lab.has && <p className="sp-sum__note">Lab subject: overall = Lecture × {lab.lec}% + Lab × {lab.lab}%</p>}
    </section>
  );
}

/** Legacy subjects: Finals / Midterm views from the projection engine, plus the old editable what-if. */
export function LegacyGradeSummary({ overall, overallProj, transmutationOn }: {
  overall: PeriodInput; overallProj: PeriodProjection; transmutationOn: boolean;
}) {
  type Mode = 'finals' | 'midterm' | 'whatif';
  const [mode, setMode] = useState<Mode>('finals');
  const midProj = useMemo(() => projectPeriod(legacyMidtermPeriod(overall)), [overall]);
  const av = (key: string) => overallProj.categories.find(c => c.key === key)?.avg ?? null;
  const examsAvg = (() => { const m = av('legacy-midterm'), f = av('legacy-final'); return m !== null && f !== null ? (m * 15 + f * 25) / 40 : m ?? f; })();
  const seedRows = [
    { label: 'Activities', weight: 24, grade: av('legacy-activities') ?? 0 },
    { label: 'Quizzes', weight: 36, grade: av('legacy-quizzes') ?? 0 },
    { label: 'Exams', weight: 40, grade: examsAvg ?? 0 },
  ];
  const [wif, setWif] = useState(seedRows);

  const proj = mode === 'midterm' ? midProj : overallProj;
  const total = mode === 'whatif'
    ? wif.reduce((s, r) => s + (r.grade * r.weight) / 100, 0)
    : proj.current;
  const rows = mode === 'whatif' ? null : proj.categories;

  return (
    <section className="sp-panel sp-sum" aria-label="Grade summary">
      <div className="sp-sum__head">
        <h2 className="sp-sum__title"><Calculator size={17} className="sp-tone-muted" aria-hidden /> Grade summary {transmutationOn && <span className="sp-chip sp-chip--blue">transmuted</span>}</h2>
        <SpSegmented size="sm" label="Calculator view" value={mode} onChange={m => { if (m === 'whatif') setWif(seedRows); setMode(m); }}
          options={[{ value: 'finals', label: 'Finals' }, { value: 'midterm', label: 'Midterm' }, { value: 'whatif', label: 'What if?' }]} />
      </div>
      <div className="sp-item sp-sum__col sp-num" style={{ maxWidth: 520 }}>
        <div className={`sp-sum__big ${TONE[gradeTone(total)]}`}>{total === null ? '—' : dp(total, transmutationOn)}</div>
        <div className={`sp-sum__lt ${TONE[gradeTone(total)]}`}>{letterLine(total, '4pt') || 'No grades yet'}</div>
        <div className="sp-sum__rows">
          {rows ? rows.map(c => (
            <div key={c.key} className="sp-sum__row"><span><b>{c.name}</b><small>{c.weight}%</small></span>
              <span style={{ textAlign: 'right' }}><b className={TONE[gradeTone(c.avg)]}>{c.avg === null ? '—' : ((c.avg * c.weight) / 100).toFixed(2)}</b><small>{c.avg === null ? 'not graded' : dp(c.avg, transmutationOn)}</small></span></div>
          )) : wif.map((r, i) => (
            <div key={r.label} className="sp-sum__row"><span><b>{r.label}</b>
              <small><input className="sp-input sp-input--sm" type="number" min={0} max={100} step={0.01} aria-label={`${r.label} weight`} value={r.weight}
                onChange={e => setWif(prev => prev.map((x, j) => (j === i ? { ...x, weight: parseFloat(e.target.value) || 0 } : x)))} /></small></span>
              <input className="sp-input sp-input--sm" type="number" min={0} max={100} step={0.01} aria-label={`${r.label} grade`} value={r.grade}
                onChange={e => setWif(prev => prev.map((x, j) => (j === i ? { ...x, grade: parseFloat(e.target.value) || 0 } : x)))} /></div>
          ))}
        </div>
      </div>
      {mode !== 'whatif' && (
        <p className="sp-sum__note">{mode === 'finals' ? 'Finals: Activities 24% · Quizzes 36% · Midterm 15% + Final 25%' : 'Midterm: Activities 24% · Quizzes 36% · Midterm Exam 40%'}. Only graded work counts.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Wire it in**

In `SubjectCardView.tsx`, replace `<CustomGradeCalculator … />` with:
```tsx
<GradeSummary periods={periods} projections={projections} finalMode={finalMode} finalGrade={finalGrade}
  finalPeriodKey={finalPeriodId !== null ? `p${finalPeriodId}` : null} scale={scale} transmutationOn={transmutationOn}
  lab={{ has: config.has_lab === 1, lec: config.lec_weight, lab: config.lab_weight }} />
```
Replace `<GradeCalculator … />` with `<LegacyGradeSummary overall={periods[0]} overallProj={projections[0]} transmutationOn={transmutationOn} />`. Then delete the old components and helpers listed under Files.

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit` (0 errors) and the style gate on `GradeSummary.tsx`, `SubjectCardView.tsx` and `studypulse.css` (pass).

Live:
- For the same subject, the summary's period values equal the header tiles and the tab chips.
- The final grade equals the header Final tile.
- What-if edits change the numbers, and Reset restores them.
- Legacy Finals, Midterm and What-if all work.

- [ ] **Step 5: Snapshot**

`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t9 "sp: grade summary on the projection engine"`

---

### Task 10: Target planner (replaces the AI advisor)

**Before coding:** invoke the `dataviz` skill. Apply its stat-tile and bar rules to `GradeBar` (label collision, the marker contrast, and the non-colour status cue). Then open mockup v4 §4 and interact with it. The behaviour below matches it.

**Files:**
- Create: `src/components/studypulse/planner/usePlannerPrefs.ts`, `GradeBar.tsx`, `SlotField.tsx`, `PlanSandbox.tsx`, `ScenarioRow.tsx`, `SoloWhatIf.tsx`, `PeriodPlanCard.tsx`, `TargetPlanner.tsx`
- Modify: `SubjectCardView.tsx`. Use the `usePlannerPrefs` prefs instead of `EMPTY_PREFS` and render `TargetPlanner` in place of `TargetGradePanel`.
- Delete: `src/components/studypulse/TargetGradePanel.tsx`, `src/app/api/studypulse/target-analysis/route.ts`
- Modify: `studypulse.css` (append the "Planner" section)

**Interfaces:**
- Consumes: `projectPeriod`, `gradeAt`, `planOutcome`, `soloNeed`, `scenarios`, `closestReachable`, `targetPresets`, `scaleThresholds`, `outcomeTone`, `defaultSlotValue` (Task 1); `extraKey`, `targetKey`, `EMPTY_PREFS`, `ProjectionPrefs` (Task 2); `toGradeInfo`; `f1`.
- Produces: `usePlannerPrefs(userSubjectId) → { prefs, setTarget(periodKey, v), setExtra(catKey, v), saveError, retry }` and `TargetPlanner` props.

- [ ] **Step 1: Append CSS**

```css
/* ── Target planner (spec §6.5, mockup v4 §4) ── */
.sp-tp-shell { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 280ms var(--sp-ease); }
.sp-tp-shell.is-open { grid-template-rows: 1fr; margin-bottom: 22px; }
.sp-tp-shell__inner { overflow: hidden; min-height: 0; }
.sp-tp-shell__content { opacity: 0; transition: opacity 180ms var(--sp-ease); }
.sp-tp-shell.is-open .sp-tp-shell__content { opacity: 1; transition-delay: 90ms; }
.sp-tp { padding: 24px 26px; }
.sp-tp__head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 12px; margin-bottom: 20px; }
.sp-tp__title { font: 800 21px var(--sp-font-head); margin: 0; display: flex; align-items: center; gap: 10px; }
.sp-tp__save { font: 600 12.5px var(--sp-font-ui); color: var(--sp-danger); display: inline-flex; gap: 6px; align-items: center; }
.sp-tp__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.sp-pc { padding: 24px 26px 22px; border-radius: var(--sp-r-card); min-width: 0; }
.sp-pc__top { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
.sp-pc__top h3 { font: 800 17px var(--sp-font-head); margin: 0; }
.sp-status { display: inline-flex; align-items: center; gap: 6px; font: 800 12px var(--sp-font-ui); padding: 4px 10px; border-radius: var(--sp-r-pill); }
.sp-status--success { background: var(--sp-success-bg); color: var(--sp-success); }
.sp-status--warn { background: var(--sp-warn-bg); color: var(--sp-warn); }
.sp-status--danger { background: var(--sp-danger-bg); color: var(--sp-danger); }
.sp-status--neutral { background: var(--sp-neutral-bg); color: var(--sp-text-muted); }
.sp-stepper { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.sp-stp { display: flex; align-items: center; background: var(--sp-surface); border: 1px solid var(--sp-field-border); border-radius: 11px; overflow: hidden; height: 32px; }
.sp-stp button { border: 0; background: transparent; width: 28px; height: 32px; color: var(--sp-text-muted); font: 700 15px var(--sp-font-ui); cursor: pointer; }
.sp-stp button:disabled { opacity: 0.35; cursor: default; }
.sp-stp input { width: 46px; border: 0; text-align: center; font: 800 15px var(--sp-font-head); color: var(--sp-text); outline: none; background: transparent; }
.sp-stp--mini { height: 26px; border-radius: 8px; }
.sp-stp--mini button { width: 24px; height: 26px; font-size: 13px; }
.sp-stp--mini b { font: 800 12.5px var(--sp-font-ui); min-width: 18px; text-align: center; }
.sp-quick { display: flex; flex-wrap: wrap; gap: 5px; margin: -4px 0 16px; }
.sp-quick button { font: 700 12px var(--sp-font-ui); border: 1px solid var(--sp-field-border); background: rgba(255, 255, 255, 0.6); color: var(--sp-text-muted); border-radius: var(--sp-r-sm); padding: 4px 9px; min-height: 28px; cursor: pointer; }
.sp-quick button[aria-pressed='true'] { background: var(--sp-ink); color: var(--sp-on-ink); border-color: var(--sp-ink); }
.sp-nums { display: flex; align-items: flex-end; gap: 22px; margin-bottom: 6px; }
.sp-nums__big { font: 800 40px/1 var(--sp-font-head); letter-spacing: -0.02em; margin-top: 4px; }
.sp-nums__big small { font-size: 18px; font-weight: 700; margin-left: 1px; }
.sp-nums__lt { font: 700 12.5px var(--sp-font-ui); color: var(--sp-text-muted); margin-top: 6px; }
.sp-nums__side { margin-left: auto; text-align: right; }
.sp-nums__v { font: 800 20px var(--sp-font-head); }
.sp-nums__cov { font: 600 12px var(--sp-font-ui); color: var(--sp-text-muted); margin-top: 4px; }

.sp-gbar { position: relative; margin: 44px 0 52px; height: 14px; }
.sp-gbar__track { position: absolute; inset: 0; border-radius: var(--sp-r-pill); background: var(--sp-neutral-bg); overflow: hidden; }
.sp-gbar__fill, .sp-gbar__range-in { position: absolute; inset: 0; transform-origin: left center; transition: transform var(--sp-dur-slow) var(--sp-ease); }
.sp-gbar__fill { border-radius: var(--sp-r-pill); }
.sp-gbar__fill--success { background: linear-gradient(90deg, var(--sp-success-soft), var(--sp-success-fill)); }
.sp-gbar__fill--danger { background: linear-gradient(90deg, var(--sp-danger-soft), var(--sp-danger-fill)); }
.sp-gbar__range { position: absolute; inset: 0; transition: transform var(--sp-dur-slow) var(--sp-ease); }
.sp-gbar__range-in { background: repeating-linear-gradient(135deg, rgba(42, 127, 168, 0.24) 0 5px, rgba(42, 127, 168, 0.08) 5px 10px); }
.sp-gbar__tmark { position: absolute; top: -6px; bottom: -6px; width: 2px; background: var(--sp-ink); border-radius: 2px; transform: translateX(-50%); }
.sp-gbar__cur { position: absolute; bottom: calc(100% + 9px); white-space: nowrap; font: 800 12px var(--sp-font-ui); padding: 3px 8px; border-radius: 7px; background: var(--sp-surface); box-shadow: 0 2px 8px -2px rgba(31, 38, 68, 0.25); }
.sp-gbar__pin { position: absolute; top: calc(100% + 26px); white-space: nowrap; font: 800 12px var(--sp-font-ui); color: var(--sp-on-ink); background: var(--sp-ink); padding: 3px 8px; border-radius: 7px; }
.sp-gbar__pin::before { content: ''; position: absolute; left: var(--caret, 50%); bottom: 100%; transform: translateX(-50%); border: 4px solid transparent; border-bottom-color: var(--sp-ink); }
.sp-gbar__plan-layer { position: absolute; inset: 0; transition: transform var(--sp-dur-slow) var(--sp-ease); pointer-events: none; }
.sp-gbar__plan { position: absolute; left: 0; top: 50%; width: 16px; height: 16px; border-radius: 50%; border: 3px solid var(--sp-ink); background: var(--sp-surface); transform: translate(-50%, -50%); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2); }
.sp-gbar__axis0 { position: absolute; left: -4px; top: calc(100% + 6px); transform: translateX(-100%); font: 700 12px var(--sp-font-ui); color: var(--sp-text-muted); }
.sp-gbar__ticks { position: absolute; left: 0; right: 0; top: calc(100% + 6px); height: 16px; }
.sp-gbar__ticks span { position: absolute; transform: translateX(-50%); font: 700 12px var(--sp-font-ui); color: var(--sp-text-muted); }
.sp-gbar__ticks span.is-hit { color: var(--sp-text); font-weight: 800; }

.sp-headline { display: flex; gap: 14px; align-items: center; padding: 14px 16px; border-radius: var(--sp-r-item); }
.sp-headline__need { font: 800 30px/1 var(--sp-font-head); letter-spacing: -0.02em; white-space: nowrap; min-width: 108px; }
.sp-headline p { margin: 0; font-size: 13px; color: var(--sp-text-muted); line-height: 1.5; }
.sp-headline p b { color: var(--sp-text); }
.sp-headline--success { background: linear-gradient(90deg, var(--sp-success-bg), rgba(107, 181, 138, 0.04)); border: 1px solid rgba(47, 143, 91, 0.2); }
.sp-headline--success .sp-headline__need { color: var(--sp-success); }
.sp-headline--warn { background: linear-gradient(90deg, var(--sp-warn-bg), rgba(240, 163, 92, 0.05)); border: 1px solid rgba(217, 137, 47, 0.25); }
.sp-headline--warn .sp-headline__need { color: var(--sp-warn); }
.sp-headline--danger { background: linear-gradient(90deg, var(--sp-danger-bg), rgba(224, 96, 124, 0.04)); border: 1px solid rgba(208, 84, 111, 0.22); }
.sp-headline--danger .sp-headline__need { color: var(--sp-danger); }
.sp-headline--neutral { background: var(--sp-neutral-bg); }
.sp-alt { margin-top: 12px; font-size: 12.5px; color: var(--sp-text-muted); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

.sp-sec { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--sp-hair); }
.sp-sec__h { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.sp-sec__h h4 { font: 800 14.5px var(--sp-font-head); margin: 0; }
.sp-sec__sub { font-size: 12.5px; color: var(--sp-text-muted); margin: 0 0 6px; }
.sp-link { margin-left: auto; border: 0; background: transparent; font: 700 12.5px var(--sp-font-ui); color: var(--sp-blue-ink); cursor: pointer; padding: 4px 6px; border-radius: 7px; }
@media (hover: hover) and (pointer: fine) { .sp-link:hover { background: var(--sp-blue-bg); } }
.sp-cp { padding: 14px 0; border-bottom: 1px dashed var(--sp-hair); }
.sp-cp:last-of-type { border-bottom: 0; }
.sp-cp__top { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
.sp-cp__name { font: 700 13.5px var(--sp-font-ui); }
.sp-cp__meta { font: 600 12px var(--sp-font-ui); color: var(--sp-text-muted); }
.sp-cp__count { margin-left: auto; display: flex; align-items: center; gap: 8px; font: 600 12px var(--sp-font-ui); color: var(--sp-text-muted); }
.sp-cp__locked { font: 600 12.5px var(--sp-font-ui); color: var(--sp-text-muted); margin-top: 8px; }
.sp-slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; margin-top: 10px; }
.sp-slot { padding: 8px 10px 6px; border-radius: var(--sp-r-lg); background: var(--sp-surface); border: 1px solid var(--sp-field-border); transition: border-color var(--sp-dur) var(--sp-ease), box-shadow var(--sp-dur) var(--sp-ease); }
.sp-slot--planned { border-style: dashed; background: rgba(255, 255, 255, 0.6); }
.sp-slot--dirty { border-color: var(--sp-blue-strong); box-shadow: 0 0 0 3px rgba(42, 127, 168, 0.12); }
.sp-slot__name { font: 600 12px var(--sp-font-ui); color: var(--sp-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-slot__val { display: flex; align-items: baseline; gap: 1px; margin-top: 2px; }
.sp-slot__val input { width: 3.3ch; border: 0; background: transparent; font: 800 19px var(--sp-font-head); color: var(--sp-text); outline: none; padding: 0; }
.sp-slot__val input:focus-visible { outline: 2px solid var(--sp-focus); outline-offset: 2px; border-radius: 4px; }
.sp-slot__val span { font: 700 12px var(--sp-font-ui); color: var(--sp-text-muted); }
.sp-slot input[type='range'] { width: 100%; accent-color: var(--sp-blue-strong); margin: 2px 0 0; height: 18px; }

.sp-outcome { position: relative; overflow: hidden; display: flex; align-items: center; flex-wrap: wrap; gap: 12px 16px; margin-top: 16px; padding: 14px 18px 14px 22px; border-radius: 16px; background: var(--sp-glass-item); border: 1px solid rgba(255, 255, 255, 0.9); box-shadow: var(--sp-glass-item-shadow); transition: background-color var(--sp-dur-slow) var(--sp-ease), border-color var(--sp-dur-slow) var(--sp-ease); }
.sp-outcome::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--o-ink); }
.sp-outcome__v { font: 800 28px/1 var(--sp-font-head); letter-spacing: -0.02em; margin-top: 3px; color: var(--o-ink); }
.sp-outcome__chip { font: 800 12px var(--sp-font-ui); color: var(--o-ink); background: var(--o-bg); padding: 4px 10px; border-radius: var(--sp-r-pill); }
.sp-outcome__delta { margin-left: auto; }
.sp-outcome--success { --o-ink: var(--sp-success); --o-bg: var(--sp-success-bg); background: linear-gradient(100deg, var(--sp-success-bg), rgba(255, 255, 255, 0.75) 55%); border-color: rgba(47, 143, 91, 0.22); }
.sp-outcome--warn { --o-ink: var(--sp-warn); --o-bg: var(--sp-warn-bg); background: linear-gradient(100deg, var(--sp-warn-bg), rgba(255, 255, 255, 0.75) 55%); border-color: rgba(217, 137, 47, 0.25); }
.sp-outcome--danger { --o-ink: var(--sp-danger); --o-bg: var(--sp-danger-bg); background: linear-gradient(100deg, var(--sp-danger-bg), rgba(255, 255, 255, 0.75) 55%); border-color: rgba(208, 84, 111, 0.24); }

.sp-scen { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin-top: 8px; }
.sp-sc { border-radius: 11px; padding: 8px 4px; text-align: center; background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(255, 255, 255, 0.85); }
.sp-sc__in { font: 700 12px var(--sp-font-ui); color: var(--sp-text-muted); }
.sp-sc__out { font: 800 16px var(--sp-font-head); margin-top: 2px; color: var(--sp-text-muted); }
.sp-sc__lt { font: 800 12px var(--sp-font-ui); color: var(--sp-text-muted); }
.sp-sc--hit { background: var(--sp-success-bg); border-color: rgba(47, 143, 91, 0.3); }
.sp-sc--hit .sp-sc__out, .sp-sc--hit .sp-sc__lt { color: var(--sp-success); }

.sp-wi { margin-top: 14px; border-radius: var(--sp-r-lg); background: rgba(255, 255, 255, 0.45); border: 1px solid rgba(255, 255, 255, 0.75); }
.sp-wi summary { list-style: none; cursor: pointer; padding: 11px 14px; font: 700 13px var(--sp-font-ui); display: flex; align-items: center; gap: 8px; border-radius: var(--sp-r-lg); }
.sp-wi summary::-webkit-details-marker { display: none; }
.sp-wi summary .sp-chev { margin-left: auto; }
.sp-wi[open] summary .sp-chev { transform: rotate(180deg); }
.sp-wi__body { padding: 0 14px 14px; font-size: 13px; color: var(--sp-text-muted); }
.sp-wi__item { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--sp-hair); }
.sp-wi__item b { color: var(--sp-text); }
.sp-wi__item .r { margin-left: auto; font-weight: 800; }

@media (max-width: 1000px) { .sp-tp__grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) {
  .sp-tp, .sp-pc { padding: 18px 16px; }
  .sp-scen { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sp-nums__big { font-size: 34px; }
  .sp-gbar__axis0 { display: none; }
}
```

- [ ] **Step 2: usePlannerPrefs**

`src/components/studypulse/planner/usePlannerPrefs.ts`:
```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_PREFS, extraKey, targetKey, type ProjectionPrefs } from '@/lib/studypulse/prefs';

/** Loads and saves planner prefs (spec §3.3): 400ms debounce per key, no spinner, inline retry on failure. */
export function usePlannerPrefs(userSubjectId: number) {
  const [prefs, setPrefs] = useState<ProjectionPrefs>(EMPTY_PREFS);
  const [saveError, setSaveError] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const failed = useRef<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    fetch(`/api/studypulse/projection-prefs?user_subject_id=${userSubjectId}`)
      .then(r => (r.ok ? r.json() : EMPTY_PREFS))
      .then((p: ProjectionPrefs) => { if (alive) setPrefs({ extras: p.extras ?? {}, targets: p.targets ?? {} }); })
      .catch(() => { /* planner still works from defaults */ });
    return () => { alive = false; };
  }, [userSubjectId]);

  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  const send = useCallback(async (key: string, value: number) => {
    try {
      const res = await fetch('/api/studypulse/projection-prefs', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_subject_id: userSubjectId, key, value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      delete failed.current[key];
      if (!Object.keys(failed.current).length) setSaveError(false);
    } catch {
      failed.current[key] = value;
      setSaveError(true);
    }
  }, [userSubjectId]);

  const queue = useCallback((key: string, value: number) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => { void send(key, value); }, 400);
  }, [send]);

  const setTarget = useCallback((periodKey: string, v: number) => {
    setPrefs(p => ({ ...p, targets: { ...p.targets, [periodKey]: v } }));
    queue(targetKey(periodKey), v);
  }, [queue]);

  const setExtra = useCallback((catKey: string, v: number) => {
    setPrefs(p => ({ ...p, extras: { ...p.extras, [catKey]: v } }));
    queue(extraKey(catKey), v);
  }, [queue]);

  const retry = useCallback(() => {
    Object.entries(failed.current).forEach(([k, v]) => { void send(k, v); });
  }, [send]);

  return { prefs, setTarget, setExtra, saveError, retry };
}
```

- [ ] **Step 3: GradeBar**

`src/components/studypulse/planner/GradeBar.tsx`:
```tsx
import type { CSSProperties } from 'react';
import type { GradeScale } from '@/lib/gradeScale';
import { scaleThresholds, type PeriodProjection } from '@/lib/studypulse/projection';
import { f1 } from '@/lib/studypulse/ui/format';

/** Domain is 50–100 (spec §6.5.3): every grade decision happens there, so the letter bands get room. */
export const barPos = (v: number) => Math.max(0, Math.min(100, (v - 50) * 2));

export default function GradeBar({ proj, target, plan, scale }: {
  proj: PeriodProjection; target: number; plan: number; scale: GradeScale | null;
}) {
  const cur = proj.current;
  const ok = cur !== null && cur >= target;
  const lo = barPos(proj.worst), hi = barPos(proj.best);
  const tp = barPos(target);
  const cp = cur === null ? 0 : barPos(cur);
  const ticks = scaleThresholds(scale).filter(t => t.min >= 50);
  const hit = ticks.filter(t => t.min <= target)[0]?.label;
  const pinEdge = tp > 88;

  return (
    <div className="sp-gbar sp-num" role="img"
      aria-label={`Current ${cur === null ? 'none' : f1(cur)}, target ${target}, reachable ${f1(proj.worst)} to ${f1(proj.best)}, your plan ${f1(plan)}`}>
      <div className="sp-gbar__track">
        <div className="sp-gbar__range" style={{ transform: `translateX(${lo}%)` }}>
          <div className="sp-gbar__range-in" style={{ transform: `scaleX(${Math.max(0, hi - lo) / 100})` }} />
        </div>
        <div className={`sp-gbar__fill sp-gbar__fill--${ok ? 'success' : 'danger'}`} style={{ transform: `scaleX(${cp / 100})` }} />
      </div>
      <div className="sp-gbar__tmark" style={{ left: `${tp}%` }} />
      {cur !== null && (
        <div className={`sp-gbar__cur ${ok ? 'sp-tone-success' : 'sp-tone-danger'}`}
          style={{ left: `${cp}%`, transform: `translateX(${cp > 80 ? '-85%' : cp < 12 ? '-15%' : '-50%'})` }}>
          {f1(cur)} now
        </div>
      )}
      <div className="sp-gbar__plan-layer" style={{ transform: `translateX(${barPos(plan)}%)` }}><span className="sp-gbar__plan" /></div>
      <span className="sp-gbar__axis0">50</span>
      <div className="sp-gbar__ticks">
        {ticks.map(t => <span key={t.label} className={t.label === hit ? 'is-hit' : undefined} style={{ left: `${barPos(t.min)}%` }}>{t.label}</span>)}
      </div>
      <div className="sp-gbar__pin" style={{ left: `${tp}%`, transform: `translateX(${pinEdge ? '-80%' : '-50%'})`, '--caret': pinEdge ? '80%' : '50%' } as CSSProperties}>
        Target {target}
      </div>
    </div>
  );
}
```
The plan ring moves via `transform` on a full-width layer. `translateX(%)` of a full-width element equals a percentage of the track, so no `left` transition is needed (style-gate rule). The `left` positions of the target mark, the current tag and the pin are not transitioned.

- [ ] **Step 4: SlotField, PlanSandbox, ScenarioRow, SoloWhatIf**

`src/components/studypulse/planner/SlotField.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

/** One sandbox slot: a decimal text field and a slider kept in sync (spec §6.5.5). */
export default function SlotField({ name, planned, dirty, value, onChange }: {
  name: string; planned: boolean; dirty: boolean; value: number; onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = (s: string) => {
    const v = parseFloat(s);
    if (Number.isFinite(v)) onChange(Math.max(0, Math.min(100, Math.round(v * 10) / 10)));
  };
  const label = `${name}${planned ? ' (planned)' : ''} score`;
  return (
    <div className={`sp-slot${planned ? ' sp-slot--planned' : ''}${dirty ? ' sp-slot--dirty' : ''}`}>
      <div className="sp-slot__name" title={name}>{name}{planned ? ' · planned' : ''}</div>
      <div className="sp-slot__val sp-num">
        <input type="text" inputMode="decimal" aria-label={label} value={draft}
          onChange={e => { setDraft(e.target.value); commit(e.target.value); }}
          onBlur={() => setDraft(String(value))} />
        <span>%</span>
      </div>
      <input type="range" min={0} max={100} step={0.5} value={value} aria-label={label} aria-valuetext={`${value} percent`}
        onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  );
}
```

`src/components/studypulse/planner/PlanSandbox.tsx`:
```tsx
'use client';

import type { PeriodProjection } from '@/lib/studypulse/projection';
import { f1 } from '@/lib/studypulse/ui/format';
import SlotField from './SlotField';

export const slotKey = (catKey: string, i: number) => `${catKey}#${i}`;

export function slotNames(c: PeriodProjection['categories'][number]): Array<{ name: string; planned: boolean }> {
  const out = c.pendingNames.map(name => ({ name, planned: false }));
  for (let j = 0; j < c.extra; j++) out.push({ name: `${c.noun} ${c.n + c.pendingNames.length + j + 1}`, planned: true });
  return out;
}

export default function PlanSandbox({ proj, edits, def, onSlot, onExtra, onReset }: {
  proj: PeriodProjection;
  edits: Record<string, number>;
  def: number;
  onSlot: (key: string, v: number) => void;
  onExtra: (catKey: string, v: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="sp-sec">
      <div className="sp-sec__h"><h4>Plan your remaining items</h4>
        <button type="button" className="sp-link sp-focus-ring" onClick={onReset} disabled={!Object.keys(edits).length}>Reset to required</button>
      </div>
      <p className="sp-sec__sub">Each slot starts at the required average. Drag or type to see what happens.</p>
      {proj.categories.map(c => (
        <div key={c.key} className="sp-cp">
          <div className="sp-cp__top">
            <span className="sp-cat__swatch" style={{ background: c.color }} aria-hidden />
            <span className="sp-cp__name">{c.name}</span>
            <span className="sp-cp__meta sp-num">{c.weight}% · {c.n} graded · {c.avg === null ? 'not graded yet' : `${f1(c.avg)} avg`}</span>
            {c.singleton ? <span className="sp-cp__count">single score</span> : (
              <span className="sp-cp__count">Remaining
                <span className="sp-stp sp-stp--mini sp-num">
                  <button type="button" aria-label={`Fewer planned ${c.name}`} disabled={c.extra === 0} onClick={() => onExtra(c.key, c.extra - 1)}>−</button>
                  <b aria-live="polite">{c.k}</b>
                  <button type="button" aria-label={`More planned ${c.name}`} disabled={c.extra >= 50} onClick={() => onExtra(c.key, c.extra + 1)}>+</button>
                </span>
              </span>
            )}
          </div>
          {c.k === 0 ? (
            <div className="sp-cp__locked">{c.avg === null ? 'Nothing logged or planned here yet.' : `Nothing left here. Its ${f1(c.avg)} is locked in.`}</div>
          ) : (
            <div className="sp-slots">
              {slotNames(c).map((s, i) => {
                const k = slotKey(c.key, i);
                return <SlotField key={k} name={s.name} planned={s.planned} dirty={k in edits} value={edits[k] ?? def} onChange={v => onSlot(k, v)} />;
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

`src/components/studypulse/planner/ScenarioRow.tsx`:
```tsx
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';
import { scenarios, type PeriodProjection } from '@/lib/studypulse/projection';
import { f1 } from '@/lib/studypulse/ui/format';

export default function ScenarioRow({ proj, target, scale }: { proj: PeriodProjection; target: number; scale: GradeScale | null }) {
  if (proj.remaining === 0) return null;
  return (
    <div className="sp-sec">
      <div className="sp-sec__h"><h4>If you average this on everything left</h4></div>
      <div className="sp-scen sp-num">
        {scenarios(proj).map(s => {
          const hit = s.result >= target - 1e-9;
          return (
            <div key={s.input} className={`sp-sc${hit ? ' sp-sc--hit' : ''}`}>
              <div className="sp-sc__in">{s.input}%</div>
              <div className="sp-sc__out">{f1(s.result)}</div>
              <div className="sp-sc__lt">{scale ? toGradeInfo(s.result, scale).letter : ''}{hit ? ' ✓' : ''}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

`src/components/studypulse/planner/SoloWhatIf.tsx`:
```tsx
import { ChevronDown, Calculator } from 'lucide-react';
import { soloNeed, type PeriodProjection } from '@/lib/studypulse/projection';
import { f1 } from '@/lib/studypulse/ui/format';

export default function SoloWhatIf({ proj, target }: { proj: PeriodProjection; target: number }) {
  if (proj.remaining === 0) return null;
  return (
    <details className="sp-wi">
      <summary className="sp-focus-ring"><Calculator size={15} aria-hidden /> What if only one category changes? <ChevronDown size={15} className="sp-chev" aria-hidden /></summary>
      <div className="sp-wi__body sp-num">
        <div style={{ fontSize: 12.5, marginBottom: 4 }}>Every other remaining item holds your current average{proj.current !== null ? ` (${f1(proj.current)})` : ''}.</div>
        {proj.categories.map((c, i) => {
          const x = soloNeed(proj, target, i);
          const [cls, txt] = x === null ? ['sp-tone-muted', 'locked']
            : x > 100 ? ['sp-tone-danger', 'out of reach']
            : x <= 0 ? ['sp-tone-success', 'already safe']
            : [x <= 85 ? 'sp-tone-success' : 'sp-tone-warn', `need ${f1(x)}${c.k > 1 ? ' avg' : ''}`];
          return <div key={c.key} className="sp-wi__item"><b>{c.name}</b> · {c.k} left<span className={`r ${cls}`}>{txt}</span></div>;
        })}
      </div>
    </details>
  );
}
```

- [ ] **Step 5: PeriodPlanCard and TargetPlanner**

`src/components/studypulse/planner/PeriodPlanCard.tsx`:
```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';
import {
  closestReachable, defaultSlotValue, outcomeTone, planOutcome, targetPresets,
  type PeriodInput, type PeriodProjection,
} from '@/lib/studypulse/projection';
import { f1 } from '@/lib/studypulse/ui/format';
import GradeBar from './GradeBar';
import PlanSandbox, { slotKey } from './PlanSandbox';
import ScenarioRow from './ScenarioRow';
import SoloWhatIf from './SoloWhatIf';

const lt = (v: number, scale: GradeScale | null) => (scale ? toGradeInfo(v, scale) : null);

export default function PeriodPlanCard({ period, proj, scale, onTarget, onExtra }: {
  period: PeriodInput; proj: PeriodProjection; scale: GradeScale | null;
  onTarget: (v: number) => void; onExtra: (catKey: string, v: number) => void;
}) {
  const T = period.target;
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [targetDraft, setTargetDraft] = useState(String(T));
  useEffect(() => { setTargetDraft(String(T)); }, [T]);
  const def = defaultSlotValue(proj);

  const plan = useMemo(() => planOutcome(proj, proj.categories.map(c =>
    Array.from({ length: c.k }, (_, i) => edits[slotKey(c.key, i)] ?? def))), [proj, edits, def]);
  const delta = plan - T;
  const tone = outcomeTone(delta);

  // Screen readers get the outcome after the user pauses (spec §8), not on every slider tick.
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setAnnounce(`Your plan: ${f1(plan)}, ${Math.abs(delta) < 0.05 ? 'on target' : delta > 0 ? `${f1(delta)} over target` : `${f1(-delta)} short of target`}`), 300);
    return () => clearTimeout(t);
  }, [plan, delta]);

  const setT = (v: number) => onTarget(Math.max(0, Math.min(100, Math.round(v * 10) / 10)));
  const tg = lt(T, scale);
  const cg = proj.current === null ? null : lt(proj.current, scale);
  const pg = lt(plan, scale);
  const items = `${proj.remaining} remaining item${proj.remaining !== 1 ? 's' : ''}`;
  const tLabel = `${T}${tg ? ` (${tg.letter})` : ''}`;

  return (
    <article className="sp-item sp-pc" aria-label={`${period.name} plan`}>
      <div className="sp-pc__top">
        <h3>{period.name}</h3>
        <span className={`sp-status sp-status--${proj.status.tone}`}>{proj.status.label}</span>
        <div className="sp-stepper">
          <span className="sp-eyebrow">Target</span>
          <div className="sp-stp sp-num">
            <button type="button" aria-label="Lower target" onClick={() => setT(T - 1)}>−</button>
            <input aria-label={`${period.name} target percent`} inputMode="decimal" value={targetDraft}
              onChange={e => setTargetDraft(e.target.value)}
              onBlur={() => { const v = parseFloat(targetDraft); if (Number.isFinite(v)) setT(v); else setTargetDraft(String(T)); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            <button type="button" aria-label="Raise target" onClick={() => setT(T + 1)}>+</button>
          </div>
        </div>
      </div>
      <div className="sp-quick" role="group" aria-label="Target presets">
        {targetPresets(scale).map(p => <button key={p.label} type="button" aria-pressed={p.value === T} className="sp-focus-ring" onClick={() => setT(p.value)}>{p.label} {p.value}</button>)}
      </div>

      <div className="sp-nums sp-num">
        <div>
          <div className="sp-eyebrow">Current</div>
          <div className={`sp-nums__big ${proj.current === null ? 'sp-tone-muted' : proj.current >= T ? 'sp-tone-success' : 'sp-tone-danger'}`}>
            {proj.current === null ? '—' : <>{f1(proj.current)}<small>%</small></>}
          </div>
          <div className="sp-nums__lt">{cg ? `${cg.letter} · ${cg.description}` : proj.current === null ? 'No grades yet' : ''}</div>
        </div>
        <div className="sp-nums__side">
          <div className="sp-eyebrow">Target</div>
          <div className="sp-nums__v">{T}%{tg ? ` · ${tg.letter}` : ''}</div>
          <div className="sp-nums__cov">{Math.round(proj.coverage)}% of the grade is in</div>
        </div>
      </div>

      <GradeBar proj={proj} target={T} plan={plan} scale={scale} />

      {proj.status.kind === 'empty' ? (
        <div className="sp-headline sp-headline--neutral"><p>Add entries, or plan items below, to see what you need.</p></div>
      ) : proj.need === null || proj.need <= 0 ? (
        <div className="sp-headline sp-headline--success"><div className="sp-headline__need">Safe</div>
          <p>{proj.remaining ? <>Even a zero on everything left keeps you at <b>{f1(proj.worst)}</b>.</> : <>Everything is graded at <b>{f1(proj.current ?? 0)}</b>.</>} {tLabel} is locked in.</p></div>
      ) : proj.need > 100 ? (
        <>
          <div className="sp-headline sp-headline--danger"><div className="sp-headline__need">&gt;100%</div>
            <p>Even a perfect score on your <b>{items}</b> lands at <b>{f1(proj.best)}{lt(proj.best, scale) ? ` (${lt(proj.best, scale)!.letter})` : ''}</b>, so {T} isn&apos;t reachable this period.</p></div>
          {closestReachable(proj, T, scale).length > 0 && (
            <div className="sp-alt">Closest reachable:
              {closestReachable(proj, T, scale).map((a, i) => (
                <button key={a.label} type="button" className={`sp-chip ${i === 0 ? 'sp-chip--warn' : 'sp-chip--neutral'} sp-focus-ring`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setT(a.min)}>
                  {a.label} needs {f1(a.need)}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className={`sp-headline sp-headline--${proj.need <= 85 ? 'success' : 'warn'}`}><div className="sp-headline__need sp-num">{f1(proj.need)}%</div>
          <p>Average <b>{f1(proj.need)}%</b> on your <b>{items}</b> to finish at <b>{tLabel}</b>. Reachable range: <b>{f1(proj.worst)} – {f1(proj.best)}</b>.</p></div>
      )}

      <PlanSandbox proj={proj} edits={edits} def={def}
        onSlot={(k, v) => setEdits(e => ({ ...e, [k]: v }))}
        onExtra={onExtra}
        onReset={() => setEdits({})} />

      {proj.remaining > 0 && (
        <div className={`sp-outcome sp-outcome--${tone} sp-num`}>
          <div><div className="sp-eyebrow">Your plan</div><div className="sp-outcome__v">{f1(plan)}</div></div>
          {pg && <span className="sp-outcome__chip">{pg.letter} · {pg.description}</span>}
          <span className="sp-outcome__chip sp-outcome__delta">
            {Math.abs(delta) < 0.05 ? '✓ On target' : delta > 0 ? `✓ +${f1(delta)} over target` : `${f1(-delta)} short of target`}
          </span>
          <span className="sp-sr-only" aria-live="polite">{announce}</span>
        </div>
      )}

      <ScenarioRow proj={proj} target={T} scale={scale} />
      <SoloWhatIf proj={proj} target={T} />
    </article>
  );
}
```

`src/components/studypulse/planner/TargetPlanner.tsx`:
```tsx
'use client';

import { AlertCircle, Target, X } from 'lucide-react';
import type { GradeScale } from '@/lib/gradeScale';
import type { PeriodInput, PeriodProjection } from '@/lib/studypulse/projection';
import PeriodPlanCard from './PeriodPlanCard';

export default function TargetPlanner({ open, periods, projections, scale, transmutationOn, onClose, onTarget, onExtra, saveError, onRetry }: {
  open: boolean; periods: PeriodInput[]; projections: PeriodProjection[]; scale: GradeScale | null; transmutationOn: boolean;
  onClose: () => void; onTarget: (periodKey: string, v: number) => void; onExtra: (catKey: string, v: number) => void;
  saveError: boolean; onRetry: () => void;
}) {
  return (
    <div className={`sp-tp-shell${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="sp-tp-shell__inner">
        <section className="sp-panel sp-tp sp-tp-shell__content" aria-label="Target planner" inert={!open ? true : undefined}>
          <div className="sp-tp__head">
            <h2 className="sp-tp__title"><span className="sp-badge"><Target size={16} /></span>Target planner</h2>
            {scale && <span className="sp-chip sp-chip--blue">{scale === '4pt' ? '4.0 scale' : '1.0 scale'}{transmutationOn ? ' · transmuted' : ''}</span>}
            {saveError && (
              <span className="sp-tp__save" role="status"><AlertCircle size={14} /> Couldn&apos;t save.
                <button type="button" className="sp-link sp-focus-ring" style={{ marginLeft: 0 }} onClick={onRetry}>Retry</button></span>
            )}
            <button type="button" className="sp-btn sp-btn--quiet sp-focus-ring" style={{ marginLeft: 'auto' }} onClick={onClose}><X size={15} /> Close</button>
          </div>
          <div className="sp-tp__grid">
            {periods.map((p, i) => (
              <PeriodPlanCard key={p.key} period={p} proj={projections[i]} scale={scale}
                onTarget={v => onTarget(p.key, v)} onExtra={onExtra} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire in, delete the AI path**

In `SubjectCardView.tsx`:
- Add `const { prefs, setTarget, setExtra, saveError, retry } = usePlannerPrefs(userSubjectId);` and replace both `EMPTY_PREFS` arguments in the `periods` memo with `prefs` (add `prefs` to its deps). Remove the `EMPTY_PREFS` import if it becomes unused.
- Replace `{plannerOpen && <TargetGradePanel … />}` with an always-mounted planner, so it can animate open:
  ```tsx
  <TargetPlanner open={plannerOpen} periods={periods} projections={projections} scale={scale} transmutationOn={transmutationOn}
    onClose={() => setPlannerOpen(false)} onTarget={setTarget} onExtra={setExtra} saveError={saveError} onRetry={retry} />
  ```
- Delete the `TargetGradePanel` import.

Then:
```bash
rm src/components/studypulse/TargetGradePanel.tsx src/app/api/studypulse/target-analysis/route.ts
rmdir src/app/api/studypulse/target-analysis
```
Run `grep -rn "@anthropic-ai/sdk\|target-analysis\|TargetGradePanel" src`. Expected: no matches. If there are none, run `npm uninstall @anthropic-ai/sdk`. (`package.json` and `package-lock.json` already carry uncommitted user changes. The snapshot captures them, and nothing is committed.)

- [ ] **Step 7: Verify**

Run `npx tsc --noEmit` (0 errors), `node scripts/sp-test.mjs` (all pass) and the style gate on every planner file plus `studypulse.css` (pass).

Live, on a custom subject with at least one ungraded entry, compare against mockup v4 §4:
- The planner animates open and closed.
- The target stepper, the typed target and the letter chips update everything.
- Remaining +/− adds dashed planned slots, and − is disabled at 0 extra.
- Dragging a slot turns it blue, and the outcome card retints (success, warn, danger) while the ring on the bar moves.
- Reset clears every dirty slot.
- Reload the page: targets and extras persist, and slot edits do not.
- Out-of-reach shows the closest-reachable chips, and clicking one sets that target.
- With the network offline (Playwright `browser_network` offline or DevTools), changing a target shows "Couldn't save. Retry". Back online, Retry clears it.
- A legacy subject shows one "Overall" card.
- A subject with transmutation on shows "· transmuted".

- [ ] **Step 8: Snapshot**

`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t10 "sp: deterministic target planner; remove AI advisor"`

---

### Task 11: Motion and accessibility polish

**Skills, in order:**
1. `emil-design-eng`: review the finished subject page and My Subjects for polish details (press states, focus, hierarchy, the "invisible details").
2. `animate`: confirm each motion in spec §7 has a purpose, the right curve and duration, and interrupts cleanly. In particular, the tab indicator mid-slide must retarget smoothly, and dragging a slider must never lag the number.
3. `mobile-native`: check 390px touch behaviour. That means no sticky hover, 16px input font on touch so iOS doesn't zoom, and targets ≥ 32px.

**Files:** only the StudyPulse files created or modified in Tasks 5–10.

- [ ] **Step 1:** Run each skill against the live pages (dev server, Playwright). Collect findings in `.superpowers/sdd/2026-10-22-studypulse-revamp/t11-findings.md` as `file:line — issue — fix`.
- [ ] **Step 2: Apply the fixes.** Mandatory checks, each fixed if failing:
  - Under `prefers-reduced-motion`, no transform transitions run. Check with Playwright `browser_emulate_media({ reducedMotion: 'reduce' })`.
  - Every interactive element shows a `:focus-visible` ring.
  - On touch, the inputs are ≥ 16px. Add `@media (hover: none) { .sp-input, .sp-slot__val input, .sp-stp input { font-size: 16px; } }` to `studypulse.css`.
  - The period indicator doesn't animate on first paint.
  - The planner's outcome `aria-live` region doesn't announce on every slider tick (it's debounced to 300ms).
- [ ] **Step 3:** `npx tsc --noEmit`, `node scripts/sp-test.mjs` and the style gate on the touched files all pass.
- [ ] **Step 4:** `bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t11 "sp: motion + a11y polish"`

---

### Task 12: Stress, consistency, critique, final QA

**Skills:**
- `break-ui` (worst-case data),
- `impeccable` (critique and audit mode on the finished screens),
- `superpowers:verification-before-completion` (evidence before claiming done).

- [ ] **Step 1: break-ui pass**

Create a throwaway subject named `ZZ QA Stress` with a custom preset, and enter:
- a 90-character name;
- a 12-character block;
- 30 quiz entries;
- 5 periods;
- one period fully graded (b = 0);
- one category with weight 0.

Also check a legacy subject with no entries at all, and transmutation on. At 1440 and 390, nothing may overflow horizontally (`document.documentElement.scrollWidth <= innerWidth`), clip unreadably, or overlap labels on the bar. Fix each finding in the owning component, then **delete the QA subject**.

- [ ] **Step 2: Cross-surface number check**

For three real subjects (custom with a Final grade, custom without one, legacy), record:
- the header tiles;
- the tab chips;
- the period header chips;
- the summary period values;
- the summary final;
- the planner "Current";
- the My Subjects card ring.

These must agree:
- tile = tab = period chip = summary = planner current, per period;
- header Final = summary final;
- card ring = rounded overall. For custom presets the ring may differ only when transmutation is on, because cards are raw by design (spec §6.1).

Record the table in `.superpowers/sdd/2026-10-22-studypulse-revamp/t12-consistency.md`.

- [ ] **Step 3: impeccable critique**

Run `impeccable` in critique and audit mode on My Subjects, the subject page (Both and a single period), and the planner in achievable, stretch, out-of-reach and safe states. Fix every P0 and P1 finding. List the P2 findings in the final report rather than fixing them silently.

- [ ] **Step 4: Final screenshots**

Use Playwright, logged in. If the MCP browser is held by another session, stop and ask the user to close it; don't fake screenshots. Capture each surface from Step 3 at 1440×900 and 390×844, saved under `.superpowers/sdd/2026-10-22-studypulse-revamp/screens/`. Compare each with the matching mockup v4 section and note any intentional deviation (for example, the darker eyebrow grey required by contrast).

- [ ] **Step 5: Gates**

Run:
```bash
npx tsc --noEmit
node scripts/sp-test.mjs
node scripts/wb-style-gate.mjs $(git ls-files -m -o --exclude-standard -- src/components/studypulse src/app/studypulse src/lib/studypulse)
```
Expected: 0 errors, all tests pass, gate clean. Paste the real output into the report.

- [ ] **Step 6: Snapshot and report**

`bash .superpowers/sdd/2026-10-22-studypulse-revamp/snap.sh t12-final "sp: QA, stress fixes, final"`

Write `.superpowers/sdd/2026-10-22-studypulse-revamp/final-report.md` with:
- the snapshot SHAs;
- the test, tsc and gate output;
- the consistency table;
- the screenshot list;
- the P2 list;
- the `package.json` note (`@anthropic-ai/sdk` removed; the file also carries pre-existing uncommitted user changes, and nothing was committed).

---

## Self-review notes

**Spec coverage**

| Spec section | Covered by |
|---|---|
| §3.1 units | Tasks 1, 2, 4–10 |
| §3.2 removals | Task 10 |
| §3.3 persistence | Tasks 3 and 10 |
| §4 math and tests | Tasks 1 and 2 |
| §4.4 legacy, carry, transmutation and final | Tasks 2, 8 and 9 |
| §5 tokens, contrast, icons, colours | Tasks 2 and 5, plus every UI task |
| §6.1 | Task 6 |
| §6.2–6.3 | Task 8 |
| §6.4 | Tasks 7 and 9 |
| §6.5 | Task 10 |
| §7 motion | Tasks 5–10 implement it; Task 11 audits it |
| §8 accessibility | the same tasks, plus Task 11 |
| §9 verification | Task 12 |

**Additions beyond the spec**
- An `empty` status ("Nothing to plan", neutral tone) for a period with no graded and no remaining items. The spec's §4.3 table had no row for `b = 0` with `current = null`.
- Eyebrow text darkened to `--sp-text-muted` to meet spec §5 contrast.

**Type consistency**
- `CategoryInput`, `PeriodInput` and `PeriodProjection` are defined in Task 1 and used unchanged after that.
- `EntryPersistence` and `TypeColumn` are defined in Task 7 and consumed in Tasks 7 and 8.
- `PeriodSelection` is defined in Task 8.
- `ProjectionPrefs`, `extraKey` and `targetKey` are defined in Task 2 and consumed in Tasks 3 and 10.
