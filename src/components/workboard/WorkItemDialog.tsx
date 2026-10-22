'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
// Types only — `workItems.ts` imports `@/lib/db` (mysql2) at module scope, so a runtime
// import from it here would drag mysql2 into this client component's bundle (the landmine
// that broke `/workboard` twice before; see WorkItemRow.tsx's own note on the same rule).
// `WorkContext`/`LifeArea` come from the pool-free `workContexts.ts` instead.
import type { WorkItem, WorkPriority, WorkStatus, ProjectSummary } from '@/lib/workboard/workItems';
// Same rule, same reason: `organizations.ts` imports `@/lib/db` at module scope, so this
// stays `import type` — erased at compile time, so no mysql2 reaches the client bundle.
import type { OrganizationSummary } from '@/lib/workboard/organizations';
import type { WorkContext, LifeArea } from '@/lib/workboard/workContexts';
import WbOverlay from './ui/WbOverlay';
import type {
  AcademicSourcePath, LegacyTarget, LinkableItem, GradingPeriod, SubjectGrading, SubjectOption,
  FormError, FormErrorField,
} from './dialog/dialogTypes';
import { FIELD_GROUP } from './dialog/dialogStyles';
import {
  AcademicEditFields, TitleContextFields, OrganizationFields, ProjectFields, LifeFields, ScheduleFields,
} from './dialog/SharedFields';
import { AcademicSourceStep, AcademicCourseField } from './dialog/TypeStep';
import AcademicLinkExisting from './dialog/AcademicLinkExisting';
import AcademicNewGraded from './dialog/AcademicNewGraded';
import AcademicIndependent from './dialog/AcademicIndependent';

export type DialogTarget =
  /** `initialTitle` pre-fills the title (the Ctrl+K palette's "New task …"). */
  | { mode: 'create'; initialTitle?: string }
  | { mode: 'edit'; item: WorkItem };

export interface WorkItemDialogProps {
  /** false while the shell's `usePresence` keeps the dialog mounted for its exit transition. */
  open:              boolean;
  /** Opened from the keyboard: no enter animation (spec 4.3). */
  instant?:          boolean;
  target:            DialogTarget;
  /** `work.projects` from the shell — kept in sync locally via `onProjectCreated` so an
   *  inline-created project shows up in the select without waiting for a full refetch.
   *  Read by all three project-bearing branches of `renderContextFields`, each filtering it
   *  by context (and, for Academic and Organization, by parent) rather than by a list of
   *  its own: one payload, three views of it. */
  projects:          ProjectSummary[];
  onClose:           () => void;
  /** Called after a successful create/update so the shell can `refreshWork()`. */
  onSaved:           () => void | Promise<void>;
  onProjectCreated:  (project: ProjectSummary) => void;
}

const BANNER_STYLE: React.CSSProperties = {
  margin: 0, padding: '10px 12px', borderRadius: 'var(--wb-r-md)',
  background: 'var(--wb-danger-bg)', color: 'var(--wb-danger)', font: '600 var(--wb-fs-13) var(--wb-font-ui)',
};

export default function WorkItemDialog({ open, instant = false, target, projects, onClose, onSaved, onProjectCreated }: WorkItemDialogProps) {
  const editingItem = target.mode === 'edit' ? target.item : null;
  const isAcademicEdit = editingItem !== null && editingItem.source !== 'owned';

  const [title, setTitle]                     = useState(target.mode === 'create' ? target.initialTitle ?? '' : target.item.title);
  // Create mode starts with NO context selected — the per-context section renders nothing
  // until one is picked, so the modal opens short and grows (progressive disclosure). An
  // item being edited always has a context already, so edit mode pre-fills from it.
  const [context, setContext]                 = useState<WorkContext | ''>(editingItem?.category ?? '');
  // Kept current by the effect below so an in-flight async callback — `handleCreateProject`
  // is the one case in this file that outlives a possible context switch — can ask "is the
  // user still where I started?" after an `await`. `context` itself can't answer that: it is
  // a value this closure captured at the moment it was created, not a live read.
  const contextRef = useRef(context);
  const [projectId, setProjectId]             = useState<number | ''>(editingItem?.project_id ?? '');
  const [subjectId, setSubjectId]             = useState<number | ''>(editingItem?.user_subject_id ?? '');
  const [priority, setPriority]               = useState<WorkPriority>(editingItem?.priority ?? 'normal');
  const [workStatus, setWorkStatus]           = useState<WorkStatus>(editingItem?.work_status ?? 'todo');
  const [dueAt, setDueAt]                     = useState(editingItem?.due_at ? editingItem.due_at.slice(0, 10) : '');
  // The deadline's time-of-day, stored as "HH:MM:SS" and sliced to the "HH:MM" a native
  // <input type="time"> renders — the same shape-matching `dueAt` does one line up. Common,
  // not per-context (like `dueAt`/`startDate`/`priority`), so it is deliberately absent from
  // `handleContextChange`: a deadline means the same thing in all four contexts, and
  // clearing it on a context switch would silently discard a time the user had set.
  const [deadlineTime, setDeadlineTime]       = useState(editingItem?.deadline_time ? editingItem.deadline_time.slice(0, 5) : '');
  const [startDate, setStartDate]             = useState(editingItem?.start_date ?? '');
  const [estimatedHours, setEstimatedHours]   = useState(editingItem?.estimated_hours != null ? String(editingItem.estimated_hours) : '');
  const [note, setNote]                       = useState(editingItem?.note ?? '');

  const [subjects, setSubjects]               = useState<SubjectOption[] | null>(null);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [subjectsError, setSubjectsError]     = useState<string | null>(null);

  // An item that already exists as an owned row can only ever be an independent activity:
  // the other two paths describe how a *new* academic item comes into being, and neither is
  // reachable for a row that is already here (you cannot retroactively turn an owned row
  // into a Study Pulse entry, and "link an existing item" creates nothing to edit). So edit
  // mode starts — and resets — on that path, and hides the selector entirely.
  const defaultAcademicSource: AcademicSourcePath | '' = target.mode === 'edit' ? 'independent' : '';

  // Every piece of academic-branch state below is per-context and therefore reset in
  // `handleContextChange`.
  const [academicSource, setAcademicSource]   = useState<AcademicSourcePath | ''>(defaultAcademicSource);
  /** `${source}:${id}` of the item chosen on the "Link an existing item" path, or ''. */
  const [linkedItemKey, setLinkedItemKey]     = useState('');
  /** Path 1's picker rows, cached per `user_subject_id` — see the lazy fetch below. */
  const [linkableItems, setLinkableItems]     = useState<Record<number, LinkableItem[]>>({});
  const [linkableLoading, setLinkableLoading] = useState<number | null>(null);
  const [linkableError, setLinkableError]     = useState<string | null>(null);

  // Path 2's target picker. Which of the three controls below is live depends on the chosen
  // course's grading mode, so all three are held at once and only the mode's own are read.
  /** Legacy mode's target. A closed three-value union with a real default, so "nothing
   *  picked" is unrepresentable here — the only way to reach Create with no target is for
   *  `subjectGrading` to be missing, which `handleSubmit` guards separately. */
  const [gradingTarget, setGradingTarget]     = useState<LegacyTarget>('activities');
  const [gradingPeriodId, setGradingPeriodId] = useState<number | ''>('');
  const [gradingCatId, setGradingCatId]       = useState<number | ''>('');
  /** Grading config cached per `user_subject_id`, same shape and same role as
   *  `linkableItems`: the picker's data *and* the lazy fetch's loop guard.
   *
   *  There is deliberately no `gradingLoading` companion to `linkableLoading`. "In flight"
   *  is exactly "not in this cache and not failed", and *deriving* it rather than storing it
   *  closes the gap a stored flag leaves open: the effect that sets the flag runs after the
   *  paint that follows picking a course, so a stored flag reads false — i.e. "loaded" — for
   *  one frame on a course nothing has been fetched for yet. */
  const [subjectGrading, setSubjectGrading]   = useState<Record<number, SubjectGrading>>({});
  const [gradingError, setGradingError]       = useState<string | null>(null);

  // The organization branch. `organizationId` is per-context and therefore reset in
  // `handleContextChange`; the fetched list below deliberately is not — see the effect.
  const [organizationId, setOrganizationId]   = useState<number | ''>(editingItem?.organization_id ?? '');
  const [organizations, setOrganizations]     = useState<OrganizationSummary[] | null>(null);
  const [orgsLoading, setOrgsLoading]         = useState(false);
  const [orgsError, setOrgsError]             = useState<string | null>(null);

  // The inline "＋ New organization…" form, the same four pieces (open / name / in-flight /
  // error) `showNewProject` and friends below use, for the same flow.
  const [showNewOrg, setShowNewOrg]           = useState(false);
  const [newOrgName, setNewOrgName]           = useState('');
  const [creatingOrg, setCreatingOrg]         = useState(false);
  const [orgError, setOrgError]               = useState<string | null>(null);

  const [showNewProject, setShowNewProject]   = useState(false);
  const [newProjectName, setNewProjectName]   = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectError, setProjectError]       = useState<string | null>(null);

  // The life branch, in its entirety: one optional area. `LIFE_AREAS` is a static constant,
  // not a database-backed list, so unlike Course / Organization / Project there is nothing
  // to fetch, nothing to cache, and no loading or error state to hold — which is exactly
  // spec §15's point that Life stays lightweight. Per-context like the rest, so it is reset
  // in `handleContextChange`.
  const [lifeArea, setLifeArea]               = useState<LifeArea | ''>(editingItem?.life_area ?? '');

  const [submitting, setSubmitting]           = useState(false);
  const [formError, setFormError]             = useState<FormError | null>(null);

  const firstFieldRef = useRef<HTMLInputElement & HTMLSelectElement>(null);

  useEffect(() => { contextRef.current = context; }, [context]);

  // A new error can land below the fold of a scrolled panel: focus the invalid control when
  // there is one, otherwise bring the message (or the network banner) into view.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!formError || !form) return;
    const msg = form.querySelector<HTMLElement>('[data-field-error]') ?? form.querySelector<HTMLElement>('[role="alert"]');
    if (!msg) return;
    const control = formError.field === 'form' ? null : msg.parentElement?.querySelector<HTMLElement>(
      'input:not([disabled]),select:not([disabled]),textarea:not([disabled])',
    );
    if (control) control.focus();
    else msg.scrollIntoView({ block: 'nearest' });
  }, [formError]);

  // The Course list, fetched only when it can actually be shown. Task 25 removed the field
  // this fed and left the request firing unconditionally on mount for every context; now
  // that the academic branch below is the one and only reader, it is gated on
  // `context === 'academic'`. An academic-*sourced* item never needs the list at all (its
  // course is fixed by its Study Pulse row), hence the `isAcademicEdit` bail as well.
  //
  // Fires on the transition into the academic context — the moment Context is set to
  // Academic (create mode), or on mount for an owned academic item being edited — and at
  // most once per dialog: `subjects !== null` short-circuits the re-run this effect's own
  // `setSubjects` triggers, so leaving Academic and coming back reuses the loaded list.
  useEffect(() => {
    if (isAcademicEdit || context !== 'academic' || subjects !== null) return;
    let cancelled = false;
    setSubjectsLoading(true);
    // Clear a previous attempt's message: a failed fetch leaves `subjects` null, so leaving
    // Academic and coming back retries — and a retry that succeeds must not still be
    // apologising underneath a working Course list.
    setSubjectsError(null);
    fetch('/api/studypulse/subjects')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: SubjectOption[]) => { if (!cancelled) setSubjects(data); })
      .catch(() => { if (!cancelled) setSubjectsError('Could not load subjects.'); })
      .finally(() => { if (!cancelled) setSubjectsLoading(false); });
    return () => { cancelled = true; };
  }, [isAcademicEdit, context, subjects]);

  // Path 1's picker: the items the chosen course ALREADY contributes to the board.
  //
  // There is no endpoint that returns one subject's activities/quizzes/exams/grade entries
  // as JSON — Study Pulse's subject page is a server component that queries the DB directly
  // — so this self-fetches the board's own payload, the same `/api/workboard/work` the shell
  // loads, and filters it client-side by context and course. No new route, no prop threading.
  //
  // Cached per course id. That cache is also the loop guard: this effect writes
  // `linkableItems`, which it depends on, and the `linkableItems[subjectId]` check makes the
  // resulting re-run a no-op. Re-picking a course it has already loaded costs nothing.
  // Pulled out of the effect so a failed load can be retried directly: re-selecting the
  // course that just failed fires no `change` event (it is already the selected value), so
  // the effect below — keyed on `subjectId` — would otherwise never run again for it. The
  // effect and the "Try again" button both call this; only the effect's invocation can be
  // cancelled by an unmount or a course switch, since only it can be interrupted that way.
  function loadLinkableItems(courseId: number, cancelledRef?: { current: boolean }) {
    setLinkableLoading(courseId);
    setLinkableError(null);
    fetch('/api/workboard/work')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { items?: WorkItem[] }) => {
        if (cancelledRef?.current) return;
        const rows: LinkableItem[] = (data.items ?? [])
          .filter(i => i.context === 'academic' && i.user_subject_id === courseId)
          .map(i => ({ key: `${i.source}:${i.id}`, source: i.source, id: i.id, title: i.title, due_at: i.due_at }));
        setLinkableItems(prev => ({ ...prev, [courseId]: rows }));
      })
      .catch(() => { if (!cancelledRef?.current) setLinkableError('Could not load this course’s items.'); })
      .finally(() => { if (!cancelledRef?.current) setLinkableLoading(null); });
  }

  useEffect(() => {
    if (context !== 'academic' || academicSource !== 'link' || subjectId === '') return;
    if (linkableItems[subjectId]) return;
    const cancelledRef = { current: false };
    loadLinkableItems(subjectId, cancelledRef);
    return () => { cancelledRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, academicSource, subjectId, linkableItems]);

  // Path 2's grading config: which of the two target pickers the chosen course gets, and
  // — in custom mode — the periods and categories to fill it with.
  //
  // Same shape as `loadLinkableItems` above, for the same reasons: cached per course id so
  // the effect that calls it cannot loop, pulled out of that effect so a failed load can be
  // retried by a button (re-picking the course that just failed fires no `change` event),
  // and cancellable only from the effect, since only the effect can be interrupted by a
  // course switch or an unmount.
  //
  // A failure deliberately writes NOTHING into the cache. Storing a `{ mode: 'legacy' }`
  // fallback would render the Activity/Quiz/Exam select for a custom-mode subject — a
  // confident, wrong answer whose every submission the create route rejects.
  function loadSubjectGrading(courseId: number, cancelledRef?: { current: boolean }) {
    setGradingError(null);
    fetch(`/api/studypulse/subjects/${courseId}/grading`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { config?: { preset?: { periods?: GradingPeriod[] } | null } | null }) => {
        if (cancelledRef?.current) return;
        // `config: null` (no `subject_grading` row) and a config whose `preset` came back
        // null (a row pointing at a preset that no longer exists) are both legacy — the
        // second is why this tests `preset`, not `config`. See `SubjectGrading`.
        const preset  = data.config?.preset ?? null;
        const grading: SubjectGrading = preset
          ? { mode: 'custom', periods: preset.periods ?? [] }
          : { mode: 'legacy', periods: [] };
        setSubjectGrading(prev => ({ ...prev, [courseId]: grading }));
      })
      .catch(() => { if (!cancelledRef?.current) setGradingError('Could not load this course’s grading setup.'); });
  }

  useEffect(() => {
    if (context !== 'academic' || academicSource !== 'graded' || subjectId === '') return;
    if (subjectGrading[subjectId]) return;
    const cancelledRef = { current: false };
    loadSubjectGrading(subjectId, cancelledRef);
    return () => { cancelledRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, academicSource, subjectId, subjectGrading]);

  // The Organization list, on exactly the terms the Course list above is fetched on: lazily,
  // only for the context that can show it, and at most once per dialog (`organizations !==
  // null` short-circuits the re-run this effect's own `setOrganizations` triggers, so leaving
  // Organization and coming back reuses the loaded list — and so does an inline-created
  // organization appended to it, which a refetch would have clobbered).
  //
  // Self-fetched rather than threaded down from `WorkboardShell` as `projects` is, because
  // the shell has no reason to hold a list only this branch reads — the same call this file
  // already makes three times (subjects, path 1's linkable items, path 2's grading config).
  // Nothing has to be told about an inline-created organization either: `onSaved()` refreshes
  // the shell's whole payload the moment a successful submit closes the dialog.
  //
  // Unlike the two course-scoped loads, this one has no prior selection to wait for —
  // organizations are the top of this branch's chain, so `context` alone gates it.
  useEffect(() => {
    if (context !== 'organization' || organizations !== null) return;
    let cancelled = false;
    setOrgsLoading(true);
    // Same reason the subjects fetch clears its message first: a failure leaves the list
    // null, so re-entering Organization retries, and a retry that succeeds must not still be
    // apologising above a working picker.
    setOrgsError(null);
    fetch('/api/workboard/organizations')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      // This route wraps its list (`{ organizations }`), where `/api/studypulse/subjects`
      // returns a bare array — hence the unwrap the subjects fetch above does not need.
      .then((data: { organizations?: OrganizationSummary[] }) => {
        if (!cancelled) setOrganizations(data.organizations ?? []);
      })
      .catch(() => { if (!cancelled) setOrgsError('Could not load organizations.'); })
      .finally(() => { if (!cancelled) setOrgsLoading(false); });
    return () => { cancelled = true; };
  }, [context, organizations]);

  /**
   * The single seam where switching context clears the outgoing context's fields.
   *
   * Without it, editing a Projects item and switching it to Life would keep the populated
   * `projectId` in state and save a project reference onto a Life item — an invalid
   * combination the service layer would reject, or worse, silently persist.
   *
   * All four branches now have their state listed below, and that completeness is the
   * point: every per-context field must appear here, or it leaks across a context switch.
   * Anything a future branch adds belongs in this list in the same edit that adds it —
   * including a field with no child to invalidate, so that an audit of this function can
   * see every context accounted for rather than having to prove an absence elsewhere.
   * Task 26 added the five academic-branch values, 28 the organization ones and 30 the
   * life area; the project and subject ids predate them all.
   */
  function handleContextChange(next: WorkContext | '') {
    setContext(next);
    setProjectId('');
    setSubjectId('');
    // Also drop any half-finished inline "new project" entry — it belonged to the
    // context being left behind.
    setShowNewProject(false);
    setNewProjectName('');
    setProjectError(null);
    // The academic branch. The cached picker rows go too: they are keyed by course, and a
    // context switch is exactly the moment a stale answer to "what does this course already
    // have?" stops being worth holding on to.
    setAcademicSource(defaultAcademicSource);
    setLinkedItemKey('');
    setLinkableItems({});
    setLinkableLoading(null);
    setLinkableError(null);
    // Path 2's target picker, cache included — for the same reason path 1's rows go: it is
    // keyed by course, and leaving Academic is exactly when a stale answer to "how is this
    // course graded?" stops being worth holding.
    resetGradedTarget();
    setSubjectGrading({});
    // The organization branch. The selection goes because an `organization_id` on a Life or
    // Academic row is exactly the invalid combination this seam exists to prevent, and the
    // half-finished inline entry goes with it, like the project one above. The fetched list
    // itself stays: it is the user's organizations, not an answer scoped to the context
    // being left, so it is still correct on the way back in (and re-fetching it would drop
    // an organization created inline moments ago).
    setOrganizationId('');
    setShowNewOrg(false);
    setNewOrgName('');
    setOrgError(null);
    // The life branch. Nothing hangs off Area the way a project hangs off a course or an
    // organization, so there is no child selection here to invalidate — this reset exists so
    // that every per-context field is accounted for in one place, and so a `life_area` can
    // never ride out of Life onto a row of another context (the submit body gates it on the
    // context as well, the same belt-and-braces `organization_id` gets).
    setLifeArea('');
    // A validation message raised by the outgoing context ("Please choose a course.") names
    // a field that no longer exists once the context changes — it goes with its fields.
    setFormError(null);
  }

  /** Path 2's *picked* target, which is scoped to one course's grading setup and is
   *  therefore invalid the moment the course, the source path, or the context changes. The
   *  cached configs are deliberately NOT cleared here: they are keyed per course and stay
   *  correct across all three, exactly like `linkableItems`. */
  function resetGradedTarget() {
    setGradingTarget('activities');
    setGradingPeriodId('');
    setGradingCatId('');
    setGradingError(null);
  }

  /** Switching source path clears anything the outgoing path owned — the same rule as
   *  `handleContextChange`, one level down. `projectId` is dropped for every path but
   *  `independent`, the only one whose row has a column to hold it. */
  function handleAcademicSourceChange(next: AcademicSourcePath) {
    setAcademicSource(next);
    setLinkedItemKey('');
    setLinkableError(null);
    // Unconditional, like `setLinkedItemKey` above: leaving 'graded' must drop a target the
    // other two paths cannot submit, and arriving on 'graded' must start clean rather than
    // on whatever a previous visit left behind.
    resetGradedTarget();
    setFormError(null);
    if (next !== 'independent') setProjectId('');
  }

  /** Every value cleared here is scoped to a course: an item belonging to the old course, a
   *  project that is filtered by it, and a graded target — a `period_id`/`cat_id` naming a
   *  period in the *old* course's preset, which the create route rejects outright, and a
   *  legacy Activity/Quiz/Exam the new course may not even offer. None may survive. */
  function handleSubjectChange(next: number | '') {
    setSubjectId(next);
    setLinkedItemKey('');
    setProjectId('');
    setLinkableError(null);
    resetGradedTarget();
  }

  /** The organization-side twin of `handleSubjectChange`, and the same rule one context
   *  over: the Project / Initiative list below is filtered by `organization_id`, so a
   *  project chosen under the outgoing organization belongs to a different parent the
   *  moment this changes. Left in place it would be submitted — a perfectly storable
   *  `project_id`/`organization_id` pair that describes something the user never chose,
   *  and which nothing downstream would flag as wrong. */
  function handleOrganizationChange(next: number | '') {
    setOrganizationId(next);
    setProjectId('');
  }

  /** Categories belong to a period, so a category picked under the outgoing period is not
   *  merely stale — it names a row the create route's ownership join will refuse. Clearing
   *  it is what makes the second select's emptiness honest rather than a hidden mismatch. */
  function handleGradingPeriodChange(next: number | '') {
    setGradingPeriodId(next);
    setGradingCatId('');
  }

  /** The message for one field, or null — validation errors render under their field. */
  function fieldError(field: FormErrorField): string | null {
    return formError?.field === field ? formError.message : null;
  }

  /**
   * The Academic branch: the path step, the shared Course select, then the chosen path.
   * NO HOOKS — see `renderContextFields`'s note.
   */
  function renderAcademicFields(): React.ReactNode {
    const path            = academicSource;
    const chosenCourseId  = subjectId === '' ? null : subjectId;
    const courseRows      = chosenCourseId === null ? undefined : linkableItems[chosenCourseId];
    const loadingRows     = chosenCourseId !== null && linkableLoading === chosenCourseId;
    const pickedItem      = (courseRows ?? []).find(r => r.key === linkedItemKey) ?? null;
    // Once an item is chosen the course is no longer a choice — it is a fact about that
    // item. Clearing the item in the picker unlocks it again.
    const courseLocked    = path === 'link' && pickedItem !== null;
    const courseGrading   = chosenCourseId === null ? undefined : subjectGrading[chosenCourseId];

    return (
      <>
        {target.mode === 'create' && (
          <AcademicSourceStep path={path} onChange={handleAcademicSourceChange} error={fieldError('academicSource')} />
        )}

        {path !== '' && (
          <>
            <AcademicCourseField
              subjectId={subjectId}
              subjects={subjects}
              subjectsLoading={subjectsLoading}
              subjectsError={subjectsError}
              courseLocked={courseLocked}
              onSubjectChange={handleSubjectChange}
              error={fieldError('course')}
            />

            {path === 'link' && (
              <AcademicLinkExisting
                chosenCourseId={chosenCourseId}
                courseRows={courseRows}
                loadingRows={loadingRows}
                linkableError={linkableError}
                linkedItemKey={linkedItemKey}
                setLinkedItemKey={setLinkedItemKey}
                pickedItem={pickedItem}
                onRetry={courseId => loadLinkableItems(courseId)}
              />
            )}

            {path === 'graded' && (
              <AcademicNewGraded
                chosenCourseId={chosenCourseId}
                gradingError={gradingError}
                courseGrading={courseGrading}
                gradingTarget={gradingTarget}
                setGradingTarget={setGradingTarget}
                gradingPeriodId={gradingPeriodId}
                onGradingPeriodChange={handleGradingPeriodChange}
                gradingCatId={gradingCatId}
                setGradingCatId={setGradingCatId}
                onRetry={courseId => loadSubjectGrading(courseId)}
                error={fieldError('grading')}
              />
            )}

            {path === 'independent' && (
              <AcademicIndependent
                chosenCourseId={chosenCourseId}
                projects={projects}
                projectId={projectId}
                setProjectId={setProjectId}
              />
            )}
          </>
        )}
      </>
    );
  }

  /**
   * The per-context section. Called conditionally (`context !== '' && renderContextFields(context)`),
   * so this function — and `renderAcademicFields` — must never contain a hook. Declare new
   * per-context state with the other `useState` calls at the top of the component instead, and
   * reset it in `handleContextChange` above — a hook written in here would typecheck cleanly
   * (there is no ESLint config in this repo to catch it) and only fail at runtime.
   */
  function renderContextFields(context: WorkContext): React.ReactNode {
    if (context === 'academic') return renderAcademicFields();
    if (context === 'organization') {
      return (
        <OrganizationFields
          projects={projects}
          projectId={projectId}
          setProjectId={setProjectId}
          organizationId={organizationId}
          organizations={organizations}
          orgsLoading={orgsLoading}
          orgsError={orgsError}
          onOrganizationChange={handleOrganizationChange}
          showNewOrg={showNewOrg}
          setShowNewOrg={setShowNewOrg}
          newOrgName={newOrgName}
          setNewOrgName={setNewOrgName}
          creatingOrg={creatingOrg}
          orgError={orgError}
          onCreateOrganization={handleCreateOrganization}
          onCancelNewOrg={() => { setShowNewOrg(false); setNewOrgName(''); setOrgError(null); }}
        />
      );
    }
    if (context === 'project') {
      return (
        <ProjectFields
          projects={projects}
          projectId={projectId}
          setProjectId={setProjectId}
          showNewProject={showNewProject}
          setShowNewProject={setShowNewProject}
          newProjectName={newProjectName}
          setNewProjectName={setNewProjectName}
          creatingProject={creatingProject}
          projectError={projectError}
          onCreateProject={handleCreateProject}
          onCancelNewProject={() => { setShowNewProject(false); setNewProjectName(''); setProjectError(null); }}
          error={fieldError('project')}
        />
      );
    }
    if (context === 'life') return <LifeFields lifeArea={lifeArea} setLifeArea={setLifeArea} />;
    return null;
  }
  async function parseErrorMessage(res: Response): Promise<string> {
    try {
      const data = await res.json();
      if (typeof data?.error === 'string') return data.error;
    } catch { /* fall through */ }
    return `Something went wrong (${res.status}).`;
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setCreatingProject(true);
    setProjectError(null);
    try {
      const res = await fetch('/api/workboard/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProjectError(typeof data.error === 'string' ? data.error : 'Failed to create project.');
        return;
      }
      // The POST above sends only `{ name }`, so the server defaults it to a plain
      // `context: 'project'` project with no parent — this literal has to describe
      // whatever the server actually stored, not the shape a later task's inline-creation
      // call here might send instead.
      //
      // Task 29 settled the open question this comment used to carry: the Projects branch
      // is this function's one and only caller, and "creates with `context: 'project'` and
      // no parent" is exactly what that branch wants, so neither the body nor this literal
      // needed widening. Anything that ever does need a parent (an academic or organization
      // project created inline) must send it AND mirror it here, in the same edit.
      const created: ProjectSummary = {
        id: data.project_id, name, color: null, status: 'active',
        context: 'project', user_subject_id: null, organization_id: null,
      };
      // The project now genuinely exists, so the shell always learns about it — but the
      // three lines below are only meaningful for *this* branch's own selection, and the
      // user may have switched Context away from Projects while the POST was in flight
      // (the Task 29 review found this: nothing previously stopped a stale `projectId`
      // from landing on whatever context the user had moved on to, since `project_id` is
      // the one submit-body field not gated on context — unlike `user_subject_id` and
      // `organization_id`, which are). `context` itself can't answer "did it change since
      // this function started" — it's the value this closure captured at call time — so
      // this reads the ref the effect above keeps live instead.
      onProjectCreated(created);
      if (contextRef.current === 'project') {
        setProjectId(created.id);
        setShowNewProject(false);
        setNewProjectName('');
      }
    } finally {
      setCreatingProject(false);
    }
  }

  /**
   * Inline organization creation — `handleCreateProject`'s shape one context over, with two
   * deliberate differences:
   *
   *  - the created row is appended to this dialog's OWN list, not handed to the shell.
   *    There is no `onOrganizationCreated` because there is nothing upstream holding an
   *    organization list to keep in sync: `onSaved()` refreshes the shell's whole payload
   *    the moment the submit that follows succeeds.
   *  - the failure path goes through `parseErrorMessage`, so the route's own sentence
   *    ("You already have an organization with that name", its 400 on a duplicate) reaches
   *    the user unaltered instead of being flattened into a generic "Failed to create".
   */
  async function handleCreateOrganization() {
    const name = newOrgName.trim();
    if (!name) return;
    setCreatingOrg(true);
    setOrgError(null);
    try {
      const res = await fetch('/api/workboard/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        // Read before the success branch touches the body: a `Response` can only be
        // consumed once, and only one of the two branches ever does.
        setOrgError(await parseErrorMessage(res));
        return;
      }
      const data = await res.json().catch(() => ({}));
      // This literal has to describe what the server actually stored. The POST sends only
      // `{ name }`, and `createOrganization` inserts exactly that — `status` defaults to
      // 'active' in the schema.
      const created: OrganizationSummary = { id: data.organization_id, name, status: 'active' };
      setOrganizations(prev => [...(prev ?? []), created]);
      // Through the change handler, not `setOrganizationId`: selecting a brand-new
      // organization has to drop any project held from the previous one, which by
      // definition cannot belong to an organization created a moment ago.
      handleOrganizationChange(created.id);
      setShowNewOrg(false);
      setNewOrgName('');
    } finally {
      setCreatingOrg(false);
    }
  }

  /** "Link an existing item" is the one path with no write behind it. The academic overlay
   *  table `workboard_entry_meta` has no `project_id`/`organization_id` column, so a
   *  Study-Pulse-sourced item cannot be attached to anything here — there is genuinely
   *  nothing to submit, and the footer offers acknowledgement ("Done") instead of Create. */
  const isLinkExistingPath = context === 'academic' && academicSource === 'link';

  /** Path 2 writes a real Study Pulse row through POST /api/workboard/academic/create — a
   *  third kind of request `handleSubmit` can make, alongside the academic-edit PATCH and
   *  the owned-item POST/PATCH. It has its own body, its own endpoint and its own guards,
   *  and it must never reach the owned-item body below: that would quietly store an
   *  independent activity — a Workboard-only row, byte-for-byte what path 3 produces — for
   *  a user who asked for something that counts toward their grade. */
  const isNewGradedPath = context === 'academic' && academicSource === 'graded';

  /** Paths 2 and 3 each write a row that hangs off a course, so Course is required for
   *  both. Path 1 is excluded because it writes nothing at all (it returns before this is
   *  read), and academic *edit* is excluded separately below: its course is fixed by its
   *  Study Pulse row and it renders no Course input to satisfy a guard with. */
  const requiresCourse = context === 'academic'
    && (academicSource === 'graded' || academicSource === 'independent');

  /** Projects work hangs off a project, always — spec §14, and the whole point of Task 29.
   *  Unconditional on the context, unlike `requiresCourse`: this context has one shape, not
   *  three, and both create and edit write the same owned row through the same POST/PATCH.
   *
   *  The Project select deliberately carries no native `required` attribute to go with this.
   *  Title has both because native `required` is the universal convention for a text input;
   *  the closest analogue to this field is Academic's equally-required Course select, which
   *  is enforced by its JS guard alone — and two required selects in one dialog reporting
   *  the same mistake two different ways (a browser bubble here, the form's own red message
   *  there) is a worse trade than the redundancy is worth. The guard below is the whole
   *  enforcement, which is also why it is stated as a guard and not as a disabled button. */
  const requiresProject = context === 'project';

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    // Closed means cancelled and mid-exit: an implicit Enter-submit or a Save click in the
    // 120ms exit window must not post.
    if (!open) return;
    // Path 1's only exit. Pressing Enter in the Title field submits the form, so this guard
    // is what stops an implicit submit from POSTing an owned item the user never asked for;
    // the "Done" button routes through the same close so the two can never diverge. No
    // `fetch`, and no `onSaved()` — nothing changed for the shell to refresh.
    if (isLinkExistingPath) {
      onClose();
      return;
    }
    /** Path 2's request body, built in the validation block below because that is where the
     *  values it needs are proven present. Non-null is therefore the signal that the graded
     *  path validated, and is what the request chain branches on — so the branch cannot be
     *  taken with a half-filled body, and cannot be skipped into the owned-item POST. */
    let gradedBody: {
      user_subject_id: number;
      title:           string;
      target_type:     LegacyTarget | 'grade_entries';
      cat_id?:         number;
      period_id?:      number;
      deadline:        string;
      priority:        WorkPriority;
    } | null = null;

    if (!isAcademicEdit) {
      // The academic-edit branch renders neither a Title nor a Context input (its context
      // is fixed by its Study Pulse source), so neither is validated for it.
      if (!title.trim()) {
        setFormError({ field: 'title', message: 'Title is required.' });
        return;
      }
      if (context === '') {
        // Create mode deliberately starts with no context selected, so an unpicked context
        // has to fail here rather than POST `category: ''` to the server.
        setFormError({ field: 'context', message: 'Please choose a context.' });
        return;
      }
      if (requiresProject && !projects.some(p => p.id === projectId && p.context === 'project')) {
        // Not just `projectId === ''`: an edit-mode item can hold the id of a project that
        // was standalone when it was linked and has since been re-parented onto a course or
        // organization (`ProjectFields`'s `outOfScope` disables it in the select for
        // exactly this reason). `projectId === ''` alone would miss that case and let Save
        // silently re-write a link the hint right above the select says to change. This is
        // only reachable by leaving the placeholder untouched or by that stale-link case —
        // never by a deliberate, still-valid choice. Placed before the academic guards
        // purely to keep that block contiguous; the contexts are mutually exclusive, so no
        // two of these guards can ever both be live.
        setFormError({ field: 'project', message: 'Please choose a project.' });
        return;
      }
      if (context === 'academic' && academicSource === '') {
        // Create mode starts on no path for the same reason it starts on no context, and
        // the Course field does not even render until one is picked. Without this, Save
        // with Academic selected and nothing else touched POSTs an owned academic row the
        // user never chose the shape of.
        setFormError({ field: 'academicSource', message: 'Please choose where this comes from.' });
        return;
      }
      if (requiresCourse && subjectId === '') {
        setFormError({ field: 'course', message: 'Please choose a course.' });
        return;
      }
      if (isNewGradedPath) {
        // Re-stated rather than inferred from `requiresCourse` above: this is what narrows
        // `subjectId` to a number for the config lookup and the body.
        if (subjectId === '') {
          setFormError({ field: 'course', message: 'Please choose a course.' });
          return;
        }
        const grading = subjectGrading[subjectId];
        if (grading === undefined) {
          // No config means no picker was ever rendered, so no target was ever offered —
          // the load is still in flight, or it failed and the user pressed Create on the
          // error. Submitting anyway would have to guess the mode, and a wrong guess writes
          // the wrong kind of Study Pulse row.
          setFormError({ field: 'grading', message: gradingError ?? 'This course’s grading setup hasn’t loaded yet.' });
          return;
        }
        // The common section's Due date doubles as this path's deadline, and the create
        // route requires one (it 400s on a missing or malformed `deadline`). Caught here so
        // the message names the field the user can see rather than the wire key.
        if (!dueAt) {
          setFormError({ field: 'dueAt', message: 'A deadline is required for graded work.' });
          return;
        }
        if (grading.mode === 'custom') {
          if (grading.periods.length === 0) {
            // Distinct from the message below: naming "grading period and category" when
            // neither can be chosen — the select is disabled precisely because there is
            // nothing in it — points at an action the user has no way to perform. The
            // period select's own hint already explains where to fix it.
            setFormError({ field: 'grading', message: 'This course’s grading preset has no periods set up yet.' });
            return;
          }
          if (gradingPeriodId === '' || gradingCatId === '') {
            setFormError({ field: 'grading', message: 'Choose a grading period and category.' });
            return;
          }
          gradedBody = {
            user_subject_id: subjectId,
            title:           title.trim(),
            target_type:     'grade_entries',
            cat_id:          gradingCatId,
            period_id:       gradingPeriodId,
            deadline:        dueAt,
            priority,
          };
        } else {
          // `gradingTarget` is a three-value union with a default, so there is no "unpicked"
          // state to guard on this branch — the legacy select always holds one of the three
          // the route accepts. `cat_id`/`period_id` are omitted rather than nulled: the
          // route reads `target_type` to decide which it needs, and a legacy body carrying
          // a category would misdescribe what was actually chosen.
          gradedBody = {
            user_subject_id: subjectId,
            title:           title.trim(),
            target_type:     gradingTarget,
            deadline:        dueAt,
            priority,
          };
        }
      }
    }
    setFormError(null);
    setSubmitting(true);
    try {
      let res: Response;
      if (isAcademicEdit && editingItem) {
        res = await fetch(`/api/workboard/academic/${editingItem.source}/${editingItem.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            work_status:     workStatus,
            due_at:          dueAt || null,
            // Always sent, never conditionally omitted — the same rule `life_area` and
            // `organization_id` follow in the owned body below. This route writes a column
            // only when its key is PRESENT (`'deadline_time' in body`), so omitting the key
            // on a blank field would make "clear the time I set yesterday" a no-op that
            // silently kept the old value. The ternary is what keeps a blank input from
            // arriving as a "00:00" the user never chose; the route turns '' into null too,
            // and normalises "HH:MM" to the "HH:MM:SS" the TIME column round-trips.
            deadline_time:   deadlineTime !== '' ? deadlineTime : null,
            priority,
            estimated_hours: estimatedHours === '' ? null : Number(estimatedHours),
            start_date:      startDate || null,
          }),
        });
      } else if (gradedBody !== null) {
        // Path 2. Note what is NOT sent: no status, note, start date, estimated hours or
        // project. This endpoint writes a Study Pulse row, whose columns are the ones in
        // `gradedBody` and nothing else — the common fields below belong to
        // `workboard_work_items`, a table this path never touches. (An overlay row to carry
        // them can be PATCHed onto the created item afterwards, from the edit dialog.)
        res = await fetch('/api/workboard/academic/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gradedBody),
        });
      } else {
        const body = {
          title:            title.trim(),
          // The wire key stays `category` — the endpoint and the DB column are unchanged.
          // "Context" is the domain term and lives in `workContexts.ts`; this boundary is
          // deliberately not crossed here. The cast is safe: the guard at the top of this
          // function returns early on `context === ''` for every non-academic-edit path,
          // which is the only path that reaches this body.
          category:         context as WorkContext,
          note:             note.trim() || null,
          project_id:       projectId === '' ? null : projectId,
          user_subject_id:  context === 'academic' && subjectId !== '' ? subjectId : null,
          // Gated on the context for the same reason `user_subject_id` is: state survives a
          // context switch only through `handleContextChange`, and this keeps a stale id
          // out of the body even if that seam ever misses one. Sent on PATCH too, so
          // clearing the picker clears the column rather than leaving the old value.
          organization_id:  context === 'organization' && organizationId !== '' ? organizationId : null,
          // The third gated-on-context field, for the third time the same reason: a
          // `life_area` on an Academic or Projects row is exactly the cross-context leak
          // `handleContextChange` exists to prevent, and this keeps it out of the body even
          // if that seam ever misses one. Sent on PATCH too — both routes read the key's
          // *presence*, so a null here clears the column rather than leaving the old area
          // behind on an item that has just been moved out of Life or had its area cleared.
          life_area:        context === 'life' && lifeArea !== '' ? lifeArea : null,
          priority,
          work_status:      workStatus,
          due_at:           dueAt || null,
          // Unconditional for the same reason as the academic PATCH above: the PATCH route
          // writes this column only when the key is present, so a blank field has to arrive
          // as an explicit null to clear a previously-saved time. Blank never becomes
          // "00:00" — the distinction the separate column exists to preserve.
          deadline_time:    deadlineTime !== '' ? deadlineTime : null,
          start_date:       startDate || null,
          estimated_hours:  estimatedHours === '' ? null : Number(estimatedHours),
        };
        res = editingItem
          ? await fetch(`/api/workboard/work-items/${editingItem.id}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            })
          : await fetch('/api/workboard/work-items', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
      }

      if (!res.ok) {
        setFormError({ field: 'form', message: await parseErrorMessage(res) });
        return;
      }
      await onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const heading = target.mode === 'create' ? 'New Work Item' : isAcademicEdit ? 'Edit Academic Item' : 'Edit Work Item';
  const bannerError = formError?.field === 'form' ? formError.message : null;

  return (
    <WbOverlay
      open={open}
      instant={instant}
      onClose={onClose}
      variant="modal"
      labelledBy="vb-item-dialog-title"
      initialFocusRef={firstFieldRef}
      panelClassName="wb-item-dialog"
      panelStyle={{ width: 'min(600px, calc(100vw - 32px))', padding: 20 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <h2 id="vb-item-dialog-title" style={{ margin: 0, font: '800 var(--wb-fs-20) var(--wb-font-head)', color: 'var(--wb-text)' }}>
          {heading}
        </h2>
        <button
          type="button"
          className="wb-focus-ring wb-pressable wb-dialog-close"
          aria-label="Close dialog"
          onClick={onClose}
          style={{
            width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', borderRadius: 'var(--wb-r-md)', cursor: 'pointer',
          }}
        >
          <X size={18} />
        </button>
      </div>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        onKeyDown={e => {
          // Ctrl/Cmd+Enter saves from any field. An inline "new project/organization" input
          // has already claimed Enter (preventDefault) for its own Add, so that one wins.
          // Closed (the exit window) means cancelled: never submit then.
          if (!open) return;
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.defaultPrevented) {
            e.preventDefault();
            if (!submitting) void handleSubmit();
          }
        }}
        style={FIELD_GROUP}
      >
        {bannerError && <p role="alert" style={BANNER_STYLE}>{bannerError}</p>}
        {/* Item-dialog link, close-button and disabled-control rules: `.wb-item-dialog` in workboard.css. */}

        {isAcademicEdit && editingItem ? (
          <AcademicEditFields
            item={editingItem}
            workStatus={workStatus} setWorkStatus={setWorkStatus}
            dueAt={dueAt} setDueAt={setDueAt}
            deadlineTime={deadlineTime} setDeadlineTime={setDeadlineTime}
            priority={priority} setPriority={setPriority}
            estimatedHours={estimatedHours} setEstimatedHours={setEstimatedHours}
            startDate={startDate} setStartDate={setStartDate}
            firstFieldRef={firstFieldRef}
          />
        ) : (
          <>
            <TitleContextFields
              title={title} setTitle={setTitle}
              titleRequired={!isLinkExistingPath}
              titleError={fieldError('title')}
              context={context} onContextChange={handleContextChange}
              contextError={fieldError('context')}
              firstFieldRef={firstFieldRef}
            />

            {/* The per-context section — nothing until a context is picked. */}
            {context !== '' && renderContextFields(context)}

            <ScheduleFields
              isNewGradedPath={isNewGradedPath}
              showStatus={target.mode === 'edit'}
              dueAt={dueAt} setDueAt={setDueAt} dueError={fieldError('dueAt')}
              deadlineTime={deadlineTime} setDeadlineTime={setDeadlineTime}
              startDate={startDate} setStartDate={setStartDate}
              priority={priority} setPriority={setPriority}
              estimatedHours={estimatedHours} setEstimatedHours={setEstimatedHours}
              workStatus={workStatus} setWorkStatus={setWorkStatus}
              note={note} setNote={setNote}
            />
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <button type="button" className="wb-add-trigger wb-focus-ring" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="vb-btn-pink wb-pressable wb-focus-ring"
            disabled={submitting}
            aria-busy={submitting || undefined}
            style={{ width: 'auto', padding: '10px 20px' }}
          >
            {/* Path 1 creates nothing, so it must not offer to "Create" — the button
                acknowledges what the user just confirmed and closes. `submitting` is
                never true on that path (it has no fetch), so the order is moot there. */}
            {submitting ? 'Saving…' : isLinkExistingPath ? 'Done' : target.mode === 'create' ? 'Create' : 'Save changes'}
          </button>
        </div>
      </form>
    </WbOverlay>
  );
}
