# Habit Tracker v12 — Cards, Chain & Modal — Design

**Status:** Approved for planning
**Date:** 2026-09-04
**Depends on:** Habit Tracker v10 (visual & motion round 2 — the chain's 4-state model, the card's `[⋯]` menu, the card-grid stagger), v11 (analytics area redesign, which just shipped clean this session, commits `8d8c376..4d9a503`) — both shipped and reviewed earlier this session.
**Origin:** the second of two sub-projects decomposed via `superpowers:brainstorming` from a large external design critique pasted after v10 shipped. v11 covered the analytics area (hero, daily rhythm, category consistency, page layout). This spec covers the remainder: the ritual card's information hierarchy, the chain/dots visualizations' use of the brand gradient, and the create/edit modal's structure.

## Grounding against the real shipped code

Before scoping this spec, `src/components/habits/HabitsDashboard.tsx` was re-checked (unchanged since v11 Task 1 landed — only a docs-only commit to `habittracker-log.md` has happened since). Two things worth noting up front:
- The card's category dot/label (`0.68rem`, `#888`), note (`0.83rem`, `#555`, 2-line clamp), and meta line (`0.74rem`, `#888`) are **already** appropriately quiet relative to the card's name (`1.02rem`/`800`). The critique's "four-layer hierarchy" ask is narrower than it first reads: the actual gap is that the *current-state* line (the fixed-schedule status text, or the flexible-schedule remaining/pace text) sits at the SAME `0.74rem` weight as the meta line around it, when it should be the card's second-most-prominent element after the name.
- The only genuinely `on`/`off` scope decision left was how far to pare back the brand gradient (point 7); the user chose to reserve it for `RhythmRing` alone.

## Problem

1. The card's current-state line — the single fact a user glances at a card to learn ("is this done yet? am I behind?") — has no more visual weight than the category label or schedule description around it.
2. The brand gradient (`linear-gradient(135deg,#f2a7c0,#74bcd9)` / `linear-gradient(90deg,#f2a7c0,#74bcd9)`) fills every completed chain node, every chain connector line, every `WeekDots` completed dot, `AmountInput`'s "target met" fill, and the history chart's full weeks — diluting it as a signal, per the critique's "using it less makes it more valuable when it appears."
3. The create/edit modal is one flat vertical form with terse implementation-language labels ("Schedule," "Tracking") instead of framing the two most consequential decisions as questions a user is actually answering.
4. The Fixed/Flexible and Check-in/Amount choices are two-word pill buttons with no explanation, despite being, in the critique's words, "one of the most important decisions when creating a ritual."

## Goals

- The card's current-state line becomes visually second only to the ritual's name — larger, bolder, and (when actionable) icon-led with a two-part headline/detail structure matching the hero's existing "Needs attention" pattern.
- The brand gradient survives only on `RhythmRing`. Every other place it currently appears (chain completed-node, chain connector line, `WeekDots` completed dot, `AmountInput`'s met-fill, the history chart's full weeks) becomes a flat `#74bcd9`.
- The modal groups the schedule and tracking decisions under a small section eyebrow label plus a human-framed question, with a divider separating each section.
- Fixed/Flexible and Check-in/Amount toggle from two-word pills to a 2-column grid of description-cards (title + one-line explanation, selected state highlighted).

## Non-goals

- No change to the category dot/label, note, or meta line's existing (already-appropriately-quiet) styling — those are correctly weighted already and are not part of this pass.
- No change to the chain's 4-state model, its unscheduled-dot sizing, its pulse animation, or its halo logic — all v10 work, untouched here. Only the *color* of the completed state and its connector line changes (gradient → flat).
- No change to the card-color wash (`backgroundImage: linear-gradient(180deg, ${categoryColor}1f 0%, ...)`) — that's a single-hue category-identity effect, not the two-tone brand gradient this spec addresses, and stays exactly as-is.
- No change to any data, API, or schema — confined entirely to `src/components/habits/HabitsDashboard.tsx`.
- No new dependency.

## Design

### 6. Card current-state line — second in weight only to the name

**Fixed-schedule status line** — replace the flat status text with a bolder, icon-led two-part line:

```tsx
{!isFlexible && (
  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: habit.checked_in_today ? '#42c38b' : habit.is_today ? '#c0392b' : '#999' }}>
    {habit.checked_in_today
      ? '✓ Done today'
      : habit.is_today
        ? <>⚠ Scheduled today <span style={{ fontWeight: 500, color: '#777' }}>— not yet done</span></>
        : 'Not scheduled today'}
  </div>
)}
```
(Was: `fontSize: '0.74rem'`, plain text, color `#b8532c` for the pending case — the color moves to `#c0392b` to match the same red used by the hero's "Needs attention" warning elsewhere on the page, keeping the "this needs your attention" signal consistent page-wide.)

**Flexible-schedule remaining/pace line** — same weight bump, same treatment for the "behind pace" case. The original code only colors/shows the pace verdict when the weekly target isn't already met (`habit.week_progress!.completed < habit.week_progress!.target`) — that gate is preserved exactly, computed once so it isn't repeated three times with room to drift:

```tsx
{isFlexible && (() => {
  const notYetMet = habit.week_progress!.completed < habit.week_progress!.target;
  const isBehind = notYetMet && habit.pace === 'behind';
  const isAhead = notYetMet && habit.pace === 'ahead';
  return (
    <div style={{ fontSize: '0.88rem', fontWeight: 700, color: isBehind ? '#c0392b' : isAhead ? '#42c38b' : '#555' }}>
      {isBehind && '⚠ '}
      {Math.max(0, habit.week_progress!.target - habit.week_progress!.completed)} remaining{' '}
      <span style={{ fontWeight: 500, color: '#777' }}>
        · {habit.week_days_remaining} day{habit.week_days_remaining === 1 ? '' : 's'} left this week
        {isBehind && ' — behind pace'}
        {isAhead && ' — ahead of pace'}
      </span>
    </div>
  );
})()}
```
(Was: `fontSize: '0.74rem'`, color `#666`, with the pace verdict as a separately-colored trailing `<span>` at full boldness; this keeps the same underlying `pace`/`week_progress`/`week_days_remaining` values and the same `notYetMet` gate — a data pass-through, not a logic change — just consolidates the pace verdict into the lighter trailing clause so the leading number stays the visual anchor. A first draft of this section computed the color from `habit.pace` alone, without the `notYetMet` gate — that would have colored the line red/green even after a habit's weekly target was already met, which the original code never does; the gate above is the fix.)

The streak line (fixed-schedule only, `Flame` icon + "N-day streak") is untouched — it's correctly quiet already at `0.78rem` and is genuinely supporting context, not the primary state fact.

### 7. Gradient restraint — reserved for `RhythmRing`

Four flattenings, each a one-line value change with no logic change:

- `ChainRow`'s completed-node fill: `background: 'linear-gradient(135deg,#f2a7c0,#74bcd9)'` → `background: '#74bcd9'`
- `ChainRow`'s linked-connector line: `background: linked ? 'linear-gradient(90deg,#f2a7c0,#74bcd9)' : 'rgba(0,0,0,0.1)'` → `background: linked ? '#74bcd9' : 'rgba(0,0,0,0.1)'`
- `WeekDots`' completed dot: `background: 'linear-gradient(135deg,#f2a7c0,#74bcd9)'` → `background: '#74bcd9'`
- `AmountInput`'s "met" fill: `.ht-amount-wrap.met .ht-amount-fill { background: linear-gradient(90deg,#f2a7c0,#74bcd9); }` → `.ht-amount-wrap.met .ht-amount-fill { background: #74bcd9; }`
- `HistoryChart`'s ≥100% week bar: `background: w.percent >= 100 ? 'linear-gradient(180deg,#f2a7c0,#74bcd9)' : 'rgba(116,188,217,0.4)'` → `background: w.percent >= 100 ? '#74bcd9' : 'rgba(116,188,217,0.4)'`

`RhythmRing`'s own gradient (`#ht-ring-gradient`, used by its SVG stroke) is untouched — it remains the one place the brand gradient appears, exactly per the user's chosen scope.

### 10. Modal sections — human-framed questions

Replace the plain `<label className="ht-label">Schedule</label>` and `<label className="ht-label">Tracking</label>` with a section-header block each, and a divider above each section:

```tsx
<div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
  <div style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#999', marginBottom: 4 }}>Schedule</div>
  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#444', marginBottom: 10 }}>When should this happen?</div>
  {/* existing Fixed/Flexible choice + day-buttons/times-per-week, unchanged in logic */}
</div>

<div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
  <div style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#999', marginBottom: 4 }}>Tracking</div>
  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#444', marginBottom: 10 }}>How will you measure it?</div>
  {/* existing Check-in/Amount choice + numeric fields, unchanged in logic */}
</div>
```
The `Name`/`Note (optional)`/`Priority`+`Category` fields above these two sections keep their existing `ht-label` treatment — this spec only touches the two sections whose content is itself a structural decision (schedule mode, tracking type), not every field in the form.

### 11. Description-card toggles

Both toggle pairs move from `.ht-toggle-btn` pills to a 2-column grid of `.ht-choice-card` buttons:

```tsx
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
  <button type="button" className={`ht-choice-card${form.schedule_mode === 'fixed' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, schedule_mode: 'fixed' }))}>
    <div className="ht-choice-card-title">Fixed days</div>
    <div className="ht-choice-card-desc">Specific weekdays every week</div>
  </button>
  <button type="button" className={`ht-choice-card${form.schedule_mode === 'flexible' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, schedule_mode: 'flexible' }))}>
    <div className="ht-choice-card-title">Flexible</div>
    <div className="ht-choice-card-desc">Any days, as long as you hit your target</div>
  </button>
</div>
```

```tsx
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
  <button type="button" className={`ht-choice-card${form.tracking_type === 'boolean' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, tracking_type: 'boolean' }))}>
    <div className="ht-choice-card-title">Check-in</div>
    <div className="ht-choice-card-desc">Simply mark it done</div>
  </button>
  <button type="button" className={`ht-choice-card${form.tracking_type === 'numeric' ? ' active' : ''}`} onClick={() => setForm(f => ({ ...f, tracking_type: 'numeric' }))}>
    <div className="ht-choice-card-title">Amount</div>
    <div className="ht-choice-card-desc">Track minutes, pages, glasses, etc.</div>
  </button>
</div>
```

New CSS:
```css
.ht-choice-card {
  text-align: left; padding: 12px 14px; border-radius: 12px; border: 1.5px solid #ddd;
  background: #f9f9fb; cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease;
}
.ht-choice-card.active { border-color: #74bcd9; background: rgba(116,188,217,0.08); }
.ht-choice-card-title { font-size: 0.85rem; font-weight: 800; color: #332b45; margin-bottom: 3px; }
.ht-choice-card-desc { font-size: 0.72rem; color: #777; line-height: 1.3; }
```

`.ht-toggle-btn` becomes dead code once both its call sites move to `.ht-choice-card` (it has no other callers in the file — `.ht-day-btn`, used by the day-of-week picker, is a separate class and is untouched) — remove the `.ht-toggle-btn` CSS rule as part of this change rather than leaving it orphaned. `ACTIVE_TOGGLE_STYLE` stays: it's still used by the day-of-week buttons' active state, which this spec doesn't touch.

## Migration & compatibility

Purely presentational — no data, API, or schema change, no new dependency. `.ht-toggle-btn` is removed as dead code (its only two call sites both move to the new `.ht-choice-card` in this same change, so nothing is left referencing it). Every other CSS class in the file is either untouched or, in the case of the four flattened gradients, has only its color *value* changed, not its selector or any other property.

## Testing / verification plan

Same standing approach as v1–v11 (no test framework in this repo; no browser-automation tool in this environment): `tsc --noEmit`, then careful reading of the JSX/CSS, plus real API calls where they add genuine confidence.

- Confirm the fixed-schedule status line and the flexible-schedule remaining/pace line both read `fontSize: '0.88rem', fontWeight: 700` and that their underlying conditions (`habit.checked_in_today`, `habit.is_today`, `habit.pace`, `habit.week_progress`, `habit.week_days_remaining`) are byte-for-byte the same expressions as before this change — only the JSX structure and styling around them changed.
- Confirm the streak line (`Flame` icon + "N-day streak") is completely untouched — no font-size, color, or JSX change.
- Confirm all five gradient call sites listed under §7 now use `'#74bcd9'` (or the `.ht-amount-wrap.met .ht-amount-fill` CSS equivalent) and that `RhythmRing`'s `#ht-ring-gradient` `<linearGradient>` definition and its one consuming `<circle>` are both untouched.
- Confirm no other `linear-gradient(...#f2a7c0...#74bcd9...)` string remains anywhere in the file outside `RhythmRing`'s SVG gradient definition — grep for `f2a7c0` and account for every remaining hit.
- Confirm the modal's "Schedule" and "Tracking" section headers both render the eyebrow label + human question + divider exactly as specified, and that the `Name`/`Note (optional)`/`Priority`/`Category` fields above them are unchanged.
- Confirm `.ht-choice-card`/`.ht-choice-card.active`/`.ht-choice-card-title`/`.ht-choice-card-desc` are each defined exactly once, and that both toggle pairs (`schedule_mode`, `tracking_type`) render as `.ht-choice-card` grids with correct `active` gating on `form.schedule_mode`/`form.tracking_type` respectively — the `onClick` handlers must set the exact same state fields (`schedule_mode`, `tracking_type`) the old pills set, with no behavior change to `submitForm`'s validation logic.
- Confirm `.ht-toggle-btn` no longer appears anywhere in the file (CSS or JSX) and that `.ht-day-btn`/`ACTIVE_TOGGLE_STYLE` (both still used by the day-of-week picker) are untouched.
- Real API/DB check: this pass changes no computation, only presentation and one CSS-class removal — confirm via reading `src/lib/habits.ts` and the modal's `submitForm` body that `schedule_mode`/`tracking_type`/`priority`/`task_category` etc. are still read and posted with the same field names this redesign's form continues to use (per the standing ruling established in v10/v11: since this task touches no backend code, this static read is an acceptable substitute for a live call).
