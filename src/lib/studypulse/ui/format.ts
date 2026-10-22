/* Display helpers shared by the subject page and the planner. Pure. */
export const f1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

export type GradeTone = 'success' | 'warn' | 'danger' | 'none';
/** Same bands the old gradeStyle() used: >= 75 success, >= 65 warn, else danger. */
export function gradeTone(g: number | null): GradeTone {
  if (g === null) return 'none';
  if (g >= 75) return 'success';
  if (g >= 65) return 'warn';
  return 'danger';
}

/** YYYY-MM-DD for "today" in Manila. Raw UTC dates are a known bug source in this repo. */
export function todayManila(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toUTC = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const dayDiff = (a: string, b: string) => Math.round((toUTC(a) - toUTC(b)) / 86_400_000);

export function shortDate(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  return String(y) === today.slice(0, 4) ? base : `${base}, ${y}`;
}

export interface DateNote { text: string; tone: 'muted' | 'warn' | 'danger' }

/** Relative context under a due date, for unfinished rows only. */
export function dueNote(deadline: string, today: string, done: boolean): DateNote | null {
  if (!deadline || done) return null;
  const diff = dayDiff(deadline, today);
  if (diff < 0) return { text: diff === -1 ? '1 day overdue' : `${-diff} days overdue`, tone: 'danger' };
  if (diff === 0) return { text: 'today', tone: 'warn' };
  if (diff === 1) return { text: 'tomorrow', tone: 'warn' };
  if (diff <= 7) return { text: `in ${diff} days`, tone: 'muted' };
  return null;
}

export function submittedNote(deadline: string, accomplished: string): DateNote | null {
  if (!deadline || !accomplished) return null;
  const late = dayDiff(accomplished, deadline);
  if (late <= 0) return { text: 'on time', tone: 'muted' };
  return { text: late === 1 ? '1 day late' : `${late} days late`, tone: 'danger' };
}
