/* Lightweight strength meter (spec §7.2). Not a security boundary; the server enforces only the 8-char minimum. */
import { MIN_PASSWORD } from './validate';

export interface Strength { score: 0 | 1 | 2 | 3 | 4; label: string; hint: string }

const COMMON = new Set([
  'password', 'password1', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop', 'iloveyou',
  'abc12345', '11111111', '00000000', 'admin123', 'letmein1', 'welcome1', 'sunshine', 'princess',
  'football', 'baseball', 'dragon12', 'monkey12', 'vibeboard', 'vibeboard1',
]);

export function scorePassword(pw: string): Strength {
  if (!pw) return { score: 0, label: '', hint: `At least ${MIN_PASSWORD} characters.` };
  if (pw.length < MIN_PASSWORD) {
    const n = MIN_PASSWORD - pw.length;
    return { score: 0, label: 'Too short', hint: `${n} more character${n === 1 ? '' : 's'}.` };
  }
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) {
    return { score: 1, label: 'Too common', hint: "This one is easy to guess. Try a phrase only you'd know." };
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  let score = 1;
  if (pw.length >= 12) score++;
  if (classes >= 3) score++;
  if (pw.length >= 16 || (classes === 4 && pw.length >= 10)) score++;
  const s = Math.min(score, 4) as Strength['score'];
  if (s === 1) return { score: 1, label: 'Weak', hint: 'Make it longer or mix in numbers and symbols.' };
  if (s === 2) return { score: 2, label: 'Fair', hint: 'Longer is stronger. Try 12+ characters with a number.' };
  if (s === 3) {
    const hint = /[^A-Za-z0-9]/.test(pw) ? 'A few more characters make it great.' : 'Add a symbol to make it great.';
    return { score: 3, label: 'Strong enough', hint };
  }
  return { score: 4, label: 'Great password', hint: '' };
}
