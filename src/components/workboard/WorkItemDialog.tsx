'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
// Types only — `workItems.ts` imports `@/lib/db` (mysql2) at module scope, so a runtime
// import from it here would drag mysql2 into this client component's bundle (the landmine
// that broke `/workboard` twice before; see WorkItemRow.tsx's own note on the same rule).
// `WorkContext`/`WORK_CONTEXTS`/`CONTEXT_LABELS` come from the pool-free `workContexts.ts`
// instead (zero imports of its own, so pulling values from it is safe here).
import type { WorkItem, WorkPriority, WorkStatus, WorkSource, ProjectSummary } from '@/lib/workboard/workItems';
import { WORK_CONTEXTS, CONTEXT_LABELS, type WorkContext } from '@/lib/workboard/workContexts';

const FONT = "'Inter','DM Sans','Segoe UI',sans-serif";
const HEADER_FONT = "'DM Sans','Segoe UI',sans-serif";

export type DialogTarget =
  | { mode: 'create' }
  | { mode: 'edit'; item: WorkItem };

export interface WorkItemDialogProps {
  target:            DialogTarget;
  /** `work.projects` from the shell — kept in sync locally via `onProjectCreated` so an
   *  inline-created project shows up in the select without waiting for a full refetch.
   *  The select itself now lives in the Projects branch of `renderContextFields` (Task 29),
   *  so this prop and `onProjectCreated` are held, not dropped. */
  projects:          ProjectSummary[];
  onClose:           () => void;
  /** Called after a successful create/update so the shell can `refreshWork()`. */
  onSaved:           () => void | Promise<void>;
  onProjectCreated:  (project: ProjectSummary) => void;
}

interface SubjectOption {
  user_subject_id: number;
  course_code:     string;
  subject_name:    string;
}

const STATUS_LABEL: Record<WorkStatus, string> = {
  todo:        'To Do',
  in_progress: 'In Progress',
  done:        'Done',
};

const PRIORITY_LABEL: Record<WorkPriority, string> = {
  high:   'High',
  normal: 'Normal',
  low:    'Low',
};

/**
 * The three ways an Academic item can come into being. They are genuinely different
 * operations, not three spellings of "create":
 *
 *   'link'        writes NOTHING. Study Pulse already put the item on the board; this path
 *                 only lets the user find it and see that it is there.
 *   'graded'      writes a real Study Pulse row via POST /api/workboard/academic/create.
 *                 Task 27 wires its target picker and its submission; this task only shows
 *                 that the path is selected and requires a Course.
 *   'independent' writes an owned `workboard_work_items` row through the same POST/PATCH
 *                 the Projects/Organization/Life contexts use. The only path of the three
 *                 whose row has a `project_id` column, which is why Academic Project is
 *                 offered here and nowhere else.
 */
type AcademicSourcePath = 'link' | 'graded' | 'independent';

const ACADEMIC_SOURCE_OPTIONS: { value: AcademicSourcePath; label: string; blurb: string }[] = [
  {
    value: 'link',
    label: 'Link an existing item',
    blurb: 'Study Pulse already put it on your board. Find it here to confirm — nothing is created.',
  },
  {
    value: 'graded',
    label: 'New graded work',
    blurb: 'Writes a real entry in Study Pulse, so it counts toward your grade.',
  },
  {
    value: 'independent',
    label: 'New independent activity',
    blurb: 'Revision, reading, practice — study work that only lives on Workboard.',
  },
];

/** How each row in the "Link an existing item" picker announces where it came from, so two
 *  similarly-titled entries stay tellable apart. `owned` is in the list because the picker
 *  filters by *context*, not by source: an independent activity added here is on the board
 *  for that course too, and "this is already here" is just as true of it. */
const WORK_SOURCE_LABEL: Record<WorkSource, string> = {
  owned:         'Independent',
  activities:    'Activity',
  quizzes:       'Quiz',
  exams:         'Exam',
  grade_entries: 'Graded item',
};

/** The three targets a legacy-mode subject offers, in the order Study Pulse's own pickers
 *  offer them. Labels come from `WORK_SOURCE_LABEL` so a target reads as the same word here
 *  as it does in the "Link an existing item" list one field above. */
const LEGACY_TARGETS = ['activities', 'quizzes', 'exams'] as const;
type LegacyTarget = typeof LEGACY_TARGETS[number];

/** One row of the "Link an existing item" picker — the handful of `WorkItem` fields the
 *  picker actually renders, kept narrow so the cache does not pin whole payloads. `key`
 *  exists because ids repeat across the four Study Pulse tables: `activities` #5 and
 *  `exams` #5 are different items, so source and id together are the only unique handle. */
interface LinkableItem {
  key:    string;
  source: WorkSource;
  id:     number;
  title:  string;
  due_at: string | null;
}

interface GradingCategory { cat_id: number; name: string }
interface GradingPeriod   { period_id: number; name: string; categories: GradingCategory[] }

/**
 * What the "New graded work" path needs out of `GET /api/studypulse/subjects/[id]/grading`.
 *
 * `mode` is the whole point: a legacy subject is graded as Activity/Quiz/Exam, a custom one
 * as a category inside a grading period, and the create route 400s if the body describes the
 * wrong one. It is derived exactly as `CanvasAnnouncementBank` derives it — a *real* preset
 * means custom — which is also how the route's own `getSubjectMode` decides (it JOINs
 * `grading_presets`, so a `subject_grading` row pointing at a missing preset is legacy on
 * both sides). Deriving it from `config !== null` instead would disagree with the server on
 * exactly that row and strand the user on a picker whose every submission is rejected.
 */
interface SubjectGrading {
  mode:    'legacy' | 'custom';
  periods: GradingPeriod[];
}

const HINT_TEXT_STYLE: React.CSSProperties = {
  margin: '0 0 16px', fontFamily: FONT, fontSize: '0.74rem', color: '#8a94a6',
};

const INFO_CARD_STYLE: React.CSSProperties = {
  marginBottom: '16px', padding: '12px 14px', borderRadius: '12px',
  background: 'rgba(77,171,245,0.08)', border: '1px solid rgba(77,171,245,0.2)',
};

/** Sentinel value for the project select's inline "＋ New project…" option. The picker it
 *  belongs to is now part of the Projects branch of `renderContextFields` (Task 29); this
 *  and `handleCreateProject` stay put so that branch can wire straight back into them. */
const NEW_PROJECT_SENTINEL = '__new__';

const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontFamily: FONT, fontSize: '0.78rem', fontWeight: 700,
  color: '#5c6b80', marginBottom: '6px',
};

const CONTROL_STYLE: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: '40px', borderRadius: '10px',
  padding: '8px 12px', background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(200,210,230,0.6)', fontFamily: FONT, fontSize: '0.85rem',
  fontWeight: 500, color: '#2d3748',
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={LABEL_STYLE}>{label}</label>
      {children}
      {hint && <p style={{ margin: '6px 0 0', fontFamily: FONT, fontSize: '0.72rem', color: '#8a94a6' }}>{hint}</p>}
    </div>
  );
}

/** Only fields this endpoint accepts: PATCH /api/workboard/academic/[source]/[id] rejects
 *  any other field's source. It cannot rename an academic item, so no title input is
 *  rendered for one — the direction/brief are explicit that a title field that silently
 *  fails to save must not exist. */
function AcademicFieldSet({
  item, workStatus, setWorkStatus, dueAt, setDueAt, priority, setPriority,
  estimatedHours, setEstimatedHours, startDate, setStartDate, firstFieldRef,
}: {
  item: WorkItem;
  workStatus: WorkStatus; setWorkStatus: (v: WorkStatus) => void;
  dueAt: string; setDueAt: (v: string) => void;
  priority: WorkPriority; setPriority: (v: WorkPriority) => void;
  estimatedHours: string; setEstimatedHours: (v: string) => void;
  startDate: string; setStartDate: (v: string) => void;
  firstFieldRef: React.RefObject<HTMLSelectElement | null>;
}) {
  return (
    <>
      <div style={{
        marginBottom: '18px', padding: '12px 14px', borderRadius: '12px',
        background: 'rgba(77,171,245,0.08)', border: '1px solid rgba(77,171,245,0.2)',
      }}>
        <p style={{ margin: '0 0 4px', fontFamily: HEADER_FONT, fontSize: '0.92rem', fontWeight: 700, color: '#2d3748' }}>
          {item.title}
        </p>
        <p style={{ margin: 0, fontFamily: FONT, fontSize: '0.76rem', color: '#5c6b80' }}>
          Title and scores are managed in Study Pulse — this dialog only edits how it shows up on Workboard.
        </p>
        {item.user_subject_id !== null && (
          <a
            href={`/studypulse/${item.user_subject_id}`}
            className="vb-dialog-link"
            style={{ display: 'inline-block', marginTop: '8px', fontFamily: FONT, fontSize: '0.78rem', fontWeight: 700, color: '#256f92' }}
          >
            Open in Study Pulse →
          </a>
        )}
      </div>

      <Field label="Status">
        <select
          ref={firstFieldRef}
          className="vb-dialog-control"
          style={CONTROL_STYLE}
          value={workStatus}
          onChange={e => setWorkStatus(e.target.value as WorkStatus)}
        >
          {(Object.keys(STATUS_LABEL) as WorkStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </Field>

      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <Field label="Due date">
            <input type="date" className="vb-dialog-control" style={CONTROL_STYLE} value={dueAt} onChange={e => setDueAt(e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Start date" hint="Adds a bar on the Timeline view.">
            <input type="date" className="vb-dialog-control" style={CONTROL_STYLE} value={startDate} onChange={e => setStartDate(e.target.value)} />
          </Field>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <Field label="Priority">
            <select className="vb-dialog-control" style={CONTROL_STYLE} value={priority} onChange={e => setPriority(e.target.value as WorkPriority)}>
              {(Object.keys(PRIORITY_LABEL) as WorkPriority[]).map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Estimated hours">
            <input
              type="number" min="0" step="0.25" className="vb-dialog-control" style={CONTROL_STYLE}
              value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)} placeholder="e.g. 2"
            />
          </Field>
        </div>
      </div>
    </>
  );
}

export default function WorkItemDialog({ target, projects, onClose, onSaved, onProjectCreated }: WorkItemDialogProps) {
  const editingItem = target.mode === 'edit' ? target.item : null;
  const isAcademicEdit = editingItem !== null && editingItem.source !== 'owned';

  const [title, setTitle]                     = useState(editingItem?.title ?? '');
  // Create mode starts with NO context selected — the per-context section renders nothing
  // until one is picked, so the modal opens short and grows (progressive disclosure). An
  // item being edited always has a context already, so edit mode pre-fills from it.
  const [context, setContext]                 = useState<WorkContext | ''>(editingItem?.category ?? '');
  const [projectId, setProjectId]             = useState<number | ''>(editingItem?.project_id ?? '');
  const [subjectId, setSubjectId]             = useState<number | ''>(editingItem?.user_subject_id ?? '');
  const [priority, setPriority]               = useState<WorkPriority>(editingItem?.priority ?? 'normal');
  const [workStatus, setWorkStatus]           = useState<WorkStatus>(editingItem?.work_status ?? 'todo');
  const [dueAt, setDueAt]                     = useState(editingItem?.due_at ? editingItem.due_at.slice(0, 10) : '');
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

  const [showNewProject, setShowNewProject]   = useState(false);
  const [newProjectName, setNewProjectName]   = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectError, setProjectError]       = useState<string | null>(null);

  const [submitting, setSubmitting]           = useState(false);
  const [formError, setFormError]             = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement & HTMLSelectElement>(null);

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

  useEffect(() => {
    // Restore focus to whatever opened this dialog (a row's "Edit" menu item, the shell's or
    // the empty state's "New Work Item" button) once it closes — otherwise a keyboard user
    // lands back on `document.body` and has to re-tab from the top of the page.
    const opener = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      // The opener can be gone by the time this runs (e.g. the row it belonged to was
      // filtered out by a search change while the dialog was open) — guard with `isConnected`
      // rather than letting a stale-element `.focus()` throw.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function handleBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'),
    ).filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /**
   * The single seam where switching context clears the outgoing context's fields.
   *
   * Without it, editing a Projects item and switching it to Life would keep the populated
   * `projectId` in state and save a project reference onto a Life item — an invalid
   * combination the service layer would reject, or worse, silently persist.
   *
   * TASKS 28 / 29 / 30: each of you introduces new per-context state (an organisation id,
   * a life area, and so on). Add a reset for it HERE as you add it — every per-context
   * field must appear in this list, or it leaks across a context switch. Task 26 added the
   * five academic-branch values below; the project and subject ids predate it.
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

  /** Categories belong to a period, so a category picked under the outgoing period is not
   *  merely stale — it names a row the create route's ownership join will refuse. Clearing
   *  it is what makes the second select's emptiness honest rather than a hidden mismatch. */
  function handleGradingPeriodChange(next: number | '') {
    setGradingPeriodId(next);
    setGradingCatId('');
  }

  /**
   * The Academic branch. NO HOOKS — see `renderContextFields`'s note; this is reached only
   * when the user has picked Academic, so a hook here would change the hook order between
   * renders and blow up at runtime. Everything it needs is already state at the top of the
   * component or a prop.
   */
  function renderAcademicFields(): React.ReactNode {
    const path            = academicSource;
    const chosenCourseId  = subjectId === '' ? null : subjectId;
    const courseRows      = chosenCourseId === null ? undefined : linkableItems[chosenCourseId];
    const loadingRows     = chosenCourseId !== null && linkableLoading === chosenCourseId;
    const pickedItem      = (courseRows ?? []).find(r => r.key === linkedItemKey) ?? null;
    // Once an item is chosen the course is no longer a choice — it is a fact about that
    // item. Clearing the item in the picker below unlocks it again.
    const courseLocked    = path === 'link' && pickedItem !== null;
    // Path 2's picker data. `undefined` means "not loaded" — never "legacy": the two are
    // told apart by `gradingError`, which the branch below checks first.
    const courseGrading   = chosenCourseId === null ? undefined : subjectGrading[chosenCourseId];
    // The nested period→category shape `CanvasAnnouncementBank` uses: categories are read
    // off the selected period, so no period means no categories to choose from.
    const periodCategories = courseGrading?.periods.find(p => p.period_id === gradingPeriodId)?.categories ?? [];
    // The whole reason `ProjectSummary` carries `context` and `user_subject_id`: without
    // both, this list would show one course's projects while another course is selected.
    const academicProjects = chosenCourseId === null
      ? []
      : projects.filter(p => p.context === 'academic' && p.user_subject_id === chosenCourseId);

    return (
      <>
        {target.mode === 'create' && (
          <fieldset style={{ border: 'none', margin: '0 0 16px', padding: 0 }}>
            <legend style={{ ...LABEL_STYLE, marginBottom: '4px', padding: 0 }}>Where does this come from?</legend>
            <p style={{ margin: '0 0 10px', fontFamily: FONT, fontSize: '0.74rem', color: '#8a94a6' }}>
              Graded work appears in Study Pulse and counts toward your grade. An independent
              activity is study work that only lives here.
            </p>
            <div style={{ display: 'grid', gap: '8px' }}>
              {ACADEMIC_SOURCE_OPTIONS.map(opt => {
                const active = path === opt.value;
                return (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer',
                      padding: '10px 12px', borderRadius: '12px',
                      background: active ? 'rgba(77,171,245,0.08)' : 'rgba(255,255,255,0.6)',
                      border: `1px solid ${active ? 'rgba(77,171,245,0.45)' : 'rgba(200,210,230,0.6)'}`,
                    }}
                  >
                    <input
                      type="radio"
                      className="vb-dialog-control"
                      name="academicSource"
                      value={opt.value}
                      checked={active}
                      onChange={() => handleAcademicSourceChange(opt.value)}
                      style={{ marginTop: '3px', accentColor: '#2a7fa8', flexShrink: 0 }}
                    />
                    <span>
                      <span style={{ display: 'block', fontFamily: HEADER_FONT, fontSize: '0.85rem', fontWeight: 700, color: '#2d3748' }}>
                        {opt.label}
                      </span>
                      <span style={{ display: 'block', marginTop: '2px', fontFamily: FONT, fontSize: '0.74rem', color: '#5c6b80' }}>
                        {opt.blurb}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {path !== '' && (
          <>
            <Field
              label="Course"
              hint={courseLocked ? 'Set by the item you picked — clear the item to change it.' : undefined}
            >
              <select
                className="vb-dialog-control"
                style={CONTROL_STYLE}
                value={subjectId === '' ? '' : String(subjectId)}
                disabled={courseLocked || subjectsLoading}
                onChange={e => handleSubjectChange(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">{subjectsLoading ? 'Loading courses…' : 'Choose a course…'}</option>
                {(subjects ?? []).map(s => (
                  <option key={s.user_subject_id} value={s.user_subject_id}>
                    {s.course_code} — {s.subject_name}
                  </option>
                ))}
              </select>
            </Field>

            {subjectsError && (
              <p style={{ ...HINT_TEXT_STYLE, color: '#922e48', fontWeight: 600 }}>{subjectsError}</p>
            )}

            {path === 'link' && (
              chosenCourseId === null ? (
                <p style={HINT_TEXT_STYLE}>Pick a course to see what it already has on your board.</p>
              ) : (
                <>
                  <Field label="Item" hint="Picking one changes nothing — it is already on your board.">
                    <select
                      className="vb-dialog-control"
                      style={CONTROL_STYLE}
                      value={linkedItemKey}
                      disabled={loadingRows || linkableError !== null || (courseRows?.length ?? 0) === 0}
                      onChange={e => setLinkedItemKey(e.target.value)}
                    >
                      <option value="">
                        {loadingRows
                          ? 'Loading…'
                          // A failed load leaves `courseRows` undefined too, which must not
                          // read as "this course truly has nothing" — that is a real, false
                          // answer to the one question this picker exists to answer honestly.
                          : linkableError !== null
                            ? 'Could not load'
                            : (courseRows?.length ?? 0) === 0
                              ? 'Nothing on your board for this course yet'
                              : 'Choose an item…'}
                      </option>
                      {(courseRows ?? []).map(r => (
                        <option key={r.key} value={r.key}>
                          {WORK_SOURCE_LABEL[r.source]} · {r.title}
                          {r.due_at ? ` · due ${r.due_at.slice(0, 10)}` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {linkableError && (
                    <p style={{ ...HINT_TEXT_STYLE, margin: '-10px 0 16px', color: '#922e48', fontWeight: 600 }}>
                      {linkableError}{' '}
                      <button
                        type="button"
                        className="vb-dialog-link"
                        onClick={() => loadLinkableItems(chosenCourseId)}
                        style={{
                          background: 'none', border: 'none', padding: 0, font: 'inherit',
                          color: 'inherit', textDecoration: 'underline', cursor: 'pointer',
                        }}
                      >
                        Try again
                      </button>
                    </p>
                  )}

                  {pickedItem && (
                    <div style={INFO_CARD_STYLE}>
                      <p style={{ margin: '0 0 4px', fontFamily: HEADER_FONT, fontSize: '0.92rem', fontWeight: 700, color: '#2d3748' }}>
                        {pickedItem.title}
                      </p>
                      <p style={{ margin: 0, fontFamily: FONT, fontSize: '0.76rem', color: '#5c6b80' }}>
                        {pickedItem.source === 'owned'
                          ? 'Already here — an independent activity you added to Workboard. There is nothing to create.'
                          : 'Already here — Study Pulse puts this on your board automatically. There is nothing to create.'}
                      </p>
                      <a
                        href={`/studypulse/${chosenCourseId}`}
                        className="vb-dialog-link"
                        style={{ display: 'inline-block', marginTop: '8px', fontFamily: FONT, fontSize: '0.78rem', fontWeight: 700, color: '#256f92' }}
                      >
                        Open in Study Pulse →
                      </a>
                    </div>
                  )}
                </>
              )
            )}

            {path === 'graded' && (
              chosenCourseId === null ? (
                <p style={HINT_TEXT_STYLE}>Pick a course to choose what this counts toward.</p>
              ) : gradingError !== null ? (
                // Checked before the empty-cache branch below, and before anything reads a
                // mode: a failed load leaves the cache empty too, and an empty cache must
                // never fall through to the legacy picker — that would quietly offer
                // Activity/Quiz/Exam for a custom-mode course and have the route reject
                // every submission made through it.
                <p style={{ ...HINT_TEXT_STYLE, color: '#922e48', fontWeight: 600 }}>
                  {gradingError}{' '}
                  <button
                    type="button"
                    className="vb-dialog-link"
                    onClick={() => loadSubjectGrading(chosenCourseId)}
                    style={{
                      background: 'none', border: 'none', padding: 0, font: 'inherit',
                      color: 'inherit', textDecoration: 'underline', cursor: 'pointer',
                    }}
                  >
                    Try again
                  </button>
                </p>
              ) : courseGrading === undefined ? (
                // Not in the cache and not failed, so it is in flight — or about to be: the
                // effect that starts the fetch runs *after* the paint that follows picking a
                // course, which is why this derives "loading" from the cache miss instead of
                // from a flag that effect would have to set first.
                <p style={HINT_TEXT_STYLE}>Loading this course’s grading setup…</p>
              ) : courseGrading.mode === 'legacy' ? (
                <Field label="Counts as" hint="This course is graded on the standard Activity / Quiz / Exam categories.">
                  <select
                    className="vb-dialog-control"
                    style={CONTROL_STYLE}
                    value={gradingTarget}
                    onChange={e => setGradingTarget(e.target.value as LegacyTarget)}
                  >
                    {LEGACY_TARGETS.map(t => <option key={t} value={t}>{WORK_SOURCE_LABEL[t]}</option>)}
                  </select>
                </Field>
              ) : (
                <>
                  <Field
                    label="Grading period"
                    hint={courseGrading.periods.length === 0
                      ? 'This course’s grading preset has no periods set up — add them in Study Pulse first.'
                      : undefined}
                  >
                    <select
                      className="vb-dialog-control"
                      style={CONTROL_STYLE}
                      value={gradingPeriodId === '' ? '' : String(gradingPeriodId)}
                      disabled={courseGrading.periods.length === 0}
                      onChange={e => handleGradingPeriodChange(e.target.value === '' ? '' : Number(e.target.value))}
                    >
                      <option value="">Choose a period…</option>
                      {courseGrading.periods.map(p => (
                        <option key={p.period_id} value={p.period_id}>{p.name}</option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label="Category"
                    hint={gradingPeriodId === '' ? 'Choose a grading period first.' : undefined}
                  >
                    <select
                      className="vb-dialog-control"
                      style={CONTROL_STYLE}
                      value={gradingCatId === '' ? '' : String(gradingCatId)}
                      disabled={gradingPeriodId === '' || periodCategories.length === 0}
                      onChange={e => setGradingCatId(e.target.value === '' ? '' : Number(e.target.value))}
                    >
                      <option value="">
                        {gradingPeriodId !== '' && periodCategories.length === 0
                          ? 'This period has no categories'
                          : 'Choose a category…'}
                      </option>
                      {periodCategories.map(c => (
                        <option key={c.cat_id} value={c.cat_id}>{c.name}</option>
                      ))}
                    </select>
                  </Field>
                </>
              )
            )}

            {path === 'independent' && (() => {
              // An item being edited can carry a `project_id` the current filter would
              // never have offered — a project from a different course, or created before
              // this filter existed. A `<select value>` that matches no `<option>` falls
              // back to displaying the *first* one ("No project"), which would misreport a
              // real, still-submitted value as cleared and — worse — leave it uneditable
              // once `academicProjects` is empty and the control disables. Surfacing it as
              // its own disabled option keeps what is about to be saved visible, and "No
              // project" stays one real click away to actually clear it.
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
                    className="vb-dialog-control"
                    style={CONTROL_STYLE}
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
            })()}
          </>
        )}
      </>
    );
  }

  /**
   * The per-context section. Tasks 28 (organization), 29 (projects) and 30 (life) each add
   * exactly one branch here, one task at a time; Task 26 added Academic. Declared inside
   * the component so those branches close over the existing form state (`projectId`,
   * `subjectId`, `projects`, the subject list) without any prop threading.
   *
   * Called conditionally (`context !== '' && renderContextFields(context)`), so this
   * function — and everything it calls, `renderAcademicFields` included — must never
   * contain a hook. Declare new per-context state with the other `useState` calls at the
   * top of the component instead, and reset it in `handleContextChange` above — a hook
   * written in here would typecheck cleanly (there is no ESLint config in this repo to
   * catch it) and only fail at runtime, the moment a user picks the context whose branch
   * introduced it.
   */
  function renderContextFields(context: WorkContext): React.ReactNode {
    if (context === 'academic') return renderAcademicFields();
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
      // call here might send instead. Task 26/29 must update both together if they add a
      // context/parent to this request.
      const created: ProjectSummary = {
        id: data.project_id, name, color: null, status: 'active',
        context: 'project', user_subject_id: null, organization_id: null,
      };
      onProjectCreated(created);
      setProjectId(created.id);
      setShowNewProject(false);
      setNewProjectName('');
    } finally {
      setCreatingProject(false);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
        setFormError('Title is required.');
        return;
      }
      if (context === '') {
        // Create mode deliberately starts with no context selected, so an unpicked context
        // has to fail here rather than POST `category: ''` to the server.
        setFormError('Please choose a context.');
        return;
      }
      if (context === 'academic' && academicSource === '') {
        // Create mode starts on no path for the same reason it starts on no context, and
        // the Course field does not even render until one is picked. Without this, Save
        // with Academic selected and nothing else touched POSTs an owned academic row the
        // user never chose the shape of.
        setFormError('Please choose where this comes from.');
        return;
      }
      if (requiresCourse && subjectId === '') {
        setFormError('Please choose a course.');
        return;
      }
      if (isNewGradedPath) {
        // Re-stated rather than inferred from `requiresCourse` above: this is what narrows
        // `subjectId` to a number for the config lookup and the body.
        if (subjectId === '') {
          setFormError('Please choose a course.');
          return;
        }
        const grading = subjectGrading[subjectId];
        if (grading === undefined) {
          // No config means no picker was ever rendered, so no target was ever offered —
          // the load is still in flight, or it failed and the user pressed Create on the
          // error. Submitting anyway would have to guess the mode, and a wrong guess writes
          // the wrong kind of Study Pulse row.
          setFormError(gradingError ?? 'This course’s grading setup hasn’t loaded yet.');
          return;
        }
        // The common section's Due date doubles as this path's deadline, and the create
        // route requires one (it 400s on a missing or malformed `deadline`). Caught here so
        // the message names the field the user can see rather than the wire key.
        if (!dueAt) {
          setFormError('A deadline is required for graded work.');
          return;
        }
        if (grading.mode === 'custom') {
          if (grading.periods.length === 0) {
            // Distinct from the message below: naming "grading period and category" when
            // neither can be chosen — the select is disabled precisely because there is
            // nothing in it — points at an action the user has no way to perform. The
            // period select's own hint already explains where to fix it.
            setFormError('This course’s grading preset has no periods set up yet.');
            return;
          }
          if (gradingPeriodId === '' || gradingCatId === '') {
            setFormError('Choose a grading period and category.');
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
          priority,
          work_status:      workStatus,
          due_at:           dueAt || null,
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
        setFormError(await parseErrorMessage(res));
        return;
      }
      await onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const heading = target.mode === 'create' ? 'New Work Item' : isAcademicEdit ? 'Edit Academic Item' : 'Edit Work Item';

  return (
    <div
      className="vb-dialog-backdrop"
      onMouseDown={handleBackdropMouseDown}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,24,38,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workItemDialogHeading"
        onKeyDown={handleKeyDown}
        style={{
          width: 'min(560px, 100%)', maxHeight: '88vh', overflowY: 'auto', boxSizing: 'border-box',
          background: '#fbfbfd', borderRadius: '20px', border: '1px solid rgba(200,210,230,0.6)',
          boxShadow: '0 20px 60px rgba(31,38,68,0.35)', padding: '24px', position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '18px' }}>
          <h2 id="workItemDialogHeading" style={{ margin: 0, fontFamily: HEADER_FONT, fontSize: '1.1rem', fontWeight: 800, color: '#2d3748' }}>
            {heading}
          </h2>
          <button
            type="button"
            className="vb-dialog-control vb-dialog-close"
            aria-label="Close dialog"
            onClick={onClose}
            style={{
              width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: '8px', color: '#5c6b80', cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {isAcademicEdit && editingItem ? (
            <AcademicFieldSet
              item={editingItem}
              workStatus={workStatus} setWorkStatus={setWorkStatus}
              dueAt={dueAt} setDueAt={setDueAt}
              priority={priority} setPriority={setPriority}
              estimatedHours={estimatedHours} setEstimatedHours={setEstimatedHours}
              startDate={startDate} setStartDate={setStartDate}
              firstFieldRef={firstFieldRef}
            />
          ) : (
            <>
              <Field label="Title">
                <input
                  ref={firstFieldRef}
                  type="text"
                  className="vb-dialog-control"
                  style={CONTROL_STYLE}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="What needs doing?"
                  // Not required on path 1: nothing here is submitted (the item already
                  // exists), so native constraint validation would block the "Done" button
                  // on an empty Title the form never reads — the one path that needs no
                  // title would be the one path whose primary button silently refuses to fire.
                  required={!isLinkExistingPath}
                />
              </Field>

              <Field label="Context" hint="Pick a context to see the fields that only apply to it.">
                <select
                  className="vb-dialog-control"
                  style={CONTROL_STYLE}
                  value={context}
                  onChange={e => handleContextChange(e.target.value as WorkContext | '')}
                >
                  {/* An explicit placeholder so "no context yet" is a visible, selectable
                      state rather than an invisible default that silently means Projects.
                      Disabled once a real context is set: re-selecting it would run
                      `handleContextChange('')`, silently clearing `projectId`/`subjectId`
                      on an item that already had a perfectly good context, with no undo
                      short of cancelling the whole dialog. It only needs to be reachable
                      as the *initial* state, never as a way back out of a real choice. */}
                  <option value="" disabled={context !== ''}>Choose a context…</option>
                  {WORK_CONTEXTS.map(c => <option key={c} value={c}>{CONTEXT_LABELS[c]}</option>)}
                </select>
              </Field>

              {/* The per-context section — nothing until a context is picked. */}
              {context !== '' && renderContextFields(context)}

              {/* POST /api/workboard/academic/create takes only { title, target_type,
                  cat_id?, period_id?, deadline, priority } — Start date, Estimated hours
                  and Note have no column on that path, so a user who fills them in for
                  graded work would otherwise lose them with no signal at all. Due date and
                  Priority are unaffected — both map onto fields the route does accept. */}
              {isNewGradedPath && (
                <p style={{ ...HINT_TEXT_STYLE, margin: '-4px 0 16px' }}>
                  Study Pulse doesn’t have a place for Start date, Estimated hours, or Note
                  yet — only Due date and Priority are saved for graded work.
                </p>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <Field label="Due date">
                    <input type="date" className="vb-dialog-control" style={CONTROL_STYLE} value={dueAt} onChange={e => setDueAt(e.target.value)} />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Start date" hint="Adds a bar on the Timeline view.">
                    <input
                      type="date" className="vb-dialog-control" style={CONTROL_STYLE}
                      value={startDate} onChange={e => setStartDate(e.target.value)} disabled={isNewGradedPath}
                    />
                  </Field>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <Field label="Priority">
                    <select className="vb-dialog-control" style={CONTROL_STYLE} value={priority} onChange={e => setPriority(e.target.value as WorkPriority)}>
                      {(Object.keys(PRIORITY_LABEL) as WorkPriority[]).map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Estimated hours">
                    <input
                      type="number" min="0" step="0.25" className="vb-dialog-control" style={CONTROL_STYLE}
                      value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)}
                      placeholder="e.g. 2" disabled={isNewGradedPath}
                    />
                  </Field>
                </div>
              </div>

              {target.mode === 'edit' && (
                <Field label="Status">
                  <select className="vb-dialog-control" style={CONTROL_STYLE} value={workStatus} onChange={e => setWorkStatus(e.target.value as WorkStatus)}>
                    {(Object.keys(STATUS_LABEL) as WorkStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </Field>
              )}

              <Field label="Note">
                <textarea
                  className="vb-dialog-control"
                  style={{ ...CONTROL_STYLE, minHeight: '72px', resize: 'vertical', fontFamily: FONT }}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Optional details…"
                  disabled={isNewGradedPath}
                />
              </Field>
            </>
          )}

          {formError && (
            <p style={{ margin: '0 0 14px', fontFamily: FONT, fontSize: '0.82rem', fontWeight: 600, color: '#922e48' }}>
              {formError}
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
            <button
              type="button"
              className="vb-btn-ghost vb-dialog-control"
              onClick={onClose}
              style={{ width: 'auto', padding: '10px 20px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="vb-btn-pink vb-dialog-control"
              disabled={submitting}
              style={{ width: 'auto', padding: '10px 20px' }}
            >
              {/* Path 1 creates nothing, so it must not offer to "Create" — the button
                  acknowledges what the user just confirmed and closes. `submitting` is
                  never true on that path (it has no fetch), so the order is moot there. */}
              {submitting ? 'Saving…' : isLinkExistingPath ? 'Done' : target.mode === 'create' ? 'Create' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .vb-dialog-control:focus-visible,
        .vb-dialog-link:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
          border-radius: inherit;
        }
        .vb-dialog-close:hover {
          background: rgba(200,210,230,0.3);
        }
        .vb-dialog-link {
          text-decoration: none;
        }
        .vb-dialog-link:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
