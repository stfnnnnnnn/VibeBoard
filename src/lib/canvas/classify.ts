export type SuggestedCategory =
  | { kind: 'legacy'; target: 'activities' | 'quizzes' | 'exams' }
  | { kind: 'custom'; categoryName: string }
  | { kind: 'general' };

const EXAM_KEYWORDS = ['exam', 'exams', 'final exam', 'finals', 'midterm exam', 'midterms'];
const QUIZ_KEYWORDS = ['quiz', 'quizzes'];
const ACTIVITY_KEYWORDS = [
  'due', 'deadline', 'submit', 'submission', 'assignment', 'assignments',
  'project', 'requirement', 'requirements', 'output', 'task',
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some(n => haystack.includes(n));
}

/** Strips HTML tags for keyword matching — not a sanitizer, output is never rendered as HTML. */
export function stripHtml(html: string | null): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function classificationText(title: string, message: string | null): string {
  return `${title} ${stripHtml(message)}`.trim();
}

/**
 * Legacy-mode subjects (Activity/Quiz/Exam) are a fixed, built-in taxonomy, so a fixed keyword
 * rule set applies. Checked in this order — exam beats quiz beats activity — since the more
 * specific/urgent category should win when an announcement mentions more than one.
 */
export function suggestLegacyCategory(text: string): 'activities' | 'quizzes' | 'exams' | 'general' {
  const lower = text.toLowerCase();
  if (includesAny(lower, EXAM_KEYWORDS)) return 'exams';
  if (includesAny(lower, QUIZ_KEYWORDS)) return 'quizzes';
  if (includesAny(lower, ACTIVITY_KEYWORDS)) return 'activities';
  return 'general';
}

/**
 * Custom-mode subjects have their own grading categories (e.g. "Requirements",
 * "Documentation") — there's no fixed vocabulary that could apply to every subject, so the
 * category names themselves ARE the keywords. `categoryNames` should already be ordered the
 * way the grading config UI lists them (period, then sort_order) so ties resolve predictably.
 */
export function suggestCustomCategory(text: string, categoryNames: string[]): string | null {
  const lower = text.toLowerCase();
  for (const name of categoryNames) {
    if (name && lower.includes(name.toLowerCase())) return name;
  }
  return null;
}
