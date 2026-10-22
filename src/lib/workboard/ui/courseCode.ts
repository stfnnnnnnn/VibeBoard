/** "3TSY2526_CS0061L_TN3" -> "CS0061L": the first `_`/`-`/space-separated segment shaped like a
 *  course code (2+ letters, 3+ digits, optional letter). Falls back to the whole code, truncated. */
const SEGMENT = /^[A-Z]{2,}\d{3,}[A-Z]?$/;

export function shortCourseCode(code: string, max = 12): string {
  const upper = code.toUpperCase();
  const hit = upper.split(/[_\s-]+/).find(s => SEGMENT.test(s));
  if (hit) return hit;
  return code.length > max ? `${code.slice(0, max - 1)}…` : code;
}
