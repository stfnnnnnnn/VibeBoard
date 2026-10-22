# Finance Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Finance section (`/finance`) on Workboard's token system with a Pace hero, four tabs (Overview / Plan / Activity / Goals), an always-open log composer plus a "Log again" drawer, envelope budgets, a goal timeline, a wishlist and a drag-to-preview What-if, with toasts + Undo, skeletons and a new-cycle prompt.

**Architecture:**
- Pure, pool-free money/date logic lives in `src/lib/finance/` and is unit-tested with Node's built-in test runner through a tiny zero-dependency transpile script.
- API changes are small and additive: a shared server module for the safe-to-spend maths, Manila-time "today" everywhere, pace fields on `safe-to-spend`, and three new read-only/CRUD routes (`log-context`, `feed`, `wishlist`).
- The UI is split into focused client components under `src/components/finance/`, styled by global `fin-*` classes in `src/app/finance/finance.css` on top of Workboard's `--wb-*` tokens and `Wb*` primitives (imported, never modified).
- Old UI pieces are first moved verbatim into `legacy/` files and mounted inside the new tabs, then replaced one phase at a time, so Finance works after every task.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5.9, mysql2 (`dateStrings: true`, `timezone: '+08:00'`), Sonner via `WbToaster`, lucide-react, Node 20 `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-18-finance-revamp-design.md`. Read it before any task; `§N` below points into it. **Canonical mockup:** `.superpowers/brainstorm/1588-1792270565/content/finance-unified-v5.html` (open it in a browser; when the spec and mockup disagree on a visual detail the mockup wins, on behaviour the spec wins).

## Global Constraints

- **No commits** unless the user explicitly asks. Every task ends with a verification step instead of a commit. If asked to commit: run `git status` first and stage only files this plan touched (the repo holds long-lived staged and unstaged unrelated work).
- **No new dependencies.** Sonner is already installed.
- **Client imports:** client components import at runtime only pool-free modules: everything in `src/lib/finance/` except `safeToSpendServer.ts`, plus `src/lib/workboard/ui/{tokens,deferredDelete}.ts` and `src/components/workboard/ui/*`. Anything touching `@/lib/db` is `import type` only from client code.
- **Pure modules use relative imports only** inside `src/lib/finance/` (no `@/` alias), so the test runner can transpile them.
- **Never modify** `src/app/workboard/workboard.css` or anything under `src/components/workboard/` or `src/lib/workboard/`.
- **Colours:** come from `--wb-*` / `--fin-*` variables or `src/lib/finance/ui/colors.ts`. No hex literals elsewhere.
- **Type:** 12px minimum. The only exception: 11px uppercase labels at weight 800 with letter-spacing ≥ .03em.
- **Motion:**
  - Animate only `transform` and `opacity` (sole exception: `.wb-collapse`).
  - Easing `var(--wb-ease)` / `var(--wb-ease-in-out)`. Durations 120 / 180 / 240ms, 300ms max.
  - Keyboard-opened UI (Ctrl+K) does not animate.
  - Hover effects only under `@media (hover: hover) and (pointer: fine)`.
  - `prefers-reduced-motion: reduce` removes all movement.
- **Layout:**
  - Single-column page (no 2-column page layout). Grids of items are fine.
  - Breakpoints checked: 390px, 820px, 1440px. No horizontal page scroll; 16px side gutter on phones.
- **Money:** always rendered through `formatPeso*` from `src/lib/finance/format.ts`, with `.fin-num` (tabular numerals) and `white-space: nowrap`.
- **Dates:** server and client "today" always comes from `manilaToday()`. Never `new Date().toISOString().slice(0, 10)`. Date arithmetic on `YYYY-MM-DD` strings uses the UTC helpers in `src/lib/finance/dates.ts`.
- **Portals:** anything `position: fixed` renders through `WbOverlay` / `WbPopover`.
- **styled-jsx:** not used in new Finance code. All Finance CSS goes in `src/app/finance/finance.css` (global classes).
- **Verification every task:**
  - `npx tsc --noEmit` exits 0.
  - `node scripts/fin-test.mjs` exits 0 (from Task 1 on).
  - `node scripts/wb-style-gate.mjs <touched .ts/.tsx/.css files>` exits 0 (from Task 8 on).
- **Phase checkpoints** (marked ✅ CHECKPOINT) additionally need:
  - `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/finance` → `307` from a shell (unauthenticated).
  - Playwright screenshots at 390 / 820 / 1440px of the changed tabs, with the console free of errors. The Playwright browser is already logged in; never handle credentials.
  - User approval before the next phase starts.

## Rulings made while planning

- **R1 (feed data):** the Activity feed and Overview's Recent use a new `GET /api/finance/feed`, because the summary route's `recent` is range-scoped and capped at 15 (spec §9.2, updated).
- **R2 (periods):** the Activity period selector offers Week / Month / All only, matching the ranges the summary route supports for the totals line. "This year" is dropped rather than adding a fourth summary range.
- **R3 (date bugs):** Phase 0 also fixes the summary/budgets week and month ranges and the recurring-rules `addInterval`. They build local-midnight `Date`s and serialise them with `toISOString()`, which shifts them a day back on a UTC+8 machine (weekly rules currently land 6 days apart). They are rewritten on the UTC string helpers.
- **R4 (legacy bridge):** Task 9 moves today's components verbatim into `src/components/finance/legacy/`. New tabs mount them until their replacement lands. The legacy folder is deleted in Task 26.
- **R5 (refresh model):** after any write, the shell refetches what changed (`refreshAll`). There is no optimistic insert except deferred deletes, which hide the row immediately (spec §7.3).
- **R6 (Upcoming rows):** Upcoming uses `safe-to-spend`'s existing `upcoming` list (planned rows, which include materialised recurring rows). Its sub-line reads "Planned"; no new field is added.
- **R8 (plan editor):** the Plan tab's editor is rendered conditionally in place of the envelope grid, with the panel fade, instead of a permanently mounted `.wb-collapse` (spec §8.4); the editor's form state must reset on every open, which a mounted-but-collapsed form would not do.
- **R7 (tests):** Node 20 cannot run TypeScript directly. `scripts/fin-test.mjs` transpiles `src/lib/finance/**/*.ts` with the project's own `typescript` package into a temp dir and runs `node --test` on the `*.test.ts` files. Components are verified with `tsc`, the style gate and Playwright, as the Workboard revamp did.

## File map

**New files**

| Path | Responsibility |
|---|---|
| `scripts/fin-test.mjs` | Transpile + run finance unit tests |
| `src/lib/finance/format.ts` | `formatPeso`, `formatPesoWhole`, `formatPesoCompact`, `splitPeso` |
| `src/lib/finance/dates.ts` | `manilaToday`, `addDays`, `addMonthsClamped`, `daysBetween`, `mondayOf`, `startOfMonth`, `endOfMonth`, `formatDay`, `formatShortDate`, `formatFullDate`, `formatMonthYear`, `formatLongDate` |
| `src/lib/finance/categories.ts` | `EXPENSE_CATEGORIES`, `ALLOC_CATEGORIES`, `categoryLabel`, `categoryEmoji`, `isExpenseCategory` |
| `src/lib/finance/status.ts` | `safeToSpendStatus`, `shortfallSuggestion` |
| `src/lib/finance/verdict.ts` | `pointFor`, `previewSpend`, `verdictFor`, `verdictZones` |
| `src/lib/finance/goals.ts` | `goalState`, `goalGuidance`, `goalMarkerDate`, `timelineLayout` |
| `src/lib/finance/pace.ts` | `paceStartFor`, `paceSeries`, `axisLabels` |
| `src/lib/finance/logContext.ts` | `topCategories`, `repeatsFrom` |
| `src/lib/finance/feed.ts` | `groupByDay`, `compareText` |
| `src/lib/finance/envelopes.ts` | `buildEnvelopes`, `nextCycle`, `templateToRows` |
| `src/lib/finance/ui/colors.ts` | `expenseColor`, `savingsColor`, `TIER_META` |
| `src/lib/finance/__tests__/*.test.ts` | Unit tests for the modules above |
| `src/lib/finance/safeToSpendServer.ts` | `loadSpendBase`, `computeSafe` (server only, uses the pool) |
| `src/app/finance/finance.css` | `--fin-*` tokens and every `fin-*` class |
| `src/app/finance/loading.tsx` | Route-level skeleton |
| `src/app/api/finance/log-context/route.ts` | Top categories + repeat tiles |
| `src/app/api/finance/feed/route.ts` | Paged, filtered transaction feed |
| `src/app/api/finance/wishlist/route.ts` | Wishlist GET / POST |
| `src/app/api/finance/wishlist/[id]/route.ts` | Wishlist PATCH (buy / save / reopen) / DELETE |
| `financetracker/schema-phase5-wishlist.sql` | Record of the wishlist DDL |
| `src/components/finance/types.ts` | All Finance response/data types |
| `src/components/finance/financeApi.ts` | `requestJson`, `createTransaction`, `deleteTransaction` |
| `src/components/finance/useFinanceData.ts` | Loads and refreshes every dataset the shell needs |
| `src/components/finance/FinanceShell.tsx` | Page shell: header, hero, tabs, composer dock, drawer, toaster, Ctrl+K |
| `src/components/finance/FinanceTabs.tsx` | Attached tab bar (WAI-ARIA tabs) |
| `src/components/finance/hero/PaceHero.tsx`, `HeroNumber.tsx`, `PaceChart.tsx` | §5 |
| `src/components/finance/log/LogComposer.tsx`, `LogDrawer.tsx`, `DateChoice.tsx` | §7 |
| `src/components/finance/ui/ConfirmPopover.tsx`, `ui/Money.tsx`, `ui/PesoField.tsx` | Shared pieces |
| `src/components/finance/feed/DayFeed.tsx`, `feed/UpcomingList.tsx` | §9.2 |
| `src/components/finance/tabs/OverviewTab.tsx`, `PlanTab.tsx`, `ActivityTab.tsx`, `GoalsTab.tsx` | Tab bodies |
| `src/components/finance/plan/Envelope.tsx`, `AdjustPopover.tsx`, `PlanEditor.tsx`, `NewCycleBanner.tsx` | §8 |
| `src/components/finance/goals/GoalTimeline.tsx`, `GoalNotes.tsx`, `NewGoalForm.tsx` | §10.1 |
| `src/components/finance/whatif/Wishlist.tsx`, `WhatIfPreview.tsx` | §10.2, §10.3 |
| `src/components/finance/legacy/*.tsx` | Temporary verbatim copies of today's components (deleted in Task 26) |

**Modified files:** `src/app/finance/page.tsx`, `src/app/api/finance/{safe-to-spend,what-if,transactions,apply-allocation,recurring-rules,summary,budgets}/route.ts`, `src/lib/migrate.ts`, `scripts/wb-style-gate.mjs`, `financetracker-log.md` (Task 28).

**Deleted:** `src/components/finance/FinanceDashboard.tsx` (Task 9), `src/components/finance/legacy/` (Task 26).

---

## Phase 0 — Foundation (spec §4)

### Task 1: Test runner and money formatting

**Files:**
- Create: `scripts/fin-test.mjs`
- Create: `src/lib/finance/format.ts`
- Test: `src/lib/finance/__tests__/format.test.ts`

**Interfaces:**
- Produces: `formatPeso(n: number): string`, `formatPesoWhole(n: number): string`, `formatPesoCompact(n: number): string`, `splitPeso(n: number): { whole: string; cents: string }`; the command `node scripts/fin-test.mjs [filter]`.

- [ ] **Step 1: Write the test runner**

```js
#!/usr/bin/env node
// Finance unit tests without a test framework (plan ruling R7). Transpiles src/lib/finance/**/*.ts
// with the project's own TypeScript into a temp dir, then runs node:test on the *.test files.
// Usage: node scripts/fin-test.mjs [substring-filter]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const ROOT = 'src/lib/finance';
const out = mkdtempSync(join(tmpdir(), 'fin-test-'));
const walk = d => readdirSync(d).flatMap(n => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.ts') ? [p] : []);
});

const tests = [];
// *Server.ts files import the DB pool and are never unit-tested here.
for (const file of walk(ROOT).filter(f => !f.endsWith('Server.ts'))) {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  // Relative specifiers get the .mjs extension Node's ESM loader needs.
  const js = outputText.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, '$1$2.mjs$3');
  const dest = join(out, relative(ROOT, file)).replace(/\.ts$/, '.mjs');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, js);
  if (file.endsWith('.test.ts')) tests.push(dest);
}

const filter = process.argv[2];
const selected = filter ? tests.filter(t => t.includes(filter)) : tests;
if (selected.length === 0) { console.error('no finance tests matched'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...selected], { stdio: 'inherit' });
process.exit(r.status ?? 1);
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/finance/__tests__/format.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPeso, formatPesoWhole, formatPesoCompact, splitPeso } from '../format';

test('formatPeso groups thousands and keeps two decimals', () => {
  assert.equal(formatPeso(5270.38), '₱5,270.38');
  assert.equal(formatPeso(0), '₱0.00');
  assert.equal(formatPeso(1234567.891), '₱1,234,567.89');
});

test('formatPeso puts a true minus sign before the peso sign', () => {
  assert.equal(formatPeso(-120), '−₱120.00');
});

test('formatPesoWhole rounds to whole pesos', () => {
  assert.equal(formatPesoWhole(376.46), '₱376');
  assert.equal(formatPesoWhole(9500), '₱9,500');
});

test('formatPesoCompact shortens thousands and millions', () => {
  assert.equal(formatPesoCompact(999), '₱999');
  assert.equal(formatPesoCompact(1000), '₱1k');
  assert.equal(formatPesoCompact(1200), '₱1.2k');
  assert.equal(formatPesoCompact(38000), '₱38k');
  assert.equal(formatPesoCompact(1240000), '₱1.2M');
});

test('splitPeso separates the cents for the hero', () => {
  assert.deepEqual(splitPeso(5270.38), { whole: '₱5,270', cents: '.38' });
  assert.deepEqual(splitPeso(-3), { whole: '−₱3', cents: '.00' });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node scripts/fin-test.mjs format`
Expected: FAIL. Transpiling the test works, but the import of `../format.mjs` fails with `ERR_MODULE_NOT_FOUND` because `format.ts` does not exist yet.

- [ ] **Step 4: Implement `format.ts`**

```ts
// src/lib/finance/format.ts
/* Every peso amount in Finance goes through these, so separators, the minus sign and
   rounding agree everywhere (spec §4.3). Pool-free and dependency-free. */
const TWO = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const WHOLE = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
const MINUS = '−';

export function formatPeso(n: number): string {
  return `${n < 0 ? MINUS : ''}₱${TWO.format(Math.abs(n))}`;
}

export function formatPesoWhole(n: number): string {
  return `${n < 0 ? MINUS : ''}₱${WHOLE.format(Math.round(Math.abs(n)))}`;
}

export function formatPesoCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? MINUS : '';
  const short = (v: number) => v.toFixed(1).replace(/\.0$/, '');
  if (abs < 1000) return `${sign}₱${Math.round(abs)}`;
  if (abs < 1_000_000) return `${sign}₱${short(abs / 1000)}k`;
  return `${sign}₱${short(abs / 1_000_000)}M`;
}

export function splitPeso(n: number): { whole: string; cents: string } {
  const s = formatPeso(n);
  const i = s.lastIndexOf('.');
  return { whole: s.slice(0, i), cents: s.slice(i) };
}
```

- [ ] **Step 5: Run the tests**

Run: `node scripts/fin-test.mjs format`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: exit 0.

---

### Task 2: Dates, categories, colours

**Files:**
- Create: `src/lib/finance/dates.ts`, `src/lib/finance/categories.ts`, `src/lib/finance/ui/colors.ts`
- Test: `src/lib/finance/__tests__/dates.test.ts`

**Interfaces:**
- Produces:
  - `manilaToday(now?: Date): string`, `addDays(iso, n)`, `addMonthsClamped(iso, n)`, `daysBetween(a, b): number` (b − a in days), `mondayOf(iso)`, `startOfMonth(iso)`, `endOfMonth(iso)`.
  - `formatDay(iso, today)` ("Today" / "Yesterday" / "Thu, Oct 15"), `formatShortDate(iso)` ("Oct 15"), `formatFullDate(iso)` ("Aug 25, 2026"), `formatMonthYear(iso)` ("Jun 2027"), `formatLongDate(iso)` ("Saturday, Oct 17").
  - `EXPENSE_CATEGORIES: readonly (readonly [string, string, string])[]` as `[key, label, emoji]`, `ALLOC_CATEGORIES` (same plus savings), `categoryLabel(key)`, `categoryEmoji(key)`, `isExpenseCategory(key)`.
  - `expenseColor(label)`, `savingsColor(label)`, `TIER_META: Record<Tier, { label: string; hint: string; fill: string; ink: string; bg: string }>`, `type Tier = 'required' | 'target' | 'flexible'`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/finance/__tests__/dates.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  manilaToday, addDays, addMonthsClamped, daysBetween, mondayOf, startOfMonth, endOfMonth,
  formatDay, formatShortDate, formatFullDate, formatMonthYear, formatLongDate,
} from '../dates';

test('manilaToday is the calendar date in Asia/Manila, not UTC', () => {
  assert.equal(manilaToday(new Date('2026-10-17T20:30:00Z')), '2026-10-18');
  assert.equal(manilaToday(new Date('2026-10-17T15:59:00Z')), '2026-10-17');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-10-19', 7), '2026-10-26');
});

test('addMonthsClamped keeps the day but clamps short months', () => {
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsClamped('2026-03-15', 1), '2026-04-15');
  assert.equal(addMonthsClamped('2026-12-10', 1), '2027-01-10');
});

test('daysBetween counts whole days b - a', () => {
  assert.equal(daysBetween('2026-10-17', '2026-10-31'), 14);
  assert.equal(daysBetween('2026-10-17', '2026-10-17'), 0);
  assert.equal(daysBetween('2026-10-17', '2026-10-15'), -2);
});

test('week and month boundaries', () => {
  assert.equal(mondayOf('2026-10-17'), '2026-10-12'); // Saturday
  assert.equal(mondayOf('2026-10-18'), '2026-10-12'); // Sunday belongs to the week before
  assert.equal(mondayOf('2026-10-12'), '2026-10-12');
  assert.equal(startOfMonth('2026-02-10'), '2026-02-01');
  assert.equal(endOfMonth('2026-02-10'), '2026-02-28');
  assert.equal(endOfMonth('2028-02-10'), '2028-02-29');
});

test('display formats', () => {
  assert.equal(formatDay('2026-10-17', '2026-10-17'), 'Today');
  assert.equal(formatDay('2026-10-16', '2026-10-17'), 'Yesterday');
  assert.equal(formatDay('2026-10-15', '2026-10-17'), 'Thu, Oct 15');
  assert.equal(formatShortDate('2026-10-15'), 'Oct 15');
  assert.equal(formatFullDate('2026-08-25'), 'Aug 25, 2026');
  assert.equal(formatMonthYear('2027-06-10'), 'Jun 2027');
  assert.equal(formatLongDate('2026-10-17'), 'Saturday, Oct 17');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/fin-test.mjs dates`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `dates.mjs`.

- [ ] **Step 3: Implement `dates.ts`**

```ts
// src/lib/finance/dates.ts
/* Calendar dates as 'YYYY-MM-DD' strings. All arithmetic runs in UTC on the string's own
   date, so the server's timezone can never shift a day (plan ruling R3). "Today" is the
   Asia/Manila calendar date (spec §4.4). */
const DAY_MS = 86_400_000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function addDays(date: string, n: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function addMonthsClamped(date: string, n: number): string {
  const d = utc(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return iso(target);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / DAY_MS);
}

export function mondayOf(date: string): string {
  const dow = utc(date).getUTCDay(); // 0=Sun..6=Sat
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: string): string {
  const d = utc(date);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  utc(date).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

export function formatDay(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return fmt(date, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatShortDate(date: string): string {
  return fmt(date, { month: 'short', day: 'numeric' });
}

export function formatFullDate(date: string): string {
  return fmt(date, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatMonthYear(date: string): string {
  return fmt(date, { month: 'short', year: 'numeric' });
}

export function formatLongDate(date: string): string {
  return fmt(date, { weekday: 'long', month: 'short', day: 'numeric' });
}
```

- [ ] **Step 4: Implement `categories.ts`**

```ts
// src/lib/finance/categories.ts
/* Expense categories as stored in expenses.category, with display label and emoji. */
export const EXPENSE_CATEGORIES = [
  ['food', 'Food', '🍜'], ['transportation', 'Transportation', '🚌'], ['academic', 'Academic', '📚'],
  ['grocery', 'Grocery', '🛒'], ['leisure', 'Leisure', '🎮'], ['family', 'Family', '👪'],
  ['healthcare', 'Healthcare', '💊'], ['utilities', 'Utilities', '💡'], ['emergency', 'Emergency', '🚨'],
  ['donation', 'Donation', '🎁'], ['miscellaneous', 'Miscellaneous', '📦'],
] as const;

export const ALLOC_CATEGORIES = [...EXPENSE_CATEGORIES, ['savings', 'Savings', '◎']] as const;

export function categoryLabel(key: string): string {
  return ALLOC_CATEGORIES.find(c => c[0] === key)?.[1] ?? key;
}

export function categoryEmoji(key: string): string {
  return ALLOC_CATEGORIES.find(c => c[0] === key)?.[2] ?? '•';
}

export function isExpenseCategory(key: string): boolean {
  return EXPENSE_CATEGORIES.some(c => c[0] === key);
}
```

- [ ] **Step 5: Implement `ui/colors.ts`**

```ts
// src/lib/finance/ui/colors.ts
/* The only Finance TS file allowed to hold hex values (style gate allow-list). Values mirror
   the --fin-* variables in src/app/finance/finance.css. Category hues stay stable per label
   and stay inside the expense (pink) or savings (purple) family. */
export type Tier = 'required' | 'target' | 'flexible';

const EXPENSE_HUES = ['#e0679d', '#c65f83', '#f2a7c0', '#d4547a', '#ec8bb5'];
const SAVINGS_HUES = ['#9b6dd6', '#7c5cc9', '#b490e0', '#8659c9', '#c9a4e8'];

function hueFor(label: string, palette: string[]): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

export const expenseColor = (label: string) => hueFor(label, EXPENSE_HUES);
export const savingsColor = (label: string) => hueFor(label, SAVINGS_HUES);

export const TIER_META: Record<Tier, { label: string; hint: string; fill: string; ink: string; bg: string }> = {
  required: { label: 'Essential', hint: "can't be trimmed", fill: 'var(--fin-tier-essential)', ink: 'var(--fin-tier-essential-ink)', bg: 'var(--fin-tier-essential-bg)' },
  target: { label: 'Committed', hint: 'savings & recurring', fill: 'var(--fin-tier-committed)', ink: 'var(--fin-tier-committed-ink)', bg: 'var(--fin-tier-committed-bg)' },
  flexible: { label: 'Flexible', hint: 'first to trim', fill: 'var(--fin-tier-flexible)', ink: 'var(--fin-tier-flexible-ink)', bg: 'var(--fin-tier-flexible-bg)' },
};
```

- [ ] **Step 6: Run tests and types**

Run: `node scripts/fin-test.mjs` then `npx tsc --noEmit`
Expected: all finance tests PASS (format + dates); tsc exit 0.

---

### Task 3: Spending verdicts

**Files:**
- Create: `src/lib/finance/verdict.ts`
- Test: `src/lib/finance/__tests__/verdict.test.ts`

**Interfaces:**
- Produces:
  - `interface SpendSnapshot { current_balance: number; upcoming_required: number; upcoming_savings: number; days_until_next_allowance: number | null }` (a structural subset of the safe-to-spend response).
  - `interface SpendPoint { balance: number; safe: number; perDay: number }`
  - `type Verdict = 'comfortable' | 'tight' | 'not_recommended'`
  - `pointFor(s, balance): SpendPoint`
  - `previewSpend(s, amount): { before: SpendPoint; after: SpendPoint; verdict: Verdict; billsCovered: boolean }`
  - `verdictFor(before, after): Verdict`
  - `verdictZones(s): { tightFrom: number; notFrom: number }` (amounts where the verdict changes, clamped to 0..current_balance)
  - `VERDICT_LABEL: Record<Verdict, string>`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/finance/__tests__/verdict.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointFor, previewSpend, verdictFor, verdictZones, type SpendSnapshot } from '../verdict';

// Mockup numbers: safe-to-spend 5,270.38 and 376.46/day over 14 days.
const S: SpendSnapshot = { current_balance: 7033.76, upcoming_required: 560, upcoming_savings: 500, days_until_next_allowance: 14 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1, `${a} ≈ ${b}`);

test('pointFor mirrors the safe-to-spend maths (10% buffer)', () => {
  const p = pointFor(S, S.current_balance);
  assert.equal(p.safe, 5270.38);
  assert.equal(p.perDay, 376.46);
});

test('pointFor falls back to 14 days and never goes below zero', () => {
  const p = pointFor({ ...S, days_until_next_allowance: null }, 500);
  assert.equal(p.safe, 0);
  assert.equal(p.perDay, 0);
});

test('previewSpend verdicts', () => {
  assert.equal(previewSpend(S, 2500).verdict, 'comfortable');
  assert.equal(previewSpend(S, 2500).after.perDay, 215.74);
  assert.equal(previewSpend(S, 3200).verdict, 'tight');
  assert.equal(previewSpend(S, 6000).verdict, 'not_recommended');
  assert.equal(previewSpend(S, 38000).verdict, 'not_recommended');
});

test('billsCovered compares the remaining balance with upcoming commitments', () => {
  assert.equal(previewSpend(S, 2500).billsCovered, true);
  assert.equal(previewSpend(S, 6000).billsCovered, false);
});

test('verdictFor never calls a spend tight when there was no per-day budget to halve', () => {
  assert.equal(verdictFor({ balance: 100, safe: 0, perDay: 0 }, { balance: 50, safe: 1, perDay: 0 }), 'comfortable');
});

test('verdictZones gives the amounts where the verdict changes', () => {
  const z = verdictZones(S);
  near(z.tightFrom, 2927.99);
  near(z.notFrom, 5855.98);
  assert.equal(previewSpend(S, z.tightFrom - 2).verdict, 'comfortable');
  assert.equal(previewSpend(S, z.tightFrom + 2).verdict, 'tight');
  assert.equal(previewSpend(S, z.notFrom + 2).verdict, 'not_recommended');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/fin-test.mjs verdict`
Expected: FAIL, `verdict.mjs` not found.

- [ ] **Step 3: Implement `verdict.ts`**

```ts
// src/lib/finance/verdict.ts
/* Client-side mirror of the what-if route's maths (spec §4.3), so the What-if slider and the
   wishlist can recompute instantly. Same buffer (10% of a positive balance), same 14-day
   fallback, same three warning conditions as /api/finance/what-if. */
export interface SpendSnapshot {
  current_balance: number;
  upcoming_required: number;
  upcoming_savings: number;
  days_until_next_allowance: number | null;
}
export interface SpendPoint { balance: number; safe: number; perDay: number }
export type Verdict = 'comfortable' | 'tight' | 'not_recommended';

export const VERDICT_LABEL: Record<Verdict, string> = {
  comfortable: 'Comfortable', tight: 'Tight', not_recommended: 'Not this cycle',
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const daysOf = (s: SpendSnapshot) => s.days_until_next_allowance ?? 14;

export function pointFor(s: SpendSnapshot, balance: number): SpendPoint {
  const buffer = balance > 0 ? r2(balance * 0.10) : 0;
  const safe = Math.max(0, r2(balance - s.upcoming_required - s.upcoming_savings - buffer));
  const days = daysOf(s);
  return { balance: r2(balance), safe, perDay: days > 0 ? r2(safe / days) : safe };
}

export function verdictFor(before: SpendPoint, after: SpendPoint): Verdict {
  if (after.balance < 0 || after.safe <= 0) return 'not_recommended';
  if (before.perDay > 0 && after.perDay < before.perDay * 0.5) return 'tight';
  return 'comfortable';
}

export function previewSpend(s: SpendSnapshot, amount: number) {
  const before = pointFor(s, s.current_balance);
  const after = pointFor(s, s.current_balance - amount);
  return {
    before,
    after,
    verdict: verdictFor(before, after),
    billsCovered: after.balance >= s.upcoming_required + s.upcoming_savings,
  };
}

/* Closed form of the two thresholds. For a positive remaining balance B−a:
   safe(a) = 0.9·(B−a) − R, where R = upcoming commitments. "Tight" starts where
   safe(a) = 0.5·safe(0); "not recommended" where safe(a) = 0. */
export function verdictZones(s: SpendSnapshot): { tightFrom: number; notFrom: number } {
  const B = s.current_balance;
  const R = s.upcoming_required + s.upcoming_savings;
  const beforeSafe = pointFor(s, B).safe;
  const clamp = (v: number) => Math.min(Math.max(0, r2(v)), Math.max(0, B));
  const notFrom = clamp(B - R / 0.9);
  const tightFrom = beforeSafe > 0 ? clamp(B - (0.5 * beforeSafe + R) / 0.9) : notFrom;
  return { tightFrom: Math.min(tightFrom, notFrom), notFrom };
}
```

- [ ] **Step 4: Run tests**

Run: `node scripts/fin-test.mjs verdict`
Expected: PASS, 6 tests. If `after.perDay` for 2500 is off by a cent, check that `buffer` is rounded before subtracting (the route rounds it the same way).

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit` → exit 0.

---

### Task 4: Goal state and timeline layout

**Files:**
- Create: `src/lib/finance/goals.ts`
- Test: `src/lib/finance/__tests__/goals.test.ts`

**Interfaces:**
- Consumes: `formatPesoWhole`, `formatPeso` (Task 1); `formatShortDate`, `formatFullDate`, `formatMonthYear`, `addMonthsClamped`, `startOfMonth`, `daysBetween` (Task 2).
- Produces:
  - `interface GoalInput { goal_id: number; goal_name: string; target_amount: number; saved: number; target_date: string | null; avg_per_week: number; required_per_week: number | null; projected_date: string | null; pace_status: 'ahead' | 'on_pace' | 'behind' | null }` (a structural subset of the summary route's goal projection).
  - `type GoalState = 'done' | 'date_passed' | 'behind' | 'on_pace' | 'no_date'`
  - `goalState(g, today): GoalState`
  - `goalGuidance(g, today): { text: string; action: 'pick_date' | 'set_date' | null; tone: 'warn' | 'info' | 'success' }`
  - `goalMarkerDate(g): string | null`
  - `timelineLayout(goals, today): { ticks: { date: string; label: string; pos: number }[]; todayPos: number; markers: { goal_id: number; pos: number; row: 0 | 1 | 2; projected: boolean }[]; useList: boolean }` (pos in percent 0–100)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/finance/__tests__/goals.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalState, goalGuidance, goalMarkerDate, timelineLayout, type GoalInput } from '../goals';

const TODAY = '2026-10-17';
const base: GoalInput = {
  goal_id: 1, goal_name: 'G', target_amount: 10000, saved: 500, target_date: null,
  avg_per_week: 61.4, required_per_week: null, projected_date: null, pace_status: null,
};

test('a passed target date wins over pace maths', () => {
  const g = { ...base, target_date: '2026-08-25', required_per_week: 9500, pace_status: 'behind' as const };
  assert.equal(goalState(g, TODAY), 'date_passed');
  const guide = goalGuidance(g, TODAY);
  assert.equal(guide.text, 'The target date (Aug 25, 2026) has passed. ₱9,500 to go.');
  assert.equal(guide.action, 'pick_date');
  assert.equal(guide.tone, 'warn');
});

test('no date uses the projection', () => {
  const g = { ...base, target_amount: 3000, saved: 650, avg_per_week: 66, projected_date: '2027-06-10' };
  assert.equal(goalState(g, TODAY), 'no_date');
  assert.equal(goalGuidance(g, TODAY).text, "At ₱66/wk you'll reach it around Jun 2027.");
  assert.equal(goalGuidance(g, TODAY).action, 'set_date');
});

test('no date and no savings yet', () => {
  assert.equal(goalGuidance({ ...base, saved: 0, avg_per_week: 0 }, TODAY).text, 'Add savings to see when you\'ll reach it.');
});

test('behind and on pace', () => {
  const behind = { ...base, target_date: '2026-12-20', required_per_week: 150, pace_status: 'behind' as const };
  assert.equal(goalState(behind, TODAY), 'behind');
  assert.equal(goalGuidance(behind, TODAY).text, "Save ₱150/wk to hit Dec 20. You're averaging ₱61/wk.");
  const onPace = { ...base, target_date: '2027-12-20', pace_status: 'ahead' as const };
  assert.equal(goalState(onPace, TODAY), 'on_pace');
  assert.equal(goalGuidance(onPace, TODAY).text, 'On pace for Dec 20 at ₱61/wk.');
});

test('done beats everything', () => {
  assert.equal(goalState({ ...base, saved: 10000, target_date: '2026-01-01' }, TODAY), 'done');
});

test('marker date prefers the target, then the projection', () => {
  assert.equal(goalMarkerDate({ ...base, target_date: '2026-08-25', projected_date: '2029-01-01' }), '2026-08-25');
  assert.equal(goalMarkerDate({ ...base, projected_date: '2027-06-10' }), '2027-06-10');
  assert.equal(goalMarkerDate(base), null);
});

test('timelineLayout spans every marker plus a month either side', () => {
  const goals = [
    { ...base, goal_id: 1, target_date: '2026-08-25' },
    { ...base, goal_id: 2, projected_date: '2027-06-10' },
  ];
  const t = timelineLayout(goals, TODAY);
  assert.equal(t.ticks[0].date, '2026-07-01');
  assert.ok(t.todayPos > 0 && t.todayPos < 100);
  assert.equal(t.markers.length, 2);
  assert.ok(t.markers[0].pos < t.todayPos && t.markers[1].pos > t.todayPos);
  assert.equal(t.markers[1].projected, true);
  assert.equal(t.useList, false);
});

test('close markers stack into rows; more than 6 goals switch to a list', () => {
  const close = [1, 2, 3].map(i => ({ ...base, goal_id: i, target_date: `2027-01-0${i}` }));
  const rows = timelineLayout(close, TODAY).markers.map(m => m.row);
  assert.deepEqual(rows, [0, 1, 2]);
  const many = Array.from({ length: 7 }, (_, i) => ({ ...base, goal_id: i, target_date: '2027-01-01' }));
  assert.equal(timelineLayout(many, TODAY).useList, true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/fin-test.mjs goals`
Expected: FAIL, `goals.mjs` not found.

- [ ] **Step 3: Implement `goals.ts`**

```ts
// src/lib/finance/goals.ts
/* Goal state, guidance copy and timeline geometry (spec §10.1). The old "162W BEHIND" badge
   came from pace maths running against a target date that had already passed; date_passed
   is checked first so that can't happen again. */
import { formatPesoWhole, formatPeso } from './format';
import { formatShortDate, formatFullDate, formatMonthYear, addMonthsClamped, startOfMonth, daysBetween } from './dates';

export interface GoalInput {
  goal_id: number;
  goal_name: string;
  target_amount: number;
  saved: number;
  target_date: string | null;
  avg_per_week: number;
  required_per_week: number | null;
  projected_date: string | null;
  pace_status: 'ahead' | 'on_pace' | 'behind' | null;
}
export type GoalState = 'done' | 'date_passed' | 'behind' | 'on_pace' | 'no_date';

export function goalState(g: GoalInput, today: string): GoalState {
  if (g.target_amount > 0 && g.saved >= g.target_amount) return 'done';
  if (g.target_date && g.target_date < today) return 'date_passed';
  if (!g.target_date) return 'no_date';
  if (g.pace_status === 'behind') return 'behind';
  return 'on_pace';
}

export function goalGuidance(g: GoalInput, today: string): { text: string; action: 'pick_date' | 'set_date' | null; tone: 'warn' | 'info' | 'success' } {
  const remaining = Math.max(0, g.target_amount - g.saved);
  switch (goalState(g, today)) {
    case 'done':
      return { text: `Goal reached: ${formatPeso(g.saved)} saved.`, action: null, tone: 'success' };
    case 'date_passed':
      return { text: `The target date (${formatFullDate(g.target_date!)}) has passed. ${formatPesoWhole(remaining)} to go.`, action: 'pick_date', tone: 'warn' };
    case 'behind':
      return { text: `Save ${formatPesoWhole(g.required_per_week ?? 0)}/wk to hit ${formatShortDate(g.target_date!)}. You're averaging ${formatPesoWhole(g.avg_per_week)}/wk.`, action: null, tone: 'warn' };
    case 'on_pace':
      return { text: `On pace for ${formatShortDate(g.target_date!)} at ${formatPesoWhole(g.avg_per_week)}/wk.`, action: null, tone: 'success' };
    case 'no_date':
      return g.projected_date && g.avg_per_week > 0
        ? { text: `At ${formatPesoWhole(g.avg_per_week)}/wk you'll reach it around ${formatMonthYear(g.projected_date)}.`, action: 'set_date', tone: 'info' }
        : { text: "Add savings to see when you'll reach it.", action: 'set_date', tone: 'info' };
  }
}

export function goalMarkerDate(g: GoalInput): string | null {
  return g.target_date ?? g.projected_date ?? null;
}

const MAX_TIMELINE_GOALS = 6;
const MIN_GAP_PCT = 18; // closer than this and the marker cards would overlap

export function timelineLayout(goals: GoalInput[], today: string) {
  const dated = goals.map(g => ({ g, date: goalMarkerDate(g) })).filter((x): x is { g: GoalInput; date: string } => x.date !== null);
  const dates = [today, ...dated.map(x => x.date)].sort();
  const start = addMonthsClamped(startOfMonth(dates[0]), -1);
  const end = addMonthsClamped(startOfMonth(dates[dates.length - 1]), 2); // one full month after the last marker
  const span = Math.max(1, daysBetween(start, end));
  const posOf = (d: string) => Math.min(100, Math.max(0, (daysBetween(start, d) / span) * 100));

  const ticks: { date: string; label: string; pos: number }[] = [];
  const monthCount = Math.round(daysBetween(start, end) / 30.4);
  const step = Math.max(1, Math.ceil(monthCount / 5)); // about five labels
  for (let m = start; m <= end; m = addMonthsClamped(m, step)) {
    ticks.push({ date: m, label: formatMonthYear(m).replace(/ (\d{2})(\d{2})$/, " '$2"), pos: posOf(m) });
  }

  const sorted = dated.map(x => ({ goal_id: x.g.goal_id, pos: posOf(x.date), projected: !x.g.target_date })).sort((a, b) => a.pos - b.pos);
  const lastPosInRow: number[] = [-Infinity, -Infinity, -Infinity];
  const markers = sorted.map(m => {
    let row = lastPosInRow.findIndex(p => m.pos - p >= MIN_GAP_PCT);
    if (row === -1) row = lastPosInRow.indexOf(Math.min(...lastPosInRow)); // all full: reuse the oldest row
    lastPosInRow[row] = m.pos;
    return { ...m, row: row as 0 | 1 | 2 };
  });

  return { ticks, todayPos: posOf(today), markers, useList: goals.length > MAX_TIMELINE_GOALS };
}
```

- [ ] **Step 4: Run tests**

Run: `node scripts/fin-test.mjs goals`
Expected: PASS, 8 tests. Tick labels look like `Jul '26` (the regex turns "Jul 2026" into "Jul '26").

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit` → exit 0.

---

### Task 5: Pace series

**Files:**
- Create: `src/lib/finance/pace.ts`
- Test: `src/lib/finance/__tests__/pace.test.ts`

**Interfaces:**
- Consumes: `addDays`, `daysBetween`, `formatShortDate` (Task 2).
- Produces:
  - `paceStartFor(lastActualAllowance: string | null, today: string): string`
  - `interface DailySpend { date: string; amount: number }`
  - `interface PaceBar { date: string; amount: number; future: boolean; isToday: boolean; over: boolean }`
  - `interface PaceSeries { bars: PaceBar[]; perDay: number; avg: number; diff: number; dayNumber: number; max: number }`
  - `paceSeries(input: { pace_start: string; horizon_end: string; daily_spend: DailySpend[]; per_day: number }, today: string): PaceSeries`
  - `axisLabels(bars: PaceBar[]): (string | null)[]`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/finance/__tests__/pace.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paceStartFor, paceSeries, axisLabels } from '../pace';

const TODAY = '2026-10-17';

test('pace starts at the last allowance, or a week back when there is none or it is stale', () => {
  assert.equal(paceStartFor('2026-10-15', TODAY), '2026-10-15');
  assert.equal(paceStartFor(null, TODAY), '2026-10-11');
  assert.equal(paceStartFor('2026-09-01', TODAY), '2026-10-11'); // 46 days ago > 31
});

const input = {
  pace_start: '2026-10-15', horizon_end: '2026-10-31', per_day: 376.46,
  daily_spend: [{ date: '2026-10-15', amount: 150 }, { date: '2026-10-16', amount: 420 }, { date: '2026-10-17', amount: 120 }],
};

test('one bar per day from pace_start to horizon_end, future days flagged', () => {
  const s = paceSeries(input, TODAY);
  assert.equal(s.bars.length, 17);
  assert.equal(s.bars[2].isToday, true);
  assert.equal(s.bars[3].future, true);
  assert.equal(s.bars[1].over, true); // 420 > 376.46
  assert.equal(s.dayNumber, 3);
});

test('average and difference cover past days including today', () => {
  const s = paceSeries(input, TODAY);
  assert.equal(s.avg, 230);
  assert.equal(s.diff, 146.46);
  assert.ok(s.max >= 420);
});

test('windows longer than 31 days keep the 31 ending at horizon_end', () => {
  const s = paceSeries({ ...input, pace_start: '2026-09-01' }, TODAY);
  assert.equal(s.bars.length, 31);
  assert.equal(s.bars[30].date, '2026-10-31');
});

test('axis labels: start, Today, end, and one middle date far from both', () => {
  const labels = axisLabels(paceSeries(input, TODAY).bars);
  assert.equal(labels[0], 'Oct 15');
  assert.equal(labels[2], 'Today');
  assert.equal(labels[16], 'Oct 31');
  assert.equal(labels.filter(Boolean).length, 4);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/fin-test.mjs pace`
Expected: FAIL, `pace.mjs` not found.

- [ ] **Step 3: Implement `pace.ts`**

```ts
// src/lib/finance/pace.ts
/* The Pace hero's data (spec §5.3): one bar per day of the current cycle, against the
   current per-day budget. Used by the hero and by the What-if preview. */
import { addDays, daysBetween, formatShortDate } from './dates';

export interface DailySpend { date: string; amount: number }
export interface PaceBar { date: string; amount: number; future: boolean; isToday: boolean; over: boolean }
export interface PaceSeries { bars: PaceBar[]; perDay: number; avg: number; diff: number; dayNumber: number; max: number }

const MAX_DAYS = 31;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function paceStartFor(lastActualAllowance: string | null, today: string): string {
  if (!lastActualAllowance || daysBetween(lastActualAllowance, today) > MAX_DAYS) return addDays(today, -6);
  return lastActualAllowance;
}

export function paceSeries(
  input: { pace_start: string; horizon_end: string; daily_spend: DailySpend[]; per_day: number },
  today: string,
): PaceSeries {
  const end = input.horizon_end < today ? today : input.horizon_end;
  let start = input.pace_start > today ? today : input.pace_start;
  if (daysBetween(start, end) + 1 > MAX_DAYS) start = addDays(end, -(MAX_DAYS - 1));
  const byDate = new Map(input.daily_spend.map(d => [d.date, d.amount]));

  const bars: PaceBar[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const amount = byDate.get(d) ?? 0;
    const future = d > today;
    bars.push({ date: d, amount, future, isToday: d === today, over: !future && amount > input.per_day });
  }
  const past = bars.filter(b => !b.future);
  const avg = past.length ? r2(past.reduce((s, b) => s + b.amount, 0) / past.length) : 0;
  return {
    bars,
    perDay: input.per_day,
    avg,
    diff: r2(input.per_day - avg),
    dayNumber: daysBetween(input.pace_start, today) + 1,
    max: Math.max(input.per_day * 1.6, ...bars.map(b => b.amount), 1),
  };
}

export function axisLabels(bars: PaceBar[]): (string | null)[] {
  const last = bars.length - 1;
  const todayIdx = bars.findIndex(b => b.isToday);
  const mid = Math.round(last / 2);
  return bars.map((b, i) => {
    if (b.isToday) return 'Today';
    if (i === 0 || i === last) return formatShortDate(b.date);
    if (i === mid && Math.abs(i - todayIdx) >= 3 && mid >= 3 && last - mid >= 3) return formatShortDate(b.date);
    return null;
  });
}
```

- [ ] **Step 4: Run tests**

Run: `node scripts/fin-test.mjs pace`
Expected: PASS, 5 tests. (In the axis test, today is index 2, so index 0 shows "Oct 15", 2 "Today", 8 "Oct 23", 16 "Oct 31".)

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit` → exit 0.

---

### Task 6: Log context, feed grouping, envelopes

**Files:**
- Create: `src/lib/finance/logContext.ts`, `src/lib/finance/feed.ts`, `src/lib/finance/envelopes.ts`
- Test: `src/lib/finance/__tests__/logContext.test.ts`, `feed.test.ts`, `envelopes.test.ts`

**Interfaces:**
- Consumes: `formatDay`, `daysBetween`, `addDays` (Task 2); `Tier` (Task 2).
- Produces:
  - **logContext.ts:**
    - `interface LoggedRow { type: 'expense' | 'savings'; category: string | null; goal_id: number | null; goal_name: string | null; amount: number; entry_date: string }`
    - `interface LogRepeat { type: 'expense' | 'savings'; category: string | null; goal_id: number | null; goal_name: string | null; amount: number }`
    - `topCategories(rows, limit = 4): string[]`
    - `repeatsFrom(rows, limit = 4): LogRepeat[]`
  - **feed.ts:**
    - `interface FeedItem { id: number; type: 'allowance' | 'expense' | 'savings'; entry_date: string; amount: number; label: string; goal_id: number | null; recurring: boolean }`
    - `interface DayGroup { date: string; title: string; subtitle: string; inflow: number; spent: number; saved: number; items: FeedItem[] }`
    - `groupByDay(items, today): DayGroup[]`
    - `compareText(current: number, previous: number | null, range: 'week' | 'month' | 'all'): { text: string; tone: 'up' | 'down' | 'muted' }`
  - **envelopes.ts:**
    - `interface BudgetRow` (the budgets route's item: `budget_id, category, cap_amount, plan_amount, is_override, override_reason, tier, spent, period_start, period_end`)
    - `interface SavingsRow` (`budget_id, cap_amount, plan_amount, is_override, override_reason, funded, tier, period_start, period_end`)
    - `interface EnvelopeModel { category: string; isSavings: boolean; tier: Tier; cap: number; spent: number; left: number; pct: number; over: boolean; fasterThanPlan: boolean; isOverride: boolean; planAmount: number | null; reason: string | null; budgetId: number | null }`
    - `buildEnvelopes(budgets, savings, today): { envelopes: EnvelopeModel[]; elapsedPct: number | null; period: { start: string; end: string } | null }`
    - `nextCycle(t: { last_allowance_amount: number | null; last_period_start: string | null; last_period_end: string | null }, today): { start: string; end: string; days: number; amount: number } | null`
    - `templateToRows(items)`: rows for the allocation-templates save action, `{ category, priority_tier, allocation_type, value }[]`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/finance/__tests__/logContext.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topCategories, repeatsFrom, type LoggedRow } from '../logContext';

const e = (category: string, amount: number, entry_date: string): LoggedRow => ({ type: 'expense', category, goal_id: null, goal_name: null, amount, entry_date });
const rows: LoggedRow[] = [
  e('food', 120, '2026-10-17'), e('food', 120, '2026-10-14'), e('food', 95, '2026-10-09'),
  e('transportation', 150, '2026-10-16'), e('transportation', 150, '2026-10-09'),
  e('leisure', 380, '2026-10-12'),
  { type: 'savings', category: null, goal_id: 7, goal_name: 'Concert', amount: 150, entry_date: '2026-10-16' },
  { type: 'savings', category: null, goal_id: 7, goal_name: 'Concert', amount: 150, entry_date: '2026-10-02' },
];

test('topCategories ranks by count, then recency, then pads with defaults', () => {
  assert.deepEqual(topCategories(rows), ['food', 'transportation', 'leisure', 'academic']);
  assert.deepEqual(topCategories([]), ['food', 'transportation', 'academic', 'grocery']);
});

test('repeatsFrom keeps exact combinations logged at least twice, most recent first', () => {
  const r = repeatsFrom(rows);
  assert.deepEqual(r.map(x => `${x.type}:${x.category ?? x.goal_name}:${x.amount}`), [
    'expense:food:120', 'expense:transportation:150', 'savings:Concert:150',
  ]);
});
```

```ts
// src/lib/finance/__tests__/feed.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDay, compareText, type FeedItem } from '../feed';

const it = (id: number, type: FeedItem['type'], entry_date: string, amount: number, label: string): FeedItem =>
  ({ id, type, entry_date, amount, label, goal_id: null, recurring: false });

test('groupByDay orders days newest first with per-day totals', () => {
  const groups = groupByDay([
    it(1, 'expense', '2026-10-17', 120, 'food'),
    it(2, 'expense', '2026-10-16', 150, 'transportation'),
    it(3, 'savings', '2026-10-16', 150, 'Concert'),
    it(4, 'allowance', '2026-10-15', 5300, 'Allowance'),
  ], '2026-10-17');
  assert.deepEqual(groups.map(g => g.title), ['Today', 'Yesterday', 'Thu, Oct 15']);
  assert.equal(groups[0].subtitle, 'Sat, Oct 17');
  assert.equal(groups[2].subtitle, '');
  assert.equal(groups[1].spent, 150);
  assert.equal(groups[1].saved, 150);
  assert.equal(groups[2].inflow, 5300);
});

test('compareText follows the old Activity Breakdown wording', () => {
  assert.deepEqual(compareText(860, 768, 'week'), { text: '▲ 12% vs last week', tone: 'up' });
  assert.deepEqual(compareText(500, 1000, 'month'), { text: '▼ 50% vs last month', tone: 'down' });
  assert.deepEqual(compareText(100, 100.2, 'week'), { text: '≈ same as last week', tone: 'muted' });
  assert.deepEqual(compareText(100, 0, 'month'), { text: 'No data last month', tone: 'muted' });
  assert.deepEqual(compareText(100, null, 'all'), { text: 'No prior period to compare', tone: 'muted' });
});
```

```ts
// src/lib/finance/__tests__/envelopes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelopes, nextCycle, templateToRows, type BudgetRow, type SavingsRow } from '../envelopes';

const b = (category: string, tier: BudgetRow['tier'], cap: number | null, spent: number, extra: Partial<BudgetRow> = {}): BudgetRow => ({
  budget_id: 1, category, cap_amount: cap, plan_amount: cap, is_override: false, override_reason: null,
  tier, spent, period_start: '2026-10-15', period_end: '2026-10-28', ...extra,
});
const savings: SavingsRow = { budget_id: 9, cap_amount: 265, plan_amount: 265, is_override: false, override_reason: null, funded: 0, tier: 'target', period_start: '2026-10-15', period_end: '2026-10-28' };

test('envelopes: only capped categories, ordered by tier then size, savings included', () => {
  const r = buildEnvelopes([
    b('miscellaneous', 'flexible', 265, 0), b('food', 'required', 1590, 500), b('grocery', 'required', 530, 0), b('leisure', 'flexible', null, 40),
  ], savings, '2026-10-17');
  assert.deepEqual(r.envelopes.map(x => x.category), ['food', 'grocery', 'savings', 'miscellaneous']);
  assert.equal(r.envelopes[0].left, 1090);
  assert.equal(r.envelopes[2].isSavings, true);
  assert.equal(r.elapsedPct, 15); // 2 of 13 days
  assert.deepEqual(r.period, { start: '2026-10-15', end: '2026-10-28' });
});

test('over cap and spending faster than plan', () => {
  const r = buildEnvelopes([b('food', 'required', 1000, 1120), b('grocery', 'required', 1000, 400)], null, '2026-10-17');
  assert.equal(r.envelopes[0].over, true);
  assert.equal(r.envelopes[0].left, -120);
  assert.equal(r.envelopes[1].fasterThanPlan, true); // 40% used at 15% through
});

test('nextCycle starts the day after the last one, same length and amount', () => {
  assert.deepEqual(nextCycle({ last_allowance_amount: 5300, last_period_start: '2026-08-26', last_period_end: '2026-09-22' }, '2026-10-17'),
    { start: '2026-09-23', end: '2026-10-20', days: 28, amount: 5300 });
  assert.equal(nextCycle({ last_allowance_amount: 5300, last_period_start: '2026-10-01', last_period_end: '2026-10-28' }, '2026-10-17'), null);
  assert.equal(nextCycle({ last_allowance_amount: null, last_period_start: null, last_period_end: null }, '2026-10-17'), null);
});

test('templateToRows matches the builder row shape', () => {
  assert.deepEqual(templateToRows([
    { category: 'food', priority_tier: 'required', allocation_type: 'percent', amount: null, percent: 30 },
    { category: 'savings', priority_tier: 'target', allocation_type: 'fixed', amount: 265, percent: null },
  ]), [
    { category: 'food', priority_tier: 'required', allocation_type: 'percent', value: 30 },
    { category: 'savings', priority_tier: 'target', allocation_type: 'fixed', value: 265 },
  ]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node scripts/fin-test.mjs` 
Expected: FAIL for `logContext`, `feed`, `envelopes` (modules not found); earlier suites still PASS.

- [ ] **Step 3: Implement `logContext.ts`**

```ts
// src/lib/finance/logContext.ts
/* Data for the composer's category chips and the drawer's "Log again" tiles (spec §7). */
export interface LoggedRow { type: 'expense' | 'savings'; category: string | null; goal_id: number | null; goal_name: string | null; amount: number; entry_date: string }
export interface LogRepeat { type: 'expense' | 'savings'; category: string | null; goal_id: number | null; goal_name: string | null; amount: number }

const DEFAULT_TOP = ['food', 'transportation', 'academic', 'grocery'];

export function topCategories(rows: LoggedRow[], limit = 4): string[] {
  const stats = new Map<string, { count: number; last: string }>();
  for (const r of rows) {
    if (r.type !== 'expense' || !r.category) continue;
    const s = stats.get(r.category) ?? { count: 0, last: '' };
    s.count += 1;
    if (r.entry_date > s.last) s.last = r.entry_date;
    stats.set(r.category, s);
  }
  const ranked = [...stats.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last))
    .map(([cat]) => cat);
  for (const d of DEFAULT_TOP) if (!ranked.includes(d)) ranked.push(d);
  return ranked.slice(0, limit);
}

export function repeatsFrom(rows: LoggedRow[], limit = 4): LogRepeat[] {
  const groups = new Map<string, { repeat: LogRepeat; count: number; last: string }>();
  for (const r of rows) {
    const key = `${r.type}|${r.category ?? ''}|${r.goal_id ?? ''}|${r.amount.toFixed(2)}`;
    const g = groups.get(key) ?? { repeat: { type: r.type, category: r.category, goal_id: r.goal_id, goal_name: r.goal_name, amount: r.amount }, count: 0, last: '' };
    g.count += 1;
    if (r.entry_date > g.last) g.last = r.entry_date;
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter(g => g.count >= 2)
    .sort((a, b) => b.last.localeCompare(a.last) || b.count - a.count)
    .slice(0, limit)
    .map(g => g.repeat);
}
```

- [ ] **Step 4: Implement `feed.ts`**

```ts
// src/lib/finance/feed.ts
/* Day-grouped feed (spec §9.2) and the period comparison wording carried over from the
   retired Activity Breakdown card (spec §9.1). */
import { formatDay, addDays } from './dates';

export interface FeedItem { id: number; type: 'allowance' | 'expense' | 'savings'; entry_date: string; amount: number; label: string; goal_id: number | null; recurring: boolean }
export interface DayGroup { date: string; title: string; subtitle: string; inflow: number; spent: number; saved: number; items: FeedItem[] }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function groupByDay(items: FeedItem[], today: string): DayGroup[] {
  const byDate = new Map<string, FeedItem[]>();
  for (const item of items) {
    const list = byDate.get(item.entry_date) ?? [];
    list.push(item);
    byDate.set(item.entry_date, list);
  }
  return [...byDate.keys()].sort().reverse().map(date => {
    const list = byDate.get(date)!;
    const sum = (t: FeedItem['type']) => r2(list.filter(i => i.type === t).reduce((s, i) => s + i.amount, 0));
    const relative = date === today || date === addDays(today, -1);
    return {
      date,
      title: formatDay(date, today),
      // "Today"/"Yesterday" get the calendar date beside them; older days already show it as the title.
      subtitle: relative ? formatDay(date, '0000-00-00') : '',
      inflow: sum('allowance'),
      spent: sum('expense'),
      saved: sum('savings'),
      items: list,
    };
  });
}

export function compareText(current: number, previous: number | null, range: 'week' | 'month' | 'all'): { text: string; tone: 'up' | 'down' | 'muted' } {
  if (range === 'all') return { text: 'No prior period to compare', tone: 'muted' };
  const word = range === 'week' ? 'week' : 'month';
  if (previous === null || previous <= 0) return { text: `No data last ${word}`, tone: 'muted' };
  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 0.5) return { text: `≈ same as last ${word}`, tone: 'muted' };
  return delta > 0
    ? { text: `▲ ${Math.round(delta)}% vs last ${word}`, tone: 'up' }
    : { text: `▼ ${Math.round(Math.abs(delta))}% vs last ${word}`, tone: 'down' };
}
```

- [ ] **Step 5: Implement `envelopes.ts`**

```ts
// src/lib/finance/envelopes.ts
/* Plan tab models (spec §8): envelope cards from the budgets route, the next-cycle offer,
   and the template → builder-row mapping shared by the editor and "Start next cycle". */
import { addDays, daysBetween } from './dates';
import type { Tier } from './ui/colors';

export interface BudgetRow {
  budget_id: number | null; category: string; cap_amount: number | null; plan_amount: number | null;
  is_override: boolean; override_reason: string | null; tier: Tier | null; spent: number;
  period_start: string | null; period_end: string | null;
}
export interface SavingsRow {
  budget_id: number; cap_amount: number; plan_amount: number | null; is_override: boolean; override_reason: string | null;
  funded: number; tier: Tier; period_start: string | null; period_end: string | null;
}
export interface EnvelopeModel {
  category: string; isSavings: boolean; tier: Tier; cap: number; spent: number; left: number; pct: number;
  over: boolean; fasterThanPlan: boolean; isOverride: boolean; planAmount: number | null; reason: string | null; budgetId: number | null;
}

const TIER_ORDER: Tier[] = ['required', 'target', 'flexible'];
const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildEnvelopes(budgets: BudgetRow[], savings: SavingsRow | null, today: string) {
  const dated = budgets.find(b => b.cap_amount !== null && b.period_start && b.period_end) ?? (savings?.period_start && savings.period_end ? savings : null);
  const period = dated ? { start: dated.period_start!, end: dated.period_end! } : null;
  const elapsedPct = period && daysBetween(period.start, period.end) > 0
    ? Math.min(100, Math.max(0, Math.round((daysBetween(period.start, today) / daysBetween(period.start, period.end)) * 100)))
    : null;

  const make = (category: string, isSavings: boolean, tier: Tier, cap: number, spent: number, row: { is_override: boolean; plan_amount: number | null; override_reason: string | null; budget_id: number | null }): EnvelopeModel => {
    const pct = cap > 0 ? Math.round((spent / cap) * 100) : 0;
    return {
      category, isSavings, tier, cap, spent, left: r2(cap - spent), pct,
      over: spent > cap,
      fasterThanPlan: !isSavings && spent > 0 && elapsedPct !== null && pct - elapsedPct > 15,
      isOverride: row.is_override, planAmount: row.plan_amount, reason: row.override_reason, budgetId: row.budget_id,
    };
  };

  const envelopes = budgets
    .filter(b => b.cap_amount !== null)
    .map(b => make(b.category, false, b.tier ?? 'flexible', b.cap_amount!, b.spent, b));
  if (savings) envelopes.push(make('savings', true, savings.tier, savings.cap_amount, savings.funded, savings));
  envelopes.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || b.cap - a.cap);
  return { envelopes, elapsedPct, period };
}

export function nextCycle(
  t: { last_allowance_amount: number | null; last_period_start: string | null; last_period_end: string | null },
  today: string,
): { start: string; end: string; days: number; amount: number } | null {
  if (t.last_allowance_amount === null || !t.last_period_start || !t.last_period_end) return null;
  if (t.last_period_end >= today) return null;
  const days = daysBetween(t.last_period_start, t.last_period_end) + 1;
  const start = addDays(t.last_period_end, 1);
  return { start, end: addDays(start, days - 1), days, amount: t.last_allowance_amount };
}

export function templateToRows(items: { category: string; priority_tier: Tier; allocation_type: 'fixed' | 'percent'; amount: number | null; percent: number | null }[]) {
  return items.map(it => ({
    category: it.category,
    priority_tier: it.priority_tier,
    allocation_type: it.allocation_type,
    value: it.allocation_type === 'fixed' ? (it.amount ?? 0) : (it.percent ?? 0),
  }));
}
```

- [ ] **Step 6: Run all finance tests and types**

Run: `node scripts/fin-test.mjs` then `npx tsc --noEmit`
Expected: every suite PASS; tsc exit 0. Note on `elapsedPct` in the first envelope test: Oct 15 → Oct 17 is 2 days of a 13-day span, so 15%.

---

### Task 7: Server "today", shared safe-to-spend maths, date-bug fixes

**Files:**
- Create: `src/lib/finance/safeToSpendServer.ts`
- Create: `src/lib/finance/status.ts`
- Modify: `src/app/api/finance/safe-to-spend/route.ts`, `what-if/route.ts`, `transactions/route.ts`, `apply-allocation/route.ts`, `recurring-rules/route.ts`, `summary/route.ts`, `budgets/route.ts`

**Interfaces:**
- Consumes: `manilaToday`, `addDays`, `addMonthsClamped`, `daysBetween`, `mondayOf`, `startOfMonth`, `endOfMonth` (Task 2); `formatPeso` (Task 1); `categoryLabel` (Task 2).
- Produces:
  - `loadSpendBase(userId: number): Promise<{ today: string; currentBalance: number; horizonEnd: string; daysUntilNextAllowance: number | null; upcomingRequired: number; upcomingSavings: number }>`
  - `computeSafe(balance, upcomingRequired, upcomingSavings): { buffer: number; rawSafe: number; safe: number }`
  - `safeToSpendStatus(sts): { label: string; tone: 'success' | 'warn' | 'danger' }`
  - `shortfallSuggestion(sts): string | null` (same copy as today, amounts via `formatPeso`).

- [ ] **Step 1: Capture "before" responses**

In the logged-in Playwright browser at `http://localhost:3000/finance`, run with `browser_evaluate`:

```js
async () => {
  const get = u => fetch(u).then(r => r.json());
  const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  return JSON.stringify({
    sts: await get('/api/finance/safe-to-spend'),
    whatIf: await post('/api/finance/what-if', { type: 'expense', amount: 500 }),
    summaryWeek: (await get('/api/finance/summary?range=week')).date_range,
    summaryMonth: (await get('/api/finance/summary?range=month')).date_range,
    budgets: await get('/api/finance/budgets'),
  });
}
```

Save the result to `.playwright-mcp/finance-before.json` (use the tool's `filename` option). Note the server's current time of day. Before 08:00 Manila time, "today" values are expected to change.

- [ ] **Step 2: Create `safeToSpendServer.ts`**

```ts
// src/lib/finance/safeToSpendServer.ts
/* Shared by /safe-to-spend, /what-if and /wishlist so the three can never disagree (spec §4.4).
   Server-only: imports the pool. */
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { manilaToday, addDays, daysBetween } from './dates';

async function actualTotal(userId: number, table: string, column: string): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(${column}), 0) AS total FROM ${table} WHERE user_id = ? AND status = 'actual'`, [userId]);
  return Number(rows[0].total);
}

async function plannedTotal(userId: number, table: string, column: string, start: string, end: string): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(${column}), 0) AS total FROM ${table} WHERE user_id = ? AND status = 'planned' AND entry_date BETWEEN ? AND ?`,
    [userId, start, end]);
  return Number(rows[0].total);
}

export function computeSafe(balance: number, upcomingRequired: number, upcomingSavings: number) {
  const buffer = balance > 0 ? Math.round(balance * 0.10 * 100) / 100 : 0;
  const rawSafe = balance - upcomingRequired - upcomingSavings - buffer;
  return { buffer, rawSafe, safe: Math.max(0, rawSafe) };
}

export async function loadSpendBase(userId: number) {
  const today = manilaToday();
  const [allowance, expense, savings] = await Promise.all([
    actualTotal(userId, 'allowance', 'allowance_amount'),
    actualTotal(userId, 'expenses', 'expense_amount'),
    actualTotal(userId, 'savings_entries', 'savings_amount'),
  ]);
  const [nextRows] = await pool.execute<RowDataPacket[]>(
    `SELECT entry_date FROM allowance WHERE user_id = ? AND status = 'planned' AND entry_date >= ? ORDER BY entry_date ASC LIMIT 1`,
    [userId, today]);
  const horizonEnd = nextRows.length ? String(nextRows[0].entry_date) : addDays(today, 14);
  const daysUntilNextAllowance = nextRows.length ? daysBetween(today, horizonEnd) : null;
  const [upcomingRequired, upcomingSavings] = await Promise.all([
    plannedTotal(userId, 'expenses', 'expense_amount', today, horizonEnd),
    plannedTotal(userId, 'savings_entries', 'savings_amount', today, horizonEnd),
  ]);
  return { today, currentBalance: allowance - expense - savings, horizonEnd, daysUntilNextAllowance, upcomingRequired, upcomingSavings };
}
```

- [ ] **Step 3: Rewire `safe-to-spend/route.ts`**

Replace the two local helpers (`actualTotal`, `plannedTotal`) and everything from `const today = …` down to `const perDay = …` with:

```ts
import { loadSpendBase, computeSafe } from '@/lib/finance/safeToSpendServer';
// …inside GET, after the auth check:
  const { today, currentBalance, horizonEnd, daysUntilNextAllowance, upcomingRequired, upcomingSavings } = await loadSpendBase(userId);
  const { buffer, rawSafe, safe: safeToSpend } = computeSafe(currentBalance, upcomingRequired, upcomingSavings);
  const daysForRate = daysUntilNextAllowance ?? 14;
  const perDay = daysForRate > 0 ? Math.round((safeToSpend / daysForRate) * 100) / 100 : safeToSpend;
```

Leave the tier-aware block, the `upcoming` query and the response object unchanged (they keep using `today`, `horizonEnd`, `rawSafe`). Remove the now-unused local helper functions.

- [ ] **Step 4: Rewire `what-if/route.ts`**

Replace the local helpers, `computeSafe`, and the block from `const today = …` to `const afterPerDay = …` with:

```ts
import { loadSpendBase, computeSafe } from '@/lib/finance/safeToSpendServer';
// …after validating type/amount:
  const { currentBalance, daysUntilNextAllowance, upcomingRequired, upcomingSavings } = await loadSpendBase(userId);
  const daysForRate = daysUntilNextAllowance ?? 14;
  const perDayOf = (safe: number) => daysForRate > 0 ? Math.round((safe / daysForRate) * 100) / 100 : safe;
  const beforeSafe = computeSafe(currentBalance, upcomingRequired, upcomingSavings).safe;
  const beforePerDay = perDayOf(beforeSafe);
  const afterBalance = currentBalance - numAmount;
  const afterSafe = computeSafe(afterBalance, upcomingRequired, upcomingSavings).safe;
  const afterPerDay = perDayOf(afterSafe);
```

The response object, goal block and warnings stay as they are.

- [ ] **Step 5: Use `manilaToday()` in `transactions` and `apply-allocation`**

In both files replace `const today = new Date().toISOString().slice(0, 10);` with `const today = manilaToday();` and add `import { manilaToday } from '@/lib/finance/dates';`.

- [ ] **Step 6: Fix `recurring-rules/route.ts`**

Replace `addInterval` with:

```ts
import { manilaToday, addDays, addMonthsClamped } from '@/lib/finance/dates';

/* UTC string arithmetic: the old local-midnight + toISOString version stepped weekly rules
   6 days at a time on a UTC+8 machine (plan ruling R3). */
function addInterval(dateStr: string, frequency: Frequency): string {
  if (frequency === 'weekly') return addDays(dateStr, 7);
  if (frequency === 'biweekly') return addDays(dateStr, 14);
  return addMonthsClamped(dateStr, 1);
}
```

Replace the three `const today = new Date().toISOString().slice(0, 10);` lines with `const today = manilaToday();`.

- [ ] **Step 7: Fix `summary/route.ts` ranges**

Replace `rangeToDates` and `previousRangeToDates` with:

```ts
import { manilaToday, addDays, addMonthsClamped, mondayOf, startOfMonth, endOfMonth } from '@/lib/finance/dates';

function rangeToDates(range: Range, today: string): { start: string; end: string } {
  if (range === 'week') { const start = mondayOf(today); return { start, end: addDays(start, 6) }; }
  if (range === 'month') return { start: startOfMonth(today), end: endOfMonth(today) };
  return { start: '2000-01-01', end: today };
}

function previousRangeToDates(range: Range, today: string): { start: string; end: string } | null {
  if (range === 'all') return null;
  if (range === 'week') { const start = addDays(mondayOf(today), -7); return { start, end: addDays(start, 6) }; }
  const prev = addMonthsClamped(startOfMonth(today), -1);
  return { start: prev, end: endOfMonth(prev) };
}
```

Replace `const today = new Date().toISOString().slice(0, 10);` with `const today = manilaToday();`. In the goals block, replace `projectedDate = new Date().toISOString().slice(0, 10);` with `projectedDate = today;`.

- [ ] **Step 8: Fix `budgets/route.ts` `currentPeriodRange`**

```ts
import { manilaToday, addDays, mondayOf, startOfMonth, endOfMonth } from '@/lib/finance/dates';

function currentPeriodRange(period: 'weekly' | 'monthly'): { start: string; end: string } {
  const today = manilaToday();
  if (period === 'weekly') { const start = mondayOf(today); return { start, end: addDays(start, 6) }; }
  return { start: startOfMonth(today), end: endOfMonth(today) };
}
```

- [ ] **Step 9: Create `status.ts`**

```ts
// src/lib/finance/status.ts
/* Hero status pill and shortfall advisory, moved out of the component unchanged in meaning
   (financetracker-log.md §11, §20). */
import { formatPeso } from './format';
import { categoryLabel } from './categories';
import { formatShortDate } from './dates';

export interface StatusInput {
  safe_to_spend: number; upcoming_required: number; upcoming_savings: number; horizon_end: string | null;
  shortfall: number; shortfall_coverable_by: 'flexible' | 'flexible_and_target' | 'none' | null; flexible_categories: string[];
}

export function safeToSpendStatus(s: StatusInput): { label: string; tone: 'success' | 'warn' | 'danger' } {
  if (s.safe_to_spend <= 0) return { label: 'Over budget this cycle', tone: 'danger' };
  if (s.safe_to_spend < s.upcoming_required + s.upcoming_savings) return { label: 'Spending tight this cycle', tone: 'warn' };
  return { label: s.horizon_end ? `Safe through ${formatShortDate(s.horizon_end)}` : 'Spending on track', tone: 'success' };
}

export function shortfallSuggestion(s: StatusInput): string | null {
  if (s.shortfall <= 0 || !s.shortfall_coverable_by) return null;
  const amount = formatPeso(s.shortfall);
  if (s.shortfall_coverable_by === 'flexible') {
    const cats = s.flexible_categories.map(categoryLabel).join(', ');
    return `Your current plan exceeds available funds by ${amount}. ${cats ? `Flexible spending (${cats}) is` : 'Flexible spending is'} the first area available for adjustment.`;
  }
  if (s.shortfall_coverable_by === 'flexible_and_target') {
    return `Your current plan exceeds available funds by ${amount}. Trimming flexible and committed spending together could cover the gap.`;
  }
  return `Your current plan exceeds available funds by ${amount}. Even trimming flexible and committed spending may not close the gap.`;
}
```

- [ ] **Step 10: Grep gate**

Run: `grep -rn "toISOString().slice(0, 10)" src/app/api/finance src/lib/finance`
Expected: no matches.

- [ ] **Step 11: Capture "after" and compare**

Run the Step 1 snippet again and save it as `.playwright-mcp/finance-after.json`. Then diff the two files.
Expected:
- `sts.safe_to_spend`, `per_day`, `current_balance`, `upcoming_*`, `buffer` and `whatIf.before/after` are identical.
- `summaryWeek` is a Monday–Sunday pair, and `summaryMonth` runs from the 1st to the month's last day. If the "before" values were shifted a day, that shift is the bug being fixed; record it in the task report.
- `horizon_end` and `days_until_next_allowance` differ only if the capture straddled 08:00 Manila time.

- [ ] **Step 12: Verify**

Run: `npx tsc --noEmit` and `node scripts/fin-test.mjs`
Expected: exit 0; all suites PASS.

---

### Task 8: Finance stylesheet and style gate

**Files:**
- Create: `src/app/finance/finance.css`
- Modify: `scripts/wb-style-gate.mjs` (`ALLOW_HEX` only)

**Interfaces:**
- Produces: the `--fin-*` variables and base classes later tasks extend (`.fin-page`, `.fin-wrap`, `.fin-num`, `.fin-card`, `.fin-card__head`, `.fin-card__title`, `.fin-card__sub`, `.fin-btn`, `.fin-btn--primary`, `.fin-btn--ghost`, `.fin-btn--sm`, `.fin-chip`, `.fin-chip.is-on`, `.fin-chip.is-on-blue`, `.fin-pill` (+ `--success|--warn|--danger|--purple|--slate`), `.fin-label`, `.fin-hint`, `.fin-link`, `.fin-amount--in|--out|--save`, `.fin-track` / `.fin-track__fill`, `.fin-field`, `.fin-field-label`, `.fin-error`).

- [ ] **Step 1: Create `finance.css`**

```css
/* Finance design tokens and classes. Spec: docs/superpowers/specs/2026-10-18-finance-revamp-design.md §4.2.
   Builds on src/app/workboard/workboard.css (--wb-* tokens), which /finance also imports.
   Every Finance component styles itself with these global classes. */
:root {
  /* Money */
  --fin-income: #74bcd9;   --fin-income-ink: #256f92;  --fin-income-bg: rgba(116, 188, 217, 0.16);
  --fin-expense: #e0679d;  --fin-expense-ink: #b0396d; --fin-expense-bg: rgba(240, 103, 157, 0.14);
  --fin-expense-dark: #c65f83;
  --fin-savings: #9b6dd6;  --fin-savings-ink: #6b46b3; --fin-savings-bg: rgba(155, 109, 214, 0.14);
  /* Tiers */
  --fin-tier-essential: #2a7fa8; --fin-tier-essential-ink: #256f92; --fin-tier-essential-bg: rgba(116, 188, 217, 0.16);
  --fin-tier-committed: #9b6dd6; --fin-tier-committed-ink: #6b46b3; --fin-tier-committed-bg: rgba(155, 109, 214, 0.14);
  --fin-tier-flexible: #64748b;  --fin-tier-flexible-ink: #4f5d72; --fin-tier-flexible-bg: rgba(100, 116, 139, 0.12);
  /* Surfaces */
  --fin-hero-wash: linear-gradient(135deg, rgba(242, 167, 192, 0.16), rgba(116, 188, 217, 0.16));
  --fin-stitch: rgba(116, 188, 217, 0.35);
  --fin-track: rgba(120, 130, 150, 0.13);
  --fin-ghost-day: rgba(120, 130, 150, 0.13);
  --fin-ghost-border: rgba(120, 130, 150, 0.26);
  --fin-card-solid: rgba(255, 255, 255, 0.62);
}

.fin-page { min-height: 100vh; color: var(--wb-text); font-family: 'Inter', sans-serif; }
.fin-wrap { max-width: 1072px; margin: 0 auto; padding: 28px 16px 120px; }
.fin-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.fin-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.fin-card {
  background: var(--wb-glass); border: 1px solid var(--wb-glass-border); border-radius: var(--wb-r-panel);
  box-shadow: var(--wb-shadow-card); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  padding: 20px 22px; margin-bottom: 14px;
}
.fin-card__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
.fin-card__title { margin: 0; font-family: 'DM Sans', sans-serif; font-size: var(--wb-fs-16); font-weight: 800; }
.fin-card__sub { font-size: var(--wb-fs-13); color: var(--wb-text-subtle); font-weight: 600; margin-bottom: 14px; }
.fin-push { margin-left: auto; }

.fin-btn {
  font: inherit; font-size: var(--wb-fs-13); font-weight: 700; border-radius: var(--wb-r-lg); padding: 8px 14px;
  border: 1px solid transparent; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; cursor: pointer;
  transition: transform var(--wb-dur-fast) var(--wb-ease), opacity var(--wb-dur-fast) var(--wb-ease);
}
.fin-btn:active:not(:disabled) { transform: scale(0.97); }
.fin-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.fin-btn:focus-visible, .fin-chip:focus-visible, .fin-link:focus-visible { outline: 2px solid var(--wb-blue-strong); outline-offset: 2px; }
.fin-btn--primary { background: var(--wb-pink); color: var(--wb-surface); box-shadow: 0 4px 14px rgba(240, 103, 157, 0.35); }
.fin-btn--ghost { background: rgba(255, 255, 255, 0.6); border-color: var(--wb-glass-border); color: var(--wb-text-muted); }
.fin-btn--sm { padding: 5px 10px; font-size: var(--wb-fs-12); }
.fin-btn--block { width: 100%; justify-content: center; padding: 11px; }
.fin-kbd { font-size: var(--wb-fs-12); font-weight: 700; border-radius: 5px; padding: 0 6px; background: rgba(45, 55, 72, 0.07); color: var(--wb-text-subtle); }
.fin-btn--primary .fin-kbd { background: rgba(255, 255, 255, 0.25); color: var(--wb-surface); }

.fin-chip {
  font: inherit; font-size: var(--wb-fs-13); font-weight: 700; padding: 7px 12px; border-radius: var(--wb-r-pill);
  background: rgba(45, 55, 72, 0.05); color: var(--wb-text-muted); border: 1px solid transparent; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  transition: transform var(--wb-dur-fast) var(--wb-ease);
}
.fin-chip:active { transform: scale(0.97); }
.fin-chip.is-on { background: var(--fin-expense-bg); color: var(--fin-expense-ink); border-color: rgba(240, 103, 157, 0.4); }
.fin-chip.is-on-blue { background: var(--fin-income-bg); color: var(--fin-income-ink); border-color: rgba(116, 188, 217, 0.5); }
.fin-chip.is-on-purple { background: var(--fin-savings-bg); color: var(--fin-savings-ink); border-color: rgba(155, 109, 214, 0.45); }
.fin-chips { display: flex; flex-wrap: wrap; gap: 6px; }

.fin-pill { display: inline-flex; align-items: center; gap: 6px; font-size: var(--wb-fs-12); font-weight: 700; padding: 4px 10px; border-radius: var(--wb-r-pill); white-space: nowrap; }
.fin-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.fin-pill--success { background: var(--wb-success-bg); color: var(--wb-success); }
.fin-pill--warn { background: var(--wb-warn-bg); color: var(--wb-warn); }
.fin-pill--danger { background: var(--wb-danger-bg); color: var(--wb-danger); }
.fin-pill--purple { background: var(--fin-savings-bg); color: var(--fin-savings-ink); }
.fin-pill--slate { background: var(--fin-tier-flexible-bg); color: var(--fin-tier-flexible-ink); }

.fin-label { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--wb-text-subtle); }
.fin-hint { font-size: var(--wb-fs-12); color: var(--wb-text-faint); font-weight: 600; }
.fin-link { font: inherit; font-size: var(--wb-fs-13); font-weight: 700; color: var(--wb-blue-ink); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: none; }
.fin-link--underline { text-decoration: underline; color: inherit; }
.fin-amount--in { color: var(--fin-income-ink); }
.fin-amount--out { color: var(--fin-expense-ink); }
.fin-amount--save { color: var(--fin-savings-ink); }

.fin-track { position: relative; height: 8px; border-radius: var(--wb-r-pill); background: var(--fin-track); overflow: hidden; }
.fin-track__fill {
  position: absolute; inset: 0; border-radius: var(--wb-r-pill); transform-origin: left;
  transition: transform var(--wb-dur-slow) var(--wb-ease);
}

.fin-field-label { display: block; font-size: var(--wb-fs-12); font-weight: 700; color: var(--wb-text-subtle); margin: 14px 0 6px; }
.fin-field {
  display: flex; align-items: center; gap: 8px; width: 100%; border: 1px solid var(--wb-hairline); border-radius: var(--wb-r-lg);
  padding: 9px 12px; background: var(--wb-surface); font-size: var(--wb-fs-14); font-weight: 700; color: var(--wb-text);
}
.fin-field:focus-within { outline: 2px solid var(--wb-blue-strong); outline-offset: 1px; }
.fin-field input, .fin-field select { border: 0; outline: none; background: transparent; font: inherit; color: inherit; width: 100%; min-width: 0; }
.fin-field__prefix { color: var(--wb-text-faint); font-weight: 800; }
.fin-error { font-size: var(--wb-fs-12); font-weight: 600; color: var(--wb-danger); margin-top: 6px; }

@media (max-width: 700px) { .fin-wrap { padding: 20px 16px 160px; } }

@media (prefers-reduced-motion: reduce) {
  .fin-page *, .fin-page *::before, .fin-page *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
```

- [ ] **Step 2: Extend the style gate allow-list**

In `scripts/wb-style-gate.mjs`, change the `ALLOW_HEX` line to:

```js
const ALLOW_HEX = [/workboard\.css$/, /lib[\\/]workboard[\\/]color\.ts$/, /lib[\\/]workboard[\\/]ui[\\/]tokens\.ts$/, /finance[\\/]finance\.css$/, /lib[\\/]finance[\\/]ui[\\/]colors\.ts$/];
```

Change the header comment's first line to `// Workboard + Finance style gate (Workboard spec §18 step 4, Finance spec §4.6).`

- [ ] **Step 3: Verify**

Run: `node scripts/wb-style-gate.mjs src/app/finance/finance.css src/lib/finance/ui/colors.ts src/lib/finance/*.ts`
Expected: `style gate clean`.

---

### Task 9: Move today's UI into `legacy/` (no visual change)

**Files:**
- Create: `src/components/finance/types.ts`, `src/components/finance/legacy/shared.tsx`, `legacy/LegacyHero.tsx`, `legacy/LegacyStatRail.tsx`, `legacy/LegacyPlan.tsx`, `legacy/LegacyTransactions.tsx`, `legacy/LegacyGoals.tsx`, `src/components/finance/FinanceShell.tsx`
- Modify: `src/app/finance/page.tsx`
- Delete: `src/components/finance/FinanceDashboard.tsx`

**Interfaces:**
- Produces:
  - `types.ts`: every interface from the top of `FinanceDashboard.tsx` (lines 11–84), each `export`ed under its current name. The `SafeToSpendResponse.upcoming` element type stays `TransactionItem`.
  - Legacy exports: `SafeToSpendHero`, `StatRail` (LegacyStatRail.tsx), `SpendingPlan` (LegacyPlan.tsx), `TransactionsSection` (LegacyTransactions.tsx), `GoalTracker`, `WhatIf` (LegacyGoals.tsx).
  - `FinanceShell` default export with the props `{ firstName: string }`.

This is a mechanical move. Copy code verbatim; change only `import`/`export` lines.

- [ ] **Step 1: Screenshot the current page**

Playwright at 1440×900, full page, `/finance` → `.playwright-mcp/legacy-before-1440.png`.

- [ ] **Step 2: Create `types.ts`**

Move the `Range` type and every `interface` from `FinanceDashboard.tsx` lines 11–84 into `src/components/finance/types.ts`, each prefixed with `export`.

- [ ] **Step 3: Create `legacy/shared.tsx`**

Start the file with `'use client';` and the React import it needs. Move these top-level declarations verbatim from `FinanceDashboard.tsx`, adding `export` to each:
- `EXPENSE_CATEGORIES`, `ALLOC_CATEGORIES`, `categoryLabel`, `peso`, `sumBuckets`
- `EXPENSE_HUES`, `SAVINGS_HUES`, `hueFor`, `expenseColor`, `savingsColor`
- `GLASS`, `cardTitle`, `inputStyle`, `PesoInput`, `subPanel`, `RankedBars`, `dateFmt`, `fieldLabel`
- `TIER_LABELS` / `TIER_COLORS` (wherever they are declared; find them with `grep -n "TIER_LABELS\|TIER_COLORS" src/components/finance/FinanceDashboard.tsx`)

- [ ] **Step 4: Create the five legacy component files**

Each starts with `'use client';`, imports React hooks, lucide icons, types from `../types`, and helpers from `./shared` as needed. Move verbatim:
- `LegacyHero.tsx`: `safeToSpendStatus`, `shortfallSuggestion`, `SafeToSpendHero` (export `SafeToSpendHero`).
- `LegacyStatRail.tsx`: `currentBucketIndex`, `RANGE_SUBTITLE`, `StatRail`, `rowLabelStyle`, `rowWrapStyle`, `valueLabelStyle`, `EMPTY_BUCKET_BG`, `emptyBadgeStyle`, `BarRow`, `SavingsSegmentedRow` (export `StatRail`).
- `LegacyPlan.tsx`: `SAVINGS_COLOR`, `BudgetTracker`, `SpendingPlan`, `SmartAllocator` (export `SpendingPlan`).
- `LegacyTransactions.tsx`: `transactionAccent`, `transactionLabel`, `TransactionList`, `TransactionsSection`, `ruleCadence`, `ruleWhat`, `RecurringRules` (export `TransactionsSection`).
- `LegacyGoals.tsx`: `whatIfVerdict`, `WhatIf`, `GoalTracker` (export both).

- [ ] **Step 5: Create `FinanceShell.tsx`**

Move the `FinanceDashboard` function body verbatim, renamed to `export default function FinanceShell({ firstName }: { firstName: string })`. It still renders the `<style jsx global>` block, the header and the same six sections in the same order, now imported from the legacy files. Delete `FinanceDashboard.tsx`.

- [ ] **Step 6: Update `page.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import FinanceShell from '@/components/finance/FinanceShell';
import '../workboard/workboard.css';
import './finance.css';

export default async function FinancePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const firstName = session.user.name?.split(' ')[0] ?? 'Student';
  return <FinanceShell firstName={firstName} />;
}
```

- [ ] **Step 7: Verify nothing changed**

- `npx tsc --noEmit` exits 0.
- `grep -rn "FinanceDashboard" src` returns no matches.
- Playwright full-page screenshot at 1440 → `.playwright-mcp/legacy-after-1440.png`. Compare it with the before shot: it must be pixel-identical except for live data. The two new stylesheets add only `:root` variables and `fin-*` classes nothing uses yet. If anything moved, a `workboard.css` rule is leaking: report it, don't fix it in `workboard.css`.

✅ **CHECKPOINT (Phase 0):** run the phase checkpoint list from Global Constraints. Show the user the before/after screenshots and the `finance-before/after.json` diff summary (including any date-shift corrections). Wait for approval.

---
## Phase 1 — Shell, Pace hero, tabs (spec §5)

### Task 10: Pace fields on `safe-to-spend`

**Files:**
- Modify: `src/app/api/finance/safe-to-spend/route.ts`
- Modify: `src/components/finance/types.ts`

**Interfaces:**
- Consumes: `paceStartFor` (Task 5), `loadSpendBase` (Task 7).
- Produces: the `SafeToSpendResponse` type gains `pace_start: string` and `daily_spend: { date: string; amount: number }[]` (actual expenses per day from `pace_start` through today, ascending; days with no spending are absent).

- [ ] **Step 1: Add the queries**

In the GET handler, after `loadSpendBase` and before the response:

```ts
import { paceStartFor } from '@/lib/finance/pace';
// …
  const [lastAllowanceRows] = await pool.execute<RowDataPacket[]>(
    `SELECT MAX(entry_date) AS d FROM allowance WHERE user_id = ? AND status = 'actual' AND entry_date <= ?`,
    [userId, today]
  );
  const lastAllowance = lastAllowanceRows[0]?.d ? String(lastAllowanceRows[0].d) : null;
  const paceStart = paceStartFor(lastAllowance, today);
  const [dailyRows] = await pool.execute<RowDataPacket[]>(
    `SELECT entry_date, SUM(expense_amount) AS total FROM expenses
     WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?
     GROUP BY entry_date ORDER BY entry_date ASC`,
    [userId, paceStart, today]
  );
```

Add to the response object:

```ts
    pace_start: paceStart,
    daily_spend: dailyRows.map(r => ({ date: String(r.entry_date), amount: Number(r.total) })),
```

- [ ] **Step 2: Update the type**

In `types.ts`, add to `SafeToSpendResponse`:

```ts
  pace_start: string;
  daily_spend: { date: string; amount: number }[];
```

- [ ] **Step 3: Verify**

`npx tsc --noEmit` → exit 0. In the logged-in Playwright browser, `browser_evaluate` `() => fetch('/api/finance/safe-to-spend').then(r => r.json()).then(d => ({ pace_start: d.pace_start, daily_spend: d.daily_spend, horizon_end: d.horizon_end }))`. Expected: `pace_start` is a `YYYY-MM-DD` on or before today, and `daily_spend` dates fall between `pace_start` and today.

---

### Task 11: Pace chart, hero number, Pace hero

**Files:**
- Create: `src/components/finance/hero/PaceChart.tsx`, `hero/HeroNumber.tsx`, `hero/PaceHero.tsx`
- Modify: `src/app/finance/finance.css` (append the hero and pace blocks)

**Interfaces:**
- Consumes: `PaceSeries`, `axisLabels` (Task 5); `formatPeso`, `formatPesoWhole`, `splitPeso` (Task 1); `formatDay` (Task 2); `safeToSpendStatus`, `shortfallSuggestion` (Task 7); `prefersReducedMotion`, `DUR` from `@/lib/workboard/ui/tokens`; `WbSkeleton`.
- Produces:
  - `PaceChart({ series, whatIf?, label, tall? })`, where `whatIf?: { amount: number; afterPerDay: number } | null`.
  - `HeroNumber({ value })`.
  - `PaceHero({ sts, series, children })`: `children` is the tab bar, rendered attached to the hero's bottom edge.

- [ ] **Step 1: `PaceChart.tsx`**

```tsx
'use client';

import { axisLabels, type PaceSeries } from '@/lib/finance/pace';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { formatDay } from '@/lib/finance/dates';

export interface PaceChartProps {
  series: PaceSeries;
  /** What-if B: a hypothetical purchase stacked on today's bar, plus the new per-day line. */
  whatIf?: { amount: number; afterPerDay: number } | null;
  label: string;
  tall?: boolean;
}

/* One bar per day of the cycle against the current per-day budget (spec §5.3). Bars grow
   with a scaleY keyframe on mount; keying a bar by its amount replays it only when that
   day's value changes (spec §11 rule 3). The hypothetical purchase never rescales the
   chart: its bar caps at the top with an amount label. */
export default function PaceChart({ series, whatIf = null, label, tall = false }: PaceChartProps) {
  const { bars, perDay, max } = series;
  const labels = axisLabels(bars);
  const today = bars.find(b => b.isToday)?.date ?? '';
  const pct = (v: number) => Math.min(100, (v / max) * 100);
  const columns = { gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` };
  const midIndex = Math.round((bars.length - 1) / 2);

  return (
    <figure className={`fin-pace${tall ? ' fin-pace--tall' : ''}`} aria-label={label}>
      <div className="fin-pace__plot" style={columns}>
        <div className={`fin-pace__line${whatIf ? ' is-old' : ''}`} style={{ bottom: `${pct(perDay)}%` }}>
          <span className="fin-num">{formatPesoWhole(perDay)}/day</span>
        </div>
        {whatIf && (
          <div className="fin-pace__line is-after" style={{ bottom: `${pct(whatIf.afterPerDay)}%` }}>
            <span className="fin-num">{formatPesoWhole(whatIf.afterPerDay)}/day after</span>
          </div>
        )}
        {bars.map(b => {
          if (b.future) return <span key={b.date} className="fin-pace__ghost" aria-hidden />;
          const extra = b.isToday && whatIf ? whatIf.amount : 0;
          const total = b.amount + extra;
          const height = Math.max(pct(total), b.amount > 0 || extra > 0 ? 4 : 2);
          const stripe = extra > 0 ? Math.min(100, (pct(extra) / height) * 100) : 0;
          const tip = `${formatDay(b.date, today)}: ${formatPeso(b.amount)} spent`;
          return (
            <span
              key={`${b.date}-${total}`}
              role="img"
              tabIndex={0}
              aria-label={tip}
              data-tip={tip}
              className={`fin-pace__bar${b.over ? ' is-over' : ''}${b.isToday ? ' is-today' : ''}`}
              style={{ height: `${height}%` }}
            >
              {stripe > 0 && <span className="fin-pace__stripe" style={{ height: `${stripe}%` }} aria-hidden />}
              {total > max && <span className="fin-pace__cap fin-num" aria-hidden>{formatPesoWhole(total)} ↑</span>}
            </span>
          );
        })}
      </div>
      <div className="fin-pace__axis" style={columns} aria-hidden>
        {labels.map((l, i) => (
          <span key={bars[i].date} className={`${bars[i].isToday ? 'is-today' : ''}${i === midIndex ? ' is-mid' : ''}`}>{l ?? ''}</span>
        ))}
      </div>
    </figure>
  );
}
```

- [ ] **Step 2: `HeroNumber.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { formatPeso, splitPeso } from '@/lib/finance/format';
import { DUR, prefersReducedMotion } from '@/lib/workboard/ui/tokens';

/* Counts from the old value to the new one over 240ms when the number changes after a log
   or undo; no count-up on first render (spec §5.2). Screen readers get the final value only. */
export default function HeroNumber({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value || prefersReducedMotion()) { setShown(value); return; }
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / DUR.slow);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const { whole, cents } = splitPeso(shown);
  return (
    <p className="fin-hero__num fin-num">
      <span className="fin-sr-only">{formatPeso(value)}</span>
      <span aria-hidden>{whole}<span className="fin-hero__cents">{cents}</span></span>
    </p>
  );
}
```

- [ ] **Step 3: `PaceHero.tsx`**

```tsx
'use client';

import type { ReactNode } from 'react';
import { Wallet } from 'lucide-react';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { safeToSpendStatus, shortfallSuggestion } from '@/lib/finance/status';
import type { PaceSeries } from '@/lib/finance/pace';
import type { SafeToSpendResponse } from '../types';
import HeroNumber from './HeroNumber';
import PaceChart from './PaceChart';

/* Spec §5.2–5.3. The left side keeps the content and order of the old hero (§1.2); the right
   side is the daily pace. `children` is the tab bar, attached to the hero's bottom edge. */
export default function PaceHero({ sts, series, children }: { sts: SafeToSpendResponse | null; series: PaceSeries | null; children: ReactNode }) {
  const status = sts ? safeToSpendStatus(sts) : null;
  const advice = sts ? shortfallSuggestion(sts) : null;
  const days = sts?.days_until_next_allowance ?? null;
  const spentAnything = series?.bars.some(b => !b.future && b.amount > 0) ?? false;

  return (
    <section className="fin-hero" aria-labelledby="fin-hero-label">
      <div className="fin-hero__body">
        <div className="fin-hero__left">
          <div className="fin-hero__eyebrow fin-label" id="fin-hero-label"><Wallet size={15} aria-hidden /> Safe to spend</div>
          {sts ? (
            <>
              <HeroNumber value={sts.safe_to_spend} />
              <p className="fin-hero__perday fin-num">
                {formatPeso(sts.per_day)}/day · {days !== null ? `${days} day${days === 1 ? '' : 's'} until next allowance` : 'over the next 14 days'}
              </p>
              {(sts.upcoming_required > 0 || sts.upcoming_savings > 0) && (
                <p className="fin-hero__after fin-num">
                  After {formatPeso(sts.upcoming_required)} upcoming expenses
                  {sts.upcoming_savings > 0 && <> and {formatPeso(sts.upcoming_savings)} planned savings</>}
                </p>
              )}
              {status && <div className="fin-hero__status"><span className={`fin-pill fin-pill--${status.tone}`}>{status.label}</span></div>}
              {advice && <p className="fin-hero__advice" role="note">{advice}</p>}
            </>
          ) : (
            <div className="fin-hero__skel" aria-busy="true" aria-label="Loading safe to spend">
              <WbSkeleton width={260} height={52} radius={10} />
              <WbSkeleton width={300} height={14} />
              <WbSkeleton width={140} height={22} radius={999} />
            </div>
          )}
        </div>
        <div className="fin-hero__pace">
          <div className="fin-hero__pace-head">
            <span className="fin-label">Daily pace</span>
            {series && spentAnything && (
              <span className="fin-hero__pace-sum fin-num">
                Avg <b>{formatPesoWhole(series.avg)}</b>/day ·{' '}
                <span className={series.diff >= 0 ? 'is-under' : 'is-over'}>
                  {formatPesoWhole(Math.abs(series.diff))} {series.diff >= 0 ? 'under' : 'over'}
                </span>
              </span>
            )}
          </div>
          {series ? (
            <div className="fin-hero__chart">
              <PaceChart series={series} label={`Daily spending this cycle against ${formatPesoWhole(series.perDay)} a day`} />
              {!spentAnything && <p className="fin-pace__empty fin-hint">No spending yet this cycle</p>}
            </div>
          ) : (
            <WbSkeleton height={96} radius={8} style={{ marginTop: 14 }} />
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 4: Append the CSS**

Append to `src/app/finance/finance.css`:

```css
/* ── Header ── */
.fin-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.fin-header__title { margin: 0; font-family: 'DM Sans', sans-serif; font-size: var(--wb-fs-24); font-weight: 800; letter-spacing: -0.01em; }
.fin-header__today { margin: 2px 0 0; font-size: var(--wb-fs-13); color: var(--wb-text-muted); font-weight: 600; }
.fin-header__actions { margin-left: auto; display: flex; gap: 8px; }

/* ── Pace hero (spec §5) ── */
.fin-hero {
  border-radius: var(--wb-r-panel); border: 1px solid var(--wb-glass-border); background: var(--wb-glass);
  box-shadow: var(--wb-shadow-card); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  margin-bottom: 16px; overflow: hidden;
}
.fin-hero__body { position: relative; display: flex; flex-wrap: wrap; gap: 32px; padding: 28px 32px 24px; background: var(--fin-hero-wash); }
.fin-hero__body::before {
  content: ''; position: absolute; inset: 8px 8px 0; pointer-events: none;
  border: 1.5px dashed var(--fin-stitch); border-bottom: 0; border-radius: 12px 12px 0 0;
}
.fin-hero__left { flex: 1.05 1 300px; align-self: center; min-width: 0; }
.fin-hero__eyebrow { display: flex; align-items: center; gap: 8px; }
.fin-hero__num { margin: 8px 0 0; font-size: 56px; font-weight: 800; color: var(--wb-blue-strong); line-height: 1; letter-spacing: -0.02em; }
.fin-hero__cents { font-size: 28px; color: rgba(42, 127, 168, 0.6); letter-spacing: 0; }
.fin-hero__perday { margin: 10px 0 0; font-size: var(--wb-fs-14); color: var(--wb-text-muted); font-weight: 600; white-space: normal; }
.fin-hero__after { margin: 6px 0 0; font-size: var(--wb-fs-13); color: var(--wb-text-subtle); font-weight: 600; white-space: normal; }
.fin-hero__status { margin-top: 12px; }
.fin-hero__advice {
  margin: 10px 0 0; max-width: 380px; font-size: var(--wb-fs-13); font-weight: 600; line-height: 1.5;
  color: var(--wb-warn); background: var(--wb-warn-bg); border-radius: var(--wb-r-lg); padding: 8px 12px;
}
.fin-hero__skel { display: grid; gap: 10px; margin-top: 10px; }
.fin-hero__pace { flex: 1 1 360px; min-width: 0; border-left: 1px solid var(--wb-hairline); padding-left: 30px; }
.fin-hero__pace-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.fin-hero__pace-sum { margin-left: auto; font-size: var(--wb-fs-13); font-weight: 700; color: var(--wb-text-muted); }
.fin-hero__pace-sum b { color: var(--wb-text); }
.fin-hero__pace-sum .is-under { color: var(--wb-success); }
.fin-hero__pace-sum .is-over { color: var(--wb-warn); }
.fin-hero__chart { position: relative; }

/* ── Pace chart ── */
.fin-pace { margin: 14px 0 0; }
.fin-pace__plot { position: relative; display: grid; gap: 4px; align-items: end; height: 96px; }
.fin-pace--tall .fin-pace__plot { height: 120px; }
.fin-pace__ghost { height: 100%; border-radius: 4px; background: var(--fin-ghost-day); border: 1px dashed var(--fin-ghost-border); }
.fin-pace__bar {
  position: relative; border-radius: 4px 4px 2px 2px; background: var(--fin-expense); outline: none;
  transform-origin: bottom; animation: fin-grow var(--wb-dur-slow) var(--wb-ease) both;
}
.fin-pace__bar.is-over { background: var(--fin-expense-dark); }
.fin-pace__bar.is-today { box-shadow: 0 0 0 2px var(--wb-surface), 0 0 0 4px var(--wb-blue-strong); }
.fin-pace__bar:focus-visible { box-shadow: 0 0 0 2px var(--wb-surface), 0 0 0 4px var(--wb-text); }
.fin-pace__bar[data-tip]:focus-visible::after { content: attr(data-tip); }
.fin-pace__bar[data-tip]::after {
  position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); z-index: 2; pointer-events: none;
  background: var(--wb-text); color: var(--wb-surface); font-size: var(--wb-fs-12); font-weight: 600;
  padding: 4px 8px; border-radius: var(--wb-r-sm); white-space: nowrap;
}
@media (hover: hover) and (pointer: fine) { .fin-pace__bar[data-tip]:hover::after { content: attr(data-tip); } }
.fin-pace__stripe {
  position: absolute; left: 0; right: 0; top: 0; border-radius: 4px 4px 0 0;
  background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.6) 0 4px, rgba(255, 255, 255, 0.12) 4px 8px);
}
.fin-pace__cap { position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); font-size: var(--wb-fs-12); font-weight: 800; color: var(--fin-expense-ink); }
.fin-pace__line { position: absolute; left: 0; right: 0; border-top: 1.5px dashed var(--wb-blue-strong); pointer-events: none; z-index: 1; }
.fin-pace__line span {
  position: absolute; right: 0; top: -20px; font-size: var(--wb-fs-12); font-weight: 800; color: var(--wb-blue-ink);
  background: rgba(255, 255, 255, 0.85); padding: 0 6px; border-radius: var(--wb-r-sm);
}
.fin-pace__line.is-old span { text-decoration: line-through; color: var(--wb-text-faint); }
.fin-pace__line.is-after { border-top-color: var(--wb-pink); }
.fin-pace__line.is-after span { right: auto; left: 30%; top: 4px; color: var(--fin-expense-ink); }
.fin-pace__axis { display: grid; gap: 4px; margin-top: 6px; font-size: var(--wb-fs-12); font-weight: 700; color: var(--wb-text-faint); }
.fin-pace__axis span { white-space: nowrap; overflow: visible; }
.fin-pace__axis .is-today { color: var(--wb-blue-ink); }
.fin-pace__empty { position: absolute; left: 0; right: 0; top: 46px; margin: 0; text-align: center; }
@keyframes fin-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }

@media (max-width: 700px) {
  .fin-hero__body { padding: 22px 20px 18px; gap: 18px; }
  .fin-hero__num { font-size: 42px; }
  .fin-hero__cents { font-size: 22px; }
  .fin-hero__pace { border-left: 0; padding-left: 0; border-top: 1px solid var(--wb-hairline); padding-top: 14px; }
  .fin-pace__axis .is-mid { visibility: hidden; }
}
```

- [ ] **Step 5: Verify**

`npx tsc --noEmit` exits 0. `node scripts/wb-style-gate.mjs src/app/finance/finance.css src/components/finance/hero/*.tsx` is clean. The hero is not mounted yet; Task 12 mounts it.

---

### Task 12: Data hook, tabs, new shell, skeletons

**Files:**
- Create: `src/components/finance/useFinanceData.ts`, `FinanceTabs.tsx`, `FinanceSkeleton.tsx`, `legacy/LegacyStyles.tsx`, `src/app/finance/loading.tsx`
- Modify (rewrite): `src/components/finance/FinanceShell.tsx`
- Modify: `src/app/finance/page.tsx`, `src/app/finance/finance.css`

**Interfaces:**
- Consumes: Tasks 5, 10, 11; legacy components (Task 9).
- Produces:
  - `useFinanceData(): FinanceData` with:
    - data: `range`, `setRange`, `summary`, `sts`, `templates: AllocTemplate[] | null`, `budgets: BudgetItem[] | null`, `remainingCycleAllowance`, `savingsProgress`, `recurringRules: RecurringRule[] | null`
    - loaders: `loadTemplates()`, `loadBudgets()`, `loadRecurringRules()`, `refreshAll()`, `refreshRecurring()`
  - `type FinanceTab = 'overview' | 'plan' | 'activity' | 'goals'` (in `types.ts`).
  - `FinanceTabs({ value, onChange, planBadge })`.
  - `FinanceSkeleton()`.
  - The `FinanceShell` layout that later tasks extend: `header` → `PaceHero(children = FinanceTabs)` → tab panel.

- [ ] **Step 1: `useFinanceData.ts`**

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  Range, SummaryResponse, SafeToSpendResponse, AllocTemplate, BudgetItem, SavingsProgress, RecurringRule,
} from './types';

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/* Every dataset the Finance shell shows. `null` means "not loaded yet" (skeleton); a failed
   load also leaves null for that section only, so one slow route never blanks the page. */
export function useFinanceData() {
  const [range, setRange] = useState<Range>('week');
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [sts, setSts] = useState<SafeToSpendResponse | null>(null);
  const [templates, setTemplates] = useState<AllocTemplate[] | null>(null);
  const [budgets, setBudgets] = useState<BudgetItem[] | null>(null);
  const [remainingCycleAllowance, setRemainingCycleAllowance] = useState<number | null>(null);
  const [savingsProgress, setSavingsProgress] = useState<SavingsProgress | null>(null);
  const [recurringRules, setRecurringRules] = useState<RecurringRule[] | null>(null);

  const loadSummary = useCallback(async (r: Range) => { const d = await getJson<SummaryResponse>(`/api/finance/summary?range=${r}`); if (d) setSummary(d); }, []);
  const loadSts = useCallback(async () => { const d = await getJson<SafeToSpendResponse>('/api/finance/safe-to-spend'); if (d) setSts(d); }, []);
  const loadTemplates = useCallback(async () => { const d = await getJson<{ templates: AllocTemplate[] }>('/api/finance/allocation-templates'); setTemplates(d?.templates ?? []); }, []);
  const loadBudgets = useCallback(async () => {
    const d = await getJson<{ budgets: BudgetItem[]; remaining_allowance: number | null; savings: SavingsProgress | null }>('/api/finance/budgets');
    setBudgets(d?.budgets ?? []);
    setRemainingCycleAllowance(d?.remaining_allowance ?? null);
    setSavingsProgress(d?.savings ?? null);
  }, []);
  const loadRecurringRules = useCallback(async () => { const d = await getJson<{ rules: RecurringRule[] }>('/api/finance/recurring-rules'); setRecurringRules(d?.rules ?? []); }, []);

  useEffect(() => { void loadSts(); void loadTemplates(); void loadBudgets(); void loadRecurringRules(); }, [loadSts, loadTemplates, loadBudgets, loadRecurringRules]);
  useEffect(() => { void loadSummary(range); }, [range, loadSummary]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSummary(range), loadSts(), loadBudgets(), loadTemplates()]);
  }, [range, loadSummary, loadSts, loadBudgets, loadTemplates]);

  const refreshRecurring = useCallback(async () => {
    await Promise.all([loadRecurringRules(), refreshAll()]);
  }, [loadRecurringRules, refreshAll]);

  return {
    range, setRange, summary, sts, templates, budgets, remainingCycleAllowance, savingsProgress, recurringRules,
    loadTemplates, loadBudgets, loadRecurringRules, refreshAll, refreshRecurring,
  };
}

export type FinanceData = ReturnType<typeof useFinanceData>;
```

- [ ] **Step 2: `FinanceTabs.tsx`**

```tsx
'use client';

import { useRef } from 'react';
import type { FinanceTab } from './types';

export const FINANCE_TABS: { key: FinanceTab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'plan', label: 'Plan' },
  { key: 'activity', label: 'Activity' }, { key: 'goals', label: 'Goals' },
];

/* WAI-ARIA tabs (spec §5.4): arrows/Home/End move and select, roving tabindex. */
export default function FinanceTabs({ value, onChange, planBadge }: { value: FinanceTab; onChange: (t: FinanceTab) => void; planBadge: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => {
    const n = (i + FINANCE_TABS.length) % FINANCE_TABS.length;
    onChange(FINANCE_TABS[n].key);
    refs.current[n]?.focus();
  };
  return (
    <div className="fin-tabs" role="tablist" aria-label="Finance sections">
      {FINANCE_TABS.map((t, i) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`fin-tab-${t.key}`}
            aria-selected={on}
            aria-controls={`fin-panel-${t.key}`}
            tabIndex={on ? 0 : -1}
            className={`fin-tabs__tab${on ? ' is-on' : ''}`}
            onClick={() => onChange(t.key)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1); }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1); }
              else if (e.key === 'Home') { e.preventDefault(); move(0); }
              else if (e.key === 'End') { e.preventDefault(); move(FINANCE_TABS.length - 1); }
            }}
          >
            {t.label}
            {t.key === 'plan' && planBadge && <span className="fin-tabs__badge">1<span className="fin-sr-only"> item needs attention</span></span>}
          </button>
        );
      })}
    </div>
  );
}
```

Add `export type FinanceTab = 'overview' | 'plan' | 'activity' | 'goals';` to `types.ts`.

- [ ] **Step 3: `FinanceSkeleton.tsx` and `loading.tsx`**

```tsx
// src/components/finance/FinanceSkeleton.tsx
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';

/* Route-level and Suspense placeholder shaped like the header, hero and first tab (spec §5.5). */
export default function FinanceSkeleton() {
  return (
    <div className="vb-bg fin-page" aria-busy="true" aria-label="Loading finances">
      <div className="fin-wrap">
        <div className="fin-header"><WbSkeleton width={220} height={28} radius={8} /></div>
        <div className="fin-hero">
          <div className="fin-hero__body">
            <div className="fin-hero__left fin-hero__skel">
              <WbSkeleton width={120} height={12} />
              <WbSkeleton width={260} height={52} radius={10} />
              <WbSkeleton width={300} height={14} />
            </div>
            <div className="fin-hero__pace"><WbSkeleton height={110} radius={8} /></div>
          </div>
          <div className="fin-tabs" aria-hidden><WbSkeleton width={300} height={20} style={{ margin: '14px 0' }} /></div>
        </div>
        <div className="fin-card">
          {[0, 1, 2, 3].map(i => <WbSkeleton key={i} height={36} radius={8} style={{ marginBottom: 10 }} />)}
        </div>
      </div>
    </div>
  );
}
```

```tsx
// src/app/finance/loading.tsx
import '../workboard/workboard.css';
import './finance.css';
import FinanceSkeleton from '@/components/finance/FinanceSkeleton';

export default function Loading() {
  return <FinanceSkeleton />;
}
```

- [ ] **Step 4: `legacy/LegacyStyles.tsx`**

Move the `<style jsx global>` block out of the old shell into its own component, so legacy panels keep working until Task 26. **Drop the `.fin-pill:hover` rule.** The header button that used it is gone, and the rule would otherwise restyle the new `.fin-pill` badges on hover.

```tsx
'use client';

/* Global classes the legacy panels still use (.fin-shell collapse, .fin-tab, .fin-add-btn,
   .fin-spin, .fin-row-remove). Deleted with the legacy folder in Task 26. */
export default function LegacyStyles() {
  return (
    <style jsx global>{`
      .fin-tab { transition: all 0.15s ease; }
      .fin-tab.active { background: linear-gradient(90deg, #f0679d, #74bcd9) !important; color: white !important; border-color: transparent !important; }
      .fin-add-btn { transition: transform 150ms ease, box-shadow 150ms ease; }
      .fin-add-btn:active { transform: scale(0.97); }
      .fin-shell { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 260ms cubic-bezier(0.23, 1, 0.32, 1); }
      .fin-shell.open { grid-template-rows: 1fr; }
      .fin-shell-inner { overflow: hidden; min-height: 0; }
      .fin-spin { animation: finSpin 0.9s linear infinite; }
      @keyframes finSpin { to { transform: rotate(360deg); } }
      .fin-row-remove { transition: background 0.15s, color 0.15s; }
      .fin-row-remove:hover { background: rgba(254,226,226,0.9) !important; color: #dc2626 !important; }
      @media (prefers-reduced-motion: reduce) {
        .fin-tab, .fin-add-btn, .fin-shell, .fin-spin { transition-duration: 1ms !important; animation: none !important; }
      }
    `}</style>
  );
}
```

(This file is legacy and exempt from the style gate; do not run the gate on `legacy/`.)

- [ ] **Step 5: Rewrite `FinanceShell.tsx`**

```tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Home } from 'lucide-react';
import { manilaToday, formatLongDate } from '@/lib/finance/dates';
import { paceSeries } from '@/lib/finance/pace';
import { useFinanceData } from './useFinanceData';
import FinanceTabs, { FINANCE_TABS } from './FinanceTabs';
import PaceHero from './hero/PaceHero';
import type { FinanceTab } from './types';
import LegacyStyles from './legacy/LegacyStyles';
import { StatRail } from './legacy/LegacyStatRail';
import { SpendingPlan } from './legacy/LegacyPlan';
import { TransactionsSection } from './legacy/LegacyTransactions';
import { GoalTracker, WhatIf } from './legacy/LegacyGoals';

const isTab = (v: string | null): v is FinanceTab => FINANCE_TABS.some(t => t.key === v);

export default function FinanceShell({ firstName }: { firstName: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab: FinanceTab = isTab(params.get('tab')) ? (params.get('tab') as FinanceTab) : 'overview';
  const setTab = useCallback((t: FinanceTab) => {
    const q = new URLSearchParams(params.toString());
    if (t === 'overview') q.delete('tab'); else q.set('tab', t);
    const qs = q.toString();
    router.replace(`/finance${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [params, router]);

  const data = useFinanceData();
  const [today] = useState(() => manilaToday());
  const { sts } = data;
  const series = useMemo(() => (sts ? paceSeries(sts, today) : null), [sts, today]);
  const days = sts?.days_until_next_allowance ?? null;
  const todayLine = [
    formatLongDate(today),
    series ? `Day ${series.dayNumber} of this cycle` : null,
    days !== null ? `${days} day${days === 1 ? '' : 's'} to next allowance` : null,
  ].filter(Boolean).join(' · ');

  const goals = data.summary?.goals ?? [];

  return (
    <div className="vb-bg fin-page">
      <LegacyStyles />
      <div className="fin-wrap">
        <header className="fin-header">
          <div>
            <h1 className="fin-header__title">{firstName}&apos;s Finances</h1>
            <p className="fin-header__today">{todayLine}</p>
          </div>
          <div className="fin-header__actions">
            <Link href="/dashboard" className="fin-btn fin-btn--ghost"><Home size={15} aria-hidden /> <span className="fin-header__lbl">Dashboard</span></Link>
          </div>
        </header>

        <PaceHero sts={sts} series={series}>
          <FinanceTabs value={tab} onChange={setTab} planBadge={false} />
        </PaceHero>

        <div role="tabpanel" id={`fin-panel-${tab}`} aria-labelledby={`fin-tab-${tab}`} key={tab} className="fin-panel">
          {tab === 'overview' && (
            <StatRail range={data.range} onRangeChange={data.setRange} totals={data.summary?.totals ?? null} previousTotals={data.summary?.previous_totals ?? null} breakdown={data.summary?.breakdown ?? null} />
          )}
          {tab === 'plan' && (
            <SpendingPlan templates={data.templates ?? []} budgets={data.budgets ?? []} savingsProgress={data.savingsProgress} remainingCycleAllowance={data.remainingCycleAllowance} accountRemaining={sts?.current_balance ?? null} onTemplatesChange={data.loadTemplates} onBudgetsChange={data.loadBudgets} />
          )}
          {tab === 'activity' && (
            <TransactionsSection sts={sts} recent={data.summary?.recent ?? []} goals={goals} templates={data.templates ?? []} onChange={data.refreshAll} recurringRules={data.recurringRules ?? []} onRecurringChange={data.refreshRecurring} />
          )}
          {tab === 'goals' && (
            <>
              <GoalTracker goals={goals} onChange={data.refreshAll} />
              <WhatIf goals={goals} onRecorded={data.refreshAll} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

If a legacy component's props are typed with `() => void` and the hook's loaders return `Promise<void>`, wrap them as `() => { void data.loadTemplates(); }`. Do not change legacy signatures.

- [ ] **Step 6: Suspense in `page.tsx`**

`useSearchParams` needs a Suspense boundary. Update the return:

```tsx
import { Suspense } from 'react';
import FinanceSkeleton from '@/components/finance/FinanceSkeleton';
// …
  return (
    <Suspense fallback={<FinanceSkeleton />}>
      <FinanceShell firstName={firstName} />
    </Suspense>
  );
```

- [ ] **Step 7: Append tab CSS**

```css
/* ── Tabs attached to the hero (spec §5.4) ── */
.fin-tabs {
  display: flex; gap: 4px; padding: 0 24px; background: rgba(255, 255, 255, 0.55); border-top: 1px solid var(--wb-hairline);
  overflow-x: auto; scrollbar-width: none;
}
.fin-tabs::-webkit-scrollbar { display: none; }
.fin-tabs__tab {
  font: inherit; font-size: var(--wb-fs-14); font-weight: 700; color: var(--wb-text-muted); background: none; border: 0;
  border-bottom: 2.5px solid transparent; padding: 13px 14px 11px; min-height: 44px; white-space: nowrap; cursor: pointer;
}
.fin-tabs__tab.is-on { color: var(--wb-text); border-bottom-color: var(--wb-pink); }
.fin-tabs__tab:focus-visible { outline: 2px solid var(--wb-blue-strong); outline-offset: -2px; }
.fin-tabs__badge { margin-left: 6px; font-size: var(--wb-fs-12); font-weight: 800; background: var(--wb-warn-bg); color: var(--wb-warn); border-radius: var(--wb-r-pill); padding: 0 7px; }
.fin-panel { animation: fin-fade var(--wb-dur-fast) var(--wb-ease); }
@keyframes fin-fade { from { opacity: 0; } to { opacity: 1; } }
@media (max-width: 700px) {
  .fin-tabs { padding: 0 8px; }
  .fin-header__lbl, .fin-header__kbd { display: none; }
}
```

- [ ] **Step 8: Verify**

- `npx tsc --noEmit` exits 0.
- The style gate is clean on `finance.css`, `FinanceShell.tsx`, `FinanceTabs.tsx`, `FinanceSkeleton.tsx`, `useFinanceData.ts` and `src/app/finance/loading.tsx`.
- Playwright:
  - `/finance` shows the new header and Pace hero with the attached tabs.
  - Each tab shows its legacy panel. `?tab=plan` loads directly on Plan. Back returns to the previous tab.
  - Arrow keys move between tabs.
  - The console is clean.

✅ **CHECKPOINT (Phase 1):** run the phase checkpoint list; screenshots of Overview at 390 / 820 / 1440 and the hero empty state if available. Wait for approval.

---

## Phase 2 — Logging (spec §7)

### Task 13: `log-context` route

**Files:**
- Create: `src/app/api/finance/log-context/route.ts`
- Modify: `src/components/finance/types.ts`, `src/components/finance/useFinanceData.ts`

**Interfaces:**
- Consumes: `topCategories`, `repeatsFrom`, `LoggedRow`, `LogRepeat` (Task 6); `manilaToday`, `addDays` (Task 2).
- Produces:
  - `GET /api/finance/log-context` → `{ top_categories: string[]; repeats: LogRepeat[] }`.
  - `LogContext` type in `types.ts`.
  - `useFinanceData()` gains `logContext: LogContext | null` and `loadLogContext()`. `refreshAll()` now also reloads it.

- [ ] **Step 1: Route**

```ts
// src/app/api/finance/log-context/route.ts
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { manilaToday, addDays } from '@/lib/finance/dates';
import { topCategories, repeatsFrom, type LoggedRow } from '@/lib/finance/logContext';

/* GET /api/finance/log-context — the composer's category chips and the drawer's
   "Log again" tiles, from the last 60 days of actual entries (spec §7.2). Read-only. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const today = manilaToday();
  const since = addDays(today, -60);

  const [expenseRows] = await pool.execute<RowDataPacket[]>(
    `SELECT category, expense_amount AS amount, entry_date FROM expenses
     WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?`,
    [userId, since, today]);
  const [savingsRows] = await pool.execute<RowDataPacket[]>(
    `SELECT s.goal_id, g.goal_name, s.savings_amount AS amount, s.entry_date
     FROM savings_entries s JOIN savings_goals g ON g.goal_id = s.goal_id
     WHERE s.user_id = ? AND s.status = 'actual' AND s.entry_date BETWEEN ? AND ?`,
    [userId, since, today]);

  const rows: LoggedRow[] = [
    ...expenseRows.map(r => ({ type: 'expense' as const, category: String(r.category), goal_id: null, goal_name: null, amount: Number(r.amount), entry_date: String(r.entry_date) })),
    ...savingsRows.map(r => ({ type: 'savings' as const, category: null, goal_id: Number(r.goal_id), goal_name: String(r.goal_name), amount: Number(r.amount), entry_date: String(r.entry_date) })),
  ];
  return Response.json({ top_categories: topCategories(rows), repeats: repeatsFrom(rows) });
}
```

- [ ] **Step 2: Type and hook**

`types.ts`:

```ts
import type { LogRepeat } from '@/lib/finance/logContext';
export interface LogContext { top_categories: string[]; repeats: LogRepeat[] }
```

`useFinanceData.ts`: add state `const [logContext, setLogContext] = useState<LogContext | null>(null);` and a loader `loadLogContext` (GET `/api/finance/log-context`, keep `null` on failure). Call it in the initial effect and inside `refreshAll`'s `Promise.all`, and return both from the hook.

- [ ] **Step 3: Verify**

`npx tsc --noEmit` → exit 0. Playwright `browser_evaluate` `() => fetch('/api/finance/log-context').then(r => r.json())`. Expected: `top_categories` has 4 entries; `repeats` is an array (possibly empty). Run `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/finance/log-context` from a shell → `401`.

---

### Task 14: Client API helpers, toaster, shared UI pieces

**Files:**
- Create: `src/components/finance/financeApi.ts`, `ui/ConfirmPopover.tsx`, `ui/Money.tsx`, `ui/PesoField.tsx`
- Modify: `src/components/finance/FinanceShell.tsx` (mount `WbToaster`), `src/app/finance/finance.css`

**Interfaces:**
- Produces:
  - `class ApiError extends Error`
  - `requestJson<T>(url, init?: { method?: string; body?: unknown; keepalive?: boolean }): Promise<T>`
  - `type TxType = 'allowance' | 'expense' | 'savings'`
  - `createTransaction(input: { type: TxType; amount: number; entry_date: string; category?: string; goal_id?: number }): Promise<{ id: number }>`
  - `deleteTransaction(type: TxType, id: number, keepalive?: boolean): Promise<unknown>`
  - `parseAmount(raw: string): number | null` (positive, finite, rounded to 2 decimals)
  - `ConfirmPopover({ open, anchor, onClose, title, body?, confirmLabel?, onConfirm })`
  - `Money({ value, tone?, signed?, className? })`
  - `PesoField({ id, label, value, onChange, placeholder?, prefix?, autoFocus?, inputRef? })`

- [ ] **Step 1: `financeApi.ts`**

```ts
// src/components/finance/financeApi.ts
/* Client fetch helpers. Every Finance write goes through requestJson so errors surface as
   ApiError with the route's own message (routes answer { error } on failure). */
export class ApiError extends Error {}

export async function requestJson<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; body?: unknown; keepalive?: boolean } = {},
): Promise<T> {
  const hasBody = init.body !== undefined;
  const res = await fetch(url, {
    method: init.method ?? (hasBody ? 'POST' : 'GET'),
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    keepalive: init.keepalive,
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty body */ }
  const message = (data as { error?: string } | null)?.error;
  if (!res.ok || message) throw new ApiError(message ?? `Request failed (${res.status})`);
  return data as T;
}

export type TxType = 'allowance' | 'expense' | 'savings';

export function createTransaction(input: { type: TxType; amount: number; entry_date: string; category?: string; goal_id?: number }) {
  return requestJson<{ id: number }>('/api/finance/transactions', { body: input });
}

export function deleteTransaction(type: TxType, id: number, keepalive = false) {
  return requestJson('/api/finance/transactions', { method: 'DELETE', body: { type, id }, keepalive });
}

export function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 2: `ui/ConfirmPopover.tsx`**

```tsx
'use client';

import { useState } from 'react';
import WbPopover from '@/components/workboard/ui/WbPopover';

/* Inline confirm for deletes that cascade server-side and can't be undone (spec §7.3):
   plans, goals, recurring rules. Replaces window.confirm. */
export default function ConfirmPopover({ open, anchor, onClose, title, body, confirmLabel = 'Delete', onConfirm }: {
  open: boolean; anchor: HTMLElement | null; onClose: () => void; title: string; body?: string; confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <WbPopover open={open} anchor={anchor} onClose={onClose} width={290} ariaLabel={title} placement="bottom-end">
      <div className="fin-confirm">
        <p className="fin-confirm__title">{title}</p>
        {body && <p className="fin-confirm__body">{body}</p>}
        {error && <p className="fin-error" role="alert">{error}</p>}
        <div className="fin-confirm__row">
          <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={onClose}>Cancel</button>
          <button type="button" className="fin-btn fin-btn--danger fin-btn--sm" disabled={busy} onClick={confirm}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </WbPopover>
  );
}
```

- [ ] **Step 3: `ui/Money.tsx` and `ui/PesoField.tsx`**

```tsx
// src/components/finance/ui/Money.tsx
import { formatPeso } from '@/lib/finance/format';

/* A peso amount in tabular numerals with its money colour. `signed` prefixes + for income
   and − for spending; savings show unsigned (they move money, not lose it). */
export default function Money({ value, tone, signed = false, className = '' }: {
  value: number; tone?: 'in' | 'out' | 'save'; signed?: boolean; className?: string;
}) {
  const prefix = signed && tone === 'in' ? '+' : signed && tone === 'out' ? '−' : '';
  return <span className={`fin-num${tone ? ` fin-amount--${tone}` : ''}${className ? ` ${className}` : ''}`}>{prefix}{formatPeso(Math.abs(value))}</span>;
}
```

```tsx
// src/components/finance/ui/PesoField.tsx
'use client';

import type { RefObject } from 'react';

/* Labelled amount input with a ₱ (or %) prefix; decimal keypad on phones, 16px on phones
   so iOS never zooms (spec §7.1). */
export default function PesoField({ id, label, value, onChange, placeholder = '0.00', prefix = '₱', autoFocus, inputRef, error }: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; prefix?: string;
  autoFocus?: boolean; inputRef?: RefObject<HTMLInputElement | null>; error?: string;
}) {
  return (
    <div>
      <label className="fin-field-label" htmlFor={id}>{label}</label>
      <div className="fin-field">
        <span className="fin-field__prefix" aria-hidden>{prefix}</span>
        <input
          id={id} ref={inputRef} inputMode="decimal" autoComplete="off" placeholder={placeholder} value={value}
          autoFocus={autoFocus} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined}
          onChange={e => onChange(e.target.value)}
        />
      </div>
      {error && <p className="fin-error" id={`${id}-err`} role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Mount the toaster**

In `FinanceShell.tsx` import `WbToaster from '@/components/workboard/ui/WbToaster'` and render `<WbToaster raised />` as the last child of `.fin-page`. `raised` lifts phone toasts above the docked composer: Sonner reads `--wb-bulkbar-h`, which `finance.css` sets on `.fin-page` (next step).

- [ ] **Step 5: Append CSS**

```css
.fin-page { --wb-bulkbar-h: 104px; }
.fin-btn--danger { background: var(--wb-danger); color: var(--wb-surface); }
.fin-confirm { padding: 14px; }
.fin-confirm__title { margin: 0; font-weight: 800; font-size: var(--wb-fs-14); }
.fin-confirm__body { margin: 6px 0 0; font-size: var(--wb-fs-13); color: var(--wb-text-muted); font-weight: 600; line-height: 1.45; }
.fin-confirm__row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
@media (max-width: 700px) { .fin-field input { font-size: 16px; } }
```

- [ ] **Step 6: Verify**

`npx tsc --noEmit` exits 0, and the style gate is clean on the new files plus `finance.css`. There's no visible change yet.

---

### Task 15: Log composer (inline + phone dock)

**Files:**
- Create: `src/components/finance/log/LogComposer.tsx`, `log/DateChoice.tsx`
- Modify: `src/components/finance/FinanceShell.tsx`, `src/app/finance/finance.css`

**Interfaces:**
- Consumes: `previewSpend`, `SpendSnapshot` (Task 3); `categoryLabel`, `categoryEmoji`, `EXPENSE_CATEGORIES` (Task 2); `formatPeso`, `formatDay`; `parseAmount`, `createTransaction`, `deleteTransaction` (Task 14); `toastUndo`, `toastError` from `WbToaster`; `WbPopover`.
- Produces:
  - `LogComposer({ variant, snapshot, topCategories, initialCategory, today, onLog, onMore, inputRef? })`, where `onLog(draft: { amount: number; category: string; date: string }): Promise<void>` throws on failure and `onMore(draft: { amount: string; category: string })`.
  - `DateChoice({ value, onChange, today })`.
  - In the shell: `logExpense(draft)`, `lastCategory` (persisted in `localStorage['fin:lastCategory']`), and `composerRef`.

- [ ] **Step 1: `DateChoice.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import WbPopover from '@/components/workboard/ui/WbPopover';
import { addDays, formatDay } from '@/lib/finance/dates';

/* "Today ▾" chip in the composer: Today / Yesterday / a picked date. A future date is fine;
   the server files it under Upcoming (spec §7.2). */
export default function DateChoice({ value, onChange, today }: { value: string; onChange: (d: string) => void; today: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pick = (d: string) => { onChange(d); setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button ref={btn} type="button" className="fin-chip is-on-blue" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {formatDay(value, today)} ▾
      </button>
      <WbPopover open={open} anchor={btn.current} onClose={() => setOpen(false)} width={220} ariaLabel="When did this happen?">
        <div className="fin-datechoice">
          <button type="button" className="fin-datechoice__opt" onClick={() => pick(today)}>Today</button>
          <button type="button" className="fin-datechoice__opt" onClick={() => pick(addDays(today, -1))}>Yesterday</button>
          <label className="fin-field-label" htmlFor="fin-date-pick">Pick a date</label>
          <div className="fin-field"><input id="fin-date-pick" type="date" value={value} onChange={e => e.target.value && pick(e.target.value)} /></div>
        </div>
      </WbPopover>
    </>
  );
}
```

- [ ] **Step 2: `LogComposer.tsx`**

```tsx
'use client';

import { useState, type FormEvent, type RefObject } from 'react';
import { ArrowUp, MoreHorizontal } from 'lucide-react';
import { previewSpend, type SpendSnapshot } from '@/lib/finance/verdict';
import { EXPENSE_CATEGORIES, categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import { formatPeso } from '@/lib/finance/format';
import { parseAmount } from '../financeApi';
import DateChoice from './DateChoice';

export interface ComposerDraft { amount: number; category: string; date: string }

/* The always-open composer (spec §7.1). Expense only; everything else goes through the
   drawer via "⋯". `inline` sits under the tabs on Overview/Activity (desktop); `dock` is the
   phone version fixed to the bottom (rendered by the shell through a portal). */
export default function LogComposer({ variant, snapshot, topCategories, initialCategory, today, onLog, onMore, inputRef }: {
  variant: 'inline' | 'dock';
  snapshot: SpendSnapshot | null;
  topCategories: string[];
  initialCategory: string;
  today: string;
  onLog: (draft: ComposerDraft) => Promise<void>;
  onMore: (draft: { amount: string; category: string }) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [raw, setRaw] = useState('');
  const [category, setCategory] = useState(initialCategory);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const amount = parseAmount(raw);
  const impact = amount && snapshot ? previewSpend(snapshot, amount).after : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!amount) { setError('Enter an amount greater than 0.'); return; }
    setBusy(true);
    setError('');
    try {
      await onLog({ amount, category, date });
      setRaw('');
      setDate(today);
      inputRef?.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const chips = (
    <div className="fin-composer__chips" role="group" aria-label="Category">
      {topCategories.map(c => (
        <button key={c} type="button" className={`fin-chip${c === category ? ' is-on' : ''}`} aria-pressed={c === category} onClick={() => setCategory(c)}>
          <span aria-hidden>{categoryEmoji(c)}</span> {categoryLabel(c)}
        </button>
      ))}
      <select
        className={`fin-chip fin-chip--select${topCategories.includes(category) ? '' : ' is-on'}`}
        aria-label="All categories"
        value={topCategories.includes(category) ? '' : category}
        onChange={e => e.target.value && setCategory(e.target.value)}
      >
        <option value="" disabled>{topCategories.includes(category) ? 'More ▾' : categoryLabel(category)}</option>
        {EXPENSE_CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </div>
  );
  const more = (
    <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm fin-composer__more" aria-label="More options" onClick={() => onMore({ amount: raw, category })}>
      <MoreHorizontal size={16} aria-hidden />
    </button>
  );

  return (
    <form className={`fin-composer fin-composer--${variant}`} onSubmit={submit} aria-label="Log an expense" noValidate>
      {variant === 'dock' && chips}
      <div className="fin-composer__row">
        {variant === 'dock' && more}
        <label className="fin-composer__amount">
          <span className="fin-composer__peso" aria-hidden>₱</span>
          <input
            ref={inputRef} inputMode="decimal" autoComplete="off" placeholder="0.00" aria-label="Amount" value={raw}
            onChange={e => { setRaw(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Escape') setRaw(''); }}
          />
        </label>
        {variant === 'inline' && (
          <>
            <span className="fin-composer__sep" aria-hidden />
            {chips}
            <span className="fin-composer__sep" aria-hidden />
            <DateChoice value={date} onChange={setDate} today={today} />
            {more}
          </>
        )}
        <button type="submit" className="fin-btn fin-btn--primary fin-composer__send" disabled={!amount || busy} aria-label={variant === 'dock' ? 'Log expense' : undefined}>
          {variant === 'dock' ? <ArrowUp size={18} aria-hidden /> : <>Log <span className="fin-kbd">↵</span></>}
        </button>
      </div>
      {variant === 'inline' && (
        <div className="fin-composer__under fin-num" aria-live="polite">
          <span>{impact ? `Leaves ${formatPeso(impact.safe)} safe · ${formatPeso(impact.perDay)}/day` : 'Type an amount to log an expense'}</span>
          <span className="fin-push">Ctrl K jumps here</span>
        </div>
      )}
      {error && <p className="fin-error" role="alert">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Wire it into the shell**

In `FinanceShell.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { toastUndo } from '@/components/workboard/ui/WbToaster';
import { formatPeso } from '@/lib/finance/format';
import { categoryLabel } from '@/lib/finance/categories';
import LogComposer, { type ComposerDraft } from './log/LogComposer';
import { createTransaction, deleteTransaction } from './financeApi';

// inside the component:
  const composerRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [lastCategory, setLastCategory] = useState('food');
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => {
    try { const saved = window.localStorage.getItem('fin:lastCategory'); if (saved) setLastCategory(saved); } catch { /* storage blocked */ }
    setPrefsLoaded(true);
  }, []);

  const logExpense = useCallback(async (draft: ComposerDraft) => {
    const { id } = await createTransaction({ type: 'expense', amount: draft.amount, entry_date: draft.date, category: draft.category });
    setLastCategory(draft.category);
    try { window.localStorage.setItem('fin:lastCategory', draft.category); } catch { /* storage blocked */ }
    void data.refreshAll();
    toastUndo(`Logged ${formatPeso(draft.amount)} · ${categoryLabel(draft.category)}`, async () => {
      await deleteTransaction('expense', id);
      void data.refreshAll();
    });
  }, [data]);

  const composerProps = {
    snapshot: sts,
    topCategories: data.logContext?.top_categories ?? ['food', 'transportation', 'academic', 'grocery'],
    initialCategory: lastCategory,
    today,
    onLog: logExpense,
    onMore: () => { /* Task 16 opens the drawer */ },
  };
```

Render the inline composer between `</PaceHero>` and the tab panel, only on Overview and Activity:

```tsx
        {(tab === 'overview' || tab === 'activity') && (
          <div className="fin-composer-slot"><LogComposer key={prefsLoaded ? 'ready' : 'init'} variant="inline" inputRef={composerRef} {...composerProps} /></div>
        )}
```

Render the dock as a portal (fixed elements must not sit inside a `backdrop-filter` ancestor), just before `<WbToaster>`:

```tsx
      {mounted && createPortal(<div className="fin-dock"><LogComposer key={prefsLoaded ? 'ready' : 'init'} variant="dock" {...composerProps} /></div>, document.body)}
```

The `key` remounts each composer exactly once, when the stored category has loaded, so its default category is right. Never key on `lastCategory` itself: that would remount (and drop focus) after every log in a new category.

- [ ] **Step 4: Append CSS**

```css
/* ── Composer (spec §7.1) ── */
.fin-composer-slot { margin-bottom: 14px; }
.fin-composer { display: block; }
.fin-composer__row {
  display: flex; align-items: center; gap: 8px; background: var(--wb-surface); border: 1px solid var(--wb-hairline);
  border-radius: var(--wb-r-xl); padding: 8px; box-shadow: var(--wb-shadow-pop);
}
.fin-composer__amount { display: flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: var(--wb-r-lg); background: var(--fin-expense-bg); min-width: 130px; }
.fin-composer__peso { color: var(--wb-text-faint); font-size: var(--wb-fs-16); font-weight: 800; }
.fin-composer__amount input { border: 0; outline: none; background: transparent; font: inherit; font-size: var(--wb-fs-20); font-weight: 800; width: 100px; color: var(--wb-text); font-variant-numeric: tabular-nums; }
.fin-composer__amount:focus-within { box-shadow: 0 0 0 2px var(--wb-blue-strong); }
.fin-composer__sep { width: 1px; height: 28px; background: var(--wb-hairline); flex: none; }
.fin-composer__chips { display: flex; gap: 6px; overflow-x: auto; flex: 1; min-width: 0; scrollbar-width: none; }
.fin-composer__chips::-webkit-scrollbar { display: none; }
.fin-chip--select { appearance: none; -webkit-appearance: none; padding-right: 12px; }
.fin-composer__under { display: flex; gap: 14px; font-size: var(--wb-fs-12); color: var(--wb-text-faint); font-weight: 600; padding: 8px 6px 0; white-space: normal; }
.fin-datechoice { display: grid; gap: 4px; padding: 10px; }
.fin-datechoice__opt { font: inherit; text-align: left; font-size: var(--wb-fs-13); font-weight: 700; border: 0; background: none; padding: 8px 10px; border-radius: var(--wb-r-md); cursor: pointer; color: var(--wb-text); }
@media (hover: hover) and (pointer: fine) { .fin-datechoice__opt:hover { background: var(--wb-hover); } }

.fin-dock { display: none; }
@media (max-width: 700px) {
  .fin-composer-slot { display: none; }
  .fin-dock {
    display: block; position: fixed; left: 0; right: 0; bottom: 0; z-index: 35;
    background: rgba(255, 255, 255, 0.97); border-top: 1px solid var(--wb-hairline);
    padding: 10px 12px calc(14px + env(safe-area-inset-bottom));
  }
  .fin-composer--dock .fin-composer__chips { margin-bottom: 8px; }
  .fin-composer--dock .fin-composer__row { box-shadow: none; border: 0; padding: 0; background: transparent; }
  .fin-composer--dock .fin-composer__amount { flex: 1; min-width: 0; background: rgba(45, 55, 72, 0.05); padding: 8px 12px; }
  .fin-composer--dock .fin-composer__amount input { font-size: 16px; width: 100%; }
  .fin-composer--dock .fin-composer__send { width: 44px; height: 44px; padding: 0; justify-content: center; }
  .fin-composer--dock .fin-composer__more { width: 44px; height: 44px; justify-content: center; }
}
```

- [ ] **Step 5: Verify**

- `npx tsc --noEmit` exits 0, and the style gate is clean on the touched files.
- Playwright at 1440:
  - On Overview, type `85` in the composer. The under-line reads "Leaves ₱… safe".
  - Press Enter. A toast "Logged ₱85.00 · Food" appears with Undo, and the hero number counts down.
  - Click Undo. The number returns.
- At 390: the dock shows at the bottom on every tab, the inline composer is hidden, and the page has no horizontal scroll.

---

### Task 16: Log drawer, "Log again", Ctrl+K

**Files:**
- Create: `src/components/finance/log/LogDrawer.tsx`
- Modify: `src/components/finance/FinanceShell.tsx`, `src/app/finance/finance.css`

**Interfaces:**
- Consumes: `WbOverlay`, `usePresence` (`@/components/workboard/ui/WbOverlay`); `DUR`; `requestJson`, `createTransaction`, `parseAmount`, `TxType` (Task 14); `PesoField`; `previewSpend`; `EXPENSE_CATEGORIES`, `categoryLabel`, `categoryEmoji`; `addDays`; `LogRepeat`; `GoalProjection`, `AllocTemplate` (types.ts).
- Produces:
  - `interface DrawerPrefill { type?: TxType; amount?: string; category?: string; goalId?: number }`
  - `interface LoggedResult { type: TxType; id: number; amount: number; label: string; planApplied: boolean; planError?: string }`
  - `LogDrawer({ open, instant, prefill, onClose, today, snapshot, goals, templates, repeats, onLogged, onRecurringSaved })`
  - In the shell: `openDrawer(prefill?: DrawerPrefill, instant?: boolean)`, the header **+ Log** button, and the Ctrl+K handler.

- [ ] **Step 1: `LogDrawer.tsx`**

```tsx
'use client';

import { useMemo, useRef, useState } from 'react';
import { X, Repeat } from 'lucide-react';
import WbOverlay from '@/components/workboard/ui/WbOverlay';
import WbSegmented from '@/components/workboard/ui/WbSegmented';
import { EXPENSE_CATEGORIES, categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import { addDays } from '@/lib/finance/dates';
import { formatPeso } from '@/lib/finance/format';
import { previewSpend, type SpendSnapshot } from '@/lib/finance/verdict';
import type { LogRepeat } from '@/lib/finance/logContext';
import { createTransaction, parseAmount, requestJson, type TxType } from '../financeApi';
import PesoField from '../ui/PesoField';
import type { AllocTemplate, GoalProjection } from '../types';

export interface DrawerPrefill { type?: TxType; amount?: string; category?: string; goalId?: number }
export interface LoggedResult { type: TxType; id: number; amount: number; label: string; planApplied: boolean; planError?: string }

type When = 'today' | 'yesterday' | 'pick';

/* The full log form (spec §7.2): "Log again" tiles, then expense / savings / allowance with
   goals, plan split and repeat. Submission logic is the old Transactions form's handleAdd
   (financetracker-log.md §20), unchanged in behaviour. */
export default function LogDrawer({ open, instant, prefill, onClose, today, snapshot, goals, templates, repeats, onLogged, onRecurringSaved }: {
  open: boolean; instant: boolean; prefill: DrawerPrefill; onClose: () => void; today: string;
  snapshot: SpendSnapshot | null; goals: GoalProjection[]; templates: AllocTemplate[]; repeats: LogRepeat[];
  onLogged: (r: LoggedResult) => void; onRecurringSaved: () => void;
}) {
  const amountRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<TxType>(prefill.type ?? 'expense');
  const [raw, setRaw] = useState(prefill.amount ?? '');
  const [category, setCategory] = useState(prefill.category ?? 'food');
  const [goalMode, setGoalMode] = useState<'existing' | 'new'>(goals.length ? 'existing' : 'new');
  const [goalId, setGoalId] = useState<number | null>(prefill.goalId ?? goals[0]?.goal_id ?? null);
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const activePlan = templates.find(t => t.is_default) ?? null;
  const [split, setSplit] = useState(true);
  const [when, setWhen] = useState<When>('today');
  const [pickDate, setPickDate] = useState(today);
  const [repeat, setRepeat] = useState(false);
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const amount = parseAmount(raw);
  const date = when === 'today' ? today : when === 'yesterday' ? addDays(today, -1) : pickDate;
  const willApplyPlan = type === 'allowance' && !repeat && !!activePlan && split;
  const planHasSavings = activePlan?.items.some(i => i.category === 'savings') ?? false;
  const needsGoal = type === 'savings' || (willApplyPlan && planHasSavings);
  const canRepeat = !(type === 'allowance' && willApplyPlan);
  const impact = amount && snapshot && type !== 'allowance' ? previewSpend(snapshot, amount).after : null;
  const goalName = useMemo(() => goals.find(g => g.goal_id === goalId)?.goal_name ?? newGoalName, [goals, goalId, newGoalName]);

  const logRepeat = async (r: LogRepeat) => {
    setBusy(true);
    setError('');
    try {
      const { id } = await createTransaction({ type: r.type, amount: r.amount, entry_date: today, category: r.category ?? undefined, goal_id: r.goal_id ?? undefined });
      onLogged({ type: r.type, id, amount: r.amount, label: r.type === 'expense' ? categoryLabel(r.category ?? '') : (r.goal_name ?? 'Savings'), planApplied: false });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError('');
    if (!amount) { setError('Enter an amount greater than 0.'); amountRef.current?.focus(); return; }
    if (when === 'pick' && !pickDate) { setError('Pick a date.'); return; }
    setBusy(true);
    try {
      let effectiveGoalId = goalId;
      if (needsGoal && goalMode === 'new') {
        const target = parseAmount(newGoalTarget);
        if (!newGoalName.trim()) { setError('Enter a name for the new goal.'); return; }
        if (!target) { setError('Enter a target amount for the new goal.'); return; }
        const g = await requestJson<{ goal_id: number }>('/api/finance/goals', { body: { goal_name: newGoalName.trim(), wishlist_amount: target } });
        effectiveGoalId = g.goal_id;
      } else if (needsGoal && !effectiveGoalId) {
        setError('Pick a goal, or choose "+ New goal".');
        return;
      }

      if (repeat && canRepeat) {
        await requestJson('/api/finance/recurring-rules', {
          body: { action: 'save', type, category: type === 'expense' ? category : undefined, goal_id: type === 'savings' ? effectiveGoalId : undefined, amount, frequency, start_date: date, end_date: endDate || undefined },
        });
        onRecurringSaved();
        onClose();
        return;
      }

      const { id } = await createTransaction({
        type, amount, entry_date: date,
        category: type === 'expense' ? category : undefined,
        goal_id: type === 'savings' ? (effectiveGoalId ?? undefined) : undefined,
      });
      let planError: string | undefined;
      if (willApplyPlan && activePlan) {
        try {
          await requestJson('/api/finance/apply-allocation', {
            body: { template_id: activePlan.template_id, amount, entry_date: date, goal_id: planHasSavings ? effectiveGoalId : undefined },
          });
        } catch (e) {
          planError = e instanceof Error ? e.message : 'Unknown error';
        }
      }
      const label = type === 'expense' ? categoryLabel(category) : type === 'savings' ? goalName || 'Savings' : 'Allowance';
      onLogged({ type, id, amount, label, planApplied: willApplyPlan && !planError, planError });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <WbOverlay open={open} onClose={onClose} variant="drawer" labelledBy="fin-log-title" instant={instant} initialFocusRef={amountRef} panelStyle={{ width: 'min(400px, 100vw)' }}>
      <form className="fin-drawer" onSubmit={e => { e.preventDefault(); void submit(); }}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }}>
        <div className="fin-drawer__head">
          <h2 id="fin-log-title" className="fin-drawer__title">Log</h2>
          <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm fin-push" onClick={onClose} aria-label="Close"><X size={16} aria-hidden /></button>
        </div>

        {repeats.length > 0 && (
          <section aria-labelledby="fin-again">
            <p id="fin-again" className="fin-field-label">Log again · one tap, dated today</p>
            <div className="fin-again">
              {repeats.map(r => (
                <button key={`${r.type}-${r.category ?? r.goal_id}-${r.amount}`} type="button" className="fin-again__tile" disabled={busy} onClick={() => logRepeat(r)}>
                  <span className={`fin-ico${r.type === 'savings' ? ' fin-ico--save' : ' fin-ico--out'}`} aria-hidden>{r.type === 'savings' ? '◎' : categoryEmoji(r.category ?? '')}</span>
                  <span className="fin-again__text">
                    <span className="fin-again__name">{r.type === 'savings' ? r.goal_name : categoryLabel(r.category ?? '')}</span>
                    <span className="fin-again__amt fin-num">{formatPeso(r.amount)}</span>
                  </span>
                  <span className={`fin-again__go${r.type === 'savings' ? ' is-save' : ''}`} aria-hidden>＋</span>
                </button>
              ))}
            </div>
            <div className="fin-drawer__or"><span>or something new</span></div>
          </section>
        )}

        <p className="fin-field-label">Type</p>
        <WbSegmented<TxType>
          ariaLabel="Type" idPrefix="fin-log-type" value={type} onChange={setType}
          options={[{ key: 'expense', label: 'Expense' }, { key: 'savings', label: 'Savings' }, { key: 'allowance', label: 'Allowance' }]}
        />

        <PesoField id="fin-log-amount" label="Amount" value={raw} onChange={setRaw} inputRef={amountRef} />

        {type === 'expense' && (
          <>
            <p className="fin-field-label">Category</p>
            <div className="fin-chips" role="group" aria-label="Category">
              {EXPENSE_CATEGORIES.map(([key, label, emoji]) => (
                <button key={key} type="button" className={`fin-chip${key === category ? ' is-on' : ''}`} aria-pressed={key === category} onClick={() => setCategory(key)}>
                  <span aria-hidden>{emoji}</span> {label}
                </button>
              ))}
            </div>
          </>
        )}

        {type === 'allowance' && activePlan && (
          <>
            <p className="fin-field-label">Spending plan</p>
            <div className="fin-chips" role="group" aria-label="Spending plan">
              <button type="button" className={`fin-chip${split ? ' is-on-blue' : ''}`} aria-pressed={split} onClick={() => setSplit(true)}>Split with “{activePlan.name}”</button>
              <button type="button" className={`fin-chip${!split ? ' is-on-blue' : ''}`} aria-pressed={!split} onClick={() => setSplit(false)}>Don&apos;t split</button>
            </div>
          </>
        )}

        {needsGoal && (
          <>
            <p className="fin-field-label">{type === 'savings' ? 'Goal' : 'Goal for the plan’s savings share'}</p>
            <div className="fin-chips" role="group" aria-label="Goal">
              {goals.map(g => (
                <button key={g.goal_id} type="button" className={`fin-chip${goalMode === 'existing' && goalId === g.goal_id ? ' is-on-purple' : ''}`}
                  aria-pressed={goalMode === 'existing' && goalId === g.goal_id} onClick={() => { setGoalMode('existing'); setGoalId(g.goal_id); }}>
                  ◎ {g.goal_name}
                </button>
              ))}
              <button type="button" className={`fin-chip${goalMode === 'new' ? ' is-on-purple' : ''}`} aria-pressed={goalMode === 'new'} onClick={() => setGoalMode('new')}>＋ New goal</button>
            </div>
            {goalMode === 'new' && (
              <div className="fin-drawer__pair">
                <div>
                  <label className="fin-field-label" htmlFor="fin-new-goal-name">Goal name</label>
                  <div className="fin-field"><input id="fin-new-goal-name" value={newGoalName} onChange={e => setNewGoalName(e.target.value)} placeholder="e.g. New laptop" /></div>
                </div>
                <PesoField id="fin-new-goal-target" label="Target" value={newGoalTarget} onChange={setNewGoalTarget} />
              </div>
            )}
          </>
        )}

        <p className="fin-field-label">When</p>
        <div className="fin-chips" role="group" aria-label="When">
          {(['today', 'yesterday', 'pick'] as const).map(w => (
            <button key={w} type="button" className={`fin-chip${when === w ? ' is-on-blue' : ''}`} aria-pressed={when === w} onClick={() => setWhen(w)}>
              {w === 'today' ? 'Today' : w === 'yesterday' ? 'Yesterday' : 'Pick…'}
            </button>
          ))}
          {canRepeat && (
            <button type="button" className={`fin-chip${repeat ? ' is-on-blue' : ''}`} aria-pressed={repeat} onClick={() => setRepeat(r => !r)}>
              <Repeat size={13} aria-hidden /> Repeat
            </button>
          )}
        </div>
        {when === 'pick' && (
          <div className="fin-field" style={{ marginTop: 8 }}><input type="date" aria-label="Date" value={pickDate} onChange={e => setPickDate(e.target.value)} /></div>
        )}
        {repeat && canRepeat && (
          <div className="fin-drawer__pair">
            <div>
              <label className="fin-field-label" htmlFor="fin-freq">Frequency</label>
              <div className="fin-field">
                <select id="fin-freq" value={frequency} onChange={e => setFrequency(e.target.value as typeof frequency)}>
                  <option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
            <div>
              <label className="fin-field-label" htmlFor="fin-end">Ends (optional)</label>
              <div className="fin-field"><input id="fin-end" type="date" value={endDate} min={date} onChange={e => setEndDate(e.target.value)} /></div>
            </div>
          </div>
        )}

        <p className="fin-hint fin-drawer__impact fin-num" aria-live="polite">
          {impact
            ? `Leaves ${formatPeso(impact.safe)} safe · ${formatPeso(impact.perDay)}/day`
            : willApplyPlan ? `Splits this across “${activePlan?.name}” and sets this cycle's envelopes.` : 'Future dates go to Upcoming automatically.'}
        </p>
        {error && <p className="fin-error" role="alert">{error}</p>}
        <button type="submit" className="fin-btn fin-btn--primary fin-btn--block" disabled={busy}>
          {busy ? 'Saving…' : repeat && canRepeat ? 'Save repeating entry' : amount ? `Log ${formatPeso(amount)}${type === 'allowance' ? ' allowance' : ''}` : 'Log'}
        </button>
      </form>
    </WbOverlay>
  );
}
```

- [ ] **Step 2: Shell wiring**

```tsx
import WbOverlay, { usePresence } from '@/components/workboard/ui/WbOverlay';  // only usePresence is needed here
import { DUR } from '@/lib/workboard/ui/tokens';
import { toastError, toastInfo, toastUndo } from '@/components/workboard/ui/WbToaster';
import LogDrawer, { type DrawerPrefill, type LoggedResult } from './log/LogDrawer';

// inside the component:
  const [drawer, setDrawer] = useState<{ prefill: DrawerPrefill; instant: boolean } | null>(null);
  const drawerPresence = usePresence(drawer, DUR.slow);
  const openDrawer = useCallback((prefill: DrawerPrefill = {}, instant = false) => setDrawer({ prefill, instant }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const el = composerRef.current;
        if (el && el.offsetParent !== null) el.focus();
        else openDrawer({}, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDrawer]);

  const onLogged = useCallback((r: LoggedResult) => {
    void data.refreshAll();
    if (r.planError) { toastError(`Allowance saved, but the plan couldn't be applied: ${r.planError}`); return; }
    if (r.planApplied) { toastInfo(`Logged ${formatPeso(r.amount)} allowance · split with your plan`); return; }
    toastUndo(`Logged ${formatPeso(r.amount)} · ${r.label}`, async () => {
      await deleteTransaction(r.type, r.id);
      void data.refreshAll();
    });
  }, [data]);
```

Replace the composer's `onMore` with `onMore: d => openDrawer({ type: 'expense', amount: d.amount, category: d.category })`.

Add the header button after the Dashboard link:

```tsx
            <button type="button" className="fin-btn fin-btn--primary" onClick={() => openDrawer()}>＋ Log <span className="fin-kbd fin-header__kbd">Ctrl K</span></button>
```

Render the drawer before the dock portal. `key` resets the form state for each opening:

```tsx
      {drawerPresence.value && (
        <LogDrawer
          key={JSON.stringify(drawerPresence.value.prefill)}
          open={drawerPresence.open}
          instant={drawerPresence.value.instant}
          prefill={drawerPresence.value.prefill}
          onClose={() => setDrawer(null)}
          today={today}
          snapshot={sts}
          goals={goals}
          templates={data.templates ?? []}
          repeats={data.logContext?.repeats ?? []}
          onLogged={onLogged}
          onRecurringSaved={() => { void data.refreshRecurring(); toastInfo('Repeating entry saved'); }}
        />
      )}
```

Remove the unused `WbOverlay` default import if `tsc`/lint flags it; keep only `usePresence`.

- [ ] **Step 3: Append CSS**

```css
/* ── Drawer (spec §7.2) ── */
.fin-drawer { padding: 20px; }
.fin-drawer__head { display: flex; align-items: center; margin-bottom: 6px; }
.fin-drawer__title { margin: 0; font-family: 'DM Sans', sans-serif; font-size: var(--wb-fs-20); font-weight: 800; }
.fin-again { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.fin-again__tile {
  font: inherit; display: flex; align-items: center; gap: 10px; text-align: left; padding: 10px 12px; cursor: pointer;
  background: var(--wb-surface); border: 1px solid var(--wb-hairline); border-radius: var(--wb-r-xl);
  transition: transform var(--wb-dur-fast) var(--wb-ease);
}
.fin-again__tile:active:not(:disabled) { transform: scale(0.97); }
.fin-again__tile:focus-visible { outline: 2px solid var(--wb-blue-strong); outline-offset: 2px; }
.fin-again__text { display: grid; min-width: 0; }
.fin-again__name { font-size: var(--wb-fs-13); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fin-again__amt { font-size: var(--wb-fs-12); color: var(--wb-text-subtle); font-weight: 600; }
.fin-again__go { margin-left: auto; font-size: var(--wb-fs-12); font-weight: 800; color: var(--fin-expense-ink); background: var(--fin-expense-bg); border-radius: var(--wb-r-sm); padding: 2px 6px; }
.fin-again__go.is-save { color: var(--fin-savings-ink); background: var(--fin-savings-bg); }
.fin-drawer__or { display: flex; align-items: center; gap: 10px; margin: 18px 0 0; font-size: var(--wb-fs-12); color: var(--wb-text-faint); font-weight: 600; }
.fin-drawer__or::before, .fin-drawer__or::after { content: ''; flex: 1; height: 1px; background: var(--wb-hairline); }
.fin-drawer__pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.fin-drawer__impact { margin: 12px 0 0; white-space: normal; }
.fin-drawer .fin-btn--block { margin-top: 16px; }
.fin-ico { width: 32px; height: 32px; border-radius: var(--wb-r-lg); display: grid; place-items: center; font-size: var(--wb-fs-14); flex: none; }
.fin-ico--out { background: var(--fin-expense-bg); }
.fin-ico--save { background: var(--fin-savings-bg); color: var(--fin-savings-ink); }
.fin-ico--in { background: var(--fin-income-bg); color: var(--fin-income-ink); }
```

- [ ] **Step 4: Verify**

- `npx tsc --noEmit` exits 0, and the style gate is clean.
- Playwright at 1440, each of these:
  - **+ Log** opens the drawer from the right and focus lands on Amount.
  - Esc closes it and focus returns to **+ Log**.
  - Ctrl+K on Plan opens the drawer with no animation. Ctrl+K on Overview focuses the composer.
  - Composer "⋯" carries the typed amount into the drawer.
  - Log an expense via the drawer (toast + Undo).
  - Log an allowance with "Split with …" (info toast, envelopes update after Task 21; for now check that the legacy Plan tab's Budget Progress changes).
  - Log a repeating weekly expense: it appears in the legacy Activity tab's recurring list, and the Upcoming dates are 7 days apart (proves Task 7's fix).
  - A "Log again" tile, if any exist, logs with one click.
- At 390: the drawer opens as a bottom sheet.

✅ **CHECKPOINT (Phase 2):** run the phase checkpoint list. Screenshots: composer (1440), drawer (1440 + 390 sheet), a toast. Wait for approval.

---
## Phase 3 — Feed and Overview (spec §6, §9.2)

### Task 17: `feed` route

**Files:**
- Create: `src/app/api/finance/feed/route.ts`
- Modify: `src/components/finance/types.ts`

**Interfaces:**
- Consumes: `manilaToday`, `mondayOf`, `addDays`, `startOfMonth`, `endOfMonth` (Task 2); `FeedItem` (Task 6).
- Produces:
  - `GET /api/finance/feed?type=all|expense|allowance|savings&period=week|month|all&limit=50&offset=0` → `{ items: FeedItem[]; has_more: boolean }`. Actual rows only, newest first (`entry_date DESC, id DESC`). `label` is the raw category key for expenses, the goal name for savings, and `'Allowance'` for allowance. `recurring` is true when `recurring_rule_id` is set.
  - `FeedResponse` type in `types.ts`.

- [ ] **Step 1: Route**

```ts
// src/app/api/finance/feed/route.ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { manilaToday, mondayOf, addDays, startOfMonth, endOfMonth } from '@/lib/finance/dates';

const TYPES = ['all', 'expense', 'allowance', 'savings'] as const;
const PERIODS = ['week', 'month', 'all'] as const;

function periodRange(period: typeof PERIODS[number], today: string) {
  if (period === 'week') { const start = mondayOf(today); return { start, end: addDays(start, 6) }; }
  if (period === 'month') return { start: startOfMonth(today), end: endOfMonth(today) };
  return { start: '2000-01-01', end: today };
}

/* GET /api/finance/feed — the Activity feed and Overview's Recent (spec §9.2, plan ruling R1).
   Read-only, paged, actual rows only. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);

  const sp = req.nextUrl.searchParams;
  const type = (TYPES as readonly string[]).includes(sp.get('type') ?? '') ? sp.get('type') as typeof TYPES[number] : 'all';
  const period = (PERIODS as readonly string[]).includes(sp.get('period') ?? '') ? sp.get('period') as typeof PERIODS[number] : 'all';
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50') || 50));
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0') || 0);
  const { start, end } = periodRange(period, manilaToday());

  const parts: string[] = [];
  const args: (string | number)[] = [];
  if (type === 'all' || type === 'allowance') {
    parts.push(`SELECT allowance_id AS id, 'allowance' AS type, entry_date, allowance_amount AS amount, 'Allowance' AS label, NULL AS goal_id, recurring_rule_id
                FROM allowance WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?`);
    args.push(userId, start, end);
  }
  if (type === 'all' || type === 'expense') {
    parts.push(`SELECT expense_id AS id, 'expense' AS type, entry_date, expense_amount AS amount, category AS label, NULL AS goal_id, recurring_rule_id
                FROM expenses WHERE user_id = ? AND status = 'actual' AND entry_date BETWEEN ? AND ?`);
    args.push(userId, start, end);
  }
  if (type === 'all' || type === 'savings') {
    parts.push(`SELECT s.saving_id AS id, 'savings' AS type, s.entry_date, s.savings_amount AS amount, COALESCE(g.goal_name, 'Savings') AS label, s.goal_id, s.recurring_rule_id
                FROM savings_entries s LEFT JOIN savings_goals g ON g.goal_id = s.goal_id
                WHERE s.user_id = ? AND s.status = 'actual' AND s.entry_date BETWEEN ? AND ?`);
    args.push(userId, start, end);
  }
  // limit/offset are validated integers; inlined because mysql2 prepared LIMIT placeholders are unreliable.
  const sql = `${parts.join(' UNION ALL ')} ORDER BY entry_date DESC, id DESC LIMIT ${limit + 1} OFFSET ${offset}`;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, args);

  const items = rows.slice(0, limit).map(r => ({
    id: Number(r.id),
    type: r.type as 'allowance' | 'expense' | 'savings',
    entry_date: String(r.entry_date),
    amount: Number(r.amount),
    label: String(r.label),
    goal_id: r.goal_id === null ? null : Number(r.goal_id),
    recurring: r.recurring_rule_id !== null,
  }));
  return Response.json({ items, has_more: rows.length > limit });
}
```

- [ ] **Step 2: Type**

```ts
import type { FeedItem } from '@/lib/finance/feed';
export interface FeedResponse { items: FeedItem[]; has_more: boolean }
```

- [ ] **Step 3: Verify**

- `npx tsc --noEmit` exits 0.
- Playwright `browser_evaluate`:
  - `() => fetch('/api/finance/feed?limit=5').then(r => r.json())` returns ≤5 items, newest first.
  - `?type=expense&period=week` returns only expenses dated Monday–Sunday of this week.
  - `?limit=1` returns `has_more: true` when more than one row exists.
- `curl … /api/finance/feed` from a shell returns `401`.

---

### Task 18: Day feed and the Overview tab

**Files:**
- Create: `src/components/finance/feed/DayFeed.tsx`, `feed/UpcomingList.tsx`, `src/components/finance/tabs/OverviewTab.tsx`
- Modify: `src/components/finance/useFinanceData.ts`, `FinanceShell.tsx`, `src/app/finance/finance.css`
- Delete: `src/components/finance/legacy/LegacyStatRail.tsx`

**Interfaces:**
- Consumes: `groupByDay`, `FeedItem`, `DayGroup` (Task 6); `categoryLabel`, `categoryEmoji`; `Money` (Task 14); `scheduleDelete`, `flushAll` (`@/lib/workboard/ui/deferredDelete`); `toastUndo`, `toastError`; `deleteTransaction`; `formatDay`, `addDays`.
- Produces:
  - `feedKey(item: { type: string; id: number }): string`, which is `${type}-${id}`
  - `DayFeed({ groups, onDelete?, freshKey? })`
  - `UpcomingList({ items, today, limit? })`
  - `OverviewTab({ recent, upcoming, today, hidden, freshKey, onDelete, onSeeAll })`
  - Hook additions: `recentFeed: FeedItem[] | null`, `loadRecentFeed()`, `dataVersion: number` (incremented on every `refreshAll`).
  - Shell additions: `hidden: Set<string>`, `freshKey: string | null`, `deleteItem(item: FeedItem)`.

- [ ] **Step 1: Hook additions**

In `useFinanceData.ts`:

```ts
import type { FeedItem } from '@/lib/finance/feed';
// state
  const [recentFeed, setRecentFeed] = useState<FeedItem[] | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const loadRecentFeed = useCallback(async () => {
    const d = await getJson<{ items: FeedItem[] }>('/api/finance/feed?type=all&period=all&limit=30');
    setRecentFeed(d?.items ?? []);
  }, []);
```

Call `loadRecentFeed()` in the initial effect. Make `refreshAll` also await `loadRecentFeed()` and `loadLogContext()`, then `setDataVersion(v => v + 1)`. Return `recentFeed`, `loadRecentFeed` and `dataVersion`.

- [ ] **Step 2: `feed/DayFeed.tsx`**

```tsx
'use client';

import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import type { DayGroup, FeedItem } from '@/lib/finance/feed';
import Money from '../ui/Money';

export const feedKey = (item: { type: string; id: number }) => `${item.type}-${item.id}`;

export function itemLabel(item: { type: string; label: string }): string {
  return item.type === 'expense' ? categoryLabel(item.label) : item.label;
}

function subLine(item: FeedItem): string {
  if (item.recurring) return 'Recurring';
  if (item.type === 'savings') return 'Savings goal';
  if (item.type === 'allowance') return 'Allowance';
  return '';
}

/* Day-grouped transactions (spec §9.2): header with the day's net, then rows. Shared by
   Overview (last 3 days) and Activity (everything, paged). */
export default function DayFeed({ groups, onDelete, freshKey = null }: {
  groups: DayGroup[]; onDelete?: (item: FeedItem) => void; freshKey?: string | null;
}) {
  return (
    <div className="fin-feed">
      {groups.map(g => (
        <section key={g.date} className="fin-feed__day" aria-labelledby={`fin-day-${g.date}`}>
          <h3 className="fin-feed__head" id={`fin-day-${g.date}`}>
            <span className="fin-feed__title">{g.title}</span>
            {g.subtitle && <span className="fin-feed__sub">{g.subtitle}</span>}
            <span className="fin-feed__net fin-num">
              {[
                g.inflow > 0 && <Money key="in" value={g.inflow} tone="in" signed />,
                g.spent > 0 && <Money key="out" value={g.spent} tone="out" signed />,
                g.saved > 0 && <span key="save" className="fin-amount--save"><Money value={g.saved} /> saved</span>,
              ].filter(Boolean).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ' · ', el] : [el]), [])}
            </span>
          </h3>
          <ul className="fin-feed__list">
            {g.items.map(item => {
              const tone = item.type === 'expense' ? 'out' : item.type === 'savings' ? 'save' : 'in';
              return (
                <li key={feedKey(item)} className={`fin-row${feedKey(item) === freshKey ? ' is-fresh' : ''}`}>
                  <span className={`fin-ico fin-ico--${tone}`} aria-hidden>{item.type === 'expense' ? categoryEmoji(item.label) : item.type === 'savings' ? '◎' : '↓'}</span>
                  <span className="fin-row__text">
                    <span className="fin-row__title">{itemLabel(item)}</span>
                    {subLine(item) && <span className="fin-row__sub">{subLine(item)}</span>}
                  </span>
                  <Money value={item.amount} tone={tone} signed={tone !== 'save'} className="fin-row__amt" />
                  {onDelete && (
                    <button type="button" className="fin-row__del" aria-label={`Delete ${itemLabel(item)} ${item.amount}`} onClick={() => onDelete(item)}>
                      <Trash2 size={15} aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `feed/UpcomingList.tsx`**

```tsx
'use client';

import { categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import { formatDay } from '@/lib/finance/dates';
import Money from '../ui/Money';
import type { TransactionItem } from '../types';

/* Planned rows from safe-to-spend's `upcoming` (plan ruling R6), shown at 75% opacity. */
export default function UpcomingList({ items, today, limit }: { items: TransactionItem[]; today: string; limit?: number }) {
  const shown = typeof limit === 'number' ? items.slice(0, limit) : items;
  return (
    <ul className="fin-feed__list">
      {shown.map(item => {
        const tone = item.type === 'expense' ? 'out' : item.type === 'savings' ? 'save' : 'in';
        const label = item.type === 'expense' ? categoryLabel(item.label) : item.label;
        return (
          <li key={`${item.type}-${item.id}`} className="fin-row is-planned">
            <span className={`fin-ico fin-ico--${tone}`} aria-hidden>{item.type === 'expense' ? categoryEmoji(item.label) : item.type === 'savings' ? '◎' : '↓'}</span>
            <span className="fin-row__text">
              <span className="fin-row__title">{label}</span>
              <span className="fin-row__sub">{formatDay(item.entry_date, today)} · Planned</span>
            </span>
            <Money value={item.amount} tone={tone} signed={tone !== 'save'} className="fin-row__amt" />
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: `tabs/OverviewTab.tsx`**

```tsx
'use client';

import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import { addDays } from '@/lib/finance/dates';
import { groupByDay, type FeedItem } from '@/lib/finance/feed';
import DayFeed, { feedKey } from '../feed/DayFeed';
import UpcomingList from '../feed/UpcomingList';
import type { TransactionItem } from '../types';

/* Spec §6: Recent (last 3 days with activity) and Coming up (next 3 planned). The composer
   sits above this tab, rendered by the shell. */
export default function OverviewTab({ recent, upcoming, today, hidden, freshKey, onDelete, onSeeAll }: {
  recent: FeedItem[] | null; upcoming: TransactionItem[] | null; today: string; hidden: Set<string>;
  freshKey: string | null; onDelete: (item: FeedItem) => void; onSeeAll: () => void;
}) {
  if (recent === null) {
    return <div className="fin-card">{[0, 1, 2, 3].map(i => <WbSkeleton key={i} height={40} radius={8} style={{ marginBottom: 10 }} />)}</div>;
  }
  const visible = recent.filter(i => !hidden.has(feedKey(i)));
  const soon = (upcoming ?? []).filter(i => i.entry_date <= addDays(today, 14));
  if (visible.length === 0 && soon.length === 0) {
    return <div className="fin-card fin-empty"><p>Log your first expense to see your pace.</p></div>;
  }
  return (
    <>
      <section className="fin-card" aria-labelledby="fin-recent-title">
        <div className="fin-card__head">
          <h2 className="fin-card__title" id="fin-recent-title">Recent</h2>
          <button type="button" className="fin-link fin-push" onClick={onSeeAll}>All activity →</button>
        </div>
        {visible.length ? <DayFeed groups={groupByDay(visible, today).slice(0, 3)} onDelete={onDelete} freshKey={freshKey} /> : <p className="fin-hint">Nothing logged yet.</p>}
      </section>
      {soon.length > 0 && (
        <section className="fin-card" aria-labelledby="fin-soon-title">
          <div className="fin-card__head">
            <h2 className="fin-card__title" id="fin-soon-title">Coming up</h2>
            <button type="button" className="fin-link fin-push" onClick={onSeeAll}>All upcoming →</button>
          </div>
          <p className="fin-card__sub">Planned and recurring, next 14 days</p>
          <UpcomingList items={soon} today={today} limit={3} />
        </section>
      )}
    </>
  );
}
```

- [ ] **Step 5: Shell: deferred delete, fresh row, Overview**

In `FinanceShell.tsx`:

```tsx
import { scheduleDelete, flushAll } from '@/lib/workboard/ui/deferredDelete';
import { toastError } from '@/components/workboard/ui/WbToaster';
import type { FeedItem } from '@/lib/finance/feed';
import OverviewTab from './tabs/OverviewTab';
import { feedKey, itemLabel } from './feed/DayFeed';

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const unhide = useCallback((key: string) => setHidden(h => { const n = new Set(h); n.delete(key); return n; }), []);
  useEffect(() => () => flushAll(), []); // client navigation away sends pending deletes

  /* Spec §7.3: the row hides now; DELETE goes out when the Undo toast expires (or on pagehide). */
  const deleteItem = useCallback((item: FeedItem) => {
    const key = `fin-${feedKey(item)}`;
    setHidden(h => new Set(h).add(feedKey(item)));
    const handle = scheduleDelete(key, keepalive => deleteTransaction(item.type, item.id, keepalive));
    toastUndo(`Deleted ${formatPeso(item.amount)} · ${itemLabel(item)}`, () => {
      if (handle.cancel()) unhide(feedKey(item));
    }, {
      onExpire: () => {
        handle.flush()
          .then(() => data.refreshAll())
          .catch(() => { unhide(feedKey(item)); toastError('Could not delete that entry.', () => deleteItem(item)); });
      },
    });
  }, [data, unhide]);
```

After a successful log, mark the new row fresh: in `logExpense` call `setFreshKey(\`expense-${id}\`)`; in `onLogged` call `setFreshKey(\`${r.type}-${r.id}\`)`. Clear it after 700ms with `window.setTimeout(() => setFreshKey(null), 700)`.

Replace the Overview panel body (the legacy `StatRail`) with:

```tsx
          {tab === 'overview' && (
            <OverviewTab recent={data.recentFeed} upcoming={sts?.upcoming ?? null} today={today} hidden={hidden}
              freshKey={freshKey} onDelete={deleteItem} onSeeAll={() => setTab('activity')} />
          )}
```

Remove the `StatRail` import and delete `legacy/LegacyStatRail.tsx`.

- [ ] **Step 6: Append CSS**

```css
/* ── Feed (spec §9.2) ── */
.fin-feed__day + .fin-feed__day { margin-top: 4px; }
.fin-feed__head { display: flex; align-items: baseline; gap: 10px; margin: 0; padding: 14px 0 6px; border-bottom: 1px solid var(--wb-hairline); font-size: inherit; font-weight: inherit; }
.fin-feed__title { font-family: 'DM Sans', sans-serif; font-size: var(--wb-fs-14); font-weight: 800; }
.fin-feed__sub { font-size: var(--wb-fs-12); color: var(--wb-text-subtle); font-weight: 600; }
.fin-feed__net { margin-left: auto; font-size: var(--wb-fs-13); font-weight: 800; }
.fin-feed__list { list-style: none; margin: 0; padding: 0; }
.fin-row { position: relative; display: flex; align-items: center; gap: 12px; padding: 10px 6px; margin: 0 -6px; border-radius: var(--wb-r-lg); }
.fin-row::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: var(--fin-expense-bg); opacity: 0; pointer-events: none; }
.fin-row.is-fresh::before { animation: fin-fresh 600ms var(--wb-ease) both; }
@keyframes fin-fresh { from { opacity: 1; } to { opacity: 0; } }
.fin-row.is-planned { opacity: 0.75; }
.fin-row__text { display: grid; min-width: 0; }
.fin-row__title { font-size: var(--wb-fs-14); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fin-row__sub { font-size: var(--wb-fs-12); color: var(--wb-text-subtle); font-weight: 600; }
.fin-row__amt { margin-left: auto; font-weight: 800; font-size: var(--wb-fs-14); }
.fin-row__del {
  border: 0; background: none; color: var(--wb-text-faint); width: 32px; height: 32px; border-radius: var(--wb-r-md);
  display: grid; place-items: center; cursor: pointer; opacity: 0; transition: opacity var(--wb-dur-fast) var(--wb-ease);
}
.fin-row__del:focus-visible { opacity: 1; outline: 2px solid var(--wb-blue-strong); }
@media (hover: hover) and (pointer: fine) {
  .fin-row:hover .fin-row__del { opacity: 1; }
  .fin-row__del:hover { color: var(--wb-danger); background: var(--wb-danger-bg); }
}
@media (hover: none) { .fin-row__del { opacity: 1; width: 40px; height: 40px; } }
.fin-empty { text-align: center; color: var(--wb-text-muted); font-weight: 600; }
```

- [ ] **Step 7: Verify**

- `npx tsc --noEmit` exits 0, the style gate is clean, and `node scripts/fin-test.mjs` passes.
- Playwright at 1440, Overview:
  - Recent shows up to 3 day groups and Coming up shows ≤3 rows.
  - Log `120` via the composer: the new row tints pink briefly at the top of "Today", and the hero updates.
  - Delete a row: it disappears with a "Deleted … Undo" toast. Undo restores it.
  - Delete another and let the toast expire: after reload it stays deleted.
- At 390: the row delete button is visible (touch rule) and nothing overflows.

✅ **CHECKPOINT (Phase 3):** run the phase checkpoint list. Overview screenshots at 390 / 820 / 1440. Wait for approval.

---

## Phase 4 — Plan tab (spec §8)

### Task 19: Envelope card and adjust popover

**Files:**
- Create: `src/components/finance/plan/Envelope.tsx`, `plan/AdjustPopover.tsx`
- Modify: `src/app/finance/finance.css`

**Interfaces:**
- Consumes: `EnvelopeModel` (Task 6); `TIER_META` (Task 2); `categoryLabel`, `categoryEmoji`; `formatPeso`, `formatPesoWhole`; `requestJson`, `parseAmount` (Task 14); `PesoField`; `WbPopover`.
- Produces:
  - `Envelope({ env, elapsedPct, onAdjust })`, where `onAdjust(env, anchor: HTMLElement)`.
  - `AdjustPopover({ env, anchor, remainingCycleAllowance, onClose, onSaved })`.

- [ ] **Step 1: `plan/Envelope.tsx`**

```tsx
'use client';

import type { CSSProperties } from 'react';
import { TIER_META } from '@/lib/finance/ui/colors';
import { categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import { formatPesoWhole } from '@/lib/finance/format';
import type { EnvelopeModel } from '@/lib/finance/envelopes';

/* One budget envelope (spec §8.2): tier stripe, ₱ left large, bar with a cycle-pace tick.
   The whole card is the adjust button. */
export default function Envelope({ env, elapsedPct, onAdjust }: {
  env: EnvelopeModel; elapsedPct: number | null; onAdjust: (env: EnvelopeModel, anchor: HTMLElement) => void;
}) {
  const tier = TIER_META[env.tier];
  const name = env.isSavings ? 'Savings' : categoryLabel(env.category);
  const big = env.over
    ? (env.isSavings ? 'Fully funded' : `${formatPesoWhole(-env.left)} over`)
    : formatPesoWhole(env.left);
  const of = `${env.isSavings ? 'to save of' : 'left of'} ${formatPesoWhole(env.cap)}${env.spent > 0 ? ` · ${env.pct}% ${env.isSavings ? 'funded' : 'used'}` : ''}`;
  const fill = env.cap > 0 ? Math.min(1, env.spent / env.cap) : 0;
  return (
    <button
      type="button"
      className={`fin-env${env.over && !env.isSavings ? ' is-over' : ''}`}
      style={{ '--fin-env-tier': tier.fill } as CSSProperties}
      aria-label={`${name}, ${tier.label}: ${big}, ${of}. Adjust this cycle's cap`}
      onClick={e => onAdjust(env, e.currentTarget)}
    >
      <span className="fin-env__head">
        <span aria-hidden>{env.isSavings ? '◎' : categoryEmoji(env.category)}</span>
        <span className="fin-env__name">{name}</span>
        <span className="fin-env__tier" style={{ background: tier.bg, color: tier.ink }}>{tier.label}</span>
      </span>
      <span className="fin-env__left fin-num">{big}</span>
      <span className="fin-env__of fin-num">{of}</span>
      <span className="fin-track fin-env__track" aria-hidden>
        <span className="fin-track__fill" style={{ background: env.over && !env.isSavings ? 'var(--wb-danger)' : tier.fill, transform: `scaleX(${fill})` }} />
        {elapsedPct !== null && !env.isSavings && <span className="fin-env__tick" style={{ left: `${elapsedPct}%` }} />}
      </span>
      {(env.isOverride || env.fasterThanPlan) && (
        <span className="fin-env__flags">
          {env.isOverride && <span className="fin-pill fin-pill--warn">Adjusted</span>}
          {env.fasterThanPlan && <span className="fin-env__warn">Spending faster than plan</span>}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: `plan/AdjustPopover.tsx`**

```tsx
'use client';

import { useState } from 'react';
import WbPopover from '@/components/workboard/ui/WbPopover';
import { categoryLabel } from '@/lib/finance/categories';
import { formatPeso } from '@/lib/finance/format';
import type { EnvelopeModel } from '@/lib/finance/envelopes';
import { parseAmount, requestJson } from '../financeApi';
import PesoField from '../ui/PesoField';

/* This-cycle override and reset (spec §8.2), ported from the old Budget Progress
   submitOverride/resetOverride/maxFor (financetracker-log.md §28, §36). The cap can't grow
   past the cycle's unallocated money plus this category's own current cap. */
export default function AdjustPopover({ env, anchor, remainingCycleAllowance, onClose, onSaved }: {
  env: EnvelopeModel | null; anchor: HTMLElement | null; remainingCycleAllowance: number | null; onClose: () => void; onSaved: () => void;
}) {
  const [raw, setRaw] = useState(env ? String(env.cap) : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!env) return null;
  const name = env.isSavings ? 'Savings' : categoryLabel(env.category);
  const max = remainingCycleAllowance !== null ? Math.round((remainingCycleAllowance + env.cap) * 100) / 100 : null;

  const save = async () => {
    const amount = parseAmount(raw);
    if (!amount) { setError('Enter an amount greater than 0.'); return; }
    if (max !== null && amount > max + 0.01) { setError(`That would put the cycle over its total. The most you can assign here is ${formatPeso(max)}.`); return; }
    setBusy(true);
    try {
      await requestJson('/api/finance/budgets', { body: { action: 'override', category: env.category, amount, reason: reason.trim() || undefined } });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (env.budgetId === null) return;
    setBusy(true);
    try {
      await requestJson('/api/finance/budgets', { body: { action: 'reset', budget_id: env.budgetId } });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <WbPopover open={!!anchor} anchor={anchor} onClose={onClose} width={300} labelledBy="fin-adjust-title">
      <form className="fin-adjust" onSubmit={e => { e.preventDefault(); void save(); }}>
        <p className="fin-adjust__title" id="fin-adjust-title">Adjust {name}</p>
        <PesoField id="fin-adjust-amount" label="This cycle's cap" value={raw} onChange={v => { setRaw(v); setError(''); }} autoFocus />
        <label className="fin-field-label" htmlFor="fin-adjust-reason">Reason (optional)</label>
        <div className="fin-field"><input id="fin-adjust-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. org event week" /></div>
        {env.planAmount !== null && <p className="fin-hint fin-adjust__plan fin-num">Plan allocation: {formatPeso(env.planAmount)}. This cycle only, the plan won&apos;t change.</p>}
        {max !== null && <p className="fin-hint fin-num">Up to {formatPeso(max)}</p>}
        {error && <p className="fin-error" role="alert">{error}</p>}
        <div className="fin-adjust__row">
          {env.isOverride && env.planAmount !== null && env.budgetId !== null && (
            <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={busy} onClick={reset}>Reset to plan</button>
          )}
          <button type="submit" className="fin-btn fin-btn--primary fin-btn--sm fin-push" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </WbPopover>
  );
}
```

- [ ] **Step 3: Append CSS**

```css
/* ── Envelopes (spec §8.2) ── */
.fin-envs { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.fin-env {
  position: relative; overflow: hidden; display: grid; gap: 2px; text-align: left; cursor: pointer; font: inherit; color: var(--wb-text);
  background: var(--fin-card-solid); border: 1px solid var(--wb-glass-border); border-radius: var(--wb-r-xl); padding: 14px 16px 16px 18px;
  transition: transform var(--wb-dur-fast) var(--wb-ease), box-shadow var(--wb-dur) var(--wb-ease);
}
.fin-env::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--fin-env-tier); }
.fin-env:active { transform: scale(0.98); }
.fin-env:focus-visible { outline: 2px solid var(--wb-blue-strong); outline-offset: 2px; }
@media (hover: hover) and (pointer: fine) { .fin-env:hover { box-shadow: var(--wb-shadow-pop); } }
.fin-env__head { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: var(--wb-fs-14); }
.fin-env__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fin-env__tier { margin-left: auto; font-size: 11px; font-weight: 800; letter-spacing: 0.03em; text-transform: uppercase; border-radius: var(--wb-r-sm); padding: 2px 7px; }
.fin-env__left { font-size: var(--wb-fs-24); font-weight: 800; margin-top: 8px; }
.fin-env.is-over .fin-env__left { color: var(--wb-danger); }
.fin-env__of { font-size: var(--wb-fs-12); color: var(--wb-text-subtle); font-weight: 600; margin-bottom: 10px; }
.fin-env__track { overflow: visible; }
.fin-env__tick { position: absolute; top: -3px; bottom: -3px; width: 2px; border-radius: 2px; background: rgba(45, 55, 72, 0.4); }
.fin-env__flags { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
.fin-env__warn { font-size: var(--wb-fs-12); font-weight: 700; color: var(--wb-warn); }
.fin-env-add {
  font: inherit; border: 1.5px dashed var(--fin-ghost-border); background: transparent; border-radius: var(--wb-r-xl);
  color: var(--wb-text-subtle); font-weight: 700; font-size: var(--wb-fs-13); min-height: 120px; cursor: pointer;
}
.fin-adjust { padding: 14px; }
.fin-adjust__title { margin: 0; font-weight: 800; font-family: 'DM Sans', sans-serif; font-size: var(--wb-fs-16); }
.fin-adjust__plan { margin: 10px 0 0; white-space: normal; }
.fin-adjust__row { display: flex; gap: 8px; margin-top: 12px; }
```

- [ ] **Step 4: Verify**

`npx tsc --noEmit` exits 0, and the style gate is clean. Envelopes are mounted in Task 20.

---

### Task 20: Plan tab: header, new-cycle banner, editor

**Files:**
- Create: `src/components/finance/plan/NewCycleBanner.tsx`, `plan/PlanEditor.tsx`, `src/components/finance/tabs/PlanTab.tsx`
- Modify: `src/components/finance/FinanceShell.tsx`, `src/app/finance/finance.css`
- Delete: `src/components/finance/legacy/LegacyPlan.tsx`

**Interfaces:**
- Consumes: `buildEnvelopes`, `nextCycle`, `templateToRows` (Task 6); `Envelope`, `AdjustPopover` (Task 19); `ConfirmPopover`, `PesoField`, `requestJson`, `parseAmount` (Task 14); `ALLOC_CATEGORIES`, `categoryLabel`; `formatPeso`, `formatPesoWhole`; `formatShortDate`; `TIER_META`.
- Produces:
  - `NewCycleBanner({ planName, lastEnd, cycle, busy, onStart, onAdjust })`
  - `PlanEditor({ template, initialCycle, accountRemaining, onSaved, onCancel })`, where a null `template` means a new plan.
  - `PlanTab({ templates, budgets, savings, remainingCycleAllowance, accountRemaining, today, onChanged })`
  - Shell: `planBadge` is true when the active plan has a `nextCycle(...)`.

Before writing code, confirm the allocation-templates action names: `grep -n "action ===" src/app/api/finance/allocation-templates/route.ts`. Expected: `save`, `delete`, `set_default`. If the activate action has a different name, use that name everywhere this task says `set_default`.

- [ ] **Step 1: `plan/NewCycleBanner.tsx`**

```tsx
'use client';

import { RefreshCw } from 'lucide-react';
import { formatPeso } from '@/lib/finance/format';
import { formatShortDate } from '@/lib/finance/dates';

/* Spec §8.3: shown when the active plan's last cycle has ended. */
export default function NewCycleBanner({ planName, lastEnd, cycle, busy, onStart, onAdjust }: {
  planName: string; lastEnd: string; cycle: { start: string; end: string; days: number; amount: number }; busy: boolean;
  onStart: () => void; onAdjust: () => void;
}) {
  return (
    <div className="fin-banner" role="status">
      <RefreshCw size={18} aria-hidden />
      <div>
        <p className="fin-banner__title">Your “{planName}” cycle ended {formatShortDate(lastEnd)}</p>
        <p className="fin-banner__sub fin-num">
          Start the next one with the same split: {formatPeso(cycle.amount)} · {formatShortDate(cycle.start)} – {formatShortDate(cycle.end)} ({cycle.days} days)
        </p>
      </div>
      <div className="fin-banner__actions">
        <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={onAdjust}>Adjust…</button>
        <button type="button" className="fin-btn fin-btn--primary fin-btn--sm" disabled={busy} onClick={onStart}>{busy ? 'Starting…' : 'Start next cycle'}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `plan/PlanEditor.tsx`**

This is the old template builder and in-place editor merged into one component (financetracker-log.md §25, §28, §33, §36), with the same validation and the same save payload.

```tsx
'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { ALLOC_CATEGORIES } from '@/lib/finance/categories';
import { formatPeso } from '@/lib/finance/format';
import { templateToRows } from '@/lib/finance/envelopes';
import type { Tier } from '@/lib/finance/ui/colors';
import { parseAmount, requestJson } from '../financeApi';
import PesoField from '../ui/PesoField';
import type { AllocTemplate } from '../types';

type Row = { category: string; priority_tier: Tier; allocation_type: 'fixed' | 'percent'; value: number };

export default function PlanEditor({ template, initialCycle, accountRemaining, onSaved, onCancel }: {
  template: AllocTemplate | null;
  initialCycle: { amount: number; start: string; end: string } | null;
  accountRemaining: number | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [rows, setRows] = useState<Row[]>(template ? templateToRows(template.items) : [{ category: 'food', priority_tier: 'flexible', allocation_type: 'percent', value: 10 }]);
  const [allowance, setAllowance] = useState(initialCycle ? String(initialCycle.amount) : template?.last_allowance_amount != null ? String(template.last_allowance_amount) : '');
  const [from, setFrom] = useState(initialCycle?.start ?? template?.last_period_start ?? '');
  const [to, setTo] = useState(initialCycle?.end ?? template?.last_period_end ?? '');
  const [error, setError] = useState(initialCycle && accountRemaining !== null && initialCycle.amount > accountRemaining
    ? `That's more than your remaining balance of ${formatPeso(accountRemaining)}. Lower the allowance to start this cycle.` : '');
  const [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!name.trim()) { setError('Enter a plan name.'); return; }
    if (!rows.length) { setError('Add at least one category.'); return; }
    let amount: number | null = null;
    if (allowance.trim()) {
      amount = parseAmount(allowance);
      if (!amount) { setError('Allowance amount must be greater than 0.'); return; }
      if (accountRemaining !== null && amount > accountRemaining) { setError(`That's more than your remaining balance of ${formatPeso(accountRemaining)}.`); return; }
      if (!from || !to) { setError('Pick a start and end date for the allowance period.'); return; }
      if (to < from) { setError('The end date must be after the start date.'); return; }
    }
    setBusy(true);
    setError('');
    try {
      await requestJson('/api/finance/allocation-templates', {
        body: {
          action: 'save', template_id: template?.template_id, name: name.trim(), items: rows,
          allowance_amount: amount ?? undefined, period_start: amount ? from : undefined, period_end: amount ? to : undefined,
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the plan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="fin-editor" onSubmit={e => { e.preventDefault(); void save(); }} aria-label={template ? `Edit ${template.name}` : 'New plan'}>
      <div className="fin-editor__grid">
        <div>
          <label className="fin-field-label" htmlFor="fin-plan-name">Plan name</label>
          <div className="fin-field"><input id="fin-plan-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Normal school week" /></div>
        </div>
        <PesoField id="fin-plan-allowance" label={accountRemaining !== null ? `Allowance (up to ${formatPeso(accountRemaining)})` : 'Allowance (optional)'} value={allowance} onChange={setAllowance} />
        <div>
          <label className="fin-field-label" htmlFor="fin-plan-from">Period from</label>
          <div className="fin-field"><input id="fin-plan-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        </div>
        <div>
          <label className="fin-field-label" htmlFor="fin-plan-to">Period to</label>
          <div className="fin-field"><input id="fin-plan-to" type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></div>
        </div>
      </div>
      <p className="fin-hint fin-editor__note">Set an allowance and period to create this cycle&apos;s envelopes right away.</p>

      <div className="fin-editor__rows" role="table" aria-label="Split">
        <div className="fin-editor__row fin-editor__row--head" role="row">
          <span role="columnheader">Category</span><span role="columnheader">Tier</span><span role="columnheader">Type</span><span role="columnheader">Value</span><span />
        </div>
        {rows.map((row, i) => (
          <div className="fin-editor__row" role="row" key={i}>
            <div className="fin-field" role="cell">
              <select aria-label="Category" value={row.category} onChange={e => update(i, { category: e.target.value, priority_tier: e.target.value === 'savings' ? 'target' : row.priority_tier })}>
                {ALLOC_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="fin-field" role="cell">
              <select aria-label="Tier" value={row.priority_tier} onChange={e => update(i, { priority_tier: e.target.value as Tier })}>
                <option value="required">Essential</option><option value="target">Committed</option><option value="flexible">Flexible</option>
              </select>
            </div>
            <div className="fin-field" role="cell">
              <select aria-label="Allocation type" value={row.allocation_type} onChange={e => update(i, { allocation_type: e.target.value as Row['allocation_type'] })}>
                <option value="percent">% of allowance</option><option value="fixed">Fixed ₱</option>
              </select>
            </div>
            <div className="fin-field" role="cell">
              <span className="fin-field__prefix" aria-hidden>{row.allocation_type === 'fixed' ? '₱' : '%'}</span>
              <input aria-label="Value" inputMode="decimal" value={String(row.value)} onChange={e => update(i, { value: parseFloat(e.target.value) || 0 })} />
            </div>
            <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" role="cell" aria-label="Remove row" onClick={() => setRows(rs => rs.filter((_, ri) => ri !== i))}><X size={14} aria-hidden /></button>
          </div>
        ))}
      </div>
      <p className="fin-hint">Essential = can&apos;t be trimmed · Committed = savings &amp; recurring · Flexible = first to trim</p>
      <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={() => setRows(rs => [...rs, { category: 'food', priority_tier: 'flexible', allocation_type: 'percent', value: 10 }])}>
        <Plus size={14} aria-hidden /> Add category
      </button>
      {error && <p className="fin-error" role="alert">{error}</p>}
      <div className="fin-editor__actions">
        <button type="button" className="fin-btn fin-btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="fin-btn fin-btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: `tabs/PlanTab.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import { toastInfo, toastError } from '@/components/workboard/ui/WbToaster';
import { buildEnvelopes, nextCycle, templateToRows, type EnvelopeModel } from '@/lib/finance/envelopes';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { formatShortDate } from '@/lib/finance/dates';
import Envelope from '../plan/Envelope';
import AdjustPopover from '../plan/AdjustPopover';
import NewCycleBanner from '../plan/NewCycleBanner';
import PlanEditor from '../plan/PlanEditor';
import ConfirmPopover from '../ui/ConfirmPopover';
import { requestJson } from '../financeApi';
import type { AllocTemplate, BudgetItem, SavingsProgress } from '../types';

type EditorState = null | { mode: 'new' } | { mode: 'edit'; cycle: { amount: number; start: string; end: string } | null };

export default function PlanTab({ templates, budgets, savings, remainingCycleAllowance, accountRemaining, today, onChanged }: {
  templates: AllocTemplate[] | null; budgets: BudgetItem[] | null; savings: SavingsProgress | null;
  remainingCycleAllowance: number | null; accountRemaining: number | null; today: string; onChanged: () => void;
}) {
  const [editor, setEditor] = useState<EditorState>(null);
  const [adjust, setAdjust] = useState<{ env: EnvelopeModel; anchor: HTMLElement } | null>(null);
  const [starting, setStarting] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (templates === null || budgets === null) {
    return <div className="fin-card"><div className="fin-envs">{[0, 1, 2, 3].map(i => <WbSkeleton key={i} height={130} radius={14} />)}</div></div>;
  }
  const active = templates.find(t => t.is_default) ?? null;
  const cycle = active ? nextCycle(active, today) : null;
  const { envelopes, elapsedPct, period } = buildEnvelopes(budgets, savings, today);

  const setActive = async (templateId: number) => {
    try { await requestJson('/api/finance/allocation-templates', { body: { action: 'set_default', template_id: templateId } }); onChanged(); }
    catch (e) { toastError(e instanceof Error ? e.message : 'Could not switch plans.'); }
  };
  const startNext = async () => {
    if (!active || !cycle) return;
    if (accountRemaining !== null && cycle.amount > accountRemaining) { setEditor({ mode: 'edit', cycle }); return; }
    setStarting(true);
    try {
      await requestJson('/api/finance/allocation-templates', {
        body: { action: 'save', template_id: active.template_id, name: active.name, items: templateToRows(active.items), allowance_amount: cycle.amount, period_start: cycle.start, period_end: cycle.end },
      });
      onChanged();
      toastInfo(`Started ${formatShortDate(cycle.start)} – ${formatShortDate(cycle.end)} · ${formatPeso(cycle.amount)}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Could not start the cycle.', startNext);
    } finally {
      setStarting(false);
    }
  };
  const deleteActive = async () => {
    if (!active) return;
    await requestJson('/api/finance/allocation-templates', { body: { action: 'delete', template_id: active.template_id } });
    onChanged();
  };

  return (
    <section className="fin-card" aria-labelledby="fin-plan-title">
      <div className="fin-card__head">
        <h2 className="fin-card__title" id="fin-plan-title">Spending plan</h2>
        {active && (
          <select className="fin-plan-select" aria-label="Active plan" value={active.template_id} onChange={e => setActive(Number(e.target.value))} disabled={!!editor}>
            {templates.map(t => <option key={t.template_id} value={t.template_id}>{t.name}</option>)}
          </select>
        )}
        {active?.last_allowance_amount != null && period && (
          <span className="fin-hint fin-num">{formatPesoWhole(active.last_allowance_amount)} · {formatShortDate(period.start)} – {formatShortDate(period.end)}</span>
        )}
        {remainingCycleAllowance !== null && Math.abs(remainingCycleAllowance) > 0.004 ? (
          <button type="button" className="fin-pill fin-pill--warn fin-pill-btn" onClick={() => setEditor({ mode: 'edit', cycle: null })}>
            {formatPeso(remainingCycleAllowance)} unallocated · Assign
          </button>
        ) : remainingCycleAllowance !== null ? (
          <span className="fin-pill fin-pill--success fin-num">{formatPeso(0)} unallocated</span>
        ) : null}
        <span className="fin-push fin-plan-actions">
          {active && <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={() => setEditor({ mode: 'edit', cycle: null })}>Edit split</button>}
          <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={() => setEditor({ mode: 'new' })}><Plus size={14} aria-hidden /> New plan</button>
          {active && (
            <button ref={moreRef} type="button" className="fin-btn fin-btn--ghost fin-btn--sm" aria-label={`Delete ${active.name}`} onClick={() => setConfirmOpen(true)}>
              <MoreHorizontal size={16} aria-hidden />
            </button>
          )}
        </span>
      </div>
      <ConfirmPopover open={confirmOpen} anchor={moreRef.current} onClose={() => setConfirmOpen(false)}
        title={`Delete “${active?.name ?? ''}”?`} body="Its envelopes for this cycle are deleted too. Your transactions stay." onConfirm={deleteActive} />

      {active && cycle && !editor && active.last_period_end && (
        <NewCycleBanner planName={active.name} lastEnd={active.last_period_end} cycle={cycle} busy={starting} onStart={startNext} onAdjust={() => setEditor({ mode: 'edit', cycle })} />
      )}

      {editor ? (
        <PlanEditor
          key={editor.mode === 'new' ? 'new' : `edit-${active?.template_id}`}
          template={editor.mode === 'new' ? null : active}
          initialCycle={editor.mode === 'edit' ? editor.cycle : null}
          accountRemaining={accountRemaining}
          onSaved={() => { setEditor(null); onChanged(); }}
          onCancel={() => setEditor(null)}
        />
      ) : !active ? (
        <div className="fin-empty"><p>Make a plan to split each allowance automatically.</p>
          <button type="button" className="fin-btn fin-btn--primary" onClick={() => setEditor({ mode: 'new' })}>New plan</button></div>
      ) : envelopes.length === 0 ? (
        <div className="fin-empty"><p>This plan hasn&apos;t been given an allowance yet.</p>
          <button type="button" className="fin-btn fin-btn--primary" onClick={() => setEditor({ mode: 'edit', cycle: null })}>Start a cycle</button></div>
      ) : (
        <div className="fin-envs">
          {envelopes.map(env => (
            <Envelope key={env.category} env={env} elapsedPct={elapsedPct} onAdjust={(e, anchor) => setAdjust({ env: e, anchor })} />
          ))}
          <button type="button" className="fin-env-add" onClick={() => setEditor({ mode: 'edit', cycle: null })}><Plus size={14} aria-hidden /> Add category</button>
        </div>
      )}
      {adjust && (
        <AdjustPopover key={adjust.env.category} env={adjust.env} anchor={adjust.anchor} remainingCycleAllowance={remainingCycleAllowance}
          onClose={() => setAdjust(null)} onSaved={onChanged} />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Shell wiring**

Replace the Plan panel body with:

```tsx
          {tab === 'plan' && (
            <PlanTab templates={data.templates} budgets={data.budgets} savings={data.savingsProgress}
              remainingCycleAllowance={data.remainingCycleAllowance} accountRemaining={sts?.current_balance ?? null} today={today}
              onChanged={() => { void data.loadTemplates(); void data.loadBudgets(); void data.refreshAll(); }} />
          )}
```

Compute the badge and pass it to `FinanceTabs`:

```tsx
import { nextCycle } from '@/lib/finance/envelopes';
  const activePlan = data.templates?.find(t => t.is_default) ?? null;
  const planBadge = !!(activePlan && nextCycle(activePlan, today));
  // …
  <FinanceTabs value={tab} onChange={setTab} planBadge={planBadge} />
```

Remove the `SpendingPlan` import and delete `legacy/LegacyPlan.tsx`.

- [ ] **Step 5: Append CSS**

```css
/* ── Plan tab (spec §8) ── */
.fin-plan-select {
  appearance: none; -webkit-appearance: none; font: inherit; font-size: var(--wb-fs-13); font-weight: 700; cursor: pointer;
  color: var(--fin-savings-ink); background: var(--fin-savings-bg); border: 1px solid rgba(155, 109, 214, 0.3);
  border-radius: var(--wb-r-pill); padding: 5px 26px 5px 12px;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 14px) 52%, calc(100% - 9px) 52%; background-size: 5px 5px; background-repeat: no-repeat;
}
.fin-plan-select:focus-visible { outline: 2px solid var(--wb-blue-strong); outline-offset: 2px; }
.fin-pill-btn { border: 0; cursor: pointer; font: inherit; font-size: var(--wb-fs-12); font-weight: 700; }
.fin-plan-actions { display: flex; gap: 6px; }
.fin-banner {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 12px 0 16px; padding: 14px 16px;
  border-radius: var(--wb-r-xl); background: var(--fin-income-bg); border: 1px solid rgba(116, 188, 217, 0.35); color: var(--wb-blue-ink);
}
.fin-banner__title { margin: 0; font-weight: 800; color: var(--wb-text); }
.fin-banner__sub { margin: 2px 0 0; font-size: var(--wb-fs-13); color: var(--wb-text-muted); font-weight: 600; white-space: normal; }
.fin-banner__actions { margin-left: auto; display: flex; gap: 8px; }
.fin-editor { margin-top: 12px; padding: 16px; border-radius: var(--wb-r-xl); background: var(--fin-card-solid); border: 1px solid var(--wb-glass-border); }
.fin-editor__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0 12px; }
.fin-editor__note { margin: 8px 0 12px; }
.fin-editor__rows { display: grid; gap: 8px; margin-bottom: 8px; }
.fin-editor__row { display: grid; grid-template-columns: 1.3fr 1fr 1fr 0.8fr auto; gap: 6px; align-items: center; }
.fin-editor__row--head span { font-size: 11px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: var(--wb-text-subtle); }
.fin-editor__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.fin-empty { display: grid; justify-items: center; gap: 12px; padding: 18px 0; }
.fin-empty p { margin: 0; }
@media (max-width: 700px) {
  .fin-editor__row { grid-template-columns: 1fr 1fr; }
  .fin-editor__row--head { display: none; }
  .fin-banner__actions { margin-left: 0; }
}
```

- [ ] **Step 6: Verify**

- `npx tsc --noEmit` exits 0, the style gate is clean, and `grep -rn "confirm(" src/components/finance --include=*.tsx | grep -v legacy` returns nothing.
- Playwright, Plan tab with the real "School" plan:
  - The banner reads "Your “School” cycle ended Sep 22" and the Plan tab shows the badge.
  - Click an envelope: the adjust popover opens anchored to it. Save an override: the "Adjusted" chip appears. Reset to plan clears it.
  - **Start next cycle**: envelopes reset for the new period and the banner and badge disappear. Undo this manually afterwards by editing the period back if the user asks.
  - Switch the active plan via the selector: envelopes change. **Edit split** opens the editor prefilled.
  - At 390: envelopes are 1 per row and the editor rows wrap to 2 columns.

✅ **CHECKPOINT (Phase 4):** run the phase checkpoint list. Plan screenshots at 390 / 820 / 1440 (banner state and after Start next cycle). Wait for approval. **Ask before clicking Start next cycle on real data**: it writes a new cycle for the user's real plan.

---

## Phase 5 — Activity tab (spec §9)

### Task 21: Activity tab

**Files:**
- Create: `src/components/finance/tabs/ActivityTab.tsx`
- Modify: `src/components/finance/FinanceShell.tsx`, `src/app/finance/finance.css`
- Delete: `src/components/finance/legacy/LegacyTransactions.tsx`

**Interfaces:**
- Consumes: `groupByDay`, `compareText`, `FeedItem` (Task 6); `DayFeed`, `feedKey`, `itemLabel`, `UpcomingList` (Task 18); `WbSegmented`; `ConfirmPopover`, `requestJson` (Task 14); `formatPeso`, `formatPesoWhole`; `addDays`; `categoryLabel`; `Range`, `RecurringRule`, `SummaryResponse`, `TransactionItem`, `GoalProjection` (types).
- Produces: `ActivityTab({ today, range, setRange, summary, upcoming, recurringRules, goals, hidden, freshKey, onDelete, dataVersion, onRecurringChanged })`.

- [ ] **Step 1: `tabs/ActivityTab.tsx`**

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Repeat, Search, X } from 'lucide-react';
import WbSegmented from '@/components/workboard/ui/WbSegmented';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import { groupByDay, compareText, type FeedItem } from '@/lib/finance/feed';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { addDays } from '@/lib/finance/dates';
import { categoryLabel } from '@/lib/finance/categories';
import DayFeed, { feedKey, itemLabel } from '../feed/DayFeed';
import UpcomingList from '../feed/UpcomingList';
import ConfirmPopover from '../ui/ConfirmPopover';
import { requestJson } from '../financeApi';
import type { GoalProjection, Range, RecurringRule, SummaryResponse, TransactionItem, FeedResponse } from '../types';

type TypeFilter = 'all' | 'expense' | 'allowance' | 'savings';
const PAGE = 50;
const RANGE_LABEL: Record<Range, string> = { week: 'This week', month: 'This month', all: 'All time' };
const CADENCE: Record<RecurringRule['frequency'], string> = { weekly: 'weekly', biweekly: 'every 2 weeks', monthly: 'monthly' };

export default function ActivityTab({ today, range, setRange, summary, upcoming, recurringRules, goals, hidden, freshKey, onDelete, dataVersion, onRecurringChanged }: {
  today: string; range: Range; setRange: (r: Range) => void; summary: SummaryResponse | null; upcoming: TransactionItem[] | null;
  recurringRules: RecurringRule[] | null; goals: GoalProjection[]; hidden: Set<string>; freshKey: string | null;
  onDelete: (item: FeedItem) => void; dataVersion: number; onRecurringChanged: () => void;
}) {
  const [type, setType] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stopRule, setStopRule] = useState<{ rule: RecurringRule; anchor: HTMLElement } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    requestJson<FeedResponse>(`/api/finance/feed?type=${type}&period=${range}&limit=${PAGE}&offset=0`)
      .then(d => { if (!cancelled) { setItems(d.items); setHasMore(d.has_more); } })
      .catch(() => { if (!cancelled) { setItems([]); setHasMore(false); } });
    return () => { cancelled = true; };
  }, [type, range, dataVersion]);

  const loadMore = async () => {
    if (!items) return;
    setLoadingMore(true);
    try {
      const d = await requestJson<FeedResponse>(`/api/finance/feed?type=${type}&period=${range}&limit=${PAGE}&offset=${items.length}`);
      setItems([...items, ...d.items]);
      setHasMore(d.has_more);
    } finally {
      setLoadingMore(false);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(i => !hidden.has(feedKey(i))).filter(i => !q || itemLabel(i).toLowerCase().includes(q) || String(i.amount).includes(q));
  }, [items, hidden, query]);

  const totals = summary?.totals;
  const goalsInPeriod = summary ? new Set(summary.breakdown.savings_by_goal.flatMap(b => Object.entries(b).filter(([, v]) => v > 0).map(([g]) => g))).size : 0;
  const cmp = totals ? compareText(totals.expense, summary?.previous_totals?.expense ?? null, range) : null;
  const soon = (upcoming ?? []).filter(i => i.entry_date <= addDays(today, 14));
  const soonTotal = soon.reduce((s, i) => s + (i.type === 'allowance' ? 0 : i.amount), 0);
  const ruleWhat = (r: RecurringRule) => r.type === 'expense' ? categoryLabel(r.category ?? '') : r.type === 'savings' ? (goals.find(g => g.goal_id === r.goal_id)?.goal_name ?? 'Savings') : 'Allowance';
  const filtersActive = type !== 'all' || query.trim() !== '';

  return (
    <section className="fin-card" aria-label="Activity">
      <div className="fin-toolbar">
        <label className="fin-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Search transactions" aria-label="Search transactions" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <WbSegmented<TypeFilter> ariaLabel="Type" idPrefix="fin-act-type" value={type} onChange={setType}
          options={[{ key: 'all', label: 'All' }, { key: 'expense', label: 'Expenses' }, { key: 'allowance', label: 'Allowance' }, { key: 'savings', label: 'Savings' }]} />
        <WbSegmented<Range> ariaLabel="Period" idPrefix="fin-act-period" value={range} onChange={setRange}
          options={[{ key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'all', label: 'All' }]} />
      </div>

      {totals && (
        <p className="fin-totals fin-num">
          {RANGE_LABEL[range]}: <b className="fin-amount--in">+{formatPeso(totals.allowance)}</b> in ·{' '}
          <b className="fin-amount--out">−{formatPeso(totals.expense)}</b> spent ·{' '}
          <b className="fin-amount--save">{formatPeso(totals.savings)}</b> saved{goalsInPeriod > 1 ? ` (across ${goalsInPeriod} goals)` : ''}
          {cmp && <> · <span className={`fin-totals__cmp is-${cmp.tone}`}>{cmp.text}{cmp.tone !== 'muted' ? ' spending' : ''}</span></>}
        </p>
      )}

      {recurringRules && recurringRules.length > 0 && (
        <div className="fin-recur">
          <span className="fin-label">Recurring</span>
          {recurringRules.map(r => (
            <span key={r.rule_id} className="fin-recur__chip">
              <Repeat size={13} aria-hidden /> <b>{ruleWhat(r)}</b> <span className="fin-num">{formatPesoWhole(r.amount)}</span> · {CADENCE[r.frequency]}
              <button type="button" className="fin-recur__x" aria-label={`Stop ${ruleWhat(r)} recurring`} onClick={e => setStopRule({ rule: r, anchor: e.currentTarget })}><X size={13} aria-hidden /></button>
            </span>
          ))}
        </div>
      )}
      <ConfirmPopover
        open={!!stopRule} anchor={stopRule?.anchor ?? null} onClose={() => setStopRule(null)}
        title={`Stop “${stopRule ? ruleWhat(stopRule.rule) : ''}”?`} body="Its future planned entries are removed too. Past ones stay." confirmLabel="Stop"
        onConfirm={async () => { if (!stopRule) return; await requestJson('/api/finance/recurring-rules', { body: { action: 'delete', rule_id: stopRule.rule.rule_id } }); onRecurringChanged(); }}
      />

      {soon.length > 0 && (
        <div className="fin-upcoming">
          <h3 className="fin-feed__head"><span className="fin-feed__title">Upcoming</span><span className="fin-feed__sub">next 14 days</span>
            <span className="fin-feed__net fin-num fin-amount--out">−{formatPeso(soonTotal)}</span></h3>
          <UpcomingList items={soon} today={today} />
        </div>
      )}

      {items === null ? (
        [0, 1, 2, 3, 4].map(i => <WbSkeleton key={i} height={40} radius={8} style={{ marginTop: 10 }} />)
      ) : shown.length === 0 ? (
        <div className="fin-empty">
          <p>{filtersActive ? 'Nothing matches these filters.' : 'No transactions yet.'}</p>
          {filtersActive && <button type="button" className="fin-link" onClick={() => { setType('all'); setQuery(''); }}>Clear filters</button>}
        </div>
      ) : (
        <>
          <DayFeed groups={groupByDay(shown, today)} onDelete={onDelete} freshKey={freshKey} />
          {hasMore && (
            <div className="fin-more"><button type="button" className="fin-btn fin-btn--ghost" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading…' : 'Show more'}</button></div>
          )}
        </>
      )}
    </section>
  );
}
```

Search only filters what's already loaded. When `hasMore` is true and a search is active, show the hint "Searching the loaded entries. Show more to search further." under the toolbar (add it as `{query && hasMore && <p className="fin-hint">…</p>}` after the totals line).

- [ ] **Step 2: Shell wiring**

Replace the Activity panel body:

```tsx
          {tab === 'activity' && (
            <ActivityTab today={today} range={data.range} setRange={data.setRange} summary={data.summary} upcoming={sts?.upcoming ?? null}
              recurringRules={data.recurringRules} goals={goals} hidden={hidden} freshKey={freshKey} onDelete={deleteItem}
              dataVersion={data.dataVersion} onRecurringChanged={() => { void data.refreshRecurring(); }} />
          )}
```

Remove the `TransactionsSection` import and delete `legacy/LegacyTransactions.tsx`.

- [ ] **Step 3: Append CSS**

```css
/* ── Activity (spec §9) ── */
.fin-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.fin-search { flex: 1 1 200px; display: flex; align-items: center; gap: 8px; background: rgba(255, 255, 255, 0.7); border: 1px solid var(--wb-hairline); border-radius: var(--wb-r-lg); padding: 0 12px; color: var(--wb-text-faint); }
.fin-search:focus-within { outline: 2px solid var(--wb-blue-strong); outline-offset: 1px; }
.fin-search input { border: 0; outline: none; background: transparent; font: inherit; font-size: var(--wb-fs-13); padding: 9px 0; width: 100%; color: var(--wb-text); }
.fin-totals { margin: 12px 0 2px; font-size: var(--wb-fs-13); font-weight: 600; color: var(--wb-text-muted); line-height: 1.6; white-space: normal; }
.fin-totals__cmp.is-up { color: var(--fin-expense-ink); font-weight: 700; }
.fin-totals__cmp.is-down { color: var(--fin-income-ink); font-weight: 700; }
.fin-recur { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 10px 0 2px; }
.fin-recur__chip {
  display: inline-flex; align-items: center; gap: 6px; font-size: var(--wb-fs-12); font-weight: 700; color: var(--wb-text-muted);
  background: rgba(255, 255, 255, 0.65); border: 1px solid var(--wb-glass-border); border-radius: var(--wb-r-lg); padding: 5px 6px 5px 10px;
}
.fin-recur__chip b { color: var(--wb-text); }
.fin-recur__x { border: 0; background: none; color: var(--wb-text-faint); width: 28px; height: 28px; border-radius: var(--wb-r-sm); display: grid; place-items: center; cursor: pointer; }
.fin-recur__x:focus-visible { outline: 2px solid var(--wb-blue-strong); }
@media (hover: hover) and (pointer: fine) { .fin-recur__x:hover { color: var(--wb-danger); background: var(--wb-danger-bg); } }
.fin-upcoming { background: rgba(255, 255, 255, 0.4); border: 1px dashed var(--fin-ghost-border); border-radius: var(--wb-r-xl); padding: 2px 14px 6px; margin: 12px 0; }
.fin-upcoming .fin-feed__head { border-bottom: 0; padding-bottom: 0; }
.fin-more { display: flex; justify-content: center; margin-top: 12px; }
@media (max-width: 700px) { .fin-toolbar > * { flex-basis: 100%; } }
```

- [ ] **Step 4: Verify**

- `npx tsc --noEmit` exits 0, the style gate is clean, and `node scripts/fin-test.mjs` passes.
- Playwright, Activity:
  - Type filter and Week/Month/All change the feed and the totals line.
  - Search filters the feed. The "Nothing matches" state offers **Clear filters**.
  - Upcoming shows the dashed box.
  - Stop a recurring rule through the confirm popover; its future rows disappear from Upcoming. Use a rule created during this testing, not one of the user's real rules, unless the user agrees.
  - Delete with Undo works as on Overview.
  - **Show more** appears only when more than 50 rows exist.
- At 390: toolbar items stack and nothing overflows.

✅ **CHECKPOINT (Phase 5):** run the phase checkpoint list. Activity screenshots at 390 / 820 / 1440. Wait for approval.

---
## Phase 6 — Goals tab: timeline, wishlist, What-if (spec §10)

### Task 22: Wishlist schema and routes

**Files:**
- Create: `financetracker/schema-phase5-wishlist.sql`, `src/app/api/finance/wishlist/route.ts`, `src/app/api/finance/wishlist/[id]/route.ts`
- Modify: `src/lib/migrate.ts`, `src/components/finance/types.ts`, `src/components/finance/useFinanceData.ts`

**Interfaces:**
- Consumes: `manilaToday` (Task 2); `isExpenseCategory` (Task 2).
- Produces:
  - `ensureFinanceWishlistSchema(): Promise<void>`
  - `GET /api/finance/wishlist` → `{ items: WishItem[] }` (open first, newest first)
  - `POST /api/finance/wishlist` `{ name, amount, category? }` → `{ wish_id }`
  - `PATCH /api/finance/wishlist/[id]` `{ action: 'buy' }` → `{ expense_id }`; `{ action: 'save' }` → `{ goal_id }`; `{ action: 'reopen' }` → `{ status: 'success' }`
  - `DELETE /api/finance/wishlist/[id]` → `{ status: 'success' }`
  - `interface WishItem { wish_id: number; name: string; amount: number; category: string; status: 'open' | 'bought' | 'goal'; goal_id: number | null; expense_id: number | null; created_at: string }`
  - Hook: `wishlist: WishItem[] | null`, `loadWishlist()`

- [ ] **Step 1: Record the DDL**

`financetracker/schema-phase5-wishlist.sql`:

```sql
-- Finance revamp, What-if D wishlist (spec §10.2). Applied automatically by
-- ensureFinanceWishlistSchema() in src/lib/migrate.ts; kept here as a record. Local DB only.
CREATE TABLE IF NOT EXISTS finance_wishlist (
  wish_id     INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  name        VARCHAR(120) NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  category    VARCHAR(40) NOT NULL DEFAULT 'leisure',
  status      ENUM('open','bought','goal') NOT NULL DEFAULT 'open',
  goal_id     INT NULL,
  expense_id  INT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_wishlist_user_status (user_id, status)
);
```

- [ ] **Step 2: `ensureFinanceWishlistSchema` in `migrate.ts`**

Add `let _ranFinanceWishlist = false;` with the other flags, and at the end of the file:

```ts
/** Finance revamp (spec §10.2): "Can I afford it?" wishlist. goal_id / expense_id are plain
 *  references, not FKs, so deleting a goal or expense elsewhere never blocks. */
export async function ensureFinanceWishlistSchema(): Promise<void> {
  if (_ranFinanceWishlist) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_wishlist (
      wish_id     INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      name        VARCHAR(120) NOT NULL,
      amount      DECIMAL(12,2) NOT NULL,
      category    VARCHAR(40) NOT NULL DEFAULT 'leisure',
      status      ENUM('open','bought','goal') NOT NULL DEFAULT 'open',
      goal_id     INT NULL,
      expense_id  INT NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_wishlist_user_status (user_id, status)
    )`);
  _ranFinanceWishlist = true;
}
```

- [ ] **Step 3: `wishlist/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureFinanceWishlistSchema } from '@/lib/migrate';
import { isExpenseCategory } from '@/lib/finance/categories';

const toItem = (r: RowDataPacket) => ({
  wish_id: Number(r.wish_id), name: String(r.name), amount: Number(r.amount), category: String(r.category),
  status: r.status as 'open' | 'bought' | 'goal', goal_id: r.goal_id === null ? null : Number(r.goal_id),
  expense_id: r.expense_id === null ? null : Number(r.expense_id), created_at: String(r.created_at),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureFinanceWishlistSchema();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM finance_wishlist WHERE user_id = ? ORDER BY status = 'open' DESC, created_at DESC, wish_id DESC`,
    [parseInt(session.user.id)]);
  return Response.json({ items: rows.map(toItem) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureFinanceWishlistSchema();
  const { name, amount, category } = await req.json();
  const cleanName = String(name ?? '').trim().slice(0, 120);
  const numAmount = Number(amount);
  if (!cleanName) return Response.json({ error: 'What do you want to buy?' }, { status: 400 });
  if (!numAmount || numAmount <= 0) return Response.json({ error: 'Amount must be greater than 0.' }, { status: 400 });
  const cat = isExpenseCategory(String(category ?? '')) ? String(category) : 'leisure';
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO finance_wishlist (user_id, name, amount, category) VALUES (?, ?, ?, ?)`,
    [parseInt(session.user.id), cleanName, numAmount, cat]);
  return Response.json({ wish_id: res.insertId });
}
```

- [ ] **Step 4: `wishlist/[id]/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ensureFinanceWishlistSchema } from '@/lib/migrate';
import { manilaToday } from '@/lib/finance/dates';

type Ctx = { params: Promise<{ id: string }> };

/* PATCH { action: 'buy' | 'save' | 'reopen' } (spec §10.2). Each action runs in one
   transaction so the wish and the expense/goal it creates can't disagree. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureFinanceWishlistSchema();
  const userId = parseInt(session.user.id);
  const wishId = parseInt((await params).id);
  const { action } = await req.json();
  if (!['buy', 'save', 'reopen'].includes(action)) return Response.json({ error: 'Invalid action.' }, { status: 400 });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(`SELECT * FROM finance_wishlist WHERE wish_id = ? AND user_id = ? FOR UPDATE`, [wishId, userId]);
    if (!rows.length) { await conn.rollback(); return Response.json({ error: 'Not found.' }, { status: 404 }); }
    const wish = rows[0];

    if (action === 'buy') {
      if (wish.status !== 'open') { await conn.rollback(); return Response.json({ error: 'Already handled.' }, { status: 409 }); }
      const [res] = await conn.execute<ResultSetHeader>(
        `INSERT INTO expenses (user_id, category, expense_amount, entry_date, status) VALUES (?, ?, ?, ?, 'actual')`,
        [userId, wish.category, wish.amount, manilaToday()]);
      await conn.execute(`UPDATE finance_wishlist SET status = 'bought', expense_id = ? WHERE wish_id = ?`, [res.insertId, wishId]);
      await conn.commit();
      return Response.json({ expense_id: res.insertId });
    }

    if (action === 'save') {
      if (wish.status !== 'open') { await conn.rollback(); return Response.json({ error: 'Already handled.' }, { status: 409 }); }
      const [res] = await conn.execute<ResultSetHeader>(
        `INSERT INTO savings_goals (user_id, goal_name, wishlist_amount, wishlist_category, target_date) VALUES (?, ?, ?, 'others', NULL)`,
        [userId, wish.name, wish.amount]);
      await conn.execute(`UPDATE finance_wishlist SET status = 'goal', goal_id = ? WHERE wish_id = ?`, [res.insertId, wishId]);
      await conn.commit();
      return Response.json({ goal_id: res.insertId });
    }

    // reopen: undo a buy or a save
    if (wish.expense_id) await conn.execute(`DELETE FROM expenses WHERE expense_id = ? AND user_id = ?`, [wish.expense_id, userId]);
    if (wish.goal_id) {
      const [entries] = await conn.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM savings_entries WHERE goal_id = ?`, [wish.goal_id]);
      if (Number(entries[0].n) > 0) { await conn.rollback(); return Response.json({ error: 'That goal already has savings logged, so it stays.' }, { status: 409 }); }
      await conn.execute(`DELETE FROM savings_goals WHERE goal_id = ? AND user_id = ?`, [wish.goal_id, userId]);
    }
    await conn.execute(`UPDATE finance_wishlist SET status = 'open', expense_id = NULL, goal_id = NULL WHERE wish_id = ?`, [wishId]);
    await conn.commit();
    return Response.json({ status: 'success' });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureFinanceWishlistSchema();
  await pool.execute(`DELETE FROM finance_wishlist WHERE wish_id = ? AND user_id = ?`, [parseInt((await params).id), parseInt(session.user.id)]);
  return Response.json({ status: 'success' });
}
```

- [ ] **Step 5: Type and hook**

Add `WishItem` to `types.ts` (shape above). In `useFinanceData.ts`, add `wishlist` state, a `loadWishlist` loader (GET `/api/finance/wishlist`, `[]` on failure), call it in the initial effect and in `refreshAll`, and return both.

- [ ] **Step 6: Verify**

`npx tsc --noEmit` → exit 0. In the logged-in Playwright browser, run this sequence with `browser_evaluate`. It creates test data, then removes it:

```js
async () => {
  const j = (u, o) => fetch(u, o && { method: o.method ?? 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o.body) }).then(r => r.json());
  const { wish_id } = await j('/api/finance/wishlist', { body: { name: 'TEST plan-check', amount: 10, category: 'leisure' } });
  const bought = await j(`/api/finance/wishlist/${wish_id}`, { method: 'PATCH', body: { action: 'buy' } });
  const reopened = await j(`/api/finance/wishlist/${wish_id}`, { method: 'PATCH', body: { action: 'reopen' } });
  const saved = await j(`/api/finance/wishlist/${wish_id}`, { method: 'PATCH', body: { action: 'save' } });
  const reopened2 = await j(`/api/finance/wishlist/${wish_id}`, { method: 'PATCH', body: { action: 'reopen' } });
  await fetch(`/api/finance/wishlist/${wish_id}`, { method: 'DELETE' });
  const list = await j('/api/finance/wishlist');
  return { bought, reopened, saved, reopened2, leftover: list.items.filter(i => i.name === 'TEST plan-check').length };
}
```

Expected: `bought.expense_id` and `saved.goal_id` are numbers, both reopens return `success`, and `leftover` is 0. Also check the TEST expense and TEST goal no longer exist: the feed has no ₱10 Leisure row today, and the summary goals have no "TEST plan-check".

---

### Task 23: Goal timeline, goal notes, new goal

**Files:**
- Create: `src/components/finance/goals/GoalTimeline.tsx`, `goals/GoalNotes.tsx`, `goals/NewGoalForm.tsx`
- Modify: `src/app/finance/finance.css`

**Interfaces:**
- Consumes: `timelineLayout`, `goalState`, `goalGuidance`, `goalMarkerDate`, `GoalState` (Task 4); `formatPeso`, `formatPesoWhole`; `formatFullDate`, `formatMonthYear`; `requestJson`, `parseAmount`, `ConfirmPopover`, `PesoField` (Task 14); `WbPopover`; `GoalProjection` (types).
- Produces:
  - `GoalTimeline({ goals, today })`
  - `GoalNotes({ goals, today, onAdd, onChanged })`, where `onAdd(goal: GoalProjection)`
  - `NewGoalForm({ onCreated, onCancel })`
  - `GOAL_STATE_META: Record<GoalState, { label: string; pill: string; dot: string }>` (exported from `GoalNotes.tsx`)

- [ ] **Step 1: `goals/GoalNotes.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import WbPopover from '@/components/workboard/ui/WbPopover';
import { goalGuidance, goalState, type GoalState } from '@/lib/finance/goals';
import { formatPesoWhole } from '@/lib/finance/format';
import { requestJson } from '../financeApi';
import type { GoalProjection } from '../types';

export const GOAL_STATE_META: Record<GoalState, { label: string; pill: string; dot: string }> = {
  date_passed: { label: 'Date passed', pill: 'fin-pill--warn', dot: 'var(--wb-warn)' },
  behind: { label: 'Behind', pill: 'fin-pill--warn', dot: 'var(--wb-warn)' },
  on_pace: { label: 'On pace', pill: 'fin-pill--success', dot: 'var(--wb-success)' },
  done: { label: 'Done', pill: 'fin-pill--success', dot: 'var(--wb-success)' },
  no_date: { label: 'No date', pill: 'fin-pill--purple', dot: 'var(--fin-savings)' },
};

function GoalMenu({ goal, anchor, startMode, onClose, onChanged }: {
  goal: GoalProjection; anchor: HTMLElement | null; startMode: 'menu' | 'date'; onClose: () => void; onChanged: () => void;
}) {
  const [mode, setMode] = useState<'menu' | 'date' | 'delete'>(startMode);
  const [date, setDate] = useState(goal.target_date ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); onChanged(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  };
  return (
    <WbPopover open={!!anchor} anchor={anchor} onClose={onClose} width={260} ariaLabel={`${goal.goal_name} options`} placement="bottom-end">
      <div className="fin-goalmenu">
        {mode === 'menu' && (
          <>
            <button type="button" className="fin-datechoice__opt" onClick={() => setMode('date')}>Change target date</button>
            <button type="button" className="fin-datechoice__opt fin-goalmenu__danger" onClick={() => setMode('delete')}>Delete goal</button>
          </>
        )}
        {mode === 'date' && (
          <form onSubmit={e => { e.preventDefault(); void run(() => requestJson(`/api/finance/goals/${goal.goal_id}/target`, { body: { target_date: date || null } })); }}>
            <label className="fin-field-label" htmlFor={`fin-goal-date-${goal.goal_id}`}>Target date</label>
            <div className="fin-field"><input id={`fin-goal-date-${goal.goal_id}`} type="date" value={date} onChange={e => setDate(e.target.value)} autoFocus /></div>
            <div className="fin-confirm__row">
              {goal.target_date && <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={busy} onClick={() => run(() => requestJson(`/api/finance/goals/${goal.goal_id}/target`, { body: { target_date: null } }))}>Clear</button>}
              <button type="submit" className="fin-btn fin-btn--primary fin-btn--sm" disabled={busy}>Save</button>
            </div>
          </form>
        )}
        {mode === 'delete' && (
          <>
            <p className="fin-confirm__title">Delete “{goal.goal_name}”?</p>
            <p className="fin-confirm__body">Goals with savings logged can&apos;t be deleted.</p>
            <div className="fin-confirm__row">
              <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={onClose}>Cancel</button>
              <button type="button" className="fin-btn fin-btn--danger fin-btn--sm" disabled={busy}
                onClick={() => run(() => requestJson('/api/finance/goals', { method: 'DELETE', body: { goal_id: goal.goal_id } }))}>Delete</button>
            </div>
          </>
        )}
        {error && <p className="fin-error" role="alert">{error}</p>}
      </div>
    </WbPopover>
  );
}

/* One note per goal under the timeline (spec §10.1): progress, one guidance sentence, Add, ⋯. */
export default function GoalNotes({ goals, today, onAdd, onChanged }: {
  goals: GoalProjection[]; today: string; onAdd: (g: GoalProjection) => void; onChanged: () => void;
}) {
  const [menu, setMenu] = useState<{ goal: GoalProjection; anchor: HTMLElement; mode: 'menu' | 'date' } | null>(null);
  const moreRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  return (
    <div className="fin-gnotes">
      {goals.map(g => {
        const state = goalState(g, today);
        const meta = GOAL_STATE_META[state];
        const guide = goalGuidance(g, today);
        const fill = g.target_amount > 0 ? Math.min(1, g.saved / g.target_amount) : 0;
        return (
          <article key={g.goal_id} className="fin-gnote" aria-labelledby={`fin-goal-${g.goal_id}`}>
            <div className="fin-gnote__head">
              <h3 className="fin-gnote__name" id={`fin-goal-${g.goal_id}`}>{g.goal_name}</h3>
              <span className={`fin-pill ${meta.pill} fin-push`}>{meta.label}</span>
            </div>
            <div className="fin-gnote__progress">
              <span className="fin-track" aria-hidden><span className="fin-track__fill" style={{ background: 'var(--fin-savings)', transform: `scaleX(${fill})` }} /></span>
              <span className="fin-num fin-gnote__amt">{formatPesoWhole(g.saved)} <span className="fin-hint">of {formatPesoWhole(g.target_amount)}</span></span>
            </div>
            <p className={`fin-gnote__msg is-${guide.tone}`}>
              {guide.text}{' '}
              {guide.action && (
                <button type="button" className="fin-link fin-link--underline" onClick={() => {
                  const anchor = moreRefs.current[g.goal_id];
                  if (anchor) setMenu({ goal: g, anchor, mode: 'date' });
                }}>{guide.action === 'pick_date' ? 'Pick a new date' : 'Set a date'}</button>
              )}
            </p>
            <div className="fin-gnote__actions">
              <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" onClick={() => onAdd(g)}><Plus size={14} aria-hidden /> Add</button>
              <button ref={el => { moreRefs.current[g.goal_id] = el; }} type="button" className="fin-btn fin-btn--ghost fin-btn--sm" aria-label={`${g.goal_name} options`}
                onClick={e => setMenu({ goal: g, anchor: e.currentTarget, mode: 'menu' })}>
                <MoreHorizontal size={16} aria-hidden />
              </button>
            </div>
          </article>
        );
      })}
      {menu && <GoalMenu key={`${menu.goal.goal_id}-${menu.mode}`} goal={menu.goal} anchor={menu.anchor} startMode={menu.mode} onClose={() => setMenu(null)} onChanged={onChanged} />}
    </div>
  );
}
```

- [ ] **Step 2: `goals/GoalTimeline.tsx`**

```tsx
'use client';

import { goalMarkerDate, goalState, timelineLayout } from '@/lib/finance/goals';
import { formatFullDate, formatMonthYear } from '@/lib/finance/dates';
import type { GoalProjection } from '../types';
import { GOAL_STATE_META } from './GoalNotes';

const AXIS_TOP = 128;
const CARD_H = 30;

/* Goals on a date axis with a Today marker (spec §10.1). Close markers stack into up to 3
   rows; more than 6 goals (or a narrow screen, via CSS) switches to a vertical list. */
export default function GoalTimeline({ goals, today }: { goals: GoalProjection[]; today: string }) {
  const layout = timelineLayout(goals, today);
  const byId = new Map(goals.map(g => [g.goal_id, g]));
  const sorted = goals.map(g => ({ g, date: goalMarkerDate(g) })).filter(x => x.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const describe = (g: GoalProjection, date: string) => {
    const state = goalState(g, today);
    return `${g.goal_name}: ${g.target_date ? `target ${formatFullDate(date)}` : `projected ${formatMonthYear(date)}`}${state === 'date_passed' ? ' (passed)' : ''}, ${Math.round(g.progress_percent)}% saved`;
  };

  const list = (
    <ol className="fin-tl-list">
      {sorted.map(({ g, date }) => (
        <li key={g.goal_id}>
          <span className="fin-tl-list__dot" style={{ background: GOAL_STATE_META[goalState(g, today)].dot }} aria-hidden />
          <b>{g.goal_name}</b>
          <span className="fin-hint fin-push">{g.target_date ? formatFullDate(date!) : `≈ ${formatMonthYear(date!)}`}{goalState(g, today) === 'date_passed' ? ' · passed' : ''}</span>
        </li>
      ))}
    </ol>
  );

  if (layout.useList) return <div className="fin-tl-wrap is-list">{list}</div>;

  return (
    <div className="fin-tl-wrap">
      <div className="fin-tl" aria-hidden>
        <div className="fin-tl__axis" style={{ top: AXIS_TOP }} />
        {layout.ticks.map(t => <span key={t.date} className="fin-tl__tick" style={{ left: `${t.pos}%`, top: AXIS_TOP + 8 }}>{t.label}</span>)}
        <div className="fin-tl__now" style={{ left: `${layout.todayPos}%` }}><span>Today</span></div>
        {layout.markers.map(m => {
          const g = byId.get(m.goal_id)!;
          const meta = GOAL_STATE_META[goalState(g, today)];
          const top = 76 - m.row * 34;
          return (
            <div key={m.goal_id} className="fin-tl__marker" style={{ left: `${m.pos}%`, top, color: meta.dot }}>
              <span className="fin-tl__card">
                {g.goal_name} · {Math.round(g.progress_percent)}%
                {goalState(g, today) === 'date_passed' ? <span className="fin-pill fin-pill--warn fin-tl__flag">passed</span>
                  : m.projected ? <span className="fin-hint">projected</span> : null}
              </span>
              <span className="fin-tl__stem" style={{ height: AXIS_TOP - top - CARD_H }} />
              <span className="fin-tl__dot" style={{ background: meta.dot }} />
            </div>
          );
        })}
      </div>
      <ol className="fin-sr-only">{sorted.map(({ g, date }) => <li key={g.goal_id}>{describe(g, date!)}</li>)}</ol>
      <div className="fin-tl-narrow">{list}</div>
    </div>
  );
}
```

- [ ] **Step 3: `goals/NewGoalForm.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { parseAmount, requestJson } from '../financeApi';
import PesoField from '../ui/PesoField';

export default function NewGoalForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const amount = parseAmount(target);
    if (!name.trim()) { setError('Give the goal a name.'); return; }
    if (!amount) { setError('Target amount must be greater than 0.'); return; }
    setBusy(true); setError('');
    try {
      await requestJson('/api/finance/goals', { body: { goal_name: name.trim(), wishlist_amount: amount, target_date: date || undefined } });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the goal.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="fin-editor" onSubmit={e => { e.preventDefault(); void save(); }} aria-label="New goal">
      <div className="fin-editor__grid">
        <div>
          <label className="fin-field-label" htmlFor="fin-goal-name">Goal name</label>
          <div className="fin-field"><input id="fin-goal-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Concert ticket" autoFocus /></div>
        </div>
        <PesoField id="fin-goal-target" label="Target" value={target} onChange={setTarget} />
        <div>
          <label className="fin-field-label" htmlFor="fin-goal-date">Target date (optional)</label>
          <div className="fin-field"><input id="fin-goal-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        </div>
      </div>
      {error && <p className="fin-error" role="alert">{error}</p>}
      <div className="fin-editor__actions">
        <button type="button" className="fin-btn fin-btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="fin-btn fin-btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Add goal'}</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Append CSS**

```css
/* ── Goals (spec §10.1) ── */
.fin-tl-wrap { margin: 8px 0 4px; }
.fin-tl { position: relative; height: 170px; margin: 0 12px; }
.fin-tl__axis { position: absolute; left: 0; right: 0; border-top: 2px solid rgba(45, 55, 72, 0.15); }
.fin-tl__tick { position: absolute; transform: translateX(-50%); font-size: var(--wb-fs-12); font-weight: 700; color: var(--wb-text-faint); white-space: nowrap; }
.fin-tl__now { position: absolute; top: 18px; height: 112px; width: 2px; background: var(--wb-pink); }
.fin-tl__now span { position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: var(--wb-fs-12); font-weight: 800; color: var(--fin-expense-ink); }
.fin-tl__marker { position: absolute; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; }
.fin-tl__card { display: inline-flex; align-items: center; gap: 8px; background: var(--wb-surface); color: var(--wb-text); border-radius: var(--wb-r-xl); padding: 6px 10px; box-shadow: var(--wb-shadow-card); font-size: var(--wb-fs-12); font-weight: 700; white-space: nowrap; height: 30px; }
.fin-tl__flag { padding: 1px 6px; }
.fin-tl__stem { width: 2px; background: rgba(45, 55, 72, 0.2); }
.fin-tl__dot { width: 13px; height: 13px; border-radius: 50%; border: 2.5px solid var(--wb-surface); box-shadow: 0 0 0 1.5px currentColor; margin-top: -1px; }
.fin-tl-list { list-style: none; margin: 0; padding: 0; }
.fin-tl-list li { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--wb-hairline); font-size: var(--wb-fs-14); }
.fin-tl-list__dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.fin-tl-narrow { display: none; }
@media (max-width: 640px) { .fin-tl { display: none; } .fin-tl-narrow { display: block; } }
.fin-gnotes { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 8px; }
.fin-gnote { background: var(--fin-card-solid); border: 1px solid var(--wb-glass-border); border-radius: var(--wb-r-xl); padding: 14px 16px; }
.fin-gnote__head { display: flex; align-items: center; gap: 8px; }
.fin-gnote__name { margin: 0; font-family: 'DM Sans', sans-serif; font-size: var(--wb-fs-16); font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fin-gnote__progress { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.fin-gnote__progress .fin-track { flex: 1; }
.fin-gnote__amt { font-size: var(--wb-fs-13); font-weight: 700; }
.fin-gnote__msg { margin: 10px 0 0; font-size: var(--wb-fs-13); font-weight: 600; line-height: 1.45; border-radius: var(--wb-r-lg); padding: 9px 11px; }
.fin-gnote__msg.is-warn { background: var(--wb-warn-bg); color: var(--wb-warn); }
.fin-gnote__msg.is-info { background: var(--fin-income-bg); color: var(--fin-income-ink); }
.fin-gnote__msg.is-success { background: var(--wb-success-bg); color: var(--wb-success); }
.fin-gnote__actions { display: flex; gap: 8px; margin-top: 10px; }
.fin-goalmenu { padding: 10px; display: grid; gap: 4px; }
.fin-goalmenu__danger { color: var(--wb-danger); }
```

- [ ] **Step 5: Verify**

`npx tsc --noEmit` exits 0, and the style gate is clean. These components are mounted in Task 26.

---

### Task 24: Wishlist UI ("Can I afford it?")

**Files:**
- Create: `src/components/finance/whatif/Wishlist.tsx`
- Modify: `src/app/finance/finance.css`

**Interfaces:**
- Consumes: `previewSpend`, `VERDICT_LABEL`, `SpendSnapshot` (Task 3); `formatPeso`, `formatPesoWhole`; `EXPENSE_CATEGORIES`, `categoryEmoji`, `categoryLabel`; `requestJson`, `parseAmount` (Task 14); `toastUndo`, `toastError`; `WbPopover`; `WishItem` (Task 22).
- Produces: `Wishlist({ items, snapshot, onChanged, onCheck })`, where `onCheck(amount: number, category: string)` loads the item into What-if.

- [ ] **Step 1: `whatif/Wishlist.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import WbPopover from '@/components/workboard/ui/WbPopover';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import { toastError, toastUndo } from '@/components/workboard/ui/WbToaster';
import { previewSpend, type SpendSnapshot, type Verdict } from '@/lib/finance/verdict';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { EXPENSE_CATEGORIES, categoryEmoji, categoryLabel } from '@/lib/finance/categories';
import { parseAmount, requestJson } from '../financeApi';
import type { WishItem } from '../types';

const PILL: Record<Verdict, string> = { comfortable: 'fin-pill--success', tight: 'fin-pill--warn', not_recommended: 'fin-pill--danger' };

/* "Can I afford it?" (spec §10.2). Verdicts are recomputed client-side from the loaded
   safe-to-spend snapshot, so they stay current without extra requests. */
export default function Wishlist({ items, snapshot, onChanged, onCheck }: {
  items: WishItem[] | null; snapshot: SpendSnapshot | null; onChanged: () => void; onCheck: (amount: number, category: string) => void;
}) {
  const [name, setName] = useState('');
  const [raw, setRaw] = useState('');
  const [category, setCategory] = useState('leisure');
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [menu, setMenu] = useState<{ item: WishItem; anchor: HTMLElement } | null>(null);

  if (items === null) return <>{[0, 1, 2].map(i => <WbSkeleton key={i} height={44} radius={8} style={{ marginBottom: 10 }} />)}</>;
  const open = items.filter(i => i.status === 'open');
  const done = items.filter(i => i.status !== 'open');

  const act = async (item: WishItem, action: 'buy' | 'save') => {
    try {
      await requestJson(`/api/finance/wishlist/${item.wish_id}`, { method: 'PATCH', body: { action } });
      onChanged();
      toastUndo(action === 'buy' ? `Bought ${item.name} · logged ${formatPeso(item.amount)}` : `“${item.name}” is now a goal`, async () => {
        try { await requestJson(`/api/finance/wishlist/${item.wish_id}`, { method: 'PATCH', body: { action: 'reopen' } }); }
        catch (e) { toastError(e instanceof Error ? e.message : 'Could not undo.'); }
        onChanged();
      });
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Something went wrong.', () => act(item, action));
    }
  };
  const add = async () => {
    const amount = parseAmount(raw);
    if (!name.trim()) { setError('What do you want to buy?'); return; }
    if (!amount) { setError('Enter an amount greater than 0.'); return; }
    setError('');
    try {
      await requestJson('/api/finance/wishlist', { body: { name: name.trim(), amount, category } });
      setName(''); setRaw('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that.');
    }
  };
  const remove = async (item: WishItem) => {
    await requestJson(`/api/finance/wishlist/${item.wish_id}`, { method: 'DELETE' });
    setMenu(null);
    onChanged();
  };

  return (
    <div className="fin-wish">
      {open.length === 0 && <p className="fin-hint fin-wish__empty">Thinking about buying something? Add it here to see if it fits.</p>}
      <ul className="fin-wish__list">
        {open.map(item => {
          const p = snapshot ? previewSpend(snapshot, item.amount) : null;
          const label = !p ? '…' : p.verdict === 'not_recommended' ? VERDICT_LABEL.not_recommended : `${VERDICT_LABEL[p.verdict]} · ${formatPesoWhole(p.after.perDay)}/day after`;
          const notNow = p?.verdict === 'not_recommended';
          return (
            <li key={item.wish_id} className="fin-wish__row">
              <span className="fin-ico fin-ico--out" aria-hidden>{categoryEmoji(item.category)}</span>
              <span className="fin-row__text">
                <span className="fin-row__title">{item.name}</span>
                <span className="fin-row__sub fin-num">{formatPeso(item.amount)} · {categoryLabel(item.category)}</span>
              </span>
              {p && <span className={`fin-pill ${PILL[p.verdict]} fin-num`}>{label}</span>}
              <span className="fin-wish__acts">
                <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={notNow} onClick={() => act(item, 'buy')}>Buy now</button>
                <button type="button" className={`fin-btn ${notNow ? 'fin-btn--primary' : 'fin-btn--ghost'} fin-btn--sm`} onClick={() => act(item, 'save')}>Save for it{notNow ? ' →' : ''}</button>
                <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" aria-label={`${item.name} options`} onClick={e => setMenu({ item, anchor: e.currentTarget })}><MoreHorizontal size={16} aria-hidden /></button>
              </span>
            </li>
          );
        })}
      </ul>
      {menu && (
        <WbPopover open anchor={menu.anchor} onClose={() => setMenu(null)} width={220} ariaLabel={`${menu.item.name} options`} placement="bottom-end">
          <div className="fin-goalmenu">
            <button type="button" className="fin-datechoice__opt" onClick={() => { onCheck(menu.item.amount, menu.item.category); setMenu(null); }}>Check in What if</button>
            {snapshot && previewSpend(snapshot, menu.item.amount).verdict === 'not_recommended' && (
              <button type="button" className="fin-datechoice__opt" onClick={() => { void act(menu.item, 'buy'); setMenu(null); }}>Buy anyway</button>
            )}
            <button type="button" className="fin-datechoice__opt fin-goalmenu__danger" onClick={() => remove(menu.item)}>Remove</button>
          </div>
        </WbPopover>
      )}
      <form className="fin-wish__add" onSubmit={e => { e.preventDefault(); void add(); }} aria-label="Add something you want">
        <Plus size={15} aria-hidden />
        <input className="fin-wish__name" placeholder="What do you want to buy?" aria-label="Item" value={name} onChange={e => setName(e.target.value)} />
        <input className="fin-wish__amt fin-num" placeholder="₱ 0.00" aria-label="Price" inputMode="decimal" value={raw} onChange={e => setRaw(e.target.value)} />
        <select className="fin-chip fin-chip--select" aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}>
          {EXPENSE_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button type="submit" className="fin-btn fin-btn--ghost fin-btn--sm">Check</button>
      </form>
      {error && <p className="fin-error" role="alert">{error}</p>}
      {done.length > 0 && (
        <>
          <button type="button" className="fin-link fin-wish__toggle" aria-expanded={showDone} onClick={() => setShowDone(s => !s)}>
            {showDone ? 'Hide' : 'Show'} {done.length} done
          </button>
          {showDone && (
            <ul className="fin-wish__list is-done">
              {done.map(item => (
                <li key={item.wish_id} className="fin-wish__row">
                  <span className="fin-ico fin-ico--out" aria-hidden>{categoryEmoji(item.category)}</span>
                  <span className="fin-row__text"><span className="fin-row__title">{item.name}</span><span className="fin-row__sub fin-num">{formatPeso(item.amount)}</span></span>
                  <span className="fin-hint">{item.status === 'bought' ? 'Bought' : 'Saving for it'}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Append CSS**

```css
/* ── Wishlist (spec §10.2) ── */
.fin-wish__list { list-style: none; margin: 0; padding: 0; }
.fin-wish__list.is-done { opacity: 0.7; }
.fin-wish__row { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto auto; gap: 14px; align-items: center; padding: 12px 0; border-top: 1px solid var(--wb-hairline); }
.fin-wish__row:first-child { border-top: 0; }
.fin-wish__acts { display: flex; gap: 6px; justify-content: flex-end; }
.fin-wish__empty { margin: 4px 0 8px; }
.fin-wish__add { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 12px; padding: 8px; border: 1.5px dashed var(--fin-ghost-border); border-radius: var(--wb-r-xl); color: var(--wb-text-faint); }
.fin-wish__add input { border: 0; background: rgba(255, 255, 255, 0.7); border-radius: var(--wb-r-md); padding: 8px 10px; font: inherit; font-size: var(--wb-fs-13); outline: none; color: var(--wb-text); }
.fin-wish__add input:focus-visible { outline: 2px solid var(--wb-blue-strong); }
.fin-wish__name { flex: 1 1 180px; }
.fin-wish__amt { width: 110px; }
.fin-wish__toggle { margin-top: 10px; }
@media (max-width: 700px) {
  .fin-wish__row { grid-template-columns: 36px minmax(0, 1fr); }
  .fin-wish__row .fin-pill, .fin-wish__acts { grid-column: 2; justify-content: flex-start; justify-self: start; }
}
```

- [ ] **Step 3: Verify**

`npx tsc --noEmit` exits 0, and the style gate is clean. The wishlist is mounted in Task 26.

---

### Task 25: What-if preview

**Files:**
- Create: `src/components/finance/whatif/WhatIfPreview.tsx`
- Modify: `src/app/finance/finance.css`

**Interfaces:**
- Consumes: `previewSpend`, `verdictZones` (Task 3); `PaceChart` (Task 11); `PaceSeries` (Task 5); `formatPeso`, `formatPesoWhole`; `EXPENSE_CATEGORIES`; `parseAmount`, `requestJson` (Task 14).
- Produces: `WhatIfPreview({ sts, series, initial, onRecord, onSaveForIt })`, where:
  - `initial: { amount: number; category: string }`
  - `onRecord(amount, category): Promise<void>`
  - `onSaveForIt(amount, category): Promise<void>`

- [ ] **Step 1: `whatif/WhatIfPreview.tsx`**

```tsx
'use client';

import { useState, type CSSProperties } from 'react';
import { previewSpend, verdictZones, type Verdict } from '@/lib/finance/verdict';
import { formatPeso, formatPesoWhole } from '@/lib/finance/format';
import { EXPENSE_CATEGORIES } from '@/lib/finance/categories';
import type { PaceSeries } from '@/lib/finance/pace';
import PaceChart from '../hero/PaceChart';
import { parseAmount, requestJson } from '../financeApi';
import type { SafeToSpendResponse } from '../types';

const VERDICT_TEXT: Record<Verdict, { label: string; pill: string }> = {
  comfortable: { label: 'Affordable', pill: 'fin-pill--success' },
  tight: { label: 'Affordable, but tight', pill: 'fin-pill--warn' },
  not_recommended: { label: 'Not recommended', pill: 'fin-pill--danger' },
};

/* What-if B (spec §10.3): drag or type an amount and the pace chart redraws live. All maths
   is client-side; Record it re-checks with /api/finance/what-if before writing. */
export default function WhatIfPreview({ sts, series, initial, onRecord, onSaveForIt }: {
  sts: SafeToSpendResponse | null; series: PaceSeries | null; initial: { amount: number; category: string };
  onRecord: (amount: number, category: string) => Promise<void>; onSaveForIt: (amount: number, category: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(initial.amount);
  const [raw, setRaw] = useState(String(initial.amount));
  const [category, setCategory] = useState(initial.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!sts || !series) return null;

  const balance = Math.max(0, Math.floor(sts.current_balance));
  const preview = previewSpend(sts, amount);
  const zones = verdictZones(sts);
  const zoneStyle = {
    '--fin-z1': `${balance ? (zones.tightFrom / balance) * 100 : 0}%`,
    '--fin-z2': `${balance ? (zones.notFrom / balance) * 100 : 0}%`,
  } as CSSProperties;
  const verdict = VERDICT_TEXT[preview.verdict];

  const record = async () => {
    setBusy(true); setError('');
    try {
      const server = await requestJson<{ after: { safe_to_spend: number } }>('/api/finance/what-if', { body: { type: 'expense', amount } });
      if (Math.abs(server.after.safe_to_spend - preview.after.safe) > 1) {
        setError('Your numbers just changed. Check the preview again before recording.');
        return;
      }
      await onRecord(amount, category);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="fin-card" aria-labelledby="fin-whatif-title">
      <div className="fin-card__head">
        <h2 className="fin-card__title" id="fin-whatif-title">What if I spend…</h2>
        <select className="fin-chip fin-chip--select is-on" aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}>
          {EXPENSE_CATEGORIES.map(([k, l, emoji]) => <option key={k} value={k}>{emoji} {l}</option>)}
        </select>
        <label className="fin-whatif__amount fin-push">
          <span aria-hidden>₱</span>
          <input inputMode="decimal" aria-label="Amount" className="fin-num" value={raw}
            onChange={e => { setRaw(e.target.value); const n = parseAmount(e.target.value); setAmount(n ?? 0); }} />
        </label>
      </div>
      {balance > 0 ? (
        <>
          <input type="range" className="fin-slider" style={zoneStyle} min={0} max={balance} step={50} value={Math.min(amount, balance)}
            aria-label="Amount to preview" aria-valuetext={`${formatPeso(amount)}, ${verdict.label}`}
            onChange={e => { const n = Number(e.target.value); setAmount(n); setRaw(String(n)); }} />
          <div className="fin-slider__zones" aria-hidden><span>Comfortable</span><span>Tight</span><span>Not recommended</span></div>
        </>
      ) : (
        <p className="fin-hint">Nothing left to spend until your next allowance.</p>
      )}
      <PaceChart series={series} tall whatIf={amount > 0 ? { amount, afterPerDay: preview.after.perDay } : null}
        label={`Preview: spending ${formatPeso(amount)} today changes your daily budget to ${formatPesoWhole(preview.after.perDay)}`} />
      <div className="fin-whatif__verdict">
        <span className={`fin-pill ${verdict.pill}`}>{verdict.label}</span>
        <span className="fin-hint fin-num fin-whatif__line">
          Safe to spend {formatPesoWhole(preview.before.safe)} → {formatPesoWhole(preview.after.safe)} ·{' '}
          {preview.billsCovered ? 'bills still covered ✓' : <span className="fin-whatif__risk">bills at risk</span>}
        </span>
        <span className="fin-push fin-whatif__acts">
          <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={busy || amount <= 0} onClick={record}>Record it</button>
          <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm" disabled={amount <= 0} onClick={() => onSaveForIt(amount, category)}>Save for it instead →</button>
        </span>
      </div>
      {error && <p className="fin-error" role="alert">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 2: Append CSS**

```css
/* ── What-if (spec §10.3) ── */
.fin-whatif__amount { display: flex; align-items: center; gap: 2px; color: var(--fin-expense-ink); font-size: var(--wb-fs-24); font-weight: 800; }
.fin-whatif__amount input { border: 0; background: transparent; font: inherit; color: inherit; width: 130px; text-align: right; outline: none; }
.fin-whatif__amount:focus-within { box-shadow: 0 2px 0 var(--wb-blue-strong); }
.fin-slider {
  width: 100%; margin: 12px 0 2px; -webkit-appearance: none; appearance: none; height: 6px; border-radius: 6px;
  background: linear-gradient(90deg, var(--wb-success) 0 var(--fin-z1), var(--wb-warn) var(--fin-z1) var(--fin-z2), var(--wb-danger) var(--fin-z2));
}
.fin-slider:focus-visible { outline: 2px solid var(--wb-blue-strong); outline-offset: 6px; }
.fin-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 24px; height: 24px; border-radius: 50%; background: var(--wb-surface); border: 3px solid var(--wb-pink); box-shadow: var(--wb-shadow-pop); cursor: grab; }
.fin-slider::-moz-range-thumb { width: 20px; height: 20px; border-radius: 50%; background: var(--wb-surface); border: 3px solid var(--wb-pink); cursor: grab; }
.fin-slider__zones { display: flex; justify-content: space-between; font-size: var(--wb-fs-12); font-weight: 700; color: var(--wb-text-faint); margin-bottom: 18px; }
.fin-whatif__verdict { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
.fin-whatif__line { font-size: var(--wb-fs-13); white-space: normal; }
.fin-whatif__risk { color: var(--wb-danger); }
.fin-whatif__acts { display: flex; gap: 8px; }
@media (max-width: 700px) { .fin-slider::-webkit-slider-thumb { width: 32px; height: 32px; } }
```

- [ ] **Step 3: Verify**

`npx tsc --noEmit` exits 0, and the style gate is clean. The preview is mounted in Task 26.

---

### Task 26: Goals tab assembly and legacy removal

**Files:**
- Create: `src/components/finance/tabs/GoalsTab.tsx`
- Modify: `src/components/finance/FinanceShell.tsx`, `src/app/finance/finance.css`
- Delete: `src/components/finance/legacy/` (entire folder: `LegacyGoals.tsx`, `LegacyHero.tsx`, `LegacyStyles.tsx`, `shared.tsx`, plus anything left)

**Interfaces:**
- Consumes: Tasks 22–25; `createTransaction`, `deleteTransaction`, `requestJson`; `toastUndo`, `toastInfo`.
- Produces: `GoalsTab({ goals, today, sts, series, wishlist, onChanged, onAddToGoal, onRecord, onSaveForIt })`.

- [ ] **Step 1: `tabs/GoalsTab.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';
import { formatPesoWhole } from '@/lib/finance/format';
import type { PaceSeries } from '@/lib/finance/pace';
import GoalTimeline from '../goals/GoalTimeline';
import GoalNotes from '../goals/GoalNotes';
import NewGoalForm from '../goals/NewGoalForm';
import Wishlist from '../whatif/Wishlist';
import WhatIfPreview from '../whatif/WhatIfPreview';
import type { GoalProjection, SafeToSpendResponse, WishItem } from '../types';

export default function GoalsTab({ goals, today, sts, series, wishlist, onChanged, onAddToGoal, onRecord, onSaveForIt }: {
  goals: GoalProjection[] | null; today: string; sts: SafeToSpendResponse | null; series: PaceSeries | null; wishlist: WishItem[] | null;
  onChanged: () => void; onAddToGoal: (g: GoalProjection) => void;
  onRecord: (amount: number, category: string) => Promise<void>; onSaveForIt: (amount: number, category: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [seed, setSeed] = useState<{ amount: number; category: string; n: number }>(() => ({
    amount: Math.min(2500, Math.max(0, Math.floor((sts?.current_balance ?? 0) / 2))), category: 'leisure', n: 0,
  }));
  const whatIfRef = useRef<HTMLDivElement>(null);
  const totalSaved = (goals ?? []).reduce((s, g) => s + g.saved, 0);

  return (
    <>
      <section className="fin-card" aria-labelledby="fin-goals-title">
        <div className="fin-card__head">
          <h2 className="fin-card__title" id="fin-goals-title">Goals</h2>
          {goals && goals.length > 0 && <span className="fin-hint fin-num">{formatPesoWhole(totalSaved)} saved across {goals.length} goal{goals.length === 1 ? '' : 's'}</span>}
          <button type="button" className="fin-btn fin-btn--ghost fin-btn--sm fin-push" onClick={() => setCreating(c => !c)}><Plus size={14} aria-hidden /> New goal</button>
        </div>
        {creating && <NewGoalForm onCreated={() => { setCreating(false); onChanged(); }} onCancel={() => setCreating(false)} />}
        {goals === null ? (
          <WbSkeleton height={170} radius={12} />
        ) : goals.length === 0 ? (
          !creating && <div className="fin-empty"><p>No goals yet. Add one to start saving toward it.</p></div>
        ) : (
          <>
            <GoalTimeline goals={goals} today={today} />
            <GoalNotes goals={goals} today={today} onAdd={onAddToGoal} onChanged={onChanged} />
          </>
        )}
      </section>

      <section className="fin-card" aria-labelledby="fin-wish-title">
        <div className="fin-card__head">
          <h2 className="fin-card__title" id="fin-wish-title">Can I afford it?</h2>
          <span className="fin-hint">Verdicts update as your money changes</span>
        </div>
        <Wishlist items={wishlist} snapshot={sts} onChanged={onChanged}
          onCheck={(amount, category) => { setSeed(s => ({ amount, category, n: s.n + 1 })); whatIfRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} />
      </section>

      <div ref={whatIfRef}>
        <WhatIfPreview key={seed.n} sts={sts} series={series} initial={seed} onRecord={onRecord} onSaveForIt={onSaveForIt} />
      </div>
    </>
  );
}
```

Under reduced motion `scrollIntoView` should be instant: pass `behavior: prefersReducedMotion() ? 'auto' : 'smooth'` (import from `@/lib/workboard/ui/tokens`).

- [ ] **Step 2: Shell wiring**

Add `requestJson` to the shell's `./financeApi` import (it already imports `createTransaction`, `deleteTransaction`). Replace the Goals panel body:

```tsx
          {tab === 'goals' && (
            <GoalsTab
              goals={data.summary ? data.summary.goals : null} today={today} sts={sts} series={series} wishlist={data.wishlist}
              onChanged={() => { void data.refreshAll(); }}
              onAddToGoal={g => openDrawer({ type: 'savings', goalId: g.goal_id })}
              onRecord={async (amount, category) => {
                const { id } = await createTransaction({ type: 'expense', amount, entry_date: today, category });
                void data.refreshAll();
                toastUndo(`Logged ${formatPeso(amount)} · ${categoryLabel(category)}`, async () => { await deleteTransaction('expense', id); void data.refreshAll(); });
              }}
              onSaveForIt={async (amount, category) => {
                await requestJson('/api/finance/wishlist', { body: { name: `${categoryLabel(category)} purchase`, amount, category } });
                void data.loadWishlist();
                toastInfo('Added to your wishlist');
              }}
            />
          )}
```

- [ ] **Step 3: Delete the legacy bridge**

Remove the `LegacyStyles`, `GoalTracker` and `WhatIf` imports and the `<LegacyStyles />` element from the shell. Delete `src/components/finance/legacy/`.

- [ ] **Step 4: Grep gates**

Run each; all must return nothing:

```bash
grep -rn "legacy/" src/components/finance src/app/finance
grep -rnE "\balert\(|\bconfirm\(|\bprompt\(" src/components/finance src/app/finance
grep -rn "toISOString().slice(0, 10)" src/components/finance src/lib/finance src/app/api/finance
grep -rn "style jsx" src/components/finance
```

Then run the style gate on every Finance file:

```bash
node scripts/wb-style-gate.mjs src/app/finance/finance.css src/app/finance/*.tsx $(find src/components/finance src/lib/finance -name "*.ts" -o -name "*.tsx" | grep -v __tests__)
```

Expected: `style gate clean`.

- [ ] **Step 5: Verify behaviour**

- `npx tsc --noEmit` exits 0 and `node scripts/fin-test.mjs` passes.
- Playwright, Goals tab:
  - The timeline shows "New Freezer" left of Today with "passed", and "Concert" on the right as projected. Notes show the guidance sentences.
  - "Pick a new date" opens the date popover. Save a date and the timeline moves the marker; set it back afterwards.
  - "＋ Add" opens the drawer on Savings with that goal selected.
  - Add a wishlist item "TEST shoes ₱2,500": the verdict pill shows. **Save for it**: a goal appears on the timeline. Undo removes it. Remove the TEST item.
  - Drag the What-if slider: the chart redraws, and the verdict changes at the zone boundaries.
  - "Check in What if" from a wish loads its amount.
  - At 390: the timeline becomes the list, and the wishlist rows wrap.

✅ **CHECKPOINT (Phase 6):** run the phase checkpoint list. Goals screenshots at 390 / 820 / 1440. Wait for approval.

---

## Phase 7 — Motion and QA (spec §11–§14)

### Task 27: Motion audit, then motion implementation

**Files:**
- Create: `docs/superpowers/plans/2026-10-18-finance-revamp-motion-audit.md`
- Modify: whichever Finance component/CSS files the audit names

- [ ] **Step 1: Audit (read-only)**

Invoke the `improve-animations` skill scoped to `src/components/finance/**` and `src/app/finance/finance.css`. Give it spec §11 and the Global Constraints motion rules as binding. It writes its prioritised findings and self-contained fix plans to `docs/superpowers/plans/2026-10-18-finance-revamp-motion-audit.md`. It must at least check each of these:
- bar grow on first load and on value change (PaceChart key replay)
- hero count-up only on change
- logged-row tint
- tab crossfade
- drawer enter/exit
- popover origins
- `.fin-env` press
- envelope `scaleX` fills
- the reduced-motion block
- keyboard-opened drawer (`instant`)

- [ ] **Step 2: Implement**

Invoke the `animate` skill for each P1/P2 item in the audit, one at a time. Keep `transform`/`opacity` only and the `--wb-ease*` / 120–240ms values.

- [ ] **Step 3: Verify**

- The style gate is clean on the touched files, and `npx tsc --noEmit` exits 0.
- Playwright: `browser_emulate_media` with `reducedMotion: 'reduce'`, log an expense, open the drawer and switch tabs. Nothing moves (opacity ≤120ms is allowed).
- Without reduced motion, record what changed in the audit file's "Done" section.

---

### Task 28: Stress test, reviews, final audit, log

**Files:**
- Modify: Finance files as findings require; `financetracker-log.md`; `C:\Users\LENOVO\.claude\projects\c--xampp-htdocs-VibeBoard\memory\project_vibeboard_migration.md`

- [ ] **Step 1: break-ui (worst-case data)**

Invoke `break-ui` against the Finance tabs. Don't ship a demo toggle. Feed the worst cases by intercepting the Finance API responses in the Playwright browser (`browser_run_code` with `page.route('**/api/finance/**', …)`, returning modified JSON). The cases:
- ₱1,000,000+ amounts
- 0, 1 and 200 transactions
- 12 goals (must switch to the list)
- 40-character goal and wish names
- no active plan
- a plan with no allowance yet
- no allowance ever (pace window from today − 6)
- a negative safe-to-spend with a shortfall advisory
- a `days_until_next_allowance` of 0

Fix every break it reports; re-run until clean.

- [ ] **Step 2: mobile-native pass**

Invoke `mobile-native` on the 390px layout:
- the dock's safe-area inset
- 16px inputs (no zoom)
- tap highlights
- the bottom sheet's drag/scroll behaviour
- the toast offset above the dock
- `100vh` usage

Fix the findings.

- [ ] **Step 3: Emil review**

Invoke `emil-design-eng` to review the finished Finance UI (screenshots plus code) for polish and interaction feel. Apply the fixes it marks as clear improvements that stay within the spec. List any it proposes that would change the spec, and ask the user about those instead of applying them.

- [ ] **Step 4: impeccable audit**

Invoke `impeccable` (audit, then polish) on `/finance`. It checks:
- contrast ≥ 4.5:1 against `#eae8f4`
- touch targets ≥ 24px desktop and ≥ 40px phone
- focus-visible on every control
- tab and drawer keyboard flow
- no horizontal scroll at 390 / 820 / 1440

Fix all P1 findings; list the P2+ ones for the user.

- [ ] **Step 5: Whole-revamp code review**

Invoke `superpowers:requesting-code-review` over every file this plan touched. Ask the reviewer to look specifically for:
- cross-task interactions per-task review couldn't see
- refresh races (`refreshAll` while a deferred delete is pending)
- stale `today` after midnight (the shell computes it once per mount; acceptable, but confirm nothing writes a stale date into the DB: all writes pass `today` from the client, so a tab left open past midnight logs to the previous day; if the reviewer flags this, recompute `manilaToday()` at submit time in `logExpense`, `LogDrawer`, `onRecord`)
- any remaining UTC date arithmetic

Fix every Critical and Important finding.

- [ ] **Step 6: Final verification**

- `npx tsc --noEmit`, `node scripts/fin-test.mjs`, the full-Finance style gate and the four grep gates from Task 26 all pass.
- `curl` `/finance` returns 307 unauthenticated.
- Playwright screenshots of all four tabs at 390 / 820 / 1440 with a clean console.

- [ ] **Step 7: Record history**

Append a new section to `financetracker-log.md`, "## 38. Finance revamp (2026-10-18)", summarising:
- what shipped
- the date bugs fixed (summary/budgets ranges, recurring 6-day stepping, UTC "today")
- the new tables and routes (`finance_wishlist`, `log-context`, `feed`, `wishlist`)
- the retired pieces (Activity Breakdown card, Where Spending Went, the inline Transactions form, the old Budget Progress list)
- any open follow-ups from Steps 3–4

Update the Finance Revamp line in the project memory file to "shipped", with the date and those follow-ups.

✅ **CHECKPOINT (Final):** present the screenshots, the review summary and the open follow-ups to the user. Do not commit unless asked; if asked, follow the Global Constraints commit rule.
