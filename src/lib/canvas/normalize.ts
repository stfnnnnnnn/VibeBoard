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
    startAt:        raw.start_at ?? null,
    endAt:          raw.end_at ?? null,
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
    dueAt:                 raw.due_at ?? null,
    pointsPossible:        raw.points_possible ?? null,
    htmlUrl:               raw.html_url ?? null,
    canvasUpdatedAt:       raw.updated_at,
    submissionStatus:      raw.submission?.workflow_state ?? null,
    submissionScore:       raw.submission?.score ?? null,
    submissionSubmittedAt: raw.submission?.submitted_at ?? null,
  };
}
