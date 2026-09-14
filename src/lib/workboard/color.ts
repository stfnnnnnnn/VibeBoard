/** Deterministic color for a course code or project name, hashed by character sum. Shared
 *  between `WorkboardWeekView`'s calendar blocks and the List/Board project-course chip dot
 *  (see docs/design/workboard-v2-direction.md §2b/§11) so the same course or project lands
 *  on the same color everywhere in Workboard, rather than drifting via two implementations. */
const PALETTE = ['#74bcd9', '#f2a7c0', '#8b7fd6', '#4dabf5', '#f0a35c'];

/** Darkened, text-safe variant of each `PALETTE` hue, same index-for-index pairing, following
 *  the module-wide raw/darkened convention (docs/design/workboard-v3-direction.md §16a, originally
 *  workboard-v2-direction.md §2a/§8): the raw hue is for non-text decoration only (3:1 non-text
 *  threshold), this darkened value is the only approved text color (4.5:1 threshold). Four of these
 *  five are the already-ratified pairs from §16a (Academic `#4dabf5`->`#185a7d`, Projects `#8b7fd6`->
 *  `#4f3fa0`, Organization `#f0a35c`->`#8a5010`, Life `#f2a7c0`->`#8a4468`), reused verbatim. The fifth,
 *  `#74bcd9`->`#225f77`, is new: derived by the same method (§8/§20's WCAG relative-luminance formula
 *  against the white-45%-over-.vb-bg-gradient proxy, `≈ #eae8f4`), holding hue (~197°) and saturation
 *  close to the raw value while cutting lightness to ~46% of it (matching the Academic/Organization
 *  pairs' own darkening ratio) — computes to 5.84:1 against the proxy, comfortably clearing 4.5:1. */
const TEXT_PALETTE = ['#225f77', '#8a4468', '#4f3fa0', '#185a7d', '#8a5010'];

export function courseColor(code: string): string {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Text-safe darkened counterpart to `courseColor`, keyed identically so the same course or
 *  project always resolves to the same raw/darkened pair. Use this for TEXT color only; use
 *  `courseColor` for borders, tints, and other non-text decoration. */
export function courseTextColor(code: string): string {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TEXT_PALETTE[h % TEXT_PALETTE.length];
}
