# Finance revamp — motion audit (Task 27)

Audited at commit `2608097` (plus the uncommitted Finance working tree), 2026-10-18.
Scope: `src/components/finance/**`, `src/app/finance/finance.css`.
Binding rules: spec §11 and the Global Constraints motion rules — animate `transform`/`opacity` only (exceptions: `.wb-collapse` grid rows; the authorised 600ms opacity `fin-fresh` tint), easing `var(--wb-ease)` = `cubic-bezier(0.23, 1, 0.32, 1)` / `var(--wb-ease-in-out)` = `cubic-bezier(0.77, 0, 0.175, 1)`, durations 120/180/240ms (`--wb-dur-fast` / `--wb-dur` / `--wb-dur-slow`), 300ms max, Ctrl+K-opened UI does not animate, hover only under `(hover: hover) and (pointer: fine)`, reduced motion removes movement (crossfades ≤120ms allowed).

## Recon

- Stack: Next 15.5 App Router, React client components, plain CSS (global classes in `finance.css`) + one rAF count-up (`HeroNumber`). No motion library.
- Shared primitives (read-only for this task): `WbOverlay` (drawer, 240ms in / 120ms out, translateX 24px; bottom sheet translateY 24px under 767px; `data-instant` → `transition: none`), `WbPopover` (scale 0.96 + opacity, 140ms in / 100ms out, `transform-origin` computed from placement and flip), `usePresence`, `DUR`, `prefersReducedMotion` — all in `src/components/workboard/ui/` / `src/lib/workboard/ui/tokens.ts`.
- Tokens: `--wb-ease`, `--wb-ease-in-out`, `--wb-dur-fast` 120ms, `--wb-dur` 180ms, `--wb-dur-slow` 240ms (`workboard.css:83-87`). Finance uses only these.
- Frequency map: tab switches, chip/button presses, logging (composer Enter) — many times a day; What-if slider drag — 60 events/s while dragging; drawer, envelopes, popovers — occasional.

## Checklist from the brief

| Item | Verdict |
| --- | --- |
| Bar grow on first load and on value change (PaceChart key replay) | **Finding #3.** First load correct (`fin-grow` scaleY from bottom, 240ms). On change, the remount restarts from `scaleY(0)`: the bar collapses and regrows instead of moving old → new; on the What-if slider this flickers every input event. |
| Hero count-up only on change | **Finding #1.** Only on change (correct), but a change mid-count restarts from the previous *target* instead of the shown value → visible jump (log then quick Undo). |
| Logged-row tint | Correct: `::before` opacity 1 → 0 over 600ms (authorised). Spec §11.6 also says the row "fades in" — missing (**Finding #6**). |
| Tab crossfade | Correct: `.fin-panel` keyed by tab, opacity 120ms. But the switch itself waits for a server round trip (**Finding #2**). |
| Drawer enter/exit | Correct per primitive: translateX 24px + opacity 240ms in; bottom sheet translateY on phones; scrim opacity 120ms. Exit is 120ms (spec says 180ms) — set in shared `workboard.css` (`.wb-overlay-panel[data-state='closed']`), out of scope; faster exit is the better default. Accepted, not changed. |
| Popover origins | Correct: `WbPopover` sets `transform-origin` from placement (`bottom-end` → right) and flip (up → bottom). Durations 140/100ms are off the 120/180/240 scale but live in the shared primitive (out of scope). Accepted. |
| `.fin-env` press | **Finding #4.** Press scale 0.98 (spec: 0.97 like every other pressable) and the tile transitions `box-shadow` on hover — not transform/opacity. |
| Envelope `scaleX` fills | Value changes transition transform 240ms from the left (correct, no width animation). Fills do not grow on first reveal (spec §11.3) — **Finding #5**. |
| Reduced-motion block | Transitions/animations inside `.fin-page`, `.fin-drawer`, `.fin-dock` drop to 0.01ms; overlay/popover handled by the shared block (opacity 120ms, no transform); `HeroNumber` and the Goals `scrollIntoView` check `prefersReducedMotion()`. Gap: press `scale(0.97)` on `.fin-btn`, `.fin-chip`, `.fin-again__tile` still snaps (only `.fin-env` was exempted) — **Finding #4b**. |
| Keyboard-opened drawer (`instant`) | Correct: Ctrl+K passes `instant` → `data-instant` on panel and scrim → `transition: none`; the presence value keeps `instant`, so the exit is instant too. |

## Findings (ordered by leverage)

| # | Pri | Severity | Category | Location | Finding | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | P1 | HIGH | Interruptibility | `hero/HeroNumber.tsx:12-27` | `from = prev.current` (the previous target). Log ₱100 then Undo within 240ms: the number snaps to the logged value and counts back from there. | Track the displayed value in a ref (`shownRef`), count from it. |
| 2 | P1 | HIGH | Purpose & frequency | `FinanceShell.tsx:37-42` | `router.push` on a dynamic (auth) page re-requests the RSC payload; the tab highlight and panel only change when the server answers (~100-400ms). Tabs are the most frequent action. | `window.history.pushState(null, '', url)` — Next ≥14.1 syncs `useSearchParams`; Back/reload keep working. |
| 3 | P1 | HIGH | Physicality / frequency | `hero/PaceChart.tsx:46`, `finance.css:149,182` | Keyed remount restarts the bar at `scaleY(0)`: after a log the bar drops to zero and regrows; on the What-if slider/amount input today's bar flickers to zero on every event. | Superseded — see Done (shipped as a WAAPI FLIP keyed by date, old → new, 240ms). |
| 4 | P2 | MEDIUM | Performance / cohesion | `finance.css:325-330` | `.fin-env` transitions `box-shadow` (paint, off-rule) and presses at 0.98. | Superseded — see Done (transform-only transition; the hover shadow snaps; press 0.97). |
| 4b | P2 | MEDIUM | Accessibility | `finance.css:43,59,269,383` | Under reduced motion the press scale still applies (instant snap) on buttons, chips, tiles. | Reduced-motion `transform: none` for `.fin-btn`, `.fin-chip`, `.fin-again__tile` `:active` (joins `.fin-env`). |
| 5 | P2 | MEDIUM | Missed (spec §11.3) | `finance.css:82-85` | Envelope / goal fills appear at their final width; spec says bars grow on first reveal. | `animation: fin-grow-x 240ms var(--wb-ease) backwards` with only a `from { scaleX(0) }` keyframe — grows to the inline scale once on mount; `backwards` fill leaves later value changes to the existing transition. |
| 6 | P2 | LOW | Missed (spec §11.6) | `finance.css:301` | The freshly logged row appears instantly; only its tint fades. | `.fin-row.is-fresh { animation: fin-fade 180ms var(--wb-ease) both }` (opacity only). |

### Rejected / accepted as-is

- Drawer exit 120ms vs spec 180ms; popover 140/100ms — shared Workboard primitives, outside the editable scope; exits faster than entrances is the right instinct anyway.
- `scaleX` on a pill-shaped fill squashes the rounded end slightly at small fills — invisible at 8px tall; animating width would break the transform-only rule.
- Pace per-day line (`bottom: %`) jumps on change — it is a reference marker, not a bar; animating `bottom` breaks the rule and a translateY rewrite is not worth it.
- Deleted rows vanish without an exit — Undo toast is the feedback; an exit would delay the list reflow.

## Done

All P1/P2 items were implemented in one pass each with the `animate` skill.

1. **HeroNumber interrupts from the shown value** (`hero/HeroNumber.tsx`). `shownRef` mirrors every value painted; a new target counts from it (240ms, cubic ease-out, last frame snaps to the exact target). Reduced motion still sets the value immediately.
2. **Instant tab switching** (`FinanceShell.tsx`). `router.push` → `window.history.pushState(null, '', url)`; `useRouter` removed. Measured 23–45ms from click to `aria-selected` (dev build), 0 RSC fetches. Back goes plan → overview → goals; loading `?tab=goals` opens Goals.
3. **PaceChart bars move old → new** (`hero/PaceChart.tsx`). Bars are keyed by date only. The mount grow stays the CSS `fin-grow` keyframe. Later height changes run a WAAPI FLIP in `useLayoutEffect`: `scaleY(old × currentScale / new) → scaleY(1)`, 240ms, `EASE`. Mid-flight changes start from what is on screen; running animations are cancelled first; no-op moves are skipped; reduced motion skips it. Checked: What-if 2% → 33.2% starts at `scaleY(0.0602)`, 33.2% → 66.4% at `scaleY(0.5)`, and the same DOM node is reused (no remount, no flash to zero).
4. **`.fin-env`** (`finance.css`). Transition is now `transform` only (the hover shadow switches without a transition: `overflow: hidden`, which clips the tier stripe, rules out a faded shadow layer). Press 0.98 → 0.97.
4b. **Reduced motion: no press scale** on `.fin-btn`, `.fin-chip`, `.fin-again__tile`, `.fin-env`.
5. **Fills grow on reveal** (`.fin-track__fill`, used by envelopes and goal notes): `fin-grow-x` (`from { scaleX(0) }` only) for 240ms with `var(--wb-ease)` and `backwards` fill. It ends at the inline scale, and later changes still use the 240ms transform transition.
6. **Fresh row fades in**: `.fin-row.is-fresh` runs `fin-fade` (opacity, 180ms), together with the existing 600ms tint.

Verified with reduced motion emulated (log ₱1, open the drawer by click, switch all four tabs): every transition/animation ran at 0.01ms, no WAAPI animation started, and the drawer panel had `transform: none` with an opacity-only 120ms transition. Ctrl+K drawer: `data-instant="true"`, `transition-property: none` on both panel and scrim.
