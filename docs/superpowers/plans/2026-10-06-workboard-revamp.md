# Workboard Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift every Workboard view (header/KPI, Focus, Table, Board, Timeline, overlays) to one token system, type scale and motion language, and add quick add, multi-select + bulk actions, and a Ctrl+K command palette.

**Architecture:**
- A global `src/app/workboard/workboard.css` holds `--wb-*` tokens plus shared state and animation classes.
- A small set of client primitives in `src/components/workboard/ui/` (overlay, popover, checkbox, segmented control, skeleton, toaster, quick add, bulk bar) replaces per-file one-offs.
- Pool-free helper modules in `src/lib/workboard/ui/` hold the pure logic (tokens, KPI series, palette search, bulk runner, deferred delete).
- Views are then rebuilt on top of these one phase at a time. No schema or API changes.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, styled-jsx, lucide-react, Sonner (new), MySQL via existing API routes.

**Spec:** `docs/superpowers/specs/2026-10-06-workboard-revamp-design.md`. Read it before any task. Section references below (§N) point into it.

## Global Constraints

- **No commits** unless the user explicitly asks. Every task ends with a verification step instead of a commit step. If the user asks for a commit, run `git status` first and stage only files this plan touched. The repo holds unrelated uncommitted work (financetracker/*, src/app/finance, src/components/finance, src/app/api/finance, SubjectCardView.tsx, StudyPulse schedule files and more).
- **Client imports:** client components import at runtime only pool-free modules: `src/lib/workboard/{dates,dueSemantics,workContexts,workCategories,color,workStats}.ts` and everything under `src/lib/workboard/ui/`. `workItems.ts`, `aggregate.ts`, `items.ts` and `organizations.ts` are `import type` only from client code.
- **styled-jsx:** rules are scoped to the component function that renders the `<style jsx>`. Shared rules go in `workboard.css`. Never put a backtick inside a styled-jsx template literal, including inside CSS comments.
- **Portals:** anything `position: fixed` renders through a portal (`WbOverlay` / `WbPopover`).
- **Colours:** come from `--wb-*` variables or, for per-context and per-course hues, from `src/lib/workboard/color.ts`. No new hex literals in components.
- **Type:** a 12px minimum for all text, with one exception: 11px uppercase labels at weight 800 with letter-spacing ≥ .03em, used only for context codes and group headings.
- **Motion:**
  - Animate only `transform` and `opacity`.
  - Easing is `var(--wb-ease)` = `cubic-bezier(0.23,1,0.32,1)` or `var(--wb-ease-in-out)` = `cubic-bezier(0.77,0,0.175,1)`.
  - Durations are 120 / 180 / 240ms, with 300ms the maximum.
  - Keyboard-opened UI does not animate.
  - Hover effects apply only under `@media (hover: hover) and (pointer: fine)`.
  - `prefers-reduced-motion: reduce` removes all movement.
  - The only sanctioned layout-property transition is the Focus row collapse (`grid-template-rows`, 180ms, disabled under reduced motion).
- **Dependencies:** `sonner` is the only new one.
- **API:** no new API endpoints, no schema changes.
- **Breakpoints checked:** 390px, 820px, 1440px. No horizontal page scroll. 16px side gutter on phones.
- **Verification** (no test framework exists), every task:
  - `npx tsc --noEmit` exits 0.
  - `node scripts/wb-style-gate.mjs <touched files>` exits 0 (from Task 2 on).
- **Phase checkpoints** also need:
  - `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/workboard` → `307` (unauthenticated).
  - Playwright screenshots at the three widths with the console free of errors. The user logs in once in the Playwright browser; never handle credentials.
  - User approval before the next phase starts.
- **Item identity:** an item's identity is the pair `source` + `id`. Use `itemKey(item)` from Task 7 everywhere a key is needed.

## File map

**New files**

| Path | Responsibility |
|---|---|
| `src/app/workboard/workboard.css` | Tokens, state classes, overlay/popover/toast/skeleton/animation classes, reduced-motion block |
| `src/app/workboard/loading.tsx` | Route-level skeleton while the server component loads |
| `src/lib/workboard/ui/tokens.ts` | `EASE`, `EASE_IN_OUT`, `DUR`, `CONTEXT_FILL`, `CONTEXT_TEXT` for TS consumers |
| `src/lib/workboard/ui/itemKey.ts` | `itemKey(item)` |
| `src/lib/workboard/ui/kpiSeries.ts` | Pure KPI micro-visual series |
| `src/lib/workboard/ui/paletteSearch.ts` | Pure palette result builder |
| `src/lib/workboard/ui/bulk.ts` | `runBulk`, `summariseBulk` |
| `src/lib/workboard/ui/deferredDelete.ts` | Delete-after-undo-window scheduler with `pagehide` flush |
| `src/lib/workboard/ui/quickAdd.ts` | Quick-add defaults and course options (pure) |
| `src/components/workboard/workApi.ts` | Client fetch helpers: `patchItem`, `createOwnedItem`, `deleteOwnedItem` |
| `src/components/workboard/ui/WbOverlay.tsx` | Modal / drawer / palette overlay + `usePresence` |
| `src/components/workboard/ui/WbPopover.tsx` | Anchored, portalled popover |
| `src/components/workboard/ui/WbCheckbox.tsx` | Round and square checkbox |
| `src/components/workboard/ui/WbSegmented.tsx` | Segmented control with sliding indicator |
| `src/components/workboard/ui/WbSkeleton.tsx` | Skeleton block |
| `src/components/workboard/ui/WbToaster.tsx` | Sonner wrapper + `toastUndo` / `toastError` / `toastInfo` |
| `src/components/workboard/ui/WbQuickAdd.tsx` | Inline quick-add row |
| `src/components/workboard/ui/WbBulkBar.tsx` | Floating selection bar |
| `src/components/workboard/ui/useSelection.ts` | Selection state hook with shift ranges |
| `src/components/workboard/ui/WaitingPopover.tsx` | "What is it waiting on?" popover |
| `src/components/workboard/ui/KpiVisuals.tsx` | `ProgressBar`, `DueDots`, `Sparkline` |
| `src/components/workboard/views/FocusRow.tsx` | Dense 34px Focus row |
| `src/components/workboard/views/TimelineDayPanel.tsx` | Day agenda panel |
| `src/components/workboard/CommandPalette.tsx` | Ctrl+K palette |
| `src/components/workboard/dialog/*.tsx` | `WorkItemDialog` split (Task 29) |
| `scripts/wb-style-gate.mjs` | Grep gate for hex, small type, `ease`, layout transitions |

**Modified files:** `src/app/workboard/page.tsx`, `WorkboardShell.tsx`, `WorkboardStats.tsx`, `WorkboardRail.tsx`, `WorkItemRow.tsx`, `WorkItemDialog.tsx`, `WorkItemDetail.tsx`, `WorkboardEventDialog.tsx`, `NewItemTypeChooser.tsx`, `WorkboardFilters.tsx`, `LinksPopover.tsx`, `views/WorkListView.tsx`, `views/WorkTableView.tsx`, `views/WorkBoardView.tsx`, `views/WorkTimelineView.tsx`, `table/{StatusCell,PriorityCell,DeadlineCell,LinksCell}.tsx`, `package.json`.

## Rulings made while planning

Each ruling is recorded as what was decided, why, and what it costs if it's wrong.

- **R1. Academic quick add needs a course.** `validateWorkItemCategoryParent` rejects an academic item without `user_subject_id`. Ruling: when the quick-add context is Academic, `WbQuickAdd` shows a compact course `<select>`, built from the courses present in the loaded items (`courseOptions`, Task 12). It defaults to the course of the section/column's first academic item, else the first option. If there are no courses at all, Academic is removed from the quick-add context choices. *Cost if wrong:* a small extra control in quick add.
- **R2. The KPI "In progress" bar measures this week's completion.** It is completed ÷ total for items due this week (Mon–Sun) across the **whole board**, not the current context. Why: the existing rule says KPI tiles never move with filters or tabs. The tile keeps its existing label "Active". *Cost if wrong:* the bar's meaning changes later; it's one function.
- **R3. Bulk and single delete apply to owned items only.** Academic sources have no DELETE route. Academic items in a selection are skipped and counted in the toast ("2 deleted · 1 academic item skipped"). *Cost if wrong:* none; no data is lost.
- **R4. Exit animations need the component to stay mounted.** Overlays animate out only while mounted, so the shell wraps each conditional overlay with `usePresence(value)` (Task 3). It keeps the last value mounted for 120ms after it becomes null.
- **R5. Enter animations use a data-state toggle (`enter` → `open` on the next frame), not `@starting-style`.** It works in every browser and satisfies the spec's "class-toggle fallback" clause.
- **R9. The Focus row's trailing menu offers Open details and Edit only.** Spec §6 says "open, move to…", but stage moves already live in the drawer's status control, the Table and the Board, and Focus groups by date rather than stage. *Cost if wrong:* a menu entry added to `FocusRow` later.
- **R6. "New event 'query'" in the palette opens the existing event dialog** with the title pre-filled and today 09:00–10:00, because events need `starts_at` and `ends_at`. `EventDialogTarget` gains an optional `initialTitle`.

---

# Phase 0: Foundation (§4)

### Task 1: Tokens stylesheet and TS token module

**Files:**
- Create: `src/app/workboard/workboard.css`
- Create: `src/lib/workboard/ui/tokens.ts`
- Modify: `src/app/workboard/page.tsx` (add the CSS import)

**Interfaces:**
- Produces: CSS custom properties `--wb-*` and classes `.wb-pressable`, `.wb-focus-ring`, `.wb-hoverable`, `.is-selected`, `.is-disabled`, `.is-pending`, `.is-error`, `.wb-overlay-*`, `.wb-popover`, `.wb-skeleton`, `.wb-collapse`, `.wb-sr-only`. TS exports `EASE`, `EASE_IN_OUT`, `DUR`, `CONTEXT_FILL`, `CONTEXT_TEXT`, `prefersReducedMotion()`.

- [ ] **Step 1: Create `src/app/workboard/workboard.css`**

```css
/* Workboard design tokens and shared state classes. Spec: docs/superpowers/specs/2026-10-06-workboard-revamp-design.md section 4.
   Every Workboard component reads colours, type, spacing, radii, shadows and motion from here. */
:root {
  /* Text */
  --wb-text: #2d3748;
  --wb-text-muted: #5c6b80;
  --wb-text-subtle: #8a94a6;
  --wb-text-faint: #9aa4b5;
  /* Brand */
  --wb-pink: #f0679d;
  --wb-pink-bg: rgba(240, 103, 157, 0.14);
  --wb-blue: #74bcd9;
  --wb-blue-strong: #2a7fa8;
  --wb-blue-ink: #256f92;
  /* Semantic */
  --wb-danger: #922e48;
  --wb-danger-bg: rgba(224, 96, 124, 0.14);
  --wb-warn: #8a5010;
  --wb-warn-bg: rgba(240, 163, 92, 0.16);
  --wb-success: #1f6b42;
  --wb-success-fill: #2f8f5b;
  --wb-success-bg: rgba(107, 181, 138, 0.14);
  --wb-priority-high: #e0607c;
  --wb-priority-normal: #b8c6da;
  --wb-priority-low: #d3dbe6;
  /* Context hues (mirror src/lib/workboard/color.ts; color.ts stays the source of truth) */
  --wb-ctx-academic: #4dabf5;
  --wb-ctx-academic-text: #185a7d;
  --wb-ctx-project: #8b7fd6;
  --wb-ctx-project-text: #4f3fa0;
  --wb-ctx-organization: #f0a35c;
  --wb-ctx-organization-text: #8a5010;
  --wb-ctx-life: #f2a7c0;
  --wb-ctx-life-text: #8a4468;
  /* Surfaces */
  --wb-glass: rgba(255, 255, 255, 0.42);
  --wb-glass-border: rgba(255, 255, 255, 0.55);
  --wb-surface: #ffffff;
  --wb-surface-raised: #fbfbfd;
  --wb-surface-sunken: rgba(244, 246, 250, 0.7);
  --wb-hairline: rgba(200, 210, 230, 0.5);
  --wb-border: rgba(200, 210, 230, 0.8);
  --wb-hover: rgba(255, 255, 255, 0.6);
  --wb-selected: rgba(116, 188, 217, 0.16);
  --wb-scrim: rgba(20, 24, 38, 0.26);
  --wb-inverse: #2d3748;
  --wb-inverse-text: #ffffff;
  --wb-inverse-muted: #e8edf5;
  --wb-inverse-danger: #ffb3c4;
  /* Type */
  --wb-font-ui: 'Inter', 'DM Sans', 'Segoe UI', sans-serif;
  --wb-font-head: 'DM Sans', 'Segoe UI', sans-serif;
  --wb-fs-11: 11px; /* uppercase 800-weight labels only */
  --wb-fs-12: 12px;
  --wb-fs-13: 13px;
  --wb-fs-14: 14px;
  --wb-fs-16: 16px;
  --wb-fs-20: 20px;
  --wb-fs-24: 24px;
  /* Spacing */
  --wb-space-1: 4px;
  --wb-space-2: 8px;
  --wb-space-3: 12px;
  --wb-space-4: 16px;
  --wb-space-5: 20px;
  --wb-space-6: 24px;
  --wb-space-7: 32px;
  --wb-space-8: 40px;
  /* Radii */
  --wb-r-sm: 6px;
  --wb-r-md: 8px;
  --wb-r-lg: 10px;
  --wb-r-xl: 14px;
  --wb-r-panel: 16px;
  --wb-r-pill: 999px;
  /* Shadows */
  --wb-shadow-card: 0 1px 2px rgba(31, 38, 68, 0.06);
  --wb-shadow-pop: 0 10px 28px rgba(31, 38, 68, 0.18);
  --wb-shadow-modal: 0 24px 64px rgba(31, 38, 68, 0.32);
  /* Motion */
  --wb-ease: cubic-bezier(0.23, 1, 0.32, 1);
  --wb-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --wb-dur-fast: 120ms;
  --wb-dur: 180ms;
  --wb-dur-slow: 240ms;
}

/* ---------- Shared state classes (spec 4.2) ---------- */
.wb-pressable { transition: transform var(--wb-dur-fast) var(--wb-ease); }
.wb-pressable:active:not(:disabled) { transform: scale(0.97); }

.wb-focus-ring:focus-visible {
  outline: 2px solid var(--wb-blue-strong);
  outline-offset: 2px;
}

@media (hover: hover) and (pointer: fine) {
  .wb-hoverable:hover { background: var(--wb-hover); }
}

.is-selected { background: var(--wb-selected); }
.is-disabled { opacity: 0.5; pointer-events: none; }
.is-pending { opacity: 0.6; pointer-events: none; }
.is-error { background: var(--wb-danger-bg); }

.wb-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* ---------- Overlay (WbOverlay, spec 4.5 / R5) ---------- */
.wb-overlay-scrim {
  position: fixed; inset: 0; z-index: 1000; background: var(--wb-scrim);
  opacity: 1; transition: opacity var(--wb-dur-fast) var(--wb-ease);
}
.wb-overlay-scrim[data-state='enter'],
.wb-overlay-scrim[data-state='closed'] { opacity: 0; }

.wb-overlay-panel {
  position: fixed; z-index: 1001; box-sizing: border-box;
  background: var(--wb-surface-raised); color: var(--wb-text); font-family: var(--wb-font-ui);
  box-shadow: var(--wb-shadow-modal); outline: none;
  opacity: 1;
  transition: opacity var(--wb-dur) var(--wb-ease), transform var(--wb-dur) var(--wb-ease);
}
.wb-overlay-panel[data-state='closed'] {
  transition-duration: var(--wb-dur-fast);
}
.wb-overlay-panel[data-instant='true'],
.wb-overlay-scrim[data-instant='true'] { transition: none; }

.wb-overlay-panel--modal {
  left: 50%; top: 50%;
  width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow: auto;
  border-radius: var(--wb-r-xl);
  transform: translate(-50%, -50%) scale(1);
}
.wb-overlay-panel--modal[data-state='enter'],
.wb-overlay-panel--modal[data-state='closed'] { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }

.wb-overlay-panel--drawer {
  top: 0; right: 0; bottom: 0; width: min(480px, 100vw); overflow: auto;
  border-radius: var(--wb-r-xl) 0 0 var(--wb-r-xl);
  transform: translateX(0);
  transition-duration: var(--wb-dur-slow);
}
.wb-overlay-panel--drawer[data-state='enter'],
.wb-overlay-panel--drawer[data-state='closed'] { opacity: 0; transform: translateX(24px); }
@media (max-width: 767px) {
  .wb-overlay-panel--drawer {
    top: auto; left: 0; right: 0; bottom: 0; width: 100vw; max-height: 88vh;
    border-radius: var(--wb-r-xl) var(--wb-r-xl) 0 0;
  }
  .wb-overlay-panel--drawer[data-state='enter'],
  .wb-overlay-panel--drawer[data-state='closed'] { transform: translateY(24px); }
}

.wb-overlay-panel--palette {
  top: 12vh; left: 50%; width: min(600px, calc(100vw - 32px));
  border-radius: var(--wb-r-xl); overflow: hidden;
  transform: translateX(-50%) scale(1);
  transition-duration: 140ms;
}
.wb-overlay-panel--palette[data-state='enter'],
.wb-overlay-panel--palette[data-state='closed'] { opacity: 0; transform: translateX(-50%) scale(0.98); }
.wb-overlay-panel--palette[data-state='closed'] { transition-duration: 100ms; }

/* ---------- Popover (WbPopover) ---------- */
.wb-popover {
  position: fixed; z-index: 1100; box-sizing: border-box;
  background: var(--wb-surface); color: var(--wb-text); font-family: var(--wb-font-ui);
  border: 1px solid var(--wb-hairline); border-radius: var(--wb-r-lg);
  box-shadow: var(--wb-shadow-pop);
  opacity: 1; transform: scale(1);
  transition: opacity 140ms var(--wb-ease), transform 140ms var(--wb-ease);
}
.wb-popover[data-state='enter'],
.wb-popover[data-state='closed'] { opacity: 0; transform: scale(0.96); }
.wb-popover[data-state='closed'] { transition-duration: 100ms; }
.wb-popover[data-instant='true'] { transition: none; }

/* ---------- Skeleton ---------- */
.wb-skeleton {
  background: var(--wb-hairline); border-radius: var(--wb-r-md);
  animation: wb-pulse 1.2s var(--wb-ease-in-out) infinite alternate;
}
@keyframes wb-pulse { from { opacity: 0.5; } to { opacity: 0.8; } }

/* ---------- Collapse wrapper (the one sanctioned layout transition, spec 6) ---------- */
.wb-collapse {
  display: grid; grid-template-rows: 1fr; opacity: 1;
  transition: grid-template-rows var(--wb-dur) var(--wb-ease), opacity var(--wb-dur) var(--wb-ease);
}
.wb-collapse > * { overflow: hidden; min-height: 0; }
.wb-collapse[data-collapsed='true'] { grid-template-rows: 0fr; opacity: 0; }

/* ---------- Reduced motion (spec 4.3 rule 7) ---------- */
@media (prefers-reduced-motion: reduce) {
  .wb-pressable, .wb-pressable:active { transition: none; transform: none; }
  .wb-overlay-panel, .wb-popover, .wb-collapse { transition: opacity var(--wb-dur-fast) linear; }
  .wb-overlay-panel--modal, .wb-overlay-panel--modal[data-state] { transform: translate(-50%, -50%); }
  .wb-overlay-panel--drawer, .wb-overlay-panel--drawer[data-state] { transform: none; }
  .wb-overlay-panel--palette, .wb-overlay-panel--palette[data-state] { transform: translateX(-50%); }
  .wb-popover, .wb-popover[data-state] { transform: none; }
  .wb-skeleton { animation: none; opacity: 0.65; }
  .wb-motion { transition: none !important; animation: none !important; transform: none !important; }
}
```

- [ ] **Step 2: Create `src/lib/workboard/ui/tokens.ts`**

```ts
/** TS mirror of the motion and context tokens in src/app/workboard/workboard.css, for the few
 *  places that need them in code (timers, inline transforms). Pool-free: safe in client bundles. */
import type { WorkContext } from '@/lib/workboard/workContexts';

export const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';

export const DUR = { fast: 120, base: 180, slow: 240 } as const;

/** Fill and text pairs, verbatim from color.ts's ratified context pairs. */
export const CONTEXT_FILL: Record<WorkContext, string> = {
  academic: '#4dabf5', project: '#8b7fd6', organization: '#f0a35c', life: '#f2a7c0',
};
export const CONTEXT_TEXT: Record<WorkContext, string> = {
  academic: '#185a7d', project: '#4f3fa0', organization: '#8a5010', life: '#8a4468',
};

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

- [ ] **Step 3: Import the stylesheet in `src/app/workboard/page.tsx`**

Add as the first import line:

```ts
import './workboard.css';
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`. Expected: exit 0.
Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/workboard`. Expected: `307`.

---

### Task 2: Style gate script

**Files:**
- Create: `scripts/wb-style-gate.mjs`

**Interfaces:**
- Produces: `node scripts/wb-style-gate.mjs <file...>`. Exits 1 and prints `file:line: rule: text` for each violation, and exits 0 when clean.

- [ ] **Step 1: Create the script**

```js
#!/usr/bin/env node
// Workboard revamp style gate (spec section 18 step 4). Usage: node scripts/wb-style-gate.mjs <files...>
// Rules: no hex literals outside the token files, nothing under 12px (except 11px uppercase 800 labels),
// no plain "ease" timing, no transitions on layout properties.
import { readFileSync } from 'node:fs';

const ALLOW_HEX = [/workboard\.css$/, /lib[\\/]workboard[\\/]color\.ts$/, /lib[\\/]workboard[\\/]ui[\\/]tokens\.ts$/];
const files = process.argv.slice(2);
if (files.length === 0) { console.error('usage: wb-style-gate.mjs <files...>'); process.exit(2); }

const rules = [
  { id: 'hex-literal', test: (l, f) => !ALLOW_HEX.some(r => r.test(f)) && /#[0-9a-fA-F]{3,8}\b/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l) },
  { id: 'small-type-rem', test: l => { const m = l.match(/font-?size['"]?\s*[:=]\s*['"]?(0?\.\d+)rem/i); return m && parseFloat(m[1]) < 0.75; } },
  { id: 'small-type-px', test: l => {
      const m = l.match(/font-?size['"]?\s*[:=]\s*['"]?(\d+(?:\.\d+)?)px/i);
      if (!m) return false;
      const px = parseFloat(m[1]);
      if (px >= 12) return false;
      return !(px === 11 && /wb-fs-11|text-?transform|uppercase/i.test(l));
    } },
  { id: 'plain-ease', test: l => /transition[^;\n]*\bease(?!-)/.test(l) && !/var\(--wb-ease/.test(l) },
  { id: 'layout-transition', test: l => /transition[^;\n]*\b(width|height|flex-grow|flex-basis|top|left|right|bottom|margin|padding)\b/.test(l) && !/grid-template-rows/.test(l) },
];

let failures = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of rules) {
      if (rule.test(line, file)) {
        failures++;
        console.log(`${file}:${i + 1}: ${rule.id}: ${line.trim().slice(0, 140)}`);
      }
    }
  });
}
if (failures) { console.log(`\n${failures} style-gate violation(s).`); process.exit(1); }
console.log(`style gate clean (${files.length} file(s)).`);
```

- [ ] **Step 2: Prove it catches violations.** Run it against a file known to have them:

Run: `node scripts/wb-style-gate.mjs src/components/workboard/views/WorkBoardView.tsx`
Expected: exit 1, with at least one `hex-literal` and one `plain-ease` line.

Run: `node scripts/wb-style-gate.mjs src/app/workboard/workboard.css src/lib/workboard/ui/tokens.ts`
Expected: `style gate clean (2 file(s)).`

---

### Task 3: WbOverlay and usePresence

**Files:**
- Create: `src/components/workboard/ui/WbOverlay.tsx`

**Interfaces:**
- Produces:
  - `export type OverlayVariant = 'modal' | 'drawer' | 'palette'`
  - `export function usePresence<T>(value: T | null, exitMs?: number): { value: T | null; open: boolean }`
  - `export default function WbOverlay(props: { open: boolean; onClose: () => void; variant: OverlayVariant; labelledBy?: string; ariaLabel?: string; instant?: boolean; initialFocusRef?: React.RefObject<HTMLElement | null>; panelClassName?: string; panelStyle?: React.CSSProperties; children: React.ReactNode })`

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { DUR, prefersReducedMotion } from '@/lib/workboard/ui/tokens';

export type OverlayVariant = 'modal' | 'drawer' | 'palette';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Keeps the last non-null value mounted for `exitMs` after it becomes null, so an overlay
 *  rendered as `{value && <X/>}` can still play its exit transition (plan ruling R4). */
export function usePresence<T>(value: T | null, exitMs: number = DUR.fast): { value: T | null; open: boolean } {
  const [kept, setKept] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) { setKept(value); return; }
    if (kept === null) return;
    const t = window.setTimeout(() => setKept(null), prefersReducedMotion() ? 0 : exitMs);
    return () => window.clearTimeout(t);
  }, [value, kept, exitMs]);
  return { value: value ?? kept, open: value !== null };
}

type Phase = 'enter' | 'open' | 'closed';

export interface WbOverlayProps {
  open: boolean;
  onClose: () => void;
  variant: OverlayVariant;
  labelledBy?: string;
  ariaLabel?: string;
  /** true when opened from the keyboard: no enter animation (spec 4.3 rule 3). */
  instant?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  children: ReactNode;
}

export default function WbOverlay({
  open, onClose, variant, labelledBy, ariaLabel, instant = false,
  initialFocusRef, panelClassName, panelStyle, children,
}: WbOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>(instant ? 'open' : 'enter');

  useEffect(() => { setMounted(true); }, []);

  // enter -> open on the next frame (plan ruling R5); open -> closed when the parent closes.
  useLayoutEffect(() => {
    if (!open) { setPhase('closed'); return; }
    if (instant) { setPhase('open'); return; }
    setPhase('enter');
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
    return () => cancelAnimationFrame(id);
  }, [open, instant]);

  // Remember the opener, move focus in, lock scroll; undo all three on unmount.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTarget = initialFocusRef?.current
      ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      ?? panelRef.current;
    focusTarget?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.({ preventScroll: true });
    };
  }, [initialFocusRef]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter(n => n.offsetParent !== null || n === document.activeElement);
    if (nodes.length === 0) { e.preventDefault(); return; }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        className="wb-overlay-scrim"
        data-state={phase}
        data-instant={instant ? 'true' : undefined}
        onMouseDown={() => onCloseRef.current()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        tabIndex={-1}
        className={`wb-overlay-panel wb-overlay-panel--${variant}${panelClassName ? ` ${panelClassName}` : ''}`}
        data-state={phase}
        data-instant={instant ? 'true' : undefined}
        style={panelStyle}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
```

- [ ] **Step 2: Verify.** Run `npx tsc --noEmit` (exit 0) and `node scripts/wb-style-gate.mjs src/components/workboard/ui/WbOverlay.tsx` (clean). There is no visual check yet; Task 31 is the first consumer.

---

### Task 4: WbPopover

**Files:**
- Create: `src/components/workboard/ui/WbPopover.tsx`

**Interfaces:**
- Produces: `export type PopoverPlacement = 'bottom-start' | 'bottom-end'` and `export default function WbPopover(props: { open: boolean; anchor: HTMLElement | null; onClose: () => void; placement?: PopoverPlacement; width?: number; ariaLabel?: string; labelledBy?: string; role?: 'dialog' | 'menu' | 'listbox'; instant?: boolean; children: React.ReactNode })`. Renders nothing while `open` is false. Closes on Esc (returning focus to the anchor) and on outside pointerdown, ignoring the anchor.

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type PopoverPlacement = 'bottom-start' | 'bottom-end';

interface Position { top: number; left: number; origin: string }

const GAP = 6;
const EDGE = 8;

function computePosition(anchor: HTMLElement, panel: HTMLElement, placement: PopoverPlacement): Position {
  const a = anchor.getBoundingClientRect();
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const below = vh - a.bottom - GAP;
  const flipUp = below < h + EDGE && a.top > below;
  const top = flipUp ? Math.max(EDGE, a.top - GAP - h) : Math.min(vh - EDGE - h, a.bottom + GAP);
  let left = placement === 'bottom-end' ? a.right - w : a.left;
  left = Math.min(Math.max(EDGE, left), vw - EDGE - w);
  const originX = placement === 'bottom-end' ? 'right' : 'left';
  const originY = flipUp ? 'bottom' : 'top';
  return { top, left, origin: `${originY} ${originX}` };
}

export interface WbPopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  placement?: PopoverPlacement;
  width?: number;
  ariaLabel?: string;
  labelledBy?: string;
  role?: 'dialog' | 'menu' | 'listbox';
  instant?: boolean;
  children: ReactNode;
}

export default function WbPopover({
  open, anchor, onClose, placement = 'bottom-start', width, ariaLabel, labelledBy,
  role = 'dialog', instant = false, children,
}: WbPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [pos, setPos] = useState<Position | null>(null);
  const [phase, setPhase] = useState<'enter' | 'open'>('enter');

  const place = useCallback(() => {
    if (anchor && panelRef.current) setPos(computePosition(anchor, panelRef.current, placement));
  }, [anchor, placement]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); setPhase('enter'); return; }
    place();
    if (instant) { setPhase('open'); return; }
    const id = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(id);
  }, [open, place, instant]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor?.contains(t)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCloseRef.current();
      anchor?.focus({ preventScroll: true });
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, place]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-label={labelledBy ? undefined : ariaLabel}
      aria-labelledby={labelledBy}
      className="wb-popover"
      data-state={pos ? phase : 'enter'}
      data-instant={instant ? 'true' : undefined}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        transformOrigin: pos?.origin ?? 'top left',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Verify.** `npx tsc --noEmit` exits 0, and the style gate is clean on the new file.

---

### Task 5: WbCheckbox, WbSegmented, WbSkeleton

**Files:**
- Create: `src/components/workboard/ui/WbCheckbox.tsx`
- Create: `src/components/workboard/ui/WbSegmented.tsx`
- Create: `src/components/workboard/ui/WbSkeleton.tsx`
- Modify: `src/app/workboard/workboard.css` (append the checkbox and segmented rules)

**Interfaces:**
- Produces:
  - `WbCheckbox(props: { checked: boolean | 'mixed'; onChange: (next: boolean, e: React.MouseEvent | React.KeyboardEvent) => void; shape: 'round' | 'square'; ring?: boolean; label: string; disabled?: boolean; className?: string })`
  - `WbSegmented<K extends string>(props: { options: { key: K; label: string; icon?: React.ReactNode }[]; value: K; onChange: (k: K) => void; ariaLabel: string; idPrefix?: string; controls?: string; hideLabelsBelow?: number })`
  - `WbSkeleton(props: { width?: number | string; height?: number | string; radius?: number | string; style?: React.CSSProperties })`

- [ ] **Step 1: Append to `workboard.css`**

```css
/* ---------- Checkbox ---------- */
.wb-check {
  position: relative; display: inline-grid; place-items: center; flex-shrink: 0;
  width: 24px; height: 24px; padding: 0; margin: 0; border: 0; background: transparent; cursor: pointer;
}
.wb-check__box {
  width: 16px; height: 16px; box-sizing: border-box;
  border: 1.5px solid var(--wb-priority-normal); background: rgba(255, 255, 255, 0.75);
  display: grid; place-items: center;
  transition: background-color var(--wb-dur-fast) var(--wb-ease), border-color var(--wb-dur-fast) var(--wb-ease);
}
.wb-check--round .wb-check__box { border-radius: 50%; }
.wb-check--square .wb-check__box { border-radius: 4px; }
.wb-check--ring .wb-check__box { border-color: var(--wb-priority-high); }
.wb-check[aria-checked='true'] .wb-check__box,
.wb-check[aria-checked='mixed'] .wb-check__box { background: var(--wb-blue-strong); border-color: var(--wb-blue-strong); }
.wb-check--round[aria-checked='true'] .wb-check__box { background: var(--wb-success-fill); border-color: var(--wb-success-fill); }
.wb-check__mark { stroke-dasharray: 14; stroke-dashoffset: 14; transition: stroke-dashoffset var(--wb-dur) var(--wb-ease); }
.wb-check[aria-checked='true'] .wb-check__mark { stroke-dashoffset: 0; }
@media (hover: hover) and (pointer: fine) {
  .wb-check:hover .wb-check__box { border-color: var(--wb-blue-strong); }
}
@media (max-width: 767px) { .wb-check { width: 40px; height: 40px; } }
@media (prefers-reduced-motion: reduce) { .wb-check__mark, .wb-check__box { transition: none; } }

/* ---------- Segmented ---------- */
.wb-seg {
  position: relative; display: inline-flex; gap: 2px; padding: 3px;
  background: rgba(255, 255, 255, 0.5); border: 1px solid var(--wb-hairline); border-radius: var(--wb-r-lg);
}
.wb-seg__btn {
  position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 6px;
  min-height: 34px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent;
  font: 600 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text-muted); cursor: pointer;
  transition: color var(--wb-dur-fast) var(--wb-ease);
}
.wb-seg__btn[aria-selected='true'] { color: var(--wb-text); }
.wb-seg__pill {
  position: absolute; z-index: 0; top: 3px; bottom: 3px; left: 0; border-radius: 7px;
  background: var(--wb-surface); box-shadow: var(--wb-shadow-card);
  transform-origin: left center;
}
.wb-seg__pill[data-animate='true'] { transition: transform var(--wb-dur) var(--wb-ease-in-out); }
@media (prefers-reduced-motion: reduce) { .wb-seg__pill[data-animate='true'] { transition: none; } }
```

- [ ] **Step 2: `WbCheckbox.tsx`**

```tsx
'use client';

export interface WbCheckboxProps {
  checked: boolean | 'mixed';
  onChange: (next: boolean, e: React.MouseEvent | React.KeyboardEvent) => void;
  shape: 'round' | 'square';
  /** High-priority ring (spec 6). */
  ring?: boolean;
  label: string;
  disabled?: boolean;
  className?: string;
}

export default function WbCheckbox({ checked, onChange, shape, ring, label, disabled, className }: WbCheckboxProps) {
  const next = checked !== true;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`wb-check wb-check--${shape}${ring ? ' wb-check--ring' : ''} wb-focus-ring${className ? ` ${className}` : ''}`}
      onClick={e => { e.stopPropagation(); onChange(next, e); }}
      onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(next, e); } }}
    >
      <span className="wb-check__box" aria-hidden>
        {checked === 'mixed' ? (
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--wb-inverse-text)' }} /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path className="wb-check__mark" d="M1.5 5.2 4 7.5 8.5 2.5" stroke="var(--wb-inverse-text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}
```

- [ ] **Step 3: `WbSegmented.tsx`**

FLIP-style indicator: its size is set instantly and only `transform` animates.

```tsx
'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface SegOption<K extends string> { key: K; label: string; icon?: ReactNode }

export interface WbSegmentedProps<K extends string> {
  options: SegOption<K>[];
  value: K;
  onChange: (k: K) => void;
  ariaLabel: string;
  /** Button ids become `${idPrefix}-${key}` (the shell keeps its existing vb-view-tab ids). */
  idPrefix?: string;
  /** id of the tabpanel the tabs control. */
  controls?: string;
  /** Hide text labels below this viewport width (icon-only, aria-label keeps the name). */
  hideLabelsBelow?: number;
}

export default function WbSegmented<K extends string>({
  options, value, onChange, ariaLabel, idPrefix = 'wb-seg', controls, hideLabelsBelow,
}: WbSegmentedProps<K>) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const idx = options.findIndex(o => o.key === value);
      const el = btnRefs.current[idx];
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value, options]);

  const select = (idx: number) => {
    setAnimate(true);
    onChange(options[idx].key);
    btnRefs.current[idx]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const n = options.length;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next === null) return;
    e.preventDefault();
    // Keyboard-initiated: no slide (spec 4.3 rule 3).
    setAnimate(false);
    onChange(options[next].key);
    btnRefs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className="wb-seg">
      {pill && (
        <span
          aria-hidden
          className="wb-seg__pill"
          data-animate={animate ? 'true' : undefined}
          style={{ width: pill.w, transform: `translateX(${pill.x - 3}px)`, left: 3 }}
        />
      )}
      {options.map((o, idx) => {
        const selected = o.key === value;
        return (
          <button
            key={o.key}
            ref={el => { btnRefs.current[idx] = el; }}
            id={`${idPrefix}-${o.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={controls}
            aria-label={o.label}
            tabIndex={selected ? 0 : -1}
            className="wb-seg__btn wb-focus-ring"
            onClick={() => select(idx)}
            onKeyDown={e => onKeyDown(e, idx)}
          >
            {o.icon}
            <span className="wb-seg__label">{o.label}</span>
          </button>
        );
      })}
      {hideLabelsBelow !== undefined && (
        <style jsx>{`
          @media (max-width: ${hideLabelsBelow - 1}px) {
            .wb-seg__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
          }
        `}</style>
      )}
    </div>
  );
}
```

Note: the styled-jsx block above targets `.wb-seg__label`, which is rendered by this same function, so scoping works.

- [ ] **Step 4: `WbSkeleton.tsx`**

```tsx
export interface WbSkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: React.CSSProperties;
}

export default function WbSkeleton({ width = '100%', height = 14, radius, style }: WbSkeletonProps) {
  return <span aria-hidden className="wb-skeleton" style={{ display: 'block', width, height, borderRadius: radius, ...style }} />;
}
```

- [ ] **Step 5: Verify.** `npx tsc --noEmit` exits 0, and the style gate is clean on all three files plus `workboard.css`.

---

### Task 6: Sonner toaster and toast helpers

**Files:**
- Modify: `package.json` (via npm)
- Create: `src/components/workboard/ui/WbToaster.tsx`
- Modify: `src/app/workboard/workboard.css` (append the toast styles)
- Modify: `src/components/workboard/WorkboardShell.tsx` (mount `<WbToaster raised={false} />` once, as the shell's last child)

**Interfaces:**
- Produces:
  - `WbToaster(props: { raised: boolean })`, where `raised` lifts toasts above the bulk bar
  - `toastUndo(message: string, onUndo: () => void | Promise<void>, opts?: { duration?: number; onExpire?: () => void }): void`
  - `toastError(message: string, onRetry?: () => void | Promise<void>): void`
  - `toastInfo(message: string): void`

- [ ] **Step 1: Install.** Run `npm install sonner`. Expected: `package.json` dependencies gain `"sonner"`.

- [ ] **Step 2: `WbToaster.tsx`**

```tsx
'use client';

import { Toaster, toast } from 'sonner';

export const UNDO_MS = 5000;

export default function WbToaster({ raised }: { raised: boolean }) {
  return (
    <Toaster
      position="bottom-center"
      offset={raised ? 84 : 16}
      visibleToasts={3}
      gap={8}
      toastOptions={{ unstyled: true, classNames: { toast: 'wb-toast', actionButton: 'wb-toast__action', title: 'wb-toast__title' } }}
    />
  );
}

/** Spec 14: Undo for 5s on complete, move, delete and bulk updates. `onExpire` fires only if
 *  the toast closes without Undo; deferred deletes use it to send the DELETE. */
export function toastUndo(
  message: string,
  onUndo: () => void | Promise<void>,
  opts: { duration?: number; onExpire?: () => void } = {},
): void {
  let undone = false;
  toast(message, {
    duration: opts.duration ?? UNDO_MS,
    action: { label: 'Undo', onClick: () => { undone = true; void onUndo(); } },
    onAutoClose: () => { if (!undone) opts.onExpire?.(); },
    onDismiss: () => { if (!undone) opts.onExpire?.(); },
  });
}

export function toastError(message: string, onRetry?: () => void | Promise<void>): void {
  toast(message, {
    duration: 8000,
    className: 'wb-toast wb-toast--error',
    action: onRetry ? { label: 'Retry', onClick: () => { void onRetry(); } } : undefined,
  });
}

export function toastInfo(message: string): void {
  toast(message, { duration: 3000 });
}
```

- [ ] **Step 3: Append the toast styles to `workboard.css`**

```css
/* ---------- Toasts (Sonner, unstyled) ---------- */
.wb-toast {
  display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 8px 8px 8px 14px;
  background: var(--wb-inverse); color: var(--wb-inverse-text); border-radius: var(--wb-r-lg);
  box-shadow: var(--wb-shadow-pop); font: 500 var(--wb-fs-13) var(--wb-font-ui);
  max-width: min(420px, calc(100vw - 32px));
}
.wb-toast--error { box-shadow: inset 3px 0 0 var(--wb-inverse-danger), var(--wb-shadow-pop); }
.wb-toast__title { flex: 1; }
.wb-toast__action {
  border: 0; border-radius: var(--wb-r-md); padding: 6px 10px; cursor: pointer;
  background: rgba(255, 255, 255, 0.12); color: var(--wb-inverse-text); font: 700 var(--wb-fs-13) var(--wb-font-ui);
}
@media (hover: hover) and (pointer: fine) { .wb-toast__action:hover { background: rgba(255, 255, 255, 0.2); } }
```

- [ ] **Step 4: Mount it in the shell.** Add `import WbToaster from './ui/WbToaster';` and, just before the closing `<style jsx>` of `WorkboardShell`'s root `div`, add `<WbToaster raised={false} />`. Task 19 replaces `false` with the selection state.

- [ ] **Step 5: Verify.** `npx tsc --noEmit` exits 0. The style gate is clean on `WbToaster.tsx` and `workboard.css`. Load `/workboard` while logged in (Playwright) and confirm no console errors.

---

### Task 7: Item key, client API helpers, bulk runner, deferred delete

**Files:**
- Create: `src/lib/workboard/ui/itemKey.ts`
- Create: `src/components/workboard/workApi.ts`
- Create: `src/lib/workboard/ui/bulk.ts`
- Create: `src/lib/workboard/ui/deferredDelete.ts`
- Modify: `src/components/workboard/WorkItemRow.tsx` (make `setWorkStatus`, `setWorkStage`, `setPriority` and `setDeadline` delegate to `patchItem`, keeping their signatures)

**Interfaces:**
- Produces:
  - `itemKey(item: { source: string; id: number }): string` returns `` `${source}-${id}` ``
  - `writeUrl(item: WorkItem): string`
  - `patchItem(item: WorkItem, body: Record<string, unknown>): Promise<Response>`
  - `createOwnedItem(body: CreateOwnedBody): Promise<{ ok: true; itemId: number } | { ok: false; error: string }>`
  - `deleteOwnedItem(id: number, opts?: { keepalive?: boolean }): Promise<Response>`
  - `interface CreateOwnedBody { category: WorkCategory; title: string; user_subject_id?: number | null; due_at?: string | null; work_stage?: WorkStage }`
  - `runBulk<T>(items: T[], op: (item: T) => Promise<Response> | null): Promise<BulkResult<T>>`, where `op` returns null to skip an item
  - `interface BulkResult<T> { ok: T[]; failed: T[]; skipped: T[] }`
  - `summariseBulk(verb: string, r: BulkResult<unknown>, skippedNoun?: string): string`
  - `scheduleDelete(key: string, run: (keepalive: boolean) => Promise<unknown>, delayMs?: number): { cancel: () => void; flush: () => void }`

- [ ] **Step 1: `itemKey.ts`**

```ts
/** The one identity for a Workboard row: ids repeat across the four Study Pulse tables, so
 *  neither `source` nor `id` is a key on its own. */
export function itemKey(item: { source: string; id: number }): string {
  return `${item.source}-${item.id}`;
}
```

- [ ] **Step 2: `workApi.ts`**

```ts
'use client';

import type { WorkItem, WorkCategory } from '@/lib/workboard/workItems';
import type { WorkStage } from '@/lib/workboard/workContexts';

export function writeUrl(item: WorkItem): string {
  return item.source === 'owned'
    ? `/api/workboard/work-items/${item.id}`
    : `/api/workboard/academic/${item.source}/${item.id}`;
}

export function patchItem(item: WorkItem, body: Record<string, unknown>): Promise<Response> {
  return fetch(writeUrl(item), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface CreateOwnedBody {
  category: WorkCategory;
  title: string;
  user_subject_id?: number | null;
  due_at?: string | null;
  work_stage?: WorkStage;
}

export async function createOwnedItem(
  body: CreateOwnedBody,
): Promise<{ ok: true; itemId: number } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/workboard/work-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof data.error === 'string' ? data.error : 'Could not save' };
    return { ok: true, itemId: data.item_id };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export function deleteOwnedItem(id: number, opts: { keepalive?: boolean } = {}): Promise<Response> {
  return fetch(`/api/workboard/work-items/${id}`, { method: 'DELETE', keepalive: opts.keepalive });
}
```

In `WorkItemRow.tsx`, delete the local `writeUrl`, import `{ patchItem }` from `./workApi`, and rewrite each setter body. For example:

```ts
export async function setWorkStatus(item: WorkItem, next: WorkStatus): Promise<Response> {
  return patchItem(item, { work_status: next });
}
export async function setWorkStage(item: WorkItem, next: WorkStage, blockedReason?: string | null): Promise<Response> {
  return patchItem(item, blockedReason !== undefined ? { work_stage: next, blocked_reason: blockedReason } : { work_stage: next });
}
export async function setPriority(item: WorkItem, next: WorkPriority): Promise<Response> {
  return patchItem(item, { priority: next });
}
export async function setDeadline(item: WorkItem, next: { due_at: string | null; deadline_time: string | null }): Promise<Response> {
  return patchItem(item, { due_at: next.due_at, deadline_time: next.deadline_time });
}
```

Keep each setter's existing doc comment.

- [ ] **Step 3: `bulk.ts`**

```ts
/** Runs one request per item with allSettled semantics (spec 12): every item is attempted,
 *  and the result says which succeeded, failed or were skipped (op returned null). */
export interface BulkResult<T> { ok: T[]; failed: T[]; skipped: T[] }

export async function runBulk<T>(items: T[], op: (item: T) => Promise<Response> | null): Promise<BulkResult<T>> {
  const result: BulkResult<T> = { ok: [], failed: [], skipped: [] };
  const attempts = items.map(item => ({ item, req: op(item) }));
  for (const a of attempts) if (a.req === null) result.skipped.push(a.item);
  const live = attempts.filter((a): a is { item: T; req: Promise<Response> } => a.req !== null);
  const settled = await Promise.allSettled(live.map(a => a.req));
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled' && s.value.ok) result.ok.push(live[i].item);
    else result.failed.push(live[i].item);
  });
  return result;
}

/** "3 items updated", "2 of 3 updated", "2 deleted · 1 academic item skipped". */
export function summariseBulk(verb: string, r: BulkResult<unknown>, skippedNoun = 'item'): string {
  const attempted = r.ok.length + r.failed.length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let head = r.failed.length === 0
    ? `${plural(r.ok.length, 'item')} ${verb}`
    : `${r.ok.length} of ${attempted} ${verb}`;
  if (r.skipped.length > 0) head += ` · ${plural(r.skipped.length, skippedNoun)} skipped`;
  return head;
}
```

- [ ] **Step 4: `deferredDelete.ts`**

```ts
/** Delete-after-undo-window (spec 12). The row hides immediately; `run` fires once the delay
 *  passes without cancel, or on pagehide with keepalive so a closed tab still deletes. */
type Entry = { timer: number; run: (keepalive: boolean) => Promise<unknown> };

const pending = new Map<string, Entry>();
let listening = false;

function flushAllOnHide() {
  for (const [key, e] of pending) {
    window.clearTimeout(e.timer);
    void e.run(true);
    pending.delete(key);
  }
}

export function scheduleDelete(
  key: string,
  run: (keepalive: boolean) => Promise<unknown>,
  delayMs = 5000,
): { cancel: () => void; flush: () => void } {
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushAllOnHide);
    listening = true;
  }
  const existing = pending.get(key);
  if (existing) window.clearTimeout(existing.timer);
  const timer = window.setTimeout(() => { pending.delete(key); void run(false); }, delayMs);
  pending.set(key, { timer, run });
  return {
    cancel: () => { const e = pending.get(key); if (e) { window.clearTimeout(e.timer); pending.delete(key); } },
    flush: () => { const e = pending.get(key); if (e) { window.clearTimeout(e.timer); pending.delete(key); void e.run(false); } },
  };
}
```

- [ ] **Step 5: Verify.** `npx tsc --noEmit` exits 0, and the style gate is clean on the five files. In Playwright, change a status in the Table and confirm it still saves, since the setters now go through `patchItem`.

---

### Task 8: Route loading skeleton + Phase 0 checkpoint

**Files:**
- Create: `src/app/workboard/loading.tsx`

- [ ] **Step 1: `loading.tsx`**

```tsx
import './workboard.css';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';

export default function WorkboardLoading() {
  return (
    <div className="vb-bg min-h-screen" style={{ padding: '40px 5%' }} aria-busy="true" aria-label="Loading Workboard">
      <WbSkeleton width={220} height={34} style={{ marginBottom: 10 }} />
      <WbSkeleton width={300} height={14} style={{ marginBottom: 24 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 22 }}>
        {[0, 1, 2, 3].map(i => <WbSkeleton key={i} height={96} radius={16} />)}
      </div>
      <WbSkeleton height={40} radius={10} style={{ marginBottom: 18, maxWidth: 420 }} />
      <div style={{ display: 'grid', gap: 8 }}>
        {Array.from({ length: 8 }, (_, i) => <WbSkeleton key={i} height={34} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Phase 0 checkpoint.**
  1. `npx tsc --noEmit` exits 0.
  2. Style gate: `node scripts/wb-style-gate.mjs src/app/workboard/workboard.css src/app/workboard/loading.tsx src/lib/workboard/ui/*.ts src/components/workboard/ui/*.tsx src/components/workboard/workApi.ts` is clean.
  3. Curl returns `307`.
  4. Playwright (user logged in): screenshots of `/workboard` at 390, 820 and 1440 widths. There should be no visual change yet beyond toasts being available, and the console should be clean.
  5. Report to the user and wait for approval.

---

# Phase 1: Header and KPI (§5)

### Task 9: KPI series and micro-visuals

**Files:**
- Create: `src/lib/workboard/ui/kpiSeries.ts`
- Create: `src/components/workboard/ui/KpiVisuals.tsx`

**Interfaces:**
- Produces:
  - `weekCompletion(items: WorkItem[], weekStart: string): { done: number; total: number }`
  - `dueNextThreeDays(items: WorkItem[], today: string): [number, number, number]`
  - `estimateByDay(items: WorkItem[], weekStart: string): number[]`, length 7, Mon to Sun
  - `todaySummary(items: WorkItem[], today: string): { dueToday: number; overdue: number }`
  - `ProgressBar({ value, label }: { value: number; label: string })`, where `value` is 0 to 1
  - `DueDots({ counts, labels, alertFirst }: { counts: [number, number, number]; labels: [string, string, string]; alertFirst?: boolean })`
  - `Sparkline({ values, todayIndex, label }: { values: number[]; todayIndex: number | null; label: string })`

- [ ] **Step 1: `kpiSeries.ts`**

```ts
/** Pure series behind the KPI micro-visuals (spec 5, plan ruling R2). Whole-board: callers pass
 *  `work.items`, never the filtered list, so the tiles never move as the user filters. */
import type { WorkItem } from '@/lib/workboard/workItems';
import { addDays, dueDateOf } from '@/lib/workboard/dates';

export function weekCompletion(items: WorkItem[], weekStart: string): { done: number; total: number } {
  const weekEnd = addDays(weekStart, 6);
  let done = 0;
  let total = 0;
  for (const item of items) {
    const due = dueDateOf(item);
    if (due === null || due < weekStart || due > weekEnd) continue;
    total++;
    if (item.work_status === 'done') done++;
  }
  return { done, total };
}

export function dueNextThreeDays(items: WorkItem[], today: string): [number, number, number] {
  const days = [today, addDays(today, 1), addDays(today, 2)];
  const out: [number, number, number] = [0, 0, 0];
  for (const item of items) {
    if (item.work_status === 'done') continue;
    const idx = days.indexOf(dueDateOf(item) ?? '');
    if (idx >= 0) out[idx]++;
  }
  return out;
}

export function estimateByDay(items: WorkItem[], weekStart: string): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const item of items) {
    if (item.estimated_hours == null) continue;
    const due = dueDateOf(item);
    if (due === null) continue;
    for (let i = 0; i < 7; i++) {
      if (addDays(weekStart, i) === due) { out[i] += Number(item.estimated_hours); break; }
    }
  }
  return out;
}

export function todaySummary(items: WorkItem[], today: string): { dueToday: number; overdue: number } {
  let dueToday = 0;
  let overdue = 0;
  for (const item of items) {
    if (item.work_status === 'done') continue;
    const due = dueDateOf(item);
    if (due === null) continue;
    if (due === today) dueToday++;
    else if (due < today) overdue++;
  }
  return { dueToday, overdue };
}
```

- [ ] **Step 2: `KpiVisuals.tsx`**

```tsx
'use client';

/** dataviz micro-visuals for the KPI tiles (spec 5). Each graphic is aria-hidden and has a
 *  text equivalent in an sr-only span. No chart library. */

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div>
      <span className="wb-sr-only">{label}</span>
      <div aria-hidden style={{ height: 4, borderRadius: 2, background: 'var(--wb-hairline)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: '100%', background: 'var(--wb-blue)',
          transform: `scaleX(${v})`, transformOrigin: 'left center',
        }} />
      </div>
    </div>
  );
}

export function DueDots({ counts, labels, alertFirst }: {
  counts: [number, number, number];
  labels: [string, string, string];
  alertFirst?: boolean;
}) {
  const max = Math.max(1, ...counts);
  return (
    <div>
      <span className="wb-sr-only">{labels.map((l, i) => `${l}: ${counts[i]}`).join(', ')}</span>
      <div aria-hidden style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        {counts.map((n, i) => {
          const size = n === 0 ? 6 : 8 + Math.round((n / max) * 6);
          const color = n === 0 ? 'var(--wb-hairline)' : i === 0 && alertFirst ? 'var(--wb-danger)' : 'var(--wb-blue-strong)';
          return (
            <div key={labels[i]} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span style={{ width: size, height: size, borderRadius: '50%', background: color }} />
              <span style={{ font: '600 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-text-subtle)' }}>{labels[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Sparkline({ values, todayIndex, label }: { values: number[]; todayIndex: number | null; label: string }) {
  const W = 96;
  const H = 26;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const pts = values.map((v, i) => [i * step, H - 2 - (v / max) * (H - 6)] as const);
  return (
    <div>
      <span className="wb-sr-only">{label}</span>
      <svg aria-hidden width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible', display: 'block' }}>
        <polyline
          points={pts.map(p => p.join(',')).join(' ')}
          fill="none" stroke="var(--wb-blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        />
        {todayIndex !== null && pts[todayIndex] && (
          <circle cx={pts[todayIndex][0]} cy={pts[todayIndex][1]} r={3} fill="var(--wb-blue-strong)" />
        )}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Verify.** `npx tsc --noEmit` exits 0, and the style gate is clean on both files.

---

### Task 10: KPI tiles rebuilt (§5)

**Files:**
- Modify: `src/components/workboard/WorkboardStats.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx` (pass the new props)

**Interfaces:**
- Consumes: Task 9's functions and components.
- Produces: `WorkboardStatsProps` = `{ stats: WorkStats; oldestOverdueDue: string | null; items: WorkItem[]; today: string; weekStart: string }`.

- [ ] **Step 1: Restyle the tile shell.** In `WorkboardStats.tsx`:
  - Replace the hex values in `ACCENT` with token references: active → `var(--wb-blue)`, due_soon → `var(--wb-blue-strong)`, estimated → `var(--wb-ctx-project)`, overdue → `var(--wb-danger)`.
  - `Card` keeps its top stripe and `IconChip`. Do not reintroduce the left edge bar the user removed.
  - Card surface: `background: var(--wb-glass); border: 1px solid var(--wb-glass-border); border-radius: var(--wb-r-panel); padding: 14px 16px`.
  - `Label`: `font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .05em; text-transform: uppercase; color: var(--wb-text-muted)`.
  - `Numeral`: `font: 800 var(--wb-fs-24) var(--wb-font-head)`, colour `var(--wb-text)`, or `var(--wb-danger)` when `alert`.
  - `Subtitle`: `font: 500 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted)`.
  - Any `onActivate` card is a `button` with the classes `wb-pressable wb-focus-ring`.

- [ ] **Step 2: Add the micro-visual under each numeral.** Compute these at the top of `WorkboardStats`:

```tsx
const completion = useMemo(() => weekCompletion(items, weekStart), [items, weekStart]);
const dueDots = useMemo(() => dueNextThreeDays(items, today), [items, today]);
const spark = useMemo(() => estimateByDay(items, weekStart), [items, weekStart]);
const todayIdx = useMemo(() => {
  for (let i = 0; i < 7; i++) if (addDays(weekStart, i) === today) return i;
  return null;
}, [weekStart, today]);
```

Then render:
- **Active:** `<ProgressBar value={completion.total ? completion.done / completion.total : 0} label={`${completion.done} of ${completion.total} due this week done`} />`. The subtitle is `` `${completion.done} of ${completion.total} done this week` ``, or `` `${in_progress_count} in progress` `` when `completion.total === 0`.
- **Due Soon:** `<DueDots counts={dueDots} labels={['Today', 'Tmrw', weekdayShort(addDays(today, 2))]} />`. The subtitle stays "Within the next 3 days".
- **Estimated This Week:** `<Sparkline values={spark} todayIndex={todayIdx} label={`Estimated hours per day: ${spark.join(', ')}`} />`, and the subtitle stays as it is.
- **Overdue:** no visual. When `overdue_count === 0`, the numeral slot shows `All clear` in `var(--wb-success)` at `var(--wb-fs-20)` instead of `0`, and the subtitle reads `Nothing past due`.

Add this helper:

```ts
function weekdayShort(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
}
```

Imports: `useMemo` (react); `weekCompletion, dueNextThreeDays, estimateByDay` (`@/lib/workboard/ui/kpiSeries`); `{ ProgressBar, DueDots, Sparkline }` (`./ui/KpiVisuals`); `addDays` (`@/lib/workboard/dates`); `type WorkItem` (`@/lib/workboard/workItems`).

- [ ] **Step 3: Grid.** Keep the `.vb-stat-grid` styled-jsx block (4 columns at ≥1024px, 2 below). Set `gap: 14px` on the base rule and `gap: 10px` under `@media (max-width: 767px)`, removing the inline `gap`.

- [ ] **Step 4: Shell props.** `<WorkboardStats stats={work.stats} oldestOverdueDue={oldestOverdueDue} items={work.items} today={work.generated_at} weekStart={work.week_start} />`.

- [ ] **Step 5: Verify.** `npx tsc --noEmit` exits 0, and `node scripts/wb-style-gate.mjs src/components/workboard/WorkboardStats.tsx src/components/workboard/ui/KpiVisuals.tsx` is clean.

---

### Task 11: Header, toolbar and segmented view switcher (§5)

**Files:**
- Modify: `src/components/workboard/WorkboardShell.tsx`

**Interfaces:**
- Consumes: `WbSegmented` (Task 5) and `todaySummary` (Task 9).
- Produces: the search input keeps `padding-right: 64px`, the space Task 32's `Ctrl K` chip will occupy. No palette state is added in this task.

- [ ] **Step 1: Title row.** Replace the `<h1>` + subtitle block with:

```tsx
<div>
  <h1 className="gradient-text" style={{ fontSize: 'var(--wb-fs-24)', fontFamily: 'var(--wb-font-head)', fontWeight: 800, margin: '0 0 4px', lineHeight: 1.15 }}>Workboard</h1>
  <p style={{ margin: 0, font: '500 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-text-muted)' }}>
    {formatLongDate(work.generated_at)}
    {' · '}{summary.dueToday} due today
    {summary.overdue > 0 && <> · <span style={{ color: 'var(--wb-danger)', fontWeight: 600 }}>{summary.overdue} overdue</span></>}
  </p>
</div>
```

Supporting code:

```ts
const summary = useMemo(() => todaySummary(work.items, work.generated_at), [work.items, work.generated_at]);
```

```ts
function formatLongDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
```

The heading drops from 2.2rem to 24px on purpose: quieter chrome, with the KPI numerals now carrying the weight.

The title row's right side holds two things, in a `display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap` group:
1. the existing context radiogroup (restyled in Step 3);
2. the **New item** button moved here from the toolbar: `className="vb-btn-pink wb-pressable"`, a lucide `Plus` icon of size 16 before the label `New item`, `minHeight: 40`.

- [ ] **Step 2: Toolbar row.** Replace the `VIEWS.map` tablist with:

```tsx
<div className="vb-seg-scroll">
  <WbSegmented
    options={VIEWS.map(({ key, label, Icon }) => ({ key, label, icon: <Icon size={16} aria-hidden /> }))}
    value={view}
    onChange={setView}
    ariaLabel="Workboard view"
    idPrefix="vb-view-tab"
    controls="vb-view-panel"
    hideLabelsBelow={1024}
  />
</div>
```

Delete `viewTabRefs` and the `.vb-view-switch-*` styled-jsx rules. Keep `handleRovingKeyDown`, which the context radiogroup still uses. The toolbar's right group becomes `[search field][Filters]`.

Search input style:
- `border-radius: var(--wb-r-lg)`, `background: rgba(255,255,255,.6)`, `border: 1px solid var(--wb-hairline)`.
- `font: 500 var(--wb-fs-13) var(--wb-font-ui)`, `padding: 8px 64px 8px 36px`.
- Placeholder `Search…`.

Add these to the shell's styled-jsx:

```css
.vb-seg-scroll { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.vb-seg-scroll::-webkit-scrollbar { display: none; }
@media (max-width: 767px) {
  .vb-seg-scroll { width: 100%; }
}
```

- [ ] **Step 3: Context radiogroup restyle.** Keep its semantics and keyboard handling. Change:
  - inline colours to `var(--wb-text)` (active) and `var(--wb-text-muted)`;
  - font-size `0.82rem` → `var(--wb-fs-13)`;
  - the active underline to `var(--wb-blue)`, and the My Work gradient to `linear-gradient(to right, var(--wb-ctx-life), var(--wb-blue))`.

  In the styled-jsx block, replace each `#2a7fa8` focus outline with `var(--wb-blue-strong)`.

- [ ] **Step 4: Verify.**
  - `npx tsc --noEmit` exits 0.
  - The style gate is clean on `WorkboardShell.tsx`. Any hex left in the shell from blocks this task does not touch, such as `GLASS`, should also move to tokens now: `GLASS` becomes `background: var(--wb-glass)`, `border: 1px solid var(--wb-glass-border)`, `borderRadius: 'var(--wb-r-panel)'`, keeping the blur.
  - Playwright: clicking a view slides the pill, and Left/Right arrow keys switch views without a slide.

---

### Task 12: Phase 1 checkpoint

- [ ] Run tsc, the style gate on every file touched in Tasks 9–11, and curl (expect `307`).
- [ ] Playwright (logged in): screenshots of the header and KPI area at 390, 820 and 1440, with a clean console.
- [ ] At 390px, check: no horizontal page scroll, tiles in a 2×2 grid, and a segmented control that scrolls inside its own row.
- [ ] Show the user the screenshots and wait for approval before Phase 2.

---

# Phase 2: Focus (§6, §11)

### Task 13: Quick-add logic and WbQuickAdd

**Files:**
- Create: `src/lib/workboard/ui/quickAdd.ts`
- Create: `src/components/workboard/ui/WbQuickAdd.tsx`
- Modify: `src/app/workboard/workboard.css` (append the quick-add rules)

**Interfaces:**
- Consumes: `createOwnedItem` (Task 7).
- Produces:
  - `interface CourseOption { userSubjectId: number; code: string }`
  - `courseOptions(items: WorkItem[]): CourseOption[]`
  - `quickAddContexts(hasCourses: boolean): WorkContext[]`
  - `defaultQuickAddContext(filter: WorkContext | 'all', hasCourses: boolean): WorkContext`
  - `rememberQuickAddContext(ctx: WorkContext): void`
  - `stageFor(ctx: WorkContext, stage: WorkStage | undefined): WorkStage | undefined`
  - `interface QuickAddDefaults { dueAt: string | null; stage?: WorkStage; preferredCourseId?: number | null }`
  - `WbQuickAdd(props: { open: boolean; onClose: () => void; label: string; defaults: QuickAddDefaults; filter: WorkContext | 'all'; courses: CourseOption[]; onCreated: () => Promise<void> | void })`

- [ ] **Step 1: `quickAdd.ts`**

```ts
/** Quick-add defaults (spec 11, plan ruling R1). Pool-free. */
import type { WorkItem } from '@/lib/workboard/workItems';
import { WORK_CONTEXTS, isStageLegal, normaliseStage, type WorkContext, type WorkStage } from '@/lib/workboard/workContexts';

export interface CourseOption { userSubjectId: number; code: string }

export interface QuickAddDefaults {
  dueAt: string | null;
  stage?: WorkStage;
  preferredCourseId?: number | null;
}

const LAST_KEY = 'wb.quickAdd.lastContext';

export function courseOptions(items: WorkItem[]): CourseOption[] {
  const seen = new Map<number, string>();
  for (const item of items) {
    if (item.category !== 'academic' || item.user_subject_id == null) continue;
    if (!seen.has(item.user_subject_id)) {
      seen.set(item.user_subject_id, item.course_code ?? item.chip_label ?? `Course ${item.user_subject_id}`);
    }
  }
  return [...seen].map(([userSubjectId, code]) => ({ userSubjectId, code })).sort((a, b) => a.code.localeCompare(b.code));
}

export function quickAddContexts(hasCourses: boolean): WorkContext[] {
  return WORK_CONTEXTS.filter(c => c !== 'academic' || hasCourses);
}

function readLast(): WorkContext | null {
  try {
    const v = window.localStorage.getItem(LAST_KEY);
    return (WORK_CONTEXTS as string[]).includes(v ?? '') ? (v as WorkContext) : null;
  } catch { return null; }
}

export function rememberQuickAddContext(ctx: WorkContext): void {
  try { window.localStorage.setItem(LAST_KEY, ctx); } catch { /* storage unavailable: default next time */ }
}

export function defaultQuickAddContext(filter: WorkContext | 'all', hasCourses: boolean): WorkContext {
  const allowed = quickAddContexts(hasCourses);
  if (filter !== 'all' && allowed.includes(filter)) return filter;
  const last = readLast();
  if (last && allowed.includes(last)) return last;
  // Spec 11: fall back to the first owned (non-academic) context in WORK_CONTEXTS order.
  return 'project';
}

/** A Board column's stage may not exist in the context the user switched quick add to;
 *  fall back to the normalised status, which every context accepts. */
export function stageFor(ctx: WorkContext, stage: WorkStage | undefined): WorkStage | undefined {
  if (stage === undefined) return undefined;
  return isStageLegal(ctx, stage) ? stage : normaliseStage(stage);
}
```

- [ ] **Step 2: Append to `workboard.css`**

```css
/* ---------- Quick add ---------- */
.wb-qa {
  display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 2px 6px 2px 10px; margin-top: 4px;
  border: 1.5px dashed rgba(116, 188, 217, 0.55); border-radius: var(--wb-r-md); background: rgba(116, 188, 217, 0.06);
}
.wb-qa:focus-within { border-style: solid; border-color: var(--wb-blue-strong); background: var(--wb-surface); }
.wb-qa__input {
  flex: 1; min-width: 0; border: 0; outline: none; background: transparent;
  font: 500 var(--wb-fs-14) var(--wb-font-ui); color: var(--wb-text);
}
.wb-qa__input::placeholder { color: var(--wb-text-subtle); }
.wb-qa__select {
  max-width: 120px; border: 1px solid var(--wb-hairline); border-radius: var(--wb-r-sm); background: var(--wb-surface);
  font: 600 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted); padding: 3px 4px;
}
.wb-qa__hint { font: 500 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-subtle); white-space: nowrap; }
.wb-qa-draft {
  display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; border-radius: var(--wb-r-md);
  font: 500 var(--wb-fs-14) var(--wb-font-ui); color: var(--wb-text);
}
.wb-qa-draft__msg { margin-left: auto; font: 600 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-danger); }
.wb-qa-draft__btn,
.wb-add-trigger {
  border: 0; background: transparent; cursor: pointer; padding: 4px 6px; border-radius: var(--wb-r-sm);
  font: 700 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-blue-strong);
}
@media (hover: hover) and (pointer: fine) {
  .wb-add-trigger:hover, .wb-qa-draft__btn:hover { background: var(--wb-selected); }
}
@media (max-width: 767px) {
  .wb-qa__hint { display: none; }
  .wb-add-trigger { min-height: 40px; }
}
```

- [ ] **Step 3: `WbQuickAdd.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { CONTEXT_LABELS, type WorkContext } from '@/lib/workboard/workContexts';
import { createOwnedItem } from '../workApi';
import {
  defaultQuickAddContext, quickAddContexts, rememberQuickAddContext, stageFor,
  type CourseOption, type QuickAddDefaults,
} from '@/lib/workboard/ui/quickAdd';

interface Draft {
  id: number;
  title: string;
  ctx: WorkContext;
  courseId: number | null;
  state: 'pending' | 'error';
  error?: string;
}

export interface WbQuickAddProps {
  open: boolean;
  onClose: () => void;
  /** e.g. "Add to Today"; used as placeholder and accessible name. */
  label: string;
  defaults: QuickAddDefaults;
  filter: WorkContext | 'all';
  courses: CourseOption[];
  onCreated: () => Promise<void> | void;
}

let draftSeq = 0;

export default function WbQuickAdd({ open, onClose, label, defaults, filter, courses, onCreated }: WbQuickAddProps) {
  const hasCourses = courses.length > 0;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [ctx, setCtx] = useState<WorkContext>(() => defaultQuickAddContext(filter, hasCourses));
  const [courseId, setCourseId] = useState<number | null>(
    () => defaults.preferredCourseId ?? courses[0]?.userSubjectId ?? null,
  );
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { setCtx(defaultQuickAddContext(filter, hasCourses)); }, [filter, hasCourses]);

  const submit = async (draft: Draft) => {
    setDrafts(ds => ds.map(d => (d.id === draft.id ? { ...d, state: 'pending', error: undefined } : d)));
    const res = await createOwnedItem({
      category: draft.ctx,
      title: draft.title,
      user_subject_id: draft.ctx === 'academic' ? draft.courseId : null,
      due_at: defaults.dueAt,
      work_stage: stageFor(draft.ctx, defaults.stage),
    });
    if (!res.ok) {
      setDrafts(ds => ds.map(d => (d.id === draft.id ? { ...d, state: 'error', error: res.error } : d)));
      return;
    }
    await onCreated();
    setDrafts(ds => ds.filter(d => d.id !== draft.id));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setText(''); onClose(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const title = text.trim();
    if (!title) return;
    rememberQuickAddContext(ctx);
    const draft: Draft = { id: ++draftSeq, title, ctx, courseId, state: 'pending' };
    setDrafts(ds => [...ds, draft]);
    setText('');
    void submit(draft);
  };

  return (
    <div>
      {drafts.map(d => (
        <div key={d.id} className={`wb-qa-draft ${d.state === 'pending' ? 'is-pending' : 'is-error'}`} role="status">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
          {d.state === 'error' && (
            <>
              <span className="wb-qa-draft__msg">{d.error ?? 'Could not save'}</span>
              <button type="button" className="wb-qa-draft__btn wb-focus-ring" onClick={() => void submit(d)}>Retry</button>
              <button type="button" className="wb-qa-draft__btn wb-focus-ring" onClick={() => setDrafts(ds => ds.filter(x => x.id !== d.id))}>Discard</button>
            </>
          )}
        </div>
      ))}
      {open && (
        <div className="wb-qa">
          <input
            ref={inputRef}
            className="wb-qa__input"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={e => {
              // Leaving to the context/course selects inside this row is not a blur-away.
              if (e.relatedTarget && e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) return;
              if (!text.trim()) onClose();
            }}
            placeholder={`${label}…`}
            aria-label={label}
          />
          {filter === 'all' && (
            <select className="wb-qa__select wb-focus-ring" aria-label="Context" value={ctx}
              onChange={e => setCtx(e.target.value as WorkContext)}>
              {quickAddContexts(hasCourses).map(c => <option key={c} value={c}>{CONTEXT_LABELS[c]}</option>)}
            </select>
          )}
          {ctx === 'academic' && (
            <select className="wb-qa__select wb-focus-ring" aria-label="Course" value={courseId ?? ''}
              onChange={e => setCourseId(Number(e.target.value))}>
              {courses.map(c => <option key={c.userSubjectId} value={c.userSubjectId}>{c.code}</option>)}
            </select>
          )}
          <span className="wb-qa__hint">Enter to save · Esc</span>
        </div>
      )}
    </div>
  );
}
```

Drafts render even while the input is closed, so a failed save stays visible with Retry and Discard (spec 11).

- [ ] **Step 4: Verify.** `npx tsc --noEmit` exits 0, and the style gate is clean on `quickAdd.ts`, `WbQuickAdd.tsx` and `workboard.css`.

---

### Task 14: FocusRow

**Files:**
- Create: `src/components/workboard/views/FocusRow.tsx`
- Possibly modify: `src/components/workboard/WorkItemRow.tsx` (portal `RowOverflowMenu`'s menu; see Step 1)

**Interfaces:**
- Consumes: `WbCheckbox` (Task 5), `RowOverflowMenu` (`WorkItemRow.tsx`), `courseColor` / `courseTextColor` (`color.ts`), `CONTEXT_FILL` / `CONTEXT_TEXT` (Task 1), `dueStateOf` / `formatDueLabel` (`dueSemantics.ts`), `daysSince` (`dates.ts`).
- Produces: `FocusRow(props: { item: WorkItem; todayStr: string; onComplete: (item: WorkItem) => void; onOpenDetail: (item: WorkItem) => void; onEdit: (item: WorkItem) => void; variant?: 'default' | 'waiting' })`.

- [ ] **Step 1: Check `RowOverflowMenu` positioning.** Read `RowOverflowMenu` in `WorkItemRow.tsx` (around lines 361–480). If its menu uses `position: fixed` without `createPortal`, wrap the menu element in `createPortal(menu, document.body)`. It renders inside the glass panel, whose `backdrop-filter` makes it the containing block for fixed descendants.

- [ ] **Step 2: Write `FocusRow.tsx`**

```tsx
'use client';

import type { WorkItem } from '@/lib/workboard/workItems';
import WbCheckbox from '../ui/WbCheckbox';
import { RowOverflowMenu } from '../WorkItemRow';
import { courseColor, courseTextColor } from '@/lib/workboard/color';
import { CONTEXT_FILL, CONTEXT_TEXT } from '@/lib/workboard/ui/tokens';
import { dueStateOf, formatDueLabel } from '@/lib/workboard/dueSemantics';
import { daysSince } from '@/lib/workboard/dates';

export interface FocusRowProps {
  item: WorkItem;
  todayStr: string;
  onComplete: (item: WorkItem) => void;
  onOpenDetail: (item: WorkItem) => void;
  onEdit: (item: WorkItem) => void;
  variant?: 'default' | 'waiting';
}

export function contextChip(item: WorkItem): { label: string; fill: string; text: string } {
  if (item.course_code) {
    return { label: item.course_code, fill: courseColor(item.course_code), text: courseTextColor(item.course_code) };
  }
  const label = item.chip_label ?? item.project_name ?? item.organization_name ?? '';
  return { label, fill: CONTEXT_FILL[item.context], text: CONTEXT_TEXT[item.context] };
}

export default function FocusRow({ item, todayStr, onComplete, onOpenDetail, onEdit, variant = 'default' }: FocusRowProps) {
  const chip = contextChip(item);
  const state = dueStateOf(item, todayStr);
  const due = formatDueLabel(item, todayStr);
  const done = item.work_status === 'done';
  const high = item.priority === 'high';
  return (
    <div className="wb-frow wb-hoverable">
      <WbCheckbox
        shape="round"
        checked={done}
        ring={high}
        label={`Complete "${item.title}"${high ? ' (high priority)' : ''}`}
        onChange={() => onComplete(item)}
      />
      <button type="button" className="wb-frow__title wb-focus-ring" onClick={() => onOpenDetail(item)}>
        {item.title}
      </button>
      {variant === 'waiting' ? (
        <span className="wb-frow__meta" style={{ color: 'var(--wb-warn)' }}>
          {item.blocked_reason ? `Waiting on ${item.blocked_reason}` : 'For revision'}
          {item.blocked_since ? ` · ${daysSince(item.blocked_since.slice(0, 10), todayStr)}d` : ''}
        </span>
      ) : (
        <>
          {chip.label && (
            <span className="wb-frow__ctx" style={{ color: chip.text }}>
              <span className="wb-frow__dot" style={{ background: chip.fill }} aria-hidden />{chip.label}
            </span>
          )}
          {due && (
            <span className="wb-frow__meta" style={{ color: state === 'overdue' ? 'var(--wb-danger)' : 'var(--wb-text-muted)' }}>
              {due}
            </span>
          )}
          {item.estimated_hours != null && (
            <span className="wb-frow__meta wb-frow__est">~{Number(item.estimated_hours)}h</span>
          )}
        </>
      )}
      <span className="wb-frow__actions">
        <RowOverflowMenu
          triggerAriaLabel={`More actions for "${item.title}"`}
          menuAriaLabel={`Actions for "${item.title}"`}
          items={[
            { key: 'open', label: 'Open details', onClick: () => onOpenDetail(item) },
            { key: 'edit', label: 'Edit', onClick: () => onEdit(item) },
          ]}
        />
      </span>
      <style jsx>{`
        .wb-frow {
          display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 6px;
          border-radius: var(--wb-r-md); font-family: var(--wb-font-ui);
        }
        .wb-frow__title {
          flex: 1; min-width: 0; text-align: left; border: 0; background: transparent; padding: 0; cursor: pointer;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          font: 500 var(--wb-fs-14) var(--wb-font-ui); color: var(--wb-text);
        }
        .wb-frow__ctx {
          display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; max-width: 120px; overflow: hidden;
          font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .03em; text-transform: uppercase;
        }
        .wb-frow__dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .wb-frow__meta { font: 600 var(--wb-fs-12) var(--wb-font-ui); white-space: nowrap; }
        .wb-frow__est { color: var(--wb-text-muted); min-width: 32px; text-align: right; }
        .wb-frow__actions { opacity: 0; transition: opacity var(--wb-dur-fast) var(--wb-ease); }
        .wb-frow:focus-within .wb-frow__actions { opacity: 1; }
        @media (hover: hover) and (pointer: fine) { .wb-frow:hover .wb-frow__actions { opacity: 1; } }
        @media (hover: none) { .wb-frow__actions { opacity: 1; } }
        @media (max-width: 767px) {
          .wb-frow { height: auto; min-height: 44px; flex-wrap: wrap; row-gap: 2px; padding: 4px 6px; }
          .wb-frow__title { flex-basis: calc(100% - 100px); }
          .wb-frow__ctx { margin-left: 50px; }
          .wb-frow__est { display: none; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Verify.** `npx tsc --noEmit` exits 0, and the style gate is clean on `FocusRow.tsx` (and on `WorkItemRow.tsx` if Step 1 changed it).

---

### Task 15: Focus view rebuilt with completion, Undo and quick add

**Files:**
- Modify: `src/components/workboard/views/WorkListView.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx`

**Interfaces:**
- Consumes: `FocusRow` (Task 14), `WbQuickAdd` / `courseOptions` / `CourseOption` (Task 13), `toastUndo` / `toastError` (Task 6), `setWorkStage` (`WorkItemRow.tsx`), `itemKey` (Task 7), `addDays` (`dates.ts`).
- Produces: `WorkListViewProps` gains `filter: WorkContext | 'all'` and `courses: CourseOption[]`. The shell gains `const courses = useMemo(() => courseOptions(work.items), [work.items]);`, which Tasks 21 and 26 reuse.

- [ ] **Step 1: Section defaults.** Add to `WorkListView.tsx`:

```ts
function sectionDueDate(key: SectionKey, today: string): string | null {
  switch (key) {
    case 'overdue':
    case 'today': return today;
    case 'tomorrow': return addDays(today, 1);
    case 'this_week': return addDays(today, 2);
    case 'later': return addDays(today, 7);
    case 'no_deadline': return null;
  }
}

const SECTION_ADD_LABEL: Record<SectionKey, string> = {
  overdue: 'Add for today', today: 'Add to Today', tomorrow: 'Add to Tomorrow',
  this_week: 'Add to This week', later: 'Add for later', no_deadline: 'Add without a deadline',
};
```

- [ ] **Step 2: Completion with collapse and Undo.** Inside `WorkListView`:

```tsx
const [completing, setCompleting] = useState<Set<string>>(() => new Set());
const [addingTo, setAddingTo] = useState<SectionKey | null>(null);

const without = (key: string) => (s: Set<string>) => { const n = new Set(s); n.delete(key); return n; };
const short = (t: string) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

const complete = async (item: WorkItem) => {
  const key = itemKey(item);
  const prevStage = item.work_stage;
  const prevReason = item.blocked_reason;
  setCompleting(s => new Set(s).add(key));
  const res = await setWorkStage(item, 'done').catch(() => null);
  if (!res || !res.ok) {
    setCompleting(without(key));
    toastError(`Couldn't complete "${short(item.title)}"`, () => complete(item));
    return;
  }
  toastUndo(`Completed "${short(item.title)}"`, async () => {
    const keepsReason = prevStage === 'blocked' || prevStage === 'submitted';
    const undo = await setWorkStage(item, prevStage, keepsReason ? prevReason : undefined).catch(() => null);
    if (!undo || !undo.ok) toastError("Couldn't undo");
    await onChanged();
  });
  await onChanged();
  setCompleting(without(key));
};
```

Render every row (including Waiting rows, which pass `variant="waiting"`) as:

```tsx
<div key={itemKey(item)} className="wb-collapse" data-collapsed={completing.has(itemKey(item)) ? 'true' : undefined}>
  <div>
    <FocusRow item={item} todayStr={todayStr} onComplete={complete} onOpenDetail={onOpenDetail} onEdit={onEdit} />
  </div>
</div>
```

Delete `WaitingRow`, `useIsDesktopRow` and the default `WorkItemRow` import from this file. Do **not** delete `WorkItemRow.tsx`, since its named exports stay in use.

- [ ] **Step 3: Section headings.** Each heading row is `display:flex; align-items:center; gap:6px; margin: 16px 0 6px` (the first has `margin-top: 0`). It contains:
  - The existing collapse toggle button. The label is `800 var(--wb-fs-16) var(--wb-font-head)` and the count is `600 var(--wb-fs-12)` in `var(--wb-text-subtle)`. Overdue's label and count use `var(--wb-danger)` and Waiting's use `var(--wb-warn)`, keeping the `AlertTriangle` and `Hourglass` icons.
  - For every section except Waiting, a right-aligned `<button type="button" className="wb-add-trigger wb-focus-ring" style={{ marginLeft: 'auto' }} onClick={() => setAddingTo(key)}>+ Add</button>`.

  Under each section's rows, always mounted so drafts survive:

```tsx
<WbQuickAdd
  open={addingTo === key}
  onClose={() => setAddingTo(cur => (cur === key ? null : cur))}
  label={SECTION_ADD_LABEL[key]}
  defaults={{
    dueAt: sectionDueDate(key, todayStr),
    preferredCourseId: items.find(i => i.user_subject_id != null)?.user_subject_id ?? null,
  }}
  filter={filter}
  courses={courses}
  onCreated={onChanged}
/>
```

Empty sections keep their empty text, restyled to `500 var(--wb-fs-13)` in `var(--wb-text-subtle)` with no italics.

- [ ] **Step 4: Empty states.**
  - Filtered with no results: keep the copy, restyled with tokens (heading `800 var(--wb-fs-16)` head font, body `500 var(--wb-fs-13)` muted, icon colour `var(--wb-text-faint)`).
  - Nothing at all (not filtered): render the heading "Nothing due", the line "Add something for today →" as a `wb-add-trigger` button that sets `addingTo` to `'today'`, and directly under it the `WbQuickAdd` for `today`. This replaces the old "New Item" empty state.

- [ ] **Step 5: Shell wiring.** In `WorkboardShell.tsx`, add `courses` (above) and pass `filter={category}` and `courses={courses}` to `WorkListView`. Imports: `courseOptions` from `@/lib/workboard/ui/quickAdd`.

- [ ] **Step 6: Verify.**
  - `npx tsc --noEmit` exits 0.
  - The style gate is clean on `WorkListView.tsx` and `WorkboardShell.tsx`.
  - Playwright (logged in):
    1. Use **+ Add** under Today to create `QA revamp item`. It appears under Today, and the input stays open and empty.
    2. Esc closes it.
    3. Tick the new row: the check draws, the row collapses, and the "Completed …" toast appears.
    4. Click Undo: the row returns.
    5. Delete `QA revamp item` through its drawer or edit dialog.

---

### Task 16: Rail restyle (§6)

**Files:**
- Modify: `src/components/workboard/WorkboardRail.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx` (the rail wrapper and media rule)

- [ ] **Step 1: Tokens and type.**
  - Replace every hex in `WorkboardRail.tsx`. `CATEGORY_HUE` becomes `CONTEXT_FILL` from `@/lib/workboard/ui/tokens`; `WORK_CATEGORIES` values are the same strings as the contexts. Text colours become `var(--wb-text)` / `var(--wb-text-muted)`.
  - Raise every font-size below 12px to `var(--wb-fs-12)`, including the heaviest-day number at `0.62rem`.
  - `GLASS` becomes `background: var(--wb-glass)`, `border: 1px solid var(--wb-glass-border)`, `borderRadius: 'var(--wb-r-panel)'`, keeping the blur.

- [ ] **Step 2: Today highlight.** Pass `todayStr` into `WorkloadChart`. For the day whose `date === todayStr`, render its day label at weight 800 in `var(--wb-blue-strong)` and add `outline: 2px solid var(--wb-blue-strong); outline-offset: 1px` to its bar.

- [ ] **Step 3: Hide below 1024px.** In the shell:
  - Wrap `<WorkboardRail …/>` in `<div className="vb-rail-wrap">`.
  - Replace the `@media (max-width: 1023px) { .vb-content-row { flex-direction: column; align-items: stretch; } }` rule with `@media (max-width: 1023px) { .vb-rail-wrap { display: none; } }`.
  - Keep `.vb-content-row { align-items: flex-start; }`.

- [ ] **Step 4: Verify.** `npx tsc --noEmit` exits 0, and the style gate is clean on `WorkboardRail.tsx` and `WorkboardShell.tsx`.

---

### Task 17: Phase 2 checkpoint

- [ ] Run tsc, the style gate on all Phase 2 files, and curl (`307`).
- [ ] Playwright screenshots of Focus at 390, 820 and 1440: one plain, one with a quick add open, and one with an Undo toast showing. The console must be clean.
- [ ] Reduced motion: call `browser_emulate_media` with `reducedMotion: 'reduce'`, then tick a row. It should disappear with no slide or check-draw; an opacity fade is fine.
- [ ] Show the user and wait for approval before Phase 3.

---

# Phase 3: Table (§7, §12)

### Task 18: Selection hook and WbBulkBar

**Files:**
- Create: `src/components/workboard/ui/useSelection.ts`
- Create: `src/components/workboard/ui/WbBulkBar.tsx`
- Modify: `src/app/workboard/workboard.css` (append the bulk-bar rules)

**Interfaces:**
- Produces:
  - `useSelection(orderedKeys: string[]): Selection`
  - `interface Selection { selected: Set<string>; isSelected(k: string): boolean; toggle(k: string, shift: boolean): void; setAll(on: boolean): void; clear(): void; count: number; allState: boolean | 'mixed' }`
  - `type BulkStatusOption = { value: string; label: string }`
  - `WbBulkBar(props: { count: number; statusOptions: BulkStatusOption[]; onStatus: (v: string) => void; onPriority: (v: 'high' | 'normal' | 'low') => void; onDeadline: (dueAt: string | null) => void; onDelete: () => void; onClear: () => void; busy?: boolean })`

- [ ] **Step 1: `useSelection.ts`**

```ts
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface Selection {
  selected: Set<string>;
  isSelected: (k: string) => boolean;
  /** shift extends from the last anchor over `orderedKeys` (spec 7). */
  toggle: (k: string, shift: boolean) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
  count: number;
  allState: boolean | 'mixed';
}

export function useSelection(orderedKeys: string[]): Selection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);

  // Drop keys that left the visible set (filtered out, deleted).
  useEffect(() => {
    setSelected(prev => {
      const visible = new Set(orderedKeys);
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) { if (visible.has(k)) next.add(k); else changed = true; }
      return changed ? next : prev;
    });
  }, [orderedKeys]);

  const toggle = useCallback((k: string, shift: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (shift && anchor.current !== null) {
        const a = orderedKeys.indexOf(anchor.current);
        const b = orderedKeys.indexOf(k);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(orderedKeys[i]);
          return next;
        }
      }
      if (next.has(k)) next.delete(k); else next.add(k);
      anchor.current = k;
      return next;
    });
  }, [orderedKeys]);

  const setAll = useCallback((on: boolean) => {
    setSelected(on ? new Set(orderedKeys) : new Set());
    anchor.current = null;
  }, [orderedKeys]);

  const clear = useCallback(() => { setSelected(new Set()); anchor.current = null; }, []);

  const count = selected.size;
  const allState: boolean | 'mixed' = count === 0 ? false : count === orderedKeys.length ? true : 'mixed';

  return useMemo(() => ({
    selected, isSelected: (k: string) => selected.has(k), toggle, setAll, clear, count, allState,
  }), [selected, toggle, setAll, clear, count, allState]);
}
```

- [ ] **Step 2: Append to `workboard.css`**

```css
/* ---------- Bulk bar ---------- */
.wb-bulkbar {
  position: fixed; left: 50%; bottom: 16px; z-index: 900;
  display: flex; align-items: center; gap: 2px; padding: 6px 6px 6px 14px;
  background: var(--wb-inverse); color: var(--wb-inverse-text); border-radius: var(--wb-r-xl);
  box-shadow: var(--wb-shadow-pop); font: 500 var(--wb-fs-13) var(--wb-font-ui);
  transform: translate(-50%, 0); opacity: 1;
  transition: transform var(--wb-dur) var(--wb-ease), opacity var(--wb-dur) var(--wb-ease);
}
.wb-bulkbar[data-state='enter'] { transform: translate(-50%, 8px); opacity: 0; }
.wb-bulkbar__count { font-weight: 700; margin-right: 8px; white-space: nowrap; }
.wb-bulkbar__btn {
  min-height: 34px; padding: 0 10px; border: 0; border-radius: var(--wb-r-md); background: transparent; cursor: pointer;
  font: 600 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-inverse-muted); white-space: nowrap;
}
.wb-bulkbar__btn--danger { color: var(--wb-inverse-danger); }
.wb-bulkbar__btn:focus-visible { outline: 2px solid var(--wb-blue); outline-offset: 1px; }
@media (hover: hover) and (pointer: fine) { .wb-bulkbar__btn:hover { background: rgba(255, 255, 255, 0.12); } }
.wb-bulkmenu { padding: 4px; min-width: 160px; }
.wb-bulkmenu__item {
  display: block; width: 100%; text-align: left; min-height: 32px; padding: 0 10px; border: 0; border-radius: var(--wb-r-sm);
  background: transparent; cursor: pointer; font: 500 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text);
}
.wb-bulkmenu__item:focus-visible { outline: 2px solid var(--wb-blue-strong); outline-offset: -2px; }
@media (hover: hover) and (pointer: fine) { .wb-bulkmenu__item:hover { background: var(--wb-selected); } }
@media (max-width: 767px) {
  .wb-bulkbar { left: 16px; right: 16px; transform: none; justify-content: space-between; overflow-x: auto; }
  .wb-bulkbar[data-state='enter'] { transform: translateY(8px); }
  .wb-bulkbar__btn { min-height: 40px; }
}
@media (prefers-reduced-motion: reduce) {
  .wb-bulkbar, .wb-bulkbar[data-state='enter'] { transition: opacity var(--wb-dur-fast) linear; transform: translate(-50%, 0); }
}
```

- [ ] **Step 3: `WbBulkBar.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import WbPopover from './WbPopover';

export type BulkStatusOption = { value: string; label: string };
type Menu = 'status' | 'priority' | 'deadline' | null;

export interface WbBulkBarProps {
  count: number;
  statusOptions: BulkStatusOption[];
  onStatus: (v: string) => void;
  onPriority: (v: 'high' | 'normal' | 'low') => void;
  onDeadline: (dueAt: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
  busy?: boolean;
}

export default function WbBulkBar({ count, statusOptions, onStatus, onPriority, onDeadline, onDelete, onClear, busy }: WbBulkBarProps) {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<'enter' | 'open'>('enter');
  const [menu, setMenu] = useState<Menu>(null);
  const [date, setDate] = useState('');
  const refs = { status: useRef<HTMLButtonElement>(null), priority: useRef<HTMLButtonElement>(null), deadline: useRef<HTMLButtonElement>(null) };

  useEffect(() => {
    setMounted(true);
    const id = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && menu === null) onClear(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, onClear]);

  if (!mounted) return null;
  const pick = (fn: () => void) => { setMenu(null); fn(); };

  return createPortal(
    <div className="wb-bulkbar" data-state={phase} role="toolbar" aria-label={`${count} selected`} aria-busy={busy || undefined}>
      <span className="wb-bulkbar__count" aria-live="polite">{count} selected</span>
      <button ref={refs.status} type="button" className="wb-bulkbar__btn" aria-haspopup="menu" aria-expanded={menu === 'status'} onClick={() => setMenu(m => (m === 'status' ? null : 'status'))}>Status ▾</button>
      <button ref={refs.priority} type="button" className="wb-bulkbar__btn" aria-haspopup="menu" aria-expanded={menu === 'priority'} onClick={() => setMenu(m => (m === 'priority' ? null : 'priority'))}>Priority ▾</button>
      <button ref={refs.deadline} type="button" className="wb-bulkbar__btn" aria-haspopup="dialog" aria-expanded={menu === 'deadline'} onClick={() => setMenu(m => (m === 'deadline' ? null : 'deadline'))}>Deadline ▾</button>
      <button type="button" className="wb-bulkbar__btn wb-bulkbar__btn--danger" onClick={onDelete}>Delete</button>
      <button type="button" className="wb-bulkbar__btn" aria-label="Clear selection" onClick={onClear}><X size={16} aria-hidden /></button>

      <WbPopover open={menu === 'status'} anchor={refs.status.current} onClose={() => setMenu(null)} role="menu" ariaLabel="Set status">
        <div className="wb-bulkmenu">
          {statusOptions.map(o => (
            <button key={o.value} type="button" role="menuitem" className="wb-bulkmenu__item" onClick={() => pick(() => onStatus(o.value))}>{o.label}</button>
          ))}
        </div>
      </WbPopover>
      <WbPopover open={menu === 'priority'} anchor={refs.priority.current} onClose={() => setMenu(null)} role="menu" ariaLabel="Set priority">
        <div className="wb-bulkmenu">
          {(['high', 'normal', 'low'] as const).map(p => (
            <button key={p} type="button" role="menuitem" className="wb-bulkmenu__item" onClick={() => pick(() => onPriority(p))}>
              {p === 'high' ? 'High' : p === 'normal' ? 'Normal' : 'Low'}
            </button>
          ))}
        </div>
      </WbPopover>
      <WbPopover open={menu === 'deadline'} anchor={refs.deadline.current} onClose={() => setMenu(null)} ariaLabel="Set deadline" width={220}>
        <div className="wb-bulkmenu" style={{ display: 'grid', gap: 6, padding: 10 }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="New deadline"
            style={{ font: '500 var(--wb-fs-13) var(--wb-font-ui)', padding: 6, border: '1px solid var(--wb-border)', borderRadius: 'var(--wb-r-sm)' }} />
          <button type="button" className="wb-bulkmenu__item" disabled={!date} onClick={() => pick(() => onDeadline(date))}>Apply</button>
          <button type="button" className="wb-bulkmenu__item" onClick={() => pick(() => onDeadline(null))}>Clear deadline</button>
        </div>
      </WbPopover>
    </div>,
    document.body,
  );
}
```

The bar's popovers open upward automatically, because `WbPopover` flips when there isn't room below.

- [ ] **Step 4: Verify.** `npx tsc --noEmit` exits 0, and the style gate is clean on the two new files and `workboard.css`.

---

### Task 19: Shared bulk-action controller in the shell

**Files:**
- Create: `src/components/workboard/useBulkActions.ts`
- Modify: `src/components/workboard/WorkboardShell.tsx`

**Interfaces:**
- Consumes: `runBulk`, `summariseBulk` (Task 7), `patchItem`, `deleteOwnedItem` (Task 7), `scheduleDelete` (Task 7), `toastUndo`, `toastError` (Task 6), `itemKey` (Task 7), `STAGES_BY_CONTEXT`, `STAGE_LABELS`, `isStageLegal` (`workContexts.ts`).
- Produces:
  - `useBulkActions(args: { items: WorkItem[]; refresh: () => Promise<void>; hide: (keys: string[]) => void; unhide: (keys: string[]) => void })`, which returns `{ setStatus(sel: WorkItem[], value: string): Promise<void>; setPriority(sel: WorkItem[], p: WorkPriority): Promise<void>; setDeadline(sel: WorkItem[], dueAt: string | null): Promise<void>; remove(sel: WorkItem[]): void; busy: boolean }`
  - `bulkStatusOptions(context: WorkContext | 'all'): BulkStatusOption[]`
  - Shell state `hiddenKeys: Set<string>` (applied in `visibleItems`), and a `selectionCount` + `setSelectionCount` pair passed down so `WbToaster raised={selectionCount > 0}`.

- [ ] **Step 1: `useBulkActions.ts`**

```ts
'use client';

import { useState } from 'react';
import type { WorkItem, WorkPriority } from '@/lib/workboard/workItems';
import { STAGES_BY_CONTEXT, STAGE_LABELS, isStageLegal, type WorkContext, type WorkStage } from '@/lib/workboard/workContexts';
import { runBulk, summariseBulk } from '@/lib/workboard/ui/bulk';
import { scheduleDelete } from '@/lib/workboard/ui/deferredDelete';
import { itemKey } from '@/lib/workboard/ui/itemKey';
import { patchItem, deleteOwnedItem } from './workApi';
import { toastUndo, toastError, UNDO_MS } from './ui/WbToaster';
import type { BulkStatusOption } from './ui/WbBulkBar';

/** Status options for the bulk bar: the context's own stages, or under My Work the three
 *  normalised statuses, which every context accepts. */
export function bulkStatusOptions(context: WorkContext | 'all'): BulkStatusOption[] {
  const stages: WorkStage[] = context === 'all' ? ['todo', 'in_progress', 'done'] : STAGES_BY_CONTEXT[context];
  return stages.map(s => ({ value: s, label: STAGE_LABELS[s] }));
}

type Snapshot = { item: WorkItem; body: Record<string, unknown> };

export function useBulkActions({ refresh, hide, unhide }: {
  items: WorkItem[];
  refresh: () => Promise<void>;
  hide: (keys: string[]) => void;
  unhide: (keys: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);

  const apply = async (
    sel: WorkItem[],
    verb: string,
    build: (item: WorkItem) => Record<string, unknown> | null,
    snapshot: (item: WorkItem) => Record<string, unknown>,
  ) => {
    setBusy(true);
    const before: Snapshot[] = sel.map(item => ({ item, body: snapshot(item) }));
    const r = await runBulk(sel, item => { const body = build(item); return body ? patchItem(item, body) : null; });
    await refresh();
    setBusy(false);
    const message = summariseBulk(verb, r);
    if (r.failed.length > 0) {
      toastError(message, () => apply(r.failed, verb, build, snapshot));
      return;
    }
    toastUndo(message, async () => {
      const okKeys = new Set(r.ok.map(itemKey));
      const undo = await runBulk(before.filter(b => okKeys.has(itemKey(b.item))), b => patchItem(b.item, b.body));
      if (undo.failed.length > 0) toastError(`Couldn't undo ${undo.failed.length} item${undo.failed.length === 1 ? '' : 's'}`);
      await refresh();
    });
  };

  const setStatus = (sel: WorkItem[], value: string) => apply(
    sel, 'updated',
    item => (isStageLegal(item.context, value) ? { work_stage: value } : null),
    item => ({ work_stage: item.work_stage }),
  );

  const setPriority = (sel: WorkItem[], p: WorkPriority) => apply(
    sel, 'updated', () => ({ priority: p }), item => ({ priority: item.priority }),
  );

  const setDeadline = (sel: WorkItem[], dueAt: string | null) => apply(
    sel, 'updated',
    item => (dueAt === null ? { due_at: null, deadline_time: null } : { due_at: dueAt, deadline_time: item.deadline_time }),
    item => ({ due_at: item.due_at, deadline_time: item.deadline_time }),
  );

  /** Plan ruling R3: owned items only; deletes wait out the Undo window (spec 12). */
  const remove = (sel: WorkItem[]) => {
    const owned = sel.filter(i => i.source === 'owned');
    const skipped = sel.length - owned.length;
    if (owned.length === 0) { toastError('Academic items are deleted from Study Pulse, not here'); return; }
    const keys = owned.map(itemKey);
    hide(keys);
    const handles = owned.map(item => scheduleDelete(itemKey(item), keepalive => deleteOwnedItem(item.id, { keepalive })));
    const n = owned.length;
    const message = `${n} deleted${skipped ? ` · ${skipped} academic item${skipped === 1 ? '' : 's'} skipped` : ''}`;
    toastUndo(message, () => { handles.forEach(h => h.cancel()); unhide(keys); }, {
      duration: UNDO_MS,
      onExpire: () => { window.setTimeout(() => { void refresh().then(() => unhide(keys)); }, 300); },
    });
  };

  return { setStatus, setPriority, setDeadline, remove, busy };
}
```

`scheduleDelete` uses the same 5000ms default as `UNDO_MS`. The refresh 300ms after expiry lets the DELETE land first. `unhide` after the refresh is a no-op for deleted rows, since they are gone, and it restores any row whose DELETE failed.

- [ ] **Step 2: Shell wiring.** In `WorkboardShell.tsx`:

```tsx
const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
const hide = useCallback((keys: string[]) => setHiddenKeys(s => { const n = new Set(s); keys.forEach(k => n.add(k)); return n; }), []);
const unhide = useCallback((keys: string[]) => setHiddenKeys(s => { const n = new Set(s); keys.forEach(k => n.delete(k)); return n; }), []);
const [selectionCount, setSelectionCount] = useState(0);
const bulk = useBulkActions({ items: work.items, refresh: refreshWork, hide, unhide });
```

- In the `visibleItems` filter, add `if (hiddenKeys.has(itemKey(item))) return false;` first, and add `hiddenKeys` to the memo deps.
- `refreshWork` must return a promise. It already does, being `async`.
- Change `<WbToaster raised={false} />` to `<WbToaster raised={selectionCount > 0} />`.
- Pass `bulk`, `onSelectionCount={setSelectionCount}` and `statusOptions={bulkStatusOptions(category)}` to `WorkTableView` (Task 20) and `WorkBoardView` (Task 23).
- Clearing on view or context switch happens because each view owns its own `useSelection` and unmounts or reports 0 on switch. The views also call `onSelectionCount(0)` in an effect cleanup.

- [ ] **Step 3: Verify.** `npx tsc --noEmit` exits 0, and the style gate is clean on `useBulkActions.ts` and `WorkboardShell.tsx`.

---

### Task 20: Table: quiet cells, selection column and bulk bar

**Files:**
- Modify: `src/components/workboard/views/WorkTableView.tsx`
- Modify: `src/components/workboard/table/StatusCell.tsx`, `PriorityCell.tsx`, `DeadlineCell.tsx`, `LinksCell.tsx`
- Modify: `src/components/workboard/LinksPopover.tsx`

**Ruling R7 (made here):** Status and Priority stay native `<select>` elements, because they are keyboard- and screen-reader-native and are not popovers. They get quiet styling only. The **Deadline** and **Links** popovers move to `WbPopover`. *Cost if wrong:* the selects show the OS dropdown instead of a styled list.

**Interfaces:**
- Consumes: `useSelection` (Task 18), `WbBulkBar` (Task 18), `WbCheckbox` (Task 5), `WbPopover` (Task 4), `itemKey` (Task 7), and from Task 19 the `bulk` object, `onSelectionCount`, `statusOptions`.
- Produces: `WorkTableViewProps` gains `bulk: ReturnType<typeof useBulkActions>`, `statusOptions: BulkStatusOption[]` and `onSelectionCount: (n: number) => void`.

- [ ] **Step 1: Shared `itemKey`.** Delete the local `itemKey` functions in `WorkTableView.tsx` and `DeadlineCell.tsx` and import `{ itemKey }` from `@/lib/workboard/ui/itemKey`.

- [ ] **Step 2: Quiet cells.** In `StatusCell` and `PriorityCell`, style the `<select>` with:
  - `appearance: none; background: transparent; border: 1px solid transparent; border-radius: var(--wb-r-sm); padding: 3px 22px 3px 6px; font: 500 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text);`
  - a chevron as a background SVG data URI drawn in `var(--wb-text-subtle)` via `currentColor`, hidden by default (`background-size: 0`).

  Inside the component's styled-jsx, add:

```css
@media (hover: hover) and (pointer: fine) {
  :global(.vb-table-row:hover) select { border-color: var(--wb-border); background-color: var(--wb-surface); background-size: 10px; }
}
select:focus-visible { border-color: var(--wb-blue-strong); outline: 2px solid var(--wb-blue-strong); outline-offset: 1px; background-color: var(--wb-surface); background-size: 10px; }
@media (hover: none) { select { border-color: var(--wb-hairline); background-size: 10px; } }
```

  Priority "High" keeps its pill: `background: var(--wb-danger-bg); color: var(--wb-danger); border-radius: var(--wb-r-pill); font-weight: 700`. Normal and Low show plain muted text.

  For `DeadlineCell` and `LinksCell` triggers, apply the same treatment: a transparent border by default, with border and background on row hover or focus.

- [ ] **Step 3: Move the Deadline and Links popovers to `WbPopover`.**
  - In `DeadlineCell.tsx`, replace `DeadlinePopover`'s own `createPortal` + fixed positioning + outside-click/Esc handling with `<WbPopover open anchor={triggerEl} onClose={...} ariaLabel="Edit deadline" width={280}>{form}</WbPopover>`. Keep its form contents and save logic unchanged. The trigger element comes from the same ref the code currently measures at open.
  - In `LinksPopover.tsx`, do the same for the `usePortal` branch: render the panel inside `WbPopover`. The non-portal branch, used inside the drawer, stays as it is until Task 30.
  - Delete the now-unused position-computation code and its long comments about the `backdrop-filter` containing block. `WbPopover` owns that fix in one place.

- [ ] **Step 4: Selection column.** In `WorkTableView`:

```tsx
const orderedKeys = useMemo(() => sortedRows.map(itemKey), [sortedRows]);
const selection = useSelection(orderedKeys);
useEffect(() => { onSelectionCount(selection.count); }, [selection.count, onSelectionCount]);
useEffect(() => () => onSelectionCount(0), [onSelectionCount]);
// Spec 12: switching context clears the selection (a view switch unmounts the view, which clears it too).
useEffect(() => { selection.clear(); }, [context]); // eslint-disable-line react-hooks/exhaustive-deps
const selectedItems = sortedRows.filter(i => selection.isSelected(itemKey(i)));
```

Use whatever the variable for the sorted rows is called in the file; rename the snippet accordingly.

  - **Header:** add a first `<th style={{ width: 36 }}>` containing `<WbCheckbox shape="square" checked={selection.allState} label="Select all rows" onChange={on => selection.setAll(on)} />`.
  - **Rows:** add a first `<td>` with `<WbCheckbox shape="square" checked={selection.isSelected(k)} label={`Select "${item.title}"`} onChange={(_, e) => selection.toggle(k, e.shiftKey)} className="vb-row-check" />`, and add `is-selected` to the row's className when selected.
  - **CSS** in the view's styled-jsx:

```css
.vb-table-row :global(.vb-row-check) { opacity: 0; transition: opacity var(--wb-dur-fast) var(--wb-ease); }
.vb-table-row:focus-within :global(.vb-row-check),
.vb-table.has-selection :global(.vb-row-check) { opacity: 1; }
@media (hover: hover) and (pointer: fine) { .vb-table-row:hover :global(.vb-row-check) { opacity: 1; } }
@media (hover: none) { :global(.vb-row-check) { opacity: 1; } }
```

  The `<table>` gets `className={`vb-table${selection.count ? ' has-selection' : ''}`}`.
  - **Rows styling:** no zebra striping (remove any `nth-child` background). Use `border-bottom: 1px solid var(--wb-hairline)`, and on hover (fine pointer only) `background: var(--wb-hover)`. Done rows: title `color: var(--wb-text-faint); text-decoration: line-through`. Overdue deadlines: `AlertTriangle` size 13 plus `var(--wb-danger)` text, which `DeadlineCell` may already do; keep it.
  - **Header cells:** `font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .04em; text-transform: uppercase; color: var(--wb-text-muted)`.

- [ ] **Step 5: Bulk bar.**

```tsx
{selection.count > 0 && (
  <WbBulkBar
    count={selection.count}
    statusOptions={statusOptions}
    busy={bulk.busy}
    onStatus={v => void bulk.setStatus(selectedItems, v)}
    onPriority={p => void bulk.setPriority(selectedItems, p)}
    onDeadline={d => void bulk.setDeadline(selectedItems, d)}
    onDelete={() => { bulk.remove(selectedItems); selection.clear(); }}
    onClear={selection.clear}
  />
)}
```

- [ ] **Step 6: Phone cards.** At the phone tier the existing card list stays. Restyle it with tokens, with no hex and the 12px minimum. Add a toolbar toggle button `Select` above the cards, `className="wb-add-trigger"`. While it's on, each card shows a square `WbCheckbox` at the top-left and tapping the checkbox toggles that card. The same `WbBulkBar` appears. The toggle's label becomes `Done` while active, and turning it off clears the selection.

- [ ] **Step 7: Verify.**
  - `npx tsc --noEmit` exits 0.
  - The style gate is clean on every file in this task.
  - Playwright (logged in), Table view:
    1. Hover a row: the checkbox appears and the cell controls show borders.
    2. Tick two rows with a shift-click range: the bar shows "N selected".
    3. Priority → High: the toast says "N items updated · Undo".
    4. Click Undo: the priorities revert.
    5. Open the Deadline cell popover: it is positioned under the cell and closes on Esc.
    6. Create two QA items with Focus quick add, select both, Delete. They vanish, the toast offers Undo; click Undo and they return.
    7. Delete them again and let the toast expire. After a refresh they stay gone.

---

### Task 21: Phase 3 checkpoint

- [ ] Run tsc, the style gate on all Phase 3 files, and curl (`307`).
- [ ] Playwright screenshots of the Table at 390 (with Select mode on), 820 and 1440, with two rows selected and the bar visible. The console must be clean.
- [ ] Show the user and wait for approval before Phase 4.

---

# Phase 4: Board (§8)

### Task 22: Board lanes, cards, + Add and empty columns

**Files:**
- Modify: `src/components/workboard/views/WorkBoardView.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx` (pass `filter`, `courses`)

**Interfaces:**
- Consumes: `WbQuickAdd` (Task 13), `contextChip` (exported from `FocusRow.tsx`, Task 14), `itemKey` (Task 7).
- Produces: `WorkBoardViewProps` gains `filter: WorkContext | 'all'` and `courses: CourseOption[]`.

- [ ] **Step 1: Shared `itemKey`.** Delete the local `itemKey` and import the shared one.

- [ ] **Step 2: Lanes.** Each column root:
  - `border-radius: var(--wb-r-xl)`, `padding: 8px`, `background` = `STAGE_TINT[stage]` (the existing wash), `border-top: 3px solid <stage edge colour>`.
  - Map the hex values in `STAGE_TINT` to tokens: neutral stages use `var(--wb-text-subtle)` at the existing alpha via `color-mix(in srgb, var(--wb-text-subtle) 8%, transparent)`; blue stages use `var(--wb-blue)`; done uses `var(--wb-success-fill)`.
  - The header is the stage name in `800 var(--wb-fs-13) var(--wb-font-head)`, with a count pill (`600 var(--wb-fs-12)`, `background: rgba(255,255,255,.6)`, `border-radius: var(--wb-r-pill)`, `padding: 1px 7px`). The overdue badge (icon + number) stays in `var(--wb-danger)`.
  - Keep the existing column sizing rules (`flex 1 1 200px`, min 200, max 260; mobile `max-width: none`).
  - Add `scroll-snap-type: x mandatory` on the board's scroller and `scroll-snap-align: start` on columns below 768px.

- [ ] **Step 3: Cards.** In `BoardCard`, restore the type minimum. Every font-size is at least `var(--wb-fs-12)`, and the title is `600 var(--wb-fs-13)`/1.3:
  - surface `var(--wb-surface)`, `border-radius: var(--wb-r-lg)`, `padding: 8px 10px`, `box-shadow: var(--wb-shadow-card)`;
  - `border-left: 3px solid` `var(--wb-priority-high|normal|low)` by priority;
  - context line via `contextChip(item)` (11px uppercase 800);
  - due line `600 var(--wb-fs-12)`, `var(--wb-danger)` plus `AlertTriangle` when overdue;
  - estimate and links line `500 var(--wb-fs-12)` muted;
  - done cards: title in `var(--wb-text-faint)` with strikethrough, and "Completed late · date" in `var(--wb-warn)` when late.

  Remove every hex literal in the file. Swap `CATEGORY_META.text` values for `CONTEXT_TEXT[…]`.

- [ ] **Step 4: + Add per column (not Done).** Give each column `const [addingTo, setAddingTo] = useState<string | null>(null)` at view level, keyed by column key. At the bottom of each non-done column:

```tsx
<button type="button" className="wb-add-trigger wb-focus-ring" onClick={() => setAddingTo(col.key)}>+ Add</button>
<WbQuickAdd
  open={addingTo === col.key}
  onClose={() => setAddingTo(cur => (cur === col.key ? null : cur))}
  label={`Add to ${col.label}`}
  defaults={{ dueAt: null, stage: col.key as WorkStage }}
  filter={filter}
  courses={courses}
  onCreated={onChanged}
/>
```

Under "My Work", column keys are the normalised statuses `todo` / `in_progress` / `done`, which are valid `WorkStage` values. Use the file's existing column type.

- [ ] **Step 5: Empty columns.** The existing empty-column button (`STAGE_EMPTY_TEXT`) now opens that column's quick add (`setAddingTo(col.key)`) instead of `onNewItem`. Style it as a dashed box: `border: 1.5px dashed rgba(180,190,210,.55)`, `border-radius: var(--wb-r-lg)`, `padding: 16px 6px`, `500 var(--wb-fs-12)` subtle text. The Done column's empty text is static, not a button.

- [ ] **Step 6: Shell.** Pass `filter={category}` and `courses={courses}` to `WorkBoardView`.

- [ ] **Step 7: Verify.**
  - `npx tsc --noEmit` exits 0.
  - The style gate is clean on `WorkBoardView.tsx`.
  - Playwright: use "+ Add" in In Progress to create `QA board item`. It lands in In Progress. Delete it afterwards.

---

### Task 23: Board selection, drag gap and settle, waiting popover, move Undo

**Files:**
- Create: `src/components/workboard/ui/WaitingPopover.tsx`
- Modify: `src/components/workboard/views/WorkBoardView.tsx`
- Modify: `src/app/workboard/workboard.css` (append the board motion rules)

**Interfaces:**
- Consumes: `useSelection`, `WbBulkBar` (Task 18), the `bulk` object, `statusOptions` and `onSelectionCount` (Task 19), `WbPopover` (Task 4), `toastUndo` / `toastError` (Task 6), `setWorkStage` (`WorkItemRow.tsx`).
- Produces: `WaitingPopover(props: { open: boolean; anchor: HTMLElement | null; title: string; initial?: string; confirmLabel?: string; onConfirm: (reason: string | null) => void; onCancel: () => void })`, which Task 30 reuses. `WorkBoardViewProps` gains `bulk`, `statusOptions` and `onSelectionCount`.

- [ ] **Step 1: `WaitingPopover.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import WbPopover from './WbPopover';

export interface WaitingPopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  title: string;
  initial?: string;
  confirmLabel?: string;
  onConfirm: (reason: string | null) => void;
  onCancel: () => void;
}

/** Replaces window.prompt for "waiting on…" (spec 10.3). Empty input confirms with null. */
export default function WaitingPopover({ open, anchor, title, initial = '', confirmLabel = 'Move', onConfirm, onCancel }: WaitingPopoverProps) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setValue(initial); requestAnimationFrame(() => inputRef.current?.focus()); } }, [open, initial]);
  const confirm = () => onConfirm(value.trim() ? value.trim().slice(0, 255) : null);
  return (
    <WbPopover open={open} anchor={anchor} onClose={onCancel} ariaLabel="Waiting reason" width={280}>
      <form style={{ display: 'grid', gap: 8, padding: 12 }} onSubmit={e => { e.preventDefault(); confirm(); }}>
        <label style={{ font: '600 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-text)' }}>
          What is &ldquo;{title.length > 40 ? `${title.slice(0, 40)}…` : title}&rdquo; waiting on?
          <span style={{ fontWeight: 500, color: 'var(--wb-text-subtle)' }}> (optional)</span>
          <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)} maxLength={255}
            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '7px 9px', font: '500 var(--wb-fs-14) var(--wb-font-ui)', border: '1px solid var(--wb-border)', borderRadius: 'var(--wb-r-md)' }} />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button type="button" className="wb-add-trigger wb-focus-ring" onClick={onCancel}>Cancel</button>
          <button type="submit" className="vb-btn-pink wb-pressable" style={{ width: 'auto', padding: '6px 14px', minHeight: 32 }}>{confirmLabel}</button>
        </div>
      </form>
    </WbPopover>
  );
}
```

- [ ] **Step 2: Replace `window.prompt` in `moveItem`.** Add view state `const [waiting, setWaiting] = useState<{ item: WorkItem; next: WorkStage; anchor: HTMLElement | null } | null>(null);`. In `moveItem`, when `next === 'blocked'`, set `waiting` with the card's trigger element (from the existing `triggerRef` map) and return instead of prompting. Then render:

```tsx
<WaitingPopover
  open={waiting !== null}
  anchor={waiting?.anchor ?? null}
  title={waiting?.item.title ?? ''}
  onCancel={() => setWaiting(null)}
  onConfirm={reason => { const w = waiting; setWaiting(null); if (w) void commitMove(w.item, w.next, reason); }}
/>
```

`commitMove(item, next, reason?)` is the existing body of `moveItem` after the prompt: the `setWorkStage` call, refresh and refocus. Extend it with the Undo toast:

```ts
const prev = item.work_stage;
const prevReason = item.blocked_reason;
const res = await setWorkStage(item, next, reason === undefined ? undefined : reason).catch(() => null);
if (!res || !res.ok) { toastError(`Couldn't move "${item.title}"`, () => commitMove(item, next, reason)); return; }
await onChanged();
toastUndo(`Moved to ${STAGE_LABELS[next]}`, async () => {
  const keeps = prev === 'blocked' || prev === 'submitted';
  await setWorkStage(item, prev, keeps ? prevReason : undefined).catch(() => null);
  await onChanged();
});
```

Keep the existing refocus-after-move logic where it is.

- [ ] **Step 3: Shift-click selection.**

```tsx
const orderedKeys = useMemo(() => columns.flatMap(c => itemsByColumn[c.key].map(itemKey)), [columns, itemsByColumn]);
const selection = useSelection(orderedKeys);
useEffect(() => { onSelectionCount(selection.count); }, [selection.count, onSelectionCount]);
useEffect(() => () => onSelectionCount(0), [onSelectionCount]);
useEffect(() => { selection.clear(); }, [context]); // eslint-disable-line react-hooks/exhaustive-deps
```

Adapt the names to the file's existing grouping memo. On the card's root, handle clicks: `onClickCapture={e => { if (e.shiftKey) { e.preventDefault(); e.stopPropagation(); selection.toggle(itemKey(item), false); } }}`. Board selection toggles single cards: a range across columns has no clear order. Selected cards get `className` `is-board-selected`, styled `box-shadow: 0 0 0 2px var(--wb-blue-strong), var(--wb-shadow-card)`. Render the same `WbBulkBar` block as Task 20 Step 5, built from `selectedItems = items.filter(i => selection.isSelected(itemKey(i)))`.

- [ ] **Step 4: Drag lift, drop gap and settle.** Append to `workboard.css`:

```css
/* ---------- Board drag ---------- */
.wb-card-motion { transition: transform var(--wb-dur) var(--wb-ease-in-out), box-shadow var(--wb-dur) var(--wb-ease); }
.wb-card-motion[data-dragging='true'] { transform: scale(1.02); box-shadow: var(--wb-shadow-pop); opacity: 0.85; }
.wb-card-motion[data-shift='down'] { transform: translateY(var(--wb-drop-gap, 56px)); }
.wb-card-motion[data-settle='true'] { animation: wb-settle var(--wb-dur) var(--wb-ease); }
@keyframes wb-settle { from { transform: scale(1.02); } to { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .wb-card-motion, .wb-card-motion[data-dragging='true'], .wb-card-motion[data-shift='down'] { transition: none; transform: none; }
  .wb-card-motion[data-settle='true'] { animation: none; }
}
```

In the view:
- **State:** `dropTarget: { column: string; index: number } | null` and `settleKey: string | null`.
- **`onDragOver`** on a column: compute `index` as the first card whose rect midpoint is below `e.clientY`, or the card count if none. Set `dropTarget` only when it changes.
- **Gap:** every card in that column at position ≥ `index` renders `data-shift="down"`, and the column sets `style={{ '--wb-drop-gap': `${draggedHeight + 6}px` } as React.CSSProperties}`. `draggedHeight` is captured in `handleDragStart` from `e.currentTarget.getBoundingClientRect().height`.
- The dragged card renders `data-dragging="true"`.
- **Drop:** clear `dropTarget`, run the move, then set `settleKey` to the moved card's key and clear it after `DUR.base` ms. That card renders `data-settle="true"`.
- `onDragLeave` (when leaving the column element itself) and `onDragEnd` clear `dropTarget`.
- Give each card root `className="wb-card-motion"`.

Keyboard moves (the overflow menu's "Move to") get no settle, per the keyboard rule.

- [ ] **Step 5: Verify.**
  - `npx tsc --noEmit` exits 0.
  - The style gate is clean on `WaitingPopover.tsx`, `WorkBoardView.tsx` and `workboard.css`.
  - Playwright on a project-context board with a QA item:
    1. Drag it from To Do to In Progress: neighbouring cards slide apart, the card settles, and "Moved to In Progress · Undo" appears.
    2. Click Undo: it moves back.
    3. Move it to Blocked/For Revision through the overflow menu: the waiting popover opens, type "Ana", and Move. The card shows "Waiting on Ana · 0d".
    4. Cancel on a second attempt leaves the card where it was.
    5. Shift-click two cards: the bar appears.
    6. Delete the QA items.

---

### Task 24: Phase 4 checkpoint

- [ ] Run tsc, the style gate on all Phase 4 files, and curl (`307`).
- [ ] Playwright screenshots of the Board (Academic and My Work) at 390, 820 and 1440, plus one taken mid-drag with the gap open. The console must be clean.
- [ ] Show the user and wait for approval before Phase 5.

---

# Phase 5: Timeline (§9)

**Ruling R8 (made here):** Timeline day columns are lists, not a time-scaled grid, so the "now line" is a **now marker inserted in time order**. It goes between the entries that start before the current Manila time and those that start after, in today's column and in the day panel. It re-evaluates every 60s. *Cost if wrong:* a pixel-positioned line would need a time-scaled column layout, which the spec did not ask for.

**`ClassOverridePopover` is shared with StudyPulse's ScheduleMaker. Do not modify it in this phase**; only call it as Timeline does today.

### Task 25: Week grid without reflow, plus the now marker

**Files:**
- Create: `src/lib/workboard/ui/nowMinutes.ts`
- Modify: `src/components/workboard/views/WorkTimelineView.tsx`

**Interfaces:**
- Produces:
  - `manilaNowMinutes(): number`, minutes since midnight in Asia/Manila
  - `useNowMinutes(): number`, the same value re-read every 60s
  - Timeline state `selectedDay: string | null`, replacing `focusedDay`

- [ ] **Step 1: `nowMinutes.ts`**

```ts
'use client';

import { useEffect, useState } from 'react';

export function manilaNowMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date());
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

export function useNowMinutes(): number {
  const [now, setNow] = useState(manilaNowMinutes);
  useEffect(() => {
    const id = window.setInterval(() => setNow(manilaNowMinutes()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
```

- [ ] **Step 2: Remove the reflow.**
  - Rename `focusedDay` / `setFocusedDay` / `toggleFocus` to `selectedDay` / `setSelectedDay` / `selectDay`, where `selectDay(date)` toggles to `null` when the date is already selected.
  - Every day column becomes `flex: '1 1 0'`, `minWidth: 0`, `minHeight: 220px`. Delete the `transition: 'flex-grow 180ms ease'`, the `isDimmed` sizing and the `expanded` card prop: cards always render their compact form in the grid, because full detail now lives in the day panel.
  - The multi-day bar row renders regardless of selection, since columns are always equal now. Remove the `focusedDay === null` condition.
  - The selected column gets `box-shadow: 0 0 0 2px var(--wb-blue-strong)`. Today keeps `border: 1.5px solid var(--wb-blue)`.
  - The day-header button's aria becomes `aria-pressed={selectedDay === date}` with `aria-label={`Show ${longDate} agenda`}`.

- [ ] **Step 3: Now marker in today's column.**
  1. Build today's entries as one time-ordered list: classes by `start_time`, then events by `starts_at` time, then work items (due markers) with a `deadline_time` by that time. Items with no time go last.
  2. With `const now = useNowMinutes();`, find the first entry whose start ≥ `now`, and render before it:

```tsx
<div role="separator" aria-label={`Now, ${formatClock(now)}`} className="vb-tl-now" />
```

  If every entry starts before `now`, the marker goes after them all. Add to the component's styled-jsx:

```css
.vb-tl-now { position: relative; height: 0; border-top: 2px solid var(--wb-pink); margin: 6px 0 6px 4px; }
.vb-tl-now::before { content: ''; position: absolute; left: -4px; top: -5px; width: 8px; height: 8px; border-radius: 50%; background: var(--wb-pink); }
```

  Add the helper:

```ts
function formatClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
```

- [ ] **Step 4: Tokens and type.**
  - Replace every hex literal in the file: `#2d3748` → `var(--wb-text)`, `#5c6b80` → `var(--wb-text-muted)`, `#8a94a6` → `var(--wb-text-subtle)`, `#9aa4b5` → `var(--wb-text-faint)`, `#256f92` → `var(--wb-blue-ink)`, `#74bcd9` → `var(--wb-blue)`, `#2a7fa8` → `var(--wb-blue-strong)`, `#c0607c` and `#a0405a` → `var(--wb-danger)`, `#fff` → `var(--wb-inverse-text)`.
  - `EDGE_COLOR` becomes `var(--wb-priority-high|normal|low)`.
  - Raise every font-size below 12px: day labels `0.66rem` → 11px uppercase 800 (the allowed exception), bar text `0.68rem` → `var(--wb-fs-12)`, everything else to at least 12px.
  - The week heading uses `formatWeekRange(weekStart, weekEnd)`, giving "Oct 12 – 18" (or "Sep 29 – Oct 5" across months), instead of the raw ISO strings:

```ts
function formatWeekRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const mon = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return s.getUTCMonth() === e.getUTCMonth()
    ? `${mon(s)} ${s.getUTCDate()} – ${e.getUTCDate()}`
    : `${mon(s)} ${s.getUTCDate()} – ${mon(e)} ${e.getUTCDate()}`;
}
```

  - Replace the `title={bar.item.title}` on bars with `aria-label={bar.item.title}` plus the existing visible ellipsis text.
  - Hover rules in the styled-jsx move under `@media (hover: hover) and (pointer: fine)`.

- [ ] **Step 5: Loading skeleton (spec 15).** While `weekLoading` is true, render the seven day columns with three `WbSkeleton` blocks each (heights 28, 28, 20, `radius="var(--wb-r-md)"`) in place of their contents, keeping each column's header. This replaces the 0.6-opacity dimming.

- [ ] **Step 6: Verify.** `npx tsc --noEmit` exits 0, the style gate is clean on both files, and Playwright shows all 7 columns at equal width when a day is clicked.

---

### Task 26: Day panel

**Files:**
- Create: `src/components/workboard/views/TimelineDayPanel.tsx`
- Modify: `src/components/workboard/views/WorkTimelineView.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx` (pass `filter`, `courses`, `onChanged`, `onOpenDetail` to Timeline)

**Interfaces:**
- Consumes: `WbOverlay` (Task 3, used below 1024px), `WbQuickAdd` (Task 13), `useNowMinutes` (Task 25), `contextChip` (Task 14), `dueStateOf` (`dueSemantics.ts`).
- Produces:
  - `TimelineDayPanel(props: { date: string; today: string; classes: ClassOccurrence[]; items: WorkItem[]; events: WorkboardEventItem[]; filter: WorkContext | 'all'; courses: CourseOption[]; onClose: () => void; onChanged: () => Promise<void>; onOpenDetail: (item: WorkItem) => void; onEditClass: (c: ClassOccurrence, anchor: AnchorRect, trigger: HTMLElement) => void; onEditEvent: (e: WorkboardEventItem) => void; switchKey: string })`
  - `WorkTimelineViewProps` gains `filter`, `courses`, `onChanged` and `onOpenDetail`.

- [ ] **Step 1: Write the panel.** Its structure:
  - **Header:**
    - an `<h3 id="vb-day-panel-title">` with the long date ("Tuesday, Oct 13") in `800 var(--wb-fs-16) var(--wb-font-head)`;
    - a summary line in `500 var(--wb-fs-12)` muted: `Today · ` (only when `date === today`), then `${done} of ${total} done`, then `` ` · ${hours}h scheduled` `` when the classes' summed durations are above 0;
    - a close button (`X`, `aria-label="Close day agenda"`, `className="wb-add-trigger wb-focus-ring"`).
  - **Agenda:** a `<ol>` of rows, each laid out as a grid `52px | 1fr`.
    - **Time column:** `700 var(--wb-fs-12)` muted, showing `formatClock(startMinutes)`, or `Due` for an item without `deadline_time`.
    - **Body:** title in `600 var(--wb-fs-13)`, plus a detail line in `500 var(--wb-fs-12)` muted:
      - classes: `venue · instructor · until end_time`, plus the override state (`Cancelled`, `Moved to <date>`, `Online (sync)`, `Online (async)`) when set;
      - items: `contextChip` label and `~Nh`;
      - events: location and `until <end>`.
    - **Ordering:** time-ordered, untimed items last, and the now row (`<li role="separator">` styled like `.vb-tl-now` with the time label `now` in `var(--wb-pink)`) inserted only when `date === today`.
    - **Clicks:** a class row is a `<button>` calling `onEditClass` with its own rect, which opens the existing override popover. An item row is a `<button>` calling `onOpenDetail(item)`. An event row is a `<button>` calling `onEditEvent(e)`.
    - **Overdue items:** title in `var(--wb-danger)` with `AlertTriangle` size 13.
  - **Footer:** `<button className="wb-add-trigger wb-focus-ring">+ Add to {weekday}</button>`, which opens `WbQuickAdd` with `defaults={{ dueAt: date }}`, `label={`Add to ${weekday}`}`, and `onCreated={onChanged}`.
  - **Day switching:** wrap the agenda in `<div key={switchKey} className="vb-day-fade">` with:

```css
.vb-day-fade { animation: vb-day-fade var(--wb-dur-fast) var(--wb-ease); }
@keyframes vb-day-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .vb-day-fade { animation: none; } }
```

  so switching days crossfades its contents (spec 9).

- [ ] **Step 2: Place it.** In `WorkTimelineView`:
  - **≥1024px:** the root becomes a flex row: `[week area flex:1, min-width:0][panel 300px]`. The panel renders only while `selectedDay !== null`, inside `<aside className="vb-day-panel" aria-labelledby="vb-day-panel-title">` with:

```css
.vb-day-panel {
  width: 300px; flex-shrink: 0; align-self: flex-start; box-sizing: border-box; padding: 14px;
  background: var(--wb-surface); border-radius: var(--wb-r-xl); box-shadow: var(--wb-shadow-pop);
  animation: vb-panel-in var(--wb-dur-slow) var(--wb-ease);
}
@keyframes vb-panel-in { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .vb-day-panel { animation: none; } }
```

  The aside is mounted once while any day is selected, and only `switchKey={selectedDay}` changes, so the slide plays once and day switches only crossfade.
  - **<1024px:** render the panel inside `<WbOverlay open variant="drawer" labelledBy="vb-day-panel-title" onClose={() => setSelectedDay(null)}>` instead. Decide with a `matchMedia('(min-width: 1024px)')` state hook (a `useState` + effect listening to `change`, defaulting to `true` during SSR).
  - **Esc** while the desktop aside is open sets `selectedDay` to null. Use a window keydown listener active only while `selectedDay !== null`, ignored when `e.defaultPrevented`.
  - **Week arrows** clear `selectedDay`, as `goToWeek` already does.

- [ ] **Step 3: Shell.** Pass `filter={category}`, `courses={courses}`, `onChanged={refreshWork}` and `onOpenDetail={openDetail}` to `WorkTimelineView`. Day-panel quick adds create work items, so `refreshWork` is the right refresh. Events created elsewhere still use `refreshWeek`.

- [ ] **Step 4: Verify.**
  - `npx tsc --noEmit` exits 0.
  - The style gate is clean on `TimelineDayPanel.tsx`, `WorkTimelineView.tsx` and `WorkboardShell.tsx`.
  - Playwright at 1440:
    1. Click today: the panel slides in with the now marker in order.
    2. Click another day: the contents crossfade and the panel doesn't slide again.
    3. Use "+ Add to <day>" to add `QA tl item`: it appears in that day's column.
    4. Click a class row: the override popover opens.
    5. Esc closes the panel.
  - At 390: clicking a day opens a bottom sheet.
  - Delete the QA item.

---

### Task 27: Directional week slide

**Files:**
- Modify: `src/components/workboard/views/WorkTimelineView.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx` (`goToWeek` returns a promise)

**Interfaces:**
- Consumes: the shell's `goToWeek(weekStart: string): Promise<void>` (already `async`).
- Produces: none.

- [ ] **Step 1: Track direction.** In the view:

```tsx
const [slide, setSlide] = useState<{ dir: 1 | -1; key: number } | null>(null);
const navigate = (nextStart: string, dir: 1 | -1 | 0, viaKeyboard: boolean) => {
  setSelectedDay(null);
  const far = Math.abs((Date.parse(nextStart) - Date.parse(weekStart)) / 86_400_000) > 7;
  setSlide(dir === 0 || far || viaKeyboard ? null : { dir, key: Date.now() });
  onWeekChange(nextStart);
};
```

The prev and next buttons call `navigate(addDays(weekStart, ∓7), ∓1, e.detail === 0)`. `e.detail === 0` means the click came from the keyboard (Enter or Space). **Today** calls `navigate(mondayOf(today), mondayOf(today) > weekStart ? 1 : -1, e.detail === 0)`, so a jump of more than one week gets no slide through `far`.

- [ ] **Step 2: Animate the days row.** Wrap the bar row and the day columns in `<div key={weekStart} className="vb-week-slide" data-dir={slide?.dir}>`:

```css
.vb-week-slide[data-dir='1'] { animation: vb-week-next 160ms var(--wb-ease); }
.vb-week-slide[data-dir='-1'] { animation: vb-week-prev 160ms var(--wb-ease); }
@keyframes vb-week-next { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
@keyframes vb-week-prev { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .vb-week-slide[data-dir] { animation: none; } }
```

Because the key is `weekStart`, the row remounts when the new week's data lands, so the slide plays on the new content rather than before the fetch.

- [ ] **Step 3: Verify.** `npx tsc --noEmit` exits 0, the style gate is clean, and in Playwright clicking next and previous slides in the matching direction. Tab to the arrow and press Enter: no slide.

---

### Task 28: Phase 5 checkpoint

- [ ] Run tsc, the style gate on all Phase 5 files, and curl (`307`).
- [ ] Playwright screenshots of Timeline at 390 (with the bottom-sheet panel open), 820 and 1440 (with the side panel open on today). The console must be clean.
- [ ] Show the user and wait for approval before Phase 6.

---

# Phase 6: Overlays and palette (§10, §13)

### Task 29: Split WorkItemDialog and move it onto WbOverlay

**Files:**
- Create: `src/components/workboard/dialog/` containing `TypeStep.tsx`, `SharedFields.tsx`, `AcademicLinkExisting.tsx`, `AcademicNewGraded.tsx`, `AcademicIndependent.tsx`, `ReminderField.tsx`, `dialogStyles.ts`
- Modify: `src/components/workboard/WorkItemDialog.tsx` (it stays as the orchestrator: state, validation, submit)
- Modify: `src/components/workboard/WorkboardShell.tsx` (`usePresence` for `dialogTarget`)

**Interfaces:**
- Consumes: `WbOverlay`, `usePresence` (Task 3).
- Produces: `WorkItemDialogProps` gains `open: boolean` and keeps the rest unchanged. The `DialogTarget` export is unchanged.

**This task is a move-and-restyle refactor. Behaviour must not change.** Before splitting, read `WorkItemDialog.tsx` in full and list its JSX regions by line range: the type step, each academic path, the shared fields (title, context/project/organization/life area, priority, stage, due/time, estimate, note) and the reminder. Each region becomes one component that receives exactly the state values and setters it reads, as typed props, with no context provider and no behaviour moved. Validation, the submit handler and all `fetch` calls stay in `WorkItemDialog.tsx`.

- [ ] **Step 1: `dialogStyles.ts`.** Shared form styles as `CSSProperties` constants using tokens only:

```ts
import type { CSSProperties } from 'react';

export const FIELD_LABEL: CSSProperties = { display: 'block', marginBottom: 6, font: '600 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-text)' };
export const FIELD_INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: 38, padding: '8px 10px',
  font: '500 var(--wb-fs-14) var(--wb-font-ui)', color: 'var(--wb-text)',
  background: 'var(--wb-surface)', border: '1px solid var(--wb-border)', borderRadius: 'var(--wb-r-md)',
};
export const FIELD_ERROR: CSSProperties = { marginTop: 4, font: '600 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-danger)' };
export const FIELD_HINT: CSSProperties = { marginTop: 4, font: '500 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-text-subtle)' };
export const FIELD_GROUP: CSSProperties = { display: 'grid', gap: 14 };
```

- [ ] **Step 2: Extract the components.** Move each region into its file under `dialog/`, keeping its JSX and replacing its inline styles with the constants above. Labels go above fields. Any error currently shown in a banner or `alert()` for a specific field moves under that field as `<p role="alert" style={FIELD_ERROR}>`. Form-level errors (network) stay in one banner at the top of the form, styled `var(--wb-danger-bg)` / `var(--wb-danger)`.

- [ ] **Step 3: Overlay.** In `WorkItemDialog.tsx`, replace the hand-rolled backdrop/`role="dialog"`/Esc/focus code with:

```tsx
<WbOverlay open={open} onClose={onClose} variant="modal" labelledBy="vb-item-dialog-title" panelStyle={{ width: 'min(600px, calc(100vw - 32px))', padding: 20 }}>
  …header (h2 id="vb-item-dialog-title")…, body, footer…
</WbOverlay>
```

  - **Footer:** Cancel (`wb-add-trigger`), then Save (`vb-btn-pink wb-pressable`). While submitting, Save shows `Saving…` with `aria-busy` and is disabled.
  - **Shortcut:** add `onKeyDown` on the `<form>`: `if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void handleSubmit(); }`, using whatever the existing submit function is called.

- [ ] **Step 4: Shell presence.** `const dlg = usePresence(dialogTarget);` then `{dlg.value && <WorkItemDialog open={dlg.open} target={dlg.value} … />}`. Apply the same pattern to `typeChooserOpen` (convert it to `usePresence(typeChooserOpen ? true : null)`), `eventDialogTarget` and `detailItem` in Tasks 30–31.

- [ ] **Step 5: Verify.**
  - `npx tsc --noEmit` exits 0.
  - The style gate is clean on `WorkItemDialog.tsx` and every `dialog/*` file.
  - Playwright, exercising every path once:
    1. Create a Projects task with a deadline and time.
    2. Create an Academic task through "link existing", then "new graded", then "independent". Use a test course; **if creating graded rows in StudyPulse would pollute real data, stop and ask the user which course to use.**
    3. Edit one, then delete the QA items.
    4. Check that Esc closes, focus returns to "New item", and Ctrl+Enter saves.

---

### Task 30: Drawer on WbOverlay, with property list, inline title and waiting popover

**Files:**
- Modify: `src/components/workboard/WorkItemDetail.tsx`
- Modify: `src/components/workboard/LinksPopover.tsx` (the drawer-embedded branch)
- Modify: `src/components/workboard/WorkboardShell.tsx` (presence + delete action)

**Interfaces:**
- Consumes: `WbOverlay`, `usePresence` (Task 3), `WaitingPopover` (Task 23), `scheduleDelete` (Task 7), `toastUndo` (Task 6), `patchItem` / `deleteOwnedItem` (Task 7).
- Produces: `WorkItemDetailProps` gains `open: boolean` and `onDelete?: (item: WorkItem) => void`. The shell supplies `onDelete` using the same hide / `scheduleDelete` / `toastUndo` flow as `useBulkActions.remove`, called as `bulk.remove([item])`.

- [ ] **Step 1: Overlay.** Replace the drawer's own panel/backdrop/dialog wiring with `<WbOverlay open={open} onClose={onClose} variant="drawer" labelledBy="vb-detail-title" panelStyle={{ padding: 20 }}>`. Remove the comments describing the hand-rolled containing-block workaround. `LinksPopover`'s embedded branch can now use `WbPopover` too, since the drawer's panel no longer has a `backdrop-filter` ancestor problem: delete the `usePortal` prop and always portal through `WbPopover`.

- [ ] **Step 2: Header.** Owned items get an editable title: an `<input id="vb-detail-title" aria-label="Title">` styled as a heading (`800 var(--wb-fs-20) var(--wb-font-head)`, a transparent border that shows `var(--wb-border)` on hover or focus).
  - Enter or blur with a changed value: `patchItem(item, { title })`, then `onChanged()`.
  - Esc: revert to `item.title` and `e.stopPropagation()`, so the drawer stays open.
  - Empty value: revert.

  Academic items render the title as a plain `<h2 id="vb-detail-title">`, since Study Pulse owns their title. Below the title sits the status control: the existing stage select restyled with Task 20's quiet-select rules.

- [ ] **Step 3: Property list.** `<dl style={{ display: 'grid', gridTemplateColumns: '96px 1fr', rowGap: 10, columnGap: 12, margin: '16px 0' }}>`. Each `<dt>` is `600 var(--wb-fs-12)` muted and each `<dd>` (margin 0) is `500 var(--wb-fs-13)`, covering:
  - Context (`contextChip` dot + label),
  - Project (or Course / Organization / Area, per context),
  - Priority,
  - Deadline + time (danger when overdue),
  - Estimate,
  - Waiting (only when `blocked_since`: "Waiting on X · Nd").

  Rows with no value show `—`.

- [ ] **Step 4: Waiting popover.** Wherever the drawer changes the stage to `blocked` (or `submitted` for For Revision), open `WaitingPopover` anchored to the status control instead of calling `window.prompt`, with `confirmLabel="Save"`. A "Waiting on" row with an Edit button reopens it with `initial={item.blocked_reason ?? ''}` and saves via `patchItem(item, { blocked_reason })`.

- [ ] **Step 5: Delete.** Owned items get a footer `Delete` button (`wb-add-trigger`, colour `var(--wb-danger)`) that calls `onDelete(item)` and then `onClose()`.

- [ ] **Step 6: Restyle the rest.** Links and subtasks sections use tokens with the 12px minimum. Subtask checkboxes use `WbCheckbox shape="square"`.

- [ ] **Step 7: Shell.** `const det = usePresence(detailLive);` then `{det.value && <WorkItemDetail key={itemKey(det.value)} open={det.open} item={det.value} … onDelete={item => bulk.remove([item])} />}`.

- [ ] **Step 8: Verify.**
  - `npx tsc --noEmit` exits 0.
  - The style gate is clean on `WorkItemDetail.tsx`, `LinksPopover.tsx` and `WorkboardShell.tsx`.
  - Playwright on a QA owned item:
    1. Open the drawer: it slides from the right.
    2. Rename it inline with Enter.
    3. Set the stage to Blocked: the popover appears; enter a reason.
    4. Add a link: the popover is positioned correctly.
    5. Add and complete a subtask.
    6. Delete: the toast shows Undo; let it expire.
  - At 390: the drawer is a bottom sheet.

---

### Task 31: Event dialog, type chooser and Filters panel on the shared primitives

**Files:**
- Modify: `src/components/workboard/WorkboardEventDialog.tsx`
- Modify: `src/components/workboard/NewItemTypeChooser.tsx`
- Modify: `src/components/workboard/WorkboardFilters.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx`

**Interfaces:**
- Produces:
  - `WorkboardEventDialog` and `NewItemTypeChooser` gain `open: boolean`.
  - `EventDialogTarget`'s create variant gains `initialTitle?: string` (ruling R6). When it is present, the dialog pre-fills the title and sets start to today 09:00 and end to 10:00.

- [ ] **Step 1: Event dialog.**
  - Replace its overlay wiring with `WbOverlay` (`variant="modal"`, `labelledBy` its title id).
  - Restyle with the `dialogStyles.ts` constants.
  - Add Ctrl+Enter submit.
  - Support `initialTitle`.

- [ ] **Step 2: Type chooser.**
  - Use `WbOverlay` (`variant="modal"`, `panelStyle={{ width: 'min(520px, calc(100vw - 32px))', padding: 20 }}`).
  - Keep its per-type accent, check affordance and hover tint/translate. Move the hover rules under `(hover: hover) and (pointer: fine)` and its transitions to `var(--wb-ease)`, and remove hex literals: per-type accents use `var(--wb-blue)` (task), `var(--wb-pink)` (event) and `var(--wb-ctx-project)` (reminder).
  - Its options become `wb-pressable`.

- [ ] **Step 3: Filters panel.** `FiltersPanel` keeps its contents, but:
  - At ≥768px it renders inside `WbPopover` (`placement="bottom-end"`, `width={320}`), replacing its own fixed positioning and outside-click code.
  - At <768px it renders inside `WbOverlay variant="drawer"` (a bottom sheet), replacing its hand-made backdrop.
  - Every hex becomes a token and every sub-12px size becomes 12px.

- [ ] **Step 4: Shell presence.** Wrap `eventDialogTarget` and the chooser with `usePresence`, as in Task 29 Step 4.

- [ ] **Step 5: Verify.**
  - `npx tsc --noEmit` exits 0.
  - The style gate is clean on the three components and the shell.
  - Playwright:
    1. New item → chooser → Event → create `QA event` today. It shows in Timeline.
    2. Open Filters at 1440 (a popover) and at 390 (a sheet).
    3. Set Priority=High, then clear it.
    4. Delete the QA event.

---

### Task 32: Command palette (§13)

**Files:**
- Create: `src/lib/workboard/ui/paletteSearch.ts`
- Create: `src/components/workboard/CommandPalette.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx`
- Modify: `src/app/workboard/workboard.css` (append the palette rules)

**Interfaces:**
- Consumes: `WbOverlay` (Task 3), `contextChip` (Task 14), `dueStateOf` / `formatDueLabel`, `itemKey`, `CONTEXT_LABELS`.
- Produces:
  - `type PaletteScope = 'all' | 'items' | 'goto' | 'create'`
  - `type PaletteRow = { kind: 'item'; item: WorkItem; matchStart: number; matchLen: number } | { kind: 'goto-view'; view: ViewKey; label: string } | { kind: 'goto-context'; context: WorkContext | 'all'; label: string } | { kind: 'create'; type: 'task' | 'event' | 'reminder'; title: string } | { kind: 'show-all'; count: number }`
  - `buildPaletteGroups(input: { query: string; scope: PaletteScope; items: WorkItem[]; recentKeys: string[] }): { heading: string; count?: number; rows: PaletteRow[] }[]`
  - Shell `recentKeys: string[]` (the last 5 item keys opened in the drawer or dialog, newest first) and `openPalette(viaKeyboard: boolean)`.

- [ ] **Step 1: `paletteSearch.ts`**

```ts
/** Pure result builder for the Ctrl+K palette (spec 13). Pool-free. */
import type { WorkItem } from '@/lib/workboard/workItems';
import type { WorkContext } from '@/lib/workboard/workContexts';
import { itemKey } from '@/lib/workboard/ui/itemKey';

export type PaletteScope = 'all' | 'items' | 'goto' | 'create';
export type PaletteViewKey = 'list' | 'table' | 'board' | 'timeline';

export type PaletteRow =
  | { kind: 'item'; item: WorkItem; matchStart: number; matchLen: number }
  | { kind: 'goto-view'; view: PaletteViewKey; label: string }
  | { kind: 'goto-context'; context: WorkContext | 'all'; label: string }
  | { kind: 'create'; type: 'task' | 'event' | 'reminder'; title: string }
  | { kind: 'show-all'; count: number };

export interface PaletteGroup { heading: string; count?: number; rows: PaletteRow[] }

const VIEWS: { view: PaletteViewKey; label: string }[] = [
  { view: 'list', label: 'Focus view' }, { view: 'table', label: 'Table view' },
  { view: 'board', label: 'Board view' }, { view: 'timeline', label: 'Timeline view' },
];
const CONTEXTS: { context: WorkContext | 'all'; label: string }[] = [
  { context: 'all', label: 'My Work' }, { context: 'academic', label: 'Academic' },
  { context: 'project', label: 'Projects' }, { context: 'organization', label: 'Organization' },
  { context: 'life', label: 'Life' },
];
export const MAX_ITEMS = 6;

export function buildPaletteGroups({ query, scope, items, recentKeys }: {
  query: string; scope: PaletteScope; items: WorkItem[]; recentKeys: string[];
}): PaletteGroup[] {
  const q = query.trim().toLowerCase();
  const groups: PaletteGroup[] = [];
  const want = (s: PaletteScope) => scope === 'all' || scope === s;

  if (want('items')) {
    if (q === '') {
      const byKey = new Map(items.map(i => [itemKey(i), i]));
      const recent = recentKeys.map(k => byKey.get(k)).filter((i): i is WorkItem => i !== undefined).slice(0, 5);
      if (recent.length) groups.push({ heading: 'Recent', rows: recent.map(item => ({ kind: 'item', item, matchStart: -1, matchLen: 0 })) });
    } else {
      const matches = items
        .map(item => ({ item, at: item.title.toLowerCase().indexOf(q) }))
        .filter(m => m.at >= 0)
        .sort((a, b) => (a.at === 0 ? 0 : 1) - (b.at === 0 ? 0 : 1) || a.item.title.localeCompare(b.item.title));
      if (matches.length) {
        const rows: PaletteRow[] = matches.slice(0, MAX_ITEMS).map(m => ({ kind: 'item', item: m.item, matchStart: m.at, matchLen: q.length }));
        if (matches.length > MAX_ITEMS) rows.push({ kind: 'show-all', count: matches.length });
        groups.push({ heading: 'Items', count: matches.length, rows });
      }
    }
  }

  if (want('goto')) {
    const rows: PaletteRow[] = [
      ...VIEWS.filter(v => !q || v.label.toLowerCase().includes(q)).map(v => ({ kind: 'goto-view' as const, ...v })),
      ...CONTEXTS.filter(c => !q || c.label.toLowerCase().includes(q)).map(c => ({ kind: 'goto-context' as const, ...c })),
    ];
    if (rows.length) groups.push({ heading: 'Go to', count: q ? rows.length : undefined, rows });
  }

  if (want('create')) {
    const title = query.trim();
    const rows: PaletteRow[] = title
      ? [{ kind: 'create', type: 'task', title }, { kind: 'create', type: 'event', title }]
      : [{ kind: 'create', type: 'task', title: '' }, { kind: 'create', type: 'event', title: '' }, { kind: 'create', type: 'reminder', title: '' }];
    groups.push({ heading: 'Create', rows });
  }

  return groups;
}
```

- [ ] **Step 2: Append to `workboard.css`.** Fixed formatting comes from the approved mockup `palette-a-fixed.html`.

```css
/* ---------- Command palette ---------- */
.wb-pal__in { display: grid; grid-template-columns: 20px 1fr auto; align-items: center; gap: 10px; height: 48px; padding: 0 14px; border-bottom: 1px solid var(--wb-hairline); }
.wb-pal__input { border: 0; outline: none; background: transparent; font: 500 15px var(--wb-font-ui); color: var(--wb-text); min-width: 0; }
.wb-pal__scope { display: flex; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--wb-hairline); }
.wb-pal__chip { font: 600 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted); padding: 3px 9px; border-radius: var(--wb-r-pill); border: 1px solid var(--wb-border); background: var(--wb-surface); cursor: pointer; }
.wb-pal__chip[aria-pressed='true'] { color: var(--wb-ctx-academic-text); background: var(--wb-selected); border-color: rgba(116, 188, 217, 0.5); }
.wb-pal__list { max-height: 340px; overflow-y: auto; padding: 4px 6px 6px; }
.wb-pal__gr { height: 28px; display: flex; align-items: flex-end; padding: 0 8px 4px; font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .06em; text-transform: uppercase; color: var(--wb-text-subtle); }
.wb-pal__row { display: grid; grid-template-columns: 24px minmax(0, 1fr) 92px 84px 44px; align-items: center; column-gap: 10px; height: 36px; padding: 0 8px; border-radius: var(--wb-r-md); font: 500 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text); cursor: pointer; }
.wb-pal__row[aria-selected='true'] { background: var(--wb-selected); box-shadow: inset 2px 0 0 var(--wb-blue-strong); }
.wb-pal__ic { width: 24px; height: 24px; border-radius: var(--wb-r-sm); display: grid; place-items: center; background: var(--wb-selected); color: var(--wb-blue-ink); }
.wb-pal__t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wb-pal__t mark { background: var(--wb-pink-bg); color: inherit; border-radius: 3px; padding: 0 1px; }
.wb-pal__ctx { display: flex; align-items: center; gap: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font: 800 var(--wb-fs-11) var(--wb-font-ui); letter-spacing: .03em; text-transform: uppercase; }
.wb-pal__due { text-align: right; white-space: nowrap; font: 600 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-muted); }
.wb-pal__k { text-align: right; white-space: nowrap; }
.wb-pal__empty { padding: 10px 8px; font: 500 var(--wb-fs-13) var(--wb-font-ui); color: var(--wb-text-subtle); }
.wb-pal__ft { display: flex; align-items: center; gap: 14px; height: 34px; padding: 0 14px; font: 500 var(--wb-fs-12) var(--wb-font-ui); color: var(--wb-text-subtle); border-top: 1px solid var(--wb-hairline); background: var(--wb-surface-sunken); }
.wb-kbd { display: inline-block; min-width: 18px; height: 18px; line-height: 16px; padding: 0 5px; text-align: center; font: 700 var(--wb-fs-11) var(--wb-font-ui); color: var(--wb-text-muted); background: var(--wb-surface); border: 1px solid var(--wb-border); border-bottom-width: 2px; border-radius: 5px; box-sizing: border-box; }
.wb-pal-hint { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); border: 0; background: transparent; cursor: pointer; padding: 2px; display: flex; gap: 2px; }
@media (max-width: 639px) {
  .wb-pal__row { grid-template-columns: 24px minmax(0, 1fr) 84px; }
  .wb-pal__ctx, .wb-pal__k { display: none; }
}
```

The 11px sizes above are uppercase-800 labels or key glyphs, which the style gate allows when the line carries `uppercase` or `wb-fs-11`.

- [ ] **Step 3: `CommandPalette.tsx`.** Props:

```ts
interface CommandPaletteProps {
  open: boolean;
  instant: boolean;
  items: WorkItem[];
  today: string;
  recentKeys: string[];
  onClose: () => void;
  onOpenItem: (item: WorkItem) => void;
  onGoView: (v: ViewKey) => void;
  onGoContext: (c: WorkContext | 'all') => void;
  onCreateTask: (title: string) => void;
  onCreateEvent: (title: string) => void;
  onCreateReminder: () => void;
  onShowAllInTable: (query: string) => void;
}
```

Behaviour:
- **State:** `query`, `scope` and `active` (an index into the flattened rows), with `groups = useMemo(() => buildPaletteGroups({ query, scope, items, recentKeys }), …)` and `flat = groups.flatMap(g => g.rows)`. Reset `active` to 0 whenever `query` or `scope` changes, so the first row is always highlighted.
- **Render:** `<WbOverlay open={open} instant={instant} variant="palette" ariaLabel="Command palette" onClose={onClose} initialFocusRef={inputRef}>`, containing:
  - the input row: a search icon, the input (`role="combobox"`, `aria-expanded`, `aria-controls="wb-pal-list"`, `aria-activedescendant={`wb-pal-opt-${active}`}`, placeholder `Search items, views, or type to create…`) and `<span className="wb-kbd">Esc</span>`;
  - the scope chips, as buttons with `aria-pressed`;
  - the list `<div id="wb-pal-list" role="listbox">`, with each group heading (`wb-pal__gr`, text `${heading}${count !== undefined ? ` · ${count}` : ''}`) followed by rows `role="option"`, `id=wb-pal-opt-${i}` and `aria-selected={i === active}`;
  - the footer.
- **Row cells**, always five (empty spans keep their width):
  - **item:** icon `◻` tinted with `contextChip(item).fill` at 14% alpha via `color-mix(in srgb, ${fill} 14%, transparent)`; title with `<mark>` around `[matchStart, matchStart + matchLen)` when `matchStart >= 0`; ctx (dot + `contextChip` label); due (`formatDueLabel`, with `⚠` and `var(--wb-danger)` when `dueStateOf === 'overdue'`); key cell `<span className="wb-kbd">↵</span>` only on the active row.
  - **goto-view / goto-context:** a lucide icon (`List` / `Table2` / `Columns3` / `GanttChart` for views, `Layers` for contexts); the label; empty ctx and due.
  - **create:** a `Plus` icon on `var(--wb-pink-bg)`; the label `New task “${title}”`, or `New task` when the title is empty (likewise event and reminder); the key cell `<span className="wb-kbd">Ctrl</span><span className="wb-kbd">↵</span>` on the first create row when a title exists.
  - **show-all:** `Show all ${count} in Table`.
  - When there is a query and no `Items` group in `all` or `items` scope, render `<div className="wb-pal__empty">No items match “{query}”</div>` before the Create group.
- **Keys** on the input:
  - ArrowDown/ArrowUp move `active` (wrapping) and scroll the option into view with `block: 'nearest'`, with no animation.
  - Enter runs `flat[active]`.
  - Ctrl/Cmd+Enter with a non-empty query calls `onCreateTask(query.trim())`.
  - Tab (and Shift+Tab) cycles the scope (`preventDefault`).
  - Esc is handled by `WbOverlay`.
- **Running a row:**
  - item → `onOpenItem(item)`
  - goto-view → `onGoView`
  - goto-context → `onGoContext`
  - create task → `onCreateTask(title)`, event → `onCreateEvent(title)`, reminder → `onCreateReminder()`
  - show-all → `onShowAllInTable(query)`

  Every one then calls `onClose()`.
- **Mouse:** hovering a row sets `active` (pointer-fine devices only, via `onPointerMove`), and clicking runs it.
- **Footer:** `↑ ↓ move · ↵ open · Tab scope`, plus on the right either `Ctrl K`, or `${n} items` when a query exists.

- [ ] **Step 4: Shell wiring.**

```tsx
const [palette, setPalette] = useState<{ instant: boolean } | null>(null);
const pal = usePresence(palette, 100);
const [recentKeys, setRecentKeys] = useState<string[]>([]);
const pushRecent = (item: WorkItem) => setRecentKeys(r => [itemKey(item), ...r.filter(k => k !== itemKey(item))].slice(0, 5));

useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPalette(p => (p ? null : { instant: true }));
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, []);
```

- Call `pushRecent(item)` inside `openDetail` and `openEditDialog`.
- In the search field's wrapper, render the hint chip: `<button type="button" className="wb-pal-hint wb-focus-ring" aria-label="Open command palette (Ctrl+K)" onClick={() => setPalette({ instant: false })}><span className="wb-kbd">Ctrl</span><span className="wb-kbd">K</span></button>`.
- Below 768px, the search input is hidden (`.vb-search-input { display: none }` in a media query) and only a search icon button remains, opening the palette with `instant: false`.
- Render the palette:

```tsx
{pal.value && (
  <CommandPalette
    open={pal.open}
    instant={pal.value.instant}
    items={work.items}
    today={work.generated_at}
    recentKeys={recentKeys}
    onClose={() => setPalette(null)}
    onOpenItem={item => openDetail(item)}
    onGoView={setView}
    onGoContext={selectCategory}
    onCreateTask={title => setDialogTarget({ mode: 'create', initialTitle: title })}
    onCreateEvent={title => setEventDialogTarget({ mode: 'create', itemType: 'event', initialTitle: title })}
    onCreateReminder={() => setEventDialogTarget({ mode: 'create', itemType: 'reminder' })}
    onShowAllInTable={q => { setQuery(q); setView('table'); }}
  />
)}
```

- `DialogTarget`'s create variant gains `initialTitle?: string`. In `WorkItemDialog.tsx`, the title state's initial value reads `target.mode === 'create' ? target.initialTitle ?? '' : target.item.title`. Adapt this to the file's existing initialiser.

- [ ] **Step 5: Verify.**
  - `npx tsc --noEmit` exits 0.
  - The style gate is clean on `paletteSearch.ts`, `CommandPalette.tsx`, `workboard.css`, `WorkboardShell.tsx` and `WorkItemDialog.tsx`.
  - Playwright:
    1. Press Ctrl+K: the palette appears with no animation.
    2. With nothing typed, it shows Recent (after opening an item once), Go to and Create.
    3. Type part of a known title: matched letters are highlighted, the columns line up, and a long title truncates without moving the context and due columns.
    4. Arrow keys move the highlight, Enter opens the drawer.
    5. Ctrl+K, type `QA pal`, Ctrl+Enter: the task dialog opens with the title prefilled. Cancel.
    6. Click the hint chip: the palette opens with the fade.
    7. Tab cycles the scope.
    8. At 390: the palette is full width minus 16px and the context and key columns are hidden.

---

### Task 33: Replace title-only tooltips (§15)

**Files:**
- Modify: every Workboard file still containing `title=` as the only explanation of an icon-only control.

- [ ] **Step 1: Find them.** Run: `grep -rn "title=" src/components/workboard src/components/schedule/ClassOverridePopover.tsx | grep -v "aria-label"`, and ignore `ClassOverridePopover.tsx` since it is shared and not ours to change. For each hit on an **icon-only** control (a button or span whose only content is an icon), add a matching `aria-label` and make the visible text discoverable another way: a visible label next to the icon where space allows, otherwise keep `title` as a supplement. Hits on controls that already show text need no change. Text-truncation `title`s, which reveal full text on hover, may stay.

- [ ] **Step 2: Verify.** Re-run the grep: every remaining `title=` is either on a control with visible text or `aria-label`, or is a truncation reveal. `npx tsc --noEmit` exits 0.

---

### Task 34: Phase 6 checkpoint

- [ ] Run tsc, the style gate on all Phase 6 files, and curl (`307`).
- [ ] Playwright screenshots at 390, 820 and 1440: the item dialog, the drawer, the type chooser, the Filters panel and the palette (empty and typing). The console must be clean.
- [ ] Show the user and wait for approval before Phase 7.

---

# Phase 7: Motion and QA (§3, §17)

### Task 35: Motion audit and fixes (improve-animations, then animate)

**Files:**
- Any Workboard file the audit flags.

- [ ] **Step 1:** Invoke the `improve-animations` skill on `src/components/workboard/**` and `src/app/workboard/workboard.css`, with the spec §4.3 motion rules as the brief. Save its findings to `docs/superpowers/plans/2026-10-06-workboard-revamp-motion-audit.md`.
- [ ] **Step 2:** Invoke the `animate` skill to implement each accepted finding. Reject any finding that conflicts with §4.3, such as animating keyboard actions or exceeding 300ms, and note the reason in the audit file.
- [ ] **Step 3: Verify.** `npx tsc --noEmit` exits 0, and the style gate is clean on every changed file. In Playwright with `reducedMotion: 'reduce'`, open the dialog, drawer and palette, drag a card, and switch weeks: nothing moves (opacity only).

---

### Task 36: Stress test (break-ui)

- [ ] **Step 1:** Invoke the `break-ui` skill against `/workboard`. Cases to cover:
  - 0, 1 and 200 items (for 200, seed through Focus quick add or ask the user; never insert into the DB directly without asking);
  - a 200-character title;
  - a title with no spaces;
  - 10 links;
  - a course code at its maximum length;
  - widths of 320, 390, 820, 1024 and 1440;
  - zoom at 200%;
  - a slow network (Playwright `browser_run_code_unsafe` throttling, or offline toggling, to see error toasts and quick-add Retry);
  - a failed PATCH (go offline, change a status: the error toast offers Retry).
- [ ] **Step 2:** Fix each defect found, re-running tsc and the style gate on the changed files. Record the cases and fixes in `docs/superpowers/plans/2026-10-06-workboard-revamp-qa.md`.

---

### Task 37: Emil review and impeccable audit

- [ ] **Step 1:** Invoke `emil-design-eng` to review the shipped interactions: completion, quick add, bulk bar, drag, day panel, palette and overlays. Apply the agreed fixes.
- [ ] **Step 2:** Invoke `impeccable` in audit mode for a final polish pass covering spacing rhythm, alignment, contrast (≥4.5:1 body text against the `#eae8f4` glass proxy) and touch targets (≥24px desktop, ≥40px phone). Apply the agreed fixes. Append both reviews' findings and outcomes to the QA file from Task 36.
- [ ] **Step 3: Verify.** `npx tsc --noEmit` exits 0, and the style gate is clean on every changed file.

---

### Task 38: Final verification

- [ ] `npx tsc --noEmit` exits 0.
- [ ] `node scripts/wb-style-gate.mjs $(git diff --name-only -- src/components/workboard src/app/workboard src/lib/workboard/ui) src/app/workboard/workboard.css` is clean. Include untracked new files by also listing `git ls-files --others --exclude-standard src/components/workboard src/app/workboard src/lib/workboard/ui scripts/wb-style-gate.mjs`.
- [ ] Curl `/workboard` returns `307`.
- [ ] Playwright screenshots of all four views, plus the palette, dialog and drawer, at 390, 820 and 1440. The console must be clean. Check reduced motion again.
- [ ] Run `git status` and list the files this plan created or modified, separate from the unrelated pre-existing changes. Report to the user. **Do not commit unless asked.**

