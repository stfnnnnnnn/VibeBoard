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

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  // Typography Canvas's editor also writes.
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…',
};

/** One pass, so "&amp;nbsp;" becomes the text "&nbsp;". Unknown names and invalid code points stay as written. */
function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (m, dec?: string, hex?: string, name?: string) => {
    if (name) return NAMED_ENTITIES[name] ?? m;
    const cp = dec ? parseInt(dec, 10) : parseInt(hex!, 16);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
  });
}

/** Canvas HTML as plain text: source whitespace collapses as in HTML, block tags (</p>, <br>, </li>, </div>,
    <h1>–<h6>) become line breaks, other tags a space, entities are decoded (&nbsp; &amp; &lt; &gt; &quot; &#39;
    &apos;, a few typographic names, and numeric), runs of spaces collapse, and blank lines drop. Used for keyword matching, note_spans (server) and the reading pane (client, shown with
    white-space: pre-line), so the spans index into the same string on both sides. Not a sanitizer: the output is
    only ever rendered as text. */
export function stripHtml(html: string | null): string {
  if (!html) return '';
  const text = decodeEntities(html
    .replace(/\s+/g, ' ') // line breaks in HTML source are plain whitespace
    .replace(/<br\b[^>]*>|<\/(?:p|li|div)\s*>|<\/?h[1-6]\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' '));
  return text.split(/\r?\n|\r/)
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
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

export type WorkboardDestination = 'task' | 'event' | 'reminder' | 'schedule_change';

const SCHEDULE_CHANGE_KEYWORDS = [
  'asynchronous', 'async session', 'no class', 'class is cancelled', 'class is suspended',
  'classes are suspended', 'moved online', 'postponed', 'reschedule', 'rescheduled',
];
const EVENT_KEYWORDS = [
  'consultation', 'meeting', 'orientation', 'seminar', 'session will be held',
];

/**
 * Deterministic, keyword-based — no AI, matching suggestLegacyCategory/suggestCustomCategory
 * above. `taskSuggested` is computed by the caller from those two functions (a non-'general'
 * result) rather than recomputed here, so this function stays independent of grading-mode logic.
 * 'reminder' has no reliable keyword signal and is never auto-suggested — always opt-in.
 */
export function suggestDestinations(text: string, taskSuggested: boolean): Set<WorkboardDestination> {
  const lower = text.toLowerCase();
  const destinations = new Set<WorkboardDestination>();
  if (taskSuggested) destinations.add('task');
  if (includesAny(lower, SCHEDULE_CHANGE_KEYWORDS)) destinations.add('schedule_change');
  if (includesAny(lower, EVENT_KEYWORDS)) destinations.add('event');
  return destinations;
}

// ---------------------------------------------------------------------------------------------
// Activity Bank: "Goes to Period › Category" suggestions (Canvas hub, spec 2026-10-24).
// ---------------------------------------------------------------------------------------------

export interface BankSuggestion {
  period_id: number; period_name: string; cat_id: number; cat_name: string;
  confidence: 'match' | 'guess'; reason: string;
}

/** Keyword aliases, checked in this order. A keyword matches at a word start in the item name
 *  (so "lab" doesn't fire on "collaboration"); the alias then picks the period's first category
 *  whose lower-cased name contains one of `category`. */
const CATEGORY_ALIASES: Array<{ keywords: Array<[label: string, re: RegExp]>; category: string[] }> = [
  { keywords: [['quiz', /\bquiz/i], ['seatwork', /\bseatwork/i], ['long test', /\blong test/i]], category: ['quiz'] },
  {
    keywords: [
      ['task', /\btask/i], ['data sheet', /\bdata sheet/i], ['report', /\breport/i], ['activity', /\bactivit/i],
      ['lab', /\blab/i], ['output', /\boutput/i], ['assignment', /\bassignment/i],
    ],
    category: ['task', 'activit', 'lab', 'output', 'requirement'],
  },
  { keywords: [['exam', /\bexam/i], ['midterm', /\bmidterm/i], ['final', /\bfinal/i]], category: ['exam'] },
  { keywords: [['problem set', /\bproblem set/i], ['ps', /\bps\s?\d/i]], category: ['problem', 'set', 'exercise'] },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive match of a category name in an item name, tolerating the
 *  singular/plural difference ("Problem Sets" ~ "Problem Set 6", "Quizzes" ~ "Quiz 4"). */
function nameAppearsIn(itemName: string, categoryName: string): boolean {
  const name = categoryName.trim();
  if (!name) return false;
  const stems = new Set([name, name.replace(/zzes$/i, 'z'), name.replace(/es$/i, ''), name.replace(/s$/i, '')]);
  for (const stem of stems) {
    if (!stem) continue;
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(stem)}(?:s|es)?(?![a-z0-9])`, 'i');
    if (re.test(itemName)) return true;
  }
  return false;
}

export function suggestBankTarget(
  itemName: string,
  periods: Array<{ period_id: number; name: string; categories: Array<{ cat_id: number; name: string }> }>,
  recentPeriodId: number | null,
): BankSuggestion | null {
  if (periods.length === 0) return null;
  const recent = recentPeriodId !== null ? periods.find(p => p.period_id === recentPeriodId) : undefined;
  const period = recent ?? periods[0];
  const periodReason = recent
    ? `${period.name} is the period you're currently adding entries to.`
    : `${period.name} is the first period.`;
  const cats = period.categories;
  // A period with no categories has nothing to suggest.
  if (cats.length === 0) return null;

  const pick = (cat: { cat_id: number; name: string }, confidence: 'match' | 'guess', why: string): BankSuggestion => ({
    period_id: period.period_id, period_name: period.name, cat_id: cat.cat_id, cat_name: cat.name,
    confidence, reason: `${why} ${periodReason}`,
  });

  // 1. The category's own name appears in the item name; longest name first so
  //    "Midterm Exam" beats "Exam".
  const byLength = [...cats].sort((a, b) => b.name.length - a.name.length);
  for (const cat of byLength) {
    if (nameAppearsIn(itemName, cat.name)) return pick(cat, 'match', `“${cat.name}” matches the category name.`);
  }

  // 2. A keyword alias whose category family exists in this period.
  for (const alias of CATEGORY_ALIASES) {
    const hit = alias.keywords.find(([, re]) => re.test(itemName));
    if (!hit) continue;
    const cat = cats.find(c => includesAny(c.name.toLowerCase(), alias.category));
    if (cat) return pick(cat, 'match', `“${hit[0]}” matches your ${cat.name} category.`);
  }

  // 3. Nothing matched: the period's first category, flagged as a guess.
  return pick(cats[0], 'guess', `No category matched “${itemName}”, so this is a guess. Check it with Change…`);
}

const LEGACY_LABEL = { activities: 'Activities', quizzes: 'Quizzes', exams: 'Exams' } as const;
const LEGACY_ALIASES: Array<{ target: 'activities' | 'quizzes' | 'exams'; keywords: Array<[string, RegExp]> }> = [
  // Exam first, matching suggestLegacyCategory's "more specific wins" order.
  { target: 'exams', keywords: [['exam', /\bexam/i], ['midterm', /\bmidterm/i], ['final', /\bfinal/i]] },
  { target: 'quizzes', keywords: [['quiz', /\bquiz/i], ['long test', /\blong test/i]] },
  {
    // The legacy activities table has its own "Seatwork" type, so seatwork lands here.
    target: 'activities',
    keywords: [
      ['seatwork', /\bseatwork/i], ['task', /\btask/i], ['data sheet', /\bdata sheet/i], ['report', /\breport/i],
      ['activity', /\bactivit/i], ['lab', /\blab/i], ['output', /\boutput/i], ['assignment', /\bassignment/i],
      ['problem set', /\bproblem set/i], ['ps', /\bps\s?\d/i],
    ],
  },
];

/** Legacy-mode (Activity / Quiz / Exam) counterpart of suggestBankTarget. */
export function suggestLegacyTarget(itemName: string): {
  target: 'activities' | 'quizzes' | 'exams'; confidence: 'match' | 'guess'; reason: string;
} {
  for (const alias of LEGACY_ALIASES) {
    const hit = alias.keywords.find(([, re]) => re.test(itemName));
    if (hit) return { target: alias.target, confidence: 'match', reason: `“${hit[0]}” matches ${LEGACY_LABEL[alias.target]}.` };
  }
  return {
    target: 'activities', confidence: 'guess',
    reason: `No keyword matched “${itemName}”, so this is a guess. Check it with Change…`,
  };
}

// ---------------------------------------------------------------------------------------------
// Announcement notes (spec 2026-10-24 §6.1).
// ---------------------------------------------------------------------------------------------

/** Sentence-initial, case-insensitive, whole-word extra-detail cues. "please bring" comes
 *  before "bring" only for readability; either way the sentence matches. */
const NOTE_CUE = /^(?:please bring|bring|coverage|covers|attendance|wear|prepare|don['’]t forget|do not forget|remember to|materials|requirements|note|reminder that)(?![a-z0-9])/i;

/** A sentence: from a non-space character up to terminal punctuation (plus closing quotes or
 *  brackets) followed by whitespace or the end, or up to a line break, or to the end of the text.
 *  Splitting only before whitespace keeps "3.5" and "e.g.x" intact. */
const SENTENCE = /\S[\s\S]*?(?:[.!?]+["'”’)\]]*(?=\s|$)|(?=\n)|$)/g;

/** Character ranges [start, end) of the extra-detail sentences in `body`, for the highlight. */
export function noteSpans(body: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of body.matchAll(SENTENCE)) {
    const start = m.index ?? 0;
    const text = m[0].trimEnd();
    if (text && NOTE_CUE.test(text)) spans.push([start, start + text.length]);
  }
  return spans;
}

/** Spec §6.1: the extra-detail sentences ("Bring a calculator.", "Coverage: …"), joined by a space; '' when none. */
export function extractAnnouncementNote(body: string): string {
  return noteSpans(body).map(([s, e]) => body.slice(s, e)).join(' ');
}
