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
