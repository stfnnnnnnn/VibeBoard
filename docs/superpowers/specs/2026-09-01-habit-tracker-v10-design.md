# Habit Tracker v10 — Visual & Motion Round 2 — Design

**Status:** Approved for planning
**Date:** 2026-09-01
**Depends on:** Habit Tracker v6 (visual revamp), v8 (Pause lifecycle, which deliberately left the `[⋯]` menu's visual treatment minimal/functional pending this pass), v9 (pace-wording fix) — all shipped and reviewed earlier this session.
**Origin:** user request, fourth and final sub-project decomposed from a larger follow-up ask (data-model cleanup [v7] → Pause lifecycle [v8] → pace-wording fix [v9] → **visual & motion round 2** [this spec]). The user's own words: "i also need major visual improvements for the interface. more motion and interactivity, better design looks especially for the heroes and the interactive views (the button appearance in the day)... the way that the days look in the card is a bit awkward... also look for design enhancements from top to bottom." A creative-direction plan was presented in chat and approved before this spec was written.

## Problem

v6 established this module's visual identity (DM Sans/Inter typography, ink/ember color, the "Ritual Chain" signature, a two-column hero) but the user is asking for a second, stronger pass, not incremental polish. Three concrete gaps, in the user's own words:
1. The hero panel doesn't feel like the page's actual centerpiece — a number and a flat bar, no different in shape from every other progress indicator on the page.
2. The per-card chain ("the way the days look... is a bit awkward") — functional but visually busy: every day, scheduled or not, renders as a full-size ring with borders/shadows, and the one node most needing attention (today, not yet done) has no more visual weight than a plain dashed circle.
3. Interactive elements give little feedback: the daily-rhythm glyph cells have no hover state at all (nothing signals they're clickable until you click one), the card's Done button snaps color instantly rather than transitioning, and the `[⋯]` menu (shipped in v8 with explicitly minimal styling, deferred to this exact pass) is a plain white box with no entrance motion or icons.

## Goals

- The hero's headline percentage becomes a radial progress ring (SVG) — the one circular meter on the page, so its shape alone signals "this is the number that matters most," distinct from every flat bar elsewhere (category consistency, amount input). The number counts up from 0 on mount/update instead of snapping to its value.
- The chain's visual grammar is simplified and re-weighted: unscheduled days shrink to a small quiet dot instead of a full-size hollow ring (so scheduled activity reads more clearly against a quieter background), the "today, not yet done" node gets a soft pulsing glow instead of a static dashed border, and the fill-in transition gets a more noticeable pop.
- The daily-rhythm glyph cells gain a hover state, discoverable before the first click.
- The card's Done button transitions its color on state change instead of snapping.
- The `[⋯]` menu gets its real visual treatment: an icon per item, a fade+scale entrance instead of popping in instantly.
- The ritual-card grid fades/slides in with a slight stagger on load — one genuine "arrival" moment for the page, not scattered ambient effects.
- Every new animation respects `prefers-reduced-motion`, extending the file's existing reduced-motion media query rather than introducing a second one.

## Non-goals

- No change to the hero's two-column layout, the on-pace/needs-attention sentence logic (v9), the Pause lifecycle's behavior, or any data/API/schema — this is a pure presentation-and-motion pass confined to `src/components/habits/HabitsDashboard.tsx`.
- No new dependency — the radial ring is built with plain SVG, the count-up with a `requestAnimationFrame` loop already achievable in vanilla React, no animation library.
- No change to the day-click drill-down's behavior, the chain's 7-day trailing window, or the three-state (unscheduled/missed/done) semantics of any element — only their visual weight and motion, not their meaning.

## Design

### 1. Hero — radial progress ring with count-up

A new local component, `RhythmRing`, replaces the flat percentage `<div>` (the bar underneath it stays — the ring is the new focal element, the bar remains a secondary, page-scanning-friendly indicator, matching the pattern already established of "a bar is the ambient/secondary meter, this page's ONE circular meter is reserved for the single most important number"):

```tsx
function RhythmRing({ percent, size = 96, strokeWidth = 8 }: { percent: number | null; size?: number; strokeWidth?: number }) {
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    if (percent === null) { setAnimated(0); return; }
    const prefersReduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) { setAnimated(percent); return; }
    let raf: number;
    let start: number | null = null;
    const duration = 800;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimated(Math.round(percent * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [percent]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animated / 100) * circumference;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={strokeWidth} />
        {percent !== null && (
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none"
            stroke="url(#ht-ring-gradient)" strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
          />
        )}
        <defs>
          <linearGradient id="ht-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f2a7c0" />
            <stop offset="100%" stopColor="#74bcd9" />
          </linearGradient>
        </defs>
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        ...HEADING_FONT, fontSize: '1.5rem', fontWeight: 800, color: '#74bcd9',
      }}>
        {percent === null ? '—' : `${animated}%`}
      </div>
    </div>
  );
}
```
The RAF-driven count-up is skipped entirely under `prefers-reduced-motion: reduce` (jumps straight to the final value) — this check happens in JS, not CSS, since a `requestAnimationFrame` loop isn't something a stylesheet media query can gate.

In the hero's left column, replace:
```tsx
<div style={{ ...HEADING_FONT, fontSize: '2.4rem', fontWeight: 800, color: '#74bcd9', lineHeight: 1.1, marginBottom: 10 }}>
  {summary.weekly_expected.expected > 0
    ? Math.min(100, Math.round((summary.weekly_expected.actual / summary.weekly_expected.expected) * 100))
    : '—'}
  {summary.weekly_expected.expected > 0 ? '%' : ''}
</div>
```
with a flex row placing the ring beside the progress bar (which moves into this same row) instead of the number sitting stacked above a full-width bar. The "This Week's Rhythm" `<h2>` above this block and the "This week: X/Y expected occurrences" `<p>` caption below it are both unchanged in content and position — only the percentage-and-bar block's internal layout changes:
```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 10 }}>
  <RhythmRing percent={summary.weekly_expected.expected > 0 ? Math.min(100, Math.round((summary.weekly_expected.actual / summary.weekly_expected.expected) * 100)) : null} />
  <div style={{ flex: 1, minWidth: 0 }}>
    <div style={{ height: 10, borderRadius: 6, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
      <div className="ht-progress-fill" style={{
        width: `${summary.weekly_expected.expected > 0 ? Math.min(100, Math.round((summary.weekly_expected.actual / summary.weekly_expected.expected) * 100)) : 0}%`,
        height: '100%', borderRadius: 6, background: 'linear-gradient(90deg,#f2a7c0,#74bcd9)',
      }} />
    </div>
  </div>
</div>
```

### 2. Chain — quieter unscheduled state, a pulsing "today" node, a bigger pop

Restructure each day's node into a fixed-size hit-area wrapper containing a state-sized visual circle (this is what lets the unscheduled state shrink without disturbing the connector-line layout, which depends on every day occupying the same-width flex cell):

```tsx
<div
  title={`${day.weekday} ${day.date}${!day.scheduled ? ' — not scheduled' : day.completed ? ' — done' : isToday ? ' — not done yet' : ' — missed'}`}
  style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
>
  <div
    className={`ht-chain-node${isToday && day.scheduled && !day.completed ? ' ht-chain-node-pulse' : ''}`}
    style={{
      borderRadius: '50%',
      transform: (day.scheduled && day.completed) ? 'scale(1.1)' : 'scale(1)',
      ...(!day.scheduled
        ? { width: 5, height: 5, background: 'rgba(0,0,0,0.25)' }
        : day.completed
          ? { width: 18, height: 18, background: 'linear-gradient(135deg,#f2a7c0,#74bcd9)' }
          : isToday
            ? { width: 18, height: 18, border: '2px dashed #74bcd9', background: 'rgba(255,255,255,0.6)' }
            : { width: 18, height: 18, border: '2px solid rgba(247,91,103,0.55)', background: 'transparent' }),
      boxShadow: isToday && day.scheduled
        ? '0 0 0 2px #fff, 0 0 0 4px rgba(116,188,217,0.55)'
        : day.scheduled && day.completed
          ? '0 0 0 2px rgba(255,255,255,0.6)'
          : 'none',
    }}
  />
</div>
```
Two deliberate changes beyond a straight visual re-skin, both narrow and justified:
- **Node size 15px → 18px** (and the weekday-letter label below each node widens from `width: 15` to `width: 18` to match) — better legibility and click-target size for the now-more-detailed state grammar.
- **The "today" halo now requires `day.scheduled`** (`isToday && day.scheduled ? HALO : ...`), whereas the pre-existing code applied the halo whenever `isToday` regardless of schedule. This matters now specifically because the unscheduled visual shrank to a 5px dot — the halo unconditionally applying would put a large blue ring around a tiny dot on the rare day a habit's "today" isn't actually one of its scheduled weekdays, which reads as a mismatch it didn't when the unscheduled state was a full-size ring. This edge case was reviewed and explicitly accepted as harmless in v6 under the OLD (full-size-ring) unscheduled visual; this spec closes it now because the new small-dot visual makes the mismatch visually louder, not because the old behavior was wrong for what it was.

New CSS for the pulse (a `box-shadow`-only animation, deliberately not touching `transform`, so it never fights the discrete completed-state pop-scale which is a plain inline `transform` value, not a keyframe animation):
```css
@keyframes ht-pulse {
  0%, 100% { box-shadow: 0 0 0 2px #fff, 0 0 0 4px rgba(116,188,217,0.55); }
  50% { box-shadow: 0 0 0 2px #fff, 0 0 0 7px rgba(116,188,217,0.25); }
}
.ht-chain-node-pulse { animation: ht-pulse 1.8s ease-in-out infinite; }
```
The keyframe's `0%`/`100%` state is identical to the existing static halo value, so disabling the animation under reduced motion (`.ht-chain-node-pulse { animation: none !important; }`, added to the existing reduced-motion block) correctly falls back to that same static halo with no visual regression — not a blank/broken state.

### 3. Daily-rhythm glyph cells — a hover state

Inline styles block CSS `:hover` for the same property (the browser always resolves an inline-styled property over any stylesheet rule for that property, hover or not) — the day cell's `background`/`boxShadow` must move from inline styles to a CSS class before `:hover` can have any visible effect:

```tsx
<div
  key={d.date}
  onClick={() => setSelectedDay(prev => prev === d.date ? null : d.date)}
  title={`${d.weekday} ${d.date}: ${d.scheduled > 0 ? `${d.percent}% fulfilled` : 'nothing scheduled'}`}
  className={`ht-day-cell${isSelected ? ' selected' : ''}`}
  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', padding: '4px 0' }}
>
```
New CSS:
```css
.ht-day-cell {
  border-radius: 10px;
  transition: background 0.15s ease;
}
.ht-day-cell:hover { background: rgba(116,188,217,0.08); }
.ht-day-cell.selected { background: rgba(116,188,217,0.14); box-shadow: inset 0 0 0 1.5px rgba(116,188,217,0.55); }
```
(The `borderRadius`/`background`/`boxShadow` keys are removed from the cell's inline `style` object — everything else in that object, `flex`/`display`/`flexDirection`/`alignItems`/`gap`/`cursor`/`padding`, is unchanged.)

### 4. Card Done button — a transitioning color swap

`.ht-btn`'s existing `transition` declaration gains `background-color`:
```css
.ht-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 7px 8px; border: none; border-radius: 10px; cursor: pointer;
  font-size: 0.78rem; font-weight: 700;
  transition: transform 0.12s ease, filter 0.15s ease, background-color 0.3s ease;
}
```
`.ht-btn` is already in the existing reduced-motion block's disable list, so no further change is needed there.

### 5. `[⋯]` menu — icons and a real entrance

Re-import `Pencil` and `Trash2` (removed in v8 specifically because the menu was text-only at the time) and add `Pause`/`Play`:
```ts
import {
  Home, Plus, Minus, Check, Undo2, Flame, Trophy,
  AlertTriangle, X, RotateCcw, Loader2, Sparkles, MoreHorizontal, Pencil, Trash2, Pause, Play,
} from 'lucide-react';
```
Menu items gain an icon each, the Pause/Resume icon toggling with its label:
```tsx
<div className="ht-card-menu">
  <button type="button" onClick={() => { setMenuOpen(false); onEdit(); }}><Pencil size={14} /> Edit</button>
  <button type="button" onClick={() => { setMenuOpen(false); onPauseToggle(); }}>{isPaused ? <Play size={14} /> : <Pause size={14} />} {isPaused ? 'Resume' : 'Pause'}</button>
  <button type="button" onClick={() => { setMenuOpen(false); onDelete(); }}><Trash2 size={14} /> Delete</button>
</div>
```
CSS: the button rule gains flex layout for the icon+label pairing, and the menu itself gains an entrance animation:
```css
.ht-card-menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 20;
  background: #fff; border-radius: 10px; box-shadow: 0 6px 18px rgba(0,0,0,0.15);
  display: flex; flex-direction: column; min-width: 110px; overflow: hidden;
  animation: ht-menu-in 0.15s ease-out;
  transform-origin: top right;
}
.ht-card-menu button {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; text-align: left; border: none; background: none; cursor: pointer;
  font-size: 0.8rem; font-weight: 600; color: #444;
}
.ht-card-menu button:hover { background: rgba(0,0,0,0.05); }

@keyframes ht-menu-in {
  from { opacity: 0; transform: scale(0.92) translateY(-4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
```
Add `.ht-card-menu { animation: none !important; }` to the existing reduced-motion block.

### 6. Ritual-card grid — a staggered entrance

The parent's render call gains an `index`, passed through to `HabitCard` as a new prop used only to compute a capped stagger delay:
```tsx
{filtered.map((h, index) => (
  <HabitCard
    key={h.habit_id}
    habit={h}
    index={index}
    ...
  />
))}
```
`HabitCard`'s outer `<div>` gains the entrance class and an inline `animationDelay`:
```tsx
<div
  className="ht-card ht-card-enter"
  style={{
    borderTop: `4px solid ${categoryColor}`,
    backgroundImage: `linear-gradient(180deg, ${categoryColor}1f 0%, rgba(255,255,255,0) 160px)`,
    position: 'relative',
    zIndex: menuOpen ? 30 : 'auto',
    animationDelay: `${Math.min(index, 10) * 40}ms`,
  }}
  onClick={onOpenDetail}
>
```
New CSS:
```css
@keyframes ht-card-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.ht-card-enter { animation: ht-card-in 0.4s ease-out backwards; }
```
(`backwards` fill-mode holds the `from` state during the `animation-delay`, avoiding a flash of full opacity before the delay elapses.) Add `.ht-card-enter { animation: none !important; }` to the existing reduced-motion block. Because every `HabitCard` is keyed by `habit_id` (a stable identity across re-renders), React does not remount an already-visible card on a data refresh (e.g. after a check-in) — the entrance animation only plays on a card's genuine first mount (initial page load, or when a filter change reveals a card that wasn't previously rendered), never replaying on every reload. This is deliberate: replaying an entrance animation on every check-in would read as visual noise, not a genuine arrival moment.

## Migration & compatibility

Purely presentational and motion-only. No data, API, schema, or component-interface change beyond one new internal prop (`HabitCard`'s `index`, not exposed outside this file) and one new local component (`RhythmRing`, not exported). Every new animation is additive to the file's single existing `@media (prefers-reduced-motion: reduce)` block — no second media query is introduced.

## Testing / verification plan

Same standing approach as v1–v9 (no test framework in this repo; no browser-automation tool in this environment): `tsc --noEmit`, then careful reading of the JSX/CSS, plus real API calls where they add genuine confidence —
- Confirm `RhythmRing` renders `'—'` (not a ring arc) when `percent` is `null`, matching the pre-existing zero-denominator fallback text exactly.
- Confirm the count-up effect is skipped (jumps straight to the final value) when `window.matchMedia('(prefers-reduced-motion: reduce)').matches` is true — verify this by reading the effect's guard clause, since it can't be visually observed in this environment.
- Confirm the chain's unscheduled-day dot (5px) and the "today" halo's new `&& day.scheduled` guard don't regress any of the chain's other states — re-derive all four states (unscheduled/missed/today-pending/done) against the exact same conditions the pre-existing code used, changing only the visual values, not the branching logic.
- Confirm the day-letter label's width (`18`) matches the node wrapper's width (`18`) so labels stay aligned under their nodes, exactly as the pre-existing 15/15 pairing did.
- Confirm the glyph-strip's `:hover` rule is visually reachable — i.e., confirm no inline style on the day-cell div still sets `background`/`boxShadow` (which would silently block the CSS rule from ever applying, hover or not).
- Confirm exactly one `@media (prefers-reduced-motion: reduce)` block exists in the final file (extended, not duplicated), and that its selector list includes every new animated class introduced by this spec (`.ht-chain-node-pulse`, `.ht-card-menu`, `.ht-card-enter`) alongside the pre-existing ones.
- Confirm `HabitCard`'s new `index` prop is threaded correctly from the single `.map()` call site and doesn't leak into any DOM attribute (it's consumed only for the `animationDelay` style value).
- Real API/DB check: load the dashboard's data via `GET /api/habits` and `GET /api/habits/summary` with a locally-signed session token to confirm the hero's percentage value and the chain's per-day `scheduled`/`completed` values used by this pass's new rendering are exactly the same values already verified correct in prior passes — this pass changes no computation, only presentation, so no new backend verification is needed beyond confirming the shapes consumed haven't drifted.
