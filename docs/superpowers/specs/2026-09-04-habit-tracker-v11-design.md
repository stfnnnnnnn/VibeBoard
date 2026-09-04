# Habit Tracker v11 — Analytics Area Redesign — Design

**Status:** Approved for planning
**Date:** 2026-09-04
**Depends on:** Habit Tracker v6 (visual identity), v9 (pace-wording, whose "Needs attention" named sentence this spec keeps and whose "On pace" named sentence this spec deliberately drops), v10 (visual & motion round 2, whose `RhythmRing`/`ChainRow`/`.ht-day-cell` this spec builds directly on top of) — all shipped and reviewed earlier this session.
**Origin:** an external design critique pasted by the user immediately after v10 shipped, covering 12 numbered points across the whole module. Decomposed via `superpowers:brainstorming` into two sub-projects along the page's own two competing focal areas: **v11 (this spec) — the analytics area** (hero, daily rhythm, category consistency, page layout), and a future **v12 — cards, chain & modal**. The user chose "fewer, larger sub-projects" for the split and "follow the critique's mockups closely" for this spec's design approach.

## Grounding against the real shipped code

Before scoping this spec, the current `src/components/habits/HabitsDashboard.tsx` (post-v10) was read in full and checked against all 12 critique points. Several are already true and are explicitly **out of scope** here:
- **Point 5's core claim** ("category color should be identity-only, never a performance signal") is already true — `CATEGORY_COLORS` colors the card border, the category dot, and the consistency bar fill identically regardless of performance. Only the "reduce height/saturation" part of point 5 is addressed below.
- **Point 7** (4-state chain, small unscheduled dot) and **point 8** (flexible rituals get their own dot-based visual, a pace line, and — already since v3 — a numeric target/remaining bar with a `[−][amount][+]` stepper) are both already substantially shipped. Neither is touched by this spec (they belong to the deferred v12, specifically point 7's remaining "use gradient sparingly" angle).
- The user confirmed the critique's screenshots reflect the current post-v10 build, so **point 4**'s complaint about the day-cell selection treatment is treated as a real, current gap even though the code's `.ht-day-cell.selected` rule (a subtle inset ring) looks modest on paper — this environment has no browser-automation tool, so the code-level read and the user's visual impression are reconciled by trusting the user's report of the rendered result.

This spec covers points **1, 2, 3, 4, 5 (weight/saturation only), and 12** — everything in the "analytics area" half of the page.

## Problem

Weekly Rhythm shows the same number twice (a ring and a full-width bar). The hero consumes a two-column grid's worth of space for what is fundamentally one number and two short sentences. The Daily Rhythm strip uses the same `○` glyph shape for both "missed" and "nothing scheduled," distinguished only by color, and its selected-day treatment tints and rings the whole cell. Category Consistency, while structurally fine, carries the same visual weight as the primary hero despite being secondary analytical detail. And the three analytics panels stack full-width one under another, competing for vertical space with the ritual-card grid below.

## Goals

- Exactly one dominant visualization in the hero: the ring. The bar is removed. Everything else is small supporting text.
- The hero collapses from a two-column grid into a single compact row plus one actionable callout row below a divider.
- Daily Rhythm becomes a genuine 4-state model — completed / partial / missed / **nothing-scheduled** — with a distinct glyph for the fourth state, not just a color variant of "missed."
- The selected-day indicator shrinks from a filled/tinted cell to a small marker; the detail panel below (which already exists and already is the master-detail relationship point 4 asks for) is unchanged.
- Category Consistency keeps its bar visualization but with less visual weight — shorter bars, lower fill opacity, smaller text.
- Daily Rhythm and Category Consistency sit side-by-side on wide viewports instead of stacking, freeing vertical space for the ritual-card grid.

## Non-goals

- No change to card layout, the chain visualization, flexible-ritual styling, or the create/edit modal — those are v12's scope.
- No change to any data, API, or schema — this is confined to `src/components/habits/HabitsDashboard.tsx`.
- No change to the v9 "Needs attention" wording logic (`todayIncomplete` ternary) — only its position in the layout.
- No change to `RhythmRing`'s internal count-up/reduced-motion logic — only the `size`/`strokeWidth` values passed at its one call site.

## Design

### 1 & 2. Hero — single row, ring-dominant, one callout below a divider

Replace the current two-column `.ht-hero-grid` (lines ~328–396) with a single flex row followed by one always-present bottom row. The ring shrinks from 96px to 72px since it's no longer sharing space with a bar; the caption drops the redundant "This week:" prefix (the `<h2>` above already establishes context) and shortens to `{actual}/{expected} completed`. The on-pace/at-risk **counts** row is kept verbatim (already compact, already exactly the kind of small supporting text this design wants). The bar (`.ht-progress-fill` under the ring) is deleted entirely.

Below a divider, one row always renders: the named "⚠ Needs attention" sentence (kept verbatim from v9, including its `todayIncomplete` distinction) on the left when present, and "🔥 Best chain · N days" (relabeled from the current streak line, using the same `summary.longest_streak` field) pinned right via `marginLeft: 'auto'`.

**Explicit behavior change, flagged for approval:** the named "✓ On pace: X — Y/Z completed" sentence v9 introduced is **dropped** from this layout. The counts row already says "N rituals on pace"; naming a specific on-pace habit doesn't carry the same actionability as naming the one that needs attention, and the critique's own mockups only ever surface a warning callout, never a positive one. The `on_pace` field itself is untouched in `src/lib/habits.ts` — only this component stops rendering the sentence built from it. If the user wants to keep it, it's a two-line revert of `HabitsDashboard.tsx` alone, no backend change either way.

Also flagged: previously the divider between the ring row and the streak line only rendered when `on_pace || needs_attention` was truthy — the streak line itself always rendered, just without a divider above it in the empty case. In this redesign, the divider is now unconditional (`Best chain` always sits below it), which is a minor, deliberate simplification for a consistent shape regardless of data.

```tsx
<div className="glass" style={{ borderRadius: 20, padding: '20px 24px' }}>
  <h2 className="gradient-text" style={{ ...HEADING_FONT, fontSize: '1.15rem', fontWeight: 800, margin: '0 0 12px' }}>This Week&apos;s Rhythm</h2>
  <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
    <RhythmRing
      percent={summary.weekly_expected.expected > 0 ? Math.min(100, Math.round((summary.weekly_expected.actual / summary.weekly_expected.expected) * 100)) : null}
      size={72}
      strokeWidth={7}
    />
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ ...HEADING_FONT, fontSize: '0.95rem', fontWeight: 700, color: '#332b45' }}>
        {summary.weekly_expected.expected > 0
          ? <>{summary.weekly_expected.actual}/{Math.max(summary.weekly_expected.actual, Math.round(summary.weekly_expected.expected))} completed</>
          : 'Nothing due yet this week'}
      </span>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.82rem' }}>
        {summary.total_habits - summary.at_risk > 0 && (
          <span style={{ color: '#444' }}>
            <Check size={13} color="#42c38b" style={{ verticalAlign: -2, marginRight: 4 }} />
            {summary.total_habits - summary.at_risk} on pace
          </span>
        )}
        {summary.at_risk > 0 && (
          <span style={{ color: '#444' }}>
            <AlertTriangle size={13} color="#f75b67" style={{ verticalAlign: -2, marginRight: 4 }} />
            {summary.at_risk} need{summary.at_risk === 1 ? 's' : ''} attention
          </span>
        )}
      </div>
    </div>
  </div>

  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
    {summary.needs_attention && (() => {
      const na = summary.needs_attention!;
      const fullHabit = habits?.find(h => h.habit_id === na.habit_id);
      const todayIncomplete = !!fullHabit && fullHabit.is_today && !fullHabit.checked_in_today;
      return (
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#444' }}>
          <span style={{ color: '#c0392b', fontWeight: 700 }}>⚠ Needs attention:</span>{' '}
          <strong>{na.task_name}</strong> —{' '}
          {todayIncomplete
            ? "today's occurrence is still incomplete"
            : `${na.week_actual}/${na.week_target} completed this week`}
        </p>
      );
    })()}
    <span style={{ color: '#888', fontSize: '0.82rem', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
      <Trophy size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
      Best chain · {summary.longest_streak} day{summary.longest_streak === 1 ? '' : 's'}
    </span>
  </div>
</div>
```

Remove the `.ht-hero-grid` CSS rule and its `@media (min-width: 720px)` companion entirely (no longer a 2-column layout, nothing else references this class).

### 3 & 4. Daily Rhythm — real 4th state, lighter selection marker

Extract the panel into its own component, `DailyRhythmPanel`, both because it now needs a real 4-state glyph model and because §12 needs to place it in two different layout contexts (paired with Category Consistency, or alone) without duplicating its ~60 lines of JSX:

```tsx
function DailyRhythmPanel({
  summary, habits, selectedDay, setSelectedDay, doCheckin,
}: {
  summary: HabitsSummary; habits: HabitWithComputed[] | null;
  selectedDay: string | null; setSelectedDay: (updater: (prev: string | null) => string | null) => void;
  doCheckin: (id: number) => void;
}) {
  return (
    <div className="glass" style={{ borderRadius: 20, padding: '20px 24px' }}>
      <h3 style={{ ...HEADING_FONT, margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 700, color: '#444' }}>Daily rhythm — last 7 days</h3>
      <div style={{ display: 'flex', gap: 4 }}>
        {summary.weekly_rhythm.map(d => {
          const glyph = d.scheduled === 0 ? '·' : d.percent >= 100 ? '●' : d.percent > 0 ? '◐' : '○';
          const glyphColor = d.scheduled === 0
            ? 'rgba(0,0,0,0.2)'
            : d.percent > 0
              ? '#74bcd9'
              : '#f75b67';
          const isSelected = selectedDay === d.date;
          return (
            <div
              key={d.date}
              onClick={() => setSelectedDay(prev => prev === d.date ? null : d.date)}
              title={`${d.weekday} ${d.date}: ${d.scheduled > 0 ? `${d.percent}% fulfilled` : 'nothing scheduled'}`}
              className="ht-day-cell"
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', padding: '8px 4px', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10 }}
            >
              <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#777', minHeight: 12 }}>
                {d.scheduled > 0 ? `${d.percent}%` : '—'}
              </div>
              <div style={{ fontSize: '1.3rem', lineHeight: 1, color: glyphColor }}>{glyph}</div>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#999' }}>{WEEKDAY_SHORT[d.weekday]}</div>
              <div style={{ width: 16, height: 3, borderRadius: 2, background: isSelected ? '#74bcd9' : 'transparent' }} />
            </div>
          );
        })}
      </div>

      {selectedDay && habits && (() => {
        const todayStr = summary.weekly_rhythm[summary.weekly_rhythm.length - 1]?.date;
        const isToday = selectedDay === todayStr;
        const dayHabits = habits
          .filter(h => h.schedule_mode === 'fixed')
          .map(h => ({ habit: h, day: h.chain?.find(c => c.date === selectedDay) }))
          .filter((x): x is { habit: HabitWithComputed; day: NonNullable<HabitWithComputed['chain']>[number] } => !!x.day?.scheduled);
        return (
          <div key={selectedDay} className="ht-fade-slide" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 8 }}>
              {new Date(selectedDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
            {!dayHabits.length ? (
              <div style={{ fontSize: '0.82rem', color: '#888' }}>Nothing scheduled this day.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dayHabits.map(({ habit, day }) => (
                  <div key={habit.habit_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                    <span style={{ color: day.completed ? '#42c38b' : '#c0392b' }}>{day.completed ? '✓' : '○'}</span>
                    <span style={{ flex: 1 }}>{habit.task_name}</span>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: CATEGORY_COLORS[habit.task_category], display: 'inline-block' }} />
                    <span style={{ fontSize: '0.72rem', color: '#888' }}>{CATEGORY_LABELS[habit.task_category]}</span>
                    {isToday && !day.completed && habit.tracking_type === 'boolean' && (
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
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
```

This is a verbatim move of the existing detail-panel logic (the master-detail relationship point 4 asks for already exists and is untouched) plus three changes to the day-cell row: the `·` glyph for `d.scheduled === 0` (was `○`), the `border`/`borderRadius` making each cell a bordered box, and the trailing marker `<div>` replacing the `.selected` class's cell-wide tint.

Remove the `.ht-day-cell.selected { background: ...; box-shadow: ...; }` CSS rule (superseded by the marker element). Keep `.ht-day-cell:hover` as-is — hover is a different, still-useful affordance from the selected state.

### 5. Category Consistency — lighter visual weight

Extract into `CategoryConsistencyPanel`, with reduced bar height (10px → 6px), reduced fill opacity (0.8), and smaller type:

```tsx
function CategoryConsistencyPanel({ categoryConsistency }: { categoryConsistency: HabitsSummary['category_consistency'] }) {
  return (
    <div className="glass" style={{ borderRadius: 20, padding: '16px 20px' }}>
      <h3 style={{ ...HEADING_FONT, margin: '0 0 12px', fontSize: '0.85rem', fontWeight: 700, color: '#666' }}>Consistency by category — this week</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {categoryConsistency.map(c => (
          <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 90, fontSize: '0.76rem', fontWeight: 600, color: '#666' }}>{CATEGORY_LABELS[c.category]}</div>
            <div style={{ flex: 1, height: 6, borderRadius: 4, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
              <div className="ht-progress-fill" style={{ width: `${c.percent}%`, height: '100%', borderRadius: 4, background: CATEGORY_COLORS[c.category], opacity: 0.8 }} />
            </div>
            <div style={{ width: 50, textAlign: 'right', fontSize: '0.72rem', color: '#999' }}>{c.completed}/{c.scheduled}</div>
            <div style={{ width: 32, textAlign: 'right', fontSize: '0.74rem', fontWeight: 700, color: '#666' }}>{c.percent}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Category color remains the bar's fill hue (identity, unchanged) — only its opacity and the bar's height/type sizing change, per point 5's actual gap (weight/saturation, not the color mapping itself, which was already correct).

### 12. Page layout — Daily Rhythm and Category Consistency side by side

Below the hero, wrap the two panels in a new `.ht-analytics-row` grid — 1 column under 720px, `1.4fr 1fr` at 720px and up (Daily Rhythm gets slightly more width, matching the critique's proportions). When there's no category data for the week, render `DailyRhythmPanel` alone with `gridTemplateColumns: '1fr'` forced inline so it doesn't get squeezed into a half-width track with nothing beside it:

```tsx
<div
  className="ht-analytics-row"
  style={summary.category_consistency.length === 0 ? { gridTemplateColumns: '1fr' } : undefined}
>
  <DailyRhythmPanel summary={summary} habits={habits} selectedDay={selectedDay} setSelectedDay={setSelectedDay} doCheckin={doCheckin} />
  {summary.category_consistency.length > 0 && (
    <CategoryConsistencyPanel categoryConsistency={summary.category_consistency} />
  )}
</div>
```

New CSS:
```css
.ht-analytics-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  margin-top: 16px;
}
@media (min-width: 720px) {
  .ht-analytics-row { grid-template-columns: 1.4fr 1fr; }
}
```

The inline `gridTemplateColumns: '1fr'` override wins over the media-query rule at any viewport width (inline styles always beat stylesheet rules for the same property, media query or not) — this is a plain layout override, not the inline-style-blocks-`:hover` footgun from v10, since nothing here needs a pseudo-class.

## Migration & compatibility

Purely presentational — no data, API, or schema change. One structural change: `DailyRhythmPanel` and `CategoryConsistencyPanel` become named functions in `HabitsDashboard.tsx` (not exported, not moved to separate files — consistent with the file's existing pattern of `ChainRow`/`WeekDots`/`AmountInput`/etc. as same-file helper components). `RhythmRing`'s public shape (`percent`/`size`/`strokeWidth` props) is unchanged; only its one call site's argument values change.

One behavior change requiring explicit sign-off (flagged above): the v9 "✓ On pace: ..." named sentence is dropped from the rendered hero. `summary.on_pace` itself is untouched in the backend and in the type — only this component stops consuming it for that one sentence. The counts row's "N on pace" already conveys the aggregate fact.

## Testing / verification plan

Same standing approach as v1–v10 (no test framework in this repo; no browser-automation tool in this environment): `tsc --noEmit`, then careful reading of the JSX/CSS, plus real API calls where they add genuine confidence.

- Confirm the hero no longer renders any `.ht-progress-fill` element and the `RhythmRing` call site passes `size={72} strokeWidth={7}`.
- Confirm the "Best chain" row renders unconditionally whenever the analytics section renders (i.e., whenever `summary.total_habits > 0`), and the "Needs attention" paragraph inside it is gated on `summary.needs_attention` exactly as before (same `todayIncomplete` derivation, unchanged).
- Confirm the removed "✓ On pace: ..." sentence's JSX block is gone and no dangling reference to `summary.on_pace` remains outside of what's needed for the (deleted) sentence — the `on_pace` field is otherwise untouched in `src/lib/habits.ts`.
- Confirm `DailyRhythmPanel`'s glyph derivation now branches on `d.scheduled === 0` to produce `'·'` (not `'○'`) as a fourth, textually distinct state from the `'○'` used for a scheduled-but-missed day.
- Confirm the day-cell's `.selected` CSS rule is removed from the stylesheet block and no longer referenced, and that the new trailing marker `<div>` is the only remaining visual difference for a selected cell.
- Confirm `.ht-hero-grid` and its media query are fully removed and no longer referenced anywhere in the file.
- Confirm `.ht-analytics-row` is defined once with its media query, and that the inline `gridTemplateColumns: '1fr'` override is applied only in the `category_consistency.length === 0` branch.
- Confirm `DailyRhythmPanel` and `CategoryConsistencyPanel` are called with the exact prop shapes declared in their signatures — no prop drilling gaps (e.g., `doCheckin` reaching the "Check in" button inside `DailyRhythmPanel`'s detail block).
- Real API/DB check: this pass changes no computation, only presentation — confirm via reading `src/lib/habits.ts` that `weekly_expected`, `needs_attention`, `longest_streak`, `weekly_rhythm`, and `category_consistency` are still produced with the same shapes this redesign consumes (same standing practice as v10, whose Step-4 static-substitute ruling applies equally here since nothing in this spec touches backend code).
