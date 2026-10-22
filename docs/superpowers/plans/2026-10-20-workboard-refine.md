# Workboard Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved refinement: a shared glass surface system, a clearer header and KPI row, a Focus view rebuilt around "Up next" plus a week picker, and glass treatments for Table, Board and Timeline.

**Architecture:**
- **Pure logic:** ranking, grouping, week load and course-code shortening go in new pool-free modules under `src/lib/workboard/ui/`, unit-tested with `node:test` through a small transpile runner (the finance pattern).
- **Shared styles:** the glass surfaces are shared classes and tokens in `src/app/workboard/workboard.css`.
- **Components:** Focus is rebuilt inside `WorkListView.tsx` from three new components. The shell stops wrapping Focus in its single glass panel and stops rendering the right rail.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, styled-jsx, lucide-react, sonner. Node 20.

**Spec:** `docs/superpowers/specs/2026-10-20-workboard-refine-design.md`. Read §3 (glass system) before any UI task. Mockups are in `.superpowers/brainstorm/1592-1792489260/content/`:
- `focus-c-detail.html`
- `header-kpi-v1.html`
- `views-glass-v4.html`

## Global Constraints

- **No git writes by anyone:** no add, commit, stash, checkout, reset or restore. The repo holds the user's unrelated uncommitted work (finance, StudyPulse). Read-only git is fine.
- **Do not touch** `src/components/schedule/ClassOverridePopover.tsx`, `src/app/globals.css` (`.vb-bg` stays animated and unchanged, spec D5), or any non-Workboard file unless your task names it.
- **Pool-free client imports:** client components import only pool-free modules at runtime: `src/lib/workboard/{dates,dueSemantics,workContexts,workCategories,color,workStats}.ts` and everything under `src/lib/workboard/ui/`. `workItems.ts`, `aggregate.ts`, `items.ts` and `organizations.ts` are `import type` only.
- **styled-jsx:** it scopes rules to the component function that renders the `<style jsx>`. Shared rules go in `workboard.css`. Never put a backtick inside a styled-jsx template literal.
- **Colours:** no new hex literals outside `workboard.css`, `src/lib/workboard/color.ts` and `src/lib/workboard/ui/tokens.ts`.
- **Text size:** 12px minimum. The exception is 11px uppercase 800-weight labels with letter-spacing ≥ .05em.
- **Motion:**
  - animate only `transform` and `opacity`
  - easing `var(--wb-ease)`; durations 120/180/240ms
  - keyboard-opened UI does not animate
  - hover effects only under `@media (hover: hover) and (pointer: fine)`
  - `prefers-reduced-motion: reduce` removes movement
  - no pulsing glows
- **Blur rule:** only `.wb-glass-panel` gets `backdrop-filter`, and items never do (spec §3).
- **No coloured side stripes** (`inset 3px 0 0`, `border-left: 3px`, `borderTop: 3px` bars) anywhere in Workboard files, except `.wb-toast--error` (spec §3).
- **Contrast:** body text ≥ 4.5:1 against `#c2e9fb` (the lightest background stop) behind a panel.
- **Breakpoints and layout:** phone < 768px, tablet 768–1023px, desktop ≥ 1024px. No horizontal page scroll; 16px side gutter on phones.
- **No new API endpoints and no schema changes.**
- **Item identity:** `itemKey(item)` from `src/lib/workboard/ui/itemKey.ts`.
- **Comments:** match surrounding code style. Keep new comments short, and only where the reason isn't obvious.

## Verification (no test framework beyond the runner added in Task 1)

1. `npx tsc --noEmit` exits 0.
2. `node scripts/wb-style-gate.mjs <every created/modified .ts/.tsx/.css file>` is clean.
3. `node scripts/wb-test.mjs` passes. It is created in Task 1; run it for any task that touches `src/lib/workboard/**`.
4. **Smoke check:** `curl -s -w "\n%{http_code}" http://localhost:3000/workboard | tail -c 400` returns status 200 and the body contains `NEXT_REDIRECT` and `/login`. Skip it if the dev server is not running, and say so. Do not start or stop the dev server.
5. Browser and Playwright checks are done by the controller. Implementers write "browser check left to controller".

## Plan-level rulings

- **R1, priority after stripe removal:** Table and Board rows used a 3px left edge for priority. Table keeps its Priority column. Board cards gain a `High` glass chip (an `ArrowUp` icon plus "High") only when `priority === 'high'`. Low and normal show nothing.
- **R2, Up next horizon:** "later this week" in spec §5.1 step 4 means the same rolling 7-day horizon as `groupByTimeframe` (`due <= today+7`). Past-due revision items rank in the Today tier, matching `groupByTimeframe`.
- **R3, Show all completeness:** every not-done item not shown in Up next appears in exactly one Show all group, including overdue items beyond the 4 Up next slots ("More overdue"). Waiting items (`blocked_since !== null`) go to the Waiting group and nowhere else in Show all.
- **R4, week state:** the Focus week picker shares the shell's existing `week` state and `goToWeek`. Paging the picker also pages Timeline. That is acceptable: one "current week" for the page.
- **R5, Reschedule:** the Up next hero's Reschedule button opens the existing deadline popover through `useDeadlineEditor` + `DeadlineCell` (Task 8 adds a `variant: 'button'` trigger to `DeadlineCell`).
- **R6, Overdue KPI target:** "Review →" scrolls to `#vb-up-next` and briefly highlights the hero card. `OVERDUE_SECTION_ID` is retired in favour of `UP_NEXT_ID = 'vb-up-next'`.

---

## Phase 0: Pure logic (TDD)

### Task 1: Test runner and `shortCourseCode`

**Files:**
- Create: `scripts/wb-test.mjs`
- Create: `src/lib/workboard/ui/courseCode.ts`
- Create: `src/lib/workboard/ui/__tests__/courseCode.test.ts`

**Interfaces:**
- Produces:
  - `node scripts/wb-test.mjs [filter]`
  - `shortCourseCode(code: string, max?: number): string`

- [ ] **Step 1: Create the runner.** It transpiles every pool-free `.ts` file under `src/lib/workboard/` and rewrites `@/lib/workboard/…` imports to relative paths.

```js
#!/usr/bin/env node
// Workboard unit tests (refine plan Task 1). Same approach as scripts/fin-test.mjs: transpile the
// pool-free src/lib/workboard modules with the project's TypeScript and run node:test on *.test.ts.
// Usage: node scripts/wb-test.mjs [substring-filter]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const ROOT = 'src/lib/workboard';
// Modules that import the DB pool. Never transpiled here; tests may only `import type` from them.
const SERVER = /[\\/](workItems|aggregate|items|organizations|academicWrites)\.ts$/;
const out = mkdtempSync(join(tmpdir(), 'wb-test-'));
const walk = d => readdirSync(d).flatMap(n => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.ts') ? [p] : []);
});

const tests = [];
for (const file of walk(ROOT).filter(f => !SERVER.test(f))) {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const rel = relative(ROOT, file).split('\\').join('/');
  const fromDir = posix.dirname(rel);
  const js = outputText
    // "@/lib/workboard/x" -> relative path from this file
    .replace(/(from\s+['"])@\/lib\/workboard\/([^'"]+)(['"])/g, (_, a, p, b) => {
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
if (selected.length === 0) { console.error('no workboard tests matched'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...selected], { stdio: 'inherit' });
process.exit(r.status ?? 1);
```

- [ ] **Step 2: Write the failing test** in `src/lib/workboard/ui/__tests__/courseCode.test.ts`.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortCourseCode } from '../courseCode';

test('extracts the course segment from a section code', () => {
  assert.equal(shortCourseCode('3TSY2526_CS0061L_TN3'), 'CS0061L');
});
test('keeps an already-short code', () => {
  assert.equal(shortCourseCode('CS0001'), 'CS0001');
  assert.equal(shortCourseCode('EE205'), 'EE205');
});
test('falls back to the full code when no segment matches', () => {
  assert.equal(shortCourseCode('CPE 421L'), 'CPE 421L');
});
test('truncates an unmatched long code with an ellipsis', () => {
  assert.equal(shortCourseCode('BSCPE-CPE421L-COMPUTER-NETWORKS', 12), 'BSCPE-CPE42…');
});
test('is case-insensitive on input but returns the matched segment uppercased', () => {
  assert.equal(shortCourseCode('3tsy2526_cs0061l_tn3'), 'CS0061L');
});
```

- [ ] **Step 3: Run `node scripts/wb-test.mjs courseCode`.** Expected: FAIL (module not found).

- [ ] **Step 4: Implement** `src/lib/workboard/ui/courseCode.ts`.

```ts
/** "3TSY2526_CS0061L_TN3" -> "CS0061L": the first `_`/`-`/space-separated segment shaped like a
 *  course code (2+ letters, 3+ digits, optional letter). Falls back to the whole code, truncated. */
const SEGMENT = /^[A-Z]{2,}\d{3,}[A-Z]?$/;

export function shortCourseCode(code: string, max = 12): string {
  const upper = code.toUpperCase();
  const hit = upper.split(/[_\s-]+/).find(s => SEGMENT.test(s));
  if (hit) return hit;
  return code.length > max ? `${code.slice(0, max - 1)}…` : code;
}
```

- [ ] **Step 5:** Run `node scripts/wb-test.mjs courseCode`; it should PASS. Run `npx tsc --noEmit`; it should exit 0. Run the style gate on both `.ts` files.

### Task 2: `rankUpNext`, `showAllGroups`, `foldLabel`

**Files:**
- Create: `src/lib/workboard/ui/upNext.ts`
- Create: `src/lib/workboard/ui/__tests__/upNext.test.ts`

**Interfaces:**
- Consumes:
  - `dueDateOf`, `addDays` (dates.ts)
  - `isRevisionStage` (workContexts.ts)
  - `itemKey`
- Produces:
  - `UP_NEXT_LIMIT = 4`
  - `rankUpNext(items: WorkItem[], today: string): WorkItem[]`
  - `type ShowAllKey = 'more_overdue' | 'this_week' | 'next_week' | 'later' | 'waiting' | 'no_deadline'`
  - `SHOW_ALL_ORDER: ShowAllKey[]`
  - `SHOW_ALL_LABELS: Record<ShowAllKey, string>`
  - `showAllGroups(items: WorkItem[], today: string, shown: ReadonlySet<string>): Record<ShowAllKey, WorkItem[]>`
  - `foldLabel(groups: Record<ShowAllKey, WorkItem[]>): string`

- [ ] **Step 1: Write the failing tests.** Build items with a factory so each test states only what matters.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkItem } from '../../workItems';
import { rankUpNext, showAllGroups, foldLabel, UP_NEXT_LIMIT } from '../upNext';
import { itemKey } from '../itemKey';

let n = 0;
function mk(p: Partial<WorkItem>): WorkItem {
  n += 1;
  return {
    source: 'owned', id: n, title: `t${n}`, category: 'project', context: 'project', chip_label: null,
    project_name: null, course_code: null, project_id: null, user_subject_id: null, priority: 'normal',
    work_status: 'todo', work_stage: 'todo', due_at: null, deadline_time: null, start_date: null,
    estimated_hours: null, completed_at: null, note: null, life_area: null, organization_id: null,
    organization_name: null, project_context: null, link_count: 0, subtask_total: 0, subtask_done: 0,
    blocked_reason: null, blocked_since: null,
    ...p,
  } as WorkItem;
}
const T = '2026-10-20';

test('overdue first (oldest first), then today by time with untimed last, then tomorrow', () => {
  const od2 = mk({ due_at: '2026-10-10 00:00:00' });
  const od1 = mk({ due_at: '2026-07-07' });
  const todayUntimed = mk({ due_at: '2026-10-20' });
  const today9 = mk({ due_at: '2026-10-20 00:00:00', deadline_time: '09:00:00' });
  const tmrw = mk({ due_at: '2026-10-21' });
  const ranked = rankUpNext([tmrw, todayUntimed, od2, today9, od1], T);
  assert.deepEqual(ranked.map(i => i.id), [od1.id, od2.id, today9.id, todayUntimed.id, tmrw.id]);
});

test('later-this-week items rank only when in progress, by priority then date', () => {
  const todoThu = mk({ due_at: '2026-10-22' });
  const ipSatLow = mk({ due_at: '2026-10-24', work_status: 'in_progress', work_stage: 'in_progress', priority: 'low' });
  const ipThuHigh = mk({ due_at: '2026-10-25', work_status: 'in_progress', work_stage: 'in_progress', priority: 'high' });
  const ipFar = mk({ due_at: '2026-11-30', work_status: 'in_progress', work_stage: 'in_progress' });
  const ranked = rankUpNext([todoThu, ipSatLow, ipThuHigh, ipFar], T);
  assert.deepEqual(ranked.map(i => i.id), [ipThuHigh.id, ipSatLow.id]);
});

test('done and undated items never rank; a past-due revision item ranks as today', () => {
  const done = mk({ due_at: '2026-10-20', work_status: 'done', work_stage: 'done' });
  const undated = mk({});
  const rev = mk({ context: 'academic', due_at: '2026-10-01', work_stage: 'submitted', work_status: 'in_progress' });
  const od = mk({ due_at: '2026-10-19' });
  assert.deepEqual(rankUpNext([done, undated, rev, od], T).map(i => i.id), [od.id, rev.id]);
});

test('showAllGroups puts every not-done, not-shown item in exactly one group', () => {
  const ods = [1, 2, 3, 4, 5, 6].map(d => mk({ due_at: `2026-10-0${d}` }));
  const wk = mk({ due_at: '2026-10-26' });
  const nxt = mk({ due_at: '2026-11-01' });
  const lat = mk({ due_at: '2026-12-01' });
  const nd = mk({});
  const wait = mk({ due_at: '2026-10-22', blocked_since: '2026-10-15 10:00:00', work_stage: 'blocked' });
  const done = mk({ work_status: 'done', work_stage: 'done' });
  const all = [...ods, wk, nxt, lat, nd, wait, done];
  const shown = new Set(rankUpNext(all, T).slice(0, UP_NEXT_LIMIT).map(itemKey));
  const g = showAllGroups(all, T, shown);
  assert.deepEqual(g.more_overdue.map(i => i.id), [ods[4].id, ods[5].id]);
  assert.deepEqual(g.this_week.map(i => i.id), [wk.id]);
  assert.deepEqual(g.next_week.map(i => i.id), [nxt.id]);
  assert.deepEqual(g.later.map(i => i.id), [lat.id]);
  assert.deepEqual(g.waiting.map(i => i.id), [wait.id]);
  assert.deepEqual(g.no_deadline.map(i => i.id), [nd.id]);
  const total = Object.values(g).reduce((s, a) => s + a.length, 0);
  assert.equal(total + shown.size, all.length - 1);
});

test('foldLabel summarises non-empty groups and is empty when nothing remains', () => {
  const e = { more_overdue: [], this_week: [], next_week: [], later: [], waiting: [], no_deadline: [] };
  assert.equal(foldLabel(e), '');
  const x = mk({});
  assert.equal(foldLabel({ ...e, this_week: [x, x], more_overdue: [x], no_deadline: [x], later: [x], waiting: [x] }),
    '+3 more this week · 1 no deadline · 2 later');
});
```

- [ ] **Step 2: Run `node scripts/wb-test.mjs upNext`.** Expected: FAIL.

- [ ] **Step 3: Implement** `src/lib/workboard/ui/upNext.ts`.

```ts
/** Focus "Up next" ranking and the Show-all partition (refine spec §5.1, plan R2/R3). Pool-free. */
import type { WorkItem } from '@/lib/workboard/workItems';
import { addDays, dueDateOf } from '@/lib/workboard/dates';
import { isRevisionStage } from '@/lib/workboard/workContexts';
import { itemKey } from './itemKey';

export const UP_NEXT_LIMIT = 4;

const PRIORITY_RANK: Record<WorkItem['priority'], number> = { high: 0, normal: 1, low: 2 };
const timeOf = (i: WorkItem) => i.deadline_time ?? '99:99:99';   // untimed sorts after timed
const dueOf = (i: WorkItem) => dueDateOf(i) ?? '9999-12-31';

/** 0 overdue · 1 today · 2 tomorrow · 3 in progress within 7 days · null = not Up next material. */
function tierOf(item: WorkItem, today: string): number | null {
  if (item.work_status === 'done') return null;
  const due = dueDateOf(item);
  if (due === null) return null;
  if (due < today) return isRevisionStage(item.work_stage) ? 1 : 0;
  if (due === today) return 1;
  if (due === addDays(today, 1)) return 2;
  if (due <= addDays(today, 7) && item.work_status === 'in_progress') return 3;
  return null;
}

function byDueThenTime(a: WorkItem, b: WorkItem): number {
  return dueOf(a).localeCompare(dueOf(b)) || timeOf(a).localeCompare(timeOf(b)) || itemKey(a).localeCompare(itemKey(b));
}

export function rankUpNext(items: WorkItem[], today: string): WorkItem[] {
  return items
    .map(item => ({ item, tier: tierOf(item, today) }))
    .filter((x): x is { item: WorkItem; tier: number } => x.tier !== null)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier === 3) {
        const p = PRIORITY_RANK[a.item.priority] - PRIORITY_RANK[b.item.priority];
        if (p !== 0) return p;
      }
      return byDueThenTime(a.item, b.item);
    })
    .map(x => x.item);
}

export type ShowAllKey = 'more_overdue' | 'this_week' | 'next_week' | 'later' | 'waiting' | 'no_deadline';
export const SHOW_ALL_ORDER: ShowAllKey[] = ['more_overdue', 'this_week', 'next_week', 'later', 'waiting', 'no_deadline'];
export const SHOW_ALL_LABELS: Record<ShowAllKey, string> = {
  more_overdue: 'More overdue', this_week: 'This week', next_week: 'Next week',
  later: 'Later', waiting: 'Waiting', no_deadline: 'No deadline',
};

export function showAllGroups(items: WorkItem[], today: string, shown: ReadonlySet<string>): Record<ShowAllKey, WorkItem[]> {
  const g: Record<ShowAllKey, WorkItem[]> = { more_overdue: [], this_week: [], next_week: [], later: [], waiting: [], no_deadline: [] };
  const wk = addDays(today, 7);
  const nx = addDays(today, 14);
  for (const item of items) {
    if (item.work_status === 'done' || shown.has(itemKey(item))) continue;
    if (item.blocked_since !== null) { g.waiting.push(item); continue; }
    const due = dueDateOf(item);
    if (due === null) g.no_deadline.push(item);
    else if (due < today && !isRevisionStage(item.work_stage)) g.more_overdue.push(item);
    else if (due <= wk) g.this_week.push(item);
    else if (due <= nx) g.next_week.push(item);
    else g.later.push(item);
  }
  for (const k of ['more_overdue', 'this_week', 'next_week', 'later'] as const) g[k].sort(byDueThenTime);
  g.waiting.sort((a, b) => a.blocked_since!.localeCompare(b.blocked_since!));
  g.no_deadline.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title));
  return g;
}

/** "+3 more this week · 1 no deadline · 2 later" — '' when nothing is left to show. */
export function foldLabel(g: Record<ShowAllKey, WorkItem[]>): string {
  const week = g.more_overdue.length + g.this_week.length;
  const rest = g.next_week.length + g.later.length + g.waiting.length;
  const parts: string[] = [];
  if (week) parts.push(`${week} more this week`);
  if (g.no_deadline.length) parts.push(`${g.no_deadline.length} no deadline`);
  if (rest) parts.push(`${rest} later`);
  return parts.length ? `+${parts.join(' · ')}` : '';
}
```

- [ ] **Step 4:** Run `node scripts/wb-test.mjs upNext`; it should PASS. Then run tsc and the style gate.

### Task 3: Week picker data, week progress, skipped classes

**Files:**
- Create: `src/lib/workboard/ui/weekPicker.ts`
- Create: `src/lib/workboard/ui/__tests__/weekPicker.test.ts`
- Modify: `src/lib/workboard/ui/dayEntries.ts`. Add `isSkippedClass`.
- Modify: `src/components/workboard/views/TimelineDayPanel.tsx`. Import `isSkippedClass` from `dayEntries` instead of its local copy (lines ~41–44). The behaviour must not change.

**Interfaces:**
- Produces:
  - `isSkippedClass(c: ClassOccurrence): boolean` in dayEntries.ts
  - `interface PickerDay { date: string; dueCount: number; dueHours: number; classCount: number; isPast: boolean; isToday: boolean }`
  - `weekPickerDays(items: WorkItem[], classes: ClassOccurrence[], weekStart: string, today: string): PickerDay[]` (always 7 entries)
  - `dueBarHeight(day: PickerDay, week: PickerDay[]): number` returns 0–18 px. It is 0 when there's no due work; otherwise at least 4, and the busiest day gets 18. It scales by hours when any day in the week has hours, otherwise by count.
  - `weekProgress(weekStart: string, today: string, nowMinutes: number): number` returns a fraction from 0 to 1.

- [ ] **Step 1: Read** the local skipped-class helper in `TimelineDayPanel.tsx` (the `cancelled` check at ~line 43, plus the moved-away check) and copy its exact logic into `dayEntries.ts` as `isSkippedClass`.

- [ ] **Step 2: Write the failing tests.**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkItem } from '../../workItems';
import type { ClassOccurrence } from '../../aggregate';
import { weekPickerDays, dueBarHeight, weekProgress } from '../weekPicker';

const W = '2026-10-19';           // Monday
const T = '2026-10-20';           // Tuesday
const item = (due: string | null, p: Partial<WorkItem> = {}) =>
  ({ source: 'owned', id: Math.random(), work_status: 'todo', due_at: due, estimated_hours: null, ...p }) as unknown as WorkItem;
const cls = (date: string, modality: string | null = null) =>
  ({ date, start_time: '08:00', end_time: '09:00', override: modality ? { modality } : null }) as unknown as ClassOccurrence;

test('weekPickerDays counts due work, hours and live classes per day', () => {
  const days = weekPickerDays(
    [item('2026-10-20', { estimated_hours: 2 }), item('2026-10-20 00:00:00'), item('2026-10-22'),
     item('2026-10-20', { work_status: 'done' }), item(null)],
    [cls('2026-10-19'), cls('2026-10-21'), cls('2026-10-21', 'cancelled')],
    W, T);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map(d => d.dueCount), [0, 2, 0, 1, 0, 0, 0]);
  assert.equal(days[1].dueHours, 2);
  assert.deepEqual(days.map(d => d.classCount), [1, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual(days.map(d => d.isPast), [true, false, false, false, false, false, false]);
  assert.equal(days[1].isToday, true);
});

test('dueBarHeight: 0 when empty, 18 for the busiest day, min 4 otherwise', () => {
  const days = weekPickerDays([item('2026-10-20'), item('2026-10-20'), item('2026-10-20'), item('2026-10-21')], [], W, T);
  assert.equal(dueBarHeight(days[0], days), 0);
  assert.equal(dueBarHeight(days[1], days), 18);
  assert.equal(dueBarHeight(days[2], days), 6);
});

test('weekProgress is 0 before, 1 after, fractional within the week', () => {
  assert.equal(weekProgress(W, '2026-10-12', 0), 0);   // today is before the shown week
  assert.equal(weekProgress(W, '2026-10-26', 0), 1);   // today is after the shown week
  assert.equal(weekProgress(W, '2026-10-19', 720), 0.5 / 7);
});
```

`weekProgress`'s first argument is the week shown and its second is today. A shown week entirely before today is fully elapsed (1); one entirely after today has not started (0).

- [ ] **Step 3:** Run `node scripts/wb-test.mjs weekPicker`. Expected: FAIL.

- [ ] **Step 4: Implement** `weekPicker.ts`.

```ts
/** Focus week picker data (refine spec §5.2). Pool-free. */
import type { WorkItem } from '@/lib/workboard/workItems';
import type { ClassOccurrence } from '@/lib/workboard/aggregate';
import { addDays, dueDateOf } from '@/lib/workboard/dates';
import { isSkippedClass } from './dayEntries';

export interface PickerDay { date: string; dueCount: number; dueHours: number; classCount: number; isPast: boolean; isToday: boolean }

export function weekPickerDays(items: WorkItem[], classes: ClassOccurrence[], weekStart: string, today: string): PickerDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const due = items.filter(it => it.work_status !== 'done' && dueDateOf(it) === date);
    return {
      date,
      dueCount: due.length,
      dueHours: due.reduce((s, it) => s + (it.estimated_hours ?? 0), 0),
      classCount: classes.filter(c => c.date === date && !isSkippedClass(c)).length,
      isPast: date < today,
      isToday: date === today,
    };
  });
}

export function dueBarHeight(day: PickerDay, week: PickerDay[]): number {
  if (day.dueCount === 0) return 0;
  const byHours = week.some(d => d.dueHours > 0);
  const val = (d: PickerDay) => (byHours ? d.dueHours : d.dueCount);
  const max = Math.max(...week.map(val));
  if (max <= 0) return 4;
  return Math.max(4, Math.round((val(day) / max) * 18));
}

export function weekProgress(weekStart: string, today: string, nowMinutes: number): number {
  if (today < weekStart) return 0;
  const end = addDays(weekStart, 6);
  if (today > end) return 1;
  let idx = 0;
  while (addDays(weekStart, idx) !== today) idx += 1;
  return (idx + nowMinutes / 1440) / 7;
}
```

- [ ] **Step 5:** Run `node scripts/wb-test.mjs`; all tests should pass. Then run tsc and the style gate on the changed files.

---

## Phase 1: Glass system

### Task 4: Glass tokens, classes and the style-gate stripe rule

**Files:**
- Modify: `src/app/workboard/workboard.css`. Add a `/* ---------- Glass system (refine spec §3) ---------- */` block after the existing shared state classes.
- Modify: `scripts/wb-style-gate.mjs`

**Interfaces:**
- Produces:
  - **Tokens:**
    - `--wb-glass-panel`, `--wb-glass-panel-border`, `--wb-glass-panel-shadow`
    - `--wb-glass-item`, `--wb-glass-item-border`, `--wb-glass-item-shadow`, `--wb-glass-item-shadow-hover`
    - `--wb-r-panel` (22px), `--wb-r-item` (14px)
    - `--wb-pink-strong` (#d94f86), `--wb-pink-deep` (#c9437a)
    - status dot colours `--wb-st-todo` (#9aa5b8), `--wb-st-progress` (#3b8fe0), `--wb-st-done` (#2fb47a); waiting = `var(--wb-warn)`, revision = `var(--wb-ctx-academic)`
  - **Classes:** `.wb-glass-panel`, `.wb-glass-item`, `.wb-glass-item--hoverable`, `.wb-gdot` (colour via `--dot`), `.wb-gdot--flat` (no glow), `.wb-gpill`

- [ ] **Step 1: Add the tokens** to the existing `:root`/token block, using the spec §3 values verbatim.

- [ ] **Step 2: Add the classes.**

```css
/* ---------- Glass system (refine spec §3) ---------- */
.wb-glass-panel {
  position: relative; background: var(--wb-glass-panel); border: var(--wb-glass-panel-border);
  border-radius: var(--wb-r-panel); box-shadow: var(--wb-glass-panel-shadow);
}
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .wb-glass-panel { -webkit-backdrop-filter: blur(22px) saturate(160%); backdrop-filter: blur(22px) saturate(160%); }
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .wb-glass-panel { background: rgba(255, 255, 255, 0.72); }
}
.wb-glass-item {
  background: var(--wb-glass-item); border: var(--wb-glass-item-border);
  border-radius: var(--wb-r-item); box-shadow: var(--wb-glass-item-shadow);
}
.wb-glass-item--hoverable { transition: transform var(--wb-dur-fast) var(--wb-ease); }
@media (hover: hover) and (pointer: fine) {
  .wb-glass-item--hoverable:hover { transform: translateY(-1px); box-shadow: var(--wb-glass-item-shadow-hover); }
}
.wb-gdot {
  width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; background: var(--dot);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dot) 18%, transparent), 0 0 10px color-mix(in srgb, var(--dot) 60%, transparent);
}
.wb-gdot--flat { box-shadow: 0 0 0 3px color-mix(in srgb, var(--dot) 20%, transparent); }
.wb-gpill {
  display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
  font: 650 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text);
  padding: 4px 11px 4px 9px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.55); border: 1px solid rgba(255, 255, 255, 0.8); box-shadow: inset 0 1px 0 #fff;
}
@media (prefers-reduced-motion: reduce) {
  .wb-glass-item--hoverable { transition: none; }
  .wb-glass-item--hoverable:hover { transform: none; }
}
```

The box-shadow change on hover is a paint-only exception the revamp already sanctioned; only `transform` transitions.

- [ ] **Step 3: Add the stripe rule** to the style gate's `rules` array.

```js
  { id: 'side-stripe', test: l =>
      /inset\s+[23]px\s+0\s+0|border-?(left|top)['"]?\s*[:=]\s*['"`]?\s*3px|border(Left|Top):\s*`3px/i.test(l)
      && !/wb-toast--error|wb-pal__row/.test(l) },
```

(`wb-pal__row` keeps its 2px palette selection indicator: it marks selection, not data.)

- [ ] **Step 4: Verify.** tsc exits 0; `node scripts/wb-style-gate.mjs src/app/workboard/workboard.css` is clean. Then run the gate over `src/components/workboard/**/*.tsx`. It **is expected to fail** on the existing stripes: TimelineDayPanel :217/:228, WorkBoardView :181/:565, WorkTableView :1029, WorkTimelineView :768/:818/:854. List those lines in your report; Tasks 11–13 remove them.

---

## Phase 2: Header, toolbar, KPI

### Task 5: Header, context tabs and view switcher

**Files:**
- Modify: `src/components/workboard/WorkboardShell.tsx`. Header block (~line 450–555) and its styled-jsx (~840–900).
- Modify: `src/components/workboard/ui/WbSegmented.tsx`. Styles for the view switcher's active segment.

**Interfaces:**
- Consumes: `--wb-pink-strong` and `--wb-pink-deep` (Task 4).
- Produces: `.wb-btn-primary` in `workboard.css` (the New item pill), which other tasks may reuse.

- [ ] **Step 1: Title.** Replace `<h1 className="gradient-text" …>` with a solid title (spec §4).

```tsx
<h1 className="vb-title">
  <span className="vb-title__mark" aria-hidden />
  Workboard
</h1>
```

Styles: `.vb-title { display:flex; align-items:center; gap:10px; margin:0 0 4px; font: 800 28px/1.15 var(--wb-font-head); letter-spacing:-0.02em; color: var(--wb-text); }` and `.vb-title__mark { width:12px; height:28px; border-radius:6px; background: linear-gradient(180deg, var(--wb-pink-strong), var(--wb-blue)); }`. Use the nearest existing `--wb-blue*` token for the `#7aa7e0` stop; if none is close, add `--wb-mark-blue: #7aa7e0` in workboard.css. On phone (<768px) use 22px text and a 10×22 mark.

- [ ] **Step 2: Subtitle.** Show the long date only, e.g. "Tuesday, October 20". Remove the "· N due today · N overdue" parts and the `todaySummary` call, if this was its only use (grep first).

- [ ] **Step 3: New item** (both rendered copies). Add `.wb-btn-primary` to `workboard.css`:
  - `background: linear-gradient(180deg, var(--wb-pink-strong), var(--wb-pink-deep))`, white text, `font: 700 var(--wb-fs-14)`, `border-radius: 999px`, padding `9px 18px`, `box-shadow: 0 6px 16px -6px rgba(217,79,134,.55)`, border none
  - plus `wb-pressable` and `wb-focus-ring`

  Check that white on `--wb-pink-deep` is ≥ 4.5:1. If it isn't, darken `--wb-pink-deep` until it passes, and report the final value.

- [ ] **Step 4: Context tabs.** The active underline becomes `2px var(--wb-pink-strong)`. On phone, the scroll container gets `mask-image: linear-gradient(90deg, #000 80%, transparent)` (plus the `-webkit-` prefix). Drop the mask once the strip is scrolled to its end: track `scrollLeft + clientWidth >= scrollWidth - 1` on scroll and set `data-at-end`.

- [ ] **Step 5: View switcher** (WbSegmented, view variant only, so other WbSegmented uses are unchanged):
  - the track is `rgba(31,41,55,.05)` with radius 12 and padding 3
  - the active segment is `background: var(--wb-surface)`, weight 700, `box-shadow: 0 1px 2px rgba(31,41,55,.08), 0 4px 10px -4px rgba(31,41,55,.15)`

  Keep the existing sliding-indicator mechanics; only restyle them.

- [ ] **Step 6: Verify.** tsc, the style gate on the changed files, and the smoke check.

### Task 6: KPI cards

**Files:**
- Modify: `src/components/workboard/WorkboardStats.tsx`
- Modify: `src/components/workboard/views/WorkListView.tsx`. Only export `UP_NEXT_ID = 'vb-up-next'` next to `OVERDUE_SECTION_ID`; keep the old export until Task 10 removes its last user.

**Interfaces:**
- Consumes: `UP_NEXT_ID`.

- [ ] **Step 1: Card shell.**
  - Delete `topStripe`, `IconChip` and the `icon`/`accent` props, plus the `ACCENT` map and icon imports if they become unused.
  - Cards use `className="wb-glass-item"` with radius 16 and padding `14px 16px`.
  - Keep `onActivate` turning the card into a `<button>`.

- [ ] **Step 2: Numeral.** `font: 750 34px/1.1 var(--wb-font-head); letter-spacing:-0.02em; font-variant-numeric: tabular-nums`. A value of 0 renders in `var(--wb-text-subtle)`; pass a `zero` flag from each card. Overdue at zero keeps "All clear" in `--wb-success`.

- [ ] **Step 3: Overdue > 0.**
  - Card background `linear-gradient(180deg, rgba(255,235,242,.9), rgba(255,245,248,.8))`, border `1px solid rgba(217,79,134,.25)`.
  - Subtitle: `Oldest from <Mon D> · Review →`.
  - `onActivate` scrolls `#${UP_NEXT_ID}` into view (`block: 'start'`, smooth unless reduced motion) and sets `data-flash` on the element for 900ms. Task 8 styles the flash.
  - `activateTitle` becomes "Review overdue work".

- [ ] **Step 4: Copy.**
  - Estimated card label: "This week".
  - Due Soon subtitle at 0: "Nothing in the next 3 days".
  - Estimated subtitle when no items: "No estimates yet".
  - Keep `ProgressBar`, `DueDots` and `Sparkline` unchanged.

- [ ] **Step 5: Phone strip** (<768px). Change the grid to `display:flex; overflow-x:auto; scroll-snap-type:x mandatory; gap:8px;` with cards `flex: 0 0 140px; scroll-snap-align:start; padding: 10px 12px`, numeral 24px, and the micro-visual hidden. Hide the scrollbar visually but keep it scrollable. Tablet stays a 2×2 grid; desktop stays 4 across.

- [ ] **Step 6: Verify.** tsc, the style gate, and the smoke check.

---

## Phase 3: Focus

### Task 7: Shell wiring for Focus

**Files:**
- Modify: `src/components/workboard/WorkboardShell.tsx`
- Delete: `src/components/workboard/WorkboardRail.tsx` (its only importer is the shell; grep again to confirm before deleting)
- Modify: `src/components/workboard/views/WorkListView.tsx`. Props only, in this task.

**Interfaces:**
- Produces new `WorkListViewProps` fields:

```ts
  weekStart: string;                       // week.week_start
  classOccurrences: ClassOccurrence[];     // week.class_occurrences
  onWeekChange: (weekStart: string) => void; // goToWeek
  weekLoading: boolean;
  allItems: WorkItem[];                    // work.items (whole board, for the picker's load bars)
```

- [ ] **Step 1: Remove the rail.** Delete the `view === 'list'` rail block and the `.vb-rail-wrap` styles. Delete `WorkboardRail.tsx` and its import. If `work.workload` was used only by the rail, leave the payload alone; it is a server field.

- [ ] **Step 2: Drop the glass wrapper for Focus.** The `GLASS` wrapper `<div style={{ ...GLASS, padding: '20px' }}>` wraps all views. Make it conditional: Focus renders bare (its own panels come in Tasks 8–9), and the other three keep it. In Task 11–13 it becomes `className="wb-glass-panel"`; in this task, keep the `GLASS` inline style for those three.

- [ ] **Step 3:** Pass the new props to `WorkListView`. Add them to `WorkListViewProps` and accept them unused for now, prefixed with `_` if the lint config needs it.

- [ ] **Step 4: Verify.** tsc, the style gate, and the smoke check. Focus still renders its old sections without the outer panel. That is expected until Task 8.

### Task 8: Up next (hero + compact cards) and Reschedule trigger

**Files:**
- Create: `src/components/workboard/views/UpNext.tsx` (exports `UpNextHero`, `UpNextCard`)
- Modify: `src/components/workboard/table/DeadlineCell.tsx`. Add `variant?: 'cell' | 'button'`; `'button'` renders the trigger as a glass button labelled "Reschedule" (calendar icon). The popover, optimistic logic and `editor` contract are unchanged.
- Modify: `src/components/workboard/views/WorkListView.tsx`
- Modify: `src/app/workboard/workboard.css` (the `[data-flash]` rule)

**Interfaces:**
- Consumes:
  - `rankUpNext`, `UP_NEXT_LIMIT` (Task 2)
  - `shortCourseCode` (Task 1)
  - `contextChip` (FocusRow.tsx)
  - `useDeadlineEditor`, `DeadlineCell` (DeadlineCell.tsx)
  - `UP_NEXT_ID` (Task 6)
- Produces:
  - `UpNextHero({ item, todayStr, onComplete, onOpenDetail, editor })`
  - `UpNextCard({ item, todayStr, onComplete, onOpenDetail })`

- [ ] **Step 1: `UpNextHero`** follows the `focus-c-detail.html` hero.
  - **Container:** `.wb-glass-item`, radius 16, padding `16px 18px`, extra shadow `0 12px 30px rgba(214,69,122,.12)`.
  - **Eyebrow** (11px uppercase 800):
    - overdue: `OVERDUE · N DAYS`, using `daysSince(due, today)`, in `--wb-danger`
    - today: `TODAY · h:mm AM` or `TODAY` (`--wb-pink-strong`)
    - tomorrow: `TOMORROW`
    - otherwise: weekday `THU`
  - **Body:**
    - `WbCheckbox shape="round"` at 22px. Add a `size` prop to WbCheckbox if it lacks one; the default stays 18.
    - Title button: 16px 650; opens the detail drawer; clamped to 2 lines.
  - **Meta row:**
    - a `.wb-gpill` with a `.wb-gdot` (`--dot` = the course colour or `contextChip(item).fill`) and `shortCourseCode(course_code)`, or the context label
    - the due label (`formatDueLabel`)
    - `~Nh` when there's an estimate
    - `🔗 N` → use lucide `Link2` plus the count, when `link_count > 0`
    - `waitingLabel(...)` when `blocked_since`
  - **Actions** (gap 8):
    - "Mark done": dark primary button `background: var(--wb-text); color: var(--wb-surface)`, calls `onComplete`
    - `<DeadlineCell item={item} column="deadline" variant="button" todayStr={todayStr} editor={editor} />`
    - "Open": glass button, calls `onOpenDetail`
  - **Phone (<768px):** hide "Open". Mark done reads "Done".

- [ ] **Step 2: `UpNextCard`.** A `.wb-glass-item.wb-glass-item--hoverable` row, padding `11px 14px`, margin-bottom 8. It holds: a round 18px checkbox, the title button (ellipsis), the context pill (hidden < 768px), and the due label (`--wb-pink-strong` when due today, `--wb-danger` when overdue).

- [ ] **Step 3: Wire into `WorkListView`.**
  - Keep the existing `complete` function. Both components call it, and the `wb-collapse` wrapper and `inert` handling apply to each card exactly as they do to rows today.
  - `const ranked = useMemo(() => rankUpNext(items, todayStr), …)`, `const upNext = ranked.slice(0, UP_NEXT_LIMIT)`.
  - Render `<section id={UP_NEXT_ID} aria-label="Up next">` containing the "UP NEXT" eyebrow, the hero (`upNext[0]`), then `upNext.slice(1)` as cards.
  - Create `const editor = useDeadlineEditor(onChanged)` once in WorkListView.
  - Leave the old sections rendered below for now; Task 10 replaces them.

- [ ] **Step 4: Promotion crossfade.**
  - Key the hero wrapper by `itemKey(upNext[0])`, and give it `animation: wb-upnext-in var(--wb-dur-base) var(--wb-ease)` with `@keyframes wb-upnext-in { from { opacity:0; transform: translateY(4px); } }`.
  - Skip the animation when the last completion came from the keyboard (`e.detail === 0` on the checkbox/Mark done click; WbCheckbox's `onChange(next, e)` passes the event) and under reduced motion.

- [ ] **Step 5: Flash.** In `workboard.css`, `[data-flash] .vb-upnext-hero { box-shadow: 0 0 0 2px var(--wb-pink-strong), 0 12px 30px rgba(214,69,122,.2); }`. No animation.

- [ ] **Step 6: Verify.** tsc, the style gate, `wb-test`, and the smoke check.

### Task 9: Week picker

**Files:**
- Create: `src/components/workboard/views/FocusWeekPicker.tsx`
- Modify: `src/components/workboard/views/WorkListView.tsx`

**Interfaces:**
- Consumes:
  - `weekPickerDays`, `dueBarHeight` (Task 3)
  - `buildDayEntries`, `entryKey`, `isSkippedClass` (dayEntries.ts)
  - `formatClock`, `useNowMinutes` (nowMinutes.ts)
  - `WbQuickAdd`
  - Task 7's props
- Produces: `FocusWeekPicker(props: { items: WorkItem[]; allItems: WorkItem[]; classOccurrences: ClassOccurrence[]; weekStart: string; todayStr: string; onWeekChange: (ws: string) => void; weekLoading: boolean; selected: string; onSelect: (date: string) => void; onComplete: (item: WorkItem) => void; onOpenDetail: (item: WorkItem) => void; filter: WorkContext | 'all'; courses: CourseOption[]; onChanged: () => void | Promise<void> })`

- [ ] **Step 1: Layout** (desktop panel, following `focus-c-detail.html`).
  - **Container:** `.wb-glass-panel`, padding 14.
  - **Header:** a row with "WEEK OF OCT 19" (11px uppercase 800), then ‹ › icon buttons (`onWeekChange(addDays(weekStart, ±7))`, disabled while `weekLoading`). Add a "Today" glass pill when `todayStr` is outside the shown week; it calls `onWeekChange(mondayOf(todayStr))`.
  - **Tiles grid:** `repeat(7, minmax(0,1fr))`, gap 6. Each tile is a `<button>` with `aria-pressed={selected===date}` and `aria-label="Thu Oct 22, 1 due, 1 class"`. It contains:
    - the day letter (11px 800)
    - the date (15px 700)
    - a bar row 18px tall: a pink bar of `dueBarHeight` (`--wb-pink-strong`, opacity .8, 6px wide), and one blue 6px bar per class, max 3 (`--wb-blue`, opacity .55)
  - **Tile states:**
    - past tiles: opacity .55
    - selected: `background: var(--wb-surface); box-shadow: 0 0 0 2px rgba(217,79,134,.4)`
    - today: the day letter in `--wb-pink-strong`
  - **Arrow keys:** Left/Right move between tiles, the roving-tabindex pattern that `WbSegmented` uses.
  - **Tile data:** from `weekPickerDays(allItems, classOccurrences, weekStart, todayStr)`. Whole-board items, so the bars don't change with search, matching the old rail's rule.

- [ ] **Step 2: Selected-day list.**
  - **Heading:** `THURSDAY OCT 22 · 1 DUE · 1 CLASS`; for today, `TODAY · TUE OCT 20 · …`.
  - **Entries:** `buildDayEntries(selected, classesOn(selected), [], itemsDueOn(selected))`. Use `items` (filtered) for the due rows, so search and context filtering apply to the list.
  - **Item rows:** round checkbox (`onComplete`), title button (`onOpenDetail`), and the revision/waiting pill when relevant.
  - **Class rows:** a 6px rounded blue bar, then the muted course code and the time range via `formatClock`. Skipped classes are struck through with "· cancelled" / "· moved".
  - **Empty day:** "Nothing due" plus ", no classes" when there are none, in muted text.
  - **Footer:** `~Nh estimated` when any hours, and a `+ Add for <Thu>` trigger opening `WbQuickAdd` with `defaults.dueAt = selected`.
  - **Day switch:** a 120ms opacity crossfade on the list (key by `selected`); none under reduced motion or for keyboard selection.

- [ ] **Step 3: Desktop layout in WorkListView.**
  - `grid-template-columns: minmax(0,1.1fr) minmax(0,1fr); gap: 14px; align-items: start`.
  - Up next and Show all on the left; the picker on the right.
  - `selected` state defaults to `todayStr` when today is inside the shown week, otherwise to `weekStart`. Reset it the same way when `weekStart` changes.

- [ ] **Step 4: Phone (<768px).** One column, in this order: the picker's tile strip (no panel chrome, tiles 4px gap, no bar row), then a `phoneDay: string | null` state.
  - Tapping a tile sets `phoneDay`, and the Up next area is replaced by that day's list with a "← Back to up next" button.
  - Tapping the selected tile again, or Back, clears it.
  - The desktop list section is not rendered on phone.

- [ ] **Step 5: Tablet (768–1023px).** One column: Up next, then the picker panel (full), then Show all.

- [ ] **Step 6: Verify.** tsc, the style gate, and the smoke check.

### Task 10: Show all, empty and sparse states, and old-section removal

**Files:**
- Modify: `src/components/workboard/views/WorkListView.tsx`
- Modify: `src/components/workboard/WorkboardStats.tsx` (drop the `OVERDUE_SECTION_ID` import if it's still there)

**Interfaces:**
- Consumes: `showAllGroups`, `SHOW_ALL_ORDER`, `SHOW_ALL_LABELS`, `foldLabel` (Task 2).

- [ ] **Step 1: Delete the old Focus code.** Remove the six-section rendering, the Waiting section, `SECTIONS`, `SECTION_ORDER`, `sectionDueDate`, `SECTION_ADD_LABEL` and `OVERDUE_SECTION_ID`. Grep `OVERDUE_SECTION_ID` across `src` and remove every use.

- [ ] **Step 2: Show all.**
  - `const shown = new Set(upNext.map(itemKey))`, `const groups = showAllGroups(items, todayStr, shown)`, `const label = foldLabel(groups)`.
  - When `label` is non-empty, render a fold button (`aria-expanded`): text `label` on the left, "Show all ▾" / "Hide ▴" on the right, muted 600.
  - When expanded, render inside a `.wb-glass-panel` (padding `8px 10px`), using the existing `.wb-collapse` grid-rows animation for open/close:
    - a header row "All work · N"
    - for each key in `SHOW_ALL_ORDER` with items: an 11px uppercase 800 group label `"<SHOW_ALL_LABELS[k]> · n"`, a `+ Add` trigger (dueAt: `this_week` → today+2, `next_week` → today+8, `later` → today+15, `no_deadline` → null; none for `more_overdue` and `waiting`), and `FocusRow` rows (`variant="waiting"` for the waiting group)
  - Persist expanded state in `localStorage` key `wb-focus-showall`. Wrap reads and writes in try/catch, and default to collapsed.

- [ ] **Step 3: States.**
  - **No open items and not filtered:** keep the existing "Nothing due" empty block, with title changed to "Nothing urgent. Nice." and the today quick add.
  - **Filtered to nothing:** keep the existing SearchX block.
  - **Up next empty but other work exists:** in place of the hero, a `.wb-glass-item` line "Nothing due soon", with Show all opened by default.
  - **When `label === ''` and Up next isn't empty:** after the cards, a soft green line `rgba(47,157,106,.08)` background, text `--wb-success`, "✓ Nothing else due this week".

- [ ] **Step 4: Verify.** tsc, the style gate, `wb-test`, and the smoke check. Grep that `WorkboardRail` and `OVERDUE_SECTION_ID` have no remaining references.

---

## Phase 4: Views

### Task 11: Table glass

**Files:**
- Modify: `src/components/workboard/views/WorkTableView.tsx`
- Modify: `src/components/workboard/table/StatusCell.tsx` (pill trigger)
- Modify: `src/components/workboard/WorkboardShell.tsx` (the Table wrapper becomes `className="wb-glass-panel"` with padding 10, replacing `GLASS` for Table)

**Interfaces:**
- Consumes: `.wb-glass-panel`, `.wb-glass-item`, `.wb-gdot`, `.wb-gpill`, `--wb-st-*` (Task 4); `shortCourseCode`.

- [ ] **Step 1: Read** WorkTableView's desktop grid/table structure and its phone card fallback. Keep the semantics: `role="grid"`/table markup, the bulk selection column, inline editors and keyboard behaviour. Change presentation only.

- [ ] **Step 2: Header row.** No background. 40px tall, 11px uppercase 800 `--wb-text-muted`. Sticky (`position: sticky; top: 0`) within the panel's scroll container, with `background: var(--wb-glass-panel)` so rows slide under it.

- [ ] **Step 3: Rows.**
  - Each row is `.wb-glass-item .wb-glass-item--hoverable`, 52px tall, radius 14, with a 6px vertical gap.
  - If the markup is a `<table>`, use `border-collapse: separate; border-spacing: 0 6px` and put the glass on `td` (first and last cell radii). Otherwise use the grid row directly.
  - Delete the `borderLeft: 3px … EDGE_COLOR` style (~line 1029) and the `EDGE_COLOR` map if it's now unused.

- [ ] **Step 4: Columns.**
  - Work first: 650 14px `--wb-text`.
  - Context: `.wb-gdot` (`--dot` = `CONTEXT_FILL[ctx]`, or the course colour for academic items with a course) plus the label in 550 13px muted.
  - Other cells: 550 13px muted.

  If the current column order differs from spec §6 (checkbox, Work, Context, Status, Priority, Deadline, Time, Links), reorder it in the column definition, not by CSS.

- [ ] **Step 5: StatusCell.** The select trigger renders as `.wb-gpill` with `<span className="wb-gdot" style={{'--dot': statusDot(stage)}} />` + label. `statusDot` maps:
  - `normaliseStage(stage)`: todo → `--wb-st-todo` (flat dot), in_progress → `--wb-st-progress`, done → `--wb-st-done`
  - waiting stages → `--wb-warn`
  - revision → `--wb-ctx-academic`

  The popover, WaitingPopover and Undo flow are untouched.

- [ ] **Step 6: Row states.**
  - **Overdue:** row background `linear-gradient(90deg, rgba(255,196,218,.95), rgba(255,255,255,.6) 55%)`; deadline text "⚠ Overdue · Jul 7" in `--wb-danger` 700.
  - **Done:** title `--wb-text-subtle`, `text-decoration: line-through`, `text-decoration-color: rgba(154,165,184,.6)`.
  - **Selected:** `background: linear-gradient(90deg, rgba(59,143,224,.14), rgba(255,255,255,.6)); box-shadow: inset 0 0 0 1.5px rgba(59,143,224,.45), var(--wb-glass-item-shadow)`.

- [ ] **Step 7: Footer** below the rows: `"N items · M overdue"` (muted 600) and a `+ New item` text button calling `onNewItem`.

- [ ] **Step 8: Phone cards.** `.wb-glass-item`, keeping their current content.

- [ ] **Step 9: Verify.** tsc, the style gate on all changed files (the side-stripe rule must pass for WorkTableView), and the smoke check.

### Task 12: Board glass

**Files:**
- Modify: `src/components/workboard/views/WorkBoardView.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx` (the Board wrapper: no outer panel; lanes are the panels)

**Interfaces:**
- Consumes: the glass classes, `shortCourseCode`, `--wb-st-*`.

- [ ] **Step 1: Lanes.**
  - Grid `repeat(var(--lanes), minmax(280px, 1fr))`, gap 16; `overflow-x: auto` only when the lanes exceed the width.
  - Each lane is `.wb-glass-panel`, padding 12, min-height 320.
  - Remove `borderTop: 3px …` (~line 565). Add an absolutely positioned wash `<span aria-hidden className="vb-lane-wash" />` (`inset: 0 0 auto 0; height: 90px; border-radius: 22px 22px 0 0; background: linear-gradient(180deg, color-mix(in srgb, <statusColour> 26%, transparent), transparent)`).
  - Lane header: `.wb-gdot` + sentence-case name (14px 750) + a count `.wb-gpill`.
  - Keep phone scroll-snap at 85% lane width.

- [ ] **Step 2: Cards.**
  - `.wb-glass-item`, radius 16, padding `13px 14px`. Remove `borderLeft: 3px` (~line 181).
  - Title: 14px 650, 3-line clamp, `overflow-wrap: anywhere` (keep D2).
  - Meta row (wrap, gap 8):
    - course/context `.wb-gpill` (padding `2px 9px 2px 7px`) with `.wb-gdot` and `shortCourseCode` (full code in `title`)
    - a deadline tag (`padding 3px 9px; radius 8; background rgba(255,255,255,.55)`; overdue: `background: rgba(232,85,143,.14); color: var(--wb-danger)`)
    - link count
    - the waiting/revise badge as it is today
  - **R1:** when `priority === 'high'`, add a `.wb-gpill` with `ArrowUp` (12px) + "High", text `--wb-priority-high`.
  - **Subtask bar**, only when `subtask_total > 0`: 4px tall, radius 2, track `rgba(93,104,128,.12)`, fill `linear-gradient(90deg, var(--wb-blue), var(--wb-pink-strong))`, width `done/total`, `role="img"`, `aria-label="2 of 5 subtasks done"`.

- [ ] **Step 3: Drag and hover.**
  - The dragged card gets `transform: translateY(-2px) rotate(-.4deg)` plus `--wb-glass-item-shadow-hover`, transition 120ms transform.
  - Hover lift uses `.wb-glass-item--hoverable` (fine pointer only).
  - The ⋮ menu: under `(hover:hover) and (pointer:fine)`, `opacity: 0` until `.card:hover` / `:focus-within`, with an `opacity` transition at 120ms. It's always visible on touch, and it stays keyboard reachable (opacity only, never `display: none`).

- [ ] **Step 4: Empty lane.** A drop target `border: 1.5px dashed rgba(255,255,255,.9); border-radius: 16px; padding: 22px 10px; background: rgba(255,255,255,.2); text-align:center` with copy "Drag finished work here" (done lane) or "Nothing here yet".

- [ ] **Step 5: Verify.** tsc, the style gate (the side-stripe rule passes for WorkBoardView), and the smoke check.

### Task 13: Timeline glass

**Files:**
- Modify: `src/components/workboard/views/WorkTimelineView.tsx`
- Modify: `src/components/workboard/views/TimelineDayPanel.tsx` (replace `border-left: 3px` with a `.wb-gdot`)
- Modify: `src/components/workboard/WorkboardShell.tsx` (the Timeline wrapper: no outer `GLASS`; the sheet is the panel)

**Interfaces:**
- Consumes: the glass classes, `weekProgress` (Task 3), `useNowMinutes`, `courseColor`.

- [ ] **Step 1: Sheet and header.**
  - The whole week sits on one `.wb-glass-panel`, padding 18.
  - Header row: range title (16px 700), then a progress bar (`flex: 1; height: 6px; radius 3; track rgba(255,255,255,.5)`; fill `linear-gradient(90deg, var(--wb-blue), var(--wb-pink-strong))`; width `weekProgress(weekStart, today, now ?? 0) * 100%`; `role="progressbar"` with `aria-valuenow` as a percentage and `aria-label="Week progress"`; no transition), then the ‹ Today › controls as `.wb-gpill` buttons.

- [ ] **Step 2: Columns.**
  - Desktop `grid-template-columns: repeat(5, minmax(0,1fr)) repeat(2, minmax(0,.7fr))`, gap 10. Keep the existing phone scroll-snap rules, with weekends the same width as weekdays on phone.
  - Day tiles: `.wb-glass-item`, radius 18, padding `12px 10px`, min-height 250; date 22px 750.
  - Past days: opacity .6.
  - Weekends: `background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.35); box-shadow: none`.

- [ ] **Step 3: Today.**
  - `background: linear-gradient(180deg, rgba(255,255,255,.88), rgba(255,236,245,.7)); box-shadow: inset 0 1px 0 #fff, 0 0 0 1.5px rgba(232,85,143,.45), 0 26px 50px -20px rgba(232,85,143,.55)`.
  - Date in `--wb-pink-strong`; label "TUE · TODAY".
  - Restyle the existing `.vb-tl-now` marker to a 2px `--wb-pink-strong` line with an 8px dot and `box-shadow: 0 0 10px rgba(232,85,143,.8)`, keeping its current positioning logic.
  - Selected-day focus state: keep the existing behaviour and restyle its ring to match.

- [ ] **Step 4: Chips.**
  - **Class cards** (~line 768): remove `borderLeft`; `background: linear-gradient(160deg, color-mix(in srgb, ${color} 45%, transparent), rgba(255,255,255,.45)); border: 1px solid rgba(255,255,255,.75); border-radius: 12px`. Course code 12.5px 700 (keep the 2-line clamp); time 12px 600 muted.
  - **Work/deadline chips** (~line 818): `background: rgba(255,255,255,.75); border: 1px solid #fff; box-shadow: 0 8px 18px -12px rgba(60,40,110,.45)`, with a `Flag` icon (12px) before the title; text "Due 11:59 PM" when timed.
  - **Life/event chips** (~line 854): the same tinted-glass recipe as classes, with `var(--wb-ctx-life)`.
  - Cancelled/moved class styling stays (strike-through and opacity).

- [ ] **Step 5: Empty days.** Remove every "Nothing scheduled". Today with no entries shows a 34px orb (`border-radius:50%; background: radial-gradient(circle at 35% 30%, #fff, rgba(255,255,255,.2)); border: 1px solid rgba(255,255,255,.9)`) above "Free day" (12px 600 muted), centred with `margin-top: 30px`.

- [ ] **Step 6: TimelineDayPanel.** Replace `.vb-day-body`'s `border-left: 3px solid` + `borderLeftColor: edge` with a leading `<span className="wb-gdot" style={{ '--dot': edge }} />` in the row's flex layout.

- [ ] **Step 7: Leave unchanged:** the conflict summary, the day panel's behaviour and the card clamps (restyle only).

- [ ] **Step 8: Verify.** tsc, the style gate. Then run `node scripts/wb-style-gate.mjs $(git ls-files -mo --exclude-standard src/components/workboard src/app/workboard)`; the side-stripe rule must now be clean on every Workboard file. Run the smoke check.

---

## Phase 5: QA

### Task 14: Busy fixture page, break-ui pass and fixes

**Files:**
- Create (temporary): `src/app/workboard/stress/page.tsx` and `src/app/workboard/stress/fixtures.ts`.
  - Dev-only: `if (process.env.NODE_ENV === 'production') notFound()`.
  - Renders `WorkboardShell` with fixture `initialWork` and `initialWeek`; fixture ids ≥ 900000.
  - Cases via `?case=`:
    - `sparse` (2 items: one 105 days overdue, one undated)
    - `busy` (about 12 items across every Up next tier and every Show all group, 6 classes, events, estimates, one waiting item, one revision item)
    - `long` (long and unbreakable titles, an unbreakable course code, a 60-character waiting reason)
    - `empty` (no items)
- Modify: whatever the pass finds broken.

- [ ] **Step 1: Build the fixture page** (the controller confirms it renders).
- [ ] **Step 2: Controller runs `break-ui`** on Focus (Up next, week picker, Show all), Board cards and Timeline at 390, 820 and 1440, and records defects in `docs/superpowers/plans/2026-10-20-workboard-refine-qa.md` (a "Defects" table).
- [ ] **Step 3: Fix every defect at its root.** Then run tsc, the style gate and the smoke check.
- [ ] **Step 4: Delete `src/app/workboard/stress/`** once the controller signs off.

### Task 15: Final verification

- [ ] **Step 1:** `npx tsc --noEmit` exits 0, and `node scripts/wb-test.mjs` passes.
- [ ] **Step 2:** The style gate is clean on every created or modified file in this plan.
- [ ] **Step 3:** Smoke check: `/workboard` returns 200 with `NEXT_REDIRECT` and `/login`, and `/api/workboard/work` returns 401.
- [ ] **Step 4:** Playwright (controller), logged in:
  - all four views plus the palette, New item dialog and drawer at 390, 820 and 1440
  - Focus with Show all open and closed, and a week picker day selected
  - `browser_emulate_media({ reducedMotion: 'reduce' })` pass
  - zero console errors, and `scrollWidth - innerWidth <= 0` everywhere
- [ ] **Step 5: Contrast.** Compute ratios for every new text/background pair (eyebrows, muted cells, pill text, New item, zero numerals, "Free day") against `#c2e9fb` with the panel alpha applied, and record them in the QA file. Body text must be ≥ 4.5:1; the zero numerals are large text (≥ 3:1).
- [ ] **Step 6:** `git status`. List this plan's files separately from unrelated work. Do not commit.
