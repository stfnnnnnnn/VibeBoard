/** Raw percentage from a score and item count, 2 decimals; null when not computable. */
export function calcGrade(score: string, items: string): number | null {
  const s = parseFloat(score);
  const i = parseFloat(items);
  if (!score || isNaN(s) || isNaN(i) || i <= 0) return null;
  return parseFloat(((s / i) * 100).toFixed(2));
}
