/** Deterministic color for a course code or project name, hashed by character sum. Shared
 *  between `WorkboardWeekView`'s calendar blocks and the List/Board project-course chip dot
 *  (see docs/design/workboard-v2-direction.md §2b/§11) so the same course or project lands
 *  on the same color everywhere in Workboard, rather than drifting via two implementations. */
const PALETTE = ['#74bcd9', '#f2a7c0', '#8b7fd6', '#4dabf5', '#f0a35c'];

export function courseColor(code: string): string {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
