'use client';

// Types only — `workItems.ts` imports `@/lib/db` (mysql2) at module scope.
import type { ProjectSummary } from '@/lib/workboard/workItems';
import { FIELD_INPUT } from './dialogStyles';
import { Field } from './SharedFields';

/** Path 3, "New independent activity": an owned row, the only academic path with a project column. */
export default function AcademicIndependent({
  chosenCourseId, projects, projectId, setProjectId,
}: {
  chosenCourseId: number | null;
  projects: ProjectSummary[];
  projectId: number | ''; setProjectId: (v: number | '') => void;
}) {
  // Filtered by context and course, so one course's projects never show under another.
  const academicProjects = chosenCourseId === null
    ? []
    : projects.filter(p => p.context === 'academic' && p.user_subject_id === chosenCourseId);
  // An item being edited can carry a `project_id` this filter would never offer. A `<select
  // value>` matching no `<option>` would display "No project" and misreport a value that is
  // still submitted, so it is surfaced as its own disabled option instead.
  const outOfScope = projectId !== '' && !academicProjects.some(p => p.id === projectId)
    ? projects.find(p => p.id === projectId)
    : undefined;

  return (
    <Field
      label="Academic project"
      hint={
        outOfScope
          ? 'This project isn’t part of the chosen course. Pick “No project” to clear it.'
          : chosenCourseId === null
            ? 'Optional. Choose a course first — projects are listed per course.'
            : academicProjects.length === 0
              ? 'Optional. This course has no projects yet.'
              : 'Optional. Only this course’s projects are listed.'
      }
    >
      <select
        className="wb-focus-ring"
        style={FIELD_INPUT}
        value={projectId === '' ? '' : String(projectId)}
        disabled={chosenCourseId === null || (academicProjects.length === 0 && !outOfScope)}
        onChange={e => setProjectId(e.target.value === '' ? '' : Number(e.target.value))}
      >
        <option value="">No project</option>
        {outOfScope && (
          <option value={outOfScope.id} disabled>{outOfScope.name} (not in this course)</option>
        )}
        {academicProjects.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </Field>
  );
}
