# Dashboard Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `/dashboard` with a one-screen live home: a header, a Today strip with slim quote/weather rows, three image tiles with live chips, and a Workboard strip.

**Architecture:**
- Pure helpers (`src/lib/dashboard/*`, `src/lib/workboard/dashboardDigest.ts`) are unit-tested with `node:test`.
- A server-only builder (`src/lib/dashboard/summary.ts`) composes existing module libs. Each section is isolated, so one failure never blanks the page.
- `page.tsx` stays a server component. It passes the un-awaited summary promise to a client `DashboardBody`, which unwraps it with React 19 `use()` inside small `<Suspense>` slots. The header and artwork paint at once, and the numbers stream in.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, mysql2, plain CSS (`dashboard.css`), `node:test` via the repo's transpile-and-run scripts, Playwright MCP for fit checks.

**Spec:** `docs/superpowers/specs/2026-10-30-dashboard-revamp-design.md`
**Approved mockup:** `.superpowers/brainstorm/2502-1793320217/content/layout-v8.html`. Open it at 100% zoom; it is the visual source of truth for spacing, sizes and colours.

## Global Constraints

- **Commits:** no `Co-Authored-By` or any Claude attribution line in commit messages (standing user rule). Use the subject prefix `Dashboard:`, or `Workboard:`/`StudyPulse:`/`Weather:` when the change is in that area.
- **Before every commit:** run `git status`. This repo sometimes holds unrelated staged work. Stage only this task's files by path; never use `git add -A` or `git add .`.
- **No new npm dependencies.**
- **Time zone:** every "today/now" is Asia/Manila (`manilaClock` in Task 1).
- **Background:** the `.vb-bg` animated gradient in `globals.css` is unchanged.
- **No editing on the dashboard:** it never edits Workboard, habits or finance data; it only links (spec D1).
- **One screen on desktop:** at ≥1024px wide the page fits the viewport at 100% zoom with no scroll. Gates: 1366×657, 1536×730, 1920×945 viewports.
- **Text contrast:** ≥ 4.5:1. Muted text is `#6b6b80`; ink is `#2b2b3a`.
- **Motion:**
  - Easing `cubic-bezier(0.23, 1, 0.32, 1)`.
  - Every animation is disabled under `prefers-reduced-motion: reduce`.
  - Hover effects only under `@media (hover: hover) and (pointer: fine)`.
- **Browser storage:** every `localStorage`/`sessionStorage` access is wrapped in try/catch.
- **Gates that must stay green after every task:**
  - `npx tsc --noEmit -p .` (baseline: exit 0)
  - `node scripts/wb-test.mjs` (17 pass at baseline)
  - `node scripts/fin-test.mjs` (61)
  - `node scripts/sp-test.mjs` (104)
  - `node scripts/auth-test.mjs` (24)
  - From Task 1 on, also `node scripts/dash-test.mjs`.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `scripts/dash-test.mjs` | create | transpile + run `src/lib/dashboard` tests |
| `src/lib/dashboard/types.ts` | create | `Section`, `DashboardSummary`, `HeaderData` types |
| `src/lib/dashboard/section.ts` | create | `section()` isolation wrapper |
| `src/lib/dashboard/headerLine.ts` | create | `manilaClock`, `greetingFor`, `weekOfTerm`, `dateLine` |
| `src/lib/dashboard/nextClass.ts` | create | `pickNextClass`, `timeLabel` |
| `src/lib/dashboard/weatherTip.ts` | create | `weatherTip`, `remainingRainChances` |
| `src/lib/workboard/dashboardDigest.ts` | create | `buildWorkboardDigest`, `dueChip` |
| `src/lib/studypulse/gpaScale.ts` | create | `convertToGPA` (moved) |
| `src/lib/studypulse/gpaSummary.ts` | create | `getCustomPeriodGrade`, `getOverallGPA` (moved) |
| `src/app/api/studypulse/stats/route.ts` | modify | import the moved functions |
| `src/lib/dashboard/summary.ts` | create | `buildDashboardSummary`, `getHeaderData` (server-only) |
| `src/app/api/dashboard/summary/route.ts` | create | auth + JSON for client retry |
| `src/app/api/weather/route.ts` | modify | `current.json` → `forecast.json?days=1` |
| `src/app/workboard/page.tsx`, `src/components/workboard/WorkboardShell.tsx` | modify | `?item=` opens that item's detail |
| `src/app/dashboard/dashboard.css` | create | all dashboard styles |
| `src/components/dashboard/useMotion.ts` | create | `useEntranceMotion`, `useCountUp` |
| `src/components/dashboard/DashboardHeader.tsx` | create | date line, title, Sign-Out, avatar |
| `src/components/dashboard/ProfilePopover.tsx` | create | avatar account popover |
| `src/components/dashboard/TodayStrip.tsx` | create | 4 cells, loading/error/setup states |
| `src/components/dashboard/QuoteRow.tsx`, `WeatherRow.tsx` | create | slim side rows |
| `src/components/dashboard/ModuleTile.tsx` | create | glass tile + title-row chip |
| `src/components/dashboard/WorkboardStrip.tsx` | create | header, Up next, week + day filter |
| `src/components/dashboard/DashboardBody.tsx` | create | client body; `use()` slots; retry |
| `src/app/dashboard/page.tsx` | rewrite | server page assembly |
| `src/components/dashboard/QuoteWidget.tsx`, `WeatherWidget.tsx` | delete | replaced by the rows |

---

### Task 1: Dashboard test runner + pure header helpers + types

**Files:**
- Create: `scripts/dash-test.mjs`, `src/lib/dashboard/types.ts`, `src/lib/dashboard/section.ts`, `src/lib/dashboard/headerLine.ts`
- Test: `src/lib/dashboard/__tests__/headerLine.test.ts`, `src/lib/dashboard/__tests__/section.test.ts`

**Interfaces:**
- Produces:
  - `manilaClock(now?: Date): { date: string; hour: number; hhmm: string }`
  - `greetingFor(hour: number): string`
  - `weekOfTerm(start: string | null, end: string | null, today: string): number | null`
  - `dateLine(today: string, hour: number, week: number | null): string`
  - `section<T>(label: string, run: () => Promise<T>): Promise<Section<T>>`
  - `types.ts`: `Section<T>`, `FinanceTone`, `HabitsToday`, `FinanceToday`, `StudyToday`, `HeaderData`. `DashboardSummary` is added in Task 6, once its section types exist, so `tsc` stays green after every task.

- [ ] **Step 1: Create the runner** `scripts/dash-test.mjs`. It is the same mechanism as `scripts/wb-test.mjs`, rooted at `src/lib/dashboard`, and skips the pool-importing `summary.ts`:

```js
#!/usr/bin/env node
// Dashboard unit tests. Same approach as scripts/wb-test.mjs: transpile the pool-free src/lib/dashboard
// modules with the project's TypeScript and run node:test on *.test.ts.
// Usage: node scripts/dash-test.mjs [substring-filter]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const ROOT = 'src/lib/dashboard';
// Modules that import the DB pool. Never transpiled here; tests may only `import type` from them.
const SERVER = /[\\/]summary\.ts$/;
const out = mkdtempSync(join(tmpdir(), 'dash-test-'));
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
    .replace(/(from\s+['"])@\/lib\/dashboard\/([^'"]+)(['"])/g, (_, a, p, b) => {
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
if (selected.length === 0) { console.error('no dashboard tests matched'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...selected], { stdio: 'inherit' });
process.exit(r.status ?? 1);
```

- [ ] **Step 2: Create `src/lib/dashboard/types.ts`:**

```ts
/** Dashboard summary contract (spec §4.1). Pool-free: safe to import from client components. */

/** One independently-loaded part of the dashboard. `ok: false` = that query failed; the rest
 *  of the page still renders and the cell offers a retry. */
export type Section<T> = { ok: true; data: T } | { ok: false };

export type FinanceTone = 'on_track' | 'tight' | 'over';

export interface HabitsToday  { done: number; total: number; bestStreak: number }
export interface FinanceToday { perDay: number; safeTotal: number; tone: FinanceTone }
export interface StudyToday   { gpa: number }

export interface HeaderData {
  dateLine:        string;
  weekOfTerm:      number | null;
  canvasConnected: boolean;
}
```

- [ ] **Step 3: Write the failing tests.**

`src/lib/dashboard/__tests__/headerLine.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manilaClock, greetingFor, weekOfTerm, dateLine } from '../headerLine';

test('manilaClock reads Asia/Manila wall time', () => {
  assert.deepEqual(manilaClock(new Date('2026-10-30T07:30:00Z')), { date: '2026-10-30', hour: 15, hhmm: '15:30' });
});
test('manilaClock rolls the date past Manila midnight', () => {
  assert.deepEqual(manilaClock(new Date('2026-10-30T17:05:00Z')), { date: '2026-10-31', hour: 1, hhmm: '01:05' });
});
test('greeting boundaries', () => {
  assert.equal(greetingFor(0), 'Good morning');
  assert.equal(greetingFor(11), 'Good morning');
  assert.equal(greetingFor(12), 'Good afternoon');
  assert.equal(greetingFor(17), 'Good afternoon');
  assert.equal(greetingFor(18), 'Good evening');
});
test('weekOfTerm counts 7-day weeks from the start date', () => {
  assert.equal(weekOfTerm('2026-09-14', '2026-12-12', '2026-09-14'), 1);
  assert.equal(weekOfTerm('2026-09-14', '2026-12-12', '2026-09-20'), 1);
  assert.equal(weekOfTerm('2026-09-14', '2026-12-12', '2026-09-21'), 2);
  assert.equal(weekOfTerm('2026-09-14', '2026-12-12', '2026-10-30'), 7);
});
test('weekOfTerm is null outside the term or without a start', () => {
  assert.equal(weekOfTerm(null, null, '2026-10-30'), null);
  assert.equal(weekOfTerm('2026-11-01', null, '2026-10-30'), null);
  assert.equal(weekOfTerm('2026-06-01', '2026-08-30', '2026-10-30'), null);
});
test('dateLine joins weekday, week and greeting; omits a missing week', () => {
  assert.equal(dateLine('2026-10-30', 15, 7), 'Friday, Oct 30 · Week 7 · Good afternoon');
  assert.equal(dateLine('2026-10-30', 8, null), 'Friday, Oct 30 · Good morning');
});
```

`src/lib/dashboard/__tests__/section.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { section } from '../section';

test('wraps a resolved value', async () => {
  assert.deepEqual(await section('x', async () => 5), { ok: true, data: 5 });
});
test('keeps a null "not set up" value as ok', async () => {
  assert.deepEqual(await section('x', async () => null), { ok: true, data: null });
});
test('turns a rejection into ok:false instead of throwing', async () => {
  const orig = console.error; console.error = () => {};
  try {
    assert.deepEqual(await section('x', async () => { throw new Error('db down'); }), { ok: false });
  } finally { console.error = orig; }
});
```

- [ ] **Step 4: Run them and confirm they fail.** Run `node scripts/dash-test.mjs`. Expected: FAIL (cannot find module `../headerLine.mjs` / `../section.mjs`).

- [ ] **Step 5: Implement.**

`src/lib/dashboard/section.ts`:

```ts
import type { Section } from './types';

/** Runs one dashboard query in isolation: a failure is logged and becomes `{ ok: false }` so
 *  the other sections still render (spec §4.1, fail-open like the verify-banner lookup). */
export async function section<T>(label: string, run: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (err) {
    console.error(`[dashboard] ${label}`, err);
    return { ok: false };
  }
}
```

`src/lib/dashboard/headerLine.ts`:

```ts
/** Header date line (spec §5.1). Pool-free. All dates are "YYYY-MM-DD" Manila calendar days. */

export function manilaClock(now: Date = new Date()): { date: string; hour: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), hhmm: `${get('hour')}:${get('minute')}` };
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** 1-based week of the term; null before the start, after the end, or with no start date. */
export function weekOfTerm(start: string | null, end: string | null, today: string): number | null {
  if (!start || today < start || (end && today > end)) return null;
  return Math.floor((dayMs(today) - dayMs(start)) / 86_400_000 / 7) + 1;
}

/** "Friday, Oct 30 · Week 7 · Good afternoon". */
export function dateLine(today: string, hour: number, week: number | null): string {
  const label = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  return [label, week ? `Week ${week}` : null, greetingFor(hour)].filter(Boolean).join(' · ');
}
```

- [ ] **Step 6: Run the tests and confirm they pass.** Run `node scripts/dash-test.mjs`. Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 7: Commit.**

```bash
git status
git add scripts/dash-test.mjs src/lib/dashboard/types.ts src/lib/dashboard/section.ts src/lib/dashboard/headerLine.ts src/lib/dashboard/__tests__/headerLine.test.ts src/lib/dashboard/__tests__/section.test.ts
git commit -m "Dashboard: test runner, summary types, section isolation and header date line"
```

---

### Task 2: Next-class picker

**Files:**
- Create: `src/lib/dashboard/nextClass.ts`
- Test: `src/lib/dashboard/__tests__/nextClass.test.ts`

**Interfaces:**
- Consumes: the `ClassOccurrence` type from `@/lib/workboard/aggregate` (type-only; `aggregate.ts` imports the pool, so never a value import).
- Produces:
  - `interface NextClass { courseCode: string; date: string; startTime: string; timeLabel: string; when: string; place: string | null }`
  - `pickNextClass(occ: ClassOccurrence[], today: string, nowHHMM: string): NextClass | null`
  - `timeLabel(hhmm: string): string`

Rules:
- Skip `override.modality === 'cancelled'`.
- Skip the original slot of a rescheduled class (`override.modality === 'rescheduled'` with no `moved_from`). The make-up occurrence (`moved_from` set) counts.
- A class still counts until its `end_time` has passed, which yields `when: 'now'`.
- Place:
  - an online override (`online_sync`/`online_async`), or `modality !== 'face_to_face'` with no override → `'Online'`;
  - otherwise `override.room ?? venue`.

- [ ] **Step 1: Write the failing test** `src/lib/dashboard/__tests__/nextClass.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClassOccurrence } from '@/lib/workboard/aggregate';
import { pickNextClass, timeLabel } from '../nextClass';

let n = 0;
function occ(p: Partial<ClassOccurrence>): ClassOccurrence {
  n += 1;
  return {
    block_id: n, user_subject_id: null, course_code: `CS00${n}`, subject_name: null, section: null,
    instructor: null, meeting_link: null, trimester: null, year_level: null, units: null,
    date: '2026-10-30', start_time: '13:00', end_time: '14:30', venue: 'Rm 402', is_online: false,
    modality: 'face_to_face', override: null, ...p,
  } as ClassOccurrence;
}
const ov = (modality: string, extra: Record<string, unknown> = {}) =>
  ({ id: 1, modality, note: null, room: null, moved_date: null, moved_start_time: null, moved_end_time: null, ...extra }) as ClassOccurrence['override'];

test('timeLabel drops :00 and uses 12-hour time', () => {
  assert.equal(timeLabel('13:00'), '1 PM');
  assert.equal(timeLabel('13:30'), '1:30 PM');
  assert.equal(timeLabel('00:15'), '12:15 AM');
  assert.equal(timeLabel('12:00'), '12 PM');
});
test('picks the earliest class that has not ended', () => {
  const later = occ({ start_time: '16:00', end_time: '17:30' });
  const soon = occ({ start_time: '13:00', end_time: '14:30' });
  const r = pickNextClass([later, soon], '2026-10-30', '10:00');
  assert.equal(r?.courseCode, soon.course_code);
  assert.equal(r?.when, 'today');
  assert.equal(r?.timeLabel, '1 PM');
  assert.equal(r?.place, 'Rm 402');
});
test('an in-progress class reads "now"', () => {
  const r = pickNextClass([occ({ start_time: '13:00', end_time: '14:30' })], '2026-10-30', '13:40');
  assert.equal(r?.when, 'now');
});
test('rolls to tomorrow, then to a weekday label', () => {
  const ended = occ({ start_time: '08:00', end_time: '09:00' });
  const tmrw = occ({ date: '2026-10-31', start_time: '09:00', end_time: '10:00' });
  assert.equal(pickNextClass([ended, tmrw], '2026-10-30', '12:00')?.when, 'tomorrow');
  const mon = occ({ date: '2026-11-02', start_time: '09:00', end_time: '10:00' });
  assert.equal(pickNextClass([ended, mon], '2026-10-30', '12:00')?.when, 'Mon');
});
test('skips cancelled classes and the original slot of a rescheduled one', () => {
  const cancelled = occ({ override: ov('cancelled') });
  const ghost = occ({ start_time: '14:00', end_time: '15:00', override: ov('rescheduled') });
  const makeup = occ({ start_time: '16:00', end_time: '17:00', override: ov('rescheduled'), moved_from: '2026-10-29' });
  assert.equal(pickNextClass([cancelled, ghost, makeup], '2026-10-30', '10:00')?.courseCode, makeup.course_code);
});
test('online classes and room overrides set the place', () => {
  assert.equal(pickNextClass([occ({ override: ov('online_sync') })], '2026-10-30', '10:00')?.place, 'Online');
  assert.equal(pickNextClass([occ({ modality: 'online_async' })], '2026-10-30', '10:00')?.place, 'Online');
  assert.equal(pickNextClass([occ({ override: ov('room', { room: 'Lab 2' }) })], '2026-10-30', '10:00')?.place, 'Lab 2');
});
test('null when nothing is left', () => {
  assert.equal(pickNextClass([], '2026-10-30', '10:00'), null);
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `node scripts/dash-test.mjs nextClass`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/dashboard/nextClass.ts`:

```ts
/** Today strip "Next class" (spec §4.1, §5.2). Pool-free; fed by getWorkboardWeek's occurrences,
 *  which already carry cancellations and make-up reschedules. */
import type { ClassOccurrence } from '@/lib/workboard/aggregate';

export interface NextClass {
  courseCode: string;
  date:       string;   // "YYYY-MM-DD"
  startTime:  string;   // "HH:MM"
  timeLabel:  string;   // "1 PM"
  when:       string;   // "now" | "today" | "tomorrow" | "Mon"
  place:      string | null;
}

export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

function isLive(o: ClassOccurrence, today: string, now: string): boolean {
  const m = o.override?.modality;
  if (m === 'cancelled') return false;
  if (m === 'rescheduled' && !o.moved_from) return false;   // the moved-away original slot
  return o.date > today || (o.date === today && o.end_time > now);
}

function placeOf(o: ClassOccurrence): string | null {
  const m = o.override?.modality;
  if (m === 'online_sync' || m === 'online_async') return 'Online';
  if (!m && o.modality !== 'face_to_face') return 'Online';
  return o.override?.room ?? o.venue;
}

export function pickNextClass(occ: ClassOccurrence[], today: string, nowHHMM: string): NextClass | null {
  const next = occ
    .filter(o => isLive(o, today, nowHHMM))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time))[0];
  if (!next) return null;
  const when = next.date === today
    ? (next.start_time <= nowHHMM ? 'now' : 'today')
    : next.date === nextDay(today)
      ? 'tomorrow'
      : new Date(`${next.date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return {
    courseCode: next.course_code, date: next.date, startTime: next.start_time,
    timeLabel: timeLabel(next.start_time), when, place: placeOf(next),
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `node scripts/dash-test.mjs`. Expected: all pass, `# fail 0`.

- [ ] **Step 5: Commit.**

```bash
git status
git add src/lib/dashboard/nextClass.ts src/lib/dashboard/__tests__/nextClass.test.ts
git commit -m "Dashboard: next-class picker honouring cancellations and make-up classes"
```

---

### Task 3: Weather tip rules + forecast route

**Files:**
- Create: `src/lib/dashboard/weatherTip.ts`
- Modify: `src/app/api/weather/route.ts:10-13`
- Test: `src/lib/dashboard/__tests__/weatherTip.test.ts`

**Interfaces:**
- Produces:
  - `type TipTone = 'heat' | 'rain' | 'calm'`
  - `interface WeatherTip { icon: string; text: string; tone: TipTone }`
  - `interface TipInput { conditionText: string; tempC: number; feelsLikeC: number; upcomingRainChances: number[] }`
  - `weatherTip(w: TipInput): WeatherTip`
  - `remainingRainChances(hours: { time_epoch: number; chance_of_rain: number }[] | undefined, nowEpochSec: number): number[]`

Rules are checked in order, and the first match wins (spec §5.3). WeatherAPI uses "Patchy rain nearby" and "… possible" for *possible* rain, so that wording is rule 3, not rule 2.

- [ ] **Step 1: Write the failing test** `src/lib/dashboard/__tests__/weatherTip.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherTip, remainingRainChances } from '../weatherTip';

const w = (conditionText: string, tempC = 28, feelsLikeC = 30, upcomingRainChances: number[] = []) =>
  weatherTip({ conditionText, tempC, feelsLikeC, upcomingRainChances });

test('1 thunder beats everything', () => {
  assert.equal(w('Moderate or heavy rain with thunder', 36, 40).text, 'Storm out, stay in if you can');
});
test('2 raining now', () => {
  for (const c of ['Light rain', 'Patchy light drizzle', 'Moderate rain shower']) {
    const t = w(c);
    assert.equal(t.text, "Bring an umbrella, it's raining", c);
    assert.equal(t.tone, 'rain');
  }
});
test('3 rain later today, or "possible/nearby" rain wording', () => {
  assert.equal(w('Partly cloudy', 30, 33, [10, 65]).text, 'Pack an umbrella just in case');
  assert.equal(w('Patchy rain nearby').text, 'Pack an umbrella just in case');
  assert.equal(w('Patchy rain possible').text, 'Pack an umbrella just in case');
});
test('4 scorching feels-like', () => {
  const t = w('Sunny', 33, 36);
  assert.equal(t.text, 'Scorching out: umbrella + water');
  assert.equal(t.tone, 'heat');
});
test('5 hot and sunny', () => {
  assert.equal(w('Sunny', 31, 34).text, 'Hot outside, stay hydrated');
  assert.equal(w('Clear', 30, 33).text, 'Hot outside, stay hydrated');
});
test('6 cloudy is a good time to head out', () => {
  for (const c of ['Partly cloudy', 'Cloudy', 'Overcast']) assert.equal(w(c, 29, 31).text, 'Shady skies, good time to head out', c);
});
test('7 haze', () => {
  for (const c of ['Mist', 'Fog', 'Haze']) assert.equal(w(c).text, 'Hazy out, take it slow', c);
});
test('8 default', () => {
  const t = w('Sunny', 26, 27);
  assert.equal(t.text, 'Nice out, enjoy a walk');
  assert.equal(t.tone, 'calm');
});
test('order: 60% rain later beats heat', () => {
  assert.equal(w('Sunny', 34, 38, [70]).text, 'Pack an umbrella just in case');
});
test('remainingRainChances keeps only hours after now', () => {
  const hours = [{ time_epoch: 100, chance_of_rain: 90 }, { time_epoch: 200, chance_of_rain: 20 }, { time_epoch: 300, chance_of_rain: 70 }];
  assert.deepEqual(remainingRainChances(hours, 150), [20, 70]);
  assert.deepEqual(remainingRainChances(undefined, 150), []);
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `node scripts/dash-test.mjs weatherTip`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/dashboard/weatherTip.ts`:

```ts
/** Condition-based weather tip (spec §5.3, D11). Pool-free; runs in the client WeatherRow. */
export type TipTone = 'heat' | 'rain' | 'calm';
export interface WeatherTip { icon: string; text: string; tone: TipTone }
export interface TipInput {
  conditionText:       string;
  tempC:               number;
  feelsLikeC:          number;
  /** chance_of_rain (0-100) for each remaining hour today; [] when no forecast. */
  upcomingRainChances: number[];
}

const RULES: Array<{ when: (w: TipInput, c: string) => boolean; tip: WeatherTip }> = [
  { when: (_, c) => /thunder/.test(c),
    tip: { icon: '⛈', text: 'Storm out, stay in if you can', tone: 'rain' } },
  { when: (_, c) => /rain|drizzle|shower|sleet/.test(c) && !/possible|nearby/.test(c),
    tip: { icon: '☔', text: "Bring an umbrella, it's raining", tone: 'rain' } },
  { when: (w, c) => /possible|nearby/.test(c) || w.upcomingRainChances.some(p => p >= 60),
    tip: { icon: '🌂', text: 'Pack an umbrella just in case', tone: 'rain' } },
  { when: w => w.feelsLikeC >= 35,
    tip: { icon: '🥵', text: 'Scorching out: umbrella + water', tone: 'heat' } },
  { when: (w, c) => /sunny|clear/.test(c) && w.tempC >= 30,
    tip: { icon: '☀️', text: 'Hot outside, stay hydrated', tone: 'heat' } },
  { when: (_, c) => /cloud|overcast/.test(c),
    tip: { icon: '☁️', text: 'Shady skies, good time to head out', tone: 'calm' } },
  { when: (_, c) => /fog|mist|haze/.test(c),
    tip: { icon: '🌫', text: 'Hazy out, take it slow', tone: 'calm' } },
];
const FALLBACK: WeatherTip = { icon: '🌤', text: 'Nice out, enjoy a walk', tone: 'calm' };

export function weatherTip(w: TipInput): WeatherTip {
  const c = w.conditionText.trim().toLowerCase();
  return RULES.find(r => r.when(w, c))?.tip ?? FALLBACK;
}

export function remainingRainChances(
  hours: { time_epoch: number; chance_of_rain: number }[] | undefined,
  nowEpochSec: number,
): number[] {
  return (hours ?? []).filter(h => h.time_epoch > nowEpochSec).map(h => Number(h.chance_of_rain));
}
```

- [ ] **Step 4: Switch the weather route to the forecast endpoint.** In `src/app/api/weather/route.ts`, replace the fetch URL:

```ts
  // forecast.json returns the same `location` + `current` blocks as current.json, plus today's
  // hourly chance_of_rain for the "rain later" tip. Still one request.
  const res = await fetch(
    `https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${encodeURIComponent(q)}&days=1&aqi=no&alerts=no`,
    { next: { revalidate: 300 } },
  );
```

- [ ] **Step 5: Run the tests and typecheck.** Run `node scripts/dash-test.mjs`, then `npx tsc --noEmit -p .`. Expected: tests all pass, and `tsc` exits 0.

- [ ] **Step 6: Commit.**

```bash
git status
git add src/lib/dashboard/weatherTip.ts src/lib/dashboard/__tests__/weatherTip.test.ts src/app/api/weather/route.ts
git commit -m "Weather: condition-based tip rules and forecast endpoint for rain-later"
```

---

### Task 4: Workboard digest

**Files:**
- Create: `src/lib/workboard/dashboardDigest.ts`
- Test: `src/lib/workboard/ui/__tests__/dashboardDigest.test.ts` (inside the tree `scripts/wb-test.mjs` walks)

**Interfaces:**
- Consumes:
  - `rankUpNext`, `UP_NEXT_LIMIT` (`./ui/upNext`)
  - `itemKey` (`./ui/itemKey`)
  - `shortCourseCode` (`./ui/courseCode`)
  - `computeStats`, `computeWorkloadChart` (`./workStats`)
  - `addDays`, `dueDateOf`, `daysSince` (`./dates`)
  - `STAGE_LABELS`, `CONTEXT_LABELS`, `isRevisionStage`, `isWaitingStage`, `normaliseStage` (`./workContexts`)
- Produces:

```ts
export type StageTone = 'todo' | 'progress' | 'waiting' | 'revision';
export interface DueChip { top: string; bottom: string | null; late: boolean }
export interface DigestItem {
  key: string; href: string; title: string;
  context: WorkContext; contextLabel: string;
  stageLabel: string; stageTone: StageTone;
  priority: 'high' | 'normal' | 'low';
  subtasks: { done: number; total: number } | null;
  estimatedHours: number | null;
  due: DueChip | null;
}
export interface DigestDay { date: string; counts: Record<WorkContext, number>; total: number; items: DigestItem[] }
export interface WorkboardDigest {
  hasAnyItems: boolean;
  overdue: number; inProgress: number; dueThisWeek: number;
  doneThisWeek: number; totalThisWeek: number;
  upNext: DigestItem[];      // ≤ 4
  week: DigestDay[];         // 7, Monday first
}
export function dueChip(due: string | null, time: string | null, today: string, revision: boolean): DueChip | null;
export function buildWorkboardDigest(items: WorkItem[], today: string, weekStart: string): WorkboardDigest;
```

Definitions:
- **Up next** = `rankUpNext` (Workboard's own Focus order). If that gives fewer than 4, top up with the other not-done items due within `today+7`, by due date then time.
- **Counts:**
  - `overdue` = `computeStats().overdue_count`
  - `inProgress` = `computeStats().in_progress_count`
  - `dueThisWeek` = sum of `computeWorkloadChart` totals (not-done items due Mon–Sun)
  - `doneThisWeek` = items whose `completed_at` date falls Mon–Sun
  - `totalThisWeek` = `dueThisWeek + doneThisWeek`
- **Day items:** each day's not-done items due that date, untimed last, at most 4.
- **Context label:**
  - academic with `course_code` → `shortCourseCode(course_code)`
  - else `project_name ?? organization_name ?? chip_label ?? CONTEXT_LABELS[context]`

- [ ] **Step 1: Write the failing test** `src/lib/workboard/ui/__tests__/dashboardDigest.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkItem } from '../../workItems';
import { buildWorkboardDigest, dueChip } from '../../dashboardDigest';

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
const T = '2026-10-30';          // Friday
const WS = '2026-10-26';         // its Monday

test('dueChip labels', () => {
  assert.deepEqual(dueChip('2026-10-28', '23:59:00', T, false), { top: '2d late', bottom: 'Wed 11:59 PM', late: true });
  assert.deepEqual(dueChip('2026-10-30', '23:59:00', T, false), { top: 'Today', bottom: '11:59 PM', late: false });
  assert.deepEqual(dueChip('2026-10-31', null, T, false), { top: 'Tomorrow', bottom: null, late: false });
  assert.deepEqual(dueChip('2026-11-02', null, T, false), { top: 'Mon', bottom: 'Nov 2', late: false });
  assert.deepEqual(dueChip('2026-11-12', '17:00:00', T, false), { top: 'Nov 12', bottom: '5 PM', late: false });
  assert.equal(dueChip(null, null, T, false), null);
});
test('a past-due revision item is never "late"', () => {
  assert.equal(dueChip('2026-10-28', null, T, true)?.late, false);
});
test('up next: overdue first, topped up to 4 from the coming week', () => {
  const late = mk({ due_at: '2026-10-28' });
  const today = mk({ due_at: '2026-10-30' });
  const nextWed = mk({ due_at: '2026-11-04' });           // within 7 days, todo: not rankUpNext material
  const nextThu = mk({ due_at: '2026-11-05' });
  const farAway = mk({ due_at: '2026-12-01' });
  const d = buildWorkboardDigest([farAway, nextThu, today, nextWed, late], T, WS);
  assert.deepEqual(d.upNext.map(i => i.key), [late, today, nextWed, nextThu].map(i => `owned-${i.id}`));
  assert.equal(d.upNext[0].href, `/workboard?item=owned-${late.id}`);
});
test('counts and week buckets', () => {
  const items = [
    mk({ due_at: '2026-10-27', context: 'academic', category: 'academic' }),                  // overdue, this week
    mk({ due_at: '2026-10-30', work_status: 'in_progress', work_stage: 'in_progress' }),        // today, in progress
    mk({ due_at: '2026-10-30', context: 'life', category: 'life' }),
    mk({ due_at: '2026-10-29', work_status: 'done', work_stage: 'done', completed_at: '2026-10-29 10:00:00' }),
    mk({ due_at: '2026-11-03' }),                                                              // next week
  ];
  const d = buildWorkboardDigest(items, T, WS);
  assert.equal(d.hasAnyItems, true);
  assert.equal(d.overdue, 1);
  assert.equal(d.inProgress, 1);
  assert.equal(d.dueThisWeek, 3);
  assert.equal(d.doneThisWeek, 1);
  assert.equal(d.totalThisWeek, 4);
  assert.equal(d.week.length, 7);
  assert.equal(d.week[0].date, WS);
  assert.equal(d.week[4].total, 2);
  assert.deepEqual(d.week[4].counts, { academic: 0, project: 1, organization: 0, life: 1 });
  assert.equal(d.week[4].items.length, 2);
});
test('labels: course code, stage tone, subtasks', () => {
  const a = mk({ context: 'academic', category: 'academic', course_code: '3TSY2526_CS0061L_TN3', due_at: '2026-10-30',
                 work_stage: 'submitted', work_status: 'in_progress', subtask_total: 5, subtask_done: 2 });
  const [item] = buildWorkboardDigest([a], T, WS).upNext;
  assert.equal(item.contextLabel, 'CS0061L');
  assert.equal(item.stageTone, 'revision');
  assert.equal(item.stageLabel, 'For Revision');
  assert.deepEqual(item.subtasks, { done: 2, total: 5 });
});
test('empty board', () => {
  const d = buildWorkboardDigest([], T, WS);
  assert.equal(d.hasAnyItems, false);
  assert.deepEqual(d.upNext, []);
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `node scripts/wb-test.mjs dashboardDigest`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `src/lib/workboard/dashboardDigest.ts`:

```ts
/** The dashboard's read-only Workboard strip (dashboard spec §5.5). Pool-free; reuses Focus's own
 *  Up next ranking so the two never disagree about what comes next. */
import type { WorkItem } from '@/lib/workboard/workItems';
import type { WorkContext } from '@/lib/workboard/workContexts';
import { CONTEXT_LABELS, STAGE_LABELS, isRevisionStage, isWaitingStage, normaliseStage } from '@/lib/workboard/workContexts';
import { addDays, daysSince, dueDateOf } from '@/lib/workboard/dates';
import { computeStats, computeWorkloadChart } from '@/lib/workboard/workStats';
import { rankUpNext, UP_NEXT_LIMIT } from '@/lib/workboard/ui/upNext';
import { itemKey } from '@/lib/workboard/ui/itemKey';
import { shortCourseCode } from '@/lib/workboard/ui/courseCode';

export type StageTone = 'todo' | 'progress' | 'waiting' | 'revision';
export interface DueChip { top: string; bottom: string | null; late: boolean }
export interface DigestItem {
  key: string; href: string; title: string;
  context: WorkContext; contextLabel: string;
  stageLabel: string; stageTone: StageTone;
  priority: 'high' | 'normal' | 'low';
  subtasks: { done: number; total: number } | null;
  estimatedHours: number | null;
  due: DueChip | null;
}
export interface DigestDay { date: string; counts: Record<WorkContext, number>; total: number; items: DigestItem[] }
export interface WorkboardDigest {
  hasAnyItems: boolean;
  overdue: number; inProgress: number; dueThisWeek: number;
  doneThisWeek: number; totalThisWeek: number;
  upNext: DigestItem[];
  week: DigestDay[];
}

const fmt = (date: string, o: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });

function clock(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function dueChip(due: string | null, time: string | null, today: string, revision: boolean): DueChip | null {
  if (!due) return null;
  const t = clock(time);
  if (due < today && !revision) {
    return { top: `${daysSince(due, today)}d late`, bottom: [fmt(due, { weekday: 'short' }), t].filter(Boolean).join(' '), late: true };
  }
  if (due <= today)              return { top: 'Today', bottom: t, late: false };
  if (due === addDays(today, 1)) return { top: 'Tomorrow', bottom: t, late: false };
  if (due <= addDays(today, 6))  return { top: fmt(due, { weekday: 'short' }), bottom: t ?? fmt(due, { month: 'short', day: 'numeric' }), late: false };
  return { top: fmt(due, { month: 'short', day: 'numeric' }), bottom: t, late: false };
}

function toneOf(item: WorkItem): StageTone {
  if (isRevisionStage(item.work_stage)) return 'revision';
  if (isWaitingStage(item.work_stage))  return 'waiting';
  return normaliseStage(item.work_stage) === 'in_progress' ? 'progress' : 'todo';
}

function labelOf(item: WorkItem): string {
  if (item.context === 'academic' && item.course_code) return shortCourseCode(item.course_code);
  return item.project_name ?? item.organization_name ?? item.chip_label ?? CONTEXT_LABELS[item.context];
}

function toDigest(item: WorkItem, today: string): DigestItem {
  const key = itemKey(item);
  return {
    key, href: `/workboard?item=${key}`, title: item.title,
    context: item.context, contextLabel: labelOf(item),
    stageLabel: STAGE_LABELS[item.work_stage] ?? 'To Do', stageTone: toneOf(item),
    priority: item.priority,
    subtasks: item.subtask_total > 0 ? { done: item.subtask_done, total: item.subtask_total } : null,
    estimatedHours: item.estimated_hours,
    due: dueChip(dueDateOf(item), item.deadline_time, today, isRevisionStage(item.work_stage)),
  };
}

const byDueThenTime = (a: WorkItem, b: WorkItem) =>
  (dueDateOf(a) ?? '9999').localeCompare(dueDateOf(b) ?? '9999')
  || (a.deadline_time ?? '99').localeCompare(b.deadline_time ?? '99')
  || a.title.localeCompare(b.title);

export function buildWorkboardDigest(items: WorkItem[], today: string, weekStart: string): WorkboardDigest {
  const weekEnd = addDays(weekStart, 6);
  const horizon = addDays(today, 7);
  const stats = computeStats(items, today, weekStart);
  const load = computeWorkloadChart(items, weekStart);

  const ranked = rankUpNext(items, today);
  const shown = new Set(ranked.map(itemKey));
  const topUp = items
    .filter(i => i.work_status !== 'done' && !shown.has(itemKey(i)))
    .filter(i => { const d = dueDateOf(i); return d !== null && d <= horizon; })
    .sort(byDueThenTime);
  const upNext = [...ranked, ...topUp].slice(0, UP_NEXT_LIMIT).map(i => toDigest(i, today));

  const week: DigestDay[] = load.map(day => ({
    date: day.date,
    counts: { academic: day.academic, project: day.project, organization: day.organization, life: day.life },
    total: day.total,
    items: items
      .filter(i => i.work_status !== 'done' && dueDateOf(i) === day.date)
      .sort(byDueThenTime)
      .slice(0, UP_NEXT_LIMIT)
      .map(i => toDigest(i, today)),
  }));

  const dueThisWeek = load.reduce((s, d) => s + d.total, 0);
  const doneThisWeek = items.filter(i => {
    const c = i.completed_at?.slice(0, 10);
    return c !== undefined && c >= weekStart && c <= weekEnd;
  }).length;

  return {
    hasAnyItems: items.length > 0,
    overdue: stats.overdue_count, inProgress: stats.in_progress_count,
    dueThisWeek, doneThisWeek, totalThisWeek: dueThisWeek + doneThisWeek,
    upNext, week,
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run `node scripts/wb-test.mjs`. Expected: `# fail 0` (17 previous + 6 new). If `upNext` order differs, re-read `rankUpNext`'s tiers in `src/lib/workboard/ui/upNext.ts`; the test encodes them (overdue, today, then the 7-day top-up).

- [ ] **Step 5: Typecheck.** Run `npx tsc --noEmit -p .`. Expected: exit 0.

- [ ] **Step 6: Commit.**

```bash
git status
git add src/lib/workboard/dashboardDigest.ts src/lib/workboard/ui/__tests__/dashboardDigest.test.ts
git commit -m "Workboard: read-only dashboard digest built on Focus's Up next ranking"
```

---

### Task 5: Extract the GPA calculation from the stats route

**Files:**
- Create: `src/lib/studypulse/gpaScale.ts`, `src/lib/studypulse/gpaSummary.ts`
- Modify: `src/app/api/studypulse/stats/route.ts` (remove lines 6-15 and the `getCustomPeriodGrade`/`getOverallGPA` bodies; add an import)
- Test: `src/lib/studypulse/__tests__/gpaScale.test.ts` (run by `scripts/sp-test.mjs`)

**Interfaces:**
- Produces:
  - `convertToGPA(grade: number): number`
  - `getCustomPeriodGrade(userSubjectId: number, namePattern: RegExp): Promise<number | null>`
  - `getOverallGPA(userId: number, term: 'midterm' | 'final'): Promise<number>`

This is a **move, not a rewrite**: the function bodies must stay identical.

- [ ] **Step 1: Write the failing test** `src/lib/studypulse/__tests__/gpaScale.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertToGPA } from '../gpaScale';

test('band edges match the stats route scale', () => {
  const cases: Array<[number, number]> = [
    [69.99, 0.5], [70, 1.0], [74.9, 1.0], [75, 1.5], [80, 2.0], [84.9, 2.0],
    [85, 2.5], [88.9, 2.5], [89, 3.0], [92, 3.0], [92.5, 3.5], [96, 3.5], [96.1, 4.0], [100, 4.0],
  ];
  for (const [g, gpa] of cases) assert.equal(convertToGPA(g), gpa, String(g));
});
```

- [ ] **Step 2: Run it and confirm it fails.** Run `node scripts/sp-test.mjs gpaScale`. Expected: FAIL (module not found).

- [ ] **Step 3: Move the code.**
  1. Create `src/lib/studypulse/gpaScale.ts`. Paste `convertToGPA` exactly as it is now at `src/app/api/studypulse/stats/route.ts:6-15`, adding `export` and a one-line header comment: `/** Percentage grade -> 4.0-scale GPA band, shared by the Study Pulse stats route and the dashboard. Pool-free. */`.
  2. Create `src/lib/studypulse/gpaSummary.ts` with these imports:
     ```ts
     /** Overall GPA across a user's subjects (moved verbatim from the stats route so the dashboard can reuse it). Server-only. */
     import pool from '@/lib/db';
     import type { RowDataPacket } from 'mysql2';
     import { convertToGPA } from './gpaScale';
     ```
     Below them, paste `getCustomPeriodGrade` (with its doc comment block above it, from roughly line 140) and `getOverallGPA` (roughly lines 253-305), unchanged except for adding `export` to both.
  3. In the route, delete those three function definitions. Add `import { convertToGPA } from '@/lib/studypulse/gpaScale';` only if something left in the route still calls it (check with grep). Add `import { getOverallGPA } from '@/lib/studypulse/gpaSummary';`, plus `getCustomPeriodGrade` if anything left in the route still calls it.
  4. Run `grep -n "convertToGPA\|getCustomPeriodGrade\|getOverallGPA" src/app/api/studypulse/stats/route.ts`. Expected: only the import line(s) and the two `getOverallGPA(` calls in `GET`.

- [ ] **Step 4: Prove it's a pure move.** Run `git diff --color-moved=zebra --stat` and `git diff --color-moved=plain src/app/api/studypulse/stats/route.ts`. The removed bodies must show as *moved* (no changed lines inside them). Then run `node scripts/sp-test.mjs` (expected `# fail 0`, 105 pass) and `npx tsc --noEmit -p .` (exit 0).

- [ ] **Step 5: Commit.**

```bash
git status
git add src/lib/studypulse/gpaScale.ts src/lib/studypulse/gpaSummary.ts src/lib/studypulse/__tests__/gpaScale.test.ts src/app/api/studypulse/stats/route.ts
git commit -m "StudyPulse: move the overall-GPA calculation out of the stats route into a shared lib"
```

---

### Task 6: Summary builder + API route

**Files:**
- Create: `src/lib/dashboard/summary.ts`, `src/app/api/dashboard/summary/route.ts`

**Interfaces:**
- Consumes:
  - `section`, `manilaClock`, `weekOfTerm`, `dateLine`, `pickNextClass` (Tasks 1-2)
  - `buildWorkboardDigest` (Task 4), `getOverallGPA` (Task 5)
  - existing: `getHabitsForUser` (`src/lib/habits.ts`), `loadSpendBase`/`computeSafe` (`src/lib/finance/safeToSpendServer.ts`), `safeToSpendStatus` (`src/lib/finance/status.ts`), `getWorkItems` (`src/lib/workboard/workItems.ts`), `getWorkboardWeek` (`src/lib/workboard/aggregate.ts`), `mondayOf`/`addDays` (`src/lib/workboard/dates.ts`), and the schema `ensure*` functions from `src/lib/migrate.ts` (all memoised per process)
- Produces:
  - `buildDashboardSummary(userId: number, now?: Date): Promise<DashboardSummary>`. It **never rejects**: every query runs inside `section()`.
  - `getHeaderData(userId: number, now?: Date): Promise<HeaderData>`. It **never rejects**.
  - `GET /api/dashboard/summary` → `401 {error}` with no session, else `200 DashboardSummary`.

- [ ] **Step 1: Add the summary type.** Append to `src/lib/dashboard/types.ts`, and add the two type-only imports at the top of that file:

```ts
import type { WorkboardDigest } from '@/lib/workboard/dashboardDigest';
import type { NextClass } from './nextClass';
```

```ts
/** `data: null` means "not set up yet" (the cell shows Set up →), never "zero". */
export interface DashboardSummary {
  nextClass: Section<NextClass | null>;
  habits:    Section<HabitsToday | null>;
  finance:   Section<FinanceToday | null>;
  study:     Section<StudyToday | null>;
  workboard: Section<WorkboardDigest>;
}
```

These are `import type`, so `scripts/dash-test.mjs` still transpiles `types.ts` without pulling in workboard code.

- [ ] **Step 2: Implement** `src/lib/dashboard/summary.ts`:

```ts
/** Builds the dashboard (spec §4.1) from each module's own server code. Server-only: imports
 *  the pool. Every section is isolated — a failing module returns { ok: false }, never throws. */
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import {
  ensureCanvasSchema, ensureHabitPauseSchema, ensureHabitPriorityAndMinimumSchema,
  ensureHabitTrackingSchema, ensureHabitTypeRemovedAndNoteRenamedSchema,
  ensureWorkboardSchema, ensureWorkboardV4Schema,
} from '@/lib/migrate';
import { getHabitsForUser } from '@/lib/habits';
import { computeSafe, loadSpendBase } from '@/lib/finance/safeToSpendServer';
import { safeToSpendStatus } from '@/lib/finance/status';
import { getOverallGPA } from '@/lib/studypulse/gpaSummary';
import { getWorkItems } from '@/lib/workboard/workItems';
import { getWorkboardWeek } from '@/lib/workboard/aggregate';
import { addDays, mondayOf } from '@/lib/workboard/dates';
import { buildWorkboardDigest } from '@/lib/workboard/dashboardDigest';
import { section } from './section';
import { pickNextClass } from './nextClass';
import { dateLine, manilaClock, weekOfTerm } from './headerLine';
import type { DashboardSummary, FinanceTone, HeaderData } from './types';

const TONE: Record<'success' | 'warn' | 'danger', FinanceTone> = { success: 'on_track', warn: 'tight', danger: 'over' };

async function ensureWorkboard() {
  await ensureWorkboardSchema();
  await ensureWorkboardV4Schema();
}

export async function buildDashboardSummary(userId: number, now: Date = new Date()): Promise<DashboardSummary> {
  const clock = manilaClock(now);
  const weekStart = mondayOf(clock.date);

  const [nextClass, habits, finance, study, workboard] = await Promise.all([
    section('nextClass', async () => {
      await ensureWorkboard();
      const [a, b] = await Promise.all([
        getWorkboardWeek(userId, weekStart),
        getWorkboardWeek(userId, addDays(weekStart, 7)),
      ]);
      return pickNextClass([...a.class_occurrences, ...b.class_occurrences], clock.date, clock.hhmm);
    }),
    section('habits', async () => {
      await ensureHabitTrackingSchema();
      await ensureHabitPriorityAndMinimumSchema();
      await ensureHabitTypeRemovedAndNoteRenamedSchema();
      await ensureHabitPauseSchema();
      const list = (await getHabitsForUser(userId)).filter(h => h.task_status !== 'paused');
      if (!list.length) return null;
      const today = list.filter(h => h.is_today);
      return {
        done: today.filter(h => h.checked_in_today).length,
        total: today.length,
        bestStreak: list.reduce((m, h) => Math.max(m, h.current_streak ?? 0), 0),
      };
    }),
    section('finance', async () => {
      const base = await loadSpendBase(userId);
      if (base.currentBalance === 0 && base.upcomingRequired === 0 && base.upcomingSavings === 0) return null;
      const { safe } = computeSafe(base.currentBalance, base.upcomingRequired, base.upcomingSavings);
      // Same per-day rate as /api/finance/safe-to-spend.
      const days = base.daysUntilNextAllowance ?? 14;
      const perDay = days > 0 ? Math.round((safe / days) * 100) / 100 : safe;
      const { tone } = safeToSpendStatus({
        safe_to_spend: safe, upcoming_required: base.upcomingRequired, upcoming_savings: base.upcomingSavings,
        horizon_end: base.horizonEnd, shortfall: 0, shortfall_coverable_by: null, flexible_categories: [],
        current_balance: base.currentBalance,
      });
      return { perDay, safeTotal: safe, tone: TONE[tone] };
    }),
    section('study', async () => {
      const final = await getOverallGPA(userId, 'final');
      const gpa = final > 0 ? final : await getOverallGPA(userId, 'midterm');
      return gpa > 0 ? { gpa } : null;
    }),
    section('workboard', async () => {
      await ensureWorkboard();
      const payload = await getWorkItems(userId);
      return buildWorkboardDigest(payload.items, payload.generated_at, mondayOf(payload.generated_at));
    }),
  ]);

  return { nextClass, habits, finance, study, workboard };
}

const dateOf = (v: unknown) => (v ? String(v).slice(0, 10) : null);

export async function getHeaderData(userId: number, now: Date = new Date()): Promise<HeaderData> {
  const clock = manilaClock(now);
  let week: number | null = null;
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT start_date, end_date FROM trimesters WHERE user_id = ? ORDER BY trimester_id DESC LIMIT 1', [userId]);
    if (rows.length) week = weekOfTerm(dateOf(rows[0].start_date), dateOf(rows[0].end_date), clock.date);
  } catch { /* trimesters table not created yet: no week label */ }

  let canvasConnected = false;
  try {
    await ensureCanvasSchema();
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT 1 FROM canvas_connections WHERE user_id = ? AND status = 'active' LIMIT 1", [userId]);
    canvasConnected = rows.length > 0;
  } catch { /* shows as not connected */ }

  return { dateLine: dateLine(clock.date, clock.hour, week), weekOfTerm: week, canvasConnected };
}
```

- [ ] **Step 3: Implement the route** `src/app/api/dashboard/summary/route.ts`:

```ts
import { auth } from '@/auth';
import { buildDashboardSummary } from '@/lib/dashboard/summary';

export const dynamic = 'force-dynamic';

/** The dashboard's client-side retry. The page itself calls buildDashboardSummary directly. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await buildDashboardSummary(Number(session.user.id)));
}
```

- [ ] **Step 4: Verify.**
  - Run `npx tsc --noEmit -p .`. Expected: exit 0.
  - Start the dev server (`npm run dev`, in the background).
  - Run `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/dashboard/summary`. Expected: `401`.
  - Then, signed in through the browser (Playwright MCP or the user's browser), open `http://localhost:3000/api/dashboard/summary`. Expected: a JSON object with keys `nextClass, habits, finance, study, workboard`, each holding `ok`.
  - Record which sections are `ok: true` in the task report.

- [ ] **Step 5: Commit.**

```bash
git status
git add src/lib/dashboard/types.ts src/lib/dashboard/summary.ts src/app/api/dashboard/summary/route.ts
git commit -m "Dashboard: isolated summary builder over module libs and its retry endpoint"
```

---

### Task 7: Workboard `?item=` deep link

**Files:**
- Modify: `src/app/workboard/page.tsx`, `src/components/workboard/WorkboardShell.tsx:140-142` (props) and next to `openDetail` (~line 303)

**Interfaces:**
- Consumes: the `itemKey(item)` format `"<source>-<id>"`, which Task 4's `href` uses.
- Produces: `/workboard?item=owned-12` opens that item's detail drawer once, then removes the parameter from the URL.

- [ ] **Step 1: Page.** In `src/app/workboard/page.tsx`, change the signature and pass the key through:

```tsx
export default async function WorkboardPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
```

Add `const { item } = await searchParams;` after the auth check, and add the prop `initialItemKey={typeof item === 'string' ? item : null}` to `<WorkboardShell …>`.

- [ ] **Step 2: Shell.** In `WorkboardShell.tsx`:
  - Extend the props type to `{ initialWeek: WorkboardWeek; initialWork: WorkPayload; initialItemKey?: string | null }` and destructure `initialItemKey`.
  - Import `itemKey` from `@/lib/workboard/ui/itemKey` if it isn't imported yet.
  - Directly **after** the `openDetail`/`closeDetail` definitions, add:

```tsx
  /* Dashboard deep link (dashboard spec §5.5): /workboard?item=<source>-<id> opens that item once,
     then the parameter is dropped so a refresh or Back doesn't reopen it. */
  useEffect(() => {
    if (!initialItemKey) return;
    const hit = work.items.find(i => itemKey(i) === initialItemKey);
    if (hit) openDetail(hit);
    const url = new URL(window.location.href);
    url.searchParams.delete('item');
    window.history.replaceState(window.history.state, '', url);
    // Mount-only by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 3: Verify.**
  - Run `npx tsc --noEmit -p .` (exit 0) and `node scripts/wb-test.mjs` (`# fail 0`).
  - In the running dev server, signed in, take any item key from the Task 6 JSON (`workboard.data.upNext[0].key`).
  - Open `/workboard?item=<key>`. Expected: the detail drawer opens for that item and the URL loses `?item=`.
  - Open `/workboard?item=owned-999999`. Expected: no drawer, no error, and the parameter is still removed.

- [ ] **Step 4: Commit.**

```bash
git status
git add src/app/workboard/page.tsx src/components/workboard/WorkboardShell.tsx
git commit -m "Workboard: open an item's detail from a ?item= deep link"
```

---

### Task 8: Dashboard stylesheet + motion hooks

**Files:**
- Create: `src/app/dashboard/dashboard.css`, `src/components/dashboard/useMotion.ts`

**Interfaces:**
- Produces:
  - CSS classes used by Tasks 9-12: `db-page db-header db-dateline db-title db-pill db-avatar db-profile db-popover db-band db-today db-cell db-k db-v db-sub db-bar db-side db-quote db-qmark db-qby db-weather db-wtemp db-wcond db-tip db-tip-heat db-tip-rain db-tip-calm db-tiles db-tile db-art db-art-img db-tname db-chip db-gdot db-wb db-wbh db-stat db-stat-late db-stat-prog db-wprog db-wbb db-list db-witem db-ctx db-stage db-due db-week db-wk db-dcol db-stack db-dn db-skel db-panel db-item db-enter db-fade db-err db-retry db-empty`
  - `useEntranceMotion(): boolean` (true only on the first dashboard view this session, and never under reduced motion)
  - `useCountUp(target: number, animate: boolean, ms?: number): number`

- [ ] **Step 1: Create** `src/app/dashboard/dashboard.css`. The values are ported from the approved mockup `layout-v8.html`.

```css
/* Dashboard (spec docs/superpowers/specs/2026-10-30-dashboard-revamp-design.md).
   Glass levels follow workboard.css: panels blur, items sit on the blurred panel with no filter
   of their own. Desktop (>=1024px) fits one screen at 100% zoom: only .db-tiles flexes, capped
   at the 3:2 artwork height so spare space centres the stack instead of cropping the art. */

.db-page {
  --db-ink: #2b2b3a; --db-muted: #6b6b80; --db-ease: cubic-bezier(0.23, 1, 0.32, 1);
  --db-rose: #e0607e; --db-blue: #2c6fb0; --db-violet: #6a4fb0; --db-amber: #8a5010;
  min-height: 100dvh; padding: clamp(14px, 2.4vh, 28px) 4%;
  display: flex; flex-direction: column; justify-content: center; gap: clamp(8px, 1.6vh, 16px);
  color: var(--db-ink); font-family: 'Inter', 'DM Sans', 'Segoe UI', sans-serif; overflow-x: hidden;
}
.db-page a { color: inherit; text-decoration: none; }
.db-page :focus-visible { outline: 2px solid #3b8fe0; outline-offset: 2px; border-radius: 12px; }

/* glass */
.db-panel {
  background: linear-gradient(160deg, rgba(255,255,255,.42), rgba(255,255,255,.22));
  border: 1px solid rgba(255,255,255,.65); border-radius: 20px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 18px 40px -22px rgba(60,40,110,.35);
}
@supports (backdrop-filter: blur(1px)) {
  .db-panel { backdrop-filter: blur(14px) saturate(150%); -webkit-backdrop-filter: blur(14px) saturate(150%); }
}
@supports not (backdrop-filter: blur(1px)) { .db-panel { background: rgba(255,255,255,.72); } }
.db-item {
  background: linear-gradient(160deg, rgba(255,255,255,.82), rgba(255,255,255,.55));
  border: 1px solid rgba(255,255,255,.85); border-radius: 14px;
  box-shadow: inset 0 1px 0 #fff, 0 8px 20px -14px rgba(60,40,110,.35);
}
.db-gdot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; background: var(--d);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--d) 18%, transparent), 0 0 10px color-mix(in srgb, var(--d) 55%, transparent);
}

/* header */
.db-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
.db-dateline { font-size: 12px; font-weight: 600; color: var(--db-muted); }
.db-title { font-size: clamp(30px, 5vh, 48px); line-height: 1.05; font-weight: 800; letter-spacing: -.02em; margin: 0; }
.db-header-actions { display: flex; align-items: center; gap: 10px; }
.db-pill {
  background: linear-gradient(to right, #f2a7c0, #74bcd9); color: #fff; border-radius: 20px; padding: 7px 16px;
  font: 700 13px/1.2 inherit; border: 1.5px solid rgba(255,255,255,.95); white-space: nowrap; cursor: pointer;
  box-shadow: 0 0 0 3px rgba(255,255,255,.4), 0 6px 16px rgba(240,103,157,.3);
  transition: transform 160ms var(--db-ease); display: inline-flex; align-items: center; gap: 6px;
}
.db-pill:active { transform: scale(.97); }
.db-profile { position: relative; }
.db-avatar {
  width: 36px; height: 36px; border-radius: 50%; border: 2.5px solid #fff; cursor: pointer;
  background: linear-gradient(135deg, #f2a7c0, #74bcd9); color: #fff; font: 800 14px/1 inherit;
  box-shadow: 0 4px 12px rgba(60,40,110,.2); transition: transform 160ms var(--db-ease);
}
.db-avatar:active { transform: scale(.95); }
.db-popover {
  position: absolute; right: 0; top: calc(100% + 10px); z-index: 30; width: 280px; padding: 14px;
  transform-origin: top right; animation: db-pop-in 180ms var(--db-ease) both;
  background: rgba(255,255,255,.9);
}
.db-popover[data-closing] { animation: db-pop-out 120ms ease-in both; }
.db-popover h2 { font-size: 14px; margin: 0; }
.db-popover .db-sub { margin-top: 2px; }
.db-popover ul { list-style: none; margin: 10px 0; padding: 10px 0; border-block: 1px solid rgba(43,43,58,.08); display: grid; gap: 6px; font-size: 12.5px; }
.db-popover li { display: flex; justify-content: space-between; gap: 8px; }
.db-popover .db-pop-actions { display: grid; gap: 6px; }
.db-popover .db-pop-actions a, .db-popover .db-pop-actions button {
  display: block; width: 100%; text-align: left; padding: 8px 10px; border-radius: 10px; border: 0;
  background: transparent; font: 600 13px/1.2 inherit; color: var(--db-ink); cursor: pointer; min-height: 36px;
}
.db-popover .db-pop-actions :is(a, button):hover { background: rgba(255,255,255,.95); }
@keyframes db-pop-in { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
@keyframes db-pop-out { to { opacity: 0; transform: scale(.96); } }

/* band: Today strip | slim quote + weather */
.db-band { display: grid; grid-template-columns: 1.75fr 1fr; gap: 14px; }
.db-today { padding: 10px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.db-cell { padding: 9px 12px; display: flex; flex-direction: column; gap: 2px; min-width: 0; position: relative; }
a.db-cell { transition: transform 160ms var(--db-ease); }
.db-k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--db-muted); font-weight: 650; }
.db-v { font-size: clamp(16px, 2.1vh, 20px); font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-v small { font-size: 13px; font-weight: 700; color: #8a8aa0; }
.db-v .db-late { font-size: 13px; color: var(--db-rose); }
.db-sub { font-size: 12px; color: var(--db-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-sub[data-tone="tight"] { color: var(--db-amber); }
.db-sub[data-tone="over"] { color: var(--db-rose); }
.db-bar { height: 5px; border-radius: 6px; background: rgba(255,255,255,.7); overflow: hidden; margin-top: 5px; }
.db-bar > i { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, #f2a7c0, #74bcd9); transition: width 600ms var(--db-ease); }
.db-empty { font-size: 13px; font-weight: 700; color: var(--db-blue); }
.db-err { font-size: 12.5px; color: var(--db-muted); }
.db-retry {
  position: absolute; right: 8px; top: 8px; width: 28px; height: 28px; border-radius: 50%; border: 0; cursor: pointer;
  background: rgba(255,255,255,.9); color: var(--db-ink); font-size: 14px;
}
.db-retry:disabled { opacity: .5; cursor: progress; }

.db-side { display: grid; grid-template-rows: 1fr 1fr; gap: 8px; min-width: 0; }
.db-quote, .db-weather { padding: 0 16px; display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 13px; }
.db-qmark {
  font: 800 26px/1 Georgia, serif; margin-top: 8px; flex-shrink: 0;
  background: linear-gradient(to bottom, #f2a7c0, #74bcd9); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.db-quote p { margin: 0; font-style: italic; color: #3a3a4e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.db-qby { font-size: 11.5px; color: var(--db-muted); font-weight: 600; white-space: nowrap; flex-shrink: 0; }
.db-weather img { width: 28px; height: 28px; flex-shrink: 0; }
.db-wtemp { font-size: 17px; font-weight: 800; letter-spacing: -.02em; flex-shrink: 0; }
.db-wcond { color: #55556a; white-space: nowrap; flex-shrink: 0; background: none; border: 0; padding: 0; font: inherit; cursor: pointer; }
.db-wcond:hover { text-decoration: underline; }
.db-tip { margin-left: auto; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.db-tip-heat { background: #fff4e0; color: #b4690e; }   /* 4.6:1 */
.db-tip-rain { background: #e6f2ff; color: #2c6fb0; }   /* 5.0:1 */
.db-tip-calm { background: #f1edfa; color: #6a5a9a; }   /* 5.3:1 */
.db-weather form { display: flex; gap: 6px; width: 100%; }
.db-weather input { flex: 1; min-width: 0; border: 1px solid rgba(43,43,58,.15); border-radius: 10px; padding: 5px 10px; font: inherit; background: rgba(255,255,255,.9); }

/* tiles */
.db-tiles {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
  flex: 1 1 0; min-height: 0; max-height: calc(((92vw - 28px) / 3 - 24px) / 1.5 + 54px);
}
.db-tile { padding: 12px; display: flex; flex-direction: column; min-height: 0; transition: transform 300ms var(--db-ease), box-shadow 300ms var(--db-ease); }
.db-tile:active { transform: scale(.98); transition-duration: 160ms; }
.db-art { position: relative; flex: 1; min-height: 90px; border-radius: 14px; overflow: hidden; }
.db-art-img { object-fit: cover; transition: transform 400ms var(--db-ease); }
.db-tname { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 9px; padding: 0 2px 0 4px; min-height: 28px; }
.db-tname > span:first-child { font-size: 15px; font-weight: 700; }
.db-chip { padding: 5px 11px; font-size: 12px; font-weight: 700; display: inline-flex; gap: 7px; align-items: center; border-radius: 999px; white-space: nowrap; }

/* workboard strip */
.db-wb { padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; }
.db-wbh { display: flex; align-items: center; gap: 10px; }
.db-wbh h2 { font-size: 17px; margin: 0 4px 0 0; }
.db-stat { font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,.75); color: #55556a; display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; }
.db-stat-late { background: #ffe1e8; color: #b83259; }
.db-stat-prog { color: var(--db-blue); }
.db-wprog { margin-left: auto; display: flex; align-items: center; gap: 10px; font-size: 12px; color: #55556a; white-space: nowrap; }
.db-wprog .db-bar { width: 120px; margin: 0; }
.db-wbb { display: grid; grid-template-columns: 1fr minmax(300px, .42fr); gap: 14px; align-items: stretch; }
.db-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-content: start; }
.db-witem { display: grid; grid-template-columns: auto 1fr auto; column-gap: 10px; row-gap: 3px; align-items: center; padding: 8px 12px; min-width: 0; transition: transform 160ms var(--db-ease); }
.db-witem > .db-gdot { grid-row: 1 / 3; }
.db-witem .db-wt { font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-witem .db-wmeta { grid-column: 2; display: flex; gap: 8px; align-items: center; font-size: 11px; color: var(--db-muted); white-space: nowrap; overflow: hidden; }
.db-ctx { font-weight: 700; padding: 1px 7px; border-radius: 6px; background: color-mix(in srgb, var(--d) 16%, white); color: var(--t); }
.db-stage { font-weight: 700; }
.db-stage[data-tone="progress"] { color: var(--db-blue); }
.db-stage[data-tone="revision"] { color: var(--db-violet); }
.db-stage[data-tone="waiting"] { color: var(--db-amber); }
.db-due { grid-row: 1 / 3; grid-column: 3; font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 999px; background: rgba(255,255,255,.9); color: #55556a; white-space: nowrap; text-align: center; line-height: 1.25; }
.db-due small { display: block; font-weight: 600; font-size: 10px; color: #7a7a90; }
.db-due[data-late] { background: #ffe1e8; color: #b83259; }
.db-list-empty { grid-column: 1 / -1; padding: 14px; font-size: 13px; color: var(--db-muted); }
.db-week { display: flex; flex-direction: column; padding: 8px 10px; }
.db-weekh { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 8px; }
.db-weekh button { border: 0; background: rgba(255,255,255,.9); border-radius: 999px; padding: 2px 8px; font: 700 11px/1.4 inherit; cursor: pointer; }
.db-wk { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; flex: 1; align-items: end; }
.db-dcol { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; padding: 4px 0; border-radius: 10px; height: 100%; min-height: 44px; border: 0; background: transparent; cursor: pointer; font: inherit; transition: background-color 160ms var(--db-ease); }
.db-dcol[aria-checked="true"] { background: rgba(255,255,255,.95); box-shadow: 0 4px 12px -6px rgba(60,40,110,.35); }
.db-stack { display: flex; flex-direction: column-reverse; gap: 2px; width: 14px; }
.db-stack i { display: block; height: 7px; border-radius: 3px; background: var(--d); }
.db-dn { font-size: 10px; font-weight: 700; color: #7a7a90; }
.db-dcol[data-today] .db-dn { color: var(--db-ink); }
.db-dcol[data-today] .db-dn::after { content: ''; display: block; width: 4px; height: 4px; border-radius: 50%; background: var(--db-rose); margin: 2px auto 0; }

/* loading */
.db-skel { display: block; height: 12px; border-radius: 6px; background: linear-gradient(90deg, rgba(255,255,255,.5) 25%, rgba(255,255,255,.95) 50%, rgba(255,255,255,.5) 75%); background-size: 200% 100%; animation: db-shimmer 1.4s linear infinite; }
@keyframes db-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

/* motion: entrance once per session (the page's inline script sets data-db-seen on repeat views) */
:root:not([data-db-seen]) .db-enter { animation: db-rise 280ms var(--db-ease) both; animation-delay: calc(var(--i, 0) * 40ms); }
@keyframes db-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.db-fade { animation: db-fade 150ms var(--db-ease) both; }
@keyframes db-fade { from { opacity: 0; } to { opacity: 1; } }

@media (hover: hover) and (pointer: fine) {
  a.db-cell:hover, .db-witem:hover { transform: translateY(-1px); }
  .db-tile:hover { transform: translateY(-6px); box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 26px 50px -24px rgba(60,40,110,.45); }
  .db-tile:hover .db-art-img { transform: scale(1.03); }
  .db-dcol:hover:not([aria-checked="true"]) { background: rgba(255,255,255,.6); }
}

@media (prefers-reduced-motion: reduce) {
  .db-page *, .db-page *::before, .db-page *::after { animation: none !important; transition: none !important; }
  .db-skel { background: rgba(255,255,255,.7); }
}

/* below desktop the page scrolls normally */
@media (max-width: 1023px) {
  .db-page { justify-content: flex-start; }
  .db-band { grid-template-columns: 1fr; }
  .db-side > * { padding: 10px 16px; }
  .db-tiles { grid-template-columns: 1fr 1fr; flex: none; max-height: none; }
  .db-art { flex: none; aspect-ratio: 3 / 2; }
  .db-wbb { grid-template-columns: 1fr; }
}
@media (max-width: 639px) {
  .db-page { padding: 16px; }
  .db-today { grid-template-columns: 1fr 1fr; }
  .db-tiles, .db-list { grid-template-columns: 1fr; }
  .db-wbh { flex-wrap: wrap; }
  .db-wprog { margin-left: 0; width: 100%; }
  .db-dcol, .db-retry { min-height: 44px; }
  .db-page a, .db-page button { -webkit-tap-highlight-color: transparent; }
}
```

- [ ] **Step 2: Create** `src/components/dashboard/useMotion.ts`:

```ts
'use client';
import { useEffect, useState } from 'react';

/** True only on the first dashboard view of the session (the page's inline script marks repeat
 *  views with data-db-seen on <html>) and never under reduced motion. False during SSR. */
export function useEntranceMotion(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const seen = document.documentElement.hasAttribute('data-db-seen');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setOn(!seen && !reduce);
  }, []);
  return on;
}

/** Counts 0 -> target once when `animate` is true (ease-out cubic), else returns target as-is. */
export function useCountUp(target: number, animate: boolean, ms = 600): number {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (!animate) { setValue(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setValue(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate, ms]);
  return value;
}
```

- [ ] **Step 3: Verify.** Run `npx tsc --noEmit -p .`. Expected: exit 0. (The CSS is exercised in Tasks 9-13.)

- [ ] **Step 4: Commit.**

```bash
git status
git add src/app/dashboard/dashboard.css src/components/dashboard/useMotion.ts
git commit -m "Dashboard: glass stylesheet with one-screen fit rules and motion hooks"
```

---

### Task 9: Header + profile popover

**Files:**
- Create: `src/components/dashboard/DashboardHeader.tsx`, `src/components/dashboard/ProfilePopover.tsx`

**Interfaces:**
- Produces:
  - `DashboardHeader({ firstName, dateLine, profile, signOut })` (server component)
  - `interface ProfileInfo { name: string; email: string; verified: boolean; googleLinked: boolean; canvasConnected: boolean }`
  - `ProfilePopover({ profile, signOut })` (client)

`signOut` is a server action (`() => Promise<void>`) passed down from the page.

- [ ] **Step 1: Create** `src/components/dashboard/ProfilePopover.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface ProfileInfo {
  name: string; email: string; verified: boolean; googleLinked: boolean; canvasConnected: boolean;
}

/** Avatar account menu (spec §5.6). Esc / outside click close it; Tab is trapped while open. */
export default function ProfilePopover({ profile, signOut }: { profile: ProfileInfo; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); if (refocus) button.current?.focus(); }, reduce ? 0 : 120);
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) close(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(true); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const f = Array.from(panel.current.querySelectorAll<HTMLElement>('a, button'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const yes = (on: boolean, label: string) => <span style={{ fontWeight: 700, color: on ? '#1f7a52' : '#6b6b80' }}>{on ? label : 'Not yet'}</span>;

  return (
    <div ref={wrap} className="db-profile">
      <button
        ref={button} type="button" className="db-avatar"
        aria-haspopup="dialog" aria-expanded={open} aria-label={`Account menu for ${profile.name}`}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {profile.name.trim().charAt(0).toUpperCase() || 'V'}
      </button>
      {open && (
        <div ref={panel} role="dialog" aria-label="Account" className="db-popover db-panel" data-closing={closing || undefined}>
          <h2>{profile.name}</h2>
          <div className="db-sub">{profile.email}</div>
          <ul>
            <li><span>Email</span>{yes(profile.verified, 'Verified')}</li>
            <li><span>Google</span>{yes(profile.googleLinked, 'Linked')}</li>
            <li><span>Canvas</span>{yes(profile.canvasConnected, 'Connected')}</li>
          </ul>
          <div className="db-pop-actions">
            <Link href="/forgot-password">Reset password</Link>
            <form action={signOut}><button type="submit">Sign out</button></form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create** `src/components/dashboard/DashboardHeader.tsx`:

```tsx
import ProfilePopover, { type ProfileInfo } from './ProfilePopover';

export default function DashboardHeader({ firstName, dateLine, profile, signOut }: {
  firstName: string; dateLine: string; profile: ProfileInfo; signOut: () => Promise<void>;
}) {
  return (
    <header className="db-header">
      <div>
        <div className="db-dateline">{dateLine}</div>
        <h1 className="db-title gradient-text">{firstName}&apos;s Home</h1>
      </div>
      <div className="db-header-actions">
        <form action={signOut} style={{ margin: 0 }}>
          <button type="submit" className="db-pill">Sign-Out</button>
        </form>
        <ProfilePopover profile={profile} signOut={signOut} />
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Verify.** Run `npx tsc --noEmit -p .`. Expected: exit 0. (Rendering is verified in Task 12.)

- [ ] **Step 4: Commit.**

```bash
git status
git add src/components/dashboard/DashboardHeader.tsx src/components/dashboard/ProfilePopover.tsx
git commit -m "Dashboard: header with date line and avatar account popover"
```

---

### Task 10: Today strip + quote and weather rows

**Files:**
- Create: `src/components/dashboard/TodayStrip.tsx`, `src/components/dashboard/QuoteRow.tsx`, `src/components/dashboard/WeatherRow.tsx`

**Interfaces:**
- Consumes:
  - `DashboardSummary` (Task 1)
  - `useCountUp` (Task 8)
  - `weatherTip`, `remainingRainChances` (Task 3)
  - `shortCourseCode` (`@/lib/workboard/ui/courseCode`, pool-free)
- Produces:
  - `TodayStrip({ s, animate, onRetry, retrying })`, where `s: DashboardSummary | null` (null = loading)
  - `QuoteRow()`, `WeatherRow()` (self-fetching, no props)

- [ ] **Step 1: Create** `src/components/dashboard/TodayStrip.tsx`:

```tsx
'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { DashboardSummary, Section } from '@/lib/dashboard/types';
import { shortCourseCode } from '@/lib/workboard/ui/courseCode';
import { useCountUp } from './useMotion';

const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;
const TONE_LABEL = { on_track: 'on track', tight: 'tight', over: 'over budget' } as const;

function Count({ value, animate, format = (n: number) => String(Math.round(n)) }: { value: number; animate: boolean; format?: (n: number) => string }) {
  return <>{format(useCountUp(value, animate))}</>;
}

type Props = { s: DashboardSummary | null; animate: boolean; onRetry: () => void; retrying: boolean };

/** Renders one cell for one section: loading, failed, not set up, or live (spec §5.2). */
function Cell<T>({ label, href, sec, setup, onRetry, retrying, children }: {
  label: string; href: string; sec: Section<T | null> | undefined; setup: string;
  onRetry: () => void; retrying: boolean; children: (data: T) => { body: ReactNode; aria: string };
}) {
  if (!sec) {
    return (
      <div className="db-item db-cell" aria-busy="true">
        <span className="db-k">{label}</span>
        <span className="db-skel" style={{ width: '70%', height: 16, marginTop: 3 }} />
        <span className="db-skel" style={{ width: '45%', marginTop: 4 }} />
      </div>
    );
  }
  if (!sec.ok) {
    return (
      <div className="db-item db-cell">
        <span className="db-k">{label}</span>
        <span className="db-err">Couldn&apos;t load</span>
        <button type="button" className="db-retry" onClick={onRetry} disabled={retrying} aria-label={`Retry loading ${label}`}>↻</button>
      </div>
    );
  }
  if (sec.data === null) {
    return (
      <Link href={href} className="db-item db-cell" aria-label={`${label}: set up`}>
        <span className="db-k">{label}</span>
        <span className="db-empty">Set up →</span>
        <span className="db-sub">{setup}</span>
      </Link>
    );
  }
  const { body, aria } = children(sec.data as T);
  return <Link href={href} className="db-item db-cell" aria-label={aria}><span className="db-k">{label}</span>{body}</Link>;
}

export default function TodayStrip({ s, animate, onRetry, retrying }: Props) {
  const wb = s?.workboard;
  // The workboard digest is never null; "not set up" there means no items at all.
  const wbSection = wb === undefined ? undefined
    : !wb.ok ? wb
    : { ok: true as const, data: wb.data.hasAnyItems ? wb.data : null };

  return (
    <div className="db-panel db-today">
      <Cell label="Next class" href="/studypulse/schedule" sec={s?.nextClass} setup="add your schedule" onRetry={onRetry} retrying={retrying}>
        {nc => ({
          aria: `Next class: ${nc.courseCode} at ${nc.timeLabel}, ${nc.when}`,
          body: <>
            <span className="db-v">{shortCourseCode(nc.courseCode)} · {nc.timeLabel}</span>
            <span className="db-sub">{nc.when}{nc.place ? ` · ${nc.place}` : ''}</span>
          </>,
        })}
      </Cell>
      <Cell label="Habits today" href="/habits" sec={s?.habits} setup="add a habit" onRetry={onRetry} retrying={retrying}>
        {h => ({
          aria: h.total ? `Habits today: ${h.done} of ${h.total} done` : 'Habits today: none scheduled',
          body: h.total
            ? <>
                <span className="db-v"><Count value={h.done} animate={animate} /> <small>/ {h.total}</small></span>
                <span className="db-bar"><i style={{ width: `${Math.round((h.done / h.total) * 100)}%` }} /></span>
              </>
            : <><span className="db-v">Rest day</span><span className="db-sub">nothing scheduled</span></>,
        })}
      </Cell>
      <Cell label="Safe to spend" href="/finance" sec={s?.finance} setup="log your allowance" onRetry={onRetry} retrying={retrying}>
        {f => ({
          aria: `Safe to spend today: ${peso(f.perDay)}, ${TONE_LABEL[f.tone]}`,
          body: <>
            <span className="db-v"><Count value={f.perDay} animate={animate} format={peso} /></span>
            <span className="db-sub" data-tone={f.tone}>today · {TONE_LABEL[f.tone]}</span>
          </>,
        })}
      </Cell>
      <Cell label="Due this week" href="/workboard" sec={wbSection} setup="add work" onRetry={onRetry} retrying={retrying}>
        {d => ({
          aria: `Due this week: ${d.dueThisWeek}${d.overdue ? `, ${d.overdue} late` : ''}`,
          body: <>
            <span className="db-v">
              <Count value={d.dueThisWeek} animate={animate} />
              {d.overdue > 0 && <span className="db-late"> · {d.overdue} late</span>}
            </span>
            <span className="db-sub">{d.upNext[0] ? `next: ${d.upNext[0].title}` : 'all clear'}</span>
          </>,
        })}
      </Cell>
    </div>
  );
}
```

- [ ] **Step 2: Create** `src/components/dashboard/QuoteRow.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';

interface Quote { quote: string; author: string }

/** One-line quote (spec §5.3). The full text is in the title tooltip. */
export default function QuoteRow() {
  const [q, setQ] = useState<Quote | null | undefined>(undefined);
  useEffect(() => {
    fetch('/api/quote')
      .then(r => r.json())
      .then((d: Quote | null) => setQ(d?.quote ? d : null))
      .catch(() => setQ(null));
  }, []);

  return (
    <div className="db-panel db-quote" title={q ? `“${q.quote}” — ${q.author}` : undefined}>
      <span className="db-qmark" aria-hidden="true">“</span>
      {q === undefined && <span className="db-skel" style={{ flex: 1 }} />}
      {q === null && <p>Make today count.</p>}
      {q && <><p>{q.quote}</p><span className="db-qby">— {q.author}</span></>}
    </div>
  );
}
```

- [ ] **Step 3: Create** `src/components/dashboard/WeatherRow.tsx`:

```tsx
'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { remainingRainChances, weatherTip } from '@/lib/dashboard/weatherTip';

const LS_KEY = 'vb_weather_city';   // same key the old WeatherWidget used, so saved cities carry over

interface WeatherData {
  location: { name: string };
  current: { temp_c: number; feelslike_c: number; condition: { text: string; icon: string } };
  forecast?: { forecastday?: { hour?: { time_epoch: number; chance_of_rain: number }[] }[] };
}
type State = { kind: 'loading' } | { kind: 'ask'; error?: string } | { kind: 'ready'; data: WeatherData };

/** Slim weather row + condition tip (spec §5.3, D11). */
export default function WeatherRow() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [city, setCity] = useState('');

  async function load(q: string) {
    setState({ kind: 'loading' });
    try {
      const r = await fetch(`/api/weather?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Weather unavailable');
      setState({ kind: 'ready', data: d });
    } catch (e) {
      setState({ kind: 'ask', error: (e as Error).message });
    }
  }

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LS_KEY); } catch { /* storage blocked */ }
    if (saved) { load(saved); return; }
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        p => load(`${p.coords.latitude},${p.coords.longitude}`),
        () => setState({ kind: 'ask' }),
        { timeout: 8000 },
      );
    } else setState({ kind: 'ask' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const c = city.trim();
    if (!c) return;
    try { localStorage.setItem(LS_KEY, c); } catch { /* still loads this once */ }
    load(c);
  }
  function changeCity() {
    try { localStorage.removeItem(LS_KEY); } catch { /* nothing saved */ }
    setCity('');
    setState({ kind: 'ask' });
  }

  if (state.kind === 'loading') {
    return <div className="db-panel db-weather" aria-busy="true"><span className="db-skel" style={{ flex: 1 }} /></div>;
  }
  if (state.kind === 'ask') {
    return (
      <div className="db-panel db-weather">
        <form onSubmit={submit} aria-label="Set your city for weather">
          <input value={city} onChange={e => setCity(e.target.value)} placeholder={state.error ? `${state.error} · enter a city` : 'Your city, e.g. Makati'} aria-label="City" />
          <button type="submit" className="db-pill" style={{ padding: '4px 12px', fontSize: 12 }}>Go</button>
        </form>
      </div>
    );
  }

  const { current: cur, location: loc, forecast } = state.data;
  const condition = cur.condition.text.trim();
  const tip = weatherTip({
    conditionText: condition, tempC: cur.temp_c, feelsLikeC: cur.feelslike_c,
    upcomingRainChances: remainingRainChances(forecast?.forecastday?.[0]?.hour, Date.now() / 1000),
  });

  return (
    <div className="db-panel db-weather">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https:${cur.condition.icon}`} alt="" width={28} height={28} />
      <span className="db-wtemp">{Math.round(cur.temp_c)}°</span>
      <button type="button" className="db-wcond" onClick={changeCity} title={`${loc.name} · change city`}>
        {condition} · Feels {Math.round(cur.feelslike_c)}°
      </button>
      <span className={`db-tip db-tip-${tip.tone}`} title={tip.text}><span aria-hidden="true">{tip.icon}</span> {tip.text}</span>
    </div>
  );
}
```

- [ ] **Step 4: Verify.** Run `npx tsc --noEmit -p .`. Expected: exit 0.

- [ ] **Step 5: Commit.**

```bash
git status
git add src/components/dashboard/TodayStrip.tsx src/components/dashboard/QuoteRow.tsx src/components/dashboard/WeatherRow.tsx
git commit -m "Dashboard: Today strip with setup/error states, slim quote and weather-tip rows"
```

---

### Task 11: Module tile + Workboard strip

**Files:**
- Create: `src/components/dashboard/ModuleTile.tsx`, `src/components/dashboard/WorkboardStrip.tsx`

**Interfaces:**
- Consumes:
  - `WorkboardDigest`, `DigestItem` (Task 4)
  - `Section` (Task 1)
  - `CONTEXT_FILL`, `CONTEXT_TEXT` (`@/lib/workboard/ui/tokens`, pool-free)
- Produces:
  - `ModuleTile({ href, src, name, chip, index })`, where `chip: ReactNode`
  - `Chip({ dot, children })`
  - `WorkboardStrip({ sec, onRetry, retrying })`, where `sec: Section<WorkboardDigest> | undefined` (undefined = loading)

- [ ] **Step 1: Create** `src/components/dashboard/ModuleTile.tsx`:

```tsx
import Link from 'next/link';
import Image from 'next/image';
import type { CSSProperties, ReactNode } from 'react';

export function Chip({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <span className="db-item db-chip">
      <span className="db-gdot" style={{ '--d': dot } as CSSProperties} />
      {children}
    </span>
  );
}

/** Glass module tile (spec §5.4): same artwork, live chip in the title row. */
export default function ModuleTile({ href, src, name, chip, index }: {
  href: string; src: string; name: string; chip: ReactNode; index: number;
}) {
  return (
    <Link href={href} className="db-panel db-tile db-enter" style={{ '--i': index } as CSSProperties}>
      <div className="db-art">
        <Image src={src} alt="" fill sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 33vw" className="db-art-img" unoptimized priority />
      </div>
      <div className="db-tname"><span>{name}</span>{chip}</div>
    </Link>
  );
}
```

- [ ] **Step 2: Create** `src/components/dashboard/WorkboardStrip.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import type { DigestItem, WorkboardDigest } from '@/lib/workboard/dashboardDigest';
import type { Section } from '@/lib/dashboard/types';
import { CONTEXT_FILL, CONTEXT_TEXT } from '@/lib/workboard/ui/tokens';

const DAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const dayName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

function Item({ item }: { item: DigestItem }) {
  const meta = item.subtasks ? `◔ ${item.subtasks.done}/${item.subtasks.total} subtasks`
    : item.estimatedHours ? `~${item.estimatedHours}h` : null;
  return (
    <Link href={item.href} className="db-item db-witem"
      aria-label={`${item.title}, ${item.stageLabel}${item.due ? `, due ${item.due.top}` : ''}`}>
      <span className="db-gdot" style={{ '--d': item.priority === 'high' ? '#e0607e' : '#9aa5b8' } as CSSProperties} />
      <span className="db-wt">{item.title}</span>
      <span className="db-wmeta">
        <span className="db-ctx" style={{ '--d': CONTEXT_FILL[item.context], '--t': CONTEXT_TEXT[item.context] } as CSSProperties}>{item.contextLabel}</span>
        <span className="db-stage" data-tone={item.stageTone}>{item.stageLabel}</span>
        {meta && <span>{meta}</span>}
      </span>
      {item.due && (
        <span className="db-due" data-late={item.due.late || undefined}>
          {item.due.top}{item.due.bottom && <small>{item.due.bottom}</small>}
        </span>
      )}
    </Link>
  );
}

/** Read-only Workboard strip (spec §5.5). The day filter is the dashboard's only non-link control. */
export default function WorkboardStrip({ sec, onRetry, retrying }: {
  sec: Section<WorkboardDigest> | undefined; onRetry: () => void; retrying: boolean;
}) {
  const [day, setDay] = useState<string | null>(null);

  if (!sec || !sec.ok) {
    return (
      <section className="db-panel db-wb db-enter" style={{ '--i': 4 } as CSSProperties} aria-labelledby="db-wb-h" aria-busy={!sec}>
        <div className="db-wbh">
          <h2 id="db-wb-h">Workboard</h2>
          {!sec ? <span className="db-skel" style={{ width: 220 }} /> : <>
            <span className="db-err">Couldn&apos;t load your work</span>
            <button type="button" className="db-stat" onClick={onRetry} disabled={retrying}>↻ Retry</button>
          </>}
          <Link href="/workboard" className="db-pill" style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 14px' }}>Open Workboard →</Link>
        </div>
        {!sec && <div className="db-list">{[0, 1, 2, 3].map(i => <span key={i} className="db-item db-skel" style={{ height: 52 }} />)}</div>}
      </section>
    );
  }

  const d = sec.data;
  const selected = day ? d.week.find(w => w.date === day) ?? null : null;
  const items = selected ? selected.items : d.upNext;
  // Client-side Manila date; it only drives the today dot, so the buttons suppress a midnight hydration diff.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const pct = d.totalThisWeek ? Math.round((d.doneThisWeek / d.totalThisWeek) * 100) : 0;

  return (
    <section className="db-panel db-wb db-enter" style={{ '--i': 4 } as CSSProperties} aria-labelledby="db-wb-h">
      <div className="db-wbh">
        <h2 id="db-wb-h">Workboard</h2>
        {d.overdue > 0 && <Link href="/workboard" className="db-stat db-stat-late"><span className="db-gdot" style={{ '--d': '#e0607e', width: 6, height: 6 } as CSSProperties} />{d.overdue} overdue</Link>}
        {d.inProgress > 0 && <Link href="/workboard" className="db-stat db-stat-prog"><span className="db-gdot" style={{ '--d': '#3b8fe0', width: 6, height: 6 } as CSSProperties} />{d.inProgress} in progress</Link>}
        <Link href="/workboard" className="db-stat">{d.dueThisWeek} due this week</Link>
        <div className="db-wprog">
          <span><b style={{ color: 'var(--db-ink)' }}>{d.doneThisWeek} of {d.totalThisWeek}</b> done this week</span>
          <span className="db-bar" role="img" aria-label={`${pct}% of this week's work done`}><i style={{ width: `${pct}%` }} /></span>
          <Link href="/workboard" className="db-pill" style={{ fontSize: 12, padding: '6px 14px' }}>Open Workboard →</Link>
        </div>
      </div>

      <div className="db-wbb">
        <div className="db-list db-fade" key={day ?? 'up-next'} aria-live={day ? 'polite' : undefined}>
          {items.map(i => <Item key={i.key} item={i} />)}
          {items.length === 0 && (
            <div className="db-list-empty">
              {!d.hasAnyItems ? <>Nothing on your plate. <Link href="/workboard" style={{ fontWeight: 700 }}>Add work in Workboard →</Link></>
                : selected ? `Nothing due ${dayName(selected.date)}` : 'Nothing due in the next 7 days.'}
            </div>
          )}
        </div>

        <div className="db-item db-week">
          <div className="db-weekh">
            <span className="db-k">{selected ? `${dayName(selected.date)} · ${selected.total} item${selected.total === 1 ? '' : 's'}` : 'This week'}</span>
            {selected
              ? <button type="button" onClick={() => setDay(null)} aria-label="Clear day filter">✕ Clear</button>
              : <span className="db-sub">tap a day to filter</span>}
          </div>
          <div className="db-wk" role="radiogroup" aria-label="Filter Up next by day">
            {d.week.map((w, i) => (
              <button
                key={w.date} type="button" role="radio" className="db-dcol" suppressHydrationWarning
                aria-checked={day === w.date} data-today={w.date === today || undefined}
                aria-label={`${dayName(w.date)}: ${w.total} due`}
                onClick={() => setDay(day === w.date ? null : w.date)}
              >
                <span className="db-stack" aria-hidden="true">
                  {(['academic', 'project', 'organization', 'life'] as const).flatMap(c =>
                    Array.from({ length: Math.min(w.counts[c], 4) }, (_, k) => <i key={`${c}${k}`} style={{ '--d': CONTEXT_FILL[c] } as CSSProperties} />))}
                </span>
                <span className="db-dn">{DAY_LETTER[i]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

```

- [ ] **Step 3: Verify.** Run `npx tsc --noEmit -p .`. Expected: exit 0.

- [ ] **Step 4: Commit.**

```bash
git status
git add src/components/dashboard/ModuleTile.tsx src/components/dashboard/WorkboardStrip.tsx
git commit -m "Dashboard: module tile with title-row chip and the read-only Workboard strip with day filter"
```

---

### Task 12: Assemble the page; remove the old widgets

**Files:**
- Create: `src/components/dashboard/DashboardBody.tsx`
- Rewrite: `src/app/dashboard/page.tsx`
- Delete: `src/components/dashboard/QuoteWidget.tsx`, `src/components/dashboard/WeatherWidget.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-11.
- Produces: the finished `/dashboard`.

- [ ] **Step 1: Create** `src/components/dashboard/DashboardBody.tsx`:

```tsx
'use client';
import { Suspense, use, useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import type { DashboardSummary } from '@/lib/dashboard/types';
import TodayStrip from './TodayStrip';
import QuoteRow from './QuoteRow';
import WeatherRow from './WeatherRow';
import ModuleTile, { Chip } from './ModuleTile';
import WorkboardStrip from './WorkboardStrip';
import { useEntranceMotion } from './useMotion';

const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;
const FIN_DOT = { on_track: '#2fb47a', tight: '#f0a35c', over: '#e0607e' } as const;

/** Unwraps the server's summary promise (or a retried copy) for one Suspense slot. */
function Live({ promise, override, children }: {
  promise: Promise<DashboardSummary>; override: DashboardSummary | null; children: (s: DashboardSummary) => ReactNode;
}) {
  const s = override ?? use(promise);
  return <>{children(s)}</>;
}

const ChipSkeleton = () => <span className="db-skel" style={{ width: 96, height: 24, borderRadius: 999 }} />;

export default function DashboardBody({ summary }: { summary: Promise<DashboardSummary> }) {
  const [override, setOverride] = useState<DashboardSummary | null>(null);
  const [retrying, setRetrying] = useState(false);
  const animate = useEntranceMotion();

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      const r = await fetch('/api/dashboard/summary', { cache: 'no-store' });
      if (r.ok) setOverride(await r.json());
    } finally { setRetrying(false); }
  }, []);

  const slot = (fallback: ReactNode, render: (s: DashboardSummary) => ReactNode) => (
    <Suspense fallback={fallback}><Live promise={summary} override={override}>{render}</Live></Suspense>
  );

  return (
    <>
      <section className="db-band db-enter" style={{ '--i': 0 } as CSSProperties} aria-label="Today">
        {slot(<TodayStrip s={null} animate={false} onRetry={retry} retrying={retrying} />,
          s => <TodayStrip s={s} animate={animate} onRetry={retry} retrying={retrying} />)}
        <div className="db-side">
          <QuoteRow />
          <WeatherRow />
        </div>
      </section>

      <section className="db-tiles" aria-label="Modules">
        <ModuleTile index={1} href="/studypulse" src="/studypulse.png" name="Study Pulse"
          chip={slot(<ChipSkeleton />, s => !s.study.ok ? <Chip dot="#9aa5b8">—</Chip>
            : s.study.data && <Chip dot="#74bcd9">GPA proj. {s.study.data.gpa.toFixed(2)}</Chip>)} />
        <ModuleTile index={2} href="/finance" src="/financetracker.png" name="Finance Tracker"
          chip={slot(<ChipSkeleton />, s => !s.finance.ok ? <Chip dot="#9aa5b8">—</Chip>
            : s.finance.data && <Chip dot={FIN_DOT[s.finance.data.tone]}>{peso(s.finance.data.safeTotal)} left</Chip>)} />
        <ModuleTile index={3} href="/habits" src="/habittracker.png" name="Habit Tracker"
          chip={slot(<ChipSkeleton />, s => !s.habits.ok ? <Chip dot="#9aa5b8">—</Chip>
            : s.habits.data && s.habits.data.bestStreak > 0 && <Chip dot="#f2a7c0">🔥 {s.habits.data.bestStreak}-day streak</Chip>)} />
      </section>

      {slot(<WorkboardStrip sec={undefined} onRetry={retry} retrying={retrying} />,
        s => <WorkboardStrip sec={s.workboard} onRetry={retry} retrying={retrying} />)}
    </>
  );
}
```

- [ ] **Step 2: Rewrite** `src/app/dashboard/page.tsx`:

```tsx
import './dashboard.css';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { findById } from '@/lib/auth/users';
import { buildDashboardSummary, getHeaderData } from '@/lib/dashboard/summary';
import VerifyEmailBanner from '@/components/dashboard/VerifyEmailBanner';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import DashboardBody from '@/components/dashboard/DashboardBody';

/* Entrance motion plays once per session: repeat views get data-db-seen on <html> before paint
   (same pre-hydration pattern as (public)/layout's data-daypart; <html> has suppressHydrationWarning). */
const SEEN_SCRIPT = "try{if(sessionStorage.getItem('db-seen'))document.documentElement.setAttribute('data-db-seen','');else sessionStorage.setItem('db-seen','1')}catch(e){document.documentElement.setAttribute('data-db-seen','')}";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = Number(session.user.id);

  // Not awaited: DashboardBody streams each live slot as this resolves. It never rejects.
  const summary = buildDashboardSummary(userId);
  // Fails open: if the lookup errors, the dashboard still renders (just without the verify banner).
  const [me, header] = await Promise.all([findById(userId).catch(() => null), getHeaderData(userId)]);
  const name = session.user.name ?? me?.first_name ?? 'Student';

  async function handleSignOut() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <div className="vb-bg">
      <script dangerouslySetInnerHTML={{ __html: SEEN_SCRIPT }} />
      <main className="db-page">
        {me && !me.email_verified_at && <VerifyEmailBanner />}
        <DashboardHeader
          firstName={name.split(' ')[0]}
          dateLine={header.dateLine}
          signOut={handleSignOut}
          profile={{
            name: me ? `${me.first_name} ${me.surname}`.trim() : name,
            email: me?.email ?? session.user.email ?? '',
            verified: Boolean(me?.email_verified_at),
            googleLinked: Boolean(me?.google_sub),
            canvasConnected: header.canvasConnected,
          }}
        />
        <DashboardBody summary={summary} />
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Delete the old widgets.**
  - Run `git rm src/components/dashboard/QuoteWidget.tsx src/components/dashboard/WeatherWidget.tsx`.
  - Run `grep -rn "QuoteWidget\|WeatherWidget" src`. Expected: no matches.

- [ ] **Step 4: Verify in the browser.**
  - Run `npx tsc --noEmit -p .` (exit 0) and `npm run lint` (no new errors in `src/app/dashboard`, `src/components/dashboard`, `src/lib/dashboard`).
  - With the dev server running and signed in, open `/dashboard`. Check each of these:
    - **Order:** the header, the Today strip with quote and weather on its right, three tiles with title-row chips, and the Workboard strip.
    - **Skeletons:** they show briefly, then real numbers.
    - **Retry:** in DevTools, block `/api/dashboard/summary`. This doesn't affect the server render, so instead temporarily `throw` inside the `study` section, reload, and confirm only the Study Pulse chip shows `—`. Then revert the throw.
    - **Avatar popover:** it opens, Esc closes it and returns focus to the avatar, and clicking outside closes it.
    - **Day filter:** clicking a day filters Up next, clicking it again clears the filter, and ✕ Clear clears it.
    - **Item links:** clicking an item lands on Workboard with its drawer open.
    - **Weather tip:** the pill text matches the current condition.
    - **Entrance motion:** it plays on the first load, and not again after a reload in the same tab.

- [ ] **Step 5: Commit.**

```bash
git status
git add src/components/dashboard/DashboardBody.tsx src/app/dashboard/page.tsx
git commit -m "Dashboard: assemble the one-screen live home and retire the old quote/weather widgets"
```

(`git rm` already staged the two deletions; confirm they appear in `git status` before committing.)

---

### Task 13: Fit, responsive, accessibility and polish QA

**Files:** fixes only, in the files above. No new features.

The controller (not a subagent) runs this task with the Playwright MCP against the signed-in dev server, applying the skills named in spec §9.

- [ ] **Step 1: One-screen fit gate.** For each viewport `1366×657`, `1536×730`, `1920×945`, run `browser_resize`, navigate to `/dashboard`, and evaluate:

```js
() => {
  const a = document.querySelector('.db-art').getBoundingClientRect();
  const wb = document.querySelector('.db-wb').getBoundingClientRect();
  return {
    noVScroll: document.documentElement.scrollHeight <= innerHeight,
    noHScroll: document.documentElement.scrollWidth <= innerWidth,
    wbVisible: wb.bottom <= innerHeight,
    artRatio: +(a.width / a.height).toFixed(2),
  };
}
```

Expected at every size: `noVScroll`, `noHScroll` and `wbVisible` all `true`, and `artRatio >= 1.45`. Take a screenshot of each size and compare it with `layout-v8.html` at the same size. If the page overflows, the fix belongs in `.db-tiles` (it is the only flexible row), never in shrinking text below the clamps.

- [ ] **Step 2: Responsive.** At `390×844` and `820×1180`: `noHScroll` is true, the band stacks, the tiles are 1-up on phone and 2-up on tablet, and the Workboard header wraps cleanly. Apply the `mobile-native` checklist: tap targets ≥ 44px, no hover-only affordances, `100dvh`.

- [ ] **Step 3: Accessibility (`ui-ux-pro-max`).**
  - Exactly one `h1`.
  - Every Today cell and tile has a meaningful accessible name (check via `browser_snapshot`).
  - The keyboard path is in order: Sign-Out → avatar → cells → quote/weather → tiles → Workboard pills → items → day radios.
  - Focus rings are visible.
  - Contrast spot-check for `.db-sub`, `.db-tip-*`, `.db-due` and `.db-stat-late` on the lightest glass.

- [ ] **Step 4: Motion (`animate`, then `emil-design-eng`).**
  - Check the entrance stagger order, the count-up, the tile hover/press, the popover origin, and the day-filter crossfade.
  - Emulate `prefers-reduced-motion: reduce` (`browser_emulate_media`) and confirm nothing animates.
  - Fix only timing and origin issues; add no new motion.

- [ ] **Step 5: Polish (`impeccable` polish + harden).**
  - Run a fresh-account pass: every cell shows `Set up →` and the Workboard empty line, nothing reads as a zero, and nothing breaks.
  - Run a long-content pass: a 120-character quote, long item titles and a long context label all ellipsize without overflowing.

- [ ] **Step 6: Re-run every gate.**
  - `npx tsc --noEmit -p .`
  - `npm run lint`
  - `node scripts/dash-test.mjs`
  - `node scripts/wb-test.mjs`
  - `node scripts/fin-test.mjs`
  - `node scripts/sp-test.mjs`
  - `node scripts/auth-test.mjs`

  All must be green.

- [ ] **Step 7: Commit the fixes.** Stage the changed files by path, with `git status` first:

```bash
git commit -m "Dashboard: fit, responsive, accessibility and motion QA fixes"
```

- [ ] **Step 8: Final review.**
  - Run `superpowers:requesting-code-review` over the whole branch diff (`git diff 81bd576..HEAD`) and fix any confirmed findings.
  - Then run `superpowers:verification-before-completion`.
  - Report to the user with screenshots at 1366, 1920 and 390. Do **not** push until the user asks.
