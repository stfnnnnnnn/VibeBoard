/**
 * Canvas sends ISO-8601 UTC timestamps ("2026-08-15T10:00:00Z"). MySQL DATETIME columns
 * want "YYYY-MM-DD HH:MM:SS" — the raw ISO form is truncated with a warning on a lax
 * server and is a hard insert error under STRICT_TRANS_TABLES. Converting here (at the
 * single point every Canvas timestamp passes through) also makes the stored value
 * byte-identical to what mysql2 hands back for a DATETIME column with `dateStrings: true`,
 * so downstream stored-vs-fresh comparisons compare like with like, and `.slice(0, 10)`
 * yields a deterministic UTC date rather than one that depends on the server's timezone.
 */
export function toMysqlUtc(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export interface GradeBreakdown {
  /** Percentage (0-100) — what VibeBoard's `grade` columns actually store. */
  grade: number | null;
  /** Raw points earned (Canvas `submission.score`). */
  score: number | null;
  /** Points possible (Canvas `points_possible`). */
  items: number | null;
}

/**
 * Canvas reports raw points (18 out of 20); every VibeBoard consumer of a `grade` column
 * treats it as an already-computed percentage (see `calcGrade` in SubjectCardView). Convert.
 *
 * Takes `unknown` deliberately: these values arrive either as JSON numbers (from Canvas) or
 * as strings (mysql2 returns DECIMAL columns as strings unless `decimalNumbers: true`, which
 * this pool does not set), so both are coerced here rather than at each call site.
 * A missing/zero/non-numeric `points` leaves the whole breakdown null — never NaN or Infinity.
 */
export function gradeBreakdown(score: unknown, points: unknown): GradeBreakdown {
  const s = score  === null || score  === undefined ? null : Number(score);
  const p = points === null || points === undefined ? null : Number(points);
  if (s === null || p === null || !Number.isFinite(s) || !Number.isFinite(p) || p <= 0) {
    return { grade: null, score: null, items: null };
  }
  return { grade: (s / p) * 100, score: s, items: p };
}

export interface NormalizedCourse {
  canvasCourseId: number;
  name:           string;
  courseCode:     string | null;
  term:           string | null;
  workflowState:  string | null;
  startAt:        string | null;
  endAt:          string | null;
}

interface RawCourse {
  id: number;
  name: string;
  course_code?: string;
  term?: { name?: string } | null;
  workflow_state?: string;
  start_at?: string | null;
  end_at?: string | null;
}

export function normalizeCourse(raw: RawCourse): NormalizedCourse {
  return {
    canvasCourseId: raw.id,
    name:           raw.name,
    courseCode:     raw.course_code ?? null,
    term:           raw.term?.name ?? null,
    workflowState:  raw.workflow_state ?? null,
    startAt:        toMysqlUtc(raw.start_at),
    endAt:          toMysqlUtc(raw.end_at),
  };
}

export interface ParsedCourseCode {
  /** e.g. "3rd Trimester" — matches the exact labels subjects.trimester expects. Null if unparseable. */
  termLabel:  string | null;
  /** e.g. "2025-2026". Null if unparseable. */
  schoolYear: string | null;
  /** The bare course code with the term/SY prefix and block suffix stripped, e.g. "CS0061L".
   *  Falls back to the full raw string when the pattern doesn't match. */
  courseCode: string;
  /** Block/section, e.g. "TN3" or "TN37" — null when there's no trailing segment to read.
   *  Anything from a dash onward (e.g. the "-116" in "TN03-116") is dropped; that suffix isn't
   *  part of the block itself. */
  section:    string | null;
}

const TERM_UNIT: Record<string, string> = { S: 'Semester', T: 'Trimester', Q: 'Quarter' };
const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];

/**
 * This school's SIS course codes are "{n}{S|T|Q}SY{yy}{yy}_{course code}_{block section}",
 * e.g. "3TSY2526_CS0061L_TN3" → 3rd Trimester, SY 2025-2026, CS0061L, block TN3. Canvas hands
 * this back verbatim as `course.course_code`. Not every course on the account necessarily
 * follows the scheme (manually created courses, other departments), so a non-matching string
 * falls back to using the raw value as the course code with everything else left null, rather
 * than throwing or mangling it.
 *
 * The course code and block section are split on the *last* underscore rather than assuming a
 * fixed section length — a section like "TN37" comes through whole rather than getting clipped
 * to a hardcoded width, and a course code that itself contains an underscore is still preserved.
 */
export function parseCanvasCourseCode(raw: string | null | undefined): ParsedCourseCode {
  const trimmed = raw?.trim() ?? '';
  const fallback: ParsedCourseCode = { termLabel: null, schoolYear: null, courseCode: trimmed, section: null };
  if (!trimmed) return fallback;

  const prefixMatch = trimmed.match(/^(\d)([STQ])SY(\d{2})(\d{2})_(.+)$/i);
  if (!prefixMatch) return fallback;

  const [, termNum, termUnit, syStart, syEnd, rest] = prefixMatch;
  const splitAt     = rest.lastIndexOf('_');
  const courseCode  = splitAt === -1 ? rest : rest.slice(0, splitAt);
  const rawSection  = splitAt === -1 ? null : rest.slice(splitAt + 1);
  const section     = rawSection ? rawSection.split('-')[0] : null;

  return {
    termLabel:  `${ORDINAL[Number(termNum)] ?? `${termNum}th`} ${TERM_UNIT[termUnit.toUpperCase()] ?? termUnit.toUpperCase()}`,
    schoolYear: `20${syStart}-20${syEnd}`,
    courseCode: courseCode || trimmed,
    section,
  };
}

export interface NormalizedAssignment {
  canvasAssignmentId:     number;
  canvasCourseId:         number;
  name:                   string;
  dueAt:                  string | null;
  pointsPossible:         number | null;
  htmlUrl:                string | null;
  canvasUpdatedAt:        string;
  submissionStatus:       string | null;
  submissionScore:        number | null;
  submissionSubmittedAt:  string | null;
}

interface RawSubmission {
  workflow_state?: string;
  score?: number | null;
  submitted_at?: string | null;
}

interface RawAssignment {
  id: number;
  course_id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  html_url?: string;
  updated_at: string;
  submission?: RawSubmission;
}

export function normalizeAssignment(raw: RawAssignment): NormalizedAssignment {
  return {
    canvasAssignmentId:    raw.id,
    canvasCourseId:        raw.course_id,
    name:                  raw.name,
    dueAt:                 toMysqlUtc(raw.due_at),
    pointsPossible:        raw.points_possible ?? null,
    htmlUrl:               raw.html_url ?? null,
    // canvas_updated_at is NOT NULL in the schema; fall back to the raw value only if
    // Canvas ever sends something unparseable (it shouldn't) rather than inserting null.
    canvasUpdatedAt:       toMysqlUtc(raw.updated_at) ?? raw.updated_at,
    submissionStatus:      raw.submission?.workflow_state ?? null,
    submissionScore:       raw.submission?.score ?? null,
    submissionSubmittedAt: toMysqlUtc(raw.submission?.submitted_at),
  };
}

export interface NormalizedAnnouncement {
  canvasAnnouncementId: number;
  title:                string;
  message:              string | null;
  htmlUrl:              string | null;
  postedAt:             string | null;
  canvasUpdatedAt:      string;
}

interface RawAnnouncement {
  id: number;
  title: string;
  message?: string | null;
  html_url?: string;
  posted_at?: string | null;
  updated_at?: string | null;
}

/**
 * Canvas discussion topics (announcements are discussion topics with only_announcements=true)
 * don't reliably echo updated_at, so posted_at is the fallback — canvas_updated_at is NOT NULL
 * in the schema and must always get a real value.
 */
export function normalizeAnnouncement(raw: RawAnnouncement): NormalizedAnnouncement {
  return {
    canvasAnnouncementId: raw.id,
    title:           raw.title,
    message:         raw.message ?? null,
    htmlUrl:         raw.html_url ?? null,
    postedAt:        toMysqlUtc(raw.posted_at),
    canvasUpdatedAt: toMysqlUtc(raw.updated_at ?? raw.posted_at)
      ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
}
