# Workboard revamp: motion audit (Task 35)

Date: 2026-10-08. Commit at audit time: `2608097` (Phase 1-6 work is uncommitted in the working tree).
Scope: `src/components/workboard/**` and `src/app/workboard/workboard.css`, plus Sonner 2.0.8's injected
stylesheet where it styles Workboard toasts.
Brief: spec §4.3. Sanctioned exceptions (controller rulings): popover 140ms enter / 100ms exit, palette
140 / 100, week slide 160ms, Focus row collapse (`grid-template-rows`, 180ms), and paint-only
colour / `stroke-dashoffset` transitions.

Method: `improve-animations` skill (recon, audit by AUDIT.md's eight categories, vet each finding
at its file:line). The skill's subagent fan-out and its `plans/NNN-*.md` layout were not used: the
plan's rules forbid subagents, and the brief asks for one file. Each plan below is short because
the fixes are small.

## Recon

- **Stack:** Next.js 15, React 19, styled-jsx and one global sheet (`workboard.css`). No motion
  library. Motion is CSS transitions and keyframes. JS only flips `data-state` (`enter` → `open` →
  `closed`) on the next frame. This is the class-toggle fallback that §4.3 rule 5 allows.
- **Tokens:** `--wb-ease` = `cubic-bezier(0.23, 1, 0.32, 1)` and `--wb-ease-in-out` =
  `cubic-bezier(0.77, 0, 0.175, 1)`. Durations are `--wb-dur-fast` 120ms, `--wb-dur` 180ms and
  `--wb-dur-slow` 240ms. The TS mirror is in `src/lib/workboard/ui/tokens.ts` (`EASE`, `DUR`,
  `prefersReducedMotion()`).
- **Keyboard origin:** overlays and popovers take `instant`, which callers derive from
  `e.detail === 0` or the shell's `keyboardIntent`. Timeline navigation and the segmented control
  skip motion when used from the keyboard.
- **Frequency map:**
  - Many times a day: row hover, table cell popovers, the view switcher, checkbox completion and
    toasts.
  - Occasional: the dialog, drawer, palette, week switching, Board drag and the bulk bar.
  - Rare: the type chooser and the event dialog.

## Overall verdict

The motion is already close to spec. Every transition uses transform or opacity, apart from the
sanctioned row collapse and paint-only colour changes. Every entrance has a reduced-motion path,
and nothing uses `scale(0)`, `ease-in` or `transition: all`. The findings are a handful of edge
leaks.

## Vetted findings

| # | Sev | Category | Location | Finding | Fix summary | Verdict |
|---|---|---|---|---|---|---|
| 1 | MED | Easing & duration | Sonner `styles.css` rule `[data-sonner-toast][data-removed=true][data-front=false][data-swipe-out=false][data-expanded=false]` vs `workboard.css` `[data-sonner-toast].wb-toast:not([data-swiping='true'])` | When a stacked (non-front, collapsed) toast is removed, it runs `transition: transform .5s, opacity .2s`. Sonner's rule has specificity (0,5,0) and beats our (0,3,0) override, so that exit takes 500ms. | Add an override at higher specificity, (0,6,0), with `transition-duration: 240ms` and `transition-timing-function: var(--wb-ease)`. Sonner's reduced-motion `!important` rule still wins. | **Accepted** (deferred minor, Task 8) |
| 2 | MED | Purpose & frequency (rule 3) | `src/components/workboard/ui/WbBulkBar.tsx` (the three `<WbPopover>`s, trigger `onClick`) | The Status, Priority and Deadline menus play the 140ms popover entrance even when opened with Enter or Space. Every other popover trigger passes `instant`. | Record `e.detail === 0` in the trigger's click and pass `instant` to the three popovers. | **Accepted** |
| 3 | MED | Purpose & frequency (rule 3) | `src/components/workboard/NewItemTypeChooser.tsx` `.vb-new-item-option:focus-visible { transform: translateY(-2px) }` plus the base `transition: transform 120ms` | Moving focus between the type cards with Tab animates a 2px lift on each card, so keyboard navigation produces motion. | Drop the `transform` from the `:focus-visible` state and keep the tint, shadow and check, which carry the focus state. The pointer-hover lift is unchanged. | **Accepted** |
| 4 | LOW | Cohesion & tokens / hover (rule 6) | `src/components/workboard/WorkItemRow.tsx` `WorkTitleButton` styles: `.vb-row-title { transition: color 150ms ease }`, ungated `:hover` | Off-scale duration (150ms) and bare `ease` instead of the tokens. The hover colour and underline are not gated to fine pointers, so they stick after a tap on touch. | Use `transition: color var(--wb-dur-fast) var(--wb-ease)` and wrap the two `:hover` rules in `@media (hover: hover) and (pointer: fine)`. | **Accepted** |
| 5 | LOW | Cohesion & tokens | `workboard.css` reduced-motion blocks: `.wb-overlay-panel, .wb-popover, .wb-collapse { transition: opacity var(--wb-dur-fast) linear }` and `.wb-bulkbar ... { transition: opacity var(--wb-dur-fast) linear }` | The reduced-motion crossfades use `linear`, while rule 2 asks for `--wb-ease` on enter and exit. | Replace `linear` with `var(--wb-ease)`. | **Accepted** |

### Rejected or not actioned (with reasons)

| Candidate | Reason |
|---|---|
| Bulk bar plays its 8px rise even when the selection was made from the keyboard (Space on a row checkbox) | Spec §12 defines this entrance. The bar is not opened from the keyboard; it is a status surface that appears as a side effect of selection, and its menus are now instant (#2). |
| `.wb-pressable:active` scale(0.97) also fires on a keyboard Space press | This is press feedback, not keyboard-opened UI (§4.2). It lasts 120ms and is removed under reduced motion. |
| Focus row collapse and checkbox check-draw also play when completing from the keyboard | Both are sanctioned (§6: check-draw 180ms paint-only, row collapse the one layout exception). They show where the row went, and reduced motion removes the collapse. |
| Table row checkbox and Focus row actions fade in (opacity 120ms) on `:focus-within` | Opacity-only and ≤120ms. They do not move. |
| `WbSegmented`: Enter or Space on a tab triggers `select()`, which animates the pill | Not reachable. With the roving tabindex, only the selected tab is focusable by Tab, so Enter on it is a no-op. Arrow keys already skip the slide. |
| `WbSegmented` pill `width` changes instantly while `transform` slides | Animating width breaks rule 1, and scaling with `scaleX` would distort the pill's corner radius. Fixing it means redesigning the pill (for example a clip-path reveal), which is beyond this pass. |
| Overdue KPI card uses `scrollIntoView({ behavior: 'smooth' })` even from Enter | This is page navigation, not a UI entrance. The smooth scroll shows the reader where they moved, and it already becomes `'auto'` under reduced motion. |
| Sonner swipe-out keyframes (200ms, `ease-out`) | Touch-gesture dismissal is inside budget and runs only after a swipe. Sonner owns it, and its reduced-motion `!important` rule removes it. |
| Sonner's `[data-sonner-toaster] { transition: transform .4s ease }` and `[data-sonner-toast] > * { transition: opacity .4s }` | Dormant in this setup. The toaster's transform only changes when the viewport crosses Sonner's 600px breakpoint. Child opacity only changes for `data-styled=true` toasts, and ours are `unstyled`. |
| `@starting-style` is not used | Rule 5 allows the class-toggle fallback. Every primitive uses one (`data-state` enter → open on the next frame), consistently. |
| Toaster offset jumps 68px when the bulk bar appears (§4.5 "rises") | Deferred as a follow-up (a transform-based rise is spec-compliant). Sonner moves the toaster with `bottom`, and animating that property would break rule 1, so a rise would have to use `transform`. |

### Notes only (deferred minors, no change)

- **Desktop day panel has no exit:** the Timeline panel slides in (240ms) but unmounts instantly
  on close. This is acceptable: the spec only asks for the entrance, and an instant close is a
  quick dismissal.
- **Popover offset during the drawer slide:** `WbPopover` measures its anchor when it opens and
  re-places on scroll and resize, but not on transform. A popover opened inside the drawer within
  its 240ms entrance could sit up to 24px off until the next scroll. This needs a sub-240ms click
  after opening the drawer. The fix would be a ResizeObserver or transitionend re-place in
  `WbPopover`, which is out of scope.
- **Reduced motion for the bulk bar, toasts and overlays:** verified in CSS.
  - Bulk bar: the reduced-motion block pins `transform` (desktop and phone) and leaves a 120ms
    opacity fade.
  - Toasts: Sonner's own `@media (prefers-reduced-motion)` sets `transition: none !important` on
    every toast. Our overrides (including #1) are not `!important`, so toasts appear and leave
    without moving.
  - Overlays: the modal, drawer and palette `transform` are pinned to their rest value (`none`)
    in the overlay reduced-motion block (Task CL folded the Task 30 layer block into it). Exit timers are 0 under
    `prefersReducedMotion()`.

## Missed opportunities

None taken. The brief forbids new animations. The one real seam is the toaster offset change
(above).

## Plans (accepted findings)

### Plan 1: Sonner collapsed-exit duration
- File: `src/app/workboard/workboard.css`, Toasts section, after the existing
  `[data-sonner-toast].wb-toast:not([data-swiping='true'])` rule.
- Add:
  `[data-sonner-toast].wb-toast[data-removed='true'][data-front='false'][data-swipe-out='false'][data-expanded='false'] { transition-duration: 240ms; transition-timing-function: var(--wb-ease); }`
- Keep Sonner's `transition-property` (transform and opacity). Do not add `!important`, so
  Sonner's reduced-motion rule keeps winning.
- Verify: stack three toasts, then dismiss one in the back. It should drop out in 240ms, not 500ms.

### Plan 2: Bulk bar menus instant from the keyboard
- File: `src/components/workboard/ui/WbBulkBar.tsx`.
- Add `const [menuInstant, setMenuInstant] = useState(false)`. In the trigger's `onClick`, call
  `setMenuInstant(e.detail === 0)` before `toggle(m)`. Pass `instant={menuInstant}` to all three
  `WbPopover`s.
- Verify: Tab to Status and press Enter. The menu should appear with no scale or fade. A mouse
  click should still animate.

### Plan 3: Type chooser focus without movement
- File: `src/components/workboard/NewItemTypeChooser.tsx`, global styled-jsx block.
- Remove `transform: translateY(-2px);` from `.vb-new-item-option:focus-visible`. Leave the hover
  lift and the reduced-motion block as they are.
- Verify: Tab through the cards. The focus ring and tint appear with no lift, and pointer hover
  still lifts.

### Plan 4: WorkTitleButton tokens and hover gate
- File: `src/components/workboard/WorkItemRow.tsx`, `WorkTitleButton`'s `<style jsx>`.
- Change `transition: color 150ms ease` to `transition: color var(--wb-dur-fast) var(--wb-ease)`.
- Wrap `.vb-row-title:hover` and `.vb-row-title-done:hover` in
  `@media (hover: hover) and (pointer: fine) { ... }`.

### Plan 5: Reduced-motion crossfade easing
- File: `src/app/workboard/workboard.css`, both reduced-motion blocks that use
  `var(--wb-dur-fast) linear`. Change `linear` to `var(--wb-ease)`.

## Status

| Plan | Status |
|---|---|
| 1 Sonner collapsed exit | DONE (Task 35) |
| 2 Bulk bar menus instant | DONE (Task 35) |
| 3 Type chooser focus lift | DONE (Task 35) |
| 4 WorkTitleButton tokens/gate | DONE (Task 35) |
| 5 Reduced-motion easing | DONE (Task 35) |
