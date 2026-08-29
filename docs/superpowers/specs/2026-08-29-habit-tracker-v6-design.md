# Habit Tracker v6 — Visual Revamp: The Ritual Chain — Design

**Status:** Approved for planning
**Date:** 2026-08-29
**Depends on:** Habit Tracker v5 (`docs/superpowers/specs/2026-08-29-habit-tracker-v5-design.md`), shipped and reviewed the same day.
**Origin:** the user's own request — "revamp the visuals and more visual things and also make the layout a little bit better... add more flow or motion or interactivity" — explicitly invoking this project's installed `.agents/skills/design-guidelines` orchestrator and its `frontend-design` skill. A creative-direction plan (color/type/layout/signature) was presented in chat and approved verbatim before this spec was written; this document formalizes that plan into exact, implementable changes.

## Problem

The Habit Tracker dashboard (`src/components/habits/HabitsDashboard.tsx`) is functionally mature after five iterations (v2–v5: flexible scheduling, numeric tracking, priority, minimum targets, a 12-week history view, and a Rhythm-first page hierarchy) but visually under-designed relative to that functional depth: every card and panel uses the same flat gray text hierarchy, colors were added ad hoc across five passes rather than as a considered system (three different warm/amber tones exist for three related "needs attention" style signals), the hero panel is a single narrow column that doesn't use its own width, and no interaction in the whole page has any motion beyond a card hover-lift and a few already-existing CSS transitions — check-ins, progress bars, and the day-drill-down all appear or update with an instant, un-animated snap.

## Design constraints (from scanning the existing app before proposing anything)

`src/app/globals.css` defines `vb-bg` (an animated pastel gradient background), `.glass`/`.glass-strong` (frosted-blur cards), and `.gradient-text` (`#f2a7c0` → `#74bcd9`) as **shared, app-wide identity primitives** — used by the main dashboard, Finance Tracker, and Study Pulse, not just Habit Tracker. `src/app/layout.tsx` already loads both Inter and DM Sans via `next/font/google`, and sibling pages (Finance Tracker, Study Pulse's `GwaCalculator`/`ScheduleMaker`/`SubjectsGrid`) already establish a convention of DM Sans for headings (`letterSpacing: '-0.01em'`) with Inter for body copy — a convention Habit Tracker has never actually adopted (it currently applies one combined font-family fallback string uniformly to the whole page).

Per the design-guidelines orchestrator's stated priority order (**product requirements > accessibility/usability > existing architecture > aesthetic preference**), this spec does **not** touch `globals.css` or introduce a new font dependency. It works entirely within `src/components/habits/HabitsDashboard.tsx` (JSX structure, inline styles, and its own local `<style jsx global>` block, which already defines page-scoped `.ht-*` classes used nowhere else) — evolving the shared system rather than replacing it, and adopting a convention that already exists elsewhere in this app rather than inventing a new one.

## Goals

1. **Signature: the ritual chain becomes a real focal element, not a background detail.** Its nodes get a deliberate fill transition and a subtle size differentiation between completed and pending days, so checking in a habit produces a visible, meaningful change instead of an instant swap.
2. **Typography gets real hierarchy.** Adopt the app's own existing DM Sans/Inter convention: DM Sans with tight tracking for every heading, the hero percentage, and each ritual's name; Inter (unchanged) for everything else.
3. **Color gets consolidated, not expanded.** Two targeted changes: a warmer ink tone for primary text (replacing flat `#333`), and one deliberate "ember" accent replacing two slightly-clashing ad hoc warm tones (`#e0679d` used for the streak flame, `#f79f24` used for the numeric minimum-zone) that accumulated across five separate passes. Every other color (category palette, green=done, red=missed/attention) is unchanged — those are load-bearing status semantics used consistently across the app.
4. **The hero panel uses its own width.** A two-column composition on wider viewports: a primary column (heading, percentage, bar, caption, on-pace/needs-attention counts) and a rail (the best-streak record, plus the on-pace/needs-attention example sentences) — separating "headline numbers" from "detail examples," rather than one long stacked column.
5. **Ritual cards read their category ambiently**, via a soft tinted wash across the card surface (very low opacity, fading to the card's normal glass tone), not just the existing thin top border.
6. **Motion is added in exactly three places, each tied to a real state change:** the chain bead's fill transition (goal 1), progress bars (hero, category-consistency) animating their width in rather than snapping, and the day-click drill-down panel animating open. All three respect `prefers-reduced-motion` via the existing media-query block in the file, extended to cover them (and, while extending it, closing a pre-existing gap where the numeric `AmountInput`'s fill-bar transition was never covered by that block either).

## Non-goals

- No changes to `src/app/globals.css`, `src/app/layout.tsx`, or any shared `vb-*`/`.glass`/`gradient-text` primitive — everything is scoped to `HabitsDashboard.tsx`.
- No new font/dependency — DM Sans is already loaded app-wide.
- No change to the green (`#42c38b`)/red (`#c0392b`, `#f75b67`) status-color vocabulary, the six-color category palette, or the priority-badge system — all are either shared app-wide semantics or were explicitly settled as out of scope in v5.
- No change to any data flow, API shape, or component prop/state signature — this is a pure presentation pass, same as v5's discipline.
- No change to the page's information architecture (hero above cards, "Today's Rituals" heading, day-click drill-down's fixed-only filtering) — v5 already settled that; this pass is about how it looks and feels, not what's on it or in what order.

## Design

### 1. Typography — adopt the existing DM Sans/Inter split

Add `fontFamily: "'DM Sans','Segoe UI',sans-serif", letterSpacing: '-0.01em'` to every heading-weight element:
- The page `<h1>` (`{firstName}'s Rituals`)
- "This Week's Rhythm" `<h2>`
- The hero's big percentage
- "Today's Rituals" `<h2>`
- "Daily rhythm — last 7 days" `<h3>`
- "Consistency by category — this week" `<h3>`
- Each `HabitCard`'s ritual-name line
- The add/edit modal's title (`"Edit Ritual"`/`"New Ritual"`) and `HabitDetailModal`'s ritual-name title

Body copy, meta lines, labels, and buttons are unchanged (they already inherit Inter from the root container's font stack, which stays as-is).

### 2. Color — ink and ember

Two hex substitutions, applied everywhere the old value currently appears in `HabitsDashboard.tsx`:
- `#333` (primary text — root container, "Today's Rituals" heading, `.ht-select` text, `.ht-amount-field` text, card ritual-name, `DetailStat` value) → **`#332b45`** (a warm near-black plum, harmonizing with the pink side of the brand gradient instead of reading as neutral corporate gray).
- `#e0679d` (the streak `Flame` icon's color) and `#f79f24` (the fixed-card "scheduled today, not yet done" status text color, and the numeric `AmountInput`'s minimum-zone fill/background) → **`#d9714a`** (one deliberate terracotta "ember" tone, plus its low-opacity tint `rgba(217,113,74,0.12)` wherever the old `rgba(247,159,36,0.12)` background tint was used). These three prior uses were never chosen as one system — they accumulated across three separate passes (v2's streak flame, v3's minimum-target zone, v4's fixed-card status line) and read as slightly mismatched warm hues sitting near each other on the same cards; consolidating them into one accent is a real fix, not decoration.

Explicitly **unchanged**: `#42c38b` (done/on-pace green), `#c0392b` and `#f75b67` (missed/danger/needs-attention red), all six `CATEGORY_COLORS` values, `#74bcd9`/`#f2a7c0` (the brand gradient), and every other secondary/tertiary gray (`#444`, `#555`, `#777`, `#888`, `#999`) — these carry meaning shared with the rest of the app or already form a correct, working hierarchy; touching them would dilute the one deliberate change (ink + ember) into an undirected palette pass.

### 3. Hero panel — two-column composition

Add a new class to the file's `<style jsx global>` block:
```css
.ht-hero-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}
@media (min-width: 720px) {
  .ht-hero-grid { grid-template-columns: 1.3fr 1fr; }
}
```
Restructure the hero `.glass` panel's contents into two children of a `.ht-hero-grid` wrapper:

**Left (primary) column** — everything currently in the hero except the streak trophy line and the on-pace/needs-attention sentences: the "This Week's Rhythm" heading, the big percentage, the progress bar, the "This week: X/Y" caption, and the counts row — but the counts row **drops its trophy/best-streak span** (moved to the right column below), keeping only the "✓ N on pace" / "⚠ N need attention" spans.

**Right (rail) column** — vertically centered, containing:
1. The "🏆 {longest_streak}-day best streak" line (moved here from the counts row) — always rendered, so the rail is never empty even when there's nothing else to show.
2. If `on_pace` or `needs_attention` is non-null: a thin top divider, then the on-pace sentence (if present) and the needs-attention sentence (if present) — same content and conditions as today, just relocated into this column instead of stacked beneath the counts row.

On viewports narrower than 720px the grid collapses to one column (rail content flows directly beneath the primary column, in source order) — no separate mobile-specific styling needed beyond the existing `grid-template-columns: 1fr` default.

### 4. Ritual cards — ambient category wash

Change each `HabitCard`'s outer `style` from only a top border to a top border plus a soft vertical wash:
```ts
style={{
  borderTop: `4px solid ${CATEGORY_COLORS[habit.task_category]}`,
  background: `linear-gradient(180deg, ${CATEGORY_COLORS[habit.task_category]}1f 0%, rgba(255,255,255,0.55) 160px)`,
}}
```
(`1f` is a hex alpha suffix, ≈12% opacity — every value in `CATEGORY_COLORS` is a 6-digit hex, so appending two hex digits is always valid. The gradient fades to the card's normal `rgba(255,255,255,0.55)` glass tone by 160px down, so only the upper portion of the card carries the tint — an ambient signal, not a colored card.) This inline `background` correctly overrides `.ht-card`'s class-level `background` declaration (inline styles take precedence over class rules for the same property in React), so no change to the shared `.ht-card` class itself is needed.

### 5. Motion — three deliberate moments

**a) Chain bead fill.** In `ChainRow`, add a `ht-chain-node` class to each day-node `<div>` (alongside its existing inline style, which stays fully data-driven — background/border/boxShadow per state are unchanged) and give completed, scheduled days a very slight scale-up:
```ts
style={{
  width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
  transform: (day.scheduled && day.completed) ? 'scale(1.05)' : 'scale(1)',
  ...(existing per-state background/border logic, unchanged),
  boxShadow: (existing logic, unchanged),
}}
className="ht-chain-node"
```
New CSS:
```css
.ht-chain-node {
  transition: background 0.35s ease, box-shadow 0.35s ease, border-color 0.35s ease, transform 0.3s ease;
}
```
Because the node's DOM identity is stable across re-renders (`key={day.date}` doesn't change when `day.completed` flips), React updates the existing element's style props in place, and the browser interpolates the transition automatically — no new component state, no animation library, no risk of a "flash of unstyled state."

**b) Progress bars animate in.** Add a `ht-progress-fill` class (alongside the existing inline `width`/`background`/`height`/`borderRadius`, unchanged) to the hero's progress-bar fill `<div>` and to each category-consistency row's fill `<div>`:
```css
.ht-progress-fill { transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
```
(The numeric `AmountInput`'s own `.ht-amount-fill` already has an equivalent transition from a prior pass — left as-is, not duplicated.)

**c) Drill-down panel animates open.** Add a `ht-fade-slide` class to the day-click drill-down's outer wrapper `<div>` (the one currently rendered only when `selectedDay` is truthy):
```css
@keyframes ht-fade-slide {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}
.ht-fade-slide { animation: ht-fade-slide 0.25s ease-out; }
```
Because this element only exists in the DOM while `selectedDay` is set (a fresh mount each time a day is newly selected), a CSS `animation` — which always runs on mount — is the correct tool here, unlike a `transition` (which only interpolates between two already-rendered states).

**Reduced motion.** Extend the file's existing `@media (prefers-reduced-motion: reduce)` block (currently covering `.ht-card`, `.ht-home-btn`, `.ht-btn`, `.ht-spin`) to also cover all of the above, plus the pre-existing `.ht-amount-fill` transition that this block never covered in any prior pass:
```css
@media (prefers-reduced-motion: reduce) {
  .ht-card, .ht-home-btn, .ht-btn, .ht-chain-node, .ht-progress-fill, .ht-amount-fill { transition: none !important; }
  .ht-fade-slide { animation: none !important; }
  .ht-spin { animation-duration: 1.6s; }
}
```

## Migration & compatibility

Purely presentational. No schema, API, prop, state, or type changes anywhere. Every change is either an inline-style value substitution, an added CSS class (with its rule scoped to this file's own `<style jsx global>` block, using class names — `ht-hero-grid`, `ht-chain-node`, `ht-progress-fill`, `ht-fade-slide` — that don't collide with any existing class in this file or, per a repo-wide check during planning, anywhere else in the codebase), or a JSX restructuring that relocates existing elements (the trophy line, the on-pace/needs-attention sentences) without changing their content or the conditions under which they render.

## Testing / verification plan

Same standing approach as v1–v5 (no test framework in this repo; no browser-automation tool in this environment): `tsc --noEmit` (should be trivially unaffected — no type changes anywhere in this pass), plus careful reading of the JSX/CSS to confirm:
- Every `#333`/`#e0679d`/`#f79f24` instance in the file was updated to its replacement, and no instance was missed or over-applied (e.g., `#c0392b`/`#f75b67`/`#42c38b`/`CATEGORY_COLORS` must remain untouched).
- The hero's two-column grid degrades cleanly to one column below 720px (source order still reads sensibly top-to-bottom: primary content, then the rail's streak line and — if present — the two example sentences).
- The right rail is never empty (the streak line always renders regardless of `on_pace`/`needs_attention`'s state).
- The card's category wash correctly overrides `.ht-card`'s class background per-card (confirm via reading, since inline-style precedence over class rules is a CSS fundamental, not something that needs a live render to verify) and that the top border is unchanged.
- The chain's `ht-chain-node` transition and scale differentiation apply per-day exactly as the existing (unchanged) background/border/boxShadow logic already does — i.e., only `completed && scheduled` days get the 1.05 scale, matching exactly the same condition already used for the existing single-ring boxShadow.
- The new `@keyframes`/`@media` additions don't collide with or duplicate the file's existing `@keyframes ht-spin` or `@media (prefers-reduced-motion: reduce)` block (there must be exactly one of each in the final file, with the reduced-motion block's selector list extended, not a second block added).
