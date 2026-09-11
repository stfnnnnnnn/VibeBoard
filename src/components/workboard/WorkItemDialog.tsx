'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
// Types only — `workItems.ts` imports `@/lib/db` (mysql2) at module scope, so a runtime
// import from it here would drag mysql2 into this client component's bundle (the landmine
// that broke `/workboard` twice before; see WorkItemRow.tsx's own note on the same rule).
// `WorkContext`/`WORK_CONTEXTS`/`CONTEXT_LABELS` come from the pool-free `workContexts.ts`
// instead (zero imports of its own, so pulling values from it is safe here).
import type { WorkItem, WorkPriority, WorkStatus, ProjectSummary } from '@/lib/workboard/workItems';
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

  const [showNewProject, setShowNewProject]   = useState(false);
  const [newProjectName, setNewProjectName]   = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectError, setProjectError]       = useState<string | null>(null);

  const [submitting, setSubmitting]           = useState(false);
  const [formError, setFormError]             = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement & HTMLSelectElement>(null);

  // Owned-item forms (create, or editing an owned item) can offer a subject picker once
  // the context is `academic`; an academic-sourced item never needs this list at all, so
  // skip the fetch entirely for that case. The picker these three state values feed now
  // belongs to the academic branch of `renderContextFields` (Task 26) — the fetch stays
  // here so that branch has the list ready the moment it is added.
  useEffect(() => {
    if (isAcademicEdit) return;
    let cancelled = false;
    setSubjectsLoading(true);
    fetch('/api/studypulse/subjects')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: SubjectOption[]) => { if (!cancelled) setSubjects(data); })
      .catch(() => { if (!cancelled) setSubjectsError('Could not load subjects.'); })
      .finally(() => { if (!cancelled) setSubjectsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
   * TASKS 26 / 28 / 29 / 30: each of you introduces new per-context state (an academic
   * organisation id, a life area, and so on). Add a reset for it HERE as you add it —
   * every per-context field must appear in this list, or it leaks across a context switch.
   * Today the only per-context state that exists is the project and subject ids.
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
  }

  /**
   * The per-context section. Renders `null` for every context in this task by design:
   * Tasks 26 (academic), 28 (organization), 29 (projects) and 30 (life) each add exactly
   * one branch here, one task at a time. Declared inside the component so those branches
   * close over the existing form state (`projectId`, `subjectId`, `projects`, the subject
   * list) without any prop threading.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function renderContextFields(context: WorkContext): React.ReactNode {
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
      const created: ProjectSummary = { id: data.project_id, name, color: null, status: 'active' };
      onProjectCreated(created);
      setProjectId(created.id);
      setShowNewProject(false);
      setNewProjectName('');
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
                  required
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
                      state rather than an invisible default that silently means Projects. */}
                  <option value="">Choose a context…</option>
                  {WORK_CONTEXTS.map(c => <option key={c} value={c}>{CONTEXT_LABELS[c]}</option>)}
                </select>
              </Field>

              {/* The per-context section — nothing until a context is picked. */}
              {context !== '' && renderContextFields(context)}

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
              {submitting ? 'Saving…' : target.mode === 'create' ? 'Create' : 'Save changes'}
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
