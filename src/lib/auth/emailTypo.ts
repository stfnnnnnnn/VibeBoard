/* "Did you mean …?" for common email-domain typos (spec §7.1). Suggests only within edit distance 2 of a
   known domain, and never when the typed domain is itself known. */
const DOMAINS = [
  'gmail.com', 'yahoo.com', 'yahoo.com.ph', 'outlook.com', 'hotmail.com',
  'icloud.com', 'live.com', 'mail.com', 'ymail.com', 'fit.edu.ph',
];

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain || DOMAINS.includes(domain)) return null;
  let best: string | null = null;
  let bestDist = 3;
  for (const d of DOMAINS) {
    const dist = editDistance(domain, d);
    if (dist > 0 && dist < bestDist) { best = d; bestDist = dist; }
  }
  return best ? `${local}@${best}` : null;
}
