# Habit Tracker v5 — Rhythm-First Hierarchy — Design

**Status:** Approved for planning
**Date:** 2026-08-29
**Depends on:** Habit Tracker v4 (`docs/superpowers/specs/2026-08-28-habit-tracker-v4-design.md`), shipped and reviewed the previous session day.
**Origin:** a fifth external-AI-auditor critique of the dashboard, centered on page hierarchy ("how am I doing → what do I need to do → what has happened"). Evaluated against the actual shipped v4 code and against explicit prior scope decisions from this same project before acting on it. Several of the critique's points (category-consistency counts, the "—" vs "0%" daily-chart distinction, the flexible card's remaining/pace text) are already shipped and describe a stale screenshot; one point (removing the "Normal" priority badge) directly conflicts with the v4 scope decision to leave priority display untouched and was confirmed OUT of scope by the user; two points (a capped on-pace/needs-attention list, a full-calendar-week chain with future days) were offered as real design choices and the user chose to keep the current, simpler v4 behavior for both; two points (a "Rest of this week" forecast panel, a Schedule-integration-dependent slot suggestion) are out of scope — the latter because Schedule integration was explicitly excluded from this project's scope back in v2 ("all except the schedule integration"), the former because the critique itself calls it optional. This spec covers only what's confirmed in scope.

## Problem

v4 made the Rhythm hero the strongest single analytics panel on the page, but it still renders *after* the full card grid — so a user's first screenful of information is individual ritual cards, not "how am I doing." The critique's flow argument holds up against the actual shipped layout: "how am I doing? → what do I need to do? → what has happened?" is a more useful reading order than "here are your rituals (with no framing) → oh, and here's how you're doing."

Three smaller, real gaps evaluated on their own merit:
1. The header's "X of Y today's rituals done" and the hero's "X of Y expected occurrences this week" use different implicit time windows with no label distinguishing them — not wrong, but easy to misread as contradictory (as the critique did).
2. The daily-rhythm strip's day-click interaction opens a panel below the strip but gives no visual feedback on the strip itself — the clicked glyph looks identical to every other glyph, which reads as accidental rather than intentional.
3. The chain's day-letter labels are very small (0.6rem), and a "today" node that's already completed is visually indistinguishable from any other completed day — losing the "where am I right now" signal the chain is supposed to carry once you've checked in for the day.

## Goals

- Reorder the page so the Rhythm hero (and its two accompanying analytics cards: daily rhythm, category consistency) renders above the toolbar and card grid, with a new "Today's Rituals · N scheduled" heading directly above the grid to re-establish it as its own labeled section rather than an undifferentiated continuation of the page.
- Disambiguate the header's daily figure from the hero's weekly figure with explicit "Today:" / "This week:" labels.
- Make the hero's headline percentage visually larger and give it its own line, so it reads as the panel's focal point rather than a corner statistic.
- Give the daily-rhythm strip's day-click interaction a persistent visual state on the clicked glyph, and enrich the drill-down panel with each habit's category and an inline "Check in" action when the selected day is today and the habit isn't yet checked in.
- Improve the chain's readability: larger day-letter labels, and a persistent ring on the "today" node regardless of completion state.
- Replace the card meta-line's "Habit ·" / "Routine ·" wording with "Fixed ·" / "Flexible ·", matching the schedule-mode language used everywhere else and the "Ritual" branding already used throughout the page. `habit_type` itself (the Habit/Routine distinction) is unchanged in the data model and the add/edit form — this is a display-string change only, on this one line.

## Non-goals (explicitly out of scope, confirmed with the user)

- No change to priority display — the "Normal" badge stays exactly as shipped in v3/v4. (User confirmed: keep current 3-tier badges.)
- No change to `on_pace`/`needs_attention` — stays a single best-example/worst-example pair, no capped list, no "View all N" expander, no backend change to `src/lib/habits.ts`. (User confirmed: keep single best/worst.)
- No change to the chain's time window — it remains a rolling trailing-7-days-ending-today view. No "future scheduled" visual state, no full Sun–Sat calendar-week semantics. (User confirmed: keep rolling 7-day window.)
- No "Rest of this week" forecast panel.
- No Schedule-integration-dependent suggestions (e.g. "open window Saturday at 4 PM") — Schedule integration remains out of scope per the v2 scope decision.
- No schema changes, no new API routes, no changes to `src/lib/habits.ts` — this is a presentation-layer-only pass confined to `src/components/habits/HabitsDashboard.tsx`.

## Design

### 1. Page hierarchy reorder

Current render order in the main component's return: header → toolbar/filter → habit grid → Analytics block (hero + daily rhythm + category consistency) → modals.

New order: header → Analytics block → toolbar/filter → "Today's Rituals" heading → habit grid → modals. The Analytics block's own internal structure (hero card → daily-rhythm card → category-consistency card) is unchanged, only its position in the page moves. The `{summary && summary.total_habits > 0 && (...)}` guard is preserved as-is.

The new "Today's Rituals" heading sits directly above the `ht-grid` div:
```tsx
<h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#333', margin: '0 0 14px' }}>
  Today&apos;s Rituals{filter === 'today' && !loading && !loadError ? ` · ${filtered.length} scheduled` : ''}
</h2>
```
The count is only appended for the "Today" view (`filter === 'today'`) — for "All rituals" or a category/priority/day filter, the heading reads just "Today's Rituals" without a count, since the grid below it isn't actually today's rituals in those views. This heading renders unconditionally (not gated on `loading`/`loadError`/empty state) so the section label is present even while loading or empty, matching how "This Week's Rhythm" always has its own heading regardless of card-grid state.

### 2. Today/This-week disambiguation

Header paragraph (currently `<strong>{today_completed} of {today_total}</strong> today's rituals done.`) becomes:
```tsx
<p style={{ margin: '8px 0 0', fontSize: '0.95rem', color: '#555' }}>
  {summary.today_total === 0
    ? 'Nothing scheduled today.'
    : <><strong>Today:</strong> {summary.today_completed}/{summary.today_total} done</>}
</p>
```
Hero caption (currently `{actual} of {Y} expected occurrences this week`) becomes:
```tsx
<p style={{ margin: '0 0 14px', fontSize: '0.88rem', color: '#555' }}>
  {summary.weekly_expected.expected > 0
    ? <><strong>This week:</strong> {summary.weekly_expected.actual}/{Math.max(summary.weekly_expected.actual, Math.round(summary.weekly_expected.expected))} expected occurrences</>
    : 'Nothing due yet this week'}
</p>
```
(The `Math.max(actual, round(expected))` denominator guard from v4's final-review fix is preserved unchanged — only the label and slash-format change.)

### 3. Hero emphasis

Current: title and percentage share one flex row (`justifyContent: 'space-between'`), percentage at `1.6rem`. New: percentage moves to its own line below the title, at `2.4rem`, with the title row no longer needing `justifyContent: 'space-between'`:
```tsx
<h2 className="gradient-text" style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 4px' }}>This Week&apos;s Rhythm</h2>
<div style={{ fontSize: '2.4rem', fontWeight: 800, color: '#74bcd9', lineHeight: 1.1, marginBottom: 10 }}>
  {summary.weekly_expected.expected > 0
    ? Math.min(100, Math.round((summary.weekly_expected.actual / summary.weekly_expected.expected) * 100))
    : '—'}
  {summary.weekly_expected.expected > 0 ? '%' : ''}
</div>
```
The progress bar and everything below it (on-pace/needs-attention counts, the on-pace/needs-attention sentences) is otherwise unchanged.

### 4. Day-click highlight + richer drill-down

The glyph-strip day cell gains a persistent selected state (background + ring) driven by `selectedDay === d.date`, not just `:hover`:
```tsx
<div
  key={d.date}
  onClick={() => setSelectedDay(prev => prev === d.date ? null : d.date)}
  title={...}
  style={{
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', padding: '4px 0',
    borderRadius: 10,
    background: selectedDay === d.date ? 'rgba(116,188,217,0.14)' : 'transparent',
    boxShadow: selectedDay === d.date ? 'inset 0 0 0 1.5px rgba(116,188,217,0.55)' : 'none',
  }}
>
```
The drill-down panel's per-habit row gains a category dot + label, and a same-day check-in action when the selected day is today and the habit isn't checked in yet. This needs to know "is `selectedDay` today" and needs access to `doCheckin`, both already in scope in the main component (the drill-down is rendered inline, not a separate component):
```tsx
{dayHabits.map(({ habit, day }) => (
  <div key={habit.habit_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
    <span style={{ color: day.completed ? '#42c38b' : '#c0392b' }}>{day.completed ? '✓' : '○'}</span>
    <span style={{ flex: 1 }}>{habit.task_name}</span>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: CATEGORY_COLORS[habit.task_category], display: 'inline-block' }} />
    <span style={{ fontSize: '0.72rem', color: '#888' }}>{CATEGORY_LABELS[habit.task_category]}</span>
    {selectedDay === todayStr && !day.completed && (
      <button
        type="button"
        onClick={() => doCheckin(habit.habit_id)}
        style={{ fontSize: '0.7rem', fontWeight: 700, padding: '3px 9px', borderRadius: 8, border: 'none', background: '#74bcd9', color: '#fff', cursor: 'pointer' }}
      >
        Check in
      </button>
    )}
  </div>
))}
```
`todayStr` needs to be computed once in the main component (it doesn't currently store "today" as a string anywhere client-side — `is_today`/`checked_in_today` are pre-computed per-habit server-side, but the drill-down needs to compare `selectedDay` against "today" directly). Simplest source: the last entry of `summary.weekly_rhythm` is always today's `WeeklyRhythmDay` (the array is the trailing 7 days ending today, oldest-first, matching `habit.chain`'s ordering) — so `const todayStr = summary.weekly_rhythm[summary.weekly_rhythm.length - 1]?.date;` computed inline where the drill-down is rendered. No new state, no new prop threading needed.

### 5. Chain readability

Day-letter label: `fontSize: '0.6rem'` → `'0.7rem'`, `color: '#999'` → `'#777'` (darker for contrast at the larger size).

"Today" halo independent of completion: currently the `isToday` branch only applies its own style (`dashed` ring) when `!day.completed` (it's inside the `day.completed ? {...} : isToday ? {...} : {...}` ternary, so a completed-today falls into the `completed` branch and never sees `isToday` at all). Fix: compute the halo as a separate `boxShadow` layered on top of whichever fill state applies, rather than as a mutually-exclusive branch:
```tsx
<div
  title={...}
  style={{
    width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
    ...(!day.scheduled
      ? { border: '1px solid rgba(0,0,0,0.15)', background: 'transparent', opacity: 0.5 }
      : day.completed
        ? { background: 'linear-gradient(135deg,#f2a7c0,#74bcd9)' }
        : isToday
          ? { border: '2px dashed #74bcd9', background: 'rgba(255,255,255,0.6)' }
          : { border: '2px solid rgba(247,91,103,0.55)', background: 'transparent' }),
    boxShadow: isToday
      ? '0 0 0 2px #fff, 0 0 0 4px rgba(116,188,217,0.55)'
      : day.scheduled && day.completed
        ? '0 0 0 2px rgba(255,255,255,0.6)'
        : 'none',
  }}
/>
```
(The prior unconditional `boxShadow: '0 0 0 2px rgba(255,255,255,0.6)'` on completed days is preserved for every completed day that ISN'T today, so non-today completed nodes look exactly as before; today's node — completed or not — now always gets the stronger two-ring halo instead.)

### 6. Card meta-line wording

Current: `{habit.habit_type === 'habit' ? 'Habit' : 'Routine'} · {schedule caption}`. New: `{isFlexible ? 'Flexible' : 'Fixed'} · {schedule caption}` — `isFlexible` is already a local computed value in `HabitCard`. `habit_type`/`habit.habit_type` remains fully intact in the data model, the API, and the add/edit form's "Type" selector; only this one display string changes.

## Testing / verification plan

Same approach as v1–v4 (no test framework in this repo; no browser-automation tool in this environment): `tsc --noEmit`, then reasoning-based verification of the JSX/CSS changes, plus real calls against the local dev DB via a locally-signed session token where a live check genuinely adds confidence beyond static reading —
- Confirm the page renders analytics before the toolbar/grid in source order (readable directly from the file, not just by convention).
- Confirm the "Today's Rituals" heading's count only appears when `filter === 'today'`, and the heading itself always renders regardless of loading/empty/error state.
- Confirm the Today/This-week labels use the exact existing values (`today_completed`/`today_total`, `weekly_expected.actual`/`.expected` with its `Math.max` guard preserved) — no new aggregation, just relabeled JSX.
- Confirm the day-click highlight only applies to the clicked day (toggling it off returns the cell to its unstyled state) and doesn't interfere with the existing click-to-toggle `selectedDay` logic.
- Confirm the drill-down's "Check in" button only appears for the correct day (today) and only for not-yet-completed habits, and that clicking it calls the existing `doCheckin` (verified by reading — `doCheckin` already refreshes via `load()` after the API call, so no new refresh logic is needed).
- Confirm the chain's "today" halo renders in both the completed and not-completed cases, and that every other day's rendering (unscheduled, missed, non-today-completed) is pixel-for-pixel unchanged from before.
- Confirm the card meta-line change reads correctly for both a fixed and a flexible habit, and that no other part of the file (the add/edit form, the detail modal) was accidentally touched — both still reference `habit_type`/`schedule_mode` exactly as before.
